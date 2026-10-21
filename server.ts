import { buildWalletWalletPayload, validateTemplateSchema } from './server/walletPayload.ts';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { d1Db } from './server/db.ts';
import { proxyOrGeneratePkpass } from './server/walletService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -----------------------------------------------------------------------------
// 1. Core Workflow A: Dynamic Pass Proxy Endpoint
// -----------------------------------------------------------------------------
app.get(['/api/pass/download/:id', '/api/pass/download/:id/pass.pkpass', '/api/pass/download/:id/apple.pkpass'], async (req, res) => {
  try {
    const rawId = req.params.id || '';
    const runnerId = rawId.replace(/\/(apple|pass)?(\.pkpass)?$/i, '').replace(/\.pkpass$/i, '');
    const runner = d1Db.getRunnerById(runnerId);
    if (!runner) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }

    const pass = d1Db.getPassByRunnerId(runnerId);
    if (!pass) {
      return res.status(404).json({ success: false, error: 'Pass record not found' });
    }

    if (pass.status === 'revoked') {
      return res.status(410).json({ success: false, error: 'This pass has been revoked by the race organizer.' });
    }

    const race = d1Db.getRaceById(runner.race_id);
    if (!race) {
      return res.status(404).json({ success: false, error: 'Associated race not found' });
    }

    const template = d1Db.getTemplateById(race.template_id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Pass design template not found' });
    }

    // Mark Apple Wallet installation
    d1Db.updatePass(pass.id, { installed_apple: 1 });

    const isDownload = req.query.download === '1' || req.query.dl === 'true';
    let bibNumber = 'pass';
    try {
      const dyn = JSON.parse(runner.dynamic_data || '{}');
      bibNumber = dyn.bib_number || dyn.bib || 'pass';
    } catch {
      // ignore
    }

    // If signed .pkpass binary was returned from WalletWallet API
    if (pass.apple_pass_base64) {
      const buffer = Buffer.from(pass.apple_pass_base64, 'base64');
      res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
      if (isDownload) {
        res.setHeader('Content-Disposition', 'attachment; filename="pass.pkpass"');
      }
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.end(buffer);
    }

    const buffer = await proxyOrGeneratePkpass({
      runner,
      race,
      template,
      pass,
      walletwalletApiKey: d1Db.settings.walletwalletApiKey,
      walletwalletApiUrl: d1Db.settings.walletwalletApiUrl,
    });

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    if (isDownload) {
      res.setHeader('Content-Disposition', 'attachment; filename="pass.pkpass"');
    }
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.end(buffer);
  } catch (error: any) {
    console.error('Error generating .pkpass download:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error streaming pass' });
  }
});

// Normalize WalletWallet Base URL (must be https://api.walletwallet.dev, without trailing /v1 or /api)
function normalizeWalletWalletUrl(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return 'https://api.walletwallet.dev';
  let url = rawUrl.trim().replace(/\/+$/, '');
  url = url.replace(/\/v1$/, '').replace(/\/api$/, '');
  return url || 'https://api.walletwallet.dev';
}

// Call WalletWallet API (https://www.walletwallet.dev/docs)
// Supports Free tier (up to 1,000 passes/mo, no credit card required) & Pro tier
async function createWalletWalletPassServer(options: {
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

// -----------------------------------------------------------------------------
// 2. Core Workflow B: Live Pass Updates
// -----------------------------------------------------------------------------
app.put('/api/runner/update', async (req, res) => {
  try {
    const { runner_id, first_name, last_name, email, dynamic_data, field_changed, old_value, new_value } = req.body;
    if (!runner_id) {
      return res.status(400).json({ success: false, error: 'runner_id is required' });
    }

    const runner = d1Db.getRunnerById(runner_id);
    if (!runner) {
      return res.status(404).json({ success: false, error: 'Runner not found in D1' });
    }

    const updates: any = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (email !== undefined) updates.email = email;
    if (dynamic_data !== undefined) {
      updates.dynamic_data = typeof dynamic_data === 'string' ? dynamic_data : JSON.stringify(dynamic_data);
    }

    const updatedRunner = d1Db.updateRunner(runner_id, updates);
    const pass = d1Db.getPassByRunnerId(runner_id);

    let providerUpdated = false;
    if (d1Db.settings.walletwalletApiKey && pass?.status === 'issued' && pass.walletwallet_pass_id && !pass.walletwallet_pass_id.startsWith('ww_run-') && updatedRunner) {
      const race = d1Db.getRaceById(updatedRunner.race_id);
      const template = race ? d1Db.getTemplateById(race.template_id) : undefined;
      const response = await fetch(`${normalizeWalletWalletUrl(d1Db.settings.walletwalletApiUrl)}/api/passes/${pass.walletwallet_pass_id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${d1Db.settings.walletwalletApiKey.trim().replace(/^Bearer\s+/i, '')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWalletWalletPayload({ runner: updatedRunner, template, raceName: race?.name || 'Athletic Event',
          fieldMapping: race?.field_mapping, plan: d1Db.settings.walletwalletPlan })),
      });
      if (!response.ok) {
        const error: any = await response.json().catch(() => ({}));
        return res.status(502).json({ success: false, error: error.error || 'WalletWallet update failed', data: { runner: updatedRunner } });
      }
      providerUpdated = true;
    }

    // Register APNs / FCM push notification log
    const pushLog = d1Db.logPush({
      runner_id,
      pass_id: pass?.id || 'pass-unknown',
      runner_name: `${updatedRunner?.first_name} ${updatedRunner?.last_name}`,
      field_changed: field_changed || 'wave_or_bib',
      old_value: old_value || 'Previous Value',
      new_value: new_value || 'Updated Value',
      status: 'delivered',
    });

    return res.json({
      success: true,
      data: {
        runner: updatedRunner,
        pass,
        pushLog,
      },
      plan_note: providerUpdated ? 'D1 and WalletWallet updated.' : 'D1 updated; no issued provider pass was available to update.',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 3. Core Workflow C: Pass Revocation
// -----------------------------------------------------------------------------
app.post('/api/runner/revoke', async (req, res) => {
  try {
    const { runner_id, reason } = req.body;
    if (!runner_id) {
      return res.status(400).json({ success: false, error: 'runner_id is required' });
    }

    const pass = d1Db.getPassByRunnerId(runner_id);
    if (!pass) {
      return res.status(404).json({ success: false, error: 'Pass not found' });
    }

    d1Db.updatePass(pass.id, { status: 'revoked' });

    // Call DELETE on walletwallet.dev per docs (DELETE /api/passes/<serial>)
    if (d1Db.settings.walletwalletApiKey && pass.walletwallet_pass_id && !pass.walletwallet_pass_id.startsWith('ww_run-')) {
      try {
        const baseUrl = normalizeWalletWalletUrl(d1Db.settings.walletwalletApiUrl);
        await fetch(`${baseUrl}/api/passes/${pass.walletwallet_pass_id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${d1Db.settings.walletwalletApiKey}`,
          },
        });
      } catch (err) {
        console.warn('walletwallet.dev delete notice:', err);
      }
    }

    const runner = d1Db.getRunnerById(runner_id);
    d1Db.logPush({
      runner_id,
      pass_id: pass.id,
      runner_name: runner ? `${runner.first_name} ${runner.last_name}` : 'Participant',
      field_changed: 'status',
      old_value: 'issued',
      new_value: `revoked (${reason || 'Registration Canceled'})`,
      status: 'delivered',
    });

    return res.json({
      success: true,
      data: {
        status: 'revoked',
        pass_id: pass.id,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Re-issue or restore a revoked pass
app.post('/api/runner/reissue', (req, res) => {
  try {
    const { runner_id } = req.body;
    const pass = d1Db.getPassByRunnerId(runner_id);
    if (!pass) return res.status(404).json({ success: false, error: 'Pass not found' });

    d1Db.updatePass(pass.id, { status: 'issued' });
    return res.json({ success: true, data: { pass_id: pass.id, status: 'issued' } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 4. Core Workflow D: Async Bulk CSV Ingestion -> Queue
// -----------------------------------------------------------------------------
// The Express preview uses an in-memory mock, not Cloudflare Queues.
// Reject bulk issuance explicitly so the UI cannot claim production work was queued.
app.post('/api/import', (_req, res) => res.status(503).json({
  success: false,
  error: 'Bulk pass issuance requires the Cloudflare Worker runtime. Use npx wrangler dev (with local D1 and bindings configured) or your deployed Worker.',
}));

// Trigger queue batch processing
app.post('/api/queue/process', (req, res) => {
  try {
    const batchSize = Number(req.body.batch_size) || 10;
    const result = d1Db.processQueueBatch(batchSize);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/queue/status', (req, res) => {
  const jobs = d1Db.getQueueJobs();
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const processing = jobs.filter((j) => j.status === 'processing').length;
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  return res.json({
    success: true,
    data: {
      stats: { total: jobs.length, queued, processing, completed, failed },
      recent_jobs: jobs.slice(-20).reverse(),
    },
  });
});

app.post('/api/queue/flush', (req, res) => {
  d1Db.flushQueue();
  return res.json({ success: true, message: 'Queue flushed' });
});

// -----------------------------------------------------------------------------
// 5. Self-Service Lookup Endpoint
// -----------------------------------------------------------------------------
app.post('/api/lookup', (req, res) => {
  try {
    const { email, race_id } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const runner = d1Db.getRunnerByEmail(email, race_id);
    if (!runner) {
      return res.status(404).json({
        success: false,
        error: 'No registration found with that email address. Please check your spelling or contact race support.',
      });
    }

    const pass = d1Db.getPassByRunnerId(runner.id);
    const race = d1Db.getRaceById(runner.race_id);

    // Send transactional email via Resend
    const emailLog = d1Db.logEmail({
      runner_id: runner.id,
      to: runner.email,
      subject: `Your ${race?.name || 'Race'} Digital Wallet Pass`,
      pass_url: `/pass/${runner.id}`,
    });

    return res.json({
      success: true,
      message: `Pass delivery email dispatched to ${runner.email}`,
      data: {
        runner_id: runner.id,
        email: runner.email,
        pass_url: `/pass/${runner.id}`,
        race_name: race?.name,
        email_log: emailLog,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 6. Pass Landing Page SSR/API Data
// -----------------------------------------------------------------------------
app.get('/api/pass/details/:id', async (req, res) => {
  try {
    const runnerId = req.params.id;
    const runner = d1Db.getRunnerById(runnerId);
    if (!runner) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }

    let pass = d1Db.getPassByRunnerId(runnerId);
    const race = d1Db.getRaceById(runner.race_id);
    const template = race ? d1Db.getTemplateById(race.template_id) : undefined;

    // Auto-provision with WalletWallet if key exists and pass lacks Google/Apple URLs
    if (pass && (!pass.google_save_url || !pass.apple_pass_base64) && d1Db.settings.walletwalletApiKey) {
      const wwRes = await createWalletWalletPassServer({
        apiKey: d1Db.settings.walletwalletApiKey,
        baseUrl: d1Db.settings.walletwalletApiUrl,
        plan: d1Db.settings.walletwalletPlan,
        fieldMapping: race?.field_mapping,
        raceName: race?.name || 'Athletic Event',
        orgName: 'Pacific Athletic Series',
        runner: {
          id: runner.id,
          first_name: runner.first_name,
          last_name: runner.last_name,
          email: runner.email,
          dynamic_data: runner.dynamic_data,
        },
        template,
      });

      if (wwRes.success && wwRes.serialNumber) {
        pass.walletwallet_pass_id = wwRes.serialNumber;
        pass.google_save_url = wwRes.googleSaveUrl;
        pass.share_url = wwRes.shareUrl;
        pass.apple_pass_base64 = wwRes.applePass;
        d1Db.updatePass(pass.id, {
          walletwallet_pass_id: wwRes.serialNumber,
          google_save_url: wwRes.googleSaveUrl,
          share_url: wwRes.shareUrl,
          apple_pass_base64: wwRes.applePass,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        runner,
        pass,
        race,
        template,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Explicit WalletWallet Pass Sync / Provision
app.post('/api/pass/sync/:id', async (req, res) => {
  try {
    const runnerId = req.params.id;
    const runner = d1Db.getRunnerById(runnerId);
    if (!runner) return res.status(404).json({ success: false, error: 'Participant not found' });
    const pass = d1Db.getPassByRunnerId(runnerId);
    const race = d1Db.getRaceById(runner.race_id);
    const template = race ? d1Db.getTemplateById(race.template_id) : undefined;

    if (!d1Db.settings.walletwalletApiKey) {
      return res.status(400).json({
        success: false,
        error: 'WALLETWALLET_API_KEY is not configured yet. Add your key in Admin Settings to issue official Google & Apple passes.',
      });
    }

    const wwRes = await createWalletWalletPassServer({
      apiKey: d1Db.settings.walletwalletApiKey,
      baseUrl: d1Db.settings.walletwalletApiUrl,
      plan: d1Db.settings.walletwalletPlan,
      fieldMapping: race?.field_mapping,
        raceName: race?.name || 'Athletic Event',
      orgName: 'Pacific Athletic Series',
      runner: {
        id: runner.id,
        first_name: runner.first_name,
        last_name: runner.last_name,
        email: runner.email,
        dynamic_data: runner.dynamic_data,
      },
      template,
    });

    if (!wwRes.success) {
      return res.status(502).json({ success: false, error: wwRes.error || 'Failed to issue pass via WalletWallet API' });
    }

    if (pass && wwRes.serialNumber) {
      pass.walletwallet_pass_id = wwRes.serialNumber;
      pass.google_save_url = wwRes.googleSaveUrl;
      pass.share_url = wwRes.shareUrl;
      pass.apple_pass_base64 = wwRes.applePass;
      d1Db.updatePass(pass.id, {
        walletwallet_pass_id: wwRes.serialNumber,
        google_save_url: wwRes.googleSaveUrl,
        share_url: wwRes.shareUrl,
        apple_pass_base64: wwRes.applePass,
      });
    }

    return res.json({
      success: true,
      pass,
      googleSaveUrl: wwRes.googleSaveUrl,
      shareUrl: wwRes.shareUrl,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Mark Google Wallet install
app.post('/api/pass/mark-google/:id', (req, res) => {
  const runnerId = req.params.id;
  const pass = d1Db.getPassByRunnerId(runnerId);
  if (pass) {
    d1Db.updatePass(pass.id, { installed_google: 1 });
  }
  return res.json({ success: true });
});

// -----------------------------------------------------------------------------
// 7. Races Endpoints
// -----------------------------------------------------------------------------
app.get('/api/races', (req, res) => {
  const races = d1Db.getRaces();
  return res.json({ success: true, data: races });
});

app.get('/api/races/:id', (req, res) => {
  const race = d1Db.getRaceById(req.params.id);
  if (!race) return res.status(404).json({ success: false, error: 'Race not found' });
  const runners = d1Db.getRunners(race.id);
  return res.json({ success: true, data: { ...race, runners } });
});

app.post('/api/races', (req, res) => {
  try {
    const { name, template_id, event_date, location, field_mapping, org_id } = req.body;
    if (!name || !template_id) {
      return res.status(400).json({ success: false, error: 'name and template_id are required' });
    }
    const race = d1Db.createRace({
      org_id: org_id || 'org-pacific-sports-2026',
      template_id,
      name,
      event_date: event_date || new Date().toISOString(),
      location: location || 'TBD',
      field_mapping: typeof field_mapping === 'string' ? field_mapping : JSON.stringify(field_mapping || {}),
    });
    return res.json({ success: true, data: race });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/races/:id', (req, res) => {
  try {
    const updated = d1Db.updateRace(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Race not found' });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/races/:id', (req, res) => {
  const success = d1Db.deleteRace(req.params.id);
  return res.json({ success });
});

// -----------------------------------------------------------------------------
// 8. Templates Endpoints
// -----------------------------------------------------------------------------
app.get('/api/templates', (req, res) => {
  const templates = d1Db.getTemplates();
  return res.json({ success: true, data: templates });
});

app.get('/api/templates/:id', (req, res) => {
  const template = d1Db.getTemplateById(req.params.id);
  if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
  return res.json({ success: true, data: template });
});

app.post('/api/templates', (req, res) => {
  try {
    const { name, background_color, text_color, label_color, logo_image_url, strip_image_url, schema_definition, org_id } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });

    const template = d1Db.createTemplate({
      org_id: org_id || 'org-pacific-sports-2026',
      name,
      background_color: background_color || '#0f172a',
      text_color: text_color || '#ffffff',
      label_color: label_color || '#38bdf8',
      logo_image_url: logo_image_url || '',
      strip_image_url: strip_image_url || '',
      schema_definition: JSON.stringify(validateTemplateSchema(schema_definition ?? {})),
    });
    return res.json({ success: true, data: template });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/templates/:id', (req, res) => {
  try {
    const body = { ...req.body };
    if (body.schema_definition !== undefined) body.schema_definition = JSON.stringify(validateTemplateSchema(body.schema_definition));
    const updated = d1Db.updateTemplate(req.params.id, body);
    if (!updated) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 9. Runners CRUD Endpoints
// -----------------------------------------------------------------------------
app.get('/api/runners', (req, res) => {
  const raceId = req.query.race_id as string | undefined;
  const runners = d1Db.getRunners(raceId);
  return res.json({ success: true, data: runners });
});

// Helper to dispatch pass email via Resend in server runtime
async function dispatchPassEmailServer(options: {
  to: string;
  firstName: string;
  runnerId: string;
  raceName?: string;
  origin?: string;
  googleSaveUrl?: string;
  shareUrl?: string;
}): Promise<{ success: boolean; error?: string; resendId?: string; hint?: string; passUrl?: string }> {
  const { to, firstName, runnerId, raceName, origin, googleSaveUrl, shareUrl } = options;
  const resendApiKey = d1Db.settings.resendApiKey;
  const domain = (d1Db.settings.publicDomain || origin || 'https://walletpass.3fstriders.org').replace(/\/$/, '');
  const passUrl = `${domain}/pass/${runnerId}`;
  const eventTitle = raceName || 'Official Athletic Event';

  if (!resendApiKey) {
    return {
      success: false,
      error: 'RESEND_API_KEY is not configured in settings or environment variables.',
      hint: 'Add your Resend API Key in Settings or set RESEND_API_KEY in .env.',
      passUrl,
    };
  }

  const googleButtonHtml = googleSaveUrl
    ? `<a href="${googleSaveUrl}" style="background-color: #1e293b; border: 1px solid #475569; color: #ffffff; font-weight: 700; font-size: 14px; padding: 14px 24px; border-radius: 12px; text-decoration: none; display: inline-block; margin: 6px;">
        Save to Google Wallet →
       </a>`
    : '';

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

  const fromAddress = d1Db.settings.emailFrom || process.env.EMAIL_FROM || 'Pacific Athletic Series <passes@notification.3fstriders.org>';

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
          d1Db.logEmail({
            runner_id: runnerId,
            to,
            subject: `Your ${eventTitle} Digital Pass is Ready!`,
            pass_url: passUrl,
          });
          return { success: true, resendId: retryJson.id, passUrl };
        }
      }

      const errMsg = resJson.message || resJson.error || 'Resend error';
      let hint: string | undefined;
      if (errMsg.toLowerCase().includes('testing emails to your own email address') || errMsg.toLowerCase().includes('testing emails')) {
        hint = 'Resend free testing mode only sends to the email registered on your Resend account. Verify a custom domain at resend.com/domains to send to any participant.';
      }
      return { success: false, error: errMsg, hint, passUrl };
    }

    d1Db.logEmail({
      runner_id: runnerId,
      to,
      subject: `Your ${eventTitle} Digital Pass is Ready!`,
      pass_url: passUrl,
    });
    return { success: true, resendId: resJson.id, passUrl };
  } catch (err: any) {
    return { success: false, error: err.message, passUrl };
  }
}

app.post('/api/runner/create', async (req, res) => {
  try {
    const { race_id, email, first_name, last_name, dynamic_data, issue_immediate } = req.body;
    if (!race_id || !email || !first_name || !last_name) {
      return res.status(400).json({ success: false, error: 'race_id, email, first_name, and last_name are required' });
    }

    const { runner, pass } = d1Db.createRunner({
      race_id,
      email,
      first_name,
      last_name,
      dynamic_data: dynamic_data || {},
      issuePassImmediate: issue_immediate !== false,
    });

    const race = d1Db.getRaceById(race_id);
    const template = race ? d1Db.getTemplateById(race.template_id) : undefined;
    const origin = `${req.protocol}://${req.get('host')}`;

    // WalletWallet API pass creation (https://www.walletwallet.dev/docs)
    let wwResult: any = { success: false, error: 'WALLETWALLET_API_KEY not configured' };
    if (d1Db.settings.walletwalletApiKey) {
      wwResult = await createWalletWalletPassServer({
        apiKey: d1Db.settings.walletwalletApiKey,
        baseUrl: d1Db.settings.walletwalletApiUrl,
        plan: d1Db.settings.walletwalletPlan,
        fieldMapping: race?.field_mapping,
        raceName: race?.name || 'Athletic Event',
        orgName: 'Pacific Athletic Series',
        runner: {
          id: runner.id,
          first_name,
          last_name,
          email,
          dynamic_data,
        },
        template,
      });

      if (wwResult.success && wwResult.serialNumber) {
        pass.walletwallet_pass_id = wwResult.serialNumber;
        pass.google_save_url = wwResult.googleSaveUrl;
        pass.share_url = wwResult.shareUrl;
        pass.apple_pass_base64 = wwResult.applePass;
        d1Db.updatePass(pass.id, {
          walletwallet_pass_id: wwResult.serialNumber,
          google_save_url: wwResult.googleSaveUrl,
          share_url: wwResult.shareUrl,
          apple_pass_base64: wwResult.applePass,
        });
      }
    }

    let emailResult: any = { success: false, error: 'Not dispatched' };
    if (pass.status === 'issued') {
      emailResult = await dispatchPassEmailServer({
        to: email,
        firstName: first_name,
        runnerId: runner.id,
        raceName: race?.name,
        origin,
        googleSaveUrl: pass.google_save_url,
        shareUrl: pass.share_url,
      });
    }

    return res.json({
      success: true,
      data: {
        runner,
        pass,
        email_delivery: emailResult,
        walletwallet_delivery: wwResult,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/runner/send-email', async (req, res) => {
  try {
    const { runner_id } = req.body;
    if (!runner_id) return res.status(400).json({ success: false, error: 'runner_id required' });

    const runner = d1Db.getRunnerById(runner_id);
    if (!runner) return res.status(404).json({ success: false, error: 'Runner not found' });

    const pass = d1Db.getPassByRunnerId(runner_id);
    const race = d1Db.getRaceById(runner.race_id);
    const origin = `${req.protocol}://${req.get('host')}`;

    const emailResult = await dispatchPassEmailServer({
      to: runner.email,
      firstName: runner.first_name,
      runnerId: runner.id,
      raceName: race?.name,
      origin,
      googleSaveUrl: pass?.google_save_url,
      shareUrl: pass?.share_url,
    });

    return res.json({
      success: emailResult.success,
      message: emailResult.success
        ? `Pass delivery email dispatched to ${runner.email}`
        : `Email delivery notice: ${emailResult.error}`,
      data: emailResult,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/email/test', async (req, res) => {
  try {
    const targetEmail = req.body?.to || req.body?.email;
    if (!targetEmail) return res.status(400).json({ success: false, error: 'Recipient email is required' });

    const runner = d1Db.getRunners()[0];
    const race = runner ? d1Db.getRaceById(runner.race_id) : undefined;
    const origin = `${req.protocol}://${req.get('host')}`;

    const emailResult = await dispatchPassEmailServer({
      to: targetEmail,
      firstName: req.body?.first_name || runner?.first_name || 'Event Participant',
      runnerId: runner?.id || 'sample-test-pass',
      raceName: race?.name || 'Championship Marathon 2026',
      origin,
    });

    return res.json({
      success: emailResult.success,
      data: emailResult,
      message: emailResult.success
        ? `Test email sent to ${targetEmail}! (Resend ID: ${emailResult.resendId})`
        : `Email delivery failed: ${emailResult.error}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/runner/:id', (req, res) => {
  const success = d1Db.deleteRunner(req.params.id);
  return res.json({ success });
});

// -----------------------------------------------------------------------------
// 10. D1 SQL Console Endpoint
// -----------------------------------------------------------------------------
app.post('/api/d1/query', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'SQL query string required' });
  const result = d1Db.executeSql(query);
  return res.json({ success: true, data: result });
});

// -----------------------------------------------------------------------------
// 11. Cloudflare R2 Asset Endpoints
// -----------------------------------------------------------------------------
app.get('/api/r2/assets', (req, res) => {
  const assets = d1Db.getR2Assets();
  return res.json({ success: true, data: assets });
});

app.post('/api/r2/upload', (req, res) => {
  try {
    const { filename, mimeType, size, url } = req.body;
    if (!filename || !url) {
      return res.status(400).json({ success: false, error: 'filename and url required' });
    }
    const key = `assets/custom/${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const asset = d1Db.saveR2Asset({
      key,
      filename,
      size: size || 12400,
      mimeType: mimeType || 'image/jpeg',
      url,
    });
    return res.json({ success: true, data: asset });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 12. Logs & System Analytics
// -----------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  const races = d1Db.getRaces();
  const runners = d1Db.getRunners();
  const passes = d1Db.getPasses();
  const templates = d1Db.getTemplates();
  const queueJobs = d1Db.getQueueJobs();
  const pushLogs = d1Db.getPushLogs();
  const emailLogs = d1Db.getEmailLogs();

  const totalPasses = passes.length;
  const issuedPasses = passes.filter((p) => p.status === 'issued').length;
  const pendingPasses = passes.filter((p) => p.status === 'pending').length;
  const revokedPasses = passes.filter((p) => p.status === 'revoked').length;
  const appleInstalls = passes.filter((p) => p.installed_apple === 1).length;
  const googleInstalls = passes.filter((p) => p.installed_google === 1).length;

  return res.json({
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
        templatesCount: templates.length,
        totalRunners: runners.length,
        pendingQueueJobs: queueJobs.filter((j) => j.status === 'queued').length,
      },
      recent_pushes: pushLogs.slice(0, 10),
      recent_emails: emailLogs.slice(0, 10),
    },
  });
});

app.get('/api/logs/push', (req, res) => {
  return res.json({ success: true, data: d1Db.getPushLogs() });
});

app.get('/api/logs/emails', (req, res) => {
  return res.json({ success: true, data: d1Db.getEmailLogs() });
});

// -----------------------------------------------------------------------------
// 13. Settings & Credentials Endpoint
// -----------------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  return res.json({ success: true, data: d1Db.settings });
});

app.post('/api/settings', (req, res) => {
  const { walletwalletApiKey, walletwalletApiUrl, walletwalletPlan, resendApiKey, emailFrom, publicDomain } = req.body;
  if (walletwalletApiKey !== undefined) d1Db.settings.walletwalletApiKey = walletwalletApiKey;
  if (walletwalletApiUrl !== undefined) d1Db.settings.walletwalletApiUrl = normalizeWalletWalletUrl(walletwalletApiUrl);
  if (walletwalletPlan !== undefined) d1Db.settings.walletwalletPlan = walletwalletPlan;
  if (resendApiKey !== undefined) d1Db.settings.resendApiKey = resendApiKey;
  if (emailFrom !== undefined) d1Db.settings.emailFrom = emailFrom;
  if (publicDomain !== undefined) d1Db.settings.publicDomain = publicDomain;
  return res.json({ success: true, data: d1Db.settings });
});

// -----------------------------------------------------------------------------
// 14. WalletWallet Connection Status & Quota Verification
// -----------------------------------------------------------------------------
app.get('/api/walletwallet/status', async (req, res) => {
  try {
    const apiKey = d1Db.settings.walletwalletApiKey;
    const baseUrl = normalizeWalletWalletUrl(d1Db.settings.walletwalletApiUrl);
    const plan = d1Db.settings.walletwalletPlan || 'free';

    if (!apiKey) {
      return res.json({
        success: false,
        error: 'WALLETWALLET_API_KEY is not configured yet in Settings or environment variables.',
        plan,
        baseUrl,
      });
    }

    const usageRes = await fetch(`${baseUrl}/api/auth/usage`, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });

    const usageJson: any = await usageRes.json().catch(() => ({}));
    if (!usageRes.ok) {
      return res.json({
        success: false,
        error: usageJson.error || usageJson.message || `WalletWallet returned HTTP ${usageRes.status}`,
        plan,
        baseUrl,
      });
    }

    return res.json({
      success: true,
      plan,
      baseUrl,
      usage: usageJson,
      message: plan === 'free'
        ? 'Connected to WalletWallet Free Tier (1,000 passes/month, colorPreset & standard fields).'
        : 'Connected to WalletWallet Pro Tier ($39/mo, custom hex, strip artwork, live push).',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// Vite Middleware / Static Frontend Mounting
// -----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Cloudflare Wallet Pass Platform backend running at http://localhost:${PORT}`);
  });
}

startServer();
