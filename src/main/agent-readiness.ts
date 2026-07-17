import { spawn } from 'child_process';

export type AgentId = 'codex' | 'open-interpreter' | 'aider' | 'claude-code';
export type AgentSupportTier = 'supported' | 'preview' | 'detected-only';
export type AgentReadinessState = 'ready' | 'configuration-required' | 'missing' | 'timeout' | 'error';
export type AgentConfigurationState = 'ready' | 'required' | 'not-required' | 'unknown';

export interface AgentReadiness {
  id: AgentId;
  name: string;
  installed: boolean;
  authenticated: boolean | null;
  configuration: AgentConfigurationState;
  selectable: boolean;
  state: AgentReadinessState;
  version?: string;
  diagnostic: string;
  supportTier: AgentSupportTier;
  checkedAt: number;
}

export interface CommandProbeRequest {
  command: string;
  args: string[];
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

export interface CommandProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  timedOut: boolean;
}

export interface ResolvedProbeCommand {
  command: string;
  prefixArgs: string[];
}

export type CommandRunner = (request: CommandProbeRequest) => Promise<CommandProbeResult>;
export type AgentCommandResolver = (
  agentId: AgentId,
  env: NodeJS.ProcessEnv,
) => ResolvedProbeCommand | null;

export interface AgentReadinessOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  commandResolver?: AgentCommandResolver;
  now?: () => number;
}

interface AgentSpec {
  id: AgentId;
  name: string;
  commandEnv: string;
  command: string;
  versionArgs: string[];
  supportTier: AgentSupportTier;
  installDiagnostic: string;
  authentication: 'codex' | 'not-required' | 'unknown';
}

const DEFAULT_TIMEOUT_MS = 4_000;
const OUTPUT_LIMIT = 64 * 1024;

const AGENT_SPECS: AgentSpec[] = [
  {
    id: 'codex',
    name: 'Codex',
    commandEnv: 'CODEX_BIN',
    command: 'codex',
    versionArgs: ['--version'],
    supportTier: 'supported',
    installDiagnostic: 'Codex CLI was not found. Consiglio will attempt a user-level installation; CODEX_BIN may override it.',
    authentication: 'codex',
  },
  {
    id: 'open-interpreter',
    name: 'Open Interpreter',
    commandEnv: 'OI_BIN',
    command: 'interpreter',
    versionArgs: ['--version'],
    supportTier: 'preview',
    installDiagnostic: 'Open Interpreter was not found. Consiglio will attempt an isolated user-level installation; OI_BIN may override it.',
    authentication: 'not-required',
  },
  {
    id: 'aider',
    name: 'Aider',
    commandEnv: 'AIDER_BIN',
    command: 'aider',
    versionArgs: ['--version'],
    supportTier: 'preview',
    installDiagnostic: 'Aider was not found. Install it with `pip install aider-chat` or set AIDER_BIN.',
    authentication: 'unknown',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    commandEnv: 'CLAUDE_BIN',
    command: 'claude',
    versionArgs: ['--version'],
    supportTier: 'preview',
    installDiagnostic: 'Claude Code was not found. Install `@anthropic-ai/claude-code` or set CLAUDE_BIN.',
    authentication: 'unknown',
  },
];

function appendLimited(current: string, chunk: Buffer | string): string {
  if (current.length >= OUTPUT_LIMIT) return current;
  return (current + chunk.toString()).slice(0, OUTPUT_LIMIT);
}

export const runCommandProbe: CommandRunner = request => new Promise(resolve => {
  let settled = false;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const finish = (result: CommandProbeResult) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolve(result);
  };

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(request.command, request.args, {
      env: request.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    resolve({ exitCode: null, stdout, stderr, errorCode: code, timedOut: false });
    return;
  }

  timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      // The readiness result must not wait for a process that ignores termination.
    }
    finish({ exitCode: null, stdout, stderr, timedOut: true });
  }, request.timeoutMs);

  child.stdout?.on('data', chunk => {
    stdout = appendLimited(stdout, chunk);
  });
  child.stderr?.on('data', chunk => {
    stderr = appendLimited(stderr, chunk);
  });
  child.on('error', error => {
    const code = 'code' in error ? String(error.code) : undefined;
    finish({ exitCode: null, stdout, stderr, errorCode: code, timedOut });
  });
  child.on('close', exitCode => {
    finish({ exitCode, stdout, stderr, timedOut });
  });
});

function probeOutput(result: CommandProbeResult): string {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('WARNING:'))
    .join('\n')
    .trim();
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean);
}

function resolvedCommand(
  spec: AgentSpec,
  env: NodeJS.ProcessEnv,
  commandResolver?: AgentCommandResolver,
): ResolvedProbeCommand {
  const hostResolved = commandResolver?.(spec.id, env);
  if (hostResolved) return hostResolved;

  return {
    command: env[spec.commandEnv]?.trim() || spec.command,
    prefixArgs: [],
  };
}

function unavailable(
  spec: AgentSpec,
  state: Extract<AgentReadinessState, 'missing' | 'timeout' | 'error'>,
  diagnostic: string,
  checkedAt: number,
  installed = false,
): AgentReadiness {
  return {
    id: spec.id,
    name: spec.name,
    installed,
    authenticated: false,
    configuration: 'required',
    selectable: false,
    state,
    diagnostic,
    supportTier: spec.supportTier,
    checkedAt,
  };
}

async function detectOne(
  spec: AgentSpec,
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  checkedAt: number,
  commandResolver?: AgentCommandResolver,
): Promise<AgentReadiness> {
  const command = resolvedCommand(spec, env, commandResolver);
  let versionResult: CommandProbeResult;

  try {
    versionResult = await runner({
      command: command.command,
      args: [...command.prefixArgs, ...spec.versionArgs],
      timeoutMs,
      env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(spec, 'error', `${spec.name} readiness check failed: ${message}`, checkedAt);
  }

  if (versionResult.timedOut) {
    return unavailable(spec, 'timeout', `${spec.name} did not answer its version check within ${timeoutMs} ms.`, checkedAt, true);
  }
  if (versionResult.errorCode === 'ENOENT') {
    return unavailable(spec, 'missing', spec.installDiagnostic, checkedAt);
  }
  if (versionResult.exitCode !== 0) {
    const detail = firstLine(probeOutput(versionResult)) || `exit code ${versionResult.exitCode ?? 'unknown'}`;
    return unavailable(spec, 'error', `${spec.name} was found, but its version check failed: ${detail}`, checkedAt, true);
  }

  const version = firstLine(probeOutput(versionResult)) || 'installed';

  if (spec.authentication === 'codex') {
    let authResult: CommandProbeResult;
    try {
      authResult = await runner({
        command: command.command,
        args: [...command.prefixArgs, 'login', 'status'],
        timeoutMs,
        env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: spec.id,
        name: spec.name,
        installed: true,
        authenticated: false,
        configuration: 'required',
        selectable: false,
        state: 'error',
        version,
        diagnostic: `Codex authentication check failed: ${message}`,
        supportTier: spec.supportTier,
        checkedAt,
      };
    }

    if (authResult.timedOut) {
      return {
        id: spec.id,
        name: spec.name,
        installed: true,
        authenticated: false,
        configuration: 'required',
        selectable: false,
        state: 'timeout',
        version,
        diagnostic: `Codex did not answer \`login status\` within ${timeoutMs} ms.`,
        supportTier: spec.supportTier,
        checkedAt,
      };
    }

    const authOutput = probeOutput(authResult);
    const explicitlyUnauthenticated = /\bnot logged in\b|\bnot authenticated\b|\bunauthenticated\b/i.test(authOutput);
    const positivelyAuthenticated = /\blogged in\b|\bauthenticated\b/i.test(authOutput);
    const authenticated = authResult.exitCode === 0 && !explicitlyUnauthenticated && positivelyAuthenticated;
    return {
      id: spec.id,
      name: spec.name,
      installed: true,
      authenticated,
      configuration: authenticated ? 'ready' : 'required',
      selectable: authenticated,
      state: authenticated ? 'ready' : 'configuration-required',
      version,
      diagnostic: authenticated
        ? authOutput || `Codex ${version} is installed and authenticated.`
        : authOutput || 'Codex is installed but not signed in. Run `codex login` and refresh.',
      supportTier: spec.supportTier,
      checkedAt,
    };
  }

  if (spec.authentication === 'not-required') {
    return {
      id: spec.id,
      name: spec.name,
      installed: true,
      authenticated: null,
      configuration: 'not-required',
      selectable: true,
      state: 'ready',
      version,
      diagnostic: `${spec.name} ${version} is available. This integration remains preview until real-CLI validation is complete.`,
      supportTier: spec.supportTier,
      checkedAt,
    };
  }

  return {
    id: spec.id,
    name: spec.name,
    installed: true,
    authenticated: null,
    configuration: 'unknown',
    selectable: true,
    state: 'ready',
    version,
    diagnostic: `${spec.name} ${version} is installed. Provider and authentication readiness will be verified when it launches.`,
    supportTier: spec.supportTier,
    checkedAt,
  };
}

export async function detectAgentReadiness(options: AgentReadinessOptions = {}): Promise<AgentReadiness[]> {
  const runner = options.runner || runCommandProbe;
  const env = options.env || process.env;
  const timeoutMs = Math.max(100, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const checkedAt = (options.now || Date.now)();

  return Promise.all(AGENT_SPECS.map(spec => detectOne(
    spec,
    runner,
    env,
    timeoutMs,
    checkedAt,
    options.commandResolver,
  )));
}
