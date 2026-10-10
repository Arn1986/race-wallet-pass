import { generatePkpassBundle } from '../server/walletService.ts';

export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  PASS_QUEUE: Queue;
  ASSETS?: Fetcher;
  PUBLIC_DOMAIN: string;
  WALLETWALLET_API_URL: string;
  WALLETWALLET_API_KEY?: string;
  RESEND_API_KEY?: string;
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

    // A. Dynamic Pass Proxy Endpoint (streams .pkpass directly)
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

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first() as any;
        const race = runner ? await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first() as any : null;
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first() as any : null;

        if (!runner || !race || !template) {
          return Response.json({ success: false, error: 'Participant or race record not found' }, { status: 404, headers: corsHeaders });
        }

        // Update installed_apple flag in D1
        ctx.waitUntil(
          env.DB.prepare('UPDATE Passes SET installed_apple = 1, updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?')
            .bind(runnerId)
            .run()
        );

        // Generate pkpass binary
        const buffer = await generatePkpassBundle({
          runner,
          race,
          template,
          pass: passRecord as any,
        });

        let bibNumber = 'pass';
        try {
          const dyn = JSON.parse(runner.dynamic_data || '{}');
          bibNumber = dyn.bib_number || dyn.bib || 'pass';
        } catch {}

        return new Response(new Uint8Array(buffer), {
          headers: {
            'Content-Type': 'application/vnd.apple.pkpass',
            'Content-Disposition': `attachment; filename="pass_${bibNumber}.pkpass"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            ...corsHeaders,
          },
        });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // B. Live Pass Updates (PUT /api/runner/update)
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

        // Forward to walletwallet.dev if API Key configured
        if (env.WALLETWALLET_API_KEY) {
          const pass = await env.DB.prepare('SELECT walletwallet_pass_id FROM Passes WHERE runner_id = ?').bind(runner_id).first() as any;
          if (pass?.walletwallet_pass_id) {
            ctx.waitUntil(
              fetch(`${env.WALLETWALLET_API_URL}/passes/${pass.walletwallet_pass_id}`, {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${env.WALLETWALLET_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fields: dynamic_data, first_name, last_name }),
              }).catch(() => {})
            );
          }
        }

        const updated = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first();
        return Response.json({ success: true, data: { runner: updated } }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // C. Pass Revocation (POST /api/runner/revoke)
    if (pathname === '/api/runner/revoke' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { runner_id } = body;
        if (!runner_id) return Response.json({ success: false, error: 'runner_id required' }, { status: 400, headers: corsHeaders });

        await env.DB.prepare("UPDATE Passes SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE runner_id = ?").bind(runner_id).run();

        return Response.json({ success: true, data: { status: 'revoked' } }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // D. Bulk Ingestion -> PASS_QUEUE (POST /api/import)
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

          // Write pending runner + pass to D1
          await env.DB.prepare(`
            INSERT INTO Runners (id, race_id, email, first_name, last_name, dynamic_data)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(runnerId, race_id, email, firstName, lastName, JSON.stringify(dyn)).run();

          await env.DB.prepare(`
            INSERT INTO Passes (id, runner_id, walletwallet_pass_id, status)
            VALUES (?, ?, ?, 'pending')
          `).bind(`pass-${runnerId}`, runnerId, `ww_${runnerId}`).run();

          // Enqueue to Cloudflare Queue
          await env.PASS_QUEUE.send({
            runner_id: runnerId,
            race_id,
            payload: { email, first_name: firstName, last_name: lastName, dynamic_data: dyn },
          });
        }

        // Return 202 Accepted
        return Response.json({
          success: true,
          message: `Enqueued ${rows.length} participants to Cloudflare PASS_QUEUE`,
          data: { total_enqueued: rows.length, queue_binding: 'PASS_QUEUE' },
        }, { status: 202, headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // E. Participant Lookup (POST /api/lookup)
    if (pathname === '/api/lookup' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { email } = body;
        if (!email) return Response.json({ success: false, error: 'Email required' }, { status: 400, headers: corsHeaders });

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE LOWER(email) = LOWER(?) LIMIT 1').bind(email).first() as any;
        if (!runner) return Response.json({ success: false, error: 'Registration not found' }, { status: 404, headers: corsHeaders });

        return Response.json({
          success: true,
          data: {
            runner_id: runner.id,
            email: runner.email,
            pass_url: `/pass/${runner.id}`,
          },
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // F. Pass Details (GET /api/pass/details/:id)
    if (pathname.startsWith('/api/pass/details/')) {
      const runnerId = pathname.replace('/api/pass/details/', '');
      const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first() as any;
      if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });

      const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first() as any;
      const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first() as any;
      const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first() as any : null;

      return Response.json({
        success: true,
        data: { runner, pass, race, template },
      }, { headers: corsHeaders });
    }

    // G. Dashboard Metrics (GET /api/stats)
    if (pathname === '/api/stats') {
      const passes = (await env.DB.prepare('SELECT status, installed_apple, installed_google FROM Passes').all()).results as any[];
      const races = (await env.DB.prepare('SELECT id FROM Races').all()).results as any[];
      const runners = (await env.DB.prepare('SELECT id FROM Runners').all()).results as any[];

      const totalPasses = passes.length;
      const issuedPasses = passes.filter((p) => p.status === 'issued').length;
      const pendingPasses = passes.filter((p) => p.status === 'pending').length;
      const revokedPasses = passes.filter((p) => p.status === 'revoked').length;
      const appleInstalls = passes.filter((p) => p.installed_apple === 1).length;
      const googleInstalls = passes.filter((p) => p.installed_google === 1).length;

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
          },
          recent_pushes: [],
          recent_emails: [],
        },
      }, { headers: corsHeaders });
    }

    // Serve Frontend Static Assets (via Cloudflare Workers Assets)
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
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

        // Optional Resend email dispatch
        if (env.RESEND_API_KEY && payload?.email) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'passes@3fstriders.org',
              to: payload.email,
              subject: 'Your Official Digital Race Pass is Ready!',
              html: `<p>Hello ${payload.first_name},</p><p>Your race pass is ready: <a href="${env.PUBLIC_DOMAIN}/pass/${runner_id}">Download Pass</a></p>`,
            }),
          }).catch(() => {});
        }

        message.ack();
      } catch (err) {
        message.retry();
      }
    }
  },
};
