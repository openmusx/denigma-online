// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { downloadResources, validateManifest, normalizeSymbolFonts, readSymbolFonts, saveSymbolFonts, SYMBOL_FONTS_KEY } from '../src/web/mus-resources.js';

function fixture() {
  const files = [0, 1, 2, 3, 4].map((kind) => {
    const bytes = new TextEncoder().encode(`resource ${kind}`);
    return { kind, name: `file ${kind}`, path: `v1/file ${kind}`, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const config = { baseUrl: 'https://resources.example.test/finale/', manifest: { version: 'v1', files } };
  const fetched = [];
  const fetchFile = async (url, options) => {
    fetched.push({ url, options });
    return new Response(`resource ${Number(url.at(-1))}`);
  };
  return { config, fetched, fetchFile };
}

function memoryCache() {
  const entries = new Map();
  const cache = {
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, value) => entries.set(key, value.clone()),
    delete: async (key) => entries.delete(key)
  };
  return { entries, open: async () => cache };
}

test('resources are anonymous checksum-verified downloads in manifest order', async () => {
  const { config, fetched, fetchFile } = fixture();
  const entries = await downloadResources(config, fetchFile, undefined);
  assert.deepEqual(entries.map(({ kind }) => kind), [0, 1, 2, 3, 4]);
  assert.equal(fetched[1].url, 'https://resources.example.test/finale/v1/file%201');
  assert.equal(fetched[0].options.credentials, 'omit');
  assert.equal(fetched[0].options.referrerPolicy, 'no-referrer');
  assert.equal(entries[1].name, 'file 1');
});

test('persistent cache avoids all network requests across resource-set versions', async () => {
  const { config, fetched, fetchFile } = fixture();
  const cache = memoryCache();
  await downloadResources(config, fetchFile, cache);
  assert.equal(fetched.length, 5);
  const next = structuredClone(config);
  next.manifest.version = 'v2';
  next.manifest.files.forEach((file) => { file.path = file.path.replace('v1/', 'v2/'); });
  const offline = () => { throw new Error('Network must not be used'); };
  const entries = await downloadResources(next, offline, cache);
  assert.equal(entries.length, 5);
  const extra = { ...next.manifest.files[1], name: 'extra map', path: 'v2/file 5', size: 10,
    sha256: createHash('sha256').update('resource 5').digest('hex') };
  next.manifest.files.push(extra);
  fetched.length = 0;
  await downloadResources(next, fetchFile, cache);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /file%205$/);
});

test('one ZIP supplies all cache misses and is never fetched when every file is cached', async () => {
  const { config } = fixture();
  config.archiveUrl = 'https://resources.example.test/support-v1.zip';
  const zip = new JSZip();
  for (const file of config.manifest.files) zip.file(file.path, `resource ${file.kind}`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const openArchive = async (bytes) => {
    const archive = await JSZip.loadAsync(bytes);
    return async (path) => {
      const file = archive.file(path);
      if (!file) throw new Error(`Missing ${path}`);
      return file.async('uint8array');
    };
  };
  const cache = memoryCache();
  let requests = 0;
  const fetchArchive = async (url, options) => {
    assert.equal(url, config.archiveUrl);
    assert.equal(options.credentials, 'omit');
    requests += 1;
    return new Response(bytes);
  };
  const entries = await downloadResources(config, fetchArchive, cache, openArchive);
  assert.equal(requests, 1);
  assert.deepEqual(entries.map(({ kind }) => kind), [0, 1, 2, 3, 4]);
  await downloadResources(config, () => { throw new Error('Network must not be used'); }, cache, openArchive);
  assert.equal(requests, 1);
  const invalid = structuredClone(config);
  invalid.manifest.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(downloadResources(invalid, fetchArchive, undefined, openArchive), /Integrity check/);
  invalid.manifest.files[0].path = 'v1/missing';
  await assert.rejects(downloadResources(invalid, fetchArchive, undefined, openArchive), /Missing/);
  await assert.rejects(downloadResources(config, async () => new Response('not a zip'), undefined, openArchive));
  await assert.rejects(downloadResources(config, async () => new Response('', { status: 404 }), undefined, openArchive), /HTTP 404/);
});

test('corrupt cached data is replaced and unavailable storage does not block downloads', async () => {
  const { config, fetched, fetchFile } = fixture();
  const cache = memoryCache();
  await downloadResources(config, fetchFile, cache);
  cache.entries.set(cache.entries.keys().next().value, new Response('damaged'));
  fetched.length = 0;
  await downloadResources(config, fetchFile, cache);
  assert.equal(fetched.length, 1);
  const blocked = { open: async () => { throw new Error('storage blocked'); } };
  await downloadResources(config, fetchFile, blocked);
  const full = { open: async () => ({ match: async () => undefined, put: async () => { throw new Error('quota'); } }) };
  await downloadResources(config, fetchFile, full);
});

test('download errors and mismatched hashes fail the complete resource load', async () => {
  const { config } = fixture();
  await assert.rejects(downloadResources(config, async () => new Response('bad')), /Integrity check/);
  await assert.rejects(downloadResources(config, async () => new Response('', { status: 404 })), /HTTP 404/);
  await assert.rejects(downloadResources(config, async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(downloadResources({ ...config, baseUrl: '' }), /not been configured/);
});

test('manifests reject missing kinds, duplicate singleton resources, and unsafe paths', () => {
  const { config } = fixture();
  assert.equal(validateManifest(config.manifest), config.manifest);
  for (const path of ['../secret', '/absolute', 'https://elsewhere/file', 'v1/../file']) {
    const manifest = structuredClone(config.manifest);
    manifest.files[0].path = path;
    assert.throws(() => validateManifest(manifest), /Invalid/);
  }
  assert.throws(() => validateManifest({ version: 'v1', files: config.manifest.files.slice(1) }), /incomplete/);
  assert.throws(() => validateManifest({ version: 'v1', files: [...config.manifest.files, config.manifest.files[0]] }), /Duplicate/);
});

test('symbol font lists normalize BOM and all line endings while preserving non-ASCII bytes', () => {
  const bytes = new Uint8Array([239, 187, 191, 77, 233, 13, 10, 65, 13, 66, 10]);
  assert.deepEqual(normalizeSymbolFonts(bytes), new Uint8Array([77, 233, 10, 65, 10, 66, 10]));
  for (const bytes of [new Uint8Array(), new Uint8Array([32, 13, 10]), new Uint8Array([65, 0])]) {
    assert.throws(() => normalizeSymbolFonts(bytes), /plain-text/);
  }
  assert.throws(() => normalizeSymbolFonts(new Uint8Array(1024 * 1024 + 1)), /1 MiB/);
});

test('custom lists replace the saved value, survive reload, and can be restored to default', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const override = { name: 'my fonts.txt', bytes: new TextEncoder().encode('CustomFont\n') };
  saveSymbolFonts(storage, override);
  assert.deepEqual(readSymbolFonts(storage), override);
  saveSymbolFonts(storage, { name: 'replacement.txt', bytes: new TextEncoder().encode('OnlyThisFont') });
  assert.equal(new TextDecoder().decode(readSymbolFonts(storage).bytes), 'OnlyThisFont');
  saveSymbolFonts(storage, undefined);
  assert.equal(readSymbolFonts(storage), undefined);
  storage.setItem(SYMBOL_FONTS_KEY, '{malformed');
  assert.equal(readSymbolFonts(storage), undefined);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readSymbolFonts(blocked), undefined);
  assert.throws(() => saveSymbolFonts(blocked, override), /blocked/);
});
