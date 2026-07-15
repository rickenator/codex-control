import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentApprovalRouter } from '../src/main/approval-router.ts';

function approval(id: string, sessionId: string) {
  return {
    id,
    sessionId,
    command: 'npm test',
    workingDir: '/tmp/project',
    timestamp: 1,
    status: 'pending' as const,
  };
}

test('routes a decision once to the exact owning session', async () => {
  const router = new AgentApprovalRouter();
  const calls: string[] = [];
  const target = {
    async resolveApproval(sessionId: string, approvalId: string, approved: boolean) {
      calls.push(`${sessionId}:${approvalId}:${approved}`);
      return true;
    },
  };

  assert.equal(router.register(approval('approval-1', 'session-1'), target), true);
  assert.deepEqual(router.pendingIds(), ['approval-1']);

  const result = await router.resolve('approval-1', true);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['session-1:approval-1:true']);
  assert.deepEqual(router.pendingIds(), []);

  const replay = await router.resolve('approval-1', false);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'already-resolved');
  assert.equal(calls.length, 1);
});

test('rejects cross-session decisions without touching the target', async () => {
  const router = new AgentApprovalRouter();
  let called = false;
  const target = {
    async resolveApproval() {
      called = true;
      return true;
    },
  };

  router.register(approval('approval-2', 'session-2'), target);
  const result = await router.resolve('approval-2', true, 'session-other');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cross-session');
  assert.equal(called, false);
  assert.deepEqual(router.pendingIds('session-2'), ['approval-2']);
});

test('restores a pending approval when the owning adapter rejects the write', async () => {
  const router = new AgentApprovalRouter();
  let accepts = false;
  const target = {
    async resolveApproval() {
      return accepts;
    },
  };

  router.register(approval('approval-3', 'session-3'), target);
  const failed = await router.resolve('approval-3', false);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'target-rejected');
  assert.deepEqual(router.pendingIds(), ['approval-3']);

  accepts = true;
  const retried = await router.resolve('approval-3', false);
  assert.equal(retried.ok, true);
});

test('session cleanup removes pending IDs and tombstones them against replay', async () => {
  const router = new AgentApprovalRouter();
  const target = { async resolveApproval() { return true; } };

  router.register(approval('approval-4', 'session-4'), target);
  router.register(approval('approval-5', 'session-5'), target);

  assert.deepEqual(router.clearSession('session-4'), ['approval-4']);
  assert.deepEqual(router.pendingIds(), ['approval-5']);

  const stale = await router.resolve('approval-4', true);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'already-resolved');
});

test('duplicate registration cannot replace an approval owner', () => {
  const router = new AgentApprovalRouter();
  const target = { async resolveApproval() { return true; } };
  assert.equal(router.register(approval('approval-6', 'session-6'), target), true);
  assert.equal(router.register(approval('approval-6', 'session-other'), target), false);
  assert.deepEqual(router.pendingIds('session-6'), ['approval-6']);
});
