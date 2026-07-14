/**
 * ClaudeCodeAdapter — wraps the Claude Code CLI as a pluggable agent adapter.
 * 
 * STUB: Detection works, session methods throw "not yet implemented".
 * Full implementation follows CodexAdapter pattern (~500-1000 lines):
 *   - PTY spawn with `claude` command
 *   - Output parsing (Claude Code yields markdown + tool use blocks)
 *   - Approval handling for file edits and shell execution
 * 
 * See: https://docs.anthropic.com/en/docs/claude-code/overview
 */

import { spawnSync } from 'child_process';
import type { IPty } from 'node-pty';

import type {
  AgentAdapter,
  AgentEvent,
  AgentApproval,
  AgentSession,
  AgentSessionOptions,
  AgentInfo,
} from '../agent-adapter';

// ─── Claude Code Detection ────────────────────────────────────────────────────

function claudeCodeReadiness(): { installed: boolean; authenticated: boolean; version?: string } {
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
  return { installed: false, authenticated: false };
}

// ─── ClaudeCodeAdapter Implementation ─────────────────────────────────────────

export class ClaudeCodeAdapter implements AgentAdapter {
  private sessions = new Map<string, { pty: IPty | null; repository: string }>();

  constructor(
    private emitters: {
      emitEvent: (event: AgentEvent) => void;
      emitApproval: (approval: AgentApproval) => void;
      emitTerminalOutput: (sessionId: string, data: string) => void;
    }
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
      loginMessage: claude.installed ? undefined : 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
    }];
  }

  // ─── Session Lifecycle (STUB) ────────────────────────────────────────────────

  async launch(_options: AgentSessionOptions): Promise<AgentSession> {
    throw new Error('Claude Code adapter not yet implemented — detection works, session management pending');
  }

  async sendPrompt(_sessionId: string, _input: string): Promise<boolean> {
    throw new Error('Claude Code adapter not yet implemented');
  }

  async stopSession(_sessionId: string): Promise<boolean> {
    throw new Error('Claude Code adapter not yet implemented');
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    throw new Error('Claude Code adapter not yet implemented');
  }
}
