// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as core from '../src/web/core.js';
import * as resources from '../src/web/mus-resources.js';
import { createWorkerHost } from '../src/web/worker-host.js';

// A minimal DOM boundary for file-opening and settings state transitions. The
// real application and worker host run unchanged; workers return controlled results.
async function app(storage = new Map()) {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.checked = false; this.dataset = {}; this.listeners = {}; this.children = []; this.classList = { add() {}, remove() {} }; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    async fire(type, event = {}) {
      await this.listeners[type]?.({ preventDefault() {}, ...event });
      await new Promise((resolve) => setImmediate(resolve));
    }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    querySelectorAll(selector) {
      const inputs = this.children.flatMap((child) => child instanceof Element ? [child, ...child.querySelectorAll(selector)] : []);
      return inputs.filter((input) => input.name === 'document' && (!selector.includes(':checked') || input.checked));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  }
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  const score = new Element();
  Object.assign(score, { name: 'document', value: '0', checked: true });
  elements.documents.children = [score, elements.linkedParts];
  elements.format.value = 'musicxml';
  const enigmaOption = {};
  elements.format.querySelector = () => enigmaOption;
  elements.mnxPretty.checked = true;
  const workers = [];
  class FakeWorker {
    constructor() { this.messages = []; workers.push(this); }
    addEventListener(type, listener) { this.listener = listener; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.listener({ data }); }
  }
  const source = (await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../src/web/app.js', import.meta.url).href));
  const context = vm.createContext({ ...core, ...resources, createWorkerHost,
    supportsCompression: () => false, Worker: FakeWorker, URL, TextEncoder, Uint8Array,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: { querySelectorAll: () => Object.values(elements), createElement: () => new Element(), createTextNode: (text) => text, addEventListener() {} },
    window: { addEventListener() {} }
  });
  vm.runInContext(source, context);
  workers[0].emit({ type: 'ready' });
  const current = () => workers.at(-1);
  const request = () => current().messages.at(-1);
  const kind = (legacyInput) => current().emit({ type: 'input-kind', requestId: request().requestId, legacyInput });
  const inspected = () => current().emit({ type: 'inspected', requestId: request().requestId, success: true, scoreName: 'Test', parts: [], diagnostics: [] });
  return { elements, current, request, kind, inspected, enigmaOption, storage };
}

const scoreFile = (name = 'score') => ({ name, size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

test('picker and drop both send arbitrary filenames to WASM and legacy input disables EnigmaXML', async () => {
  const ui = await app();
  ui.elements.format.value = 'enigmaxml';
  ui.elements.file.files = [scoreFile('misleading.random')];
  await ui.elements.file.fire('change');
  assert.equal(ui.request().fileName, 'misleading.random');
  assert.equal(ui.elements.convert.disabled, true);
  ui.kind(true);
  assert.equal(ui.elements.format.value, 'musicxml');
  assert.equal(ui.enigmaOption.disabled, true);
  ui.inspected();
  assert.equal(ui.elements.convert.disabled, false);
  await ui.elements.dropZone.fire('drop', { dataTransfer: { files: [scoreFile('extensionless')] } });
  assert.equal(ui.request().fileName, 'extensionless');
  ui.kind(false);
  ui.inspected();
  assert.equal(ui.enigmaOption.disabled, false);
});

test('resource failure blocks conversion until explicit defaults or retry and persists the choice on conversion', async () => {
  const ui = await app();
  ui.elements.file.files = [scoreFile()];
  await ui.elements.file.fire('change');
  ui.kind(true);
  ui.current().emit({ type: 'resources-unavailable', requestId: ui.request().requestId, message: 'offline' });
  assert.equal(ui.elements.resourceFailure.hidden, false);
  assert.equal(ui.elements.convert.disabled, true);
  await ui.elements.format.fire('change');
  assert.equal(ui.elements.convert.disabled, true);
  await ui.elements.retryResources.fire('click');
  assert.equal(ui.request().allowDefaults, false);
  ui.kind(true);
  ui.current().emit({ type: 'resources-unavailable', requestId: ui.request().requestId, message: 'offline' });
  await ui.elements.useDefaults.fire('click');
  assert.equal(ui.request().allowDefaults, true);
  assert.equal(ui.elements.resourceFailure.hidden, true);
  ui.kind(true);
  ui.inspected();
  await ui.elements.convert.fire('click');
  assert.equal(ui.request().type, 'convert');
  assert.equal(ui.request().allowDefaults, true);
});

test('custom fonts save once, force reinspection, and keep conversion disabled until inspection completes', async () => {
  const ui = await app();
  ui.elements.file.files = [scoreFile()];
  await ui.elements.file.fire('change');
  ui.kind(true);
  ui.inspected();
  const bytes = new TextEncoder().encode('CustomFont\r');
  ui.elements.symbolFonts.files = [{ name: 'fonts.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer }];
  await ui.elements.symbolFonts.fire('change');
  assert.equal(ui.request().type, 'inspect');
  assert.equal(new TextDecoder().decode(ui.request().fontOverride.bytes), 'CustomFont\n');
  assert.equal(ui.elements.convert.disabled, true);
  assert.equal(ui.elements.symbolFonts.disabled, true);
  ui.kind(true);
  ui.inspected();
  assert.equal(ui.elements.convert.disabled, false);
  const reloaded = await app(ui.storage);
  reloaded.elements.file.files = [scoreFile()];
  await reloaded.elements.file.fire('change');
  assert.equal(reloaded.request().fontOverride.name, 'fonts.txt');
  ui.elements.symbolFonts.files = [{ name: 'invalid.txt', size: 1, arrayBuffer: async () => new Uint8Array([0]).buffer }];
  await ui.elements.symbolFonts.fire('change');
  assert.equal(resources.readSymbolFonts({ getItem: (key) => ui.storage.get(key) }).name, 'fonts.txt');
  await ui.elements.restoreSymbolFonts.fire('click');
  assert.equal(ui.request().fontOverride, undefined);
  assert.equal(ui.elements.convert.disabled, true);
  assert.equal(ui.storage.has(resources.SYMBOL_FONTS_KEY), false);
});

test('blocked settings storage leaves the custom list active for the session with a visible notice', async () => {
  const storage = new Map();
  storage.set = () => { throw new Error('Storage blocked'); };
  const ui = await app(storage);
  const bytes = new TextEncoder().encode('CustomFont\n');
  ui.elements.symbolFonts.files = [{ name: 'fonts.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer }];
  await ui.elements.symbolFonts.fire('change');
  assert.match(ui.elements.symbolFontsStatus.textContent, /could not be saved.*only to this session/);
  ui.elements.file.files = [scoreFile()];
  await ui.elements.file.fire('change');
  assert.equal(ui.request().fontOverride.name, 'fonts.txt');
  assert.equal(storage.has(resources.SYMBOL_FONTS_KEY), false);
});
