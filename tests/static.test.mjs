// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

test('HTML has privacy, status, accessible labels, and issue links', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /Technology preview:/);
  assert.match(html, /review exported files before relying on them/);
  assert.match(html, /entirely in your browser/);
  assert.match(html, /href="\.\/LICENSE\.txt"/);
  assert.match(html, /MIT License and warranty disclaimer/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<label for="file"/);
  assert.match(html, /MusicXML \(uncompressed\)/);
  assert.match(html, /MNX \(experimental\)/);
  assert.match(html, /EnigmaXML \(proprietary Finale XML\)/);
  assert.match(html, /github\.com\/rpatters1\/denigma\/issues/g);
  assert.doesNotMatch(html, /issues\/new/);
  assert.doesNotMatch(html, /https:\/\/(?!github\.com)/);
});

test('worker owns WASM conversion so the UI thread stays responsive', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/web/worker.js', import.meta.url), 'utf8');
  assert.match(app, /new Worker/);
  assert.match(app, /github\.com\/rpatters1\/denigma\/issues'/);
  assert.doesNotMatch(app, /issues\/new/);
  assert.match(worker, /_denigma_convert/);
  assert.match(worker, /denigmaOnlineCommit: '__DENIGMA_ONLINE_COMMIT__'/);
  assert.match(worker, /postMessage\(\{ type: 'converted'/);
});

test('production builds include Apache caching and compressed WASM rules', async () => {
  const build = await readFile(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8');
  const apache = await readFile(new URL('../deploy/apache.htaccess', import.meta.url), 'utf8');

  assert.match(build, /apache\.htaccess.*\.htaccess/);
  assert.match(apache, /max-age=31536000, immutable/);
  assert.match(apache, /Content-Encoding "gzip"/);
  assert.match(apache, /Content-Type "application\/wasm"/);
  assert.match(apache, /Content-Security-Policy/);
});

test('Emscripten exceptions are enabled before Denigma dependencies are added', async () => {
  const cmake = await readFile(new URL('../CMakeLists.txt', import.meta.url), 'utf8');
  const exceptions = cmake.indexOf('string(APPEND CMAKE_CXX_FLAGS " -fexceptions")');
  const dependencies = cmake.indexOf('FetchContent_MakeAvailable(denigma)');

  assert.ok(exceptions >= 0 && exceptions < dependencies);
});

test('VS Code setup generates Emscripten presets for the CMake Build button', async () => {
  const setup = await readFile(new URL('../scripts/setup-vscode.mjs', import.meta.url), 'utf8');
  const cmake = await readFile(new URL('../CMakeLists.txt', import.meta.url), 'utf8');

  assert.match(setup, /em-config/);
  assert.match(setup, /CMakeUserPresets\.json/);
  assert.match(setup, /Emscripten\.cmake/);
  assert.match(setup, /targets: \['web_dist'\]/);
  assert.match(setup, /PATH: environment\.PATH/);
  assert.match(setup, /DENIGMA_SOURCE_DIR: ''/);
  assert.match(cmake, /add_custom_target\(web_dist ALL/);
});

test('VS Code template is valid and exposes the onboarding workflow', async () => {
  const settings = await readJson('../.vscode_template/settings.json');
  const extensions = await readJson('../.vscode_template/extensions.json');
  const launch = await readJson('../.vscode_template/launch.json');
  const tasks = await readJson('../.vscode_template/tasks.json');

  assert.equal(settings['cmake.configureOnOpen'], false);
  assert.equal(settings['cmake.configureOnEdit'], true);
  assert.equal(settings['cmake.automaticReconfigure'], true);
  assert.equal(settings['cmake.useCMakePresets'], 'always');
  assert.equal(settings['cmake.loggingLevel'], 'debug');
  assert.equal(settings['cmake.revealLog'], 'always');
  assert.equal(settings['cmake.clearOutputBeforeBuild'], true);
  assert.ok(extensions.recommendations.includes('llvm-vs-code-extensions.vscode-clangd'));
  assert.ok(extensions.recommendations.includes('ms-vscode.cmake-tools'));
  assert.ok(launch.configurations.some(({ preLaunchTask }) => preLaunchTask === 'Dev: Build and serve'));

  const labels = new Set(tasks.tasks.map(({ label }) => label));
  for (const label of [
    'Environment: Check prerequisites',
    'WASM: Configure (pinned Denigma)',
    'WASM: Configure (local Denigma)',
    'WASM: Build site',
    'Test: All',
    'Dev: Build and serve'
  ]) {
    assert.ok(labels.has(label), `missing VS Code task: ${label}`);
  }
});
