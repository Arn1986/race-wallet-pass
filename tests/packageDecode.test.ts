import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeApplePackage } from '../worker/passDelivery.ts';

test('native package decoder preserves every byte of a large binary package', () => {
  const bytes = new Uint8Array(512 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  bytes.set([80, 75, 3, 4]);
  assert.deepEqual(decodeApplePackage(Buffer.from(bytes).toString('base64')), bytes);
});

test('fallback decoder supports runtimes without Uint8Array.fromBase64 and preserves binary bytes', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: undefined });
  try {
    const bytes = new Uint8Array(256 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
    bytes.set([80, 75, 3, 4]);
    assert.deepEqual(decodeApplePackage(Buffer.from(bytes).toString('base64')), bytes);
    assert.throws(() => decodeApplePackage('not base64!'));
  } finally {
    if (descriptor) Object.defineProperty(Uint8Array, 'fromBase64', descriptor);
    else delete (Uint8Array as any).fromBase64;
  }
});

test('decoder rejects empty, truncated and non-PK packages', () => {
  for (const bytes of [[], [80,75], [80,75,5,6], [255,0,1,2]]) {
    assert.throws(() => decodeApplePackage(Buffer.from(bytes).toString('base64')), /invalid pkpass/);
  }
  assert.throws(() => decodeApplePackage('not base64!'));
});
