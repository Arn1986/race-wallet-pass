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
app.get('/api/pass/download/:id', async (req, res) => {
  try {
    const runnerId = req.params.id;
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

    const buffer = await proxyOrGeneratePkpass({
      runner,
      race,
      template,
      pass,
      walletwalletApiKey: d1Db.settings.walletwalletApiKey,
      walletwalletApiUrl: d1Db.settings.walletwalletApiUrl,
    });

    let bibNumber = 'pass';
    try {
      const dyn = JSON.parse(runner.dynamic_data || '{}');
      bibNumber = dyn.bib_number || dyn.bib || 'pass';
    } catch {
      // ignore
    }

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="pass_${bibNumber}.pkpass"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    return res.end(buffer);
  } catch (error: any) {
    console.error('Error generating .pkpass download:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error streaming pass' });
  }
});

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

    // Call walletwallet.dev PUT endpoint if external API configured
    if (d1Db.settings.walletwalletApiKey && pass?.walletwallet_pass_id) {
      try {
        await fetch(`${d1Db.settings.walletwalletApiUrl}/passes/${pass.walletwallet_pass_id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${d1Db.settings.walletwalletApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: dynamic_data,
            first_name,
            last_name,
          }),
        });
      } catch (err) {
        console.warn('walletwallet.dev PUT notice:', err);
      }
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

    // Call DELETE or void on walletwallet.dev
    if (d1Db.settings.walletwalletApiKey && pass.walletwallet_pass_id) {
      try {
        await fetch(`${d1Db.settings.walletwalletApiUrl}/passes/${pass.walletwallet_pass_id}/void`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${d1Db.settings.walletwalletApiKey}`,
          },
        });
      } catch (err) {
        console.warn('walletwallet.dev void notice:', err);
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
app.post('/api/import', (req, res) => {
  try {
    const { race_id, rows } = req.body;
    if (!race_id || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid payload: race_id and rows array required' });
    }

    const race = d1Db.getRaceById(race_id);
    if (!race) {
      return res.status(404).json({ success: false, error: 'Target race does not exist' });
    }

    const enqueuedJobs = [];
    const createdRunners = [];

    for (const row of rows) {
      const email = row.email || row.Email;
      const firstName = row.first_name || row['First Name'] || row.firstname || 'Runner';
      const lastName = row.last_name || row['Last Name'] || row.lastname || 'Participant';

      if (!email) continue;

      // Clean dynamic fields
      const dynamicData: Record<string, any> = { ...row };
      delete dynamicData.email;
      delete dynamicData.Email;
      delete dynamicData.first_name;
      delete dynamicData['First Name'];
      delete dynamicData.firstname;
      delete dynamicData.last_name;
      delete dynamicData['Last Name'];
      delete dynamicData.lastname;

      const { runner, pass } = d1Db.createRunner({
        race_id,
        email,
        first_name: firstName,
        last_name: lastName,
        dynamic_data: dynamicData,
        issuePassImmediate: false, // marked 'pending'
      });

      createdRunners.push(runner);

      // Enqueue to PASS_QUEUE
      const job = d1Db.enqueueJob({
        runner_id: runner.id,
        race_id,
        payload: {
          first_name: firstName,
          last_name: lastName,
          email,
          dynamic_data: dynamicData,
        },
      });
      enqueuedJobs.push(job);
    }

    // Return 202 Accepted immediately as per Cloudflare Queue pattern!
    return res.status(202).json({
      success: true,
      message: `Enqueued ${enqueuedJobs.length} participants to Cloudflare PASS_QUEUE for asynchronous generation`,
      data: {
        total_enqueued: enqueuedJobs.length,
        queue_binding: 'PASS_QUEUE',
        batch_size: 10,
        status: '202_ACCEPTED',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

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
app.get('/api/pass/details/:id', (req, res) => {
  try {
    const runnerId = req.params.id;
    const runner = d1Db.getRunnerById(runnerId);
    if (!runner) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }

    const pass = d1Db.getPassByRunnerId(runnerId);
    const race = d1Db.getRaceById(runner.race_id);
    const template = race ? d1Db.getTemplateById(race.template_id) : undefined;

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
      schema_definition: typeof schema_definition === 'string' ? schema_definition : JSON.stringify(schema_definition || {}),
    });
    return res.json({ success: true, data: template });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/templates/:id', (req, res) => {
  try {
    const updated = d1Db.updateTemplate(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
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

app.post('/api/runner/create', (req, res) => {
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

    if (pass.status === 'issued') {
      d1Db.logEmail({
        runner_id: runner.id,
        to: runner.email,
        subject: `Your Race Pass is Ready! Download now`,
        pass_url: `/pass/${runner.id}`,
      });
    }

    return res.json({ success: true, data: { runner, pass } });
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
  const { walletwalletApiKey, walletwalletApiUrl, resendApiKey, publicDomain } = req.body;
  if (walletwalletApiKey !== undefined) d1Db.settings.walletwalletApiKey = walletwalletApiKey;
  if (walletwalletApiUrl !== undefined) d1Db.settings.walletwalletApiUrl = walletwalletApiUrl;
  if (resendApiKey !== undefined) d1Db.settings.resendApiKey = resendApiKey;
  if (publicDomain !== undefined) d1Db.settings.publicDomain = publicDomain;
  return res.json({ success: true, data: d1Db.settings });
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
