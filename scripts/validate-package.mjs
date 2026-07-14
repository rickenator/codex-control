#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(projectRoot, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const product = packageJson.build.productName;
const version = packageJson.version;
const requireSigning = process.env.REQUIRE_CODE_SIGNING === 'true';
const requireNotarization = process.env.REQUIRE_NOTARIZATION === 'true';

function fail(message) {
  throw new Error(message);
}

function requireFile(filePath, minimumBytes = 1) {
  if (!fs.existsSync(filePath)) fail(`Missing package artifact: ${path.relative(projectRoot, filePath)}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < minimumBytes) {
    fail(`Package artifact is unexpectedly small: ${path.relative(projectRoot, filePath)} (${stat.size} bytes)`);
  }
  return filePath;
}

function requireDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    fail(`Missing unpacked application: ${path.relative(projectRoot, directoryPath)}`);
  }
  return directoryPath;
}

function readElfMachine(filePath) {
  const header = Buffer.alloc(20);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) fail(`${filePath} is not an ELF binary`);
  return header.readUInt16LE(18);
}

function readPeMachine(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const dosHeader = Buffer.alloc(64);
    fs.readSync(descriptor, dosHeader, 0, dosHeader.length, 0);
    if (dosHeader.toString('ascii', 0, 2) !== 'MZ') fail(`${filePath} is not a PE binary`);
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    fs.readSync(descriptor, peHeader, 0, peHeader.length, peOffset);
    if (peHeader.toString('ascii', 0, 4) !== 'PE\0\0') fail(`${filePath} has an invalid PE header`);
    return peHeader.readUInt16LE(4);
  } finally {
    fs.closeSync(descriptor);
  }
}

function nativeModules(resourcesPath) {
  const moduleRoot = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty');
  requireDirectory(moduleRoot);
  const runtimeDirectories = [
    path.join(moduleRoot, 'build', 'Release'),
    path.join(moduleRoot, 'build', 'Debug'),
    path.join(moduleRoot, 'prebuilds', `${process.platform}-${process.arch}`),
  ];
  const runtimeDirectory = runtimeDirectories.find(candidate => fs.existsSync(path.join(candidate, 'pty.node')));
  if (!runtimeDirectory) fail(`The packaged node-pty module for ${process.platform}/${process.arch} is missing`);
  const modules = fs.readdirSync(runtimeDirectory)
    .filter(name => name.endsWith('.node'))
    .map(name => path.join(runtimeDirectory, name));
  if (modules.length === 0) fail('The packaged node-pty native modules are missing');
  return modules;
}

function validateLinux() {
  if (process.arch !== 'x64') fail(`Linux packaging validation does not support ${process.arch}`);
  const appImage = requireFile(path.join(dist, `${product}-${version}-linux-x86_64.AppImage`), 1_000_000);
  const deb = requireFile(path.join(dist, `${product}-${version}-linux-amd64.deb`), 1_000_000);
  const unpacked = requireDirectory(path.join(dist, 'linux-unpacked'));
  const executable = requireFile(path.join(unpacked, 'consiglio'), 1_000_000);
  const resources = requireDirectory(path.join(unpacked, 'resources'));
  requireFile(path.join(resources, 'app.asar'), 1_000);

  if (readElfMachine(appImage) !== 62 || readElfMachine(executable) !== 62) fail('Linux packages are not x86-64');
  for (const binary of nativeModules(resources)) {
    if (readElfMachine(binary) !== 62) fail(`Packaged node-pty module is not x86-64: ${binary}`);
  }

  execFileSync('dpkg-deb', ['--info', deb], { stdio: 'inherit' });
  const fields = execFileSync('dpkg-deb', ['--field', deb, 'Package', 'Version', 'Architecture'], { encoding: 'utf8' });
  if (!fields.includes('consiglio') || !fields.includes(version) || !fields.includes('amd64')) {
    fail(`Unexpected Debian metadata:\n${fields}`);
  }
  return executable;
}

function macApplication() {
  const outputDirectories = fs.readdirSync(dist, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
    .map(entry => path.join(dist, entry.name));
  const candidates = outputDirectories.flatMap(directory => fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    .map(entry => path.join(directory, entry.name)));
  if (candidates.length !== 1) fail(`Expected one unpacked macOS app, found ${candidates.length}`);
  return candidates[0];
}

function plistValue(plist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
}

function validateMac() {
  if (process.arch !== 'x64' && process.arch !== 'arm64') fail(`macOS packaging validation does not support ${process.arch}`);
  const arch = process.arch;
  const expectedMachArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const dmg = requireFile(path.join(dist, `${product}-${version}-mac-${arch}.dmg`), 1_000_000);
  const zip = requireFile(path.join(dist, `${product}-${version}-mac-${arch}.zip`), 1_000_000);
  const application = requireDirectory(macApplication());
  const contents = requireDirectory(path.join(application, 'Contents'));
  const plist = requireFile(path.join(contents, 'Info.plist'));
  const executableName = plistValue(plist, 'CFBundleExecutable');
  // Electron's macOS launcher is intentionally a small Mach-O stub; lipo below
  // provides the meaningful binary-format and architecture validation.
  const executable = requireFile(path.join(contents, 'MacOS', executableName), 10_000);
  const resources = requireDirectory(path.join(contents, 'Resources'));
  requireFile(path.join(resources, 'app.asar'), 1_000);

  if (plistValue(plist, 'CFBundleIdentifier') !== packageJson.build.appId) fail('Unexpected macOS bundle identifier');
  if (plistValue(plist, 'CFBundleShortVersionString') !== version) fail('Unexpected macOS bundle version');
  for (const binary of [executable, ...nativeModules(resources)]) {
    const architectures = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/);
    if (!architectures.includes(expectedMachArch)) fail(`${binary} does not contain ${expectedMachArch}`);
  }

  execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' });
  execFileSync('unzip', ['-t', zip], { stdio: 'ignore' });
  if (requireSigning) execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', application], { stdio: 'inherit' });
  if (requireNotarization) {
    execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', application], { stdio: 'inherit' });
  }
  return executable;
}

function validateWindowsSignature(filePath) {
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:CONSIGLIO_SIGNED_FILE',
    "if ($signature.Status -ne 'Valid') { throw \"Invalid Authenticode signature: $($signature.Status)\" }",
  ].join('; ');
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit',
    env: { ...process.env, CONSIGLIO_SIGNED_FILE: filePath },
  });
}

function validateWindows() {
  if (process.arch !== 'x64') fail(`Windows packaging validation does not support ${process.arch}`);
  const setup = requireFile(path.join(dist, `${product}-${version}-windows-x64-setup.exe`), 1_000_000);
  const portable = requireFile(path.join(dist, `${product}-${version}-windows-x64-portable.exe`), 1_000_000);
  const unpacked = requireDirectory(path.join(dist, 'win-unpacked'));
  const executable = requireFile(path.join(unpacked, 'consiglio.exe'), 1_000_000);
  const resources = requireDirectory(path.join(unpacked, 'resources'));
  requireFile(path.join(resources, 'app.asar'), 1_000);

  for (const binary of [setup, portable, executable, ...nativeModules(resources)]) {
    if (readPeMachine(binary) !== 0x8664) fail(`${binary} is not Windows x64`);
  }
  if (requireSigning) {
    validateWindowsSignature(setup);
    validateWindowsSignature(portable);
    validateWindowsSignature(executable);
  }
  return executable;
}

async function validateFuses(executable) {
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
    [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
  ]);
  const wire = await getCurrentFuseWire(executable);
  const fuseKeys = Object.keys(wire).filter(key => /^\d+$/.test(key));
  if (wire.version !== FuseVersion.V1 || fuseKeys.length !== expected.size) {
    fail(`Unexpected Electron fuse wire version or length: v${wire.version}, ${fuseKeys.length} fuses`);
  }
  for (const [fuse, expectedState] of expected) {
    if (wire[fuse] !== expectedState) fail(`Electron fuse ${FuseV1Options[fuse]} has an unexpected state`);
  }
}

const validate = {
  linux: validateLinux,
  darwin: validateMac,
  win32: validateWindows,
}[process.platform];

if (!validate) fail(`Package validation is not configured for ${process.platform}`);
const executable = validate();
await validateFuses(executable);
console.log(`Validated ${product} ${version} for ${process.platform}/${process.arch}.`);
