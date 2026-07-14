/**
 * OpenInterpreterAdapter — stub for Phase 2.
 * 
 * This adapter will wrap Open Interpreter's CLI and normalize its chunk-based
 * output into the same unified event stream as CodexAdapter.
 * 
 * See docs/AGENT_ABSTRACTION.md for the full design.
 */

import type {
  AgentAdapter,
  AgentEvent,
  AgentApproval,
  AgentSession,
  AgentSessionOptions,
  AgentInfo,
} from '../agent-adapter';
import pty from 'node-pty';

// Stub type for OI session state (full implementation in Phase 3)
interface OISessionState {
  id: string;
  pty: import('node-pty').IPty | null;
  repository: string;
  branch: string;
  model?: string;
  jsonRemainder?: string;
  activePrompt?: string;
}

export class OpenInterpreterAdapter implements AgentAdapter {
  static sessions = new Map<string, OISessionState>();

  detectAvailable(): import('../agent-adapter').AgentInfo[] {
    // Check if 'interpreter' is on PATH
    try {
      require('child_process').execSync('interpreter --version', { stdio: 'ignore' });
      return [{ id: 'open-interpreter', name: 'Open Interpreter', installed: true, authenticated: false }];
    } catch {
      return [{ id: 'open-interpreter', name: 'Open Interpreter', installed: false, authenticated: false }];
    }
  }

  constructor(
    private emitters: {
      emitEvent: (event: AgentEvent) => void;
      emitApproval: (approval: AgentApproval) => void;
      emitTerminalOutput: (sessionId: string, data: string) => void;
    }
  ) {}

  static detectAvailable(): AgentInfo[] {
    // Check if `interpreter` is on PATH
    // Check if Python env has open-interpreter installed
    return [{
      id: 'open-interpreter',
      name: 'Open Interpreter',
      installed: false, // TODO: implement detection
      authenticated: false,
    }];
  }

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `oi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // TODO: Build OI command args
    // interpreter --model gpt-4o --custom-instructions "..."
    
    const terminal = pty.spawn('interpreter', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: options.repository,
      env: { ...process.env },
    });

    OpenInterpreterAdapter.sessions.set(sessionId, {
      id: sessionId,
      pty: terminal,
      repository: options.repository,
      branch: options.branch || '',
      model: options.model || '',
      jsonRemainder: '',
      activePrompt: undefined,
    });

    // Handle PTY output — OI streams chunks, not JSONL
    terminal.onData((data: string) => this.handleTerminalOutput(sessionId, data));
    
    // Handle PTY exit
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      OpenInterpreterAdapter.sessions.delete(sessionId);
    });

    return {
      sessionId,
      pty: terminal,
      repository: options.repository,
      branch: options.branch || '',
      adapter: this,
    };
  }

  async sendPrompt(sessionId: string, input: string): Promise<boolean> {
    const state = OpenInterpreterAdapter.sessions.get(sessionId);
    if (!state || !state.pty) return false;
    
    // OI reads from stdin in its terminal_interface loop
    state.pty.write(input + '\n');
    return true;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = OpenInterpreterAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    OpenInterpreterAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(sessionId: string): Promise<boolean> {
    // OI doesn't have thread persistence like Codex
    return false;
  }

  private handleTerminalOutput(sessionId: string, data: string) {
    const state = OpenInterpreterAdapter.sessions.get(sessionId);
    if (!state) return;

    this.emitters.emitTerminalOutput(sessionId, data);
    
    // TODO: Parse OI's chunk-based output
    // OI yields chunks like: {type: 'message', content: '...'}
    // Map to AgentEvent types:
    // - message → 'response'
    // - code → 'code' with metadata.language
    // - console → 'console'
    // - confirmation → AgentApproval
  }
}

interface SessionState {
  id: string;
  pty: pty.IPty | null;
  repository: string;
  branch: string;
  model: string;
  jsonRemainder: string;
  activePrompt?: string;
}

