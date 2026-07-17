/**
 * Agent Adapter Registry
 *
 * Factory function that returns the appropriate adapter based on the agent type.
 * This module owns readiness and approval-routing IPC because it is loaded once
 * by the Electron main process alongside the adapter registry.
 */

import { BrowserWindow, ipcMain } from 'electron';

import { isTrustedRendererUrl } from '../app-protocol';
import { ApprovalAwareAdapter, type AdapterCore } from '../approval-aware-adapter';
import { agentApprovalRouter } from '../approval-router';
import { detectAgentReadiness } from '../agent-readiness';
import type { AgentAdapter, AgentApproval, EventEmitters } from '../agent-adapter';
import { resolveCodexCommand } from '../platform';
import { CodexAdapter } from './codex-adapter';
import { OpenInterpreterAdapter } from './open-interpreter-adapter';
import { AiderAdapter } from './aider-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { GeminiAdapter } from './gemini-adapter';
import { CopilotAdapter } from './copilot-adapter';
import { AmazonQAdapter } from './amazon-q-adapter';

export const AGENT_READINESS_CHANNEL = 'agents:readiness';
export const AGENT_APPROVAL_RESOLVE_CHANNEL = 'agents:resolve-approval';
export const AGENT_APPROVAL_PENDING_CHANNEL = 'agents:pending-approvals';

type AgentId = 'codex' | 'open-interpreter' | 'aider' | 'claude-code' | 'gemini' | 'copilot' | 'amazon-q';

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  const isMainFrame = event.senderFrame === event.sender.mainFrame;
  if (!isMainFrame || !isTrustedRendererUrl(senderUrl)) {
    throw new Error('Rejected agent request from an untrusted renderer');
  }
}

function approvalRecord(approval: AgentApproval) {
  return {
    ...approval,
    sandboxPolicy: approval.sandboxPolicy || 'agent-controlled',
    affectedPaths: approval.affectedPaths || [],
  };
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function registerAgentHandlers(): void {
  ipcMain.removeHandler(AGENT_READINESS_CHANNEL);
  ipcMain.handle(AGENT_READINESS_CHANNEL, event => {
    assertTrustedRenderer(event);
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

  ipcMain.removeHandler(AGENT_APPROVAL_RESOLVE_CHANNEL);
  ipcMain.handle(AGENT_APPROVAL_RESOLVE_CHANNEL, async (event, input: {
    approvalId?: unknown;
    approved?: unknown;
    sessionId?: unknown;
  }) => {
    assertTrustedRenderer(event);
    if (!input || typeof input.approvalId !== 'string' || typeof input.approved !== 'boolean') {
      throw new Error('Invalid approval resolution request');
    }
    const expectedSessionId = typeof input.sessionId === 'string' ? input.sessionId : undefined;
    const result = await agentApprovalRouter.resolve(input.approvalId, input.approved, expectedSessionId);
    if (result.ok) {
      broadcast('codex:approval-processed', { id: input.approvalId, approved: input.approved });
    }
    return result;
  });

  ipcMain.removeHandler(AGENT_APPROVAL_PENDING_CHANNEL);
  ipcMain.handle(AGENT_APPROVAL_PENDING_CHANNEL, (event, sessionId?: unknown) => {
    assertTrustedRenderer(event);
    return agentApprovalRouter
      .pendingApprovals(typeof sessionId === 'string' ? sessionId : undefined)
      .map(approvalRecord);
  });
}

registerAgentHandlers();

function createConcreteAdapter(agent: AgentId, emitters: EventEmitters): AdapterCore {
  switch (agent) {
    case 'codex':
      return new CodexAdapter(emitters);
    case 'open-interpreter':
      return new OpenInterpreterAdapter(emitters);
    case 'aider':
      return new AiderAdapter(emitters);
    case 'claude-code':
      return new ClaudeCodeAdapter(emitters);
    case 'gemini':
      return new GeminiAdapter(emitters);
    case 'copilot':
      return new CopilotAdapter(emitters);
    case 'amazon-q':
      return new AmazonQAdapter(emitters);
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

export function getAdapter(agent: AgentId, emitters: EventEmitters): AgentAdapter {
  let decorated: ApprovalAwareAdapter | undefined;
  const routedEmitters: EventEmitters = {
    ...emitters,
    emitApproval: (approval: AgentApproval) => {
      if (!decorated?.trackApproval(approval)) return;
      broadcast('codex:approval-request', approvalRecord(approval));
    },
  };

  const concrete = createConcreteAdapter(agent, routedEmitters);
  decorated = new ApprovalAwareAdapter(agent, concrete);
  return decorated;
}

export { CodexAdapter } from './codex-adapter';
export { OpenInterpreterAdapter } from './open-interpreter-adapter';
export { AiderAdapter } from './aider-adapter';
export { ClaudeCodeAdapter } from './claude-code-adapter';
export { GeminiAdapter } from './gemini-adapter';
export { CopilotAdapter } from './copilot-adapter';
export { AmazonQAdapter } from './amazon-q-adapter';
