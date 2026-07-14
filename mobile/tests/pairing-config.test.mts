import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePairingConfig } from '../src/pairing-config.ts';

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
