/**
 * AiderAdapter — wraps the Aider CLI as a pluggable agent adapter.
 * 
 * This adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Command building (args for Aider with model/provider config)
 * - Output parsing (normalize Aider's TUI output → unified events)
 * - Approval handling for file edits and shell execution
 * 
 * Aider yields:
 *   - Markdown text responses
 *   - Shell commands prefixed with `$ ` or shown in code blocks
 *   - File diffs for edits (--- a/file, +++ b/file hunks)
 *   - Confirmation prompts for changes (--yes skips these)
 * 
 * See: https://github.com/paul-gauthier/aider
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

// ─── Internal Types (Aider-specific) ──────────────────────────────────────────

interface AiderSessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  model?: string;
  provider?: string;
  autoApprove: boolean;
  jsonRemainder: string;
  activePrompt?: string;
  pendingApproval?: AgentApproval;
  // Buffers for parsing multi-line output
  currentCodeBlock?: { language: string; content: string };
  currentDiff?: { path: string; content: string };
  inCodeBlock: boolean;
  inDiff: boolean;
  diffPath: string;
}

// ─── Aider Detection ──────────────────────────────────────────────────────────

function aiderReadiness(): {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  message?: string;
} {
  try {
    const result = spawnSync('aider', ['--version'], {
      timeout: 5000,
      env: { ...process.env },
    });
    if (result.status === 0) {
      const version = result.stdout.toString().trim();
      return { installed: true, authenticated: true, version };
    }
  } catch {
    // aider not found or failed
  }
  return { installed: false, authenticated: false, message: 'Install Aider: pip install aider-chat' };
}

// ─── Output Parsing Helpers ───────────────────────────────────────────────────

/**
 * Parse Aider's output into unified events.
 * 
 * Aider's output patterns:
 * - Plain text → response events
 * - ```language ... ``` blocks → code events
 * - Shell commands ($ prefix or in code blocks) → approval requests
 * - Diff markers (--- a/, +++ b/) → file edit events
 * - "Would you like to..." prompts → approval requests
 */
function parseAiderOutput(
  raw: string,
  state: AiderSessionState,
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
        // End of code block — emit as response or code
        const content = state.currentCodeBlock.content.trim();
        if (content) {
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: state.currentCodeBlock.language === 'shell' || state.currentCodeBlock.language === 'bash' ? 'code' : 'response',
            content,
            metadata: { language: state.currentCodeBlock.language || 'text' },
            timestamp,
            session_id: sessionId,
          });
        }
        state.currentCodeBlock = undefined;
        state.inCodeBlock = false;
      } else if (!state.inDiff) {
        // Start of code block
        const langMatch = line.match(/^```(\w*)/);
        const lang = langMatch ? langMatch[1] : '';
        state.currentCodeBlock = { language: lang, content: '' };
        state.inCodeBlock = true;
      }
      continue;
    }

    // ─── Diff detection (--- a/path, +++ b/path) ─────────────────────
    if (/^---\s+a\//.test(line)) {
      if (state.inDiff && state.currentDiff) {
        const content = state.currentDiff.content.trim();
        if (content) {
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'files',
            content: JSON.stringify({ path: state.currentDiff.path, diff: content }),
            metadata: { type: 'diff' },
            timestamp,
            session_id: sessionId,
          });
        }
      }
      const pathMatch = line.match(/^---\s+a\/(.+)/);
      state.diffPath = pathMatch ? pathMatch[1] : 'unknown';
      state.currentDiff = { path: state.diffPath, content: '' };
      state.inDiff = true;
      continue;
    }

    if (/^\+\+\+\s+b\//.test(line) && state.inDiff) {
      // New diff section — emit previous if any
      if (state.currentDiff && state.currentDiff.content.trim()) {
        emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'files',
          content: JSON.stringify({ path: state.currentDiff.path, diff: state.currentDiff.content.trim() }),
          metadata: { type: 'diff' },
          timestamp,
          session_id: sessionId,
        });
      }
      const pathMatch = line.match(/^\+\+\+\s+b\/(.+)/);
      state.diffPath = pathMatch ? pathMatch[1] : state.diffPath;
      state.currentDiff = { path: state.diffPath, content: '' };
      continue;
    }

    if (state.inDiff) {
      // Diff content lines (starting with +, -, or space)
      if (/^[ +-]/.test(line)) {
        state.currentDiff!.content += line + '\n';
      } else if (line === '' || line.startsWith('@@')) {
        // Continuation of diff
        state.currentDiff!.content += line + '\n';
      } else {
        // End of diff
        if (state.currentDiff && state.currentDiff.content.trim()) {
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'files',
            content: JSON.stringify({ path: state.currentDiff.path, diff: state.currentDiff.content.trim() }),
            metadata: { type: 'diff' },
            timestamp,
            session_id: sessionId,
          });
        }
        state.inDiff = false;
        state.currentDiff = undefined;
      }
      continue;
    }

    // ─── Inside code block ───────────────────────────────────────────
    if (state.inCodeBlock && state.currentCodeBlock) {
      state.currentCodeBlock.content += line + '\n';
      continue;
    }

    // ─── Shell command detection ($ prefix) ──────────────────────────
    if (/^\$\s/.test(line)) {
      const cmd = line.slice(2).trim();
      if (cmd) {
        const approval: AgentApproval = {
          id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          command: cmd,
          workingDir: state.repository,
          timestamp,
          status: 'pending',
        };
        state.pendingApproval = approval;
        emitters.emitApproval(approval);
      }
      continue;
    }

    // ─── Aider confirmation prompts ──────────────────────────────────
    if (/^(Would you like|Shall I|Apply|Overwrite)/i.test(line)) {
      const approval: AgentApproval = {
        id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        command: line.trim(),
        workingDir: state.repository,
        timestamp,
        status: 'pending',
      };
      state.pendingApproval = approval;
      emitters.emitApproval(approval);
      continue;
    }

    // ─── Plain text → response ───────────────────────────────────────
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('aider:') && !trimmed.startsWith('Aider:')) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'response',
        content: trimmed,
        timestamp,
        session_id: sessionId,
      });
    }
  }

  // Flush any remaining buffered content at end of input
  if (state.inCodeBlock && state.currentCodeBlock) {
    const content = state.currentCodeBlock.content.trim();
    if (content) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'response',
        content,
        metadata: { language: state.currentCodeBlock.language || 'text' },
        timestamp,
        session_id: sessionId,
      });
    }
    state.currentCodeBlock = undefined;
    state.inCodeBlock = false;
  }

  if (state.inDiff && state.currentDiff) {
    const content = state.currentDiff.content.trim();
    if (content) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'files',
        content: JSON.stringify({ path: state.currentDiff.path, diff: content }),
        metadata: { type: 'diff' },
        timestamp,
        session_id: sessionId,
      });
    }
    state.inDiff = false;
    state.currentDiff = undefined;
  }
}

// ─── AiderAdapter Implementation ──────────────────────────────────────────────

export class AiderAdapter implements AgentAdapter {
  static sessions = new Map<string, AiderSessionState>();

  constructor(
    private emitters: EventEmitters
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const aider = aiderReadiness();
    return [{
      id: 'aider',
      name: 'Aider',
      installed: aider.installed,
      authenticated: aider.authenticated,
      version: aider.version,
      loginMessage: aider.message,
    }];
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `aider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    AiderAdapter.sessions.set(sessionId, state);
    
    // Resolve aider command
    const aiderCommand = resolveAiderCommand();
    if (!aiderCommand) {
      throw new Error('Aider not found. Install via `pip install aider-chat` or add it to PATH.');
    }

    const args = this.buildLaunchArgs(state);
    
    // Spawn the PTY
    const terminal = pty.spawn(aiderCommand, args, {
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
      if (exitCode !== 0) {
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'error',
          content: `Aider stopped with code ${exitCode}.`,
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
    const state = AiderAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || !state.pty) return '';

    state.activePrompt = prompt;
    
    // Aider reads from stdin — write the prompt followed by newline
    state.pty.write(prompt + '\n');
    return "";
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = AiderAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    AiderAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    // Aider doesn't support session reconnection (no thread IDs)
    return false;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────────

  private createSessionState(
    sessionId: string,
    options: AgentSessionOptions
  ): AiderSessionState {
    return {
      id: sessionId,
      pty: null,
      repository: options.repository,
      branch: options.branch || 'main',
      model: options.model,
      provider: options.baseUrl ? options.baseUrl : undefined,
      autoApprove: true,
      jsonRemainder: '',
      inCodeBlock: false,
      inDiff: false,
      diffPath: 'unknown',
    };
  }

  private buildLaunchArgs(state: AiderSessionState): string[] {
    const args: string[] = [];

    // Repository is set via cwd, but aider also accepts --project
    // We rely on cwd for the working directory

    // Model selection
    if (state.model) {
      args.push('--model', state.model);
    }

    // Provider / base URL (for custom endpoints)
    if (state.provider) {
      args.push('--openai-api-base', state.provider);
    }

    // Auto-approve changes (skip confirmation prompts)
    if (state.autoApprove) {
      args.push('--yes');
    }

    // Git integration (default in aider, explicit is clearer)
    args.push('--git');

    return args;
  }

  private handleTerminalOutput(sessionId: string, data: string): void {
    const state = AiderAdapter.sessions.get(sessionId);
    if (!state) return;

    // Emit raw terminal output for the activity view
    this.emitters.emitTerminalOutput(sessionId, data);

    // Strip ANSI escape codes before parsing
    const clean = data.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');

    // Parse into unified events
    parseAiderOutput(clean, state, sessionId, this.emitters);
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function resolveAiderCommand(): string | null {
  const candidates = [
    process.env.AIDER_BIN || 'aider',
    '/usr/local/bin/aider',
    '/usr/bin/aider',
    path.join(process.env.HOME || '', '.local', 'bin', 'aider'),
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
