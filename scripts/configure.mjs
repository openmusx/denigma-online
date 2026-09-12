// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { resolve } from 'node:path';
import { developmentEnvironment, findExecutable, runExecutable } from './tooling.mjs';

let denigmaSource;
let sourceBuild = false;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--denigma') denigmaSource = process.argv[++index];
  else if (process.argv[index] === '--source-build') sourceBuild = true;
  else throw new Error(`Unknown argument: ${process.argv[index]}`);
}

const workspace = process.cwd();
const { environment } = developmentEnvironment(workspace);
const emcmake = await findExecutable('emcmake', environment);
if (!emcmake) {
  console.error('emcmake was not found. Run "npm run doctor" for setup guidance.');
  process.exit(1);
}

// DENIGMA_SOURCE_DIR is always passed; an empty value selects the pin.
const args = [
  'cmake', '-S', '.', '-B', 'build-wasm',
  `-DDENIGMA_SOURCE_DIR=${denigmaSource ? resolve(denigmaSource) : ''}`,
  `-DDENIGMA_WASM_PREBUILT=${sourceBuild ? 'OFF' : 'ON'}`
];

const result = runExecutable(emcmake, args, { cwd: workspace, environment });
process.exit(result.status ?? 1);
