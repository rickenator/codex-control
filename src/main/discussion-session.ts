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
  agents: Map<string, AgentSession>;  // agentId → session handle
  adapters: Map<string, AgentAdapter>; // agentId → adapter instance
  emitters: DiscussionEmitters;
  currentTurn: number;
  maxTurns: number;
  moderatorStrategy: 'round-robin' | 'context-aware' | 'user-select';
  synthesisAgent?: 'codex' | 'open-interpreter';
  repository: string;
  branch?: string;
  activeAgentIndex: number;  // for round-robin
}

/** Event emitters for discussion sessions */
export interface DiscussionEmitters {
  emitMessage(message: DiscussionMessage): void;
  emitEvent(event: AgentEvent): void;
  emitError(error: string): void;
}

// ─── DiscussionSession Class ──────────────────────────────────────────────────

export class DiscussionSession {
  private state: DiscussionState;
  private running = false;

  constructor(state: DiscussionState) {
    this.state = state;
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static async create(options: DiscussionOptions): Promise<DiscussionSession> {
    const sessionId = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Create emitters that bridge to main.ts event system
    const emitters: DiscussionEmitters = {
      emitMessage: (message) => {
        // This will be wired to IPC in main.ts
        console.log(`[Discussion ${sessionId}] ${message.role}: ${message.content.slice(0, 100)}...`);
      },
      emitEvent: (event) => {
        console.log(`[Discussion ${sessionId}] Event: ${event.type}`);
      },
      emitError: (error) => {
        console.error(`[Discussion ${sessionId}] Error: ${error}`);
      },
    };

    // Create agent sessions
    const agents = new Map<string, AgentSession>();
    const adapters = new Map<string, AgentAdapter>();

    for (const agentConfig of options.agents) {
      const adapter = getAdapter(agentConfig.id, emitters as any);
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

    const state: DiscussionState = {
      sessionId,
      messages: [],
      agents,
      adapters,
      emitters,
      currentTurn: 0,
      maxTurns: options.maxTurns || 10,
      moderatorStrategy: options.moderatorStrategy || 'round-robin',
      synthesisAgent: options.synthesisAgent,
      repository: options.repository,
      branch: options.branch,
      activeAgentIndex: 0,
    };

    return new DiscussionSession(state);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Send a user message to start/continue the discussion */
  async sendMessage(content: string): Promise<DiscussionMessage[]> {
    if (!this.running) {
      this.running = true;
      await this.runDiscussion(content);
    } else {
      // Add user message to history
      const userMsg: DiscussionMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      this.state.messages.push(userMsg);
      this.state.emitters.emitMessage(userMsg);
      
      // Continue discussion from current agent
      await this.continueDiscussion();
    }
    
    return [...this.state.messages];
  }

  /** Get the full discussion history */
  getHistory(): DiscussionMessage[] {
    return [...this.state.messages];
  }

  /** Stop all agents and clean up */
  async stop(): Promise<void> {
    this.running = false;
    
    for (const [agentId, session] of this.state.agents) {
      const adapter = this.state.adapters.get(agentId);
      if (adapter) {
        await adapter.stopSession(session.sessionId).catch(() => {});
      }
    }
  }

  /** Check if discussion is still running */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Discussion Orchestration ─────────────────────────────────────────────

  private async runDiscussion(initialPrompt: string): Promise<void> {
    // Add initial user message
    const userMsg: DiscussionMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: initialPrompt,
      timestamp: Date.now(),
    };
    this.state.messages.push(userMsg);
    this.state.emitters.emitMessage(userMsg);

    // Run turns until max reached or discussion naturally ends
    while (this.running && this.state.currentTurn < this.state.maxTurns) {
      const agentId = this.selectNextAgent();
      if (!agentId) break;

      const session = this.state.agents.get(agentId);
      const adapter = this.state.adapters.get(agentId);
      
      if (!session || !adapter) {
        console.warn(`[Discussion] Agent ${agentId} not found, skipping`);
        continue;
      }

      // Build context for the agent (full conversation history)
      const context = this.buildAgentContext(agentId);
      
      // Send prompt to agent
      const success = await adapter.sendPrompt(session.sessionId, context);
      
      if (!success) {
        console.warn(`[Discussion] Failed to send prompt to ${agentId}`);
        this.state.currentTurn++;
        continue;
      }

      // Wait for agent response (polling until PTY is free)
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

    // Synthesize final answer if synthesis agent is configured
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

      const context = this.buildAgentContext(agentId);
      const success = await adapter.sendPrompt(session.sessionId, context);
      
      if (!success) {
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
        // TODO: Use LLM to decide which agent is best suited for next response
        // For now, fall back to round-robin
        const agentId2 = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId2;
      
      case 'user-select':
        // TODO: Prompt user to select which agent responds next
        // For now, fall back to round-robin
        const agentId3 = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId3;
      
      default:
        return agentIds[0] || null;
    }
  }

  private buildAgentContext(currentAgentId: string): string {
    // Build conversation history excluding the current agent's last response
    // to avoid circular references
    const relevantMessages = this.state.messages.filter((msg, idx) => {
      // Include all messages except the current agent's most recent one
      if (msg.agentId === currentAgentId && idx === this.state.messages.length - 1) {
        return false;
      }
      return true;
    });

    const contextLines = relevantMessages.map(msg => {
      if (msg.role === 'user') {
        return `User: ${msg.content}`;
      } else if (msg.role === 'agent' && msg.agentId) {
        return `${msg.agentId}: ${msg.content}`;
      } else if (msg.role === 'synthesis') {
        return `[Synthesis]: ${msg.content}`;
      }
      return msg.content;
    });

    return `Discussion context:\n\n${contextLines.join('\n\n')}\n\nPlease respond to the discussion.`;
  }

  private async waitForAgentResponse(agentId: string, session: AgentSession): Promise<string | null> {
    // Poll until the agent's PTY is free (not busy processing)
    const maxWaitMs = 60_000; // 60 second timeout
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Check if PTY is free (agent finished processing)
      // This is a simplification — in reality we'd track response state
      // For now, we assume the agent responds within the timeout
      break; // Simplified: just wait once and return null
    }

    // TODO: Implement proper response capture from PTY output
    // For now, return null (discussion will continue but without capturing responses)
    return null;
  }

  private async synthesizeFinalAnswer(): Promise<void> {
    if (!this.state.synthesisAgent) return;

    const session = this.state.agents.get(this.state.synthesisAgent);
    const adapter = this.state.adapters.get(this.state.synthesisAgent);
    
    if (!session || !adapter) return;

    // Build synthesis prompt from full discussion history
    const context = this.state.messages.map(msg => {
      if (msg.role === 'user') return `User: ${msg.content}`;
      if (msg.role === 'agent' && msg.agentId) return `${msg.agentId}: ${msg.content}`;
      return msg.content;
    }).join('\n\n');

    const synthesisPrompt = `Based on the following discussion, provide a final synthesized answer:\n\n${context}`;

    const success = await adapter.sendPrompt(session.sessionId, synthesisPrompt);
    
    if (success) {
      // Wait for synthesis response
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
