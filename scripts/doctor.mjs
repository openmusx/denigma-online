// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { developmentEnvironment, findExecutable, runExecutable, versionAtLeast } from './tooling.mjs';

const workspace = process.cwd();
const { environment, emsdkRoot } = developmentEnvironment(workspace);
const failures = [];

function pass(label, detail) {
  console.log(`✓ ${label}: ${detail}`);
}

function fail(label, detail) {
  failures.push(label);
  console.error(`✗ ${label}: ${detail}`);
}

const nodeVersion = process.versions.node;
if (versionAtLeast(nodeVersion, '20.0.0')) pass('Node.js', nodeVersion);
else fail('Node.js', `${nodeVersion}; version 20 or newer is required`);

for (const [name, minimum] of [['cmake', '3.24.0'], ['git', undefined]]) {
  const executable = await findExecutable(name, environment);
  if (!executable) {
    fail(name, 'not found on PATH');
    continue;
  }
  const result = runExecutable(executable, ['--version'], { environment, stdio: 'pipe', encoding: 'utf8' });
  const version = result.stdout?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] || 'unknown';
  if (minimum && (version === 'unknown' || !versionAtLeast(version, minimum))) {
    fail(name, `${version}; version ${minimum} or newer is required`);
  } else {
    pass(name, version);
  }
}

const emcmake = await findExecutable('emcmake', environment);
const emcc = await findExecutable('emcc', environment);
if (emcmake && emcc) {
  const result = runExecutable(emcc, ['--version'], { environment, stdio: 'pipe', encoding: 'utf8' });
  const version = result.stdout?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] || 'available';
  pass('Emscripten', `${version}${emsdkRoot ? ` via ${emsdkRoot}` : ''}`);
} else {
  fail('Emscripten', 'emcmake/emcc not found; activate emsdk or set DENIGMA_EMSDK to its directory');
}

// A pinned build downloads Denigma's CI-built module with a GitHub token and
// builds Denigma from source without one.
const tokenSource = ['GITHUB_TOKEN', 'GH_TOKEN'].find((name) => environment[name]?.trim());
const gh = await findExecutable('gh', environment);
const ghToken = gh && runExecutable(gh, ['auth', 'token'], { environment, stdio: 'pipe', encoding: 'utf8' });
if (tokenSource) pass('Prebuilt Denigma module', `downloadable with ${tokenSource}`);
else if (ghToken?.status === 0 && ghToken.stdout.trim()) pass('Prebuilt Denigma module', 'downloadable with gh auth token');
else console.log('· Prebuilt Denigma module: no GitHub token (set GITHUB_TOKEN or run "gh auth login"); pinned builds compile Denigma from source');

if (failures.length) {
  console.error('\nSetup is incomplete. See README.md → Development prerequisites.');
  process.exit(1);
}
console.log('\nDevelopment environment is ready.');
