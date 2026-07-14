#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const scriptByPlatform = {
  linux: 'package:linux',
  darwin: 'package:mac',
  win32: 'package:win',
};

const script = scriptByPlatform[process.platform];
if (!script) {
  console.error(`Consiglio packaging is not configured for ${process.platform}.`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', script], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
