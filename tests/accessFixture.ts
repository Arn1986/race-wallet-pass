import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authorizeRequest } from '../worker/adminAccess.ts';

export const accessConfig = {
  PUBLIC_DOMAIN: 'https://walletpass.3fstriders.org',
  ADMIN_DOMAIN: 'https://example.com',
  ACCESS_TEAM_DOMAIN: 'https://race-test.cloudflareaccess.com',
  ACCESS_AUD: 'test-admin-audience',
};
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
export async function signAccess(overrides: Record<string, any> = {}) {
  return new SignJWT({ sub: 'organizer', iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, iss: accessConfig.ACCESS_TEAM_DOMAIN,
    aud: accessConfig.ACCESS_AUD, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
}
export const accessToken = await signAccess();
// Warm the real verifier's JWKS cache before individual tests mock provider fetches.
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  if (String(input) !== `${accessConfig.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) throw new Error('Unexpected fetch');
  return Response.json({ keys: [jwk] });
};
try {
  const result = await authorizeRequest(new Request(accessConfig.ADMIN_DOMAIN, {
    headers: { 'Cf-Access-Jwt-Assertion': accessToken },
  }), accessConfig);
  if (result) throw new Error(`Test JWT verification failed: ${result.status}`);
} finally { globalThis.fetch = previousFetch; }
