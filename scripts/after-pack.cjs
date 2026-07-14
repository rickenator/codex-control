const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const packageJson = require('../package.json');

module.exports = async function hardenPackagedElectron(context) {
  const executableName = context.packager.appInfo.productFilename || packageJson.build.executableName;
  const executableByPlatform = {
    darwin: path.join(context.appOutDir, `${executableName}.app`, 'Contents', 'MacOS', executableName),
    linux: path.join(context.appOutDir, executableName),
    win32: path.join(context.appOutDir, `${executableName}.exe`),
  };
  const executable = executableByPlatform[context.electronPlatformName];
  if (!executable) throw new Error(`Electron fuse hardening is not configured for ${context.electronPlatformName}`);

  await flipFuses(executable, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
};
