// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { developmentEnvironment, findExecutable, runExecutable } from './tooling.mjs';

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

const { environment } = developmentEnvironment(root);
const emConfig = await findExecutable('em-config', environment);
if (emConfig) {
  const rootResult = runExecutable(emConfig, ['EMSCRIPTEN_ROOT'], {
    environment,
    stdio: 'pipe',
    encoding: 'utf8'
  });
  const emscriptenRoot = rootResult.status === 0 ? rootResult.stdout.trim() : '';
  const toolchainFile = join(emscriptenRoot, 'cmake', 'Modules', 'Platform', 'Emscripten.cmake');
  if (emscriptenRoot && existsSync(toolchainFile)) {
    const emcc = await findExecutable('emcc', environment);
    const versionResult = emcc && runExecutable(emcc, ['--version'], {
      environment,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    const version = versionResult?.stdout?.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
    const configurePreset = {
      name: 'denigma-online',
      displayName: `Denigma Online: Emscripten${version ? ` ${version}` : ''}`,
      description: 'Denigma WebAssembly module and static site',
      binaryDir: '${sourceDir}/build-wasm',
      toolchainFile: toolchainFile.replaceAll('\\', '/'),
      environment: {
        PATH: environment.PATH
      },
      cacheVariables: {
        DENIGMA_SOURCE_DIR: '',
        DENIGMA_WASM_PREBUILT: 'ON'
      }
    };
    if (process.platform === 'win32') {
      const ninja = await findExecutable('ninja', environment);
      if (ninja) configurePreset.generator = 'Ninja';
    } else {
      configurePreset.generator = 'Unix Makefiles';
    }
    const presets = {
      version: 5,
      configurePresets: [configurePreset],
      buildPresets: [{
        name: 'denigma-online',
        displayName: 'Build Denigma Online',
        configurePreset: 'denigma-online',
        inheritConfigureEnvironment: true,
        targets: ['web_dist'],
        jobs: 2
      }]
    };
    await writeFile(resolve(root, 'CMakeUserPresets.json'), `${JSON.stringify(presets, null, 2)}\n`);
    console.log(`Configured VS Code CMake for Emscripten${version ? ` ${version}` : ''}.`);
  } else {
    console.warn('Emscripten was found, but its CMake toolchain file could not be located.');
  }
} else {
  console.warn('Emscripten was not found; rerun setup:vscode:force after installing or activating it.');
}

console.log('Open this folder in VS Code, install the recommended extensions, then run the environment check task.');
