/**
 * Agent Adapter Interface
 * 
 * Defines the contract for pluggable AI agent adapters. Each adapter wraps a
 * different CLI-based AI agent (Codex, Open Interpreter, Aider, etc.) and
 * normalizes its output into a unified event stream that the UI understands.
 * 
 * The rest of Consiglio talks to this interface — never to a concrete agent.
 */

import type { IPty } from 'node-pty';

// ─── Unified Event Types ──────────────────────────────────────────────────────

/**
 * All agents emit events through this unified type. The UI renders based on
 * `type`, not on which agent produced the event.
 */
export interface AgentEvent {
  id: string;
  type: 'prompt' | 'response' | 'code' | 'console' | 'error' | 'approval_request' 
       | 'system' | 'files' | 'interrupted';
  content: string;
  metadata?: Record<string, unknown>;  // language, format, paths, etc.
  timestamp: number;
  session_id: string;
}

// ─── Unified Approval Request ─────────────────────────────────────────────────

/**
 * All agents use the same approval flow. The UI shows one consistent dialog
 * regardless of whether the code came from Codex (shell command) or OI (Python).
 */
export interface AgentApproval {
  id: string;
  sessionId: string;
  command: string;        // "python script.py" or "npm run build"
  code?: string;          // the code to execute (OI, Aider, etc.)
  language?: string;      // "python", "javascript", "shell", etc.
  workingDir: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

// ─── Session Handle ───────────────────────────────────────────────────────────

/**
 * A running session — PTY + metadata. The adapter owns the PTY lifecycle.
 */
export interface AgentSession {
  sessionId: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  adapter: AgentAdapter;
}

// ─── Session Options ──────────────────────────────────────────────────────────

/**
 * What the app passes when creating a session. The adapter interprets these
 * options according to its own agent's requirements.
 */
export interface AgentSessionOptions {
  repository: string;
  branch?: string;
  agent: 'codex' | 'open-interpreter' | 'aider' | 'claude-code';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  customArgs?: string[];
  // Agent-specific config (OI profiles, Codex providers, etc.)
  [key: string]: unknown;
}

// ─── Agent Detection ──────────────────────────────────────────────────────────

/**
 * What detectAvailable() returns — used for health checks and startup.
 */
export interface AgentInfo {
  id: 'codex' | 'open-interpreter' | 'aider' | 'claude-code';
  name: string;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  loginMessage?: string;
}

// ─── The Adapter Interface ────────────────────────────────────────────────────

/**
 * Core adapter interface. Each agent gets its own implementation.
 * 
 * The adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Event parsing (normalize agent output → AgentEvent[])
 * - Approval handling (emit AgentApproval when code execution is requested)
 * - Session persistence (save/restore session state)
 */
export interface AgentAdapter {
  /**
   * Spawn a new session for this agent.
   * Returns a session handle with the PTY and metadata.
   */
  launch(options: AgentSessionOptions): Promise<AgentSession>;
  
  /**
   * Send a prompt to an active session.
   * Returns true if the prompt was sent successfully.
   */
  sendPrompt(sessionId: string, input: string): Promise<boolean>;
  
  /**
   * Stop a running session (kill PTY, clean up).
   */
  stopSession(sessionId: string): Promise<boolean>;
  
  /**
   * Reconnect to a saved session (if the agent supports it).
   * Some agents (like Codex) have thread IDs that survive restarts.
   */
  reconnectSession(sessionId: string): Promise<boolean>;
}

// ─── Agent Detection ──────────────────────────────────────────────────────────

/**
 * Detect which agents are available on this system.
 * Used for health checks and startup validation.
 * Each adapter implements its own detection logic.
 */
export function detectAgents(emitters: EventEmitters): AgentInfo[] {
  const results: AgentInfo[] = [];
  
  // Codex detection
  try {
    const codexAdapter = new (require('./adapters/codex-adapter').CodexAdapter)(emitters);
    results.push(...(codexAdapter as any).detectAvailable());
  } catch {
    results.push({ id: 'codex', name: 'Codex CLI', installed: false, authenticated: false });
  }
  
  // Open Interpreter detection (stub)
  try {
    const oiAdapter = new (require('./adapters/open-interpreter-adapter').OpenInterpreterAdapter)(emitters);
    results.push(...(oiAdapter as any).detectAvailable());
  } catch {
    results.push({ id: 'open-interpreter', name: 'Open Interpreter', installed: false, authenticated: false });
  }
  
  return results;
}

// ─── Event Emitter Helper ─────────────────────────────────────────────────────

/**
 * Shared event emitter that adapters use to emit events to the UI.
 * This keeps the adapter code clean and testable.
 */
export interface EventEmitters {
  /** Emit a unified event to the UI */
  emitEvent(event: AgentEvent): void;
  
  /** Emit an approval request to the UI */
  emitApproval(approval: AgentApproval): void;
  
  /** Emit terminal output (raw PTY data) */
  emitTerminalOutput(sessionId: string, data: string): void;
}

// ─── Event Parser Helper ──────────────────────────────────────────────────────

/**
 * Shared event parser that adapters use to normalize raw output into events.
 * Each agent has a different output format; this normalizes them all.
 */
export interface EventParser {
  /** Parse raw output string into unified events */
  parse(raw: string, sessionId: string): AgentEvent[];
  
  /** Check if the raw output contains an approval request */
  parseApproval?(raw: string, sessionId: string): AgentApproval | null;
}

