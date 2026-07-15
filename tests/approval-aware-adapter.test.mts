import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApprovalAwareAdapter,
  sanitizeApprovalArgs,
  type AdapterCore,
} from '../src/main/approval-aware-adapter.ts';
import { agentApprovalRouter } from '../src/main/approval-router.ts';

function fakeCore(writes: string[], buildArgs: string[] = []): AdapterCore & { buildLaunchArgs: () => string[] } {
  const pty = {
    write(value: string) { writes.push(value); },
    kill() {},
  };

  return {
    buildLaunchArgs: () => [...buildArgs],
    async launch(options) {
      return {
        sessionId: 'session-1',
        pty: pty as never,
        repository: options.repository,
        branch: options.branch || '',
        adapter: this as never,
      };
    },
    async sendPrompt() { return ''; },
    async stopSession() { return true; },
    async reconnectSession() { return false; },
  };
}

function pendingApproval(id = 'approval-1', sessionId = 'session-1') {
  return {
    id,
    sessionId,
    command: 'npm test',
    workingDir: '/tmp/project',
    timestamp: 1,
    status: 'pending' as const,
  };
}

test('approval-aware adapter writes approve and reject responses exactly once', async () => {
  agentApprovalRouter.reset();
  const writes: string[] = [];
  const adapter = new ApprovalAwareAdapter('aider', fakeCore(writes, ['--yes', '--git']));
  await adapter.launch({ repository: '/tmp/project', branch: 'main', agent: 'aider' });

  assert.equal(adapter.trackApproval(pendingApproval('approval-approve')), true);
  assert.equal((await agentApprovalRouter.resolve('approval-approve', true)).ok, true);
  assert.deepEqual(writes, ['y\n']);
  assert.equal((await agentApprovalRouter.resolve('approval-approve', false)).reason, 'already-resolved');

  assert.equal(adapter.trackApproval(pendingApproval('approval-reject')), true);
  assert.equal((await agentApprovalRouter.resolve('approval-reject', false)).ok, true);
  assert.deepEqual(writes, ['y\n', 'n\n']);
  agentApprovalRouter.reset();
});

test('adapter rejects approval IDs owned by another session', async () => {
  agentApprovalRouter.reset();
  const writes: string[] = [];
  const adapter = new ApprovalAwareAdapter('open-interpreter', fakeCore(writes));
  await adapter.launch({ repository: '/tmp/project', agent: 'open-interpreter' });
  adapter.trackApproval(pendingApproval('approval-cross'));

  assert.equal(await adapter.resolveApproval('session-other', 'approval-cross', true), false);
  assert.deepEqual(writes, []);
  assert.deepEqual(agentApprovalRouter.pendingIds(), ['approval-cross']);
  agentApprovalRouter.reset();
});

test('stopping a session clears pending approvals', async () => {
  agentApprovalRouter.reset();
  const adapter = new ApprovalAwareAdapter('claude-code', fakeCore([]));
  await adapter.launch({ repository: '/tmp/project', agent: 'claude-code' });
  adapter.trackApproval(pendingApproval('approval-stop'));

  assert.deepEqual(agentApprovalRouter.pendingIds(), ['approval-stop']);
  assert.equal(await adapter.stopSession('session-1'), true);
  assert.deepEqual(agentApprovalRouter.pendingIds(), []);
  assert.equal((await agentApprovalRouter.resolve('approval-stop', true)).reason, 'already-resolved');
  agentApprovalRouter.reset();
});

test('forbidden global auto-approval flags are removed', () => {
  assert.deepEqual(
    sanitizeApprovalArgs('aider', ['--model', 'x', '--yes', '--git']),
    ['--model', 'x', '--git'],
  );
  assert.deepEqual(
    sanitizeApprovalArgs('claude-code', ['--yes', '--model', 'sonnet']),
    ['--model', 'sonnet'],
  );
  assert.deepEqual(
    sanitizeApprovalArgs('open-interpreter', ['--auto_run', '--model', 'x']),
    ['--model', 'x', '--no_auto_run'],
  );
});
