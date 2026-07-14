import assert from 'node:assert/strict';
import test from 'node:test';

import { startMobileBridge } from '../src/main/mobile-bridge.ts';

const token = 'test-token-that-is-at-least-32-characters-long';

test('mobile bridge requires authentication and exposes only companion actions', async () => {
  const calls: string[] = [];
  const bridge = await startMobileBridge({
    token,
    port: 0,
    actions: {
      listSessions: () => [{ id: 'session-1', status: 'running' }],
      getSessionEvents: id => [{ id: 'event-1', session_id: id }],
      sendInput: (id, input) => { calls.push(`input:${id}:${input}`); return true; },
      reconnectSession: id => { calls.push(`reconnect:${id}`); return true; },
      stopSession: id => { calls.push(`stop:${id}`); return true; },
      getPendingApprovals: id => [{ id: 'approval-1', sessionId: id }],
      approveCommand: id => { calls.push(`approve:${id}`); return true; },
      rejectCommand: id => { calls.push(`reject:${id}`); return true; },
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
    assert.deepEqual(calls, ['input:session-1:keep going']);
  } finally {
    await bridge.close();
  }
});

test('mobile bridge rejects short tokens and non-loopback binds', async () => {
  const actions = {} as Parameters<typeof startMobileBridge>[0]['actions'];
  await assert.rejects(() => startMobileBridge({ token: 'short', actions }), /at least 32/);
  await assert.rejects(() => startMobileBridge({ token, host: '0.0.0.0', actions }), /loopback/);
});
