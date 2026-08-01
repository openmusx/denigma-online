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
  assert.match(html, /entirely in your browser/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<label for="file"/);
  assert.match(html, /github\.com\/rpatters1\/denigma\/issues/g);
  assert.doesNotMatch(html, /https:\/\/(?!github\.com)/);
});

test('worker owns WASM conversion so the UI thread stays responsive', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/web/worker.js', import.meta.url), 'utf8');
  assert.match(app, /new Worker/);
  assert.match(worker, /_denigma_convert/);
  assert.match(worker, /postMessage\(\{ type: 'converted'/);
});

test('VS Code template is valid and exposes the onboarding workflow', async () => {
  const settings = await readJson('../.vscode_template/settings.json');
  const extensions = await readJson('../.vscode_template/extensions.json');
  const launch = await readJson('../.vscode_template/launch.json');
  const tasks = await readJson('../.vscode_template/tasks.json');

  assert.equal(settings['cmake.configureOnOpen'], false);
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
