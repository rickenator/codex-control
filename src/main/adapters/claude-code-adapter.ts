/**
 * ClaudeCodeAdapter — wraps the Claude Code CLI as a pluggable agent adapter.
 * 
 * This adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Command building (args for Claude Code with model/provider config)
 * - Output parsing (normalize Claude Code's tool-use output → unified events)
 * - Approval handling for file edits and shell execution
 * 
 * Claude Code yields:
 *   - Markdown text responses
 *   - Tool use blocks (read_file, write_file, run_in_terminal, etc.)
 *   - Terminal output from executed commands
 *   - Error messages and system prompts
 * 
 * See: https://docs.anthropic.com/en/docs/claude-code/overview
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

// ─── Internal Types (Claude Code-specific) ────────────────────────────────────

interface ClaudeCodeSessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  model?: string;
  provider?: string;
  apiKey?: string;
  autoApprove: boolean;
  activePrompt?: string;
  pendingApproval?: AgentApproval;
  // Buffers for parsing multi-line output
  currentToolCall?: { name: string; input: string };
  inToolBlock: boolean;
  toolBlockContent: string;
}

// ─── Claude Code Detection ────────────────────────────────────────────────────

function claudeCodeReadiness(): {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  message?: string;
} {
  try {
    const result = spawnSync('claude', ['--version'], {
      timeout: 5000,
      env: { ...process.env },
    });
    if (result.status === 0) {
      const version = result.stdout.toString().trim();
      return { installed: true, authenticated: true, version };
    }
  } catch {
    // claude not found or failed
  }
  return { installed: false, authenticated: false, message: 'Install Claude Code: npm install -g @anthropic-ai/claude-code' };
}

// ─── Output Parsing Helpers ───────────────────────────────────────────────────

/**
 * Parse Claude Code's output into unified events.
 * 
 * Claude Code's output patterns:
 * - Plain text → response events
 * - Tool call blocks (read_file, write_file, run_in_terminal) → approval requests or code events
 * - Terminal output from commands → console events
 * - Error messages → error events
 */
function parseClaudeCodeOutput(
  raw: string,
  state: ClaudeCodeSessionState,
  sessionId: string,
  emitters: EventEmitters
): void {
  const timestamp = Date.now();
  
  // Process line by line, tracking state across lines
  const lines = raw.split(/\r?\n/);
  
  for (const line of lines) {
    // ─── Tool call detection ─────────────────────────────────────────
    // Claude Code uses patterns like:
    //   <function=run_in_terminal>...</function>
    //   or JSON-like tool blocks
    
    // Detect start of tool call block
    if (/<function=(\w+)>/.test(line)) {
      const match = line.match(/<function=(\w+)>/);
      if (match) {
        state.currentToolCall = { name: match[1], input: '' };
        state.inToolBlock = true;
        state.toolBlockContent = '';
      }
      continue;
    }

    // Detect end of tool call block
    if (state.inToolBlock && /<\/function>/.test(line)) {
      const content = state.toolBlockContent.trim();
      if (content) {
        const toolName = state.currentToolCall!.name;
        
        if (toolName === 'run_in_terminal') {
          // Shell command → approval request
          const approval: AgentApproval = {
            id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            command: content,
            workingDir: state.repository,
            timestamp,
            status: 'pending',
          };
          state.pendingApproval = approval;
          emitters.emitApproval(approval);
        } else if (toolName === 'read_file') {
          // File read → files event
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'files',
            content: JSON.stringify({ path: content, action: 'read' }),
            metadata: { tool: toolName },
            timestamp,
            session_id: sessionId,
          });
        } else if (toolName === 'write_file') {
          // File write → approval request
          const approval: AgentApproval = {
            id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            command: `write ${content}`,
            workingDir: state.repository,
            timestamp,
            status: 'pending',
          };
          state.pendingApproval = approval;
          emitters.emitApproval(approval);
        } else {
          // Other tool → response event
          emitters.emitEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'response',
            content: `[Tool: ${toolName}] ${content}`,
            metadata: { tool: toolName },
            timestamp,
            session_id: sessionId,
          });
        }
      }
      
      state.currentToolCall = undefined;
      state.inToolBlock = false;
      state.toolBlockContent = '';
      continue;
    }

    // Inside tool block — accumulate content
    if (state.inToolBlock) {
      state.toolBlockContent += line + '\n';
      continue;
    }

    // ─── Terminal output detection ───────────────────────────────────
    // Claude Code prefixes terminal output with patterns like:
    //   [Terminal Output] or shows it in a distinct block
    
    if (/^\[Terminal Output\]/i.test(line)) {
      const content = line.replace(/^\[Terminal Output\]\s*/i, '').trim();
      if (content) {
        emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'console',
          content,
          timestamp,
          session_id: sessionId,
        });
      }
      continue;
    }

    // ─── Error detection ─────────────────────────────────────────────
    if (/^(Error|Failed|Exception):/i.test(line)) {
      const content = line.replace(/^(Error|Failed|Exception):\s*/i, '').trim();
      if (content) {
        emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'error',
          content,
          timestamp,
          session_id: sessionId,
        });
      }
      continue;
    }

    // ─── Plain text → response ───────────────────────────────────────
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('claude:') && !trimmed.startsWith('Claude:')) {
      emitters.emitEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'response',
        content: trimmed,
        timestamp,
        session_id: sessionId,
      });
    }
  }

  // Flush any remaining tool block at end of input
  if (state.inToolBlock && state.currentToolCall) {
    const content = state.toolBlockContent.trim();
    if (content) {
      const toolName = state.currentToolCall.name;
      
      if (toolName === 'run_in_terminal') {
        const approval: AgentApproval = {
          id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          command: content,
          workingDir: state.repository,
          timestamp,
          status: 'pending',
        };
        state.pendingApproval = approval;
        emitters.emitApproval(approval);
      } else {
        emitters.emitEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'response',
          content: `[Tool: ${toolName}] ${content}`,
          metadata: { tool: toolName },
          timestamp,
          session_id: sessionId,
        });
      }
    }
    
    state.currentToolCall = undefined;
    state.inToolBlock = false;
    state.toolBlockContent = '';
  }
}

// ─── ClaudeCodeAdapter Implementation ─────────────────────────────────────────

export class ClaudeCodeAdapter implements AgentAdapter {
  static sessions = new Map<string, ClaudeCodeSessionState>();

  constructor(
    private emitters: EventEmitters
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const claude = claudeCodeReadiness();
    return [{
      id: 'claude-code',
      name: 'Claude Code',
      installed: claude.installed,
      authenticated: claude.authenticated,
      version: claude.version,
      loginMessage: claude.message,
    }];
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `claude_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    ClaudeCodeAdapter.sessions.set(sessionId, state);
    
    // Resolve claude command
    const claudeCommand = resolveClaudeCodeCommand();
    if (!claudeCommand) {
      throw new Error('Claude Code not found. Install via `npm install -g @anthropic-ai/claude-code` or add it to PATH.');
    }

    const args = this.buildLaunchArgs(state);
    
    // Spawn the PTY
    const terminal = pty.spawn(claudeCommand, args, {
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
          content: `Claude Code stopped with code ${exitCode}.`,
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
    const state = ClaudeCodeAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || !state.pty) return '';

    state.activePrompt = prompt;
    
    // Claude Code reads from stdin — write the prompt followed by newline
    state.pty.write(prompt + '\n');
    return "";
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = ClaudeCodeAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    ClaudeCodeAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    // Claude Code doesn't support session reconnection (no thread IDs)
    return false;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────────

  private createSessionState(
    sessionId: string,
    options: AgentSessionOptions
  ): ClaudeCodeSessionState {
    return {
      id: sessionId,
      pty: null,
      repository: options.repository,
      branch: options.branch || 'main',
      model: options.model,
      provider: options.baseUrl ? options.baseUrl : undefined,
      apiKey: options.apiKey,
      autoApprove: true,
      inToolBlock: false,
      toolBlockContent: '',
    };
  }

  private buildLaunchArgs(state: ClaudeCodeSessionState): string[] {
    const args: string[] = [];

    // Model selection (Claude Code uses --model flag)
    if (state.model) {
      args.push('--model', state.model);
    }

    // Auto-approve changes (skip confirmation prompts)
    if (state.autoApprove) {
      args.push('--yes');
    }

    // Custom API base URL (for Anthropic API or custom endpoints)
    if (state.provider) {
      args.push('--api-url', state.provider);
    }

    return args;
  }

  private buildEnvironment(state: ClaudeCodeSessionState): NodeJS.ProcessEnv {
    const env = { ...process.env };
    
    // Inject API key if provided
    if (state.apiKey) {
      env.ANTHROPIC_API_KEY = state.apiKey;
    }

    return env;
  }

  private handleTerminalOutput(sessionId: string, data: string): void {
    const state = ClaudeCodeAdapter.sessions.get(sessionId);
    if (!state) return;

    // Emit raw terminal output for the activity view
    this.emitters.emitTerminalOutput(sessionId, data);

    // Strip ANSI escape codes before parsing
    const clean = data.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');

    // Parse into unified events
    parseClaudeCodeOutput(clean, state, sessionId, this.emitters);
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function resolveClaudeCodeCommand(): string | null {
  const candidates = [
    process.env.CLAUDE_BIN || 'claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(process.env.HOME || '', '.nvm', 'versions', 'node', 'bin', 'claude'),
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
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
