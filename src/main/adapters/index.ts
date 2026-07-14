/**
 * Agent Adapter Registry
 * 
 * Factory function that returns the appropriate adapter based on the agent type.
 * This keeps main.ts clean and makes it easy to add new agents.
 */

import type { AgentAdapter } from '../agent-adapter';
import { CodexAdapter } from './codex-adapter';
import { OpenInterpreterAdapter } from './open-interpreter-adapter';

export function getAdapter(
  agent: 'codex' | 'open-interpreter' | 'aider' | 'claude-code',
  emitters: NonNullable<Parameters<CodexAdapter>['0']>
): AgentAdapter {
  switch (agent) {
    case 'codex':
      return new CodexAdapter(emitters);
    case 'open-interpreter':
      return new OpenInterpreterAdapter(emitters);
    case 'aider':
      throw new Error('Aider adapter not yet implemented');
    case 'claude-code':
      throw new Error('Claude Code adapter not yet implemented');
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

export { CodexAdapter } from './codex-adapter';
export { OpenInterpreterAdapter } from './open-interpreter-adapter';
