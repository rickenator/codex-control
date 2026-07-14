import assert from 'node:assert/strict';
import test from 'node:test';

import { codexExecutableCandidates, commandForExecutable, resolveCodexCommand } from '../src/main/platform.ts';

test('finds Codex in standard macOS GUI installation directories', () => {
  const candidates = codexExecutableCandidates({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin' },
    homeDirectory: '/Users/alice',
  });

  assert.ok(candidates.includes('/usr/local/bin/codex'));
  assert.ok(candidates.includes('/opt/homebrew/bin/codex'));
  assert.ok(candidates.includes('/Users/alice/.local/bin/codex'));
});

test('finds npm-installed Codex on Windows', () => {
  const candidates = codexExecutableCandidates({
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\System32',
      APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
    },
    homeDirectory: 'C:\\Users\\alice',
  });

  assert.ok(candidates.includes('C:\\Users\\alice\\AppData\\Roaming\\npm\\codex.cmd'));
});

test('wraps Windows command shims with the command processor', () => {
  assert.deepEqual(
    commandForExecutable('C:\\Users\\alice\\AppData\\Roaming\\npm\\codex.cmd', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }),
    {
      executable: 'C:\\Windows\\cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'C:\\Users\\alice\\AppData\\Roaming\\npm\\codex.cmd'],
      displayPath: 'C:\\Users\\alice\\AppData\\Roaming\\npm\\codex.cmd',
    },
  );
});

test('respects an explicit executable and returns null when no candidate exists', () => {
  const explicit = resolveCodexCommand({
    requested: '/custom/codex',
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    homeDirectory: '/home/alice',
    fileExists: candidate => candidate === '/custom/codex',
  });
  assert.equal(explicit?.displayPath, '/custom/codex');

  const missing = resolveCodexCommand({
    platform: 'linux',
    env: { PATH: '/empty' },
    homeDirectory: '/home/alice',
    fileExists: () => false,
  });
  assert.equal(missing, null);
});
