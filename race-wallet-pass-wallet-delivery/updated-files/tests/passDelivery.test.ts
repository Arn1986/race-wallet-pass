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
    DB: { prepare(sql: string) {
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
