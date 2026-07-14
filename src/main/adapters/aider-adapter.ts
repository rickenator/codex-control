/**
 * AiderAdapter — wraps the Aider CLI as a pluggable agent adapter.
 * 
 * STUB: Detection works, session methods throw "not yet implemented".
 * Full implementation follows CodexAdapter pattern (~500-1000 lines):
 *   - PTY spawn with `aider` command
 *   - Output parsing (Aider yields markdown + shell commands)
 *   - Approval handling for file edits and shell execution
 * 
 * See: https://github.com/paul-gauthier/aider
 */

import { execFileSync, spawnSync } from 'child_process';
import type { IPty } from 'node-pty';

import type {
  AgentAdapter,
  AgentEvent,
  AgentApproval,
  AgentSession,
  AgentSessionOptions,
  AgentInfo,
} from '../agent-adapter';

// ─── Aider Detection ──────────────────────────────────────────────────────────

function aiderReadiness(): { installed: boolean; authenticated: boolean; version?: string } {
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
  return { installed: false, authenticated: false };
}

// ─── AiderAdapter Implementation ──────────────────────────────────────────────

export class AiderAdapter implements AgentAdapter {
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
    const aider = aiderReadiness();
    return [{
      id: 'aider',
      name: 'Aider',
      installed: aider.installed,
      authenticated: aider.authenticated,
      version: aider.version,
      loginMessage: aider.installed ? undefined : 'Install Aider: pip install aider-chat',
    }];
  }

  // ─── Session Lifecycle (STUB) ────────────────────────────────────────────────

  async launch(_options: AgentSessionOptions): Promise<AgentSession> {
    throw new Error('Aider adapter not yet implemented — detection works, session management pending');
  }

  async sendPrompt(_sessionId: string, _input: string): Promise<boolean> {
    throw new Error('Aider adapter not yet implemented');
  }

  async stopSession(_sessionId: string): Promise<boolean> {
    throw new Error('Aider adapter not yet implemented');
  }

  async reconnectSession(_sessionId: string): Promise<boolean> {
    throw new Error('Aider adapter not yet implemented');
  }
}
