// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseName,
  diagnosticReport,
  formatBytes,
  isMusxFile,
  outputFileName,
  safeNamePart,
  uniquifyFileNames
} from '../src/web/core.js';
import { versionAtLeast } from '../scripts/tooling.mjs';

test('MUSX validation is case-insensitive', () => {
  assert.equal(isMusxFile({ name: 'Score.MUSX' }), true);
  assert.equal(isMusxFile({ name: 'Score.xml' }), false);
  assert.equal(isMusxFile(undefined), false);
});

test('output names preserve Unicode and remove unsafe path characters', () => {
  assert.equal(baseName('Symphony.musx'), 'Symphony');
  assert.equal(safeNamePart('Clarinét / B♭'), 'Clarinét _ B♭');
  assert.equal(outputFileName('Score.musx', 'musicxml', 'Flute', 0, 2), 'Score.Flute.musicxml');
  assert.equal(outputFileName('Score.musx', 'mnx', '', 0, 1), 'Score.mnx');
});

test('duplicate linked-part names receive unique output names', () => {
  const result = uniquifyFileNames([
    { name: 'Score.Flute.musicxml' },
    { name: 'Score.Flute.musicxml' },
    { name: 'score.flute.musicxml' }
  ]);
  assert.deepEqual(result.map(({ name }) => name), [
    'Score.Flute.musicxml',
    'Score.Flute-2.musicxml',
    'score.flute-3.musicxml'
  ]);
});

test('byte sizes are concise', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MiB');
});

test('diagnostic reports contain reproducibility data and privacy notice', () => {
  const report = diagnosticReport({
    denigmaVersion: '4.0.0',
    denigmaCommit: 'abc123',
    buildVersion: 'online456',
    format: 'MNX',
    options: { tempo: true },
    diagnostics: [{ severity: 'warning', message: 'Test warning' }]
  });
  assert.match(report, /Denigma Online conversion report/);
  assert.match(report, /Denigma Online build: online456/);
  assert.match(report, /Denigma version: 4\.0\.0/);
  assert.match(report, /\[WARNING\] Test warning/);
  assert.match(report, /Source file contents are not included/);
});

test('tool version checks compare semantic numeric components', () => {
  assert.equal(versionAtLeast('3.24.0', '3.24.0'), true);
  assert.equal(versionAtLeast('3.25.0', '3.24.0'), true);
  assert.equal(versionAtLeast('4.0.0', '3.24.0'), true);
  assert.equal(versionAtLeast('3.23.99', '3.24.0'), false);
  assert.equal(versionAtLeast('19.9.0', '20.0.0'), false);
});
