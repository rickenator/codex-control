import fs from 'fs';
import os from 'os';
import path from 'path';

export interface ExecutableCommand {
  executable: string;
  prefixArgs: string[];
  displayPath: string;
}

interface ResolveExecutableOptions {
  requested?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  fileExists?: (candidate: string) => boolean;
}

function executableFileExists(candidate: string) {
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function windowsExtensions(env: NodeJS.ProcessEnv) {
  return (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(extension => extension.trim().toLowerCase())
    .filter(Boolean);
}

function withPlatformExtensions(candidate: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform !== 'win32' || path.extname(candidate)) return [candidate];
  return windowsExtensions(env).map(extension => `${candidate}${extension}`);
}

export function codexExecutableCandidates(options: Omit<ResolveExecutableOptions, 'fileExists'> = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const home = options.homeDirectory || os.homedir();
  const requested = options.requested?.trim() || env.CODEX_BIN?.trim();
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'] : ['codex'];
  const directories = (env.PATH || '').split(platformPath.delimiter).filter(Boolean);

  const managedAgentHome = env.CONSIGLIO_AGENT_HOME?.trim();
  if (managedAgentHome) {
    directories.push(platformPath.join(managedAgentHome, 'codex', 'node_modules', '.bin'));
  }

  if (platform === 'win32') {
    if (env.APPDATA) directories.push(platformPath.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) directories.push(platformPath.join(env.LOCALAPPDATA, 'Programs', 'Codex'));
  } else {
    directories.push(
      platformPath.join(home, 'bin'),
      platformPath.join(home, '.local', 'bin'),
      platformPath.join(home, '.npm-global', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/local/bin',
    );
  }

  const candidates: string[] = [];
  if (requested) {
    const hasDirectory = platformPath.dirname(requested) !== '.';
    if (hasDirectory) candidates.push(...withPlatformExtensions(platformPath.resolve(requested), platform, env));
    else {
      for (const directory of directories) {
        candidates.push(...withPlatformExtensions(platformPath.join(directory, requested), platform, env));
      }
    }
  } else {
    for (const directory of directories) {
      for (const name of names) candidates.push(platformPath.join(directory, name));
    }
  }

  return [...new Set(candidates)];
}

export function commandForExecutable(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ExecutableCommand {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)) {
    return {
      executable: env.ComSpec || env.COMSPEC || 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', executablePath],
      displayPath: executablePath,
    };
  }
  return { executable: executablePath, prefixArgs: [], displayPath: executablePath };
}

export function resolveCodexCommand(options: ResolveExecutableOptions = {}): ExecutableCommand | null {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const exists = options.fileExists || executableFileExists;
  const candidate = codexExecutableCandidates(options).find(exists);
  return candidate ? commandForExecutable(candidate, platform, env) : null;
}
