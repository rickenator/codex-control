import type {
  AgentAdapter,
  AgentApproval,
  AgentEvent,
  AgentSession,
  AgentSessionOptions,
  EventEmitters,
} from './agent-adapter';

export type DiscussionAgentId = 'codex' | 'open-interpreter' | 'aider' | 'claude-code';

export interface DiscussionMessage {
  id: string;
  role: 'user' | 'agent' | 'synthesis';
  agentId?: string;
  content: string;
  timestamp: number;
}

export type DiscussionAdapterFactory = (
  agentId: DiscussionAgentId,
  emitters: EventEmitters,
) => AgentAdapter;

export interface DiscussionOptions {
  repository: string;
  branch?: string;
  agents: Array<{
    id: DiscussionAgentId;
    model?: string;
    customInstructions?: string;
  }>;
  maxTurns?: number;
  moderatorStrategy?: 'round-robin' | 'context-aware' | 'user-select';
  synthesisAgent?: 'codex' | 'open-interpreter';
  /** Test seam and future plugin hook. Omitted by normal renderer IPC calls. */
  adapterFactory?: DiscussionAdapterFactory;
  /** Maximum wait for an event-streamed response. */
  responseTimeoutMs?: number;
  /** Quiet period after the last response event before a turn is considered complete. */
  responseStableMs?: number;
}

export interface DiscussionEmitters {
  emitMessage(message: DiscussionMessage): void;
  emitEvent(event: AgentEvent): void;
  emitError(error: string): void;
  emitApproval?(approval: AgentApproval): void;
  emitTerminalOutput?(sessionId: string, data: string): void;
}

interface DiscussionState {
  sessionId: string;
  messages: DiscussionMessage[];
  agents: Map<string, AgentSession>;
  adapters: Map<string, AgentAdapter>;
  emitters: DiscussionEmitters;
  currentTurn: number;
  maxTurns: number;
  moderatorStrategy: 'round-robin' | 'context-aware' | 'user-select';
  synthesisAgent?: 'codex' | 'open-interpreter';
  repository: string;
  branch?: string;
  activeAgentIndex: number;
  pendingResponses: Map<string, string>;
  isProcessing: Map<string, boolean>;
  responseTimeoutMs: number;
  responseStableMs: number;
}

const DEFAULT_RESPONSE_TIMEOUT_MS = 60_000;
const DEFAULT_RESPONSE_STABLE_MS = 1_500;
const RESPONSE_POLL_INTERVAL_MS = 100;

function selectAgentByContext(state: DiscussionState, lastSpeakerId?: string): string | null {
  const agentIds = Array.from(state.agents.keys());
  if (agentIds.length === 0) return null;

  if (lastSpeakerId && agentIds.length > 1) {
    const others = agentIds.filter(id => id !== lastSpeakerId);
    return others[Math.floor(Math.random() * others.length)] || null;
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const content = lastMessage?.content.toLowerCase() || '';

  if (/python|script|code|function|class|import|pip|install/.test(content)
      && agentIds.includes('open-interpreter')) {
    return 'open-interpreter';
  }

  if (/shell|bash|git|deploy|build|compile|make|docker|system|file|path/.test(content)
      && agentIds.includes('codex')) {
    return 'codex';
  }

  const agentId = agentIds[state.activeAgentIndex % agentIds.length];
  state.activeAgentIndex += 1;
  return agentId || null;
}

function agentIdForSession(state: DiscussionState, sessionId: string): string | null {
  for (const [agentId, session] of state.agents) {
    if (session.sessionId === sessionId) return agentId;
  }
  return null;
}

function captureResponseEvent(state: DiscussionState, event: AgentEvent): void {
  if (event.type !== 'response' || !event.session_id) return;

  const agentId = agentIdForSession(state, event.session_id);
  if (!agentId || !state.isProcessing.get(agentId)) return;

  const current = state.pendingResponses.get(agentId) || '';
  state.pendingResponses.set(agentId, current + event.content);
}

export class DiscussionSession {
  private running = false;
  private state: DiscussionState;

  private constructor(state: DiscussionState) {
    this.state = state;
  }

  static async create(
    options: DiscussionOptions,
    emitters?: DiscussionEmitters,
  ): Promise<DiscussionSession> {
    const sessionId = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseEmitters: DiscussionEmitters = emitters || {
      emitMessage: message => {
        console.log(`[Discussion ${sessionId}] ${message.role}: ${message.content.slice(0, 100)}...`);
      },
      emitEvent: event => {
        console.log(`[Discussion ${sessionId}] Event: ${event.type}`);
      },
      emitError: error => {
        console.error(`[Discussion ${sessionId}] Error: ${error}`);
      },
    };

    const state: DiscussionState = {
      sessionId,
      messages: [],
      agents: new Map(),
      adapters: new Map(),
      emitters: baseEmitters,
      currentTurn: 0,
      maxTurns: Math.max(1, options.maxTurns || 10),
      moderatorStrategy: options.moderatorStrategy || 'round-robin',
      synthesisAgent: options.synthesisAgent,
      repository: options.repository,
      branch: options.branch,
      activeAgentIndex: 0,
      pendingResponses: new Map(),
      isProcessing: new Map(),
      responseTimeoutMs: Math.max(1, options.responseTimeoutMs || DEFAULT_RESPONSE_TIMEOUT_MS),
      responseStableMs: Math.max(1, options.responseStableMs || DEFAULT_RESPONSE_STABLE_MS),
    };

    const adapterEmitters: EventEmitters = {
      emitEvent: event => {
        captureResponseEvent(state, event);
        baseEmitters.emitEvent(event);
      },
      emitApproval: approval => {
        baseEmitters.emitApproval?.(approval);
      },
      emitTerminalOutput: (agentSessionId, data) => {
        baseEmitters.emitTerminalOutput?.(agentSessionId, data);
      },
    };

    // Keep the orchestration module importable in plain Node tests. The real
    // adapter registry pulls in Electron and native PTY modules, so load it only
    // when production code did not supply an injected adapter factory.
    const adapterFactory = options.adapterFactory
      || (await import('./adapters')).getAdapter;

    try {
      for (const agentConfig of options.agents) {
        if (state.adapters.has(agentConfig.id)) {
          throw new Error(`Discussion agent ${agentConfig.id} was selected more than once.`);
        }

        const adapter = adapterFactory(agentConfig.id, adapterEmitters);
        state.adapters.set(agentConfig.id, adapter);

        const session = await adapter.launch({
          repository: options.repository,
          branch: options.branch,
          agent: agentConfig.id,
          model: agentConfig.model,
          customInstructions: agentConfig.customInstructions,
        } as AgentSessionOptions);

        state.agents.set(agentConfig.id, session);
      }
    } catch (error) {
      for (const [agentId, session] of state.agents) {
        await state.adapters.get(agentId)?.stopSession(session.sessionId).catch(() => false);
      }
      throw error;
    }

    if (state.agents.size === 0) {
      throw new Error('A discussion requires at least one available agent.');
    }

    return new DiscussionSession(state);
  }

  async sendMessage(content: string): Promise<DiscussionMessage[]> {
    const prompt = content.trim();
    if (!prompt) return this.getHistory();
    if (this.running) throw new Error('This discussion is already processing a message.');

    this.running = true;
    this.state.currentTurn = 0;

    const userMessage: DiscussionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    this.state.messages.push(userMessage);
    this.state.emitters.emitMessage(userMessage);

    try {
      while (this.running && this.state.currentTurn < this.state.maxTurns) {
        const agentId = this.selectNextAgent();
        if (!agentId) break;

        await this.runTurn(agentId);
        this.state.currentTurn += 1;
      }

      if (this.running && this.state.synthesisAgent) {
        await this.synthesizeFinalAnswer();
      }
    } finally {
      this.running = false;
    }

    return this.getHistory();
  }

  getHistory(): DiscussionMessage[] {
    return [...this.state.messages];
  }

  getAgentIds(): string[] {
    return [...this.state.agents.keys()];
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const [agentId, session] of this.state.agents) {
      await this.state.adapters.get(agentId)?.stopSession(session.sessionId).catch(() => false);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private selectNextAgent(): string | null {
    const agentIds = Array.from(this.state.agents.keys());
    if (agentIds.length === 0) return null;

    const lastSpeakerId = this.state.messages[this.state.messages.length - 1]?.agentId;

    if (this.state.moderatorStrategy === 'context-aware') {
      return selectAgentByContext(this.state, lastSpeakerId);
    }

    // user-select currently falls back to deterministic round-robin until the
    // renderer supplies an explicit next-agent selection control.
    const agentId = agentIds[this.state.activeAgentIndex % agentIds.length];
    this.state.activeAgentIndex += 1;
    return agentId || null;
  }

  private async runTurn(agentId: string): Promise<void> {
    const session = this.state.agents.get(agentId);
    const adapter = this.state.adapters.get(agentId);
    if (!session || !adapter) {
      this.state.emitters.emitError(`Discussion agent ${agentId} is unavailable.`);
      return;
    }

    this.state.pendingResponses.set(agentId, '');
    this.state.isProcessing.set(agentId, true);

    try {
      const directResponse = (await adapter.sendPrompt(
        session.sessionId,
        this.buildAgentContext(agentId),
      )).trim();
      const response = directResponse || await this.waitForStreamedResponse(agentId);

      if (!response) {
        this.state.emitters.emitError(`${agentId} did not produce a response before the timeout.`);
        return;
      }

      const agentMessage: DiscussionMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'agent',
        agentId,
        content: response,
        timestamp: Date.now(),
      };
      this.state.messages.push(agentMessage);
      this.state.emitters.emitMessage(agentMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.emitters.emitError(`${agentId} failed: ${message}`);
    } finally {
      this.state.isProcessing.set(agentId, false);
    }
  }

  private async waitForStreamedResponse(agentId: string): Promise<string | null> {
    const startedAt = Date.now();
    let previous = '';
    let lastChangedAt = startedAt;

    while (this.running && Date.now() - startedAt < this.state.responseTimeoutMs) {
      await new Promise(resolve => setTimeout(resolve, RESPONSE_POLL_INTERVAL_MS));

      const current = this.state.pendingResponses.get(agentId) || '';
      if (current !== previous) {
        previous = current;
        lastChangedAt = Date.now();
      }

      if (current.trim() && Date.now() - lastChangedAt >= this.state.responseStableMs) {
        return current.trim();
      }
    }

    const response = this.state.pendingResponses.get(agentId) || '';
    return response.trim() || null;
  }

  private buildAgentContext(currentAgentId: string): string {
    const context = this.state.messages.map(message => {
      if (message.role === 'user') return `User: ${message.content}`;
      if (message.role === 'agent' && message.agentId) return `${message.agentId}: ${message.content}`;
      if (message.role === 'synthesis') return `[Synthesis]: ${message.content}`;
      return message.content;
    }).join('\n\n');

    const roleInstructions: Record<string, string> = {
      codex: 'Act as the system, shell, and repository specialist. Give concrete commands and identify operational risks.',
      'open-interpreter': 'Act as the executable-code specialist. Prefer complete, runnable programs and verify assumptions.',
      aider: 'Act as the focused code-editing specialist. Propose minimal repository changes and tests.',
      'claude-code': 'Act as the architecture and implementation reviewer. Identify design flaws and integration risks.',
    };

    return [
      'Discussion context:',
      context,
      `You are ${currentAgentId}. ${roleInstructions[currentAgentId] || 'Respond as a technical specialist.'}`,
      'Respond to the discussion directly. Do not restate the full transcript.',
    ].filter(Boolean).join('\n\n');
  }

  private async synthesizeFinalAnswer(): Promise<void> {
    const agentId = this.state.synthesisAgent;
    if (!agentId) return;

    const session = this.state.agents.get(agentId);
    const adapter = this.state.adapters.get(agentId);
    if (!session || !adapter) {
      this.state.emitters.emitError(`Synthesis agent ${agentId} is unavailable.`);
      return;
    }

    const transcript = this.state.messages.map(message => {
      if (message.role === 'user') return `User: ${message.content}`;
      if (message.role === 'agent' && message.agentId) return `${message.agentId}: ${message.content}`;
      return message.content;
    }).join('\n\n');

    const synthesisPrompt = [
      'Synthesize the following multi-agent discussion into one final answer.',
      'Resolve disagreements, preserve concrete commands and caveats, and answer the original user request directly.',
      transcript,
    ].join('\n\n');

    this.state.pendingResponses.set(agentId, '');
    this.state.isProcessing.set(agentId, true);

    try {
      const directResponse = (await adapter.sendPrompt(session.sessionId, synthesisPrompt)).trim();
      const response = directResponse || await this.waitForStreamedResponse(agentId);

      if (!response) {
        this.state.emitters.emitError(`${agentId} did not produce a synthesis before the timeout.`);
        return;
      }

      const synthesisMessage: DiscussionMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'synthesis',
        agentId,
        content: response,
        timestamp: Date.now(),
      };
      this.state.messages.push(synthesisMessage);
      this.state.emitters.emitMessage(synthesisMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.emitters.emitError(`${agentId} synthesis failed: ${message}`);
    } finally {
      this.state.isProcessing.set(agentId, false);
    }
  }
}
