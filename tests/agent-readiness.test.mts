import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectAgentReadiness,
  type CommandProbeRequest,
  type CommandProbeResult,
  type CommandRunner,
} from '../src/main/agent-readiness.ts';

function result(overrides: Partial<CommandProbeResult> = {}): CommandProbeResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}

function commandKey(request: CommandProbeRequest): string {
  return [request.command, ...request.args].join(' ');
}

function runnerFor(
  outcomes: Record<string, CommandProbeResult | Error>,
  calls: string[] = [],
): CommandRunner {
  return async request => {
    const key = commandKey(request);
    calls.push(key);
    const outcome = outcomes[key];
    if (!outcome) return result({ exitCode: null, errorCode: 'ENOENT' });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
}

test('reports ready installed agents with versions and support tiers', async () => {
  const agents = await detectAgentReadiness({
    env: {},
    now: () => 1234,
    runner: runnerFor({
      'codex --version': result({ stdout: 'codex-cli 1.2.3\n' }),
      'codex login status': result({ stdout: 'Logged in using ChatGPT\n' }),
      'interpreter --version': result({ stdout: 'Open Interpreter 0.4.2\n' }),
      'aider --version': result({ stdout: 'aider 0.88.0\n' }),
      'claude --version': result({ stdout: '2.1.0 (Claude Code)\n' }),
      'gemini --version': result({ stdout: 'gemini-cli 1.0.0\n' }),
      'copilot --version': result({ stdout: 'copilot-cli 1.0.0\n' }),
      'q --version': result({ stdout: 'amazon-q 1.0.0\n' }),
    }),
  });

  assert.equal(agents.length, 7);
  assert.ok(agents.every(agent => agent.selectable));
  assert.ok(agents.every(agent => agent.checkedAt === 1234));

  const codex = agents.find(agent => agent.id === 'codex');
  assert.equal(codex?.authenticated, true);
  assert.equal(codex?.configuration, 'ready');
  assert.equal(codex?.supportTier, 'supported');
  assert.equal(codex?.version, 'codex-cli 1.2.3');

  const aider = agents.find(agent => agent.id === 'aider');
  assert.equal(aider?.authenticated, null);
  assert.equal(aider?.configuration, 'unknown');
  assert.equal(aider?.supportTier, 'preview');
});

test('reports missing CLIs without attempting follow-up authentication', async () => {
  const calls: string[] = [];
  const agents = await detectAgentReadiness({ env: {}, runner: runnerFor({}, calls) });

  assert.equal(agents.length, 7);
  assert.ok(agents.every(agent => agent.state === 'missing'));
  assert.ok(agents.every(agent => !agent.selectable));
  assert.deepEqual(calls.sort(), [
    'aider --version',
    'claude --version',
    'codex --version',
    'copilot --version',
    'gemini --version',
    'interpreter --version',
    'q --version',
  ]);
});

test('requires Codex authentication before selection', async () => {
  const agents = await detectAgentReadiness({
    env: {},
    runner: runnerFor({
      'codex --version': result({ stdout: 'codex-cli 1.2.3\n' }),
      'codex login status': result({ exitCode: 1, stderr: 'Not logged in. Run codex login.\n' }),
    }),
  });

  const codex = agents.find(agent => agent.id === 'codex');
  assert.equal(codex?.installed, true);
  assert.equal(codex?.authenticated, false);
  assert.equal(codex?.selectable, false);
  assert.equal(codex?.state, 'configuration-required');
  assert.match(codex?.diagnostic || '', /not logged in/i);
});

test('does not mistake a successful negative auth status for authentication', async () => {
  const agents = await detectAgentReadiness({
    env: {},
    runner: runnerFor({
      'codex --version': result({ stdout: 'codex-cli 1.2.3\n' }),
      'codex login status': result({ exitCode: 0, stdout: 'Not authenticated. Run codex login.\n' }),
    }),
  });

  const codex = agents.find(agent => agent.id === 'codex');
  assert.equal(codex?.authenticated, false);
  assert.equal(codex?.selectable, false);
  assert.equal(codex?.state, 'configuration-required');
});

test('uses explicit executable overrides for probes', async () => {
  const calls: string[] = [];
  const agents = await detectAgentReadiness({
    env: { AIDER_BIN: '/opt/tools/aider-custom' },
    runner: runnerFor({
      '/opt/tools/aider-custom --version': result({ stdout: 'aider custom\n' }),
    }, calls),
  });

  const aider = agents.find(agent => agent.id === 'aider');
  assert.equal(aider?.selectable, true);
  assert.ok(calls.includes('/opt/tools/aider-custom --version'));
});

test('accepts host-resolved commands with prefix arguments', async () => {
  const calls: string[] = [];
  const agents = await detectAgentReadiness({
    env: {},
    commandResolver: agentId => agentId === 'codex'
      ? { command: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'C:\\Tools\\codex.cmd'] }
      : null,
    runner: runnerFor({
      'cmd.exe /d /s /c C:\\Tools\\codex.cmd --version': result({ stdout: 'codex-cli 1.2.3\n' }),
      'cmd.exe /d /s /c C:\\Tools\\codex.cmd login status': result({ stdout: 'Logged in using ChatGPT\n' }),
    }, calls),
  });

  const codex = agents.find(agent => agent.id === 'codex');
  assert.equal(codex?.selectable, true);
  assert.ok(calls.includes('cmd.exe /d /s /c C:\\Tools\\codex.cmd --version'));
  assert.ok(calls.includes('cmd.exe /d /s /c C:\\Tools\\codex.cmd login status'));
});

test('isolates a timed-out agent check from the other results', async () => {
  const agents = await detectAgentReadiness({
    env: {},
    timeoutMs: 250,
    runner: runnerFor({
      'interpreter --version': result({ stdout: 'Open Interpreter 0.4.2\n' }),
      'aider --version': result({ exitCode: null, timedOut: true }),
    }),
  });

  const interpreter = agents.find(agent => agent.id === 'open-interpreter');
  const aider = agents.find(agent => agent.id === 'aider');
  assert.equal(interpreter?.state, 'ready');
  assert.equal(interpreter?.selectable, true);
  assert.equal(aider?.state, 'timeout');
  assert.equal(aider?.selectable, false);
  assert.match(aider?.diagnostic || '', /250 ms/);
});

test('returns partial readiness when one probe throws unexpectedly', async () => {
  const agents = await detectAgentReadiness({
    env: {},
    runner: runnerFor({
      'interpreter --version': result({ stdout: 'Open Interpreter 0.4.2\n' }),
      'claude --version': new Error('probe transport failed'),
    }),
  });

  assert.equal(agents.length, 7);
  const interpreter = agents.find(agent => agent.id === 'open-interpreter');
  const claude = agents.find(agent => agent.id === 'claude-code');
  assert.equal(interpreter?.selectable, true);
  assert.equal(claude?.state, 'error');
  assert.equal(claude?.selectable, false);
  assert.match(claude?.diagnostic || '', /probe transport failed/);
});
