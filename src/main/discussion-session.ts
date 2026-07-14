/**
 * DiscussionSession — multi-agent orchestration layer
 * 
 * Manages a conversation between multiple AI agents. The user sends one prompt,
 * and agents discuss it among themselves before synthesizing a final answer.
 * 
 * Architecture:
 *   User → Moderator → Agent A → Agent B → ... → Synthesis → User
 * 
 * Each agent sees the full conversation history as context. The moderator
 * decides which agent responds next based on strategy (round-robin, context-aware).
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

export interface DiscussionMessage {
  id: string;
  role: 'user' | 'agent' | 'synthesis';
  agentId?: string;
  content: string;
  timestamp: number;
}

export interface DiscussionOptions {
  repository: string;
  branch?: string;
  agents: Array<{
    id: 'codex' | 'open-interpreter' | 'aider' | 'claude-code';
    model?: string;
    customInstructions?: string;
  }>;
  maxTurns?: number;
  moderatorStrategy?: 'round-robin' | 'context-aware' | 'user-select';
  synthesisAgent?: 'codex' | 'open-interpreter';
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

export interface DiscussionEmitters {
  emitMessage(message: DiscussionMessage): void;
  emitEvent(event: AgentEvent): void;
  emitError(error: string): void;
}

// ─── Context-Aware Moderation ──────────────────────────────────────────────────

/**
 * Analyzes conversation context to decide which agent should respond next.
 * Uses simple heuristics — can be upgraded to LLM-based routing later.
 */
function selectAgentByContext(
  state: DiscussionState,
  lastSpeakerId?: string
): string | null {
  const agentIds = Array.from(state.agents.keys());
  if (agentIds.length === 0) return null;

  // If there's a last speaker, give the floor to a different agent
  // (unless it's the only agent)
  if (lastSpeakerId && agentIds.length > 1) {
    const others = agentIds.filter(id => id !== lastSpeakerId);
    return others[Math.floor(Math.random() * others.length)];
  }

  // If last message was user input, pick based on topic keywords
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === 'user') {
    const lowerContent = lastMsg.content.toLowerCase();
    
    // Code-heavy requests → Open Interpreter (Python specialist)
    if (/python|script|code|function|class|import|pip|install/.test(lowerContent)) {
      if (agentIds.includes('open-interpreter')) return 'open-interpreter';
    }
    
    // Shell/system tasks → Codex (system specialist)
    if (/shell|bash|git|deploy|build|compile|make|docker|system|file|path/.test(lowerContent)) {
      if (agentIds.includes('codex')) return 'codex';
    }
    
    // General questions → round-robin fallback
  }

  // If last message was synthesis, pick based on what the synthesis asked for
  if (lastMsg?.role === 'synthesis') {
    const lowerContent = lastMsg.content.toLowerCase();
    if (/python|script|code/.test(lowerContent)) {
      if (agentIds.includes('open-interpreter')) return 'open-interpreter';
    }
    if (/shell|bash|git|deploy|build/.test(lowerContent)) {
      if (agentIds.includes('codex')) return 'codex';
    }
  }

  // Default: round-robin from next position
  const agentId = agentIds[state.activeAgentIndex % agentIds.length];
  state.activeAgentIndex++;
  return agentId;
}

// ─── Response Capturing Emitters ───────────────────────────────────────────────

/**
 * Creates emitters that accumulate agent responses from events.
 * Must be called AFTER agents map is populated.
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
      // Accumulate response content per agent. Each agent has exactly one session,
      // so we map event.session_id -> agentId via the agents map.
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
    
    // Base emitters (provided by main.ts or stubs)
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

    // Create agent sessions first
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

    // Now create state WITHOUT emitters first
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

    // Create response-capturing emitters (agents map is now populated)
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

      await this.runTurn(agentId);
      this.state.currentTurn++;
    }

    // Synthesize final answer
    if (this.state.synthesisAgent && this.running) {
      await this.synthesizeFinalAnswer();
    }

    this.running = false;
  }

  private async continueDiscussion(): Promise<void> {
    while (this.running && this.state.currentTurn < this.state.maxTurns) {
      const agentId = this.selectNextAgent();
      if (!agentId) break;

      await this.runTurn(agentId);
      this.state.currentTurn++;
    }
  }

  private async runTurn(agentId: string): Promise<void> {
    const session = this.state.agents.get(agentId);
    const adapter = this.state.adapters.get(agentId);
    
    if (!session || !adapter) {
      console.warn(`[Discussion] Agent ${agentId} not found, skipping`);
      return;
    }

    // Initialize response tracking
    this.state.pendingResponses.set(agentId, '');
    this.state.isProcessing.set(agentId, true);
    
    // Build context for the agent
    const context = this.buildAgentContext(agentId);
    
    // Send prompt to agent — returns accumulated response for Codex,
    // or empty string for agents that stream via events (OI, Aider, Claude).
    const response = await adapter.sendPrompt(session.sessionId, context);
    
    if (!response) {
      // For streaming agents, wait for event-based accumulation
      const streamedResponse = await this.waitForStreamedResponse(agentId);
      if (streamedResponse) {
        const agentMsg: DiscussionMessage = {
          id: `msg_${Date.now()}`,
          role: 'agent',
          agentId,
          content: streamedResponse,
          timestamp: Date.now(),
        };
        this.state.messages.push(agentMsg);
        this.state.emitters.emitMessage(agentMsg);
      }
    } else {
      // Codex returned accumulated response directly
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
    
    this.state.isProcessing.set(agentId, false);
  }

  private async waitForStreamedResponse(agentId: string): Promise<string | null> {
    const maxWaitMs = 60_000;
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const response = this.state.pendingResponses.get(agentId) || '';
      
      // If we have content and it hasn't changed for 3 seconds, consider it done
      if (response.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const stillSame = this.state.pendingResponses.get(agentId) === response;
        if (stillSame) {
          this.state.isProcessing.set(agentId, false);
          return response.trim() || null;
        }
      }
    }

    // Timeout
    const response = this.state.pendingResponses.get(agentId) || '';
    this.state.isProcessing.set(agentId, false);
    return response.trim() || null;
  }

  private selectNextAgent(): string | null {
    const agentIds = Array.from(this.state.agents.keys());
    if (agentIds.length === 0) return null;

    // Get last speaker to avoid double-speaking
    const lastSpeakerId = this.state.messages.length > 0
      ? this.state.messages[this.state.messages.length - 1].agentId
      : undefined;

    switch (this.state.moderatorStrategy) {
      case 'round-robin': {
        const agentId = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId;
      }
      
      case 'context-aware':
        return selectAgentByContext(this.state, lastSpeakerId);
      
      case 'user-select':
        // TODO: Prompt user to select which agent responds next
        const agentId3 = agentIds[this.state.activeAgentIndex % agentIds.length];
        this.state.activeAgentIndex++;
        return agentId3;
      
      default:
        return agentIds[0] || null;
    }
  }

  private buildAgentContext(currentAgentId: string): string {
    // Build conversation history excluding the current agent's last response
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

    const context = contextLines.join('\n\n');
    
    // Add role-specific instructions
    let roleInstructions = '';
    if (currentAgentId === 'open-interpreter') {
      roleInstructions = '\n\nYou are Open Interpreter, a Python coding specialist. When asked to write code, provide complete, runnable Python scripts.';
    } else if (currentAgentId === 'codex') {
      roleInstructions = '\n\nYou are Codex CLI, a system and shell specialist. When asked about file operations, git, or system tasks, provide shell commands.';
    }

    return `Discussion context:\n\n${context}\n\nPlease respond to the discussion.${roleInstructions}`;
  }

  private async waitForAgentResponse(agentId: string, session: AgentSession): Promise<string | null> {
    const maxWaitMs = 60_000; // 60 second timeout
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Check if PTY exited (agent finished)
      if (!session.pty) {
        const response = this.state.pendingResponses.get(agentId) || '';
        this.state.isProcessing.set(agentId, false);
        return response.trim() || null;
      }
      
      // Check if we have accumulated response content and agent is done processing
      const response = this.state.pendingResponses.get(agentId) || '';
      if (response.length > 0 && !this.state.isProcessing.get(agentId)) {
        return response.trim() || null;
      }
    }

    // Timeout — return whatever we have
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

    const synthesisPrompt = `Based on the following discussion between multiple AI agents, provide a final synthesized answer that addresses the user's original question:\n\n${context}`;

    const response = await adapter.sendPrompt(session.sessionId, synthesisPrompt);
    
    if (response) {
      // For streaming synthesis agents, wait for event accumulation
      const finalResponse = response.trim() || await this.waitForStreamedResponse(this.state.synthesisAgent!);
      
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
