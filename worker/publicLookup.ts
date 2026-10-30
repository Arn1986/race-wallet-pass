import type { Env } from './index.ts';
import { createPassLink, ensureStoredPass } from './passDelivery.ts';
import { participantEmail } from '../server/participantEmails.ts';
import { lookupHeaders, normalizeLookupName, NO_LOOKUP_MATCH, renderLookupPage } from '../server/publicLookup.ts';

export const LOOKUP_PAGE_SCHEMA = `CREATE TABLE IF NOT EXISTS PublicLookupPages (
  race_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(race_id) REFERENCES Races(id) ON DELETE CASCADE
)`;
export const LOOKUP_ATTEMPT_SCHEMA = `CREATE TABLE IF NOT EXISTS PublicLookupAttempts (
  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL
)`;
const ready = new WeakMap<D1Database, Promise<void>>();
export async function ensurePublicLookupSchema(db: D1Database) {
  let promise = ready.get(db);
  if (!promise) {
    promise = db.batch([LOOKUP_PAGE_SCHEMA, LOOKUP_ATTEMPT_SCHEMA,
      'CREATE INDEX IF NOT EXISTS idx_public_lookup_expiry ON PublicLookupAttempts(expires_at)'].map(sql => db.prepare(sql))).then(() => {});
    ready.set(db, promise); promise.catch(() => ready.delete(db));
  }
  await promise;
}
export async function enabledLookupPage(db: D1Database, slug: string) {
  await ensurePublicLookupSchema(db);
  return db.prepare('SELECT l.race_id, l.slug, r.name FROM PublicLookupPages l JOIN Races r ON r.id = l.race_id WHERE l.slug = ? AND l.enabled = 1').bind(slug).first<any>();
}
const WINDOW_SECONDS = 600;
export const MAX_LOOKUP_ATTEMPTS = 10;
async function allowAttempt(request: Request, db: D1Database, raceId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / WINDOW_SECONDS);
  // Cloudflare supplies the connecting IP. Store only a hashed bucket key, never the raw IP or form data.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${raceId}|${window}|${ip}`));
  const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM PublicLookupAttempts WHERE expires_at < ?').bind(now).run();
  const record = await db.prepare(`INSERT INTO PublicLookupAttempts(key,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`).bind(key, (window + 1) * WINDOW_SECONDS).first<any>();
  return !!record && record.attempts <= MAX_LOOKUP_ATTEMPTS;
}

async function smallForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new Error('Invalid form');
  if (Number(request.headers.get('Content-Length') || 0) > 8192 || !request.body) throw new Error('Form is too large');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new Error('Form is too large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export async function handlePublicLookup(request: Request, env: Env, page: { race_id: string; slug: string; name: string }): Promise<Response> {
  const response = (message = '', status = 200, headers = {}) => new Response(request.method === 'HEAD' ? null : renderLookupPage(page.name, page.slug, message), {
    status, headers: { ...lookupHeaders, ...headers },
  });
  if (request.method === 'GET' || request.method === 'HEAD') return response();
  if (request.method !== 'POST') return response('Method not allowed', 405, { Allow: 'GET, HEAD, POST' });
  const origin = request.headers.get('Origin'), fetchSite = request.headers.get('Sec-Fetch-Site');
  // Native form POSTs under no-referrer may serialize Origin as null (Fetch Standard).
  // In that case require the browser's same-origin Fetch Metadata signal.
  const sameOrigin = origin === new URL(request.url).origin ||
    ((origin === null || origin === 'null') && fetchSite === 'same-origin');
  if ((fetchSite && fetchSite !== 'same-origin') || !sameOrigin) {
    return response('Please submit the form from this page.', 403);
  }
  if (!await allowAttempt(request, env.DB, page.race_id)) return response('Too many attempts. Please try again in 10 minutes.', 429, { 'Retry-After': String(WINDOW_SECONDS) });
  let first: string, last: string, email: string;
  try {
    const form = await smallForm(request);
    for (const key of ['first_name','last_name','email']) if (form.getAll(key).length !== 1) throw new Error('Invalid form');
    first = normalizeLookupName(form.get('first_name')!); last = normalizeLookupName(form.get('last_name')!);
    if (!first || !last || first.length > 200 || last.length > 200) throw new Error('Invalid name');
    email = participantEmail(form.get('email'));
  } catch { return response('Enter your first name, last name and a valid email address.', 400); }
  const records = await env.DB.prepare(`SELECT r.id AS participant_id, r.first_name, r.last_name, p.status FROM Runners r
    LEFT JOIN Passes p ON p.runner_id = r.id WHERE r.race_id = ? AND LOWER(TRIM(r.email)) = ? LIMIT 101`).bind(page.race_id, email).all<any>();
  if (records.results.length > 100) return response(NO_LOOKUP_MATCH);
  const matches = records.results.filter(row => normalizeLookupName(row.first_name) === first && normalizeLookupName(row.last_name) === last);
  if (matches.length !== 1 || matches[0].status !== 'issued') return response(NO_LOOKUP_MATCH);
  const pass = await env.DB.prepare('SELECT * FROM Passes WHERE runner_id = ?').bind(matches[0].participant_id).first<any>();
  if (!pass || pass.status !== 'issued') return response(NO_LOOKUP_MATCH);
  // Require the private package to be available. Never issue or email passes from public input.
  try { await ensureStoredPass(env, pass); }
  catch { return response('Your pass could not be opened right now. Please try again later or contact the event organizer.', 503); }
  // If the organizer disabled this page during submission, do not grant a new token.
  if ((await enabledLookupPage(env.DB, page.slug))?.race_id !== page.race_id) return new Response('Not found', { status: 404, headers: lookupHeaders });
  const token = await createPassLink(env, pass.runner_id);
  return new Response(null, { status: 303, headers: { ...lookupHeaders, Location: `/${token}` } });
}
