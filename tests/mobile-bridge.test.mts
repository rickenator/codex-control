import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentApprovalRouter } from '../src/main/approval-router.ts';
import { startMobileBridge } from '../src/main/mobile-bridge.ts';

const token = 'test-token-that-is-at-least-32-characters-long';

test('mobile bridge requires authentication and routes approvals to their owner', async () => {
  const calls: string[] = [];
  const approvalRouter = new AgentApprovalRouter();
  approvalRouter.register({
    id: 'approval-1',
    sessionId: 'session-1',
    command: 'npm test',
    workingDir: '/tmp/project',
    timestamp: 1,
    status: 'pending',
  }, {
    async resolveApproval(sessionId, approvalId, approved) {
      calls.push(`route:${sessionId}:${approvalId}:${approved}`);
      return true;
    },
  });

  const bridge = await startMobileBridge({
    token,
    port: 0,
    approvalRouter,
    actions: {
      listSessions: () => [{ id: 'session-1', status: 'running' }],
      getSessionEvents: id => [{ id: 'event-1', session_id: id }],
      sendInput: (id, input) => { calls.push(`input:${id}:${input}`); return true; },
      reconnectSession: id => { calls.push(`reconnect:${id}`); return true; },
      stopSession: id => { calls.push(`stop:${id}`); return true; },
      getPendingApprovals: () => { calls.push('legacy:get-pending'); return []; },
      approveCommand: id => { calls.push(`legacy:approve:${id}`); return true; },
      rejectCommand: id => { calls.push(`legacy:reject:${id}`); return true; },
    },
  });
  const url = `http://${bridge.host}:${bridge.port}`;
  try {
    assert.equal((await fetch(`${url}/v1/sessions`)).status, 401);
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${url}/v1/sessions`, { headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
    const sessions = await (await fetch(`${url}/v1/sessions`, { headers })).json();
    assert.deepEqual(sessions, [{ id: 'session-1', status: 'running' }]);

    const input = await fetch(`${url}/v1/sessions/session-1/input`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'keep going' }),
    });
    assert.deepEqual(await input.json(), { ok: true });

    const pending = await (await fetch(`${url}/v1/approvals?sessionId=session-1`, { headers })).json();
    assert.deepEqual(pending, [{
      id: 'approval-1',
      sessionId: 'session-1',
      command: 'npm test',
      workingDir: '/tmp/project',
      timestamp: 1,
      status: 'pending',
    }]);

    const approved = await fetch(`${url}/v1/approvals/approval-1/approve`, { method: 'POST', headers });
    assert.equal(approved.status, 200);
    assert.deepEqual(await approved.json(), { ok: true });
    assert.deepEqual(calls, [
      'input:session-1:keep going',
      'route:session-1:approval-1:true',
    ]);

    const replay = await fetch(`${url}/v1/approvals/approval-1/reject`, { method: 'POST', headers });
    assert.equal(replay.status, 409);
    assert.deepEqual(await replay.json(), { ok: false, error: 'already-resolved' });
  } finally {
    await bridge.close();
  }
});

test('mobile bridge rejects short tokens and non-loopback binds', async () => {
  const actions = {} as Parameters<typeof startMobileBridge>[0]['actions'];
  await assert.rejects(() => startMobileBridge({ token: 'short', actions }), /at least 32/);
  await assert.rejects(() => startMobileBridge({ token, host: '0.0.0.0', actions }), /loopback/);
});
