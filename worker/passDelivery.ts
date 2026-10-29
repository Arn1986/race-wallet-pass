import type { Env } from './index.ts';

export const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'User-Agent',
};

export async function ensurePassLinks(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS PassLinks (
    token_hash TEXT PRIMARY KEY,
    runner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (runner_id) REFERENCES Runners(id) ON DELETE CASCADE
  )`).run();
}

async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// A random bearer capability, independent of the participant ID. Only its hash is stored.
export async function createPassLink(env: Env, runnerId: string): Promise<string> {
  await ensurePassLinks(env);
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await env.DB.prepare('INSERT INTO PassLinks (token_hash, runner_id) VALUES (?, ?)')
    .bind(await hashToken(token), runnerId).run();
  return token;
}

export async function resolvePassLink(env: Env, token: string): Promise<any | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return env.DB.prepare(`SELECT p.* FROM PassLinks l
    JOIN Passes p ON p.runner_id = l.runner_id WHERE l.token_hash = ?`)
    .bind(await hashToken(token)).first<any>();
}

// Never use the public graphics bucket for signed participant packages.
export function decodeApplePackage(base64: string): Uint8Array {
  const nativeDecode = (Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  let bytes: Uint8Array;
  if (nativeDecode) bytes = nativeDecode.call(Uint8Array, base64);
  else {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    // Avoid Array.from's iterator/callback/allocation cost for every package byte.
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('Wallet provider returned an invalid pkpass package');
  return bytes;
}

export async function storeApplePass(env: Env, runnerId: string, base64: string): Promise<string> {
  if (!env.PASSES_BUCKET) throw new Error('Private PASSES_BUCKET binding is required');
  console.info('Pass storage stage', { runner_id: runnerId, stage: 'decode_start', base64_characters: base64.length });
  const bytes = decodeApplePackage(base64);
  const key = `passes/${runnerId}/pass.pkpass`;
  console.info('Pass storage stage', { runner_id: runnerId, stage: 'r2_put_start', bytes: bytes.byteLength });
  await env.PASSES_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/vnd.apple.pkpass', cacheControl: 'private, no-store' },
  });
  console.info('Pass storage stage', { runner_id: runnerId, stage: 'r2_put_complete' });
  return key;
}

// Migrate packages already retained in D1 without asking the provider to issue another pass.
export async function ensureStoredPass(env: Env, pass: any): Promise<any> {
  if (!env.PASSES_BUCKET) throw new Error('Private PASSES_BUCKET binding is required');
  if (pass.r2_key && await env.PASSES_BUCKET.head(pass.r2_key)) return pass;
  if (!pass.apple_pass_base64) throw new Error('Signed Apple package is unavailable; organizer must reissue this pass');
  pass.r2_key = await storeApplePass(env, pass.runner_id, pass.apple_pass_base64);
  await env.DB.prepare('UPDATE Passes SET r2_key = ? WHERE runner_id = ?').bind(pass.r2_key, pass.runner_id).run();
  return pass;
}

export function deviceWallet(userAgent: string): 'apple' | 'google' | 'choose' {
  if (/iPhone|iPad|iPod/i.test(userAgent) || /Macintosh.*Mobile/i.test(userAgent)) return 'apple';
  if (/Android/i.test(userAgent)) return 'google';
  return 'choose';
}

export function validGoogleSaveUrl(raw: string | null | undefined): string | null {
  try {
    const url = new URL(raw || '');
    return url.protocol === 'https:' && url.hostname === 'pay.google.com' && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function deliverPass(request: Request, env: Env, token: string, choice?: string): Promise<Response> {
  const headers = { ...privateHeaders };
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  const pass = await resolvePassLink(env, token);
  if (!pass) return new Response('Pass link not found', { status: 404, headers });
  if (pass.status === 'revoked') return new Response('This pass has been revoked', { status: 410, headers });
  if (pass.status !== 'issued') return new Response('Your pass is not ready. Please contact the organizer.', { status: 409, headers });
  const wallet = choice || deviceWallet(request.headers.get('User-Agent') || '');
  const googleUrl = validGoogleSaveUrl(pass.google_save_url);
  if (wallet === 'google' && googleUrl) {
    return new Response(null, { status: 302, headers: { ...headers, Location: googleUrl } });
  }
  if (wallet === 'apple') {
    try {
      await ensureStoredPass(env, pass);
      const object = await env.PASSES_BUCKET.get(pass.r2_key);
      if (!object) throw new Error('Package missing');
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
        ...headers,
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="access-pass.pkpass"',
      } });
    } catch {
      return new Response('Apple Wallet pass is temporarily unavailable. Please contact the organizer.', { status: 503, headers });
    }
  }
  const race = await env.DB.prepare(`SELECT r.name FROM Races r
    JOIN Runners p ON p.race_id = r.id WHERE p.id = ?`).bind(pass.runner_id).first<any>();
  const path = `/${token}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>3F Striders • Your event pass</title>
    <style>body{margin:0;background:#0f172a;color:#f8fafc;font:16px system-ui;display:grid;min-height:100vh;place-items:center}
    main{max-width:420px;margin:24px;padding:32px;background:#1e293b;border-radius:24px;text-align:center}
    .brand{color:#38bdf8;font-weight:800}h1{font-size:26px}p{color:#cbd5e1;line-height:1.6}
    a{display:block;padding:16px;margin:14px 0;border-radius:12px;background:#38bdf8;color:#0f172a;text-decoration:none;font-weight:700}
    .apple{background:#f8fafc}.note{font-size:13px}</style></head><body><main>
    <div class="brand">3F STRIDERS</div><h1>${escapeHtml(race?.name || 'Your event pass')}</h1>
    <p>Choose your wallet, or open this email on your phone to add your pass.</p>
    <a class="apple" href="${path}/apple">Add to Apple Wallet</a>
    ${googleUrl ? `<a href="${path}/google">Add to Google Wallet</a>` : '<p>Google Wallet is currently unavailable. Please contact the organizer.</p>'}
    <p class="note">Keep this personal pass link private.</p></main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { headers: {
    ...headers, 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  } });
}
