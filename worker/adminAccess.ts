import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AccessConfig {
  PUBLIC_DOMAIN: string;
  ADMIN_DOMAIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const PASS_PATH = /^\/([A-Za-z0-9_-]{43})(?:\/(apple|google))?$/;

function origin(value: string | undefined): string | null {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

function denied(status: number, message: string): Response {
  return new Response(message, { status, headers: {
    'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8',
  } });
}

// Return null only when routing may proceed. Never trust identity headers alone.
export async function authorizeRequest(request: Request, env: AccessConfig): Promise<Response | null> {
  const url = new URL(request.url);
  const publicOrigin = origin(env.PUBLIC_DOMAIN);
  const adminOrigin = origin(env.ADMIN_DOMAIN);
  if (url.origin === publicOrigin) {
    return PASS_PATH.test(url.pathname) ? null : denied(404, 'Not found');
  }
  if (!adminOrigin || adminOrigin === publicOrigin || url.origin !== adminOrigin) {
    return denied(404, 'Not found');
  }
  const issuer = origin(env.ACCESS_TEAM_DOMAIN);
  if (!issuer || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(new URL(issuer).hostname) || !env.ACCESS_AUD?.trim()) {
    return denied(503, 'Organizer access is not configured');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return denied(403, 'Cloudflare Access login required');
  try {
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(issuer, keys);
    }
    await jwtVerify(token, keys, {
      issuer, audience: env.ACCESS_AUD.trim(), algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    return null;
  } catch {
    return denied(403, 'Cloudflare Access authentication failed');
  }
}
