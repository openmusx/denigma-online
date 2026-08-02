// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { createZipBlob, supportsCompression } from '../src/web/zip.js';

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const UTF8_NAME_FLAG = 0x0800;

// Reads the archive the way an unzip tool does: EOCD first, then the central
// directory, so a wrong offset or size in either record fails the test.
function readArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - END_RECORD_SIZE;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory signature');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  assert.equal(directoryOffset + directorySize, end, 'central directory abuts the end record');

  const decoder = new TextDecoder();
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, 'central header signature');
    const flag = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, 'local header signature');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const bodyStart = localOffset + LOCAL_HEADER_SIZE + localNameLength + extraLength;
    const body = bytes.subarray(bodyStart, bodyStart + compressedSize);
    const data = method === 0 ? Buffer.from(body) : inflateRawSync(Buffer.from(body));

    entries.push({ name, flag, method, crc, size, data });
    cursor += CENTRAL_HEADER_SIZE + nameLength;
  }
  return entries;
}

async function archiveBytes(entries) {
  const blob = await createZipBlob(entries);
  return new Uint8Array(await blob.arrayBuffer());
}

const encoder = new TextEncoder();
const scoreXml = encoder.encode(`<score-partwise>${'<measure number="1"/>'.repeat(400)}</score-partwise>`);

test('the runtime can compress, so the archive path is exercised', () => {
  assert.equal(supportsCompression(), true);
});

test('archive round-trips every entry byte for byte', async () => {
  const flute = encoder.encode('<score-partwise><part id="P1"/></score-partwise>');
  const bytes = await archiveBytes([
    { name: 'Score.musicxml', data: scoreXml },
    { name: 'Score.Flute.musicxml', data: flute }
  ]);
  const entries = readArchive(bytes);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.name), ['Score.musicxml', 'Score.Flute.musicxml']);
  assert.deepEqual(Buffer.from(entries[0].data), Buffer.from(scoreXml));
  assert.deepEqual(Buffer.from(entries[1].data), Buffer.from(flute));
  for (const entry of entries) {
    assert.equal(entry.crc, crc32(Buffer.from(entry.data)), `CRC-32 for ${entry.name}`);
    assert.equal(entry.size, entry.data.length, `uncompressed size for ${entry.name}`);
  }
});

test('repetitive MusicXML actually deflates', async () => {
  const bytes = await archiveBytes([{ name: 'Score.musicxml', data: scoreXml }]);
  const entries = readArchive(bytes);
  assert.equal(entries[0].method, 8);
  assert.ok(bytes.length < scoreXml.length / 2, `archive ${bytes.length} vs source ${scoreXml.length}`);
});

test('incompressible data is stored rather than grown', async () => {
  const random = new Uint8Array(4096);
  crypto.getRandomValues(random);
  const bytes = await archiveBytes([{ name: 'noise.bin', data: random }]);
  const entries = readArchive(bytes);
  assert.equal(entries[0].method, 0);
  assert.deepEqual(Buffer.from(entries[0].data), Buffer.from(random));
});

test('Unicode part names survive with the UTF-8 flag set', async () => {
  // safeNamePart preserves Unicode, so real part names reach the archive intact.
  const name = 'Score.Clarinét _ B♭.musicxml';
  const bytes = await archiveBytes([{ name, data: scoreXml }]);
  const entries = readArchive(bytes);
  assert.equal(entries[0].name, name);
  assert.equal(entries[0].flag & UTF8_NAME_FLAG, UTF8_NAME_FLAG);
});

test('ArrayBuffer payloads are accepted, matching worker output', async () => {
  const bytes = await archiveBytes([{ name: 'Score.mnx', data: scoreXml.buffer.slice(0) }]);
  const entries = readArchive(bytes);
  assert.deepEqual(Buffer.from(entries[0].data), Buffer.from(scoreXml));
});

// Validates container structure and CRCs against an independent implementation.
// Note `-t` only, not extraction: the Info-ZIP 6.00 build Apple ships predates
// general purpose bit 11 and cannot write Unicode names to disk. Finder, Windows
// Explorer, 7-Zip, and Python all honour the flag; the flag itself is asserted above.
test('the system unzip accepts the archive', async (t) => {
  if (spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status !== 0) {
    t.skip('unzip is unavailable');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'denigma-zip-'));
  try {
    const bytes = await archiveBytes([
      { name: 'Score.musicxml', data: scoreXml },
      { name: 'Score.Clarinét _ B♭.musicxml', data: scoreXml }
    ]);
    const path = join(directory, 'outputs.zip');
    await writeFile(path, bytes);
    const result = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No errors detected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
