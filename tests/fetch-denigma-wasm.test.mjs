// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { createZipBlob } from '../src/web/zip.js';
import { githubSlug, stampContents, unzip } from '../scripts/fetch-denigma-wasm.mjs';

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
