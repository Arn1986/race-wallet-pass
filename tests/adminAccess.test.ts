import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair } from 'jose';
import worker from '../worker/index.ts';
import { authorizeRequest } from '../worker/adminAccess.ts';
import { accessConfig, accessToken, signAccess } from './accessFixture.ts';

test('public host only accepts exact token delivery routes, regardless of identity headers', async () => {
  for (const path of ['/', '/index.html', '/lookup', '/assets/main.js', '/api/settings', '/api/d1/query', '/api/runners', '/api/lookup', '/api/pass/link/runner', '/pass/runner', '/passes/runner']) {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const res = await worker.fetch(new Request(`${accessConfig.PUBLIC_DOMAIN}${path}`, {
        method, headers: { 'Cf-Access-Jwt-Assertion': accessToken },
      }), accessConfig as any, {} as any);
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    }
  }
  for (const suffix of ['', '/apple', '/google']) {
    assert.equal(await authorizeRequest(new Request(`${accessConfig.PUBLIC_DOMAIN}/${'a'.repeat(43)}${suffix}`), accessConfig), null);
  }
  for (const path of [`/${'a'.repeat(42)}`, `/${'a'.repeat(43)}/anything`, `/${'a'.repeat(43)}/apple/more`]) {
    assert.equal((await authorizeRequest(new Request(accessConfig.PUBLIC_DOMAIN + path), accessConfig))?.status, 404);
  }
});

test('unknown hosts and alternate Worker URLs cannot reach assets or APIs', async () => {
  for (const host of ['https://race.workers.dev', 'https://version-race.workers.dev', 'https://other.example.org', 'http://example.com']) {
    const response = await worker.fetch(new Request(host + '/api/settings', {
      headers: { 'Cf-Access-Jwt-Assertion': accessToken, 'X-Forwarded-Host': 'example.com' },
    }), accessConfig as any, {} as any);
    assert.equal(response.status, 404);
  }
});

test('admin gate verifies signature, issuer, audience, expiry and required claims', async () => {
  const check = (token?: string, config = accessConfig) => authorizeRequest(new Request(accessConfig.ADMIN_DOMAIN + '/api/settings', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  }), config);
  assert.equal(await check(accessToken), null);
  const { privateKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ sub: 'fake', iat: 1, exp: 9999999999, iss: accessConfig.ACCESS_TEAM_DOMAIN, aud: accessConfig.ACCESS_AUD })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
  for (const token of [undefined, 'garbage', forged, await signAccess({ aud: 'other-app' }),
    await signAccess({ iss: 'https://attacker.cloudflareaccess.com' }), await signAccess({ exp: 1 }),
    await signAccess({ exp: undefined }), await signAccess({ nbf: 9999999999 })]) {
    assert.equal((await check(token))?.status, 403);
  }
  assert.equal((await check(accessToken, { ...accessConfig, ACCESS_AUD: '' }))?.status, 503);
  assert.equal((await check(accessToken, { ...accessConfig, ACCESS_TEAM_DOMAIN: 'https://attacker.org' }))?.status, 503);
  assert.equal((await check(accessToken, { ...accessConfig, ADMIN_DOMAIN: '' }))?.status, 404);
});

test('admin assets and APIs both require Access; authorized assets can load', async () => {
  let calls = 0;
  const env = { ...accessConfig, ASSETS: { async fetch() { calls++; return new Response('Admin app'); } } };
  for (const path of ['/', '/index.html', '/assets/main.js', '/api/settings']) {
    for (const method of ['GET', 'OPTIONS']) {
      const res = await worker.fetch(new Request(accessConfig.ADMIN_DOMAIN + path, { method }), env as any, {} as any);
      assert.equal(res.status, 403);
    }
  }
  assert.equal(calls, 0);
  const res = await worker.fetch(new Request(accessConfig.ADMIN_DOMAIN, {
    headers: { 'Cf-Access-Jwt-Assertion': accessToken },
  }), env as any, {} as any);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Admin app');
  assert.equal(calls, 1);
});
