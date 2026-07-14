/**
 * OpenInterpreterAdapter — wraps Open Interpreter's CLI and normalizes its
 * chunk-based output into the same unified event stream as CodexAdapter.
 * 
 * OI yields JSON-like chunks over stdout:
 *   {type: "message", content: "..."}
 *   {type: "code", format: "python", content: "...", start/end}
 *   {type: "console", format: "output", content: "..."}
 *   {type: "confirmation", content: {format, content}}  → approval request
 * 
 * See docs/AGENT_ABSTRACTION.md for the full design.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import type { IPty } from 'node-pty';
import pty from 'node-pty';

import type {
  AgentAdapter,
  AgentEvent,
  AgentApproval,
  AgentSession,
  AgentSessionOptions,
  AgentInfo,
  EventEmitters,
} from '../agent-adapter';

// ─── Internal Types (OI-specific) ─────────────────────────────────────────────

interface OISessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  model?: string;
  customInstructions?: string;
  autoRun: boolean;
  jsonRemainder: string;
  activePrompt?: string;
  pendingApproval?: AgentApproval;
}

// ─── OI Chunk Types (from terminal_interface.py) ──────────────────────────────

interface OIChunk {
  type?: 'message' | 'code' | 'console' | 'confirmation' | 'review' | 'image';
  content?: string | { format?: string; content?: string };
  format?: string;
  role?: string;
  start?: boolean;
  end?: boolean;
}

// ─── OpenInterpreterAdapter Implementation ────────────────────────────────────

export class OpenInterpreterAdapter implements AgentAdapter {
  static sessions = new Map<string, OISessionState>();

  constructor(
    private emitters: EventEmitters
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const oi = oiReadiness();
    return [{
      id: 'open-interpreter',
      name: 'Open Interpreter',
      installed: oi.installed,
      authenticated: false, // OI doesn't have a login concept
      version: oi.version,
      loginMessage: oi.message,
    }];
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `oi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    OpenInterpreterAdapter.sessions.set(sessionId, state);
    
    // Build OI command with args
    const oiCommand = resolveOICommand();
    if (!oiCommand) {
      throw new Error('Open Interpreter not found. Install via `pip install open-interpreter` or add it to PATH.');
    }

    const args = this.buildLaunchArgs(state);
    
    // Spawn the PTY
    const terminal = pty.spawn(oiCommand, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: state.repository,
      env: { ...process.env },
    });

    state.pty = terminal;

    // Handle PTY output
    terminal.onData((data: string) => this.handleTerminalOutput(sessionId, data));
    
    // Handle PTY exit
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      state.pty = null;
      if (state.jsonRemainder.trim()) {
        this.consumeChunks(state, `${state.jsonRemainder}\n`);
        state.jsonRemainder = '';
      }
      if (exitCode !== 0) {
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'error',
          content: `Open Interpreter stopped with code ${exitCode}.`,
          timestamp: Date.now(),
          session_id: sessionId,
        });
      }
      state.activePrompt = undefined;
    });

    return {
      sessionId,
      pty: terminal,
      repository: state.repository,
      branch: state.branch,
      adapter: this,
    };
  }

  async sendPrompt(sessionId: string, input: string): Promise<string> {
    const state = OpenInterpreterAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || !state.pty) return '';

    state.activePrompt = prompt;
    
    // OI reads from stdin — write the prompt followed by newline
    state.pty.write(prompt + '\n');
    return "";
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

  // ─── Internal Methods ──────────────────────────────────────────────────────

  private createSessionState(sessionId: string, options: AgentSessionOptions): OISessionState {
    return {
      id: sessionId,
      pty: null,
      repository: path.resolve(options.repository),
      branch: options.branch || '',
      model: options.model,
      customInstructions: options.customInstructions as string | undefined,
      autoRun: options.autoRun !== false, // Default to auto-run enabled
      jsonRemainder: '',
      activePrompt: undefined,
      pendingApproval: undefined,
    };
  }

  private buildLaunchArgs(state: OISessionState): string[] {
    const args: string[] = [];
    
    // Model selection
    if (state.model) {
      args.push('--model', state.model);
    }
    
    // Custom instructions
    if (state.customInstructions) {
      args.push('--custom_instructions', `"${state.customInstructions}"`);
    }
    
    // Auto-run setting (disable approval prompts if enabled)
    if (!state.autoRun) {
      args.push('--no_auto_run');
    } else {
      args.push('--auto_run');
    }
    
    // Verbose mode for debugging (disabled by default)
    // args.push('--verbose');
    
    return args;
  }

  private handleTerminalOutput(sessionId: string, data: string) {
    const state = OpenInterpreterAdapter.sessions.get(sessionId);
    if (!state) return;

    // Emit raw terminal output to UI (for terminal view)
    this.emitters.emitTerminalOutput(sessionId, data);
    
    // Parse structured chunks from OI output
    this.consumeChunks(state, data);
  }

  private consumeChunks(state: OISessionState, data: string) {
    const combined = state.jsonRemainder + data;
    const lines = combined.split(/\r?\n/);
    state.jsonRemainder = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const chunk = JSON.parse(line) as OIChunk;
        this.processChunk(state, chunk);
      } catch {
        // Incomplete JSON fragment — retain for next chunk
      }
    }
  }

  private processChunk(state: OISessionState, chunk: OIChunk) {
    const sessionId = state.id;
    const timestamp = Date.now();

    // ─── Message chunks (assistant text response) ──────────────────────
    if (chunk.type === 'message') {
      const content = typeof chunk.content === 'string' ? chunk.content : '';
      if (content?.trim()) {
        this.emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'response',
          content: content.trim(),
          timestamp,
          session_id: sessionId,
        });
      }
    }

    // ─── Code chunks (code to execute) ─────────────────────────────────
    if (chunk.type === 'code' && chunk.format && chunk.content) {
      const codeContent = typeof chunk.content === 'string' ? chunk.content : '';
      this.emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'code',
        content: codeContent.trim(),
        metadata: { language: chunk.format },
        timestamp,
        session_id: sessionId,
      });
    }

    // ─── Console chunks (output from executed code) ────────────────────
    if (chunk.type === 'console' && chunk.content) {
      const consoleContent = typeof chunk.content === 'string' ? chunk.content : '';
      this.emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'console',
        content: consoleContent.trim(),
        timestamp,
        session_id: sessionId,
      });
    }

    // ─── Confirmation chunks (approval request for code execution) ─────
    if (chunk.type === 'confirmation' && chunk.content) {
      const confirmation = chunk.content as { format?: string; content?: string };
      if (confirmation?.content) {
        const approval: AgentApproval = {
          id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          command: confirmation.format ? `${confirmation.format} code` : 'code',
          code: confirmation.content,
          language: confirmation.format || 'unknown',
          workingDir: state.repository,
          timestamp,
          status: 'pending',
        };
        
        state.pendingApproval = approval;
        this.emitters.emitApproval(approval);
      }
    }

    // ─── Review chunks (code review from specialized models) ───────────
    if (chunk.type === 'review' && chunk.content) {
      this.emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'response',
        content: `[Code Review] ${chunk.content}`,
        timestamp,
        session_id: sessionId,
      });
    }

    // ─── Image chunks (visual output from OI's computer interface) ─────
    if (chunk.type === 'image' && chunk.content) {
      const imagePath = typeof chunk.content === 'string' ? chunk.content : '';
      if (imagePath && fs.existsSync(imagePath)) {
        this.emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'files',
          content: JSON.stringify({ paths: [imagePath] }),
          timestamp,
          session_id: sessionId,
        });
      }
    }
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function resolveOICommand(): string | null {
  // Check common locations for Open Interpreter
  const candidates = [
    process.env.OI_BIN || 'interpreter',
    '/usr/local/bin/interpreter',
    '/usr/bin/interpreter',
    path.join(process.env.HOME || '', '.local', 'bin', 'interpreter'),
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try PATH lookup
      try {
        execFileSync('which', [candidate], { stdio: 'ignore' });
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function oiReadiness(): {
  installed: boolean;
  version: string;
  message: string;
} {
  const oiCommand = resolveOICommand();
  if (!oiCommand) {
    return {
      installed: false,
      version: '',
      message: 'Open Interpreter not found. Install via `pip install open-interpreter`.',
    };
  }

  try {
    // Try to get version info
    const result = spawnSync(oiCommand, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const version = output || 'installed';
    
    return {
      installed: true,
      version,
      message: `Open Interpreter ${version} is available.`,
    };
  } catch {
    return {
      installed: true,
      version: '',
      message: 'Open Interpreter found but version check failed.',
    };
  }
}
