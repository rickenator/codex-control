/**
 * GeminiAdapter — wraps Google's Gemini CLI as a pluggable agent adapter.
 * 
 * This adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Command building (args for Gemini with model/provider config)
 * - Output parsing (normalize Gemini's output → unified events)
 * - Approval handling for file edits and shell execution
 * 
 * Gemini CLI yields:
 *   - Markdown text responses
 *   - Code blocks (```language ... ```)
 *   - Shell commands and file operations
 *   - Confirmation prompts for changes (--no-confirm skips these)
 * 
 * See: https://google.github.io/gemini-cli/
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

// ─── Internal Types (Gemini-specific) ─────────────────────────────────────────

interface GeminiSessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  model?: string;
  apiKey?: string;
  autoApprove: boolean;
  jsonRemainder: string;
  activePrompt?: string;
  pendingApproval?: AgentApproval;
  // Buffers for parsing multi-line output
  currentCodeBlock?: { language: string; content: string };
  inCodeBlock: boolean;
}

// ─── Gemini Detection ─────────────────────────────────────────────────────────

function geminiReadiness(): {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  message?: string;
} {
  try {
    const result = spawnSync('gemini', ['--version'], {
      timeout: 5000,
      env: { ...process.env },
    });
    if (result.status === 0) {
      const version = result.stdout.toString().trim();
      return { installed: true, authenticated: true, version };
    }
  } catch {
    // gemini not found or failed
  }
  return { installed: false, authenticated: false, message: 'Install Gemini CLI: npm install -g @anthropic-ai/claude-code' };
}

// ─── Output Parsing Helpers ───────────────────────────────────────────────────

/**
 * Parse Gemini's output into unified events.
 * 
 * Gemini's output patterns:
 * - Plain text → response events
 * - ```language ... ``` blocks → code events
 * - Shell commands shown in output → approval requests
 * - "Would you like me to..." prompts → approval requests
 */
function parseGeminiOutput(
  raw: string,
  state: GeminiSessionState,
  sessionId: string,
  emitters: EventEmitters
): void {
  const timestamp = Date.now();
  
  // Process line by line, tracking state across lines
  const lines = raw.split(/\r?\n/);
  
  for (const line of lines) {
    // ─── Code block detection ────────────────────────────────────────
    if (/^```(\w*)/.test(line)) {
      if (state.inCodeBlock && state.currentCodeBlock) {
        // End of code block — emit as code event
        const content = state.currentCodeBlock.content.trim();
        if (content) {
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'code',
            content,
            metadata: { language: state.currentCodeBlock.language || 'text' },
            timestamp,
            session_id: sessionId,
          });
        }
        state.currentCodeBlock = undefined;
        state.inCodeBlock = false;
      } else if (!state.inCodeBlock) {
        // Start of code block
        const langMatch = line.match(/^```(\w*)/);
        const lang = langMatch ? langMatch[1] : '';
        state.currentCodeBlock = { language: lang, content: '' };
        state.inCodeBlock = true;
      }
      continue;
    }

    // ─── Inside code block — accumulate ──────────────────────────────
    if (state.inCodeBlock && state.currentCodeBlock) {
      state.currentCodeBlock.content += line + '\n';
      continue;
    }

    // ─── Plain text → response event ─────────────────────────────────
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('```')) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'response',
        content: trimmed,
        timestamp,
        session_id: sessionId,
      });
    }

    // ─── Shell command detection ($ prefix or explicit command blocks) ─
    if (/^\$ /.test(trimmed)) {
      const command = trimmed.slice(2).trim();
      if (command && !state.pendingApproval) {
        const approval: AgentApproval = {
          id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          command,
          workingDir: state.repository,
          timestamp,
          status: 'pending',
        };
        state.pendingApproval = approval;
        emitters.emitApproval(approval);
      }
    }
  }

  // Flush any unclosed code block at end of input
  if (state.inCodeBlock && state.currentCodeBlock) {
    const content = state.currentCodeBlock.content.trim();
    if (content) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'code',
        content,
        metadata: { language: state.currentCodeBlock.language || 'text' },
        timestamp,
        session_id: sessionId,
      });
    }
    state.currentCodeBlock = undefined;
    state.inCodeBlock = false;
  }
}

// ─── GeminiAdapter Implementation ─────────────────────────────────────────────

export class GeminiAdapter implements AgentAdapter {
  static sessions = new Map<string, GeminiSessionState>();

  constructor(
    private emitters: EventEmitters
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const gemini = geminiReadiness();
    return [{
      id: 'gemini',
      name: 'Gemini CLI',
      installed: gemini.installed,
      authenticated: gemini.authenticated,
      version: gemini.version,
      loginMessage: gemini.message,
    }];
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    GeminiAdapter.sessions.set(sessionId, state);
    
    // Resolve gemini command
    const geminiCommand = resolveGeminiCommand();
    if (!geminiCommand) {
      throw new Error('Gemini CLI not found. Install via `npm install -g @anthropic-ai/claude-code` or add it to PATH.');
    }

    const args = this.buildLaunchArgs(state);
    
    // Spawn the PTY
    const terminal = pty.spawn(geminiCommand, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: state.repository,
      env: this.buildEnvironment(state),
    });

    state.pty = terminal;

    // Handle PTY output
    terminal.onData((data: string) => this.handleTerminalOutput(sessionId, data));
    
    // Handle PTY exit
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      state.pty = null;
      if (exitCode !== 0) {
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'error',
          content: `Gemini CLI stopped with code ${exitCode}.`,
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
    const state = GeminiAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || !state.pty) return '';

    state.activePrompt = prompt;
    
    // Gemini reads from stdin — write the prompt followed by newline
    state.pty.write(prompt + '\n');
    return "";
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = GeminiAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    GeminiAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    // Gemini doesn't support session reconnection (no thread IDs)
    return false;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────────

  private createSessionState(
    sessionId: string,
    options: AgentSessionOptions
  ): GeminiSessionState {
    return {
      id: sessionId,
      pty: null,
      repository: options.repository,
      branch: options.branch || 'main',
      model: options.model,
      apiKey: options.apiKey,
      autoApprove: true,
      jsonRemainder: '',
      inCodeBlock: false,
    };
  }

  private buildLaunchArgs(state: GeminiSessionState): string[] {
    const args: string[] = [];

    // Model selection (Gemini uses --model flag)
    if (state.model) {
      args.push('--model', state.model);
    }

    // Auto-approve changes (skip confirmation prompts)
    if (state.autoApprove) {
      args.push('--no-confirm');
    }

    return args;
  }

  private buildEnvironment(state: GeminiSessionState): NodeJS.ProcessEnv {
    const env = { ...process.env };
    
    // Inject API key if provided
    if (state.apiKey) {
      env.GOOGLE_API_KEY = state.apiKey;
    }

    return env;
  }

  private handleTerminalOutput(sessionId: string, data: string): void {
    const state = GeminiAdapter.sessions.get(sessionId);
    if (!state) return;

    // Emit raw terminal output for the activity view
    this.emitters.emitTerminalOutput(sessionId, data);

    // Strip ANSI escape codes before parsing
    const clean = data.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');

    // Parse into unified events
    parseGeminiOutput(clean, state, sessionId, this.emitters);
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function resolveGeminiCommand(): string | null {
  const candidates = [
    process.env.GEMINI_BIN || 'gemini',
    '/usr/local/bin/gemini',
    '/usr/bin/gemini',
    path.join(process.env.HOME || '', '.local', 'bin', 'gemini'),
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
