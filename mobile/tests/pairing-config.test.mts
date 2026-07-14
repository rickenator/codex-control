import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePairingConfig, parsePairingUri } from '../src/pairing-config.ts';

const token = 'a'.repeat(64);

test('normalizes secure and local-development pairing configurations', () => {
  assert.deepEqual(
    normalizePairingConfig({ endpoint: ' https://bridge.example.test/path/#ignored ', token: ` ${token} ` }),
    { endpoint: 'https://bridge.example.test/path', token },
  );
  assert.equal(normalizePairingConfig({ endpoint: 'http://127.0.0.1:43117/', token }).endpoint, 'http://127.0.0.1:43117');
});

test('rejects unsafe endpoints, embedded credentials, and short tokens', () => {
  assert.throws(() => normalizePairingConfig({ endpoint: 'http://bridge.example.test', token }), /HTTPS/);
  assert.throws(() => normalizePairingConfig({ endpoint: 'https://user:pass@bridge.example.test', token }), /credentials/);
  assert.throws(() => normalizePairingConfig({ endpoint: 'https://bridge.example.test', token: 'short' }), /at least 32/);
});

test('parses only the versioned Consiglio pairing URI shape', () => {
  const uri = `consiglio://pair/v1?endpoint=${encodeURIComponent('https://bridge.example.test/path')}&token=${token}`;
  assert.deepEqual(parsePairingUri(uri), { endpoint: 'https://bridge.example.test/path', token });
  assert.throws(() => parsePairingUri(uri + '&extra=true'), /unexpected fields/);
  assert.throws(() => parsePairingUri(uri.replace('/v1?', '/v2?')), /not a supported/);
  assert.throws(() => parsePairingUri(uri.replace('consiglio:', 'https:')), /not a supported/);
  assert.throws(() => parsePairingUri(uri.replace(token, 'z'.repeat(64))), /QR pairing token is invalid/);
  assert.throws(() => parsePairingUri('x'.repeat(4_097)), /too large/);
});
