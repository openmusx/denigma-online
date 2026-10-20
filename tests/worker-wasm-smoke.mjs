// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

// Exercise the built browser worker with real WASM in a Node worker. Only the
// browser messaging and local asset fetch are adapted; conversion code is real.
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const manifest = JSON.parse(await readFile(new URL('../dist/asset-manifest.json', import.meta.url)));
const workerUrl = new URL(`../dist/${manifest.worker}`, import.meta.url).href;
const legacy = await readFile(new URL('data/F100-note.mus', import.meta.url));
const modern = await readFile(new URL('data/linked-parts.musx', import.meta.url));
const synthetic = [
  [0, 'MacSymbolFonts.txt', 'Maestro\n'], [1, 'Example.xml', '<Finale/>'],
  [2, 'conversion.txt', '// empty table\n'], [3, 'Example.soundmap', '<Soundmap/>'], [4, 'catalog.xml', '<InstrumentCatalog/>']
].map(([kind, name, text]) => ({ kind, name, bytes: new TextEncoder().encode(text) }));

const { openResourceArchive } = await import(new URL(`../dist/${manifest.resourceArchiveModule}`, import.meta.url));
const supportZip = new JSZip();
for (const { name, bytes } of synthetic) supportZip.file(`v1/${name}`, bytes);
const archiveFile = await openResourceArchive(await supportZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
assert.equal(new TextDecoder().decode(await archiveFile('v1/Example.xml')), '<Finale/>');
await assert.rejects(archiveFile('v1/missing.xml'), /missing/);

function spawn(wasmModule, resourceCache) {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const { readFile } = require('node:fs/promises');
    globalThis.self = { addEventListener: (_, callback) => parentPort.on('message', data => callback({ data })) };
    globalThis.postMessage = (data, transfers) => parentPort.postMessage(data, transfers);
    globalThis.fetch = async url => {
      if (!String(url).startsWith('file:')) throw new Error('Network disabled in worker smoke test');
      return new Response(await readFile(new URL(url)));
    };
    import(${JSON.stringify(workerUrl)}).catch(error => { throw error; });
  `, { eval: true });
  const queued = [];
  const pending = new Set();
  let failure;
  worker.on('message', (message) => {
    const waiter = [...pending].find(({ type, requestId }) => message.type === type && (requestId === undefined || message.requestId === requestId));
    if (waiter) waiter.resolve(message);
    else queued.push(message);
  });
  worker.on('error', (error) => {
    failure = error;
    for (const waiter of pending) waiter.reject(error);
  });
  function receive(type, requestId) {
    const index = queued.findIndex((message) => message.type === type && (requestId === undefined || message.requestId === requestId));
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => waiter.reject(new Error(`Timed out awaiting ${type}: ${JSON.stringify(queued)}`)), 30000);
      const waiter = { type, requestId,
        resolve(value) { clearTimeout(timer); pending.delete(waiter); resolve(value); },
        reject(error) { clearTimeout(timer); pending.delete(waiter); reject(error); } };
      pending.add(waiter);
    });
  }
  worker.postMessage({ type: 'init', wasmModule, resourceCache });
  return { worker, receive, send: (message) => worker.postMessage(message) };
}

const first = spawn();
let compiled;
try {
  compiled = (await first.receive('ready')).wasmModule;
  first.send({ type: 'inspect', requestId: 1, buffer: legacy, fileName: 'extensionless' });
  assert.equal((await first.receive('input-kind', 1)).legacyInput, true);
  assert.ok((await first.receive('resources-unavailable', 1)).message);
  first.send({ type: 'inspect', requestId: 2, allowDefaults: true });
  assert.equal((await first.receive('inspected', 2)).success, true);
  first.send({ type: 'convert', requestId: 3, allowDefaults: true,
    options: { format: 0, selectedOutputs: [0], indentSpaces: 2, cueLayer: 0 } });
  const result = await first.receive('converted', 3);
  assert.equal(result.success, true);
  assert.match(result.resourceInfo, /Reader defaults/);
  assert.match(new TextDecoder().decode(result.outputs[0].data), /<score-partwise/);
} finally { await first.worker.terminate(); }

const cached = spawn(compiled, synthetic);
try {
  await cached.receive('ready');
  cached.send({ type: 'inspect', requestId: 1, buffer: legacy, fileName: 'misleading.musx',
    fontOverride: { name: 'my-fonts.txt', bytes: new TextEncoder().encode('CustomFont\n') } });
  const result = await cached.receive('inspected', 1);
  assert.equal(result.success, true);
  assert.match(result.resourceInfo, /symbol fonts: custom/);
  assert.deepEqual((await cached.receive('resource-cache')).resources, synthetic);
} finally { await cached.worker.terminate(); }

const malformed = spawn(compiled, [{ kind: 3, name: 'bad.soundmap', bytes: new TextEncoder().encode('<Other/>') }]);
try {
  await malformed.receive('ready');
  malformed.send({ type: 'inspect', requestId: 1, buffer: legacy, fileName: 'score' });
  assert.match((await malformed.receive('resources-unavailable', 1)).message, /Soundmap/);
  malformed.send({ type: 'inspect', requestId: 2, allowDefaults: true });
  assert.equal((await malformed.receive('inspected', 2)).success, true);
} finally { await malformed.worker.terminate(); }

const nonlegacy = spawn(compiled);
try {
  await nonlegacy.receive('ready');
  nonlegacy.send({ type: 'inspect', requestId: 1, buffer: modern, fileName: 'score.musx' });
  assert.equal((await nonlegacy.receive('input-kind', 1)).legacyInput, false);
  const result = await nonlegacy.receive('inspected', 1);
  assert.equal(result.success, true);
  assert.equal(result.resourceInfo, 'Not used');
  const damaged = (await readFile(new URL('data/F300-baseline.mus', import.meta.url))).subarray(0, 1024);
  nonlegacy.send({ type: 'inspect', requestId: 2, buffer: damaged, fileName: 'damaged' });
  const badResult = await nonlegacy.receive('inspected', 2);
  assert.equal(badResult.success, false);
  assert.match(badResult.diagnostics.map(({ message }) => message).join('\n'), /Damaged legacy/);
} finally { await nonlegacy.worker.terminate(); }
console.log('Built worker: legacy detection, resource failure/recovery, cache, override, defaults, MUSX, and damaged MUS passed.');
