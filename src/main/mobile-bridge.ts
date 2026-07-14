import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

type JsonValue = unknown;

export interface MobileBridgeActions {
  listSessions: () => JsonValue;
  getSessionEvents: (sessionId: string) => JsonValue;
  sendInput: (sessionId: string, input: string) => JsonValue | Promise<JsonValue>;
  reconnectSession: (sessionId: string) => JsonValue | Promise<JsonValue>;
  stopSession: (sessionId: string) => JsonValue | Promise<JsonValue>;
  getPendingApprovals: (sessionId?: string) => JsonValue;
  approveCommand: (approvalId: string) => JsonValue | Promise<JsonValue>;
  rejectCommand: (approvalId: string) => JsonValue | Promise<JsonValue>;
}

export interface MobileBridgeOptions {
  token: string;
  actions: MobileBridgeActions;
  host?: string;
  port?: number;
  allowedOrigins?: string[];
}

export interface MobileBridgeHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_LENGTH = 50_000;
const DEFAULT_ORIGINS = ['capacitor://localhost', 'http://localhost', 'https://localhost'];

class BridgeRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function respond(response: ServerResponse, status: number, body: JsonValue, origin?: string) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage, expectedToken: Buffer) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  return supplied.length === expectedToken.length && crypto.timingSafeEqual(supplied, expectedToken);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BridgeRequestError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function pathSegments(url: URL) {
  return url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
}

export async function startMobileBridge(options: MobileBridgeOptions): Promise<MobileBridgeHandle> {
  if (options.token.length < 32) throw new Error('The mobile bridge token must contain at least 32 characters');
  const host = options.host || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('The mobile bridge must bind to loopback; expose it through an authenticated TLS tunnel');
  }
  const expectedToken = Buffer.from(options.token, 'utf8');
  const origins = new Set(options.allowedOrigins || DEFAULT_ORIGINS);
  const attempts = new Map<string, { windowStarted: number; count: number }>();

  const server = http.createServer(async (request, response) => {
    const origin = typeof request.headers.origin === 'string' && origins.has(request.headers.origin)
      ? request.headers.origin
      : undefined;
    if (request.method === 'OPTIONS') {
      if (!origin) return respond(response, 403, { error: 'Origin is not allowed' });
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return respond(response, 204, null, origin);
    }
    if (request.headers.origin && !origin) return respond(response, 403, { error: 'Origin is not allowed' });

    const client = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rate = attempts.get(client);
    const current = !rate || now - rate.windowStarted >= 60_000
      ? { windowStarted: now, count: 1 }
      : { ...rate, count: rate.count + 1 };
    attempts.set(client, current);
    if (current.count > 120) return respond(response, 429, { error: 'Rate limit exceeded' }, origin);
    if (!authorized(request, expectedToken)) return respond(response, 401, { error: 'Unauthorized' }, origin);

    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const segments = pathSegments(url);
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        return respond(response, 200, { ok: true, service: 'consiglio-mobile-bridge', version: 1 }, origin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/sessions') {
        return respond(response, 200, options.actions.listSessions(), origin);
      }
      if (request.method === 'GET' && segments[0] === 'v1' && segments[1] === 'sessions' && segments[3] === 'events') {
        return respond(response, 200, options.actions.getSessionEvents(segments[2]), origin);
      }
      if (request.method === 'POST' && segments[0] === 'v1' && segments[1] === 'sessions' && segments[3] === 'input') {
        const body = await readJson(request);
        if (typeof body.input !== 'string' || !body.input.trim() || body.input.length > MAX_PROMPT_LENGTH) {
          return respond(response, 400, { error: 'Input must be a non-empty string of at most 50,000 characters' }, origin);
        }
        return respond(response, 200, { ok: await options.actions.sendInput(segments[2], body.input) }, origin);
      }
      if (request.method === 'POST' && segments[0] === 'v1' && segments[1] === 'sessions' && segments[3] === 'reconnect') {
        return respond(response, 200, { ok: await options.actions.reconnectSession(segments[2]) }, origin);
      }
      if (request.method === 'POST' && segments[0] === 'v1' && segments[1] === 'sessions' && segments[3] === 'stop') {
        return respond(response, 200, { ok: await options.actions.stopSession(segments[2]) }, origin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/approvals') {
        return respond(response, 200, options.actions.getPendingApprovals(url.searchParams.get('sessionId') || undefined), origin);
      }
      if (request.method === 'POST' && segments[0] === 'v1' && segments[1] === 'approvals' && segments[3] === 'approve') {
        return respond(response, 200, { ok: await options.actions.approveCommand(segments[2]) }, origin);
      }
      if (request.method === 'POST' && segments[0] === 'v1' && segments[1] === 'approvals' && segments[3] === 'reject') {
        return respond(response, 200, { ok: await options.actions.rejectCommand(segments[2]) }, origin);
      }
      return respond(response, 404, { error: 'Not found' }, origin);
    } catch (error) {
      if (error instanceof BridgeRequestError) return respond(response, error.status, { error: error.message }, origin);
      if (error instanceof SyntaxError) return respond(response, 400, { error: 'Invalid JSON request body' }, origin);
      if (error instanceof URIError) return respond(response, 400, { error: 'Invalid request path' }, origin);
      console.error('Mobile bridge request failed:', error);
      return respond(response, 500, { error: 'Internal bridge error' }, origin);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 43117, host, () => resolve());
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the mobile bridge address');
  return {
    host,
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
