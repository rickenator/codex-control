import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { isSafeExternalUrl, isTrustedRendererUrl, resolveRendererAsset } from '../src/main/app-protocol.ts';

const rendererRoot = path.resolve('dist/renderer');

test('resolves renderer files within the application origin', () => {
  assert.equal(
    resolveRendererAsset(rendererRoot, 'consiglio://app/assets/index.js'),
    path.join(rendererRoot, 'assets', 'index.js'),
  );
  assert.equal(resolveRendererAsset(rendererRoot, 'consiglio://app/'), path.join(rendererRoot, 'index.html'));
});

test('rejects foreign origins and encoded path traversal', () => {
  assert.equal(resolveRendererAsset(rendererRoot, 'https://app/index.html'), null);
  assert.equal(resolveRendererAsset(rendererRoot, 'consiglio://other/index.html'), null);
  assert.equal(resolveRendererAsset(rendererRoot, 'consiglio://app/%2e%2e%2fsecret.txt'), null);
  assert.equal(resolveRendererAsset(rendererRoot, 'not a url'), null);
});

test('recognizes only the application renderer origin', () => {
  assert.equal(isTrustedRendererUrl('consiglio://app/index.html'), true);
  assert.equal(isTrustedRendererUrl('consiglio://other/index.html'), false);
  assert.equal(isTrustedRendererUrl('https://app/index.html'), false);
});

test('allows credential-free HTTPS links only', () => {
  assert.equal(isSafeExternalUrl('https://github.com/rickenator/Consiglio'), true);
  assert.equal(isSafeExternalUrl('http://github.com/rickenator/Consiglio'), false);
  assert.equal(isSafeExternalUrl('https://user:secret@example.com/'), false);
  assert.equal(isSafeExternalUrl('file:///tmp/example'), false);
});
