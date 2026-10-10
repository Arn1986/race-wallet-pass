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

const DEFAULT_ORG_ID = 'org-3fstriders';

// Auto-seed default organization and template if D1 is freshly provisioned
async function ensureD1Bootstrap(env: Env) {
  try {
    // 0. Auto-create tables if they don't exist yet
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS Organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Races (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        event_date DATETIME,
        location TEXT,
        field_mapping TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Runners (
        id TEXT PRIMARY KEY,
        race_id TEXT NOT NULL,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        dynamic_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS Passes (
        id TEXT PRIMARY KEY,
        runner_id TEXT NOT NULL UNIQUE,
        walletwallet_pass_id TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        installed_apple BOOLEAN DEFAULT 0,
        installed_google BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 1. Ensure Organization
    await env.DB.prepare(
      "INSERT OR IGNORE INTO Organizations (id, name) VALUES (?, '3F Striders Athletic Club')"
    ).bind(DEFAULT_ORG_ID).run();

    // 2. Ensure initial template if none exist
    const countResult = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Templates").first<any>();
    if (!countResult || countResult.cnt === 0) {
      const defaultSchema = JSON.stringify({
        passType: 'eventTicket',
        barcodeType: 'PKBarcodeFormatQR',
        primaryFields: [{ key: 'bib', label: 'BIB NUMBER' }],
        secondaryFields: [
          { key: 'category', label: 'CATEGORY' },
          { key: 'wave', label: 'START WAVE' },
        ],
        auxiliaryFields: [
          { key: 'corral', label: 'CORRAL' },
          { key: 'expected_pace', label: 'TARGET PACE' },
          { key: 'tshirt_size', label: 'SHIRT' },
        ],
        backFields: [
          { key: 'emergency_contact', label: 'Emergency Contact' },
          { key: 'medical_notes', label: 'Medical Notes' },
          { key: 'race_rules', label: 'Official Rules & Timing Chips' },
        ],
      });

      await env.DB.prepare(`
        INSERT OR IGNORE INTO Templates (
          id, org_id, name, background_color, text_color, label_color,
          logo_image_url, strip_image_url, schema_definition
        ) VALUES (
          'tpl-marathon-vip', ?, 'Marathon VIP Digital Pass', '#0f172a', '#ffffff', '#38bdf8',
          'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=400&q=80',
          'https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=1200&q=80',
          ?
        )
      `).bind(DEFAULT_ORG_ID, defaultSchema).run();

      // Seed initial sample race if none exist
      const raceCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Races").first<any>();
      if (!raceCount || raceCount.cnt === 0) {
        const mapping = JSON.stringify({
          bib: 'bib_number',
          category: 'race_division',
          wave: 'start_wave',
          corral: 'corral_letter',
          expected_pace: 'target_pace',
          tshirt_size: 'tshirt_size',
          emergency_contact: 'emergency_contact',
          medical_notes: 'medical_notes',
        });

        await env.DB.prepare(`
          INSERT OR IGNORE INTO Races (
            id, org_id, template_id, name, event_date, location, field_mapping
          ) VALUES (
            'race-gg-marathon-2026', ?, 'tpl-marathon-vip', '3F Striders Annual Marathon 2026',
            '2026-11-15T06:30:00Z', 'San Francisco, CA', ?
          )
        `).bind(DEFAULT_ORG_ID, mapping).run();
      }
    }
  } catch (err) {
    console.error('D1 Bootstrap Notice:', err);
  }
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
        await ensureD1Bootstrap(env);
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

        const templateId = `tpl-${crypto.randomUUID()}`;
        const schemaStr = typeof schema_definition === 'string' ? schema_definition : JSON.stringify(schema_definition || {});

        await env.DB.prepare(`
          INSERT INTO Templates (
            id, org_id, name, background_color, text_color, label_color,
            logo_image_url, strip_image_url, schema_definition
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          templateId,
          org_id || DEFAULT_ORG_ID,
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
        await ensureD1Bootstrap(env);
        const body: any = await request.json();
        const { name, template_id, event_date, location, field_mapping, org_id } = body;
        if (!name || !template_id) {
          return Response.json({ success: false, error: 'Name and template_id are required' }, { status: 400, headers: corsHeaders });
        }

        const raceId = `race-${crypto.randomUUID()}`;
        const mappingStr = typeof field_mapping === 'string' ? field_mapping : JSON.stringify(field_mapping || {});

        await env.DB.prepare(`
          INSERT INTO Races (id, org_id, template_id, name, event_date, location, field_mapping)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          raceId,
          org_id || DEFAULT_ORG_ID,
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

        await env.DB.prepare(`
          INSERT INTO Passes (id, runner_id, walletwallet_pass_id, status)
          VALUES (?, ?, ?, ?)
        `).bind(passId, runnerId, `ww_${runnerId}`, passStatus).run();

        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE id = ?').bind(passId).first<any>();

        return Response.json({ success: true, data: { runner, pass } }, { headers: corsHeaders });
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

        // Forward to walletwallet.dev if API Key configured
        if (env.WALLETWALLET_API_KEY) {
          const pass = await env.DB.prepare('SELECT walletwallet_pass_id FROM Passes WHERE runner_id = ?').bind(runner_id).first<any>();
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

        const updated = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runner_id).first<any>();
        return Response.json({ success: true, data: { runner: updated } }, { headers: corsHeaders });
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

    // =========================================================================
    // PASS DETAILS FOR RUNNER SSR/LANDING (GET /api/pass/details/:id)
    // =========================================================================
    if (pathname.startsWith('/api/pass/details/')) {
      const runnerId = pathname.replace('/api/pass/details/', '');
      try {
        const runner = await env.DB.prepare('SELECT * FROM Runners WHERE id = ?').bind(runnerId).first<any>();
        if (!runner) return Response.json({ success: false, error: 'Runner not found' }, { status: 404, headers: corsHeaders });

        const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(runnerId).first<any>();
        const race = await env.DB.prepare('SELECT * FROM Races WHERE id = ?').bind(runner.race_id).first<any>();
        const template = race ? await env.DB.prepare('SELECT * FROM Templates WHERE id = ?').bind(race.template_id).first<any>() : null;

        return Response.json({
          success: true,
          data: { runner, pass, race, template },
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
    if (pathname === '/api/settings') {
      return Response.json({
        success: true,
        data: {
          publicDomain: env.PUBLIC_DOMAIN || '',
          walletwalletApiUrl: env.WALLETWALLET_API_URL || '',
          hasWalletWalletKey: Boolean(env.WALLETWALLET_API_KEY),
          hasResendKey: Boolean(env.RESEND_API_KEY),
        },
      }, { headers: corsHeaders });
    }

    // Fallback: Serve Frontend Static Assets (via Cloudflare Workers Assets)
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
