import { generatePkpassBundle } from '../server/walletService.ts';

export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
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

// Derive WalletWallet colorPreset for Free Tier (Non-Pro) from hex or preset name
function deriveColorPreset(hexOrPreset?: string): 'dark' | 'blue' | 'green' | 'red' | 'purple' | 'orange' {
  if (!hexOrPreset) return 'dark';
  const val = hexOrPreset.toLowerCase().trim();
  if (['dark', 'blue', 'green', 'red', 'purple', 'orange'].includes(val)) {
    return val as any;
  }
  if (!val.startsWith('#')) return 'dark';
  const hex = val.replace('#', '');
  if (hex.length !== 6 && hex.length !== 3) return 'dark';
  const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
  const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
  const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);

  if (g > 100 && g > r * 1.2 && g > b * 1.1) return 'green';
  if (b > 120 && b > r * 1.1 && b > g) return 'blue';
  if (r > 120 && r > g * 1.5 && r > b * 1.5) return 'red';
  if (r > 100 && b > 100 && g < Math.min(r, b) * 0.8) return 'purple';
  if (r > 150 && g > 80 && g < r && b < 60) return 'orange';
  return 'dark';
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

// Call WalletWallet API (https://www.walletwallet.dev/docs)
// Supports Free tier (up to 1,000 passes/mo, no credit card required) & Pro tier
async function createWalletWalletPass(options: {
  apiKey: string;
  baseUrl: string;
  plan: 'free' | 'pro';
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
  };
}): Promise<{
  success: boolean;
  serialNumber?: string;
  googleSaveUrl?: string;
  applePass?: string;
  shareUrl?: string;
  error?: string;
  tierUsed: 'free' | 'pro';
}> {
  const { apiKey, baseUrl, plan, raceName, orgName, runner, template } = options;
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'WALLETWALLET_API_KEY not configured', tierUsed: plan };
  }

  let dyn: Record<string, any> = {};
  if (typeof runner.dynamic_data === 'string') {
    try { dyn = JSON.parse(runner.dynamic_data); } catch { dyn = {}; }
  } else if (runner.dynamic_data && typeof runner.dynamic_data === 'object') {
    dyn = runner.dynamic_data;
  }

  const bibNumber = String(dyn.bib || dyn.bib_number || runner.id.replace('run-', '').slice(0, 8).toUpperCase());
  const division = String(dyn.category || dyn.division || dyn.race_division || 'General');
  const wave = String(dyn.wave || dyn.start_wave || 'Open');
  const emergency = String(dyn.emergency_contact || 'None listed');

  let tplSchema: any = {};
  if (template?.schema_definition) {
    try { tplSchema = JSON.parse(template.schema_definition); } catch {}
  }

  const baseEndpoint = normalizeWalletWalletUrl(baseUrl);
  const chosenColorPreset = tplSchema.colorPreset || deriveColorPreset(template?.background_color) || 'dark';

  // Common fields (accepted in ALL tiers, strictly per walletwallet.dev docs)
  const body: any = {
    barcodeValue: bibNumber,
    barcodeFormat: tplSchema.barcodeFormat || 'QR',
    barcodeAltText: tplSchema.barcodeAltText
      ? tplSchema.barcodeAltText.replace('{{bib}}', bibNumber)
      : `BIB #${bibNumber}`,
    logoText: (tplSchema.logoText || raceName || 'Athletic Pass').slice(0, 64),
    description: (tplSchema.description || `${raceName} Participant Pass`).slice(0, 128),
    organizationName: (tplSchema.organizationName || orgName || '3F Striders').slice(0, 64),
    sharingProhibited: tplSchema.sharingProhibited !== undefined ? Boolean(tplSchema.sharingProhibited) : false,
    colorPreset: chosenColorPreset,
    primaryFields: [
      { label: tplSchema.primaryFields?.[0]?.label || 'BIB NUMBER', value: bibNumber },
    ],
    secondaryFields: [
      { label: tplSchema.secondaryFields?.[0]?.label || 'PARTICIPANT', value: `${runner.first_name} ${runner.last_name}`.slice(0, 64) },
      { label: tplSchema.secondaryFields?.[1]?.label || 'DIVISION', value: division.slice(0, 64) },
    ],
    headerFields: [
      { label: tplSchema.headerFields?.[0]?.label || 'WAVE', value: wave.slice(0, 64) },
    ],
    backFields: (tplSchema.backFields && Array.isArray(tplSchema.backFields) && tplSchema.backFields.length > 0)
      ? tplSchema.backFields.map((f: any) => ({
          label: f.label || 'Information',
          value: f.value || (f.key === 'email' ? runner.email : f.key === 'emergency_contact' ? emergency : 'Present pass at check-in.'),
        }))
      : [
          { label: 'Emergency Contact', value: emergency.slice(0, 256) },
          { label: 'Runner Email', value: runner.email.slice(0, 128) },
          { label: 'Official Rules', value: 'Present QR at start chute check-in and finish village medal chute.' },
        ],
  };

  if (plan === 'pro' && template?.background_color && template.background_color.startsWith('#')) {
    body.color = template.background_color;
  }

  const cleanApiKey = apiKey.trim().replace(/^Bearer\s+/i, '');

  try {
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
      // If failed on Pro plan with validation, retry once on Free tier format
      if (plan === 'pro') {
        const fallbackBody = { ...body };
        delete fallbackBody.color;
        delete fallbackBody.logoURL;
        delete fallbackBody.stripURL;
        fallbackBody.colorPreset = deriveColorPreset(template?.background_color);

        const retry = await fetch(`${baseEndpoint}/api/passes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cleanApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fallbackBody),
        });
        const retryJson: any = await retry.json().catch(() => ({}));
        if (retry.ok && retryJson.serialNumber) {
          return {
            success: true,
            serialNumber: retryJson.serialNumber,
            googleSaveUrl: retryJson.googleSaveUrl,
            applePass: retryJson.applePass,
            shareUrl: retryJson.shareUrl,
            tierUsed: 'free',
          };
        }
      }

      return {
        success: false,
        error: resJson.error || resJson.message || `WalletWallet returned HTTP ${res.status}`,
        tierUsed: plan,
      };
    }

    return {
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
  googleSaveUrl?: string;
  shareUrl?: string;
}): Promise<{ success: boolean; error?: string; resendId?: string; hint?: string; passUrl?: string }> {
  const { env, to, firstName, runnerId, raceName, requestOrigin, googleSaveUrl, shareUrl } = options;

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

  const passUrl = `${publicDomain}/pass/${runnerId}`;
  const eventTitle = raceName || 'Official Athletic Event';

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
          <p style="margin: 0 0 16px; font-size: 15px; color: #f1f5f9;">Hello <strong>${firstName}</strong>,</p>
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

    // --- API ROUTES ---

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
        const schemaStr = typeof schema_definition === 'string' ? schema_definition : JSON.stringify(schema_definition || {});

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

        const schemaStr = typeof schema_definition === 'string' ? schema_definition : JSON.stringify(schema_definition || {});

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
        const passStatus = issue_immediate !== false ? 'issued' : 'pending';

        await env.DB.prepare(`
          INSERT INTO Runners (id, race_id, email, first_name, last_name, dynamic_data)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(runnerId, race_id, email, first_name, last_name, dynStr).run();

        // Retrieve Race, Template, and Organization
        const raceDetails = await env.DB.prepare(`
          SELECT r.*, t.background_color, t.text_color, t.label_color, t.logo_image_url, t.strip_image_url, o.name as org_name
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
        let finalWwPassId = `ww_${runnerId}`;
        let googleSaveUrl: string | null = null;
        let shareUrl: string | null = null;
        let applePassBase64: string | null = null;

        if (walletwalletApiKey) {
          wwResult = await createWalletWalletPass({
            apiKey: walletwalletApiKey,
            baseUrl: walletwalletApiUrl,
            plan: walletwalletPlan,
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
              background_color: raceDetails.background_color,
              text_color: raceDetails.text_color,
              label_color: raceDetails.label_color,
              logo_image_url: raceDetails.logo_image_url,
              strip_image_url: raceDetails.strip_image_url,
            } : undefined,
          });

          if (wwResult.success && wwResult.serialNumber) {
            finalWwPassId = wwResult.serialNumber;
            googleSaveUrl = wwResult.googleSaveUrl || null;
            shareUrl = wwResult.shareUrl || null;
            applePassBase64 = wwResult.applePass || null;
          }
        }

        await env.DB.prepare(`
          INSERT INTO Passes (id, runner_id, walletwallet_pass_id, google_save_url, share_url, apple_pass_base64, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(passId, runnerId, finalWwPassId, googleSaveUrl, shareUrl, applePassBase64, passStatus).run();

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
            googleSaveUrl: googleSaveUrl || undefined,
            shareUrl: shareUrl || undefined,
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
          googleSaveUrl: pass?.google_save_url || undefined,
          shareUrl: pass?.share_url || undefined,
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
    // DYNAMIC PASS PROXY (Streams .pkpass)
    // =========================================================================
    if (pathname.startsWith('/api/pass/download/')) {
      const runnerId = pathname.replace('/api/pass/download/', '');
      try {
        const passRecord = await env.DB.prepare(
          'SELECT * FROM Passes WHERE runner_id = ?'
        ).bind(runnerId).first<any>();

        if (!passRecord) {
          return Response.json({ success: false, error: 'Pass not found' }, { status: 404, headers: corsHeaders });
        }

        if (passRecord.status === 'revoked') {
          return Response.json({ success: false, error: 'This pass has been revoked' }, { status: 410, headers: corsHeaders });
        }

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        const race = runner ? await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>() : null;
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;

        if (!runner || !race || !template) {
          return Response.json({ success: false, error: 'Participant or race record not found' }, { status: 404, headers: corsHeaders });
        }

        // Update installed_apple flag in D1
        ctx.waitUntil(
          env.DB.prepare('UPDATE Passes SET installed_apple = 1, updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?')
            .bind(runnerId)
            .run()
        );

        let bibNumber = 'pass';
        try {
          const dyn = JSON.parse(runner.dynamic_data || '{}');
          bibNumber = dyn.bib_number || dyn.bib || 'pass';
        } catch {}

        // If Apple pass binary is not yet generated, attempt on-the-fly provision via WalletWallet
        if (!passRecord.apple_pass_base64) {
          const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
          if (walletwalletApiKey) {
            try {
              const rawUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
              const plan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';
              const wwRes = await createWalletWalletPass({
                apiKey: walletwalletApiKey,
                baseUrl: rawUrl,
                plan,
                raceName: race?.name || 'Athletic Event',
                orgName: race?.org_name || 'Pacific Athletic Series',
                runner,
                template: template || undefined,
              });

              if (wwRes.success && wwRes.applePass) {
                passRecord.apple_pass_base64 = wwRes.applePass;
                passRecord.walletwallet_pass_id = wwRes.serialNumber;
                passRecord.google_save_url = wwRes.googleSaveUrl || passRecord.google_save_url;

                ctx.waitUntil(
                  env.DB.prepare(`
                    UPDATE Passes 
                    SET walletwallet_pass_id = ?, google_save_url = ?, apple_pass_base64 = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE runner_id = ?
                  `).bind(wwRes.serialNumber, wwRes.googleSaveUrl || null, wwRes.applePass, runnerId).run()
                );
              }
            } catch (syncErr) {
              console.error('On-the-fly WalletWallet provision error:', syncErr);
            }
          }
        }

        // If signed .pkpass binary was returned from WalletWallet API
        if (passRecord.apple_pass_base64) {
          const binaryString = atob(passRecord.apple_pass_base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Response(bytes, {
            headers: {
              'Content-Type': 'application/vnd.apple.pkpass',
              'Content-Disposition': `inline; filename="pass_${bibNumber}.pkpass"`,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              ...corsHeaders,
            },
          });
        }

        // Fallback: Generate local .pkpass bundle at edge
        const buffer = await generatePkpassBundle({
          runner,
          race,
          template,
          pass: passRecord as any,
        });

        return new Response(new Uint8Array(buffer), {
          headers: {
            'Content-Type': 'application/vnd.apple.pkpass',
            'Content-Disposition': `inline; filename="pass_${bibNumber}.pkpass"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            ...corsHeaders,
          },
        });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // LIVE PASS UPDATES (PUT /api/runner/update)
    // =========================================================================
    if (pathname === '/api/runner/update' && request.method === 'PUT') {
      try {
        const body: any = await request.json();
        const { runner_id, first_name, last_name, email, dynamic_data } = body;
        if (!runner_id) return Response.json({ success: false, error: 'runner_id required' }, { status: 400, headers: corsHeaders });

        const dynamicStr = typeof dynamic_data === 'string' ? dynamic_data : JSON.stringify(dynamic_data || {});
        await env.DB.prepare(`
          UPDATE Runners 
          SET first_name = COALESCE(?, first_name),
              last_name = COALESCE(?, last_name),
              email = COALESCE(?, email),
              dynamic_data = COALESCE(?, dynamic_data)
          WHERE id = ?
        `).bind(first_name || null, last_name || null, email || null, dynamicStr, runner_id).run();

        // Forward to walletwallet.dev if API Key configured AND Pro plan active
        const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
        const walletwalletApiUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
        const walletwalletPlan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';

        if (walletwalletApiKey && walletwalletPlan === 'pro') {
          const pass = await env.DB.prepare('SELECT walletwallet_pass_id FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
          if (pass?.walletwallet_pass_id && !pass.walletwallet_pass_id.startsWith('ww_run-')) {
            ctx.waitUntil(
              fetch(`${normalizeWalletWalletUrl(walletwalletApiUrl)}/api/passes/${pass.walletwallet_pass_id}`, {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${walletwalletApiKey.trim()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fields: dynamic_data, first_name, last_name }),
              }).catch(() => {})
            );
          }
        }

        const updated = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        return Response.json({
          success: true,
          data: { runner: updated },
          plan_note: walletwalletPlan === 'free' ? 'Edge D1 updated. (WalletWallet live push updates require Pro tier per docs).' : 'Edge D1 & WalletWallet updated.',
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
          success: true,
          message: emailResult.success
            ? `Pass delivery email dispatched to ${runner.email}`
            : `Found pass, but email delivery error: ${emailResult.error}`,
          data: {
            runner_id: runner.id,
            email: runner.email,
            pass_url: `/pass/${runner.id}`,
            email_delivery: emailResult,
          },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // =========================================================================
    // PASS DETAILS FOR RUNNER SSR/LANDING (GET /api/pass/details/:id)
    // =========================================================================
    if (pathname.startsWith('/api/pass/details/')) {
      const runnerId = pathname.replace('/api/pass/details/', '');
      try {
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });

        let pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;

        // Auto-provision or upgrade to official WalletWallet pass if key is configured and pass lacks Google/Apple URLs
        if (pass && (!pass.google_save_url || !pass.apple_pass_base64)) {
          const walletwalletApiKey = env.WALLETWALLET_API_KEY || (await getSystemSetting(env, 'walletwalletApiKey')) || '';
          if (walletwalletApiKey) {
            const rawUrl = env.WALLETWALLET_API_URL || (await getSystemSetting(env, 'walletwalletApiUrl')) || 'https://api.walletwallet.dev';
            const plan = ((await getSystemSetting(env, 'walletwalletPlan')) || env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro';
            const wwRes = await createWalletWalletPass({
              apiKey: walletwalletApiKey,
              baseUrl: rawUrl,
              plan,
              raceName: race?.name || 'Athletic Event',
              orgName: race?.org_name || 'Pacific Athletic Series',
              runner,
              template: template || undefined,
            });

            if (wwRes.success && wwRes.serialNumber) {
              await env.DB.prepare(`
                UPDATE Passes 
                SET walletwallet_pass_id = ?, google_save_url = ?, share_url = ?, apple_pass_base64 = ?, updated_at = CURRENT_TIMESTAMP
                WHERE runner_id = ?
              `).bind(wwRes.serialNumber, wwRes.googleSaveUrl || null, wwRes.shareUrl || null, wwRes.applePass || null, runnerId).run();
              pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
            }
          }
        }

        return Response.json({
          success: true,
          data: { runner, pass, race, template },
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
          apiKey: walletwalletApiKey,
          baseUrl: rawUrl,
          plan,
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
          SET walletwallet_pass_id = ?, google_save_url = ?, share_url = ?, apple_pass_base64 = ?, updated_at = CURRENT_TIMESTAMP
          WHERE runner_id = ?
        `).bind(wwRes.serialNumber, wwRes.googleSaveUrl || null, wwRes.shareUrl || null, wwRes.applePass || null, runnerId).run();

        const updatedPass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        return Response.json({
          success: true,
          pass: updatedPass,
          googleSaveUrl: wwRes.googleSaveUrl,
          shareUrl: wwRes.shareUrl,
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

    // Resilience Edge Fallback for /pass/:id (renders full standalone HTML if assets bundle is missing)
    if (pathname.startsWith('/pass/')) {
      const runnerId = pathname.replace('/pass/', '').split('?')[0].split('#')[0];
      try {
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        if (runner) {
          const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
          const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
          const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;
          
          let dyn: Record<string, any> = {};
          try { dyn = JSON.parse(runner.dynamic_data || '{}'); } catch {}
          const bib = dyn.bib_number || dyn.bib || runner.id.replace('run-', '').slice(0, 8).toUpperCase();
          const wave = dyn.start_wave || dyn.wave || 'Open Wave';
          const division = dyn.race_division || dyn.category || 'Standard';

          let tplSchema: any = {};
          if (template?.schema_definition) {
            try { tplSchema = JSON.parse(template.schema_definition); } catch {}
          }

          const preset = tplSchema.colorPreset || deriveColorPreset(template?.background_color) || 'dark';
          const presetBgMap: Record<string, string> = {
            dark: '#18181b',
            blue: '#1e3a8a',
            green: '#064e3b',
            red: '#881337',
            purple: '#581c87',
            orange: '#7c2d12',
          };
          const bgHex = presetBgMap[preset] || '#18181b';
          const orgTitle = tplSchema.organizationName || '3F Striders';
          const passTitle = tplSchema.logoText || race?.name || 'Athletic Event';

          const ua = request.headers.get('user-agent') || '';
          const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && ua.includes('Mobile'));
          const isAndroid = /Android/i.test(ua);

          let actionButtonsHtml = '';
          const appleButton = `<a href="/api/pass/download/${runnerId}" class="btn-apple">
            <svg viewBox="0 0 170 170" width="18" height="18" fill="currentColor" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.74 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.66-7.86-11.91-14.46-5.74-9.01-10.23-19.34-13.48-30.98-3.26-11.64-4.89-22.95-4.89-33.93 0-16.14 4.35-29.49 13.04-40.06 8.69-10.58 19.53-15.98 32.51-16.23 4.93 0 10.42 1.34 16.47 4.02 6.05 2.68 9.97 4.09 11.75 4.22 1.57-.13 5.74-1.61 12.51-4.43 6.77-2.82 12.44-4.08 17.02-3.79 12.73.65 23.01 5.34 30.82 14.07-11.22 6.74-16.71 16.4-16.47 28.98.24 9.94 4.09 18.23 11.55 24.87 7.46 6.64 16.46 10.32 27.01 11.03-2.24 6.84-4.99 14.08-8.26 21.72zM119.22 31.84c0-7.39 2.65-14.28 7.95-20.67 5.3-6.39 11.95-10.45 19.95-12.17.65 1.52.98 3.14.98 4.86 0 7.39-2.73 14.41-8.19 21.06-5.46 6.65-12.16 10.6-20.09 11.85-.43-1.63-.6-3.27-.6-4.93z"/></svg>
            Add to Apple Wallet
          </a>`;

          const googleButton = pass?.google_save_url
            ? `<a href="${pass.google_save_url}" target="_blank" class="btn-google">
                <svg viewBox="0 0 24 24" width="18" height="18" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
                Save to Google Wallet
               </a>`
            : '';

          if (isIOS) {
            actionButtonsHtml = `
              <div style="font-size: 11px; color: #38bdf8; margin-bottom: 8px; text-align: center; font-weight: 600;">📱 Apple Device Detected</div>
              ${appleButton}
              ${googleButton ? `<div style="text-align: center; margin-top: 6px;"><a href="${pass.google_save_url}" target="_blank" style="color: #94a3b8; font-size: 12px; text-decoration: underline;">Save to Google Wallet instead →</a></div>` : ''}
            `;
          } else if (isAndroid) {
            actionButtonsHtml = `
              <div style="font-size: 11px; color: #34d399; margin-bottom: 8px; text-align: center; font-weight: 600;">🤖 Android Device Detected</div>
              ${googleButton || appleButton}
              ${googleButton ? `<div style="text-align: center; margin-top: 6px;"><a href="/api/pass/download/${runnerId}" style="color: #94a3b8; font-size: 12px; text-decoration: underline;">Download Apple Wallet (.pkpass) instead →</a></div>` : ''}
            `;
          } else {
            // Desktop: Show both buttons + Scan with phone QR code
            const currentPassUrl = `${url.origin}/pass/${runnerId}`;
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(currentPassUrl)}`;
            actionButtonsHtml = `
              ${appleButton}
              ${googleButton}
              <div style="margin-top: 16px; padding: 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; text-align: center;">
                <div style="font-size: 12px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">📲 Install to Phone via Camera</div>
                <div style="font-size: 11px; color: #94a3b8; margin-bottom: 10px;">Scan with your iPhone or Android to add this pass:</div>
                <img src="${qrCodeUrl}" alt="Scan QR Code" style="width: 140px; height: 140px; background: #ffffff; border-radius: 12px; padding: 6px; display: inline-block;" />
              </div>
            `;
          }

          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${passTitle} - Official Participant Pass</title>
  <style>
    body { margin: 0; background-color: #09090b; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px 16px; box-sizing: border-box; }
    .card { width: 100%; max-width: 360px; background-color: ${bgHex}; border-radius: 26px; padding: 22px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); box-sizing: border-box; }
    .btn-apple { display: flex; align-items: center; justify-content: center; width: 100%; padding: 14px 16px; background-color: #000000; border: 1px solid rgba(255,255,255,0.2); color: #ffffff; font-weight: 700; font-size: 14px; border-radius: 16px; text-decoration: none; margin-bottom: 10px; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .btn-google { display: flex; align-items: center; justify-content: center; width: 100%; padding: 14px 16px; background-color: #18181b; border: 1px solid #3f3f46; color: #ffffff; font-weight: 700; font-size: 14px; border-radius: 16px; text-decoration: none; margin-bottom: 10px; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .badge { display: inline-block; font-size: 10px; font-family: monospace; text-transform: uppercase; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px; margin-bottom: 16px;">
      <div>
        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: 700;">${orgTitle}</div>
        <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin-top: 2px;">${passTitle}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">Wave</div>
        <div style="font-size: 12px; font-weight: 700; color: #ffffff;">${wave}</div>
      </div>
    </div>

    <div style="text-align: center; padding: 12px 0 20px;">
      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; font-weight: 800;">BIB NUMBER</div>
      <div style="font-size: 52px; font-weight: 900; font-family: monospace; color: #ffffff; line-height: 1; margin: 6px 0;">${bib}</div>
      <div class="badge">Official Digital Pass</div>
    </div>

    <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 14px; margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Participant</span>
        <span style="font-size: 13px; font-weight: 600; color: #ffffff;">${runner.first_name} ${runner.last_name}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Division</span>
        <span style="font-size: 13px; font-weight: 600; color: #ffffff;">${division}</span>
      </div>
    </div>

    ${actionButtonsHtml}
  </div>
</body>
</html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      } catch (err) {}
    }

    return new Response('Cloudflare Worker Pass API Gateway Active.', { status: 200 });
  },

  // ---------------------------------------------------------------------------
  // 2. Queue Consumer Handler: Background Worker for PASS_QUEUE
  // ---------------------------------------------------------------------------
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { runner_id, payload } = message.body;
        // Update pass status from 'pending' to 'issued' in D1
        await env.DB.prepare(`
          UPDATE Passes 
          SET status = 'issued', updated_at = CURRENT_TIMESTAMP
          WHERE runner_id = ?
        `).bind(runner_id).run();

        // Resend transactional email dispatch
        if (payload?.email) {
          await sendPassEmail({
            env,
            to: payload.email,
            firstName: payload.first_name || 'Participant',
            runnerId: runner_id,
          });
        }

        message.ack();
      } catch (err) {
        message.retry();
      }
    }
  },
};
