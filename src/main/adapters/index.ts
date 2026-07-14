/**
 * Agent Adapter Registry
 * 
 * Factory function that returns the appropriate adapter based on the agent type.
 * This keeps main.ts clean and makes it easy to add new agents.
 */

import type { AgentAdapter, AgentEvent, AgentApproval, EventEmitters } from '../agent-adapter';
import { CodexAdapter } from './codex-adapter';
import { OpenInterpreterAdapter } from './open-interpreter-adapter';
import { AiderAdapter } from './aider-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';

export function getAdapter(
  agent: 'codex' | 'open-interpreter' | 'aider' | 'claude-code',
  emitters: EventEmitters
): AgentAdapter {
  switch (agent) {
    case 'codex':
      return new CodexAdapter(emitters);
    case 'open-interpreter':
      return new OpenInterpreterAdapter(emitters);
    case 'aider':
      return new AiderAdapter(emitters);
    case 'claude-code':
      return new ClaudeCodeAdapter(emitters);
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

export { CodexAdapter } from './codex-adapter';
export { OpenInterpreterAdapter } from './open-interpreter-adapter';
export { AiderAdapter } from './aider-adapter';
export { ClaudeCodeAdapter } from './claude-code-adapter';
