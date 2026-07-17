/**
 * CopilotAdapter — wraps GitHub's Copilot CLI as a pluggable agent adapter.
 * 
 * This adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Command building (args for Copilot with model/provider config)
 * - Output parsing (normalize Copilot's output → unified events)
 * - Approval handling for file edits and shell execution
 * 
 * GitHub Copilot CLI yields:
 *   - Markdown text responses
 *   - Code blocks (```language ... ```)
 *   - File edits and shell commands
 *   - Confirmation prompts for changes (--yes skips these)
 * 
 * See: https://docs.github.com/en/copilot/using-github-copilot/ai-code-cli-in-your-cli-or-ide
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

// ─── Internal Types (Copilot-specific) ────────────────────────────────────────

interface CopilotSessionState {
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

// ─── Copilot Detection ────────────────────────────────────────────────────────

function copilotReadiness(): {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  message?: string;
} {
  try {
    const result = spawnSync('copilot', ['--version'], {
      timeout: 5000,
      env: { ...process.env },
    });
    if (result.status === 0) {
      const version = result.stdout.toString().trim();
      return { installed: true, authenticated: true, version };
    }
  } catch {
    // copilot not found or failed
  }
  return { installed: false, authenticated: false, message: 'Install GitHub Copilot CLI: npm install -g @anthropic-ai/claude-code' };
}

// ─── Output Parsing Helpers ───────────────────────────────────────────────────

/**
 * Parse Copilot's output into unified events.
 * 
 * Copilot's output patterns:
 * - Plain text → response events
 * - ```language ... ``` blocks → code events
 * - Shell commands shown in output → approval requests
 * - "Apply this change?" prompts → approval requests
 */
function parseCopilotOutput(
  raw: string,
  state: CopilotSessionState,
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

// ─── CopilotAdapter Implementation ────────────────────────────────────────────

export class CopilotAdapter implements AgentAdapter {
  static sessions = new Map<string, CopilotSessionState>();

  constructor(
    private emitters: EventEmitters
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const copilot = copilotReadiness();
    return [{
      id: 'copilot',
      name: 'GitHub Copilot CLI',
      installed: copilot.installed,
      authenticated: copilot.authenticated,
      version: copilot.version,
      loginMessage: copilot.message,
    }];
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `copilot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    CopilotAdapter.sessions.set(sessionId, state);
    
    // Resolve copilot command
    const copilotCommand = resolveCopilotCommand();
    if (!copilotCommand) {
      throw new Error('GitHub Copilot CLI not found. Install via `npm install -g @anthropic-ai/claude-code` or add it to PATH.');
    }

    const args = this.buildLaunchArgs(state);
    
    // Spawn the PTY
    const terminal = pty.spawn(copilotCommand, args, {
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
          content: `GitHub Copilot CLI stopped with code ${exitCode}.`,
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
    const state = CopilotAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || !state.pty) return '';

    state.activePrompt = prompt;
    
    // Copilot reads from stdin — write the prompt followed by newline
    state.pty.write(prompt + '\n');
    return "";
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = CopilotAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    CopilotAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    // Copilot doesn't support session reconnection (no thread IDs)
    return false;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────────

  private createSessionState(
    sessionId: string,
    options: AgentSessionOptions
  ): CopilotSessionState {
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

  private buildLaunchArgs(state: CopilotSessionState): string[] {
    const args: string[] = [];

    // Model selection (Copilot uses --model flag)
    if (state.model) {
      args.push('--model', state.model);
    }

    // Auto-approve changes (skip confirmation prompts)
    if (state.autoApprove) {
      args.push('--yes');
    }

    return args;
  }

  private buildEnvironment(state: CopilotSessionState): NodeJS.ProcessEnv {
    const env = { ...process.env };
    
    // Inject API key if provided
    if (state.apiKey) {
      env.GITHUB_TOKEN = state.apiKey;
    }

    return env;
  }

  private handleTerminalOutput(sessionId: string, data: string): void {
    const state = CopilotAdapter.sessions.get(sessionId);
    if (!state) return;

    // Emit raw terminal output for the activity view
    this.emitters.emitTerminalOutput(sessionId, data);

    // Strip ANSI escape codes before parsing
    const clean = data.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');

    // Parse into unified events
    parseCopilotOutput(clean, state, sessionId, this.emitters);
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function resolveCopilotCommand(): string | null {
  const candidates = [
    process.env.COPILOT_BIN || 'copilot',
    '/usr/local/bin/copilot',
    '/usr/bin/copilot',
    path.join(process.env.HOME || '', '.local', 'bin', 'copilot'),
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
