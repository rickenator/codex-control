import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  configureManagedAgentEnvironment,
  installMissingAgentFrontends,
  managedCodexExecutable,
  managedOpenInterpreterExecutable,
  type InstallCommandRequest,
  type InstallCommandResult,
} from '../src/main/startup-bootstrap.ts';
import type { AgentReadiness } from '../src/main/agent-readiness.ts';

function readiness(id: AgentReadiness['id'], installed: boolean): AgentReadiness {
  return {
    id,
    name: id,
    installed,
    authenticated: installed ? null : false,
    configuration: installed ? 'unknown' : 'required',
    selectable: installed,
    state: installed ? 'ready' : 'missing',
    diagnostic: installed ? 'ready' : 'missing',
    supportTier: id === 'codex' ? 'supported' : 'preview',
    checkedAt: 1,
  };
}

function ok(): InstallCommandResult {
  return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
}

test('managed agent paths are platform-specific', () => {
  assert.equal(managedCodexExecutable('/data', 'linux'), path.join('/data', 'agents', 'codex', 'node_modules', '.bin', 'codex'));
  assert.equal(managedCodexExecutable('C:\\data', 'win32'), path.win32.join('C:\\data', 'agents', 'codex', 'node_modules', '.bin', 'codex.cmd'));
  assert.equal(managedOpenInterpreterExecutable('/data', 'linux'), path.join('/data', 'agents', 'open-interpreter', 'bin', 'interpreter'));
  assert.equal(managedOpenInterpreterExecutable('C:\\data', 'win32'), path.win32.join('C:\\data', 'agents', 'open-interpreter', 'Scripts', 'interpreter.exe'));
});

test('managed executables are added to the environment when present', () => {
  const env: NodeJS.ProcessEnv = {};
  const expected = new Set([
    managedCodexExecutable('/data', 'linux'),
    managedOpenInterpreterExecutable('/data', 'linux'),
  ]);
  configureManagedAgentEnvironment('/data', env, 'linux', candidate => expected.has(candidate));
  assert.equal(env.CONSIGLIO_AGENT_HOME, path.join('/data', 'agents'));
  assert.equal(env.CODEX_BIN, managedCodexExecutable('/data', 'linux'));
  assert.equal(env.OI_BIN, managedOpenInterpreterExecutable('/data', 'linux'));
});

test('missing Codex and Open Interpreter are installed in user data', async () => {
  const env: NodeJS.ProcessEnv = {};
  const calls: InstallCommandRequest[] = [];
  const expectedFiles = new Set([
    managedCodexExecutable('/data', 'linux'),
    managedOpenInterpreterExecutable('/data', 'linux'),
  ]);
  const runner = async (request: InstallCommandRequest) => {
    calls.push(request);
    return ok();
  };
  const progress: string[] = [];
  const result = await installMissingAgentFrontends({
    readiness: [readiness('codex', false), readiness('open-interpreter', false)],
    userDataPath: '/data',
    env,
    platform: 'linux',
    runner,
    fileExists: candidate => expectedFiles.has(candidate),
    onProgress: update => progress.push(update.phase),
  });

  assert.deepEqual(result.map(entry => [entry.id, entry.installed]), [
    ['codex', true],
    ['open-interpreter', true],
  ]);
  assert.ok(calls.some(call => call.command === 'npm' && call.args.includes('@openai/codex')));
  assert.ok(calls.some(call => call.args.includes('open-interpreter')));
  assert.deepEqual(progress, ['installing-codex', 'installing-open-interpreter']);
  assert.equal(env.CODEX_BIN, managedCodexExecutable('/data', 'linux'));
  assert.equal(env.OI_BIN, managedOpenInterpreterExecutable('/data', 'linux'));
});

test('installed front ends are not reinstalled', async () => {
  let calls = 0;
  const result = await installMissingAgentFrontends({
    readiness: [readiness('codex', true), readiness('open-interpreter', true)],
    userDataPath: '/data',
    platform: 'linux',
    runner: async () => { calls += 1; return ok(); },
    fileExists: () => false,
  });
  assert.equal(calls, 0);
  assert.ok(result.every(entry => entry.installed && !entry.attempted));
});
