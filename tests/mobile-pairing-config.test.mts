import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeMobileBridgePort,
  normalizeMobileBridgePublicUrl,
} from '../src/main/mobile-pairing-config.ts';

test('mobile pairing accepts valid ports and credential-free HTTPS URLs', () => {
  assert.equal(normalizeMobileBridgePort('43117'), 43117);
  assert.equal(normalizeMobileBridgePort(65_535), 65_535);
  assert.equal(normalizeMobileBridgePublicUrl(' https://consiglio.example.test/mobile/#pair '), 'https://consiglio.example.test/mobile');
  assert.equal(normalizeMobileBridgePublicUrl(''), '');
});

test('mobile pairing rejects unsafe URLs and invalid ports', () => {
  for (const port of [0, 65_536, 'abc', '43117px', 3.5]) {
    assert.throws(() => normalizeMobileBridgePort(port), /integer from 1 to 65535/);
  }
  for (const url of ['http://consiglio.example.test', 'ftp://consiglio.example.test', 'https://user:pass@consiglio.example.test', 'not a url']) {
    assert.throws(() => normalizeMobileBridgePublicUrl(url), /URL/);
  }
});
