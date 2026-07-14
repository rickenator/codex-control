/**
 * CodexAdapter — wraps the Codex CLI as a pluggable agent adapter.
 * 
 * This adapter owns:
 * - PTY lifecycle (spawn, kill)
 * - Command building (args for Codex with provider config)
 * - Output parsing (normalize JSONL → unified events)
 * 
 * main.ts owns:
 * - Session storage
 * - Event emission to UI
 * - Approval handling
 */

import { app } from 'electron';
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
} from '../agent-adapter';
import { resolveCodexCommand, type ExecutableCommand } from '../platform';

// ─── Internal Types (Codex-specific) ──────────────────────────────────────────

type Provider = 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';

interface LanProvider {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
}

type SessionStatus = 'running' | 'stopped' | 'failed' | 'completed';

interface SessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  provider: Provider;
  status: SessionStatus;
  terminalBuffer: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  codexCommand: ExecutableCommand;
  codexThreadId?: string;
  jsonRemainder: string;
  lastStructuredError?: string;
  processedItemIds: Set<string>;
  activePrompt?: string;
  retryFreshAfterExit: boolean;
  protocolRetryUsed: boolean;
  responseBuffer: string;
  responseResolve?: ((value: string) => void) | null;
}

// ─── CodexAdapter Implementation ──────────────────────────────────────────────

export class CodexAdapter implements AgentAdapter {
  // Session storage (kept here for now; will move to main.ts later)
  static sessions = new Map<string, SessionState>();

  constructor(
    private emitters: {
      emitEvent: (event: AgentEvent) => void;
      emitApproval: (approval: AgentApproval) => void;
      emitTerminalOutput: (sessionId: string, data: string) => void;
    }
  ) {}

  // ─── Detection ───────────────────────────────────────────────────────────────

  detectAvailable(): AgentInfo[] {
    const codex = codexReadiness();
    return [{
      id: 'codex',
      name: 'Codex CLI',
      installed: codex.installed,
      authenticated: codex.authenticated,
      version: codex.version,
      loginMessage: codex.loginMessage,
    }];
  }

  // ─── Session Lifecycle ─────────────────────────────────────────────────────

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state = this.createSessionState(sessionId, options);
    
    CodexAdapter.sessions.set(sessionId, state);
    
    // Spawn the PTY
    const terminal = pty.spawn(state.codexCommand.executable, [
      ...state.codexCommand.prefixArgs,
      ...this.buildLaunchArgs(state),
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: state.repository,
      env: state.env,
    });

    state.pty = terminal;

    // Handle PTY output
    terminal.onData((data: string) => this.handleTerminalOutput(sessionId, data));
    
    // Handle PTY exit
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      state.pty = null;
      if (state.jsonRemainder.trim()) {
        this.consumeExecEvents(state, `${state.jsonRemainder}\n`);
        state.jsonRemainder = '';
      }
      if (state.retryFreshAfterExit && state.activePrompt) {
        state.retryFreshAfterExit = false;
        this.launchPromptProcess(state, state.activePrompt);
        return;
      }
      if (exitCode !== 0 && !state.lastStructuredError) {
        const detail = terminalFailureDetail(state.terminalBuffer);
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'error',
          content: detail || `Codex stopped with code ${exitCode}. Check the provider settings and try again.`,
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
    const state = CodexAdapter.sessions.get(sessionId);
    const prompt = input.trim();
    if (!state || !prompt || state.pty) return '';

    state.activePrompt = prompt;
    state.retryFreshAfterExit = false;
    state.protocolRetryUsed = false;
    state.responseBuffer = '';

    return new Promise<string>((resolve) => {
      state.responseResolve = resolve;
      this.launchPromptProcess(state, prompt);
    });
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const state = CodexAdapter.sessions.get(sessionId);
    if (!state) return false;
    
    try {
      state.pty?.kill();
    } catch {}
    CodexAdapter.sessions.delete(sessionId);
    return true;
  }

  async reconnectSession(sessionId: string): Promise<boolean> {
    // Reconnection logic would go here — for now, delegate to main.ts
    // This is a placeholder for Phase 3 when we unify session management
    return false;
  }

  // ─── Internal Methods ──────────────────────────────────────────────────────

  private createSessionState(sessionId: string, options: AgentSessionOptions): SessionState {
    const codexCommand = resolveCodexCommand({ requested: options.codexPath as string });
    if (!codexCommand) {
      throw new Error('Codex CLI was not found. Install Codex, add it to PATH, or set CODEX_BIN.');
    }

    const repository = path.resolve(options.repository);
    const env = { ...process.env };
    
    // Apply secrets (simplified — full logic in main.ts)
    applySecretsToEnvironment(env, options.provider as Provider || 'default');

    return {
      id: sessionId,
      pty: null,
      repository,
      branch: options.branch || '',
      provider: options.provider as Provider || 'default',
      status: 'running',
      terminalBuffer: '',
      args: this.buildProviderArgs(options),
      env,
      codexCommand,
      codexThreadId: options.codexThreadId as string | undefined,
      jsonRemainder: '',
      lastStructuredError: undefined,
      processedItemIds: new Set(),
      activePrompt: undefined,
      retryFreshAfterExit: false,
      protocolRetryUsed: false,
      responseBuffer: '',
    };
  }

  private buildLaunchArgs(state: SessionState): string[] {
    const threadId = state.codexThreadId ? [
      'exec', 'resume', '--json', '--skip-git-repo-check',
      ...state.args, state.codexThreadId
    ] : [
      'exec', '--json', '--skip-git-repo-check', ...state.args
    ];
    return threadId;
  }

  private buildProviderArgs(options: AgentSessionOptions): string[] {
    const args: string[] = [];
    const provider = options.provider as Provider || 'default';
    const isLocalOpenAiCompatibleProvider = provider === 'remote_llamacpp' || provider === 'lan';

    if (isLocalOpenAiCompatibleProvider) {
      const behavior = options.localProviderBehavior as {
        isolateProfile?: boolean;
        enableWebSearch?: boolean;
        enableMultiAgent?: boolean;
      } || {};
      
      if (behavior.isolateProfile) {
        const profileHome = path.join(app.getPath('userData'), 'local-provider-profiles', options.repository);
        fs.mkdirSync(profileHome, { recursive: true });
        // Note: env.CODEX_HOME is set in main.ts, not here
      }
      
      args.push(
        '-c', `features.multi_agent=${behavior.enableMultiAgent ?? false}`,
        '-c', 'model_supports_reasoning_summaries=false',
        '-c', 'model_reasoning_summary="none"',
      );
      if (!behavior.enableWebSearch) {
        args.push('-c', 'web_search="disabled"');
      }
    }

    // Provider-specific args (simplified — full logic in main.ts)
    if (provider === 'remote_llamacpp') {
      const baseUrl = normalizeBaseUrl(options.baseUrl || '');
      const model = options.model || '';
      const apiKey = options.apiKey || 'llama.cpp';
      
      args.push(
        '-c', `model="${model}"`,
        '-c', 'model_provider="remote_llamacpp"',
        '-c', 'model_providers.remote_llamacpp.name="Remote llama.cpp"',
        '-c', `model_providers.remote_llamacpp.base_url="${baseUrl}"`,
        '-c', 'model_providers.remote_llamacpp.wire_api="responses"',
        '-c', 'model_providers.remote_llamacpp.env_key="OPENAI_API_KEY"',
      );
    }

    if (provider === 'ollama') {
      const ollamaModel = options.model || 'qwen2.5:32b-instruct-q4_K_M';
      const ollamaBaseUrl = normalizeBaseUrl(options.baseUrl || 'http://localhost:11434');
      
      args.push(
        '-c', `model="${ollamaModel}"`,
        '-c', 'model_provider="ollama"',
        '-c', 'model_providers.ollama.name="Ollama"',
        '-c', `model_providers.ollama.base_url="${ollamaBaseUrl}"`,
        '-c', 'model_providers.ollama.wire_api="responses"',
        '-c', 'model_providers.ollama.env_key="OPENAI_API_KEY"',
      );
    }

    if (provider === 'gpt56') {
      args.push('-m', 'gpt-5.6');
    }

    return args;
  }

  private handleTerminalOutput(sessionId: string, data: string) {
    const state = CodexAdapter.sessions.get(sessionId);
    if (!state) return;

    state.terminalBuffer = (state.terminalBuffer + data).slice(-1_000_000);
    
    // Emit raw terminal output to UI
    this.emitters.emitTerminalOutput(sessionId, data);
    
    // Parse structured events from JSONL output
    this.consumeExecEvents(state, data);
  }

  private consumeExecEvents(state: SessionState, data: string) {
    const combined = state.jsonRemainder + data;
    const lines = combined.split(/\r?\n/);
    state.jsonRemainder = lines.pop() || '';

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as {
          type?: string;
          thread_id?: string;
          message?: string;
          error?: { message?: string };
          item?: {
            id?: string;
            type?: string;
            text?: string;
            content?: string;
            aggregated_output?: string;
            command?: string;
            exit_code?: number | null;
          };
        };

        if (event.type === 'item.completed' && event.item?.id) {
          if (state.processedItemIds.has(event.item.id)) continue;
          state.processedItemIds.add(event.item.id);
        }

        if (event.type === 'thread.started' && event.thread_id) {
          state.codexThreadId = event.thread_id;
        }

        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          const text = typeof event.item.text === 'string' ? event.item.text : event.item.content;
          if (text?.trim()) {
            state.responseBuffer += text.trim() + '\n';
            this.emitters.emitEvent({
              id: `evt_${event.item.id}`,
              type: 'response',
              content: text.trim(),
              timestamp: Date.now(),
              session_id: state.id,
            });
          }
        }

        if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
          this.emitters.emitEvent({
            id: `evt_${event.item.id}`,
            type: 'code',
            content: event.item.command || 'Ran a command',
            metadata: { language: 'shell' },
            timestamp: Date.now(),
            session_id: state.id,
          });
          
          // Check for images in output
          const imagePaths = extractWorkspaceImages(state.repository, event.item.aggregated_output || '');
          if (imagePaths.length > 0) {
            this.emitters.emitEvent({
              id: `evt_${event.item.id}_files`,
              type: 'files',
              content: JSON.stringify({ paths: imagePaths }),
              timestamp: Date.now(),
              session_id: state.id,
            });
          }
        }

        if (event.type === 'error' && event.message) {
          this.recordStructuredError(state, event.message);
        }

        if (event.type === 'turn.failed' && event.error?.message) {
          this.recordStructuredError(state, event.error.message);
        }
      } catch {
        // The PTY can split JSONL across chunks; incomplete fragments are retained above.
      }
    }
  }

  private recordStructuredError(state: SessionState, message: string) {
    const clean = decodeStructuredError(message);
    if (!clean || clean === state.lastStructuredError) return;
    
    state.lastStructuredError = clean;
    
    const incompatibleToolOutput = /output of tool call should be ['"]?input text/i.test(clean);
    if (incompatibleToolOutput) {
      state.codexThreadId = undefined;
      
      const canRetryFresh = state.provider === 'remote_llamacpp' || state.provider === 'lan' || state.provider === 'ollama';
      if (canRetryFresh && state.activePrompt && !state.protocolRetryUsed) {
        state.protocolRetryUsed = true;
        state.retryFreshAfterExit = true;
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'system',
          content: 'The local provider rejected the saved tool state. Retrying this message on a fresh thread.',
          timestamp: Date.now(),
          session_id: state.id,
        });
        return;
      }
    }

    this.emitters.emitEvent({
      id: `evt_${Date.now()}`,
      type: 'error',
      content: clean,
      timestamp: Date.now(),
      session_id: state.id,
    });
  }

  private launchPromptProcess(state: SessionState, prompt: string) {
    const commandArgs = state.codexThreadId
      ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...state.args, state.codexThreadId, prompt]
      : ['exec', '--json', '--skip-git-repo-check', ...state.args, prompt];

    state.jsonRemainder = '';
    state.lastStructuredError = undefined;
    state.processedItemIds.clear();

    const terminal = pty.spawn(state.codexCommand.executable, [
      ...state.codexCommand.prefixArgs,
      ...commandArgs,
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: state.repository,
      env: state.env,
    });

    state.pty = terminal;
    
    // Handle output for this prompt
    terminal.onData((data: string) => this.handleTerminalOutput(state.id, data));
    
    // Handle exit
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      state.pty = null;
      if (state.jsonRemainder.trim()) {
        this.consumeExecEvents(state, `${state.jsonRemainder}\n`);
        state.jsonRemainder = '';
      }
      if (state.retryFreshAfterExit && state.activePrompt) {
        state.retryFreshAfterExit = false;
        this.launchPromptProcess(state, state.activePrompt);
        return;
      }
      if (exitCode !== 0 && !state.lastStructuredError) {
        const detail = terminalFailureDetail(state.terminalBuffer);
        this.emitters.emitEvent({
          id: `evt_${Date.now()}`,
          type: 'error',
          content: detail || `Codex stopped with code ${exitCode}. Check the provider settings and try again.`,
          timestamp: Date.now(),
          session_id: state.id,
        });
      }
      // Resolve the sendPrompt promise with accumulated response
      if (state.responseResolve) {
        const response = state.responseBuffer.trim();
        state.responseResolve(response);
        state.responseResolve = null;
      }
      state.activePrompt = undefined;
    });
  }
}

// ─── Helper Functions (extracted from main.ts) ────────────────────────────────

function codexReadiness() {
  const checkedAt = Date.now();
  const command = resolveCodexCommand();
  const codexPath = command?.displayPath || process.env.CODEX_BIN || 'codex';
  try {
    if (!command) throw new Error('No Codex executable was found on PATH or in a standard installation directory.');
    const version = execFileSync(command.executable, [...command.prefixArgs, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let authenticated = false;
    let loginMessage = 'Codex is installed but not signed in.';
    const login = spawnSync(command.executable, [...command.prefixArgs, 'login', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const loginOutput = `${login.stdout || ''}\n${login.stderr || ''}`
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith('WARNING:'))
      .join('\n')
      .trim();
    authenticated = login.status === 0 && /logged in/i.test(loginOutput);
    if (loginOutput) loginMessage = loginOutput;
    return { installed: true, authenticated, version, loginMessage, codexPath, checkedAt };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Codex CLI was not found';
    return { installed: false, authenticated: false, version: '', loginMessage: message, codexPath, checkedAt };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function applySecretsToEnvironment(env: NodeJS.ProcessEnv, provider: Provider) {
  // Simplified — full logic in main.ts with encrypted secret storage
  // This is a placeholder for Phase 2
}

function extractWorkspaceImages(repository: string, output: string) {
  const root = path.resolve(repository);
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(candidate => path.resolve(candidate))
    .filter(candidate => candidate === root || candidate.startsWith(`${root}${path.sep}`))
    .filter(candidate => /\.(png|jpe?g|gif|webp|bmp)$/i.test(candidate) && fs.existsSync(candidate))
    .slice(0, 12);
}

function decodeStructuredError(message: string) {
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string } };
    return parsed.error?.message || message;
  } catch {
    return message;
  }
}

function terminalFailureDetail(buffer: string) {
  const lines = buffer
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('{'));
  const uniqueLines = lines.filter((line, index) => lines.indexOf(line) === index);
  return uniqueLines.slice(-4).join(' ').slice(0, 600);
}

