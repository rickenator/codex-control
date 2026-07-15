import type {
  AgentAdapter,
  AgentApproval,
  AgentSession,
  AgentSessionOptions,
} from './agent-adapter';
import { agentApprovalRouter } from './approval-router.ts';

export type ApprovalAwareAgentId = AgentSessionOptions['agent'];
export type AdapterCore = Omit<AgentAdapter, 'resolveApproval'> & Partial<Pick<AgentAdapter, 'resolveApproval'>>;

interface PendingProtocolApproval {
  approval: AgentApproval;
  approveInput: string;
  rejectInput: string;
}

interface BuildLaunchArgsHost {
  buildLaunchArgs?: (state: unknown) => string[];
}

export function sanitizeApprovalArgs(agentId: ApprovalAwareAgentId, args: string[]): string[] {
  const filtered = args.filter(arg => arg !== '--yes' && arg !== '--auto_run');
  if (agentId === 'open-interpreter' && !filtered.includes('--no_auto_run')) {
    filtered.push('--no_auto_run');
  }
  return filtered;
}

/**
 * Existing adapters predate the approval-resolution contract. Install a narrow
 * launch-argument guard while they are being migrated so none can silently
 * bypass Consiglio with global auto-approval flags.
 */
export function enforceInteractiveApprovalMode(
  agentId: ApprovalAwareAgentId,
  adapter: AdapterCore,
): void {
  if (agentId === 'codex') return;

  const host = adapter as unknown as BuildLaunchArgsHost;
  if (typeof host.buildLaunchArgs !== 'function') return;

  const original = host.buildLaunchArgs.bind(adapter);
  host.buildLaunchArgs = (state: unknown) => sanitizeApprovalArgs(agentId, original(state));
}

function protocolFor(_agentId: ApprovalAwareAgentId): Pick<PendingProtocolApproval, 'approveInput' | 'rejectInput'> {
  // The currently advertised interactive CLIs all accept a yes/no response at
  // the confirmation prompt parsed by their adapters. Keep this per-approval
  // protocol data here so future adapters can supply different key sequences.
  return { approveInput: 'y\n', rejectInput: 'n\n' };
}

/**
 * Owns session handles and pending approvals for one concrete adapter instance.
 * The decorator is returned as AgentSession.adapter, so approval IDs resolve to
 * the same session/PTY that emitted them.
 */
export class ApprovalAwareAdapter implements AgentAdapter {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly pendingApprovals = new Map<string, PendingProtocolApproval>();

  constructor(
    private readonly agentId: ApprovalAwareAgentId,
    private readonly inner: AdapterCore,
  ) {
    enforceInteractiveApprovalMode(agentId, inner);
  }

  trackApproval(approval: AgentApproval): boolean {
    if (approval.status !== 'pending') return false;
    if (this.pendingApprovals.has(approval.id)) return false;

    this.pendingApprovals.set(approval.id, {
      approval,
      ...protocolFor(this.agentId),
    });

    if (!agentApprovalRouter.register(approval, this)) {
      this.pendingApprovals.delete(approval.id);
      return false;
    }
    return true;
  }

  async launch(options: AgentSessionOptions): Promise<AgentSession> {
    const safeOptions = this.agentId === 'open-interpreter'
      ? { ...options, autoRun: false }
      : options;
    const session = await this.inner.launch(safeOptions);
    const ownedSession: AgentSession = { ...session, adapter: this };
    this.sessions.set(session.sessionId, ownedSession);
    return ownedSession;
  }

  sendPrompt(sessionId: string, input: string): Promise<string> {
    return this.inner.sendPrompt(sessionId, input);
  }

  async resolveApproval(sessionId: string, approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.approval.sessionId !== sessionId) return false;

    const session = this.sessions.get(sessionId);
    if (!session?.pty) return false;

    this.pendingApprovals.delete(approvalId);
    try {
      session.pty.write(approved ? pending.approveInput : pending.rejectInput);
      return true;
    } catch {
      this.pendingApprovals.set(approvalId, pending);
      return false;
    }
  }

  async stopSession(sessionId: string): Promise<boolean> {
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.approval.sessionId === sessionId) {
        this.pendingApprovals.delete(approvalId);
      }
    }
    agentApprovalRouter.clearSession(sessionId);
    this.sessions.delete(sessionId);
    return this.inner.stopSession(sessionId);
  }

  reconnectSession(sessionId: string): Promise<boolean> {
    return this.inner.reconnectSession(sessionId);
  }
}
