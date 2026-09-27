// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createZipBlob } from '../src/web/zip.js';
import { githubSlug, stampContents, unzip } from '../scripts/github-fetch.mjs';
import { checksumFromSha256File, distributionFiles } from '../scripts/fetch-viritura-viewer.mjs';

test('GitHub repository URLs resolve to owner/name', () => {
  assert.equal(githubSlug('https://github.com/openmusx/denigma.git'), 'openmusx/denigma');
  assert.equal(githubSlug('https://github.com/openmusx/denigma'), 'openmusx/denigma');
  assert.equal(githubSlug('git@github.com:openmusx/denigma.git'), 'openmusx/denigma');
  assert.throws(() => githubSlug('https://example.com/openmusx/denigma.git'), /not a GitHub repository/);
});

test('the artifact archive is unpacked from its central directory', async () => {
  const wasm = new Uint8Array(4096).map((_, index) => index % 7);
  const js = new TextEncoder().encode('export default function createModule() {}\n');
  const zip = await createZipBlob([
    { name: 'denigma.js', data: js },
    { name: 'denigma.wasm', data: wasm }
  ]);
  const entries = unzip(Buffer.from(await zip.arrayBuffer()));

  assert.deepEqual([...entries.keys()], ['denigma.js', 'denigma.wasm']);
  assert.deepEqual(new Uint8Array(entries.get('denigma.js')), js);
  assert.deepEqual(new Uint8Array(entries.get('denigma.wasm')), wasm);
  assert.throws(() => unzip(Buffer.from('not a zip')), /not a zip archive/);
});

test('the stamp records the download and the revision it was for', () => {
  assert.equal(
    stampContents('artifact:123', 'https://github.com/openmusx/denigma.git', 'abc'),
    'artifact:123\nhttps://github.com/openmusx/denigma.git@abc\n');
});

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function virituraArchive(prefix, overrides = {}) {
  const files = {
    'score-viewer.js': Buffer.from('import "./score-engine.js";\n'),
    'score-engine.js': Buffer.from('export {};\n'),
    'score-engine.worker.js': Buffer.from('self;\n'),
    'LICENSE': Buffer.from('MIT\n'),
    'wasm/viritura_wasm_bg.wasm': Buffer.from([0, 97, 115, 109])
  };
  const manifest = {
    commit: 'db55dd72e4e4013f51e5a6834f91f93903767c7c',
    files: Object.entries(files).map(([path, data]) => ({ path, size: data.byteLength, sha256: sha256(data) }))
  };
  const entries = new Map([[`${prefix}manifest.json`, Buffer.from(JSON.stringify(manifest))]]);
  for (const [path, data] of Object.entries({ ...files, ...overrides })) entries.set(`${prefix}${path}`, data);
  return entries;
}

test('Viritura distributions are read from wherever their manifest is', () => {
  for (const prefix of ['', 'score-engine-0.1.0/']) {
    const { manifest, files } = distributionFiles(virituraArchive(prefix));
    assert.equal(manifest.commit, 'db55dd72e4e4013f51e5a6834f91f93903767c7c');
    assert.deepEqual([...files.keys()].sort(), [
      'LICENSE', 'manifest.json', 'score-engine.js', 'score-engine.worker.js', 'score-viewer.js', 'wasm/viritura_wasm_bg.wasm'
    ]);
  }
});

test('Viritura distributions are rejected when a file does not match the manifest', () => {
  assert.throws(() => distributionFiles(virituraArchive('', { 'score-engine.js': Buffer.from('tampered') })),
    /score-engine\.js does not match its manifest\.json size and hash/);
  const missing = virituraArchive('');
  missing.delete('score-viewer.js');
  assert.throws(() => distributionFiles(missing), /has no score-viewer\.js/);
  assert.throws(() => distributionFiles(new Map()), /has no manifest\.json/);
});

test('Viritura manifests may not name files outside the distribution', () => {
  const entries = new Map([['manifest.json', Buffer.from(JSON.stringify({ files: [{ path: '../escape.js', size: 0, sha256: '' }] }))]]);
  assert.throws(() => distributionFiles(entries), /unsafe path/);
});

test('release checksums are read from sha256sum output', () => {
  const hex = 'a'.repeat(64);
  assert.equal(checksumFromSha256File(`${hex}  score-engine-0.1.0.zip\n`), hex);
  assert.throws(() => checksumFromSha256File('not a checksum'), /not sha256sum output/);
});
