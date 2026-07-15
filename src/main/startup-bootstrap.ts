import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { AgentReadiness } from './agent-readiness';

export type BootstrapPhase =
  | 'idle'
  | 'discovering-local'
  | 'configuring-local'
  | 'installing-codex'
  | 'installing-open-interpreter'
  | 'refreshing'
  | 'complete';

export interface BootstrapProgress {
  phase: BootstrapPhase;
  message: string;
  active: boolean;
  completed: number;
  total: number;
  updatedAt: number;
}

export interface AgentInstallResult {
  id: 'codex' | 'open-interpreter';
  attempted: boolean;
  installed: boolean;
  executable?: string;
  diagnostic: string;
}

export interface InstallCommandRequest {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface InstallCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  timedOut: boolean;
}

export type InstallCommandRunner = (request: InstallCommandRequest) => Promise<InstallCommandResult>;

export interface InstallMissingAgentOptions {
  readiness: AgentReadiness[];
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runner?: InstallCommandRunner;
  fileExists?: (candidate: string) => boolean;
  onProgress?: (progress: BootstrapProgress) => void;
}

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 128 * 1024;

function appendLimited(current: string, chunk: Buffer | string) {
  return (current + chunk.toString()).slice(-OUTPUT_LIMIT);
}

export const runInstallCommand: InstallCommandRunner = request => new Promise(resolve => {
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const finish = (result: InstallCommandResult) => {
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
    try { child.kill(); } catch { /* best effort */ }
    finish({ exitCode: null, stdout, stderr, timedOut: true });
  }, request.timeoutMs);

  child.stdout?.on('data', chunk => { stdout = appendLimited(stdout, chunk); });
  child.stderr?.on('data', chunk => { stderr = appendLimited(stderr, chunk); });
  child.on('error', error => {
    const code = 'code' in error ? String(error.code) : undefined;
    finish({ exitCode: null, stdout, stderr, errorCode: code, timedOut });
  });
  child.on('close', exitCode => finish({ exitCode, stdout, stderr, timedOut }));
});

function commandOutput(result: InstallCommandResult) {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join(' ')
    .slice(0, 700);
}

function executableExists(candidate: string) {
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function managedAgentHome(userDataPath: string) {
  return path.join(userDataPath, 'agents');
}

export function managedCodexExecutable(userDataPath: string, platform: NodeJS.Platform = process.platform) {
  const base = path.join(managedAgentHome(userDataPath), 'codex', 'node_modules', '.bin');
  return path.join(base, platform === 'win32' ? 'codex.cmd' : 'codex');
}

export function managedOpenInterpreterExecutable(userDataPath: string, platform: NodeJS.Platform = process.platform) {
  const venv = path.join(managedAgentHome(userDataPath), 'open-interpreter');
  return platform === 'win32'
    ? path.join(venv, 'Scripts', 'interpreter.exe')
    : path.join(venv, 'bin', 'interpreter');
}

function managedOpenInterpreterPython(userDataPath: string, platform: NodeJS.Platform) {
  const venv = path.join(managedAgentHome(userDataPath), 'open-interpreter');
  return platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

export function configureManagedAgentEnvironment(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fileExists: (candidate: string) => boolean = executableExists,
) {
  const home = managedAgentHome(userDataPath);
  env.CONSIGLIO_AGENT_HOME = home;
  const codex = managedCodexExecutable(userDataPath, platform);
  const interpreter = managedOpenInterpreterExecutable(userDataPath, platform);
  if (!env.CODEX_BIN && fileExists(codex)) env.CODEX_BIN = codex;
  if (!env.OI_BIN && fileExists(interpreter)) env.OI_BIN = interpreter;
  return { home, codex, interpreter };
}

function progress(
  phase: BootstrapPhase,
  message: string,
  completed: number,
  total: number,
): BootstrapProgress {
  return { phase, message, active: phase !== 'complete', completed, total, updatedAt: Date.now() };
}

async function probe(
  runner: InstallCommandRunner,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  return runner({ command, args, env, timeoutMs: 15_000 });
}

async function findPython(runner: InstallCommandRunner, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const candidates = platform === 'win32'
    ? [{ command: 'py', prefix: ['-3'] }, { command: 'python', prefix: [] }, { command: 'python3', prefix: [] }]
    : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
  for (const candidate of candidates) {
    const result = await probe(runner, candidate.command, [...candidate.prefix, '--version'], env);
    if (!result.timedOut && result.exitCode === 0) return candidate;
  }
  return null;
}

async function installCodex(
  userDataPath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runner: InstallCommandRunner,
  fileExists: (candidate: string) => boolean,
): Promise<AgentInstallResult> {
  const prefix = path.join(managedAgentHome(userDataPath), 'codex');
  fs.mkdirSync(prefix, { recursive: true });
  const npmProbe = await probe(runner, platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], env);
  if (npmProbe.exitCode === 0 && !npmProbe.timedOut) {
    const npmCommand = platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = await runner({
      command: npmCommand,
      args: ['install', '--no-audit', '--no-fund', '--prefix', prefix, '@openai/codex'],
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    const executable = managedCodexExecutable(userDataPath, platform);
    if (result.exitCode === 0 && fileExists(executable)) {
      env.CODEX_BIN = executable;
      return { id: 'codex', attempted: true, installed: true, executable, diagnostic: 'Codex was installed in Consiglio application data.' };
    }
    return {
      id: 'codex', attempted: true, installed: false,
      diagnostic: `Codex installation with npm failed: ${commandOutput(result) || 'no installer output'}`,
    };
  }

  if (platform !== 'win32') {
    const result = await runner({
      command: 'sh',
      args: ['-lc', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'],
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (result.exitCode === 0) {
      return { id: 'codex', attempted: true, installed: true, diagnostic: 'The official Codex standalone installer completed.' };
    }
    return {
      id: 'codex', attempted: true, installed: false,
      diagnostic: `The official Codex installer failed: ${commandOutput(result) || 'no installer output'}`,
    };
  }

  return {
    id: 'codex', attempted: true, installed: false,
    diagnostic: 'Codex was not found and npm is unavailable. Install Node.js/npm or Codex manually, then refresh.',
  };
}

async function installOpenInterpreter(
  userDataPath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runner: InstallCommandRunner,
  fileExists: (candidate: string) => boolean,
): Promise<AgentInstallResult> {
  const python = await findPython(runner, env, platform);
  if (!python) {
    return {
      id: 'open-interpreter', attempted: true, installed: false,
      diagnostic: 'Open Interpreter was not found and Python 3 is unavailable. Install Python 3.10 or 3.11, then refresh.',
    };
  }

  const venv = path.join(managedAgentHome(userDataPath), 'open-interpreter');
  fs.mkdirSync(path.dirname(venv), { recursive: true });
  const create = await runner({
    command: python.command,
    args: [...python.prefix, '-m', 'venv', venv],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (create.exitCode !== 0) {
    return {
      id: 'open-interpreter', attempted: true, installed: false,
      diagnostic: `Could not create the Open Interpreter environment: ${commandOutput(create) || 'no installer output'}`,
    };
  }

  const venvPython = managedOpenInterpreterPython(userDataPath, platform);
  const install = await runner({
    command: venvPython,
    args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'open-interpreter'],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  const executable = managedOpenInterpreterExecutable(userDataPath, platform);
  if (install.exitCode === 0 && fileExists(executable)) {
    env.OI_BIN = executable;
    return {
      id: 'open-interpreter', attempted: true, installed: true, executable,
      diagnostic: 'Open Interpreter was installed in an isolated Consiglio-managed Python environment.',
    };
  }
  return {
    id: 'open-interpreter', attempted: true, installed: false,
    diagnostic: `Open Interpreter installation failed: ${commandOutput(install) || 'no installer output'}`,
  };
}

export async function installMissingAgentFrontends(options: InstallMissingAgentOptions): Promise<AgentInstallResult[]> {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const runner = options.runner || runInstallCommand;
  const fileExists = options.fileExists || executableExists;
  const total = 4;
  const results: AgentInstallResult[] = [];

  configureManagedAgentEnvironment(options.userDataPath, env, platform, fileExists);
  const codex = options.readiness.find(agent => agent.id === 'codex');
  if (codex?.installed) {
    results.push({ id: 'codex', attempted: false, installed: true, diagnostic: codex.diagnostic });
  } else {
    options.onProgress?.(progress('installing-codex', 'Installing the Codex agent front end…', 2, total));
    results.push(await installCodex(options.userDataPath, platform, env, runner, fileExists));
  }

  const interpreter = options.readiness.find(agent => agent.id === 'open-interpreter');
  if (interpreter?.installed) {
    results.push({ id: 'open-interpreter', attempted: false, installed: true, diagnostic: interpreter.diagnostic });
  } else {
    options.onProgress?.(progress('installing-open-interpreter', 'Installing Open Interpreter in an isolated environment…', 3, total));
    results.push(await installOpenInterpreter(options.userDataPath, platform, env, runner, fileExists));
  }

  configureManagedAgentEnvironment(options.userDataPath, env, platform, fileExists);
  return results;
}
