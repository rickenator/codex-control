/**
 * Agent Adapter Registry
 *
 * Factory function that returns the appropriate adapter based on the agent type.
 * This module also owns the readiness IPC endpoint because it is loaded once by
 * the Electron main process alongside the adapter registry.
 */

import { ipcMain } from 'electron';

import { isTrustedRendererUrl } from '../app-protocol';
import { detectAgentReadiness } from '../agent-readiness';
import type { AgentAdapter, EventEmitters } from '../agent-adapter';
import { resolveCodexCommand } from '../platform';
import { CodexAdapter } from './codex-adapter';
import { OpenInterpreterAdapter } from './open-interpreter-adapter';
import { AiderAdapter } from './aider-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';

export const AGENT_READINESS_CHANNEL = 'agents:readiness';

function registerAgentReadinessHandler(): void {
  ipcMain.removeHandler(AGENT_READINESS_CHANNEL);
  ipcMain.handle(AGENT_READINESS_CHANNEL, event => {
    const senderUrl = event.senderFrame?.url || event.sender.getURL();
    const isMainFrame = event.senderFrame === event.sender.mainFrame;
    if (!isMainFrame || !isTrustedRendererUrl(senderUrl)) {
      throw new Error('Rejected agent readiness request from an untrusted renderer');
    }

    return detectAgentReadiness({
      commandResolver: (agentId, env) => {
        if (agentId !== 'codex') return null;
        const command = resolveCodexCommand({ env });
        return command
          ? { command: command.executable, prefixArgs: command.prefixArgs }
          : null;
      },
    });
  });
}

registerAgentReadinessHandler();

export function getAdapter(
  agent: 'codex' | 'open-interpreter' | 'aider' | 'claude-code',
  emitters: EventEmitters,
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
