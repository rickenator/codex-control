import type { AgentApproval } from './agent-adapter';

export type ApprovalResolutionFailure =
  | 'not-found'
  | 'already-resolved'
  | 'cross-session'
  | 'target-rejected';

export interface ApprovalResolutionResult {
  ok: boolean;
  approvalId: string;
  sessionId?: string;
  approved?: boolean;
  reason?: ApprovalResolutionFailure;
}

export interface ApprovalResolutionTarget {
  resolveApproval(sessionId: string, approvalId: string, approved: boolean): Promise<boolean>;
}

interface PendingApproval {
  approval: AgentApproval;
  target: ApprovalResolutionTarget;
}

/**
 * Routes a normalized approval ID back to the exact adapter instance that
 * emitted it. IDs are single-use and remain tombstoned after resolution or
 * session cleanup so they cannot be replayed.
 */
export class AgentApprovalRouter {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly resolved = new Set<string>();

  register(approval: AgentApproval, target: ApprovalResolutionTarget): boolean {
    if (!approval.id || !approval.sessionId) return false;
    if (this.pending.has(approval.id) || this.resolved.has(approval.id)) return false;
    this.pending.set(approval.id, { approval, target });
    return true;
  }

  pendingApprovals(sessionId?: string): AgentApproval[] {
    return [...this.pending.values()]
      .map(entry => entry.approval)
      .filter(approval => !sessionId || approval.sessionId === sessionId)
      .sort((left, right) => right.timestamp - left.timestamp);
  }

  pendingIds(sessionId?: string): string[] {
    return this.pendingApprovals(sessionId).map(approval => approval.id);
  }

  has(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  async resolve(
    approvalId: string,
    approved: boolean,
    expectedSessionId?: string,
  ): Promise<ApprovalResolutionResult> {
    if (this.resolved.has(approvalId)) {
      return { ok: false, approvalId, reason: 'already-resolved' };
    }

    const entry = this.pending.get(approvalId);
    if (!entry) {
      return { ok: false, approvalId, reason: 'not-found' };
    }

    if (expectedSessionId && entry.approval.sessionId !== expectedSessionId) {
      return {
        ok: false,
        approvalId,
        sessionId: entry.approval.sessionId,
        reason: 'cross-session',
      };
    }

    // Reserve the ID before invoking adapter code so concurrent desktop/mobile
    // decisions cannot both reach the blocked process.
    this.pending.delete(approvalId);
    this.resolved.add(approvalId);

    let accepted = false;
    try {
      accepted = await entry.target.resolveApproval(
        entry.approval.sessionId,
        approvalId,
        approved,
      );
    } catch {
      accepted = false;
    }

    if (!accepted) {
      this.resolved.delete(approvalId);
      this.pending.set(approvalId, entry);
      return {
        ok: false,
        approvalId,
        sessionId: entry.approval.sessionId,
        reason: 'target-rejected',
      };
    }

    return {
      ok: true,
      approvalId,
      sessionId: entry.approval.sessionId,
      approved,
    };
  }

  clearSession(sessionId: string): string[] {
    const cleared: string[] = [];
    for (const [approvalId, entry] of this.pending) {
      if (entry.approval.sessionId !== sessionId) continue;
      this.pending.delete(approvalId);
      this.resolved.add(approvalId);
      cleared.push(approvalId);
    }
    return cleared;
  }

  reset(): void {
    this.pending.clear();
    this.resolved.clear();
  }
}

export const agentApprovalRouter = new AgentApprovalRouter();
