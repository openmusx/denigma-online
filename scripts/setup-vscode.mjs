// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// npm consumes `--force` unless it follows `--`. Honor npm's corresponding
// environment setting as well so both common spellings work.
const force = process.argv.includes('--force') || process.env.npm_config_force === 'true';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, '.vscode_template');
const destination = resolve(root, '.vscode');

if (existsSync(destination) && !force) {
  const contents = await readdir(destination);
  console.error(`.vscode already exists${contents.length ? ' and contains local configuration' : ''}.`);
  console.error('Nothing was overwritten. To refresh the shared files intentionally, run:');
  console.error('  npm run setup:vscode:force');
  process.exit(1);
}

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
console.log('Copied .vscode_template to .vscode.');
console.log('Open this folder in VS Code, install the recommended extensions, then run the environment check task.');
