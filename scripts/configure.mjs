// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { resolve } from 'node:path';
import { developmentEnvironment, findExecutable, runExecutable } from './tooling.mjs';

let denigmaSource;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--denigma') denigmaSource = process.argv[++index];
  else throw new Error(`Unknown argument: ${process.argv[index]}`);
}

const workspace = process.cwd();
const { environment } = developmentEnvironment(workspace);
const emcmake = await findExecutable('emcmake', environment);
if (!emcmake) {
  console.error('emcmake was not found. Run "npm run doctor" for setup guidance.');
  process.exit(1);
}

const args = [
  'cmake', '-S', '.', '-B', 'build-wasm',
  '-DCMAKE_BUILD_TYPE=MinSizeRel',
  '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'
];
if (denigmaSource) args.push(`-DDENIGMA_SOURCE_DIR=${resolve(denigmaSource)}`);

const result = runExecutable(emcmake, args, { cwd: workspace, environment });
process.exit(result.status ?? 1);
