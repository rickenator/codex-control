/**
 * DiscussionSession — multi-agent orchestration layer
 * 
 * Manages a conversation between multiple AI agents. The user sends one prompt,
 * and agents discuss it among themselves before synthesizing a final answer.
 * 
 * Architecture:
 *   User → Moderator → Agent A → Agent B → ... → Synthesis → User
 * 
 * The moderator decides which agent responds next based on context, round-robin,
 * or user selection. Each agent sees the full conversation history.
 */

import type { IPty } from 'node-pty';
import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentSessionOptions,
} from './agent-adapter';
import { getAdapter } from './adapters';

// ─── Discussion Types ──────────────────────────────────────────────────────────

/** A single message in the discussion */
export interface DiscussionMessage {
  id: string;
  role: 'user' | 'agent' | 'synthesis';
  agentId?: string;       // which agent sent this (undefined for user/synthesis)
  content: string;
  timestamp: number;
}

/** Configuration for a discussion session */
export interface DiscussionOptions {
  repository: string;
  branch?: string;
  agents: Array<{
    id: 'codex' | 'open-interpreter' | 'aider' | 'claude-code';
    model?: string;
    customInstructions?: string;
  }>;
  maxTurns?: number;        // max total turns across all agents (default: 10)
  moderatorStrategy?: 'round-robin' | 'context-aware' | 'user-select';
  synthesisAgent?: 'codex' | 'open-interpreter';  // which agent synthesizes final answer
}

/** State of a running discussion */
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
}

/** Event emitters for discussion sessions */
export interface DiscussionEmitters {
  emitMessage(message: DiscussionMessage): void;
  emitEvent(event: AgentEvent): void;
  emitError(error: string): void;
}

/**
 * Helper to create emitters that also accumulate agent responses.
 */
function createResponseCapturingEmitters(
  state: DiscussionState,
  baseEmitters: DiscussionEmitters
): DiscussionEmitters {
  return {
    emitMessage: (message) => {
      baseEmitters.emitMessage(message);
    },
    emitEvent: (event) => {
      // Accumulate response content for the current agent
      if (event.type === 'response' && event.session_id) {
        for (const [agentId, session] of state.agents) {
          if (session.sessionId === event.session_id) {
            const current = state.pendingResponses.get(agentId) || '';
            state.pendingResponses.set(agentId, current + event.content);
            break;
          }
        }
      }
      baseEmitters.emitEvent(event);
    },
    emitError: (error) => {
      baseEmitters.emitError(error);
    },
  };
}

// ─── DiscussionSession Class ──────────────────────────────────────────────────

export class DiscussionSession {
  private state: DiscussionState;
  private running = false;

  constructor(state: DiscussionState) {
    this.state = state;
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static async create(options: DiscussionOptions, emitters?: DiscussionEmitters): Promise<DiscussionSession> {
    const sessionId = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const baseEmitters: DiscussionEmitters = emitters || {
      emitMessage: (message) => {
        console.log(`[Discussion ${sessionId}] ${message.role}: ${message.content.slice(0, 100)}...`);
      },
      emitEvent: (event) => {
        console.log(`[Discussion ${sessionId}] Event: ${event.type}`);
      },
      emitError: (error) => {
        console.error(`[Discussion ${sessionId}] Error: ${error}`);
      },
    };

    const agents = new Map<string, AgentSession>();
    const adapters = new Map<string, AgentAdapter>();

    for (const agentConfig of options.agents) {
      const adapter = getAdapter(agentConfig.id, baseEmitters as any);
      adapters.set(agentConfig.id, adapter);

      const session = await adapter.launch({
        repository: options.repository,
        branch: options.branch,
        agent: agentConfig.id,
        model: agentConfig.model,
        customInstructions: agentConfig.customInstructions,
      } as AgentSessionOptions);

      agents.set(agentConfig.id, session);
    }

    const initialState: Omit<DiscussionState, 'emitters'> = {
      sessionId,
      messages: [],
      agents,
      adapters,
      currentTurn: 0,
      maxTurns: options.maxTurns || 10,
      moderatorStrategy: options.moderatorStrategy || 'round-robin',
      synthesisAgent: options.synthesisAgent,
      repository: options.repository,
      branch: options.branch,
      activeAgentIndex: 0,
      pendingResponses: new Map(),
      isProcessing: new Map(),
    };

    const capturingEmitters = createResponseCapturingEmitters(
      initialState as DiscussionState,
      baseEmitters
    );

    const state: DiscussionState = {
      ...initialState,
      emitters: capturingEmitters,
    };

    return new DiscussionSession(state);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async sendMessage(content: string): Promise<DiscussionMessage[]> {
    if (!this.running) {
      this.running = true;
      await this.runDiscussion(content);
    } else {
      const userMsg: DiscussionMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      this.state.messages.push(userMsg);
      this.state.emitters.emitMessage(userMsg);
      await this.continueDiscussion();
    }
    
    return [...this.state.messages];
  }

  getHistory(): DiscussionMessage[] {
    return [...this.state.messages];
  }

  async stop(): Promise<void> {
    this.running = false;
    
    for (const [agentId, session] of this.state.agents) {
      const adapter = this.state.adapters.get(agentId);
      if (adapter) {
        await adapter.stopSession(session.sessionId).catch(() => {});
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Discussion Orchestration ─────────────────────────────────────────────

  private async runDiscussion(initialPrompt: string): Promise<void> {
    const userMsg: DiscussionMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: initialPrompt,
      timestamp: Date.now(),
    };
    this.state.messages.push(userMsg);
    this.state.emitters.emitMessage(userMsg);

    while (this.running && this.state.currentTurn < this.state.maxTurns) {
      const agentId = this.selectNextAgent();
      if (!agentId) break;

      const session = this.state.agents.get(agentId);
      const adapter = this.state.adapters.get(agentId);
      
      if (!session || !adapter) {
        console.warn(`[Discussion] Agent ${agentId} not found, skipping`);
        continue;
      }

      this.state.pendingResponses.set(agentId, '');
      this.state.isProcessing.set(agentId, true);
      
      const context = this.buildAgentContext(agentId);
      const success = await adapter.sendPrompt(session.sessionId, context);
      
      if (!success) {
        console.warn(`[Discussion] Failed to send prompt to ${agentId}`);
        this.state.isProcessing.set(agentId, false);
        this.state.currentTurn++;
        continue;
      }

      const response = await this.waitForAgentResponse(agentId, session);
      
      if (response) {
        const agentMsg: DiscussionMessage = {
          id: `msg_${Date.now()}`,
          role: 'agent',
          agentId,
          content: response,
          timestamp: Date.now(),
        };
        this.state.messages.push(agentMsg);
        this.state.emitters.emitMessage(agentMsg);
      }

      this.state.currentTurn++;
    }

    if (this.state.synthesisAgent && this.running) {
      await this.synthesizeFinalAnswer();
    }

    this.running = false;
  }

  private async continueDiscussion(): Promise<void> {
    while (this.running && this.state.currentTurn < this.state.maxTurns) {
      const agentId = this.selectNextAgent();
      if (!agentId) break;

      const session = this.state.agents.get(agentId);
      const adapter = this.state.adapters.get(agentId);
      
      if (!session || !adapter) continue;

      this.state.pendingResponses.set(agentId, '');
      this.state.isProcessing.set(agentId, true);
      
      const context = this.buildAgentContext(agentId);
      const success = await adapter.sendPrompt(session.sessionId, context);
      
      if (!success) {
        this.state.isProcessing.set(agentId, false);
        this.state.currentTurn++;
        continue;
      }

      const response = await this.waitForAgentResponse(agentId, session);
      
      if (response) {
        const agentMsg: DiscussionMessage = {
          id: `msg_${Date.now()}`,
          role: 'agent',
          agentId,
          content: response,
          timestamp: Date.now(),
        };
        this.state.messages.push(agentMsg);
        this.state.emitters.emitMessage(agentMsg);
      }

      this.state.currentTurn++;
    }
  }

  private selectNextAgent(): string | null {
    const agentIds = Array.from(this.state.agents.keys());
    
    switch (this.state.moderatorStrategy) {
      case 'round-robin':
        const agentId = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId;
      
      case 'context-aware':
        const agentId2 = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId2;
      
      case 'user-select':
        const agentId3 = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId3;
      
      default:
        return agentIds[0] || null;
    }
  }

  private buildAgentContext(currentAgentId: string): string {
    const relevantMessages = this.state.messages.filter((msg, idx) => {
      if (msg.agentId === currentAgentId && idx === this.state.messages.length - 1) {
        return false;
      }
      return true;
    });

    const contextLines = relevantMessages.map(msg => {
      if (msg.role === 'user') return `User: ${msg.content}`;
      if (msg.role === 'agent' && msg.agentId) return `${msg.agentId}: ${msg.content}`;
      if (msg.role === 'synthesis') return `[Synthesis]: ${msg.content}`;
      return msg.content;
    });

    return `Discussion context:\n\n${contextLines.join('\n\n')}\n\nPlease respond to the discussion.`;
  }

  private async waitForAgentResponse(agentId: string, session: AgentSession): Promise<string | null> {
    const maxWaitMs = 60_000;
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      if (!session.pty) {
        const response = this.state.pendingResponses.get(agentId) || '';
        this.state.isProcessing.set(agentId, false);
        return response.trim() || null;
      }
      
      const response = this.state.pendingResponses.get(agentId) || '';
      if (response.length > 0 && !this.state.isProcessing.get(agentId)) {
        return response.trim() || null;
      }
    }

    const response = this.state.pendingResponses.get(agentId) || '';
    this.state.isProcessing.set(agentId, false);
    return response.trim() || null;
  }

  private async synthesizeFinalAnswer(): Promise<void> {
    if (!this.state.synthesisAgent) return;

    const session = this.state.agents.get(this.state.synthesisAgent);
    const adapter = this.state.adapters.get(this.state.synthesisAgent);
    
    if (!session || !adapter) return;

    const context = this.state.messages.map(msg => {
      if (msg.role === 'user') return `User: ${msg.content}`;
      if (msg.role === 'agent' && msg.agentId) return `${msg.agentId}: ${msg.content}`;
      return msg.content;
    }).join('\n\n');

    const synthesisPrompt = `Based on the following discussion, provide a final synthesized answer:\n\n${context}`;

    const success = await adapter.sendPrompt(session.sessionId, synthesisPrompt);
    
    if (success) {
      const response = await this.waitForAgentResponse(this.state.synthesisAgent!, session);
      
      if (response) {
        const synthesisMsg: DiscussionMessage = {
          id: `msg_${Date.now()}`,
          role: 'synthesis',
          agentId: this.state.synthesisAgent,
          content: response,
          timestamp: Date.now(),
        };
        this.state.messages.push(synthesisMsg);
        this.state.emitters.emitMessage(synthesisMsg);
      }
    }
  }
}
