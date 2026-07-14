import { normalizePairingConfig, type PairingConfig } from './pairing-config';

export type BridgeConfig = PairingConfig;

export interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: string;
  model?: string;
  status: 'running' | 'stopped' | 'failed' | 'completed';
  updated_at: number;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  type: string;
  content: string;
  timestamp: number;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  command: string;
  workingDir: string;
  sandboxPolicy: string;
  affectedPaths: string[];
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

export class BridgeClient {
  readonly endpoint: string;
  private readonly token: string;

  constructor(config: BridgeConfig) {
    const normalized = normalizePairingConfig(config);
    this.endpoint = normalized.endpoint;
    this.token = normalized.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `Bridge request failed (${response.status})`);
    return body as T;
  }

  health() { return this.request<{ ok: boolean; version: number }>('/v1/health'); }
  sessions() { return this.request<SessionRecord[]>('/v1/sessions'); }
  events(sessionId: string) { return this.request<SessionEvent[]>(`/v1/sessions/${encodeURIComponent(sessionId)}/events`); }
  approvals(sessionId?: string) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    return this.request<ApprovalRecord[]>(`/v1/approvals${query}`);
  }
  sendInput(sessionId: string, input: string) {
    return this.request<{ ok: boolean }>(`/v1/sessions/${encodeURIComponent(sessionId)}/input`, { method: 'POST', body: JSON.stringify({ input }) });
  }
  reconnect(sessionId: string) { return this.request<{ ok: boolean }>(`/v1/sessions/${encodeURIComponent(sessionId)}/reconnect`, { method: 'POST' }); }
  stop(sessionId: string) { return this.request<{ ok: boolean }>(`/v1/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }); }
  decide(approvalId: string, decision: 'approve' | 'reject') {
    return this.request<{ ok: boolean }>(`/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`, { method: 'POST' });
  }
}
