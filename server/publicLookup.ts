export interface LookupPageSettings { slug: string; enabled: boolean }
const reserved = new Set(['api', 'assets', 'admin', 'lookup', 'pass', 'passes', 'index', 'robots', 'favicon', 'cdn-cgi']);
export function isLookupSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug) && slug.length !== 43 && !reserved.has(slug);
}
export function lookupSlugFromPath(path: string): string | null {
  const slug = path.slice(1);
  return path.startsWith('/') && isLookupSlug(slug) ? slug : null;
}
export function validateLookupSettings(input: any): LookupPageSettings {
  if (typeof input?.enabled !== 'boolean' || typeof input?.slug !== 'string') throw new Error('Choose whether the page is enabled and enter a URL slug');
  const slug = input.slug.trim().toLowerCase();
  if (!isLookupSlug(slug)) throw new Error('Use 3–60 lowercase letters, numbers or hyphens, starting and ending with a letter or number. Reserved names and 43-character slugs are unavailable.');
  return { slug, enabled: input.enabled };
}
export function normalizeLookupName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
export const NO_LOOKUP_MATCH = 'We could not find a ready pass for those details. Check your registration name and email, or contact the event organizer.';
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export const lookupHeaders = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY',
  // Some browsers apply form-action to the redirect chain, including Google sign-in.
  // The form itself posts only to our slug; the 303 changes subsequent navigation to GET.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.google.com; base-uri 'none'; frame-ancestors 'none'",
};
export function renderLookupPage(eventName: string, slug: string, message = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Find your wallet pass · ${escape(eventName)}</title>
  <style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0f172a;color:#f8fafc;font:16px/1.6 Arial,sans-serif;padding:36px 18px}main{max-width:520px;margin:5vh auto;background:#1e293b;border:1px solid #334155;border-radius:24px;overflow:hidden}header{padding:30px;background:#0369a1}.brand{font-size:12px;font-weight:bold;letter-spacing:3px;color:#e0f2fe}h1{font-size:28px;line-height:1.2;margin:14px 0 8px}.event{margin:0;color:#e0f2fe;overflow-wrap:anywhere}.content{padding:28px}p{margin:0 0 20px;color:#cbd5e1}label{display:block;font-weight:bold;margin-bottom:18px}input{display:block;width:100%;margin-top:6px;border:1px solid #64748b;border-radius:10px;padding:12px;font:inherit;background:#0f172a;color:white}input:focus{outline:3px solid #38bdf8;outline-offset:2px}button{width:100%;border:0;border-radius:12px;padding:15px;font:700 16px Arial,sans-serif;background:#38bdf8;color:#0f172a;cursor:pointer}.notice{padding:14px;background:#172554;border:1px solid #60a5fa;color:#dbeafe;border-radius:12px}.small{font-size:12px;margin-top:18px;margin-bottom:0;color:#cbd5e1}footer{text-align:center;padding:0 28px 24px;color:#94a3b8;font-size:12px}</style></head>
  <body><main><header><div class="brand">3F STRIDERS</div><h1>Find your wallet pass</h1><p class="event">${escape(eventName)}</p></header><div class="content"><p>Enter your details exactly as registered for this event.</p>${message ? `<p class="notice" role="alert">${escape(message)}</p>` : ''}
  <form action="/${escape(slug)}" method="post"><label>First name<input name="first_name" autocomplete="given-name" maxlength="200" required></label><label>Last name<input name="last_name" autocomplete="family-name" maxlength="200" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button type="submit">Find my wallet pass</button></form><p class="small">A matching, ready pass opens directly. If your registration needs updating, contact the event organizer.</p></div><footer>Apple Wallet &amp; Google Wallet · 3F Striders</footer></main></body></html>`;
}
