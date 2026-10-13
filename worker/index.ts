import { buildWalletWalletPayload, validateTemplateSchema } from '../server/walletPayload.ts';
import { createPassLink, deliverPass, ensureStoredPass, resolvePassLink, storeApplePass, escapeHtml } from './passDelivery.ts';

export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  PASSES_BUCKET: R2Bucket;
  PASS_QUEUE: Queue;
  ASSETS?: Fetcher;
  PUBLIC_DOMAIN: string;
  WALLETWALLET_API_URL: string;
  WALLETWALLET_API_KEY?: string;
  WALLETWALLET_PLAN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

const DEFAULT_ORG_ID = 'org-3fstriders';

// Normalize WalletWallet Base URL (must be https://api.walletwallet.dev, without trailing /v1 or /api)
function normalizeWalletWalletUrl(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return 'https://api.walletwallet.dev';
  let url = rawUrl.trim().replace(/\/+$/, '');
  url = url.replace(/\/v1$/, '').replace(/\/api$/, '');
  return url || 'https://api.walletwallet.dev';
}

// System settings helpers backed by Cloudflare D1
async function getSystemSetting(env: Env, key: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT value FROM SystemSettings WHERE key = ?').bind(key).first<any>();
    return row?.value || null;
  } catch {
    return null;
  }
}

async function setSystemSetting(env: Env, key: string, value: string): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO SystemSettings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(key, value).run();
  } catch (err) {
    console.warn('SystemSettings save notice:', err);
  }
}

async function retainProviderPackage(env: Env, runnerId: string, result: any): Promise<string> {
  await env.DB.prepare(`UPDATE Passes SET walletwallet_pass_id = ?, google_save_url = ?,
    share_url = ?, apple_pass_base64 = ?, r2_key = NULL, updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?`)
    .bind(result.serialNumber, result.googleSaveUrl || null, result.shareUrl || null, result.applePass, runnerId).run();
  return storeApplePass(env, runnerId, result.applePass);
}

// Call WalletWallet API (https://www.walletwallet.dev/docs)
// Supports Free tier (up to 1,000 passes/mo, no credit card required) & Pro tier
async function createWalletWalletPass(options: {
  env: Env;
  apiKey: string;
  baseUrl: string;
  plan: 'free' | 'pro';
  fieldMapping?: string | Record<string, string>;
  raceName: string;
  orgName?: string;
  runner: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    dynamic_data?: any;
  };
  template?: {
    background_color?: string;
    text_color?: string;
    label_color?: string;
    schema_definition?: string;
    logo_image_url?: string;
    strip_image_url?: string;
    background_image_url?: string;
  };
}): Promise<{
  success: boolean;
  serialNumber?: string;
  googleSaveUrl?: string;
  applePass?: string;
  shareUrl?: string;
  error?: string;
  tierUsed: 'free' | 'pro';
  r2Key?: string;
}> {
  const { apiKey, baseUrl, plan, raceName, orgName, runner, template } = options;
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'WALLETWALLET_API_KEY not configured', tierUsed: plan };
  }

  const baseEndpoint = normalizeWalletWalletUrl(baseUrl);

  const cleanApiKey = apiKey.trim().replace(/^Bearer\s+/i, '');

  try {
    const body = buildWalletWalletPayload({ runner, template, raceName, orgName, plan, fieldMapping: options.fieldMapping });
    const res = await fetch(`${baseEndpoint}/api/passes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const resJson: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: resJson.error || resJson.message || `WalletWallet returned HTTP ${res.status}`,
        tierUsed: plan,
      };
    }

    if (!resJson.serialNumber || !resJson.applePass) throw new Error('Wallet provider did not return a signed Apple package');
    const r2Key = await retainProviderPackage(options.env, runner.id, resJson);
    return {
      r2Key,
      success: true,
      serialNumber: resJson.serialNumber,
      googleSaveUrl: resJson.googleSaveUrl,
      applePass: resJson.applePass,
      shareUrl: resJson.shareUrl,
      tierUsed: plan,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Network error connecting to WalletWallet API',
      tierUsed: plan,
    };
  }
}

// Helper to send transactional pass emails via Resend
async function sendPassEmail(options: {
  env: Env;
  to: string;
  firstName: string;
  runnerId: string;
  raceName?: string;
  requestOrigin?: string;
}): Promise<{ success: boolean; error?: string; resendId?: string; hint?: string; passUrl?: string }> {
  const { env, to, firstName, runnerId, raceName, requestOrigin } = options;

  // 1. Resolve Resend API Key: Check Worker secret first, then D1 SystemSettings
  const resendApiKey = env.RESEND_API_KEY || (await getSystemSetting(env, 'resendApiKey'));

  // 2. Resolve Public Domain for magic pass link:
  const savedDomain = await getSystemSetting(env, 'publicDomain');
  let publicDomain = '';
  if (savedDomain && savedDomain.trim()) {
    publicDomain = savedDomain.trim().replace(/\/$/, '');
  } else if (env.PUBLIC_DOMAIN && env.PUBLIC_DOMAIN.trim()) {
    publicDomain = env.PUBLIC_DOMAIN.trim().replace(/\/$/, '');
  } else if (requestOrigin && !requestOrigin.includes('localhost') && !requestOrigin.includes('127.0.0.1')) {
    publicDomain = requestOrigin.replace(/\/$/, '');
  } else {
    publicDomain = 'https://walletpass.3fstriders.org';
  }

  const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
  if (!pass || pass.status !== 'issued') return { success: false, error: 'An issued pass is required before sending email' };
  try { await ensureStoredPass(env, pass); } catch (err: any) {
    return { success: false, error: err.message };
  }
  const token = await createPassLink(env, runnerId);
  const passUrl = `${publicDomain}/${token}`;
  const eventTitle = escapeHtml(raceName || 'Official Athletic Event');

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured in Cloudflare Worker secrets or D1.');
    return {
      success: false,
      error: 'RESEND_API_KEY is not configured in Cloudflare secrets or D1 settings.',
      hint: 'Add your Resend API Key in the web app under Settings (saved to D1) or run `npx wrangler secret put RESEND_API_KEY`.',
      passUrl,
    };
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #ffffff; padding: 32px 16px;">
      <div style="max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 20px; overflow: hidden; border: 1px solid #334155;">
        <div style="background: linear-gradient(135deg, #0284c7, #2563eb); padding: 28px 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${eventTitle}</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #e0f2fe;">Official Digital Participant Pass</p>
        </div>
        <div style="padding: 28px 24px;">
          <p style="margin: 0 0 16px; font-size: 15px; color: #f1f5f9;">Hello <strong>${escapeHtml(firstName)}</strong>,</p>
          <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
            Your verified event pass is ready! You can add it directly to <strong>Apple Wallet</strong> or <strong>Google Wallet</strong> for real-time race updates, start wave alerts, and chute check-in.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${passUrl}" style="background-color: #38bdf8; color: #0f172a; font-weight: 700; font-size: 15px; padding: 15px 30px; border-radius: 12px; text-decoration: none; display: inline-block; margin: 6px; box-shadow: 0 4px 14px rgba(56,189,248,0.3);">
              View & Add to Apple/Google Wallet →
            </a>
          </div>
          <p style="margin: 20px 0 0; font-size: 12px; color: #94a3b8; text-align: center;">
            Direct pass link: <a href="${passUrl}" style="color: #38bdf8; word-break: break-all;">${passUrl}</a>
          </p>
        </div>
        <div style="background: #0f172a; padding: 16px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #334155;">
          ${eventTitle} • Official Participant Portal
        </div>
      </div>
    </body>
    </html>
  `;

  // Resend from address: prioritize D1 user setting, then worker env.EMAIL_FROM, then notification.3fstriders.org verified domain
  const savedEmailFrom = await getSystemSetting(env, 'emailFrom');
  const customEmailFrom = (savedEmailFrom && savedEmailFrom.trim()) ? savedEmailFrom.trim() : env.EMAIL_FROM;
  const fromAddress = customEmailFrom || 'Pacific Athletic Series <passes@notification.3fstriders.org>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject: `Your ${eventTitle} Digital Pass is Ready!`,
        html,
      }),
    });

    const resJson: any = await res.json();
    if (!res.ok) {
      // If error was unverified custom domain, retry once with onboarding@resend.dev
      if (fromAddress !== 'Wallet Pass <onboarding@resend.dev>') {
        const retry = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Wallet Pass <onboarding@resend.dev>',
            to: [to],
            subject: `Your ${eventTitle} Digital Pass is Ready!`,
            html,
          }),
        });
        const retryJson: any = await retry.json();
        if (retry.ok) {
          return { success: true, resendId: retryJson.id, passUrl };
        }
      }

      const errMsg = resJson.message || resJson.error || 'Resend API error';
      let hint: string | undefined;

      if (errMsg.toLowerCase().includes('testing emails to your own email address') || errMsg.toLowerCase().includes('testing emails')) {
        hint = 'Resend free test mode only allows sending to the email registered on your Resend account. To send to any runner, verify a custom domain at resend.com/domains.';
      } else if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('unauthorized')) {
        hint = 'The Resend API key appears to be invalid. Verify the key at resend.com/api-keys.';
      } else if (errMsg.toLowerCase().includes('domain') || errMsg.toLowerCase().includes('from')) {
        hint = 'Sender domain is not verified. Set EMAIL_FROM to "onboarding@resend.dev" or verify DNS records in Resend.';
      }

      return {
        success: false,
        error: errMsg,
        hint,
        passUrl,
      };
    }

    return { success: true, resendId: resJson.id, passUrl };
  } catch (err: any) {
    return { success: false, error: err.message, passUrl };
  }
}

// Auto-seed default organization and template if D1 is freshly provisioned
async function ensureD1Bootstrap(env: Env): Promise<string> {
  // 0. Ensure SystemSettings table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS SystemSettings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch {}
  // 1. Ensure Organizations table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS Organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch {}

  // 2. Ensure Templates table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS Templates (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        background_color TEXT DEFAULT '#111827',
        text_color TEXT DEFAULT '#FFFFFF',
        label_color TEXT DEFAULT '#9CA3AF',
        logo_image_url TEXT,
        background_image_url TEXT,
        strip_image_url TEXT,
        schema_definition TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES Organizations(id) ON DELETE CASCADE
      )
    `).run();
  } catch {}

  // 3. Ensure Races table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS Races (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        event_date DATETIME,
        location TEXT,
        field_mapping TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES Organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (template_id) REFERENCES Templates(id)
      )
    `).run();
  } catch {}

  // 4. Ensure Runners table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS Runners (
        id TEXT PRIMARY KEY,
        race_id TEXT NOT NULL,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        dynamic_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (race_id) REFERENCES Races(id) ON DELETE CASCADE,
        UNIQUE(race_id, email)
      )
    `).run();
  } catch {}

  // 5. Ensure Passes table
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS Passes (
        id TEXT PRIMARY KEY,
        runner_id TEXT NOT NULL UNIQUE,
        walletwallet_pass_id TEXT UNIQUE,
        google_save_url TEXT,
        share_url TEXT,
        apple_pass_base64 TEXT,
        status TEXT DEFAULT 'pending',
        installed_apple BOOLEAN DEFAULT 0,
        installed_google BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
      )
    `).run();
  } catch {}
  try { await env.DB.prepare('ALTER TABLE Passes ADD COLUMN google_save_url TEXT').run(); } catch {}
  try { await env.DB.prepare('ALTER TABLE Passes ADD COLUMN share_url TEXT').run(); } catch {}
  try { await env.DB.prepare('ALTER TABLE Passes ADD COLUMN apple_pass_base64 TEXT').run(); } catch {}
  try { await env.DB.prepare('ALTER TABLE Passes ADD COLUMN r2_key TEXT').run(); } catch {}

  // 6. Guarantee that an organization exists in the Organizations table
  let activeOrgId = DEFAULT_ORG_ID;
  try {
    const existingOrg = await env.DB.prepare('SELECT id FROM Organizations LIMIT 1').first<any>();
    if (existingOrg && existingOrg.id) {
      activeOrgId = existingOrg.id;
    } else {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO Organizations (id, name) VALUES (?, '3F Striders Athletic Club')"
      ).bind(DEFAULT_ORG_ID).run();
      activeOrgId = DEFAULT_ORG_ID;
    }
  } catch (err) {
    console.error('Organization bootstrap notice:', err);
  }

  // 7. Seed initial template if none exist
  try {
    const countResult = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Templates").first<any>();
    if (!countResult || countResult.cnt === 0) {
      const defaultSchema = JSON.stringify({
        organizationName: '3F Striders',
        logoText: 'Golden Gate Marathon 2026',
        description: 'Official Participant Digital Pass',
        colorPreset: 'dark',
        barcodeFormat: 'QR',
        barcodeAltText: 'BIB #{{bib}}',
        headerFields: [{ label: 'WAVE', key: 'wave' }],
        primaryFields: [{ label: 'BIB NUMBER', key: 'bib' }],
        secondaryFields: [
          { label: 'PARTICIPANT', key: 'runner_name' },
          { label: 'DIVISION', key: 'category' },
        ],
        backFields: [
          { label: 'Emergency Contact', key: 'emergency_contact', value: 'Maria Caisip (+1 415-555-0199)' },
          { label: 'Runner Email', key: 'email', value: 'arnoldcaisip@gmail.com' },
          { label: 'Official Rules', value: 'Present QR at start chute check-in and finish village medal chute.' },
        ],
        sharingProhibited: false,
      });

      await env.DB.prepare(`
        INSERT OR IGNORE INTO Templates (
          id, org_id, name, background_color, text_color, label_color,
          logo_image_url, strip_image_url, schema_definition
        ) VALUES (
          'tpl-marathon-vip', ?, 'Marathon VIP Digital Pass', '#18181b', '#ffffff', '#a1a1aa',
          '',
          '',
          ?
        )
      `).bind(activeOrgId, defaultSchema).run();
    }
  } catch (err) {
    console.error('Template bootstrap notice:', err);
  }

  return activeOrgId;
}

export default {
  // ---------------------------------------------------------------------------
  // 1. Fetch Handler: Edge HTTP Router & Static Assets
  // ---------------------------------------------------------------------------
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // CORS Headers for API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const deliveryMatch = pathname.match(/^\/([A-Za-z0-9_-]{43})(?:\/(apple|google))?$/);
    if (deliveryMatch) {
      try { return await deliverPass(request, env, deliveryMatch[1], deliveryMatch[2]); }
      catch { return new Response('Pass service temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
    }
    if (pathname.startsWith('/pass/')) {
      return new Response('This link has been replaced. Please request a new email at /lookup.', {
        status: 410, headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    // --- API ROUTES ---

    // Organizer-only endpoint: protect this with the same Access policy as the admin APIs.
    if (pathname.startsWith('/api/pass/link/') && request.method === 'POST') {
      try {
        const runnerId = pathname.replace('/api/pass/link/', '');
        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        if (!pass || pass.status !== 'issued') return Response.json({ success: false, error: 'An issued pass is required' }, { status: 409 });
        await ensureStoredPass(env, pass);
        const token = await createPassLink(env, runnerId);
        return Response.json({ success: true, passUrl: `/${token}` }, { headers: { 'Cache-Control': 'private, no-store' } });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 503 });
      }
    }


    // =========================================================================
    // TEMPLATES ENDPOINTS (GET, POST, PUT, DELETE)
    // =========================================================================
    if (pathname === '/api/templates' && request.method === 'GET') {
      try {
        await ensureD1Bootstrap(env);
        const res = await env.DB.prepare('SELECT * FROM Templates ORDER BY created_at DESC').all<any>();
        return Response.json({ success: true, data: res.results }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/templates/') && request.method === 'GET') {
      const templateId = pathname.replace('/api/templates/', '');
      try {
        const template = await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(templateId).first<any>();
        if (!template) return Response.json({ success: false, error: 'Template not found' }, { status: 404, headers: corsHeaders });
        return Response.json({ success: true, data: template }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/templates' && request.method === 'POST') {
      try {
        const confirmedOrgId = await ensureD1Bootstrap(env);
        const body: any = await request.json();
        const {
          name,
          background_color,
          text_color,
          label_color,
          logo_image_url,
          strip_image_url,
          schema_definition,
          org_id,
        } = body;

        if (!name) {
          return Response.json({ success: false, error: 'Template name is required' }, { status: 400, headers: corsHeaders });
        }

        // Guarantee requested or default organization exists in Organizations table
        let finalOrgId = confirmedOrgId;
        const targetOrg = org_id || DEFAULT_ORG_ID;
        try {
          const checkOrg = await env.DB.prepare('SELECT id FROM Organizations WHERE id = ?').bind(targetOrg).first<any>();
          if (checkOrg && checkOrg.id) {
            finalOrgId = checkOrg.id;
          } else {
            await env.DB.prepare(
              "INSERT OR IGNORE INTO Organizations (id, name) VALUES (?, '3F Striders Athletic Club')"
            ).bind(targetOrg).run();
            finalOrgId = targetOrg;
          }
        } catch {
          finalOrgId = confirmedOrgId;
        }

        const templateId = `tpl-${crypto.randomUUID()}`;
        let schemaStr: string | null = null;
        if (schema_definition !== undefined || request.method === 'POST') {
          try { schemaStr = JSON.stringify(validateTemplateSchema(schema_definition ?? {})); }
          catch (err: any) { return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders }); }
        }

        await env.DB.prepare(`
          INSERT INTO Templates (
            id, org_id, name, background_color, text_color, label_color,
            logo_image_url, strip_image_url, schema_definition
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          templateId,
          finalOrgId,
          name,
          background_color || '#0f172a',
          text_color || '#ffffff',
          label_color || '#38bdf8',
          logo_image_url || '',
          strip_image_url || '',
          schemaStr
        ).run();

        const created = await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(templateId).first<any>();
        return Response.json({ success: true, data: created }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/templates/') && request.method === 'PUT') {
      const templateId = pathname.replace('/api/templates/', '');
      try {
        const body: any = await request.json();
        const {
          name,
          background_color,
          text_color,
          label_color,
          logo_image_url,
          strip_image_url,
          schema_definition,
        } = body;

        let schemaStr: string | null = null;
        if (schema_definition !== undefined) {
          try { schemaStr = JSON.stringify(validateTemplateSchema(schema_definition ?? {})); }
          catch (err: any) { return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders }); }
        }

        await env.DB.prepare(`
          UPDATE Templates
          SET name = COALESCE(?, name),
              background_color = COALESCE(?, background_color),
              text_color = COALESCE(?, text_color),
              label_color = COALESCE(?, label_color),
              logo_image_url = COALESCE(?, logo_image_url),
              strip_image_url = COALESCE(?, strip_image_url),
              schema_definition = COALESCE(?, schema_definition)
          WHERE id = ?
        `).bind(
          name || null,
          background_color || null,
          text_color || null,
          label_color || null,
          logo_image_url !== undefined ? logo_image_url : null,
          strip_image_url !== undefined ? strip_image_url : null,
          schemaStr || null,
          templateId
        ).run();

        const updated = await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(templateId).first<any>();
        return Response.json({ success: true, data: updated }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/templates/') && request.method === 'DELETE') {
      const templateId = pathname.replace('/api/templates/', '');
      try {
        await env.DB.prepare('DELETE FROM Templates WHERE id = ?').bind(templateId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // RACES ENDPOINTS (GET, POST, PUT, DELETE)
    // =========================================================================
    if (pathname === '/api/races' && request.method === 'GET') {
      try {
        await ensureD1Bootstrap(env);
        const query = `
          SELECT r.*, t.name as template_name,
            (SELECT COUNT(*) FROM Runners WHERE race_id = r.id) as runner_count,
            (SELECT COUNT(*) FROM Runners ru JOIN Passes p ON ru.id = p.runner_id WHERE ru.race_id = r.id AND p.status = 'issued') as issued_count
          FROM Races r
          LEFT JOIN Templates t ON r.template_id = t.id
          ORDER BY r.created_at DESC
        `;
        const res = await env.DB.prepare(query).all<any>();
        return Response.json({ success: true, data: res.results }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/races/') && request.method === 'GET') {
      const raceId = pathname.replace('/api/races/', '');
      try {
        const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(raceId).first<any>();
        if (!race) return Response.json({ success: false, error: 'Race not found' }, { status: 404, headers: corsHeaders });
        return Response.json({ success: true, data: race }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/races' && request.method === 'POST') {
      try {
        const confirmedOrgId = await ensureD1Bootstrap(env);
        const body: any = await request.json();
        const { name, template_id, event_date, location, field_mapping, org_id } = body;
        if (!name || !template_id) {
          return Response.json({ success: false, error: 'Name and template_id are required' }, { status: 400, headers: corsHeaders });
        }

        // Guarantee requested or default organization exists
        let finalOrgId = confirmedOrgId;
        const targetOrg = org_id || DEFAULT_ORG_ID;
        try {
          const checkOrg = await env.DB.prepare('SELECT id FROM Organizations WHERE id = ?').bind(targetOrg).first<any>();
          if (checkOrg && checkOrg.id) {
            finalOrgId = checkOrg.id;
          } else {
            await env.DB.prepare(
              "INSERT OR IGNORE INTO Organizations (id, name) VALUES (?, '3F Striders Athletic Club')"
            ).bind(targetOrg).run();
            finalOrgId = targetOrg;
          }
        } catch {
          finalOrgId = confirmedOrgId;
        }

        const raceId = `race-${crypto.randomUUID()}`;
        const mappingStr = typeof field_mapping === 'string' ? field_mapping : JSON.stringify(field_mapping || {});

        await env.DB.prepare(`
          INSERT INTO Races (id, org_id, template_id, name, event_date, location, field_mapping)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          raceId,
          finalOrgId,
          template_id,
          name,
          event_date || new Date().toISOString(),
          location || 'TBD',
          mappingStr
        ).run();

        const created = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(raceId).first<any>();
        return Response.json({ success: true, data: created }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/races/') && request.method === 'DELETE') {
      const raceId = pathname.replace('/api/races/', '');
      try {
        await env.DB.prepare('DELETE FROM Races WHERE id = ?').bind(raceId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // RUNNERS CRUD ENDPOINTS
    // =========================================================================
    if (pathname === '/api/runners' && request.method === 'GET') {
      const raceId = searchParams.get('race_id');
      try {
        let sql = `
          SELECT r.*, p.status as pass_status, p.installed_apple, p.installed_google, p.walletwallet_pass_id,
                 p.id as pass_id
          FROM Runners r
          LEFT JOIN Passes p ON r.id = p.runner_id
        `;
        let stmt;
        if (raceId) {
          sql += ' WHERE r.race_id = ? ORDER BY r.created_at DESC';
          stmt = env.DB.prepare(sql).bind(raceId);
        } else {
          sql += ' ORDER BY r.created_at DESC';
          stmt = env.DB.prepare(sql);
        }

        const res = await stmt.all<any>();
        const runners = res.results.map((r: any) => ({
          ...r,
          pass: {
            id: r.pass_id,
            runner_id: r.id,
            walletwallet_pass_id: r.walletwallet_pass_id,
            status: r.pass_status || 'pending',
            installed_apple: r.installed_apple || 0,
            installed_google: r.installed_google || 0,
          },
        }));

        return Response.json({ success: true, data: runners }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/runner/create' && request.method === 'POST') {
      try {
        await ensureD1Bootstrap(env);
        const body: any = await request.json();
        const { race_id, email, first_name, last_name, dynamic_data, issue_immediate } = body;
        if (!race_id || !email || !first_name || !last_name) {
          return Response.json({ success: false, error: 'race_id, email, first_name, last_name required' }, { status: 400, headers: corsHeaders });
        }

        const runnerId = `run-${crypto.randomUUID()}`;
        const passId = `pass-${runnerId}`;
        const dynStr = typeof dynamic_data === 'string' ? dynamic_data : JSON.stringify(dynamic_data || {});
        let passStatus = 'pending';

        await env.DB.prepare(`
          INSERT INTO Runners (id, race_id, email, first_name, last_name, dynamic_data)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(runnerId, race_id, email, first_name, last_name, dynStr).run();

        await env.DB.prepare(`INSERT INTO Passes (id, runner_id, status) VALUES (?, ?, 'pending')`)
          .bind(passId, runnerId).run();

        // Retrieve Race, Template, and Organization
        const raceDetails = await env.DB.prepare(`
          SELECT r.*, t.background_color, t.text_color, t.label_color, t.logo_image_url, t.strip_image_url, t.background_image_url, t.schema_definition, o.name as org_name
          FROM Races r
          LEFT JOIN Templates t ON r.template_id = t.id
          LEFT JOIN Organizations o ON r.org_id = o.id
          WHERE r.id = ?
        `).bind(race_id).first<any>();

        // WalletWallet API pass creation (https://www.walletwallet.dev/docs)
        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const walletwalletApiUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const walletwalletPlan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';

        let wwResult: any = { success: false, error: 'WALLETWALLET_API_KEY not configured' };

        if (walletwalletApiKey && issue_immediate !== false) {
          wwResult = await createWalletWalletPass({
            env,
            apiKey: walletwalletApiKey,
            baseUrl: walletwalletApiUrl,
            plan: walletwalletPlan,
            fieldMapping: raceDetails?.field_mapping,
            raceName: raceDetails?.name || 'Athletic Event',
            orgName: raceDetails?.org_name || 'Pacific Athletic Series',
            runner: {
              id: runnerId,
              first_name,
              last_name,
              email,
              dynamic_data,
            },
            template: raceDetails ? {
              schema_definition: raceDetails.schema_definition,
              background_image_url: raceDetails.background_image_url,
              background_color: raceDetails.background_color,
              text_color: raceDetails.text_color,
              label_color: raceDetails.label_color,
              logo_image_url: raceDetails.logo_image_url,
              strip_image_url: raceDetails.strip_image_url,
            } : undefined,
          });

          if (wwResult.success && wwResult.serialNumber) {
            passStatus = 'issued';
          }
        }

        if (wwResult.success) {
          await env.DB.prepare(`UPDATE Passes SET r2_key = ?, status = ? WHERE runner_id = ?`)
            .bind(wwResult.r2Key, passStatus, runnerId).run();
        }

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE id = ?').bind(passId).first<any>();
        const race = await env.DB.prepare('SELECT name FROM Races WHERE id = ?').bind(race_id).first<any>();

        // Dispatch transactional pass email via Resend
        let emailResult: any = { success: false, error: 'Not dispatched' };
        if (passStatus === 'issued') {
          emailResult = await sendPassEmail({
            env,
            to: email,
            firstName: first_name,
            runnerId,
            raceName: race?.name,
            requestOrigin: url.origin,
          });
        }

        return Response.json({
          success: true,
          data: {
            runner,
            pass,
            email_delivery: emailResult,
            walletwallet_delivery: wwResult,
          },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/runner/send-email' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { runner_id } = body;
        if (!runner_id) return Response.json({ success: false, error: 'runner_id required' }, { status: 400, headers: corsHeaders });

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });

        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
        const race = await env.DB.prepare('SELECT name FROM Races WHERE id = ?').bind(runner.race_id).first<any>();

        const emailResult = await sendPassEmail({
          env,
          to: runner.email,
          firstName: runner.first_name,
          runnerId: runner.id,
          raceName: race?.name,
          requestOrigin: url.origin,
        });

        return Response.json({
          success: emailResult.success,
          message: emailResult.success
            ? `Pass delivery email dispatched to ${runner.email}`
            : `Email delivery notice: ${emailResult.error}`,
          data: emailResult,
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // TEST EMAIL DISPATCH (POST /api/email/test)
    // =========================================================================
    if (pathname === '/api/email/test' && request.method === 'POST') {
      try {
        await ensureD1Bootstrap(env);
        const body: any = await request.json().catch(() => ({}));
        const targetEmail = body?.to || body?.email;
        if (!targetEmail) {
          return Response.json({ success: false, error: 'Recipient email is required' }, { status: 400, headers: corsHeaders });
        }

        const runner = await env.DB.prepare('SELECT id, first_name, email, race_id FROM Runners LIMIT 1').first<any>();
        const race = runner ? await env.DB.prepare('SELECT name FROM Races WHERE id = ?').bind(runner.race_id).first<any>() : null;

        const emailResult = await sendPassEmail({
          env,
          to: targetEmail,
          firstName: body.first_name || runner?.first_name || 'Event Participant',
          runnerId: runner?.id || 'run-test-sample',
          raceName: race?.name || 'Championship Marathon 2026',
          requestOrigin: url.origin,
        });

        return Response.json({
          success: emailResult.success,
          data: emailResult,
          message: emailResult.success
            ? `Test email sent to ${targetEmail}! (Resend ID: ${emailResult.resendId})`
            : `Email delivery failed: ${emailResult.error}`,
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/api/runner/') && request.method === 'DELETE') {
      const runnerId = pathname.replace('/api/runner/', '');
      try {
        await env.DB.prepare('DELETE FROM Runners WHERE id = ?').bind(runnerId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/runner/reissue' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { runner_id } = body;
        await env.DB.prepare("UPDATE Passes SET status = 'issued', updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?").bind(runner_id).run();
        return Response.json({ success: true, data: { status: 'issued' } }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // Legacy download aliases require the same bearer token as the new root route.
    // No on-demand provider calls or unsigned local fallback packages.
    if (pathname.startsWith('/api/pass/download/') || pathname.startsWith('/api/r2/pass/') || pathname.startsWith('/passes/')) {
      const runnerId = pathname.replace(/^\/(api\/pass\/download|api\/r2\/pass|passes)\//, '')
        .replace(/\/(apple|pass)?(\.pkpass)?$/i, '').replace(/\.pkpass$/i, '');
      const token = searchParams.get('token') || '';
      const pass = await resolvePassLink(env, token);
      if (!pass || pass.runner_id !== runnerId) return new Response('Pass link not found', { status: 404 });
      return deliverPass(request, env, token, 'apple');
    }

    // =========================================================================
    // LIVE PASS UPDATES (PUT /api/runner/update)
    // =========================================================================
    if (pathname === '/api/runner/update' && request.method === 'PUT') {
      try {
        const body: any = await request.json();
        const { runner_id, first_name, last_name, email, dynamic_data } = body;
        if (!runner_id) return Response.json({ success: false, error: 'runner_id required' }, { status: 400, headers: corsHeaders });

        const dynamicStr = dynamic_data === undefined ? null : typeof dynamic_data === 'string' ? dynamic_data : JSON.stringify(dynamic_data || {});
        await env.DB.prepare(`
          UPDATE Runners 
          SET first_name = COALESCE(?, first_name),
              last_name = COALESCE(?, last_name),
              email = COALESCE(?, email),
              dynamic_data = COALESCE(?, dynamic_data)
          WHERE id = ?
        `).bind(first_name || null, last_name || null, email || null, dynamicStr, runner_id).run();

        // WalletWallet PUT replaces the full pass specification, on all plans.
        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const walletwalletApiUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const walletwalletPlan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';
        const currentRunner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        if (!currentRunner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });
        let providerUpdated = false;
        if (walletwalletApiKey) {
          const pass = await env.DB.prepare('SELECT walletwallet_pass_id, status FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
          if (pass?.status === 'issued' && pass.walletwallet_pass_id && !pass.walletwallet_pass_id.startsWith('ww_run-')) {
            const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(currentRunner.race_id).first<any>();
            const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;
            const response = await fetch(`${normalizeWalletWalletUrl(walletwalletApiUrl)}/api/passes/${pass.walletwallet_pass_id}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${walletwalletApiKey.trim().replace(/^Bearer\s+/i, '')}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(buildWalletWalletPayload({ runner: currentRunner, template, raceName: race?.name || 'Athletic Event',
                fieldMapping: race?.field_mapping, plan: walletwalletPlan })),
            });
            if (!response.ok) {
              const error: any = await response.json().catch(() => ({}));
              return Response.json({ success: false, error: error.error || 'WalletWallet update failed', data: { runner: currentRunner },
                plan_note: 'Participant saved in D1; wallet update failed. Retry after correcting the provider error.' }, { status: 502, headers: corsHeaders });
            }
            providerUpdated = true;
          }
        }

        const updated = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        return Response.json({
          success: true,
          data: { runner: updated },
          plan_note: providerUpdated ? 'D1 and WalletWallet updated.' : 'D1 updated; no issued provider pass was available to update.',
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // PASS REVOCATION (POST /api/runner/revoke)
    // =========================================================================
    if (pathname === '/api/runner/revoke' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { runner_id } = body;
        if (!runner_id) return Response.json({ success: false, error: 'runner_id required' }, { status: 400, headers: corsHeaders });

        await env.DB.prepare("UPDATE Passes SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?").bind(runner_id).run();

        // Call WalletWallet DELETE /api/passes/<serial> if real key configured
        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const walletwalletApiUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        if (walletwalletApiKey) {
          const pass = await env.DB.prepare('SELECT walletwallet_pass_id FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
          if (pass?.walletwallet_pass_id && !pass.walletwallet_pass_id.startsWith('ww_run-')) {
            ctx.waitUntil(
              fetch(`${normalizeWalletWalletUrl(walletwalletApiUrl)}/api/passes/${pass.walletwallet_pass_id}`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${walletwalletApiKey.trim()}`,
                },
              }).catch(() => {})
            );
          }
        }

        return Response.json({ success: true, data: { status: 'revoked' } }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // BULK IMPORT -> QUEUE (POST /api/import)
    // =========================================================================
    if (pathname === '/api/import' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { race_id, rows } = body;
        if (!race_id || !Array.isArray(rows)) {
          return Response.json({ success: false, error: 'race_id and rows array required' }, { status: 400, headers: corsHeaders });
        }

        for (const row of rows) {
          const runnerId = `run-${crypto.randomUUID()}`;
          const email = row.email || row.Email;
          const firstName = row.first_name || row['First Name'] || 'Runner';
          const lastName = row.last_name || row['Last Name'] || 'Participant';
          if (!email) continue;

          const dyn = { ...row };
          delete dyn.email;
          delete dyn.first_name;
          delete dyn.last_name;

          await env.DB.prepare(`
            INSERT INTO Runners (id, race_id, email, first_name, last_name, dynamic_data)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(runnerId, race_id, email, firstName, lastName, JSON.stringify(dyn)).run();

          await env.DB.prepare(`
            INSERT INTO Passes (id, runner_id, walletwallet_pass_id, status)
            VALUES (?, ?, ?, 'pending')
          `).bind(`pass-${runnerId}`, runnerId, `ww_${runnerId}`).run();

          if (env.PASS_QUEUE) {
            await env.PASS_QUEUE.send({
              runner_id: runnerId,
              race_id,
              payload: { email, first_name: firstName, last_name: lastName, dynamic_data: dyn },
            });
          }
        }

        return Response.json({
          success: true,
          message: `Enqueued ${rows.length} participants to Cloudflare PASS_QUEUE`,
          data: { total_enqueued: rows.length, queue_binding: 'PASS_QUEUE' },
        }, { status: 202, headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // PARTICIPANT LOOKUP (POST /api/lookup)
    // =========================================================================
    if (pathname === '/api/lookup' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { email } = body;
        if (!email) return Response.json({ success: false, error: 'Email required' }, { status: 400, headers: corsHeaders });

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE LOWER(email) = LOWER(?) LIMIT 1').bind(email).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Registration not found' }, { status: 404, headers: corsHeaders });

        const race = await env.DB.prepare('SELECT name FROM Races WHERE id = ?').bind(runner.race_id).first<any>();

        // Re-dispatch transactional email via Resend
        const emailResult = await sendPassEmail({
          env,
          to: runner.email,
          firstName: runner.first_name,
          runnerId: runner.id,
          raceName: race?.name,
        });

        return Response.json({
          success: emailResult.success,
          message: emailResult.success
            ? `Pass delivery email dispatched to ${runner.email}`
            : `Found pass, but email delivery error: ${emailResult.error}`,
          data: {
            runner_id: runner.id,
            email: runner.email,
            email_delivery: { success: emailResult.success, error: emailResult.error },
          },
        }, { status: emailResult.success ? 200 : 502, headers: { ...corsHeaders, 'Cache-Control': 'private, no-store' } });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // PASS DETAILS FOR RUNNER SSR/LANDING (GET /api/pass/details/:id)
    // =========================================================================
    if (pathname.startsWith('/api/pass/details/')) {
      const runnerId = pathname.replace('/api/pass/details/', '');
      const linkedPass = await resolvePassLink(env, searchParams.get('token') || '');
      if (!linkedPass || linkedPass.runner_id !== runnerId || linkedPass.status !== 'issued') return new Response('Pass link not found', { status: 404 });
      try {
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });

        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;

        return Response.json({
          success: true,
          data: { runner, pass: pass ? { status: pass.status } : null, race, template },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // EXPLICIT PASS SYNC / PROVISION (POST /api/pass/sync/:id)
    // =========================================================================
    if (pathname.startsWith('/api/pass/sync/') && request.method === 'POST') {
      const runnerId = pathname.replace('/api/pass/sync/', '');
      try {
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });
        const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;

        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        if (!walletwalletApiKey) {
          return Response.json({
            success: false,
            error: 'WALLETWALLET_API_KEY is not configured yet. Add your key in Admin Settings or wrangler.toml to issue official Google & Apple passes.',
          }, { status: 400, headers: corsHeaders });
        }

        const rawUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const plan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';
        const wwRes = await createWalletWalletPass({
            env,
          apiKey: walletwalletApiKey,
          baseUrl: rawUrl,
          plan,
          fieldMapping: race?.field_mapping,
          raceName: race?.name || 'Athletic Event',
          orgName: race?.org_name || 'Pacific Athletic Series',
          runner,
          template: template || undefined,
        });

        if (!wwRes.success) {
          return Response.json({ success: false, error: wwRes.error || 'Failed to issue pass via WalletWallet API' }, { status: 502, headers: corsHeaders });
        }

        await env.DB.prepare(`
          UPDATE Passes 
          SET walletwallet_pass_id = ?, google_save_url = ?, share_url = ?, apple_pass_base64 = ?, r2_key = ?, status = 'issued', updated_at = CURRENT_TIMESTAMP
          WHERE runner_id = ?
        `).bind(wwRes.serialNumber, wwRes.googleSaveUrl || null, wwRes.shareUrl || null, wwRes.applePass || null, wwRes.r2Key, runnerId).run();

        const updatedPass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        return Response.json({
          success: true,
          pass: updatedPass,
          googleSaveUrl: wwRes.googleSaveUrl,
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // R2 BULK SYNC & BUCKET INSPECTOR (GET/POST /api/r2/sync-all & /api/r2/list)
    // =========================================================================
    if (pathname === '/api/r2/sync-all' && request.method === 'POST') {
      try {
        const passes = await env.DB.prepare('SELECT * FROM Passes WHERE apple_pass_base64 IS NOT NULL').all<any>();
        const failures: string[] = [];
        let syncedCount = 0;
        for (const pass of passes.results) {
          try { await ensureStoredPass(env, pass); syncedCount++; }
          catch { failures.push(pass.runner_id); }
        }
        return Response.json({ success: failures.length === 0, syncedCount, failures }, {
          status: failures.length ? 503 : 200, headers: corsHeaders,
        });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/r2/list') {
      try {
        const r2Bucket: R2Bucket | undefined = env.ASSETS_BUCKET || (env as any).R2 || (env as any).BUCKET || (env as any).WALLET_PASS_ASSETS;
        if (!r2Bucket) {
          return Response.json({ success: false, error: 'R2 bucket binding not found' }, { status: 500, headers: corsHeaders });
        }
        const list = await r2Bucket.list({ limit: 100 });
        return Response.json({
          success: true,
          count: list.objects.length,
          objects: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // STATS & DASHBOARD (GET /api/stats)
    // =========================================================================
    if (pathname === '/api/stats') {
      try {
        await ensureD1Bootstrap(env);
        const passes = (await env.DB.prepare('SELECT status, installed_apple, installed_google FROM Passes').all<any>()).results || [];
        const races = (await env.DB.prepare('SELECT id FROM Races').all<any>()).results || [];
        const runners = (await env.DB.prepare('SELECT id FROM Runners').all<any>()).results || [];
        const templates = (await env.DB.prepare('SELECT id FROM Templates').all<any>()).results || [];

        const totalPasses = passes.length;
        const issuedPasses = passes.filter((p: any) => p.status === 'issued').length;
        const pendingPasses = passes.filter((p: any) => p.status === 'pending').length;
        const revokedPasses = passes.filter((p: any) => p.status === 'revoked').length;
        const appleInstalls = passes.filter((p: any) => p.installed_apple === 1).length;
        const googleInstalls = passes.filter((p: any) => p.installed_google === 1).length;

        return Response.json({
          success: true,
          data: {
            metrics: {
              totalPasses,
              issuedPasses,
              pendingPasses,
              revokedPasses,
              appleInstalls,
              googleInstalls,
              activeRaces: races.length,
              totalRunners: runners.length,
              templatesCount: templates.length,
            },
            recent_pushes: [],
            recent_emails: [],
          },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // D1 SQL QUERY CONSOLE (POST /api/d1/query)
    // =========================================================================
    if (pathname === '/api/d1/query' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { query } = body;
        if (!query) return Response.json({ success: false, error: 'SQL query required' }, { status: 400, headers: corsHeaders });

        const res = await env.DB.prepare(query).all<any>();
        return Response.json({ success: true, data: { results: res.results } }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, data: { error: err.message } }, { headers: corsHeaders });
      }
    }

    // =========================================================================
    // R2 ASSET STORAGE (GET, POST)
    // =========================================================================
    if (pathname === '/api/r2/assets' && request.method === 'GET') {
      try {
        // Return default assets list or list from R2
        const defaultAssets = [
          {
            key: 'assets/logos/pac-marathon-logo.svg',
            filename: 'pac-marathon-logo.svg',
            size: 8240,
            url: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=400&q=80',
          },
          {
            key: 'assets/strips/golden-gate-finish.jpg',
            filename: 'golden-gate-finish.jpg',
            size: 142800,
            url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=1200&q=80',
          },
        ];
        return Response.json({ success: true, data: defaultAssets }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // SETTINGS (GET, POST)
    // =========================================================================
    if (pathname === '/api/settings' && request.method === 'GET') {
      try {
        await ensureD1Bootstrap(env);
        const resendApiKey = env.RESEND_API_KEY || (await getSystemSetting(env, 'resendApiKey')) || '';
        const savedEmailFrom = await getSystemSetting(env, 'emailFrom');
        const emailFrom = (savedEmailFrom && savedEmailFrom.trim()) ? savedEmailFrom.trim() : (env.EMAIL_FROM || 'Pacific Athletic Series <passes@notification.3fstriders.org>');
        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const rawApiUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const walletwalletApiUrl = normalizeWalletWalletUrl(rawApiUrl);
        const walletwalletPlan = (await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free';
        const savedDomain = await getSystemSetting(env, 'publicDomain');
        const publicDomain = savedDomain || (env.PUBLIC_DOMAIN && !env.PUBLIC_DOMAIN.includes('3fstriders.org') ? env.PUBLIC_DOMAIN : url.origin);

        return Response.json({
          success: true,
          data: {
            publicDomain,
            walletwalletApiUrl,
            walletwalletPlan,
            emailFrom,
            walletwalletApiKey: walletwalletApiKey ? (walletwalletApiKey.slice(0, 7) + '••••••••') : '',
            resendApiKey: resendApiKey ? (resendApiKey.slice(0, 6) + '••••••••') : '',
            hasWalletWalletKey: Boolean(walletwalletApiKey),
            hasResendKey: Boolean(resendApiKey),
            configuredViaSecret: Boolean(env.RESEND_API_KEY),
            activeOrigin: url.origin,
          },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (pathname === '/api/settings' && request.method === 'POST') {
      try {
        await ensureD1Bootstrap(env);
        const body: any = await request.json();
        const { walletwalletApiKey, walletwalletApiUrl, walletwalletPlan, resendApiKey, emailFrom, publicDomain } = body;

        if (walletwalletApiKey !== undefined && !walletwalletApiKey.includes('••••')) {
          await setSystemSetting(env, 'walletwalletApiKey', walletwalletApiKey.trim());
        }
        if (walletwalletApiUrl !== undefined) {
          await setSystemSetting(env, 'walletwalletApiUrl', normalizeWalletWalletUrl(walletwalletApiUrl.trim()));
        }
        if (walletwalletPlan !== undefined) {
          await setSystemSetting(env, 'walletwalletPlan', walletwalletPlan.trim());
        }
        if (resendApiKey !== undefined && !resendApiKey.includes('••••')) {
          await setSystemSetting(env, 'resendApiKey', resendApiKey.trim());
        }
        if (emailFrom !== undefined) {
          await setSystemSetting(env, 'emailFrom', emailFrom.trim());
        }
        if (publicDomain !== undefined) {
          await setSystemSetting(env, 'publicDomain', publicDomain.trim());
        }

        return Response.json({
          success: true,
          message: 'System configuration updated successfully in Cloudflare D1!',
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // WALLETWALLET STATUS & TEST (GET /api/walletwallet/status)
    // =========================================================================
    if (pathname === '/api/walletwallet/status') {
      try {
        await ensureD1Bootstrap(env);
        const apiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const rawUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const plan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';
        const baseUrl = normalizeWalletWalletUrl(rawUrl);

        if (!apiKey) {
          return Response.json({
            success: false,
            error: 'WALLETWALLET_API_KEY is not configured yet in Settings or Cloudflare secrets.',
            plan,
            baseUrl,
          }, { headers: corsHeaders });
        }

        // Call GET /api/auth/usage per WalletWallet docs
        const usageRes = await fetch(`${baseUrl}/api/auth/usage`, {
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });

        const usageJson: any = await usageRes.json().catch(() => ({}));
        if (!usageRes.ok) {
          return Response.json({
            success: false,
            error: usageJson.error || usageJson.message || `WalletWallet returned HTTP ${usageRes.status}`,
            plan,
            baseUrl,
          }, { headers: corsHeaders });
        }

        return Response.json({
          success: true,
          plan,
          baseUrl,
          usage: usageJson,
          message: plan === 'free'
            ? 'Connected to WalletWallet Free Tier (1,000 passes/month, colorPreset & standard fields).'
            : 'Connected to WalletWallet Pro Tier ($39/mo, custom hex, strip artwork, live push).',
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // FRONTEND STATIC ASSETS & SPA ROUTING (Cloudflare Workers Assets)
    // =========================================================================
    if (env.ASSETS) {
      let assetResponse = await env.ASSETS.fetch(request);
      // SPA Fallback: If asset was not found and request is not an /api/ endpoint or static asset file (.js, .css, .ico, etc.)
      if (assetResponse.status === 404 && !pathname.startsWith('/api/') && !pathname.includes('.')) {
        const indexUrl = new URL('/index.html', request.url);
        const indexRequest = new Request(indexUrl.toString(), request);
        const spaResponse = await env.ASSETS.fetch(indexRequest);
        if (spaResponse.status < 400) {
          return spaResponse;
        }
      } else if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response('Not found', { status: 404 });
  },

  // Background pass issuance; persist provider package before email and acknowledgement.
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { runner_id, payload } = message.body;
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
        if (!runner || !pass || pass.status === 'revoked') { message.ack(); continue; }
        if (pass.status !== 'issued' || !pass.r2_key) {
          const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
          const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;
          if (pass.apple_pass_base64) {
            await ensureStoredPass(env, pass);
          } else {
            const result = await createWalletWalletPass({
              env,
              apiKey: env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '',
              baseUrl: env.WALLETWALLET_API_URL || 'https://api.walletwallet.dev',
              plan: ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro',
              fieldMapping: race?.field_mapping,
          raceName: race?.name || 'Athletic Event', runner, template,
            });
            if (!result.success) throw new Error(result.error || 'Pass issuance failed');
            await env.DB.prepare(`UPDATE Passes SET walletwallet_pass_id = ?, google_save_url = ?,
              share_url = ?, apple_pass_base64 = ?, r2_key = ? WHERE runner_id = ?`)
              .bind(result.serialNumber, result.googleSaveUrl || null, result.shareUrl || null,
                result.applePass, result.r2Key, runner_id).run();
          }
          await env.DB.prepare("UPDATE Passes SET status = 'issued', updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?")
            .bind(runner_id).run();
        }
        if (payload?.email) {
          const emailResult = await sendPassEmail({ env, to: payload.email,
            firstName: payload.first_name || 'Participant', runnerId: runner_id });
          if (!emailResult.success) throw new Error('Pass email delivery failed');
        }

        message.ack();
      } catch (err) {
        message.retry();
      }
    }
  },
};
