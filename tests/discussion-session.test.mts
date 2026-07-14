import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentSessionOptions,
  EventEmitters,
} from '../src/main/agent-adapter.ts';
import {
  DiscussionSession,
  type DiscussionAdapterFactory,
  type DiscussionMessage,
} from '../src/main/discussion-session.ts';

class FakeAdapter implements AgentAdapter {
  private sessionId = '';
  private turn = 0;
  private readonly agentId: string;
  private readonly emitters: EventEmitters;
  private readonly mode: 'direct' | 'streamed';

  constructor(
    agentId: string,
    emitters: EventEmitters,
    mode: 'direct' | 'streamed',
  ) {
    this.agentId = agentId;
    this.emitters = emitters;
    this.mode = mode;
  }

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    this.sessionId = `${this.agentId}-session`;
    return {
      sessionId: this.sessionId,
      pty: null,
      repository: options.repository,
      branch: options.branch || '',
      adapter: this,
    };
  }

  async sendPrompt(_sessionId: string, _input: string): Promise<string> {
    this.turn += 1;
    const response = `${this.agentId} response ${this.turn}`;

    if (this.mode === 'direct') return response;

    queueMicrotask(() => {
      const event: AgentEvent = {
        id: `${this.agentId}-${this.turn}`,
        type: 'response',
        content: response,
        timestamp: Date.now(),
        session_id: this.sessionId,
      };
      this.emitters.emitEvent(event);
    });
    return '';
  }

  async stopSession(): Promise<boolean> {
    return true;
  }

  async reconnectSession(): Promise<boolean> {
    return false;
  }
}

function fakeFactory(modes: Record<string, 'direct' | 'streamed'>): DiscussionAdapterFactory {
  return (agentId, emitters) => new FakeAdapter(agentId, emitters, modes[agentId] || 'direct');
}

function collectMessages() {
  const messages: DiscussionMessage[] = [];
  const errors: string[] = [];
  return {
    messages,
    errors,
    emitters: {
      emitMessage: (message: DiscussionMessage) => messages.push(message),
      emitEvent: () => {},
      emitError: (error: string) => errors.push(error),
    },
  };
}

test('captures streamed adapter responses in a discussion turn', async () => {
  const output = collectMessages();
  const discussion = await DiscussionSession.create({
    repository: process.cwd(),
    agents: [{ id: 'open-interpreter' }],
    maxTurns: 1,
    adapterFactory: fakeFactory({ 'open-interpreter': 'streamed' }),
    responseTimeoutMs: 500,
    responseStableMs: 10,
  }, output.emitters);

  const history = await discussion.sendMessage('Write a small Python function.');

  assert.equal(output.errors.length, 0);
  assert.deepEqual(history.map(message => message.role), ['user', 'agent']);
  assert.equal(history[1]?.agentId, 'open-interpreter');
  assert.equal(history[1]?.content, 'open-interpreter response 1');
});

test('handles direct and streamed agents in deterministic round-robin order', async () => {
  const output = collectMessages();
  const discussion = await DiscussionSession.create({
    repository: process.cwd(),
    agents: [{ id: 'codex' }, { id: 'aider' }],
    maxTurns: 2,
    adapterFactory: fakeFactory({ codex: 'direct', aider: 'streamed' }),
    responseTimeoutMs: 500,
    responseStableMs: 10,
  }, output.emitters);

  const history = await discussion.sendMessage('Review this repository.');
  const agentMessages = history.filter(message => message.role === 'agent');

  assert.equal(output.errors.length, 0);
  assert.deepEqual(agentMessages.map(message => message.agentId), ['codex', 'aider']);
  assert.deepEqual(agentMessages.map(message => message.content), [
    'codex response 1',
    'aider response 1',
  ]);
});

test('captures a streamed synthesis response', async () => {
  const output = collectMessages();
  const discussion = await DiscussionSession.create({
    repository: process.cwd(),
    agents: [{ id: 'codex' }, { id: 'open-interpreter' }],
    maxTurns: 1,
    synthesisAgent: 'open-interpreter',
    adapterFactory: fakeFactory({ codex: 'direct', 'open-interpreter': 'streamed' }),
    responseTimeoutMs: 500,
    responseStableMs: 10,
  }, output.emitters);

  const history = await discussion.sendMessage('Reach a recommendation.');
  const synthesis = history.find(message => message.role === 'synthesis');

  assert.equal(output.errors.length, 0);
  assert.equal(synthesis?.agentId, 'open-interpreter');
  assert.equal(synthesis?.content, 'open-interpreter response 1');
});

test('resets the turn budget for each new user message', async () => {
  const output = collectMessages();
  const discussion = await DiscussionSession.create({
    repository: process.cwd(),
    agents: [{ id: 'codex' }],
    maxTurns: 1,
    adapterFactory: fakeFactory({ codex: 'direct' }),
  }, output.emitters);

  await discussion.sendMessage('First question.');
  const history = await discussion.sendMessage('Second question.');

  assert.equal(output.errors.length, 0);
  assert.deepEqual(history.map(message => message.role), ['user', 'agent', 'user', 'agent']);
  assert.deepEqual(
    history.filter(message => message.role === 'agent').map(message => message.content),
    ['codex response 1', 'codex response 2'],
  );
});

test('rejects a second message while a streamed turn is still running', async () => {
  const output = collectMessages();
  const discussion = await DiscussionSession.create({
    repository: process.cwd(),
    agents: [{ id: 'aider' }],
    maxTurns: 1,
    adapterFactory: fakeFactory({ aider: 'streamed' }),
    responseTimeoutMs: 1_000,
    responseStableMs: 200,
  }, output.emitters);

  const firstMessage = discussion.sendMessage('First question.');
  await assert.rejects(
    discussion.sendMessage('Overlapping question.'),
    /already processing a message/,
  );
  await firstMessage;

  assert.equal(output.errors.length, 0);
});
