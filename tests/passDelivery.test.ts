import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { type Env } from '../worker/index.ts';
import { createPassLink, deliverPass, deviceWallet, storeApplePass } from '../worker/passDelivery.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO Organizations(id,name) VALUES ('org','3F');
    INSERT INTO Templates(id,org_id,name,schema_definition) VALUES ('tpl','org','Event','{}');
    INSERT INTO Races(id,org_id,template_id,name,field_mapping) VALUES ('race','org','tpl','Race <script>','{}');
    INSERT INTO Runners(id,race_id,email,first_name,last_name) VALUES ('runner','race','runner@example.com','First','Last');
    INSERT INTO Passes(id,runner_id,status,google_save_url) VALUES ('pass','runner','issued','https://pay.google.com/gp/v/save/test');`);
  const objects = new Map<string, Uint8Array>();
  let failStorage = false;
  const env = {
    DB: {
      async batch(statements: any[]) {
        sqlite.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
      prepare(sql: string) {
      let args: any[] = [];
      return {
        bind(...values: any[]) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
      };
    } },
    PASSES_BUCKET: {
      async put(key: string, bytes: Uint8Array) {
        if (failStorage) throw new Error('Storage failed');
        objects.set(key, bytes.slice());
      },
      async head(key: string) { return objects.has(key) ? { key } : null; },
      async get(key: string) { return objects.has(key) ? { body: objects.get(key) } : null; },
    },
    ASSETS_BUCKET: { async put() { throw new Error('Must never write packages publicly'); } },
    PUBLIC_DOMAIN: 'https://walletpass.3fstriders.org',
    WALLETWALLET_API_URL: 'https://api.walletwallet.dev',
    WALLETWALLET_API_KEY: 'test-key', RESEND_API_KEY: 'test-key',
  } as unknown as Env;
  return { env, sqlite, objects, failStorage(value: boolean) { failStorage = value; } };
}
const signedBytes = new Uint8Array([80, 75, 3, 4, 7, 11, 0, 255]);
const signedBase64 = Buffer.from(signedBytes).toString('base64');
const context = { waitUntil() {}, passThroughOnException() {} };

test('device detection covers mobile, iPad desktop UA, desktop and unknown', () => {
  for (const ua of ['iPhone', 'iPad', 'Mozilla Macintosh Safari Mobile']) assert.equal(deviceWallet(ua), 'apple');
  assert.equal(deviceWallet('Android'), 'google');
  for (const ua of ['', 'Windows Chrome', 'Macintosh Safari', 'Email scanner']) assert.equal(deviceWallet(ua), 'choose');
});

test('hashed token authorizes exact private bytes and Apple headers; HEAD has no body', async () => {
  const f = fixture();
  const key = await storeApplePass(f.env, 'runner', signedBase64);
  f.sqlite.prepare('UPDATE Passes SET r2_key = ?').run(key);
  const token = await createPassLink(f.env, 'runner');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(f.sqlite.prepare('SELECT token_hash FROM PassLinks').get()!.token_hash, token);
  const request = new Request(`https://walletpass.3fstriders.org/${token}`, { headers: { 'User-Agent': 'iPhone' } });
  const response = await worker.fetch(request, f.env, context);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), signedBytes);
  assert.equal(response.headers.get('Content-Type'), 'application/vnd.apple.pkpass');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="access-pass.pkpass"');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const head = await deliverPass(new Request(request, { method: 'HEAD' }), f.env, token);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('Android redirects directly to Google; desktop renders only first-party wallet buttons', async () => {
  const f = fixture(), token = await createPassLink(f.env, 'runner');
  const android = await deliverPass(new Request('https://example.com', { headers: { 'User-Agent': 'Android' } }), f.env, token);
  assert.equal(android.status, 302);
  assert.equal(android.headers.get('Location'), 'https://pay.google.com/gp/v/save/test');
  const desktop = await deliverPass(new Request('https://example.com'), f.env, token);
  const html = await desktop.text();
  assert.match(html, /3F STRIDERS/);
  assert.match(html, /Race &lt;script&gt;/);
  assert.ok(html.includes(`/${token}/apple`) && html.includes(`/${token}/google`));
  assert.ok(!html.includes('walletwallet') && !html.includes('apple_pass_base64'));
  const apple = await deliverPass(new Request('https://example.com', { headers: { 'User-Agent': 'Android' } }), f.env, token, 'apple');
  assert.equal(apple.status, 503); // Explicit Apple overrides Android; no unsigned fallback.
  f.sqlite.exec("UPDATE Passes SET google_save_url = 'https://walletwallet.dev/share/pass'");
  const fallback = await deliverPass(new Request('https://example.com', { headers: { 'User-Agent': 'Android' } }), f.env, token);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get('Location'), null);
  assert.ok(!(await fallback.text()).includes('walletwallet'));
});

test('invalid, revoked and pending links are rejected; legacy downloads cannot bypass token', async () => {
  const f = fixture(), token = await createPassLink(f.env, 'runner');
  for (const candidate of ['runner', 'x'.repeat(43)]) {
    assert.equal((await deliverPass(new Request('https://example.com'), f.env, candidate)).status, 404);
  }
  for (const path of ['/api/pass/download/runner/pass.pkpass', '/api/r2/pass/runner', '/passes/runner', '/api/pass/details/runner']) {
    assert.equal((await worker.fetch(new Request(`https://example.com${path}`), f.env, context)).status, 404);
  }
  f.sqlite.exec("UPDATE Passes SET status = 'revoked'");
  assert.equal((await deliverPass(new Request('https://example.com'), f.env, token)).status, 410);
  f.sqlite.exec("UPDATE Passes SET status = 'pending'");
  assert.equal((await deliverPass(new Request('https://example.com'), f.env, token)).status, 409);
  assert.equal((await deliverPass(new Request('https://example.com', { method: 'POST' }), f.env, token)).status, 405);
});

test('D1 legacy package migrates privately; unavailable storage returns 503 without provider calls', async () => {
  const f = fixture(), token = await createPassLink(f.env, 'runner');
  f.sqlite.prepare('UPDATE Passes SET apple_pass_base64 = ?').run(signedBase64);
  const request = new Request('https://example.com', { headers: { 'User-Agent': 'iPhone' } });
  f.failStorage(true);
  assert.equal((await deliverPass(request, f.env, token)).status, 503);
  f.failStorage(false);
  const response = await deliverPass(request, f.env, token);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), signedBytes);
  assert.equal(f.sqlite.prepare('SELECT r2_key FROM Passes').get()!.r2_key, 'passes/runner/pass.pkpass');
});

test('immediate issuance saves private package before Resend sends the first-party token link', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  let email: any;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('api.walletwallet.dev')) return Response.json({ serialNumber: 'ww-new', applePass: signedBase64,
      googleSaveUrl: 'https://pay.google.com/gp/v/save/test', shareUrl: 'https://walletwallet.dev/share/test' });
    assert.ok(f.objects.size > 0, 'Storage must complete before sending email');
    email = JSON.parse(String(init?.body));
    return Response.json({ id: 'email-id' });
  };
  try {
    const response = await worker.fetch(new Request('https://example.com/api/runner/create', { method: 'POST',
      body: JSON.stringify({ race_id: 'race', email: 'new@example.com', first_name: 'New', last_name: 'Runner' }),
    }), f.env, context);
    const json: any = await response.json();
    assert.equal(json.success, true);
    assert.equal(json.data.pass.status, 'issued');
    assert.match(email.html, /https:\/\/walletpass\.3fstriders\.org\/[A-Za-z0-9_-]{43}/);
    assert.ok(!email.html.includes('walletwallet.dev') && !email.html.includes('/pass/run-'));
  } finally { globalThis.fetch = originalFetch; }
});

test('queued storage failure retains original provider output; retry does not create another pass', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  f.sqlite.exec("UPDATE Passes SET status = 'pending', google_save_url = NULL");
  let creates = 0, emails = 0, retries = 0, acks = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes('api.walletwallet.dev')) {
      creates++;
      return Response.json({ serialNumber: 'ww-original', applePass: signedBase64,
        googleSaveUrl: 'https://pay.google.com/gp/v/save/test' });
    }
    emails++;
    return Response.json({ id: 'email-id' });
  };
  const batch = { messages: [{ body: { runner_id: 'runner', payload: { email: 'runner@example.com' } },
    ack() { acks++; }, retry() { retries++; } }] } as any;
  try {
    f.failStorage(true);
    await worker.queue(batch, f.env);
    assert.equal(retries, 1); assert.equal(emails, 0); assert.equal(acks, 0);
    assert.equal(f.sqlite.prepare('SELECT apple_pass_base64 FROM Passes').get()!.apple_pass_base64, signedBase64);
    f.failStorage(false);
    await worker.queue(batch, f.env);
    assert.equal(creates, 1); assert.equal(emails, 1); assert.equal(acks, 1);
    assert.equal(f.sqlite.prepare('SELECT status FROM Passes').get()!.status, 'issued');
  } finally { globalThis.fetch = originalFetch; }
});

test('email-only lookup never returns bearer token or provider URLs', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  f.sqlite.prepare('UPDATE Passes SET apple_pass_base64 = ?').run(signedBase64);
  globalThis.fetch = async () => Response.json({ id: 'email-id' });
  try {
    const response = await worker.fetch(new Request('https://example.com/api/lookup', { method: 'POST',
      body: JSON.stringify({ email: 'runner@example.com' }) }), f.env, context);
    const json: any = await response.json();
    assert.equal(json.data.email_delivery.success, true);
    assert.equal(json.data.pass_url, undefined);
    assert.equal(json.data.email_delivery.passUrl, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('organizer link creation and explicit sync use private storage and recipient token routes', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ serialNumber: 'ww-sync', applePass: signedBase64,
    googleSaveUrl: 'https://pay.google.com/gp/v/save/synced', shareUrl: 'https://walletwallet.dev/share/synced' });
  try {
    const sync = await worker.fetch(new Request('https://example.com/api/pass/sync/runner', { method: 'POST' }), f.env, context);
    assert.equal(sync.status, 200);
    assert.equal(f.sqlite.prepare('SELECT r2_key FROM Passes').get()!.r2_key, 'passes/runner/pass.pkpass');
    assert.deepEqual(f.objects.get('passes/runner/pass.pkpass'), signedBytes);
    const link = await worker.fetch(new Request('https://example.com/api/pass/link/runner', { method: 'POST' }), f.env, context);
    const json: any = await link.json();
    assert.match(json.passUrl, /^\/[A-Za-z0-9_-]{43}$/);
    const apple = await worker.fetch(new Request(`https://example.com${json.passUrl}/apple`), f.env, context);
    assert.deepEqual(new Uint8Array(await apple.arrayBuffer()), signedBytes);
  } finally { globalThis.fetch = originalFetch; }
});

test('Studio template create/save round-trip and immediate issuance preserve every selected preset', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  let captured: any;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.walletwallet.dev')) {
      captured = JSON.parse(String(init?.body));
      return Response.json({ serialNumber: crypto.randomUUID(), applePass: signedBase64, googleSaveUrl: 'https://pay.google.com/gp/v/save/test' });
    }
    return Response.json({ id: 'email-id' });
  };
  try {
    const templateResponse = await worker.fetch(new Request('https://example.com/api/templates', { method: 'POST', body: JSON.stringify({
      name: 'Studio Template', background_color: '#064e3b', schema_definition: JSON.stringify({ colorPreset: 'green', logoText: 'Studio Title',
        primaryFields: [{ label: 'ENTRY', key: 'bib' }], backFields: [{ label: 'EMAIL', key: 'email', value: 'sample@example.com' }] }),
    }) }), f.env, context);
    const created: any = await templateResponse.json();
    assert.equal(templateResponse.status, 200);
    f.sqlite.prepare('UPDATE Races SET template_id = ?').run(created.data.id);
    for (const preset of ['dark', 'blue', 'green', 'red', 'purple', 'orange']) {
      const schema = { ...JSON.parse(created.data.schema_definition), colorPreset: preset };
      const saved = await worker.fetch(new Request(`https://example.com/api/templates/${created.data.id}`, { method: 'PUT',
        body: JSON.stringify({ schema_definition: JSON.stringify(schema) }) }), f.env, context);
      assert.equal(saved.status, 200);
      assert.equal(JSON.parse((await saved.json() as any).data.schema_definition).colorPreset, preset);
      const response = await worker.fetch(new Request('https://example.com/api/runner/create', { method: 'POST', body: JSON.stringify({
        race_id: 'race', email: `${preset}@example.com`, first_name: 'Test', last_name: 'Runner', dynamic_data: { bib: '55' },
      }) }), f.env, context);
      assert.equal((await response.json() as any).data.walletwallet_delivery.success, true);
      assert.equal(captured.colorPreset, preset); assert.equal(captured.logoText, 'Studio Title');
      assert.equal(captured.primaryFields[0].label, 'ENTRY'); assert.equal(captured.primaryFields[0].value, '55');
      assert.equal(captured.backFields[0].value, `${preset}@example.com`); assert.equal(captured.color, undefined);
    }
    const partial = await worker.fetch(new Request(`https://example.com/api/templates/${created.data.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed' }) }), f.env, context);
    assert.equal(JSON.parse((await partial.json() as any).data.schema_definition).colorPreset, 'orange');
    const invalid = await worker.fetch(new Request('https://example.com/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Invalid', schema_definition: '{broken' }) }), f.env, context);
    assert.equal(invalid.status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test('queued issuance and live PUT retain the same full Studio spec on the Free plan', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  f.sqlite.exec("UPDATE Passes SET status = 'pending'");
  f.sqlite.prepare('UPDATE Templates SET schema_definition = ?').run(JSON.stringify({ colorPreset: 'purple', logoText: 'Template title',
    primaryFields: [{ label: 'BIB', key: 'bib', changeMessage: 'Bib is now %@' }], barcodeAltText: '' }));
  let createBody: any, updateBody: any;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.walletwallet.dev')) {
      const body = JSON.parse(String(init?.body));
      if (init?.method === 'PUT') { updateBody = body; return Response.json({ unchanged: false }); }
      createBody = body;
      return Response.json({ serialNumber: 'ww-real', applePass: signedBase64, googleSaveUrl: 'https://pay.google.com/gp/v/save/test' });
    }
    return Response.json({ id: 'email-id' });
  };
  try {
    await worker.queue({ messages: [{ body: { runner_id: 'runner', payload: { email: 'runner@example.com' } }, ack() {}, retry() { assert.fail('Queue should succeed'); } }] } as any, f.env);
    assert.equal(createBody.colorPreset, 'purple');
    const response = await worker.fetch(new Request('https://example.com/api/runner/update', { method: 'PUT', body: JSON.stringify({
      runner_id: 'runner', dynamic_data: { bib: 'NEW', wave: 'D' },
    }) }), f.env, context);
    assert.equal(response.status, 200); assert.equal(updateBody.colorPreset, 'purple');
    assert.equal(updateBody.logoText, 'Template title'); assert.equal(updateBody.primaryFields[0].value, 'NEW');
    assert.equal(updateBody.primaryFields[0].changeMessage, 'Bib is now %@'); assert.equal(updateBody.barcodeAltText, '');
    assert.equal(updateBody.fields, undefined); assert.equal(updateBody.first_name, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('provider validation errors never retry with a different preset', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  f.sqlite.exec("INSERT INTO SystemSettings(key,value) VALUES ('walletwalletPlan','pro')");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'Invalid provider setting' }, { status: 400 }); };
  try {
    const response = await worker.fetch(new Request('https://example.com/api/pass/sync/runner', { method: 'POST' }), f.env, context);
    assert.equal(response.status, 502); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('five-athlete CSV import persists rows, queues them, and completes real Worker issuance and email processing', async () => {
  const { SAMPLE_ATHLETES_CSV, parseAthleteCsv } = await import('../server/csvImport.ts');
  const f = fixture(), originalFetch = globalThis.fetch;
  let messages: any[] = [], creates = 0, emails = 0;
  f.env.PASS_QUEUE = { async sendBatch(batch: any) { messages.push(...batch); } } as any;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.walletwallet.dev')) {
      creates++;
      const body = JSON.parse(String(init?.body)); assert.match(body.barcodeValue, /^100[1-5]$/);
      return Response.json({ serialNumber: crypto.randomUUID(), applePass: signedBase64, googleSaveUrl: 'https://pay.google.com/gp/v/save/test' });
    }
    emails++; return Response.json({ id: 'email-id' });
  };
  try {
    const response = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows: parseAthleteCsv(SAMPLE_ATHLETES_CSV).rows }) }), f.env, context);
    const result: any = await response.json();
    assert.equal(response.status, 202); assert.equal(result.data.total_enqueued, 5); assert.equal(messages.length, 5);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM Runners').get()!.n, 6);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM ImportJobs WHERE state = 'queued'").get()!.n, 5);
    const delivered = messages.map(message => ({ ...message, attempts: 1, ack() {}, retry() { assert.fail('Sample import must not retry'); } }));
    await worker.queue({ messages: delivered } as any, f.env);
    assert.equal(creates, 5); assert.equal(emails, 5); assert.equal(f.objects.size, 5);
    const status = await worker.fetch(new Request(`https://example.com/api/import/${result.data.batch_id}/status`), f.env, context);
    const progress: any = await status.json(); assert.equal(progress.data.counts.completed, 5);
    // Redelivery after completion does not issue another pass or send another email.
    await worker.queue({ messages: delivered } as any, f.env);
    assert.equal(creates, 5); assert.equal(emails, 5);
    // Re-uploading the same file safely skips already registered addresses.
    const duplicate = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows: parseAthleteCsv(SAMPLE_ATHLETES_CSV).rows }) }), f.env, context);
    const duplicates: any = await duplicate.json(); assert.equal(duplicates.data.total_enqueued, 0); assert.equal(duplicates.data.total_skipped, 5);
  } finally { globalThis.fetch = originalFetch; }
});

test('import validation reports true accepted/duplicate/invalid counts and does not mutate without a queue', async () => {
  const f = fixture();
  const athlete = { first_name: 'New', last_name: 'Runner', email: 'new@example.com' };
  const request = (rows: any[], race_id = 'race') => new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id, rows }) });
  assert.equal((await worker.fetch(request([athlete]), f.env, context)).status, 503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM Runners').get()!.n, 1);
  f.env.PASS_QUEUE = { async sendBatch() {} } as any;
  assert.equal((await worker.fetch(request([athlete], 'missing'), f.env, context)).status, 404);
  const res = await worker.fetch(request([athlete, { ...athlete, email: 'NEW@example.com' }, { ...athlete, email: 'runner@example.com' }, { ...athlete, email: 'bad' }]), f.env, context);
  const json: any = await res.json(); assert.equal(json.data.total_enqueued, 1); assert.equal(json.data.total_skipped, 2); assert.equal(json.data.total_invalid, 1);
  assert.equal(json.data.errors[0].row, 5);
});

test('queue producer failure preserves recoverable jobs and Retry Failed Athletes queues existing runners', async () => {
  const f = fixture();
  f.env.PASS_QUEUE = { async sendBatch() { throw new Error('Queue unavailable'); } } as any;
  const res = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows: [{ first_name: 'New', last_name: 'Runner', email: 'new@example.com' }] }) }), f.env, context);
  const json: any = await res.json(); assert.equal(res.status, 503); assert.equal(json.data.total_saved, 1); assert.equal(json.data.total_enqueued, 0);
  assert.equal(f.sqlite.prepare('SELECT state FROM ImportJobs').get()!.state, 'enqueue_failed');
  let queued = 0;
  f.env.PASS_QUEUE = { async sendBatch(messages: any[]) { queued += messages.length; } } as any;
  const retry = await worker.fetch(new Request(`https://example.com/api/import/${json.data.batch_id}/retry`, { method: 'POST' }), f.env, context);
  assert.equal(retry.status, 202); assert.equal(queued, 1); assert.equal(f.sqlite.prepare('SELECT state FROM ImportJobs').get()!.state, 'queued');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM Runners').get()!.n, 2);
});

test('queue consumer records provider errors and terminal failure instead of silently retrying', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  let messages: any[] = [];
  f.env.PASS_QUEUE = { async sendBatch(batch: any[]) { messages = batch; } } as any;
  const res = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows: [{ first_name: 'New', last_name: 'Runner', email: 'new@example.com' }] }) }), f.env, context);
  assert.equal(res.status, 202);
  globalThis.fetch = async () => Response.json({ error: 'Monthly pass limit exceeded' }, { status: 429 });
  let retries = 0;
  try {
    const message = { ...messages[0], attempts: 1, ack() { assert.fail('Must not acknowledge failed issuance'); }, retry() { retries++; } };
    await worker.queue({ messages: [message] } as any, f.env);
    assert.equal(f.sqlite.prepare('SELECT state FROM ImportJobs').get()!.state, 'retrying');
    assert.equal(f.sqlite.prepare('SELECT last_error FROM ImportJobs').get()!.last_error, 'Monthly pass limit exceeded');
    await worker.queue({ messages: [{ ...message, attempts: 4 }] } as any, f.env);
    assert.equal(f.sqlite.prepare('SELECT state FROM ImportJobs').get()!.state, 'failed'); assert.equal(retries, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('import writes roll back together when a pass insert fails', async () => {
  const f = fixture(); let queueCalls = 0;
  f.env.PASS_QUEUE = { async sendBatch() { queueCalls++; } } as any;
  f.sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON Passes BEGIN SELECT RAISE(ABORT, 'Simulated pass insert failure'); END;");
  const res = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows: [{ first_name: 'New', last_name: 'Runner', email: 'new@example.com' }] }) }), f.env, context);
  assert.equal(res.status, 500); assert.equal(queueCalls, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM Runners').get()!.n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ImportJobs').get()!.n, 0);
});

test('100-row import stays inside D1 parameter and Queue message batch limits', async () => {
  const f = fixture();
  const originalPrepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => {
    const statement = originalPrepare(sql), bind = statement.bind.bind(statement);
    statement.bind = (...args: any[]) => { assert.ok(args.length <= 100); return bind(...args); };
    return statement;
  };
  let queued = 0;
  f.env.PASS_QUEUE = { async sendBatch(messages: any[]) {
    assert.ok(messages.length <= 100);
    const size = messages.reduce((total, message) => total + new TextEncoder().encode(JSON.stringify(message.body)).byteLength, 0);
    assert.ok(size <= 240_000); queued += messages.length;
  } } as any;
  const rows = Array.from({ length: 100 }, (_, i) => ({ email: `athlete${i}@example.com`, first_name: 'Test', last_name: 'Runner', notes: 'X'.repeat(3000) }));
  const res = await worker.fetch(new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', rows }) }), f.env, context);
  assert.equal(res.status, 202); assert.equal(queued, 100);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ImportJobs').get()!.n, 100);
});

test('previously saved pending athletes can be explicitly resumed without duplicate runners', async () => {
  const f = fixture(); f.sqlite.exec("UPDATE Passes SET status = 'pending'");
  let queued = 0; f.env.PASS_QUEUE = { async sendBatch(messages: any[]) { queued += messages.length; } } as any;
  const request = (resume_pending: boolean) => new Request('https://example.com/api/import', { method: 'POST', body: JSON.stringify({ race_id: 'race', resume_pending,
    rows: [{ first_name: 'Actual', last_name: 'Runner', email: 'runner@example.com', bib_number: '1001' }] }) });
  const skipped = await worker.fetch(request(false), f.env, context);
  assert.equal((await skipped.json() as any).data.total_skipped, 1); assert.equal(queued, 0);
  const resumed = await worker.fetch(request(true), f.env, context);
  const json: any = await resumed.json(); assert.equal(resumed.status, 202); assert.equal(json.data.total_resumed, 1); assert.equal(queued, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM Runners').get()!.n, 1);
  assert.equal(f.sqlite.prepare('SELECT first_name FROM Runners').get()!.first_name, 'Actual');
  const active = await worker.fetch(request(true), f.env, context);
  assert.equal((await active.json() as any).data.total_enqueued, 0); assert.equal(queued, 1);
});
