// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeFailure,
  baseName,
  diagnosticReport,
  formatBytes,
  isSupportedInputFile,
  outputFileName,
  safeNamePart,
  uniquifyFileNames,
  visibleDiagnostics
} from '../src/web/core.js';
import { versionAtLeast } from '../scripts/tooling.mjs';

test('supported input validation is case-insensitive and exact', () => {
  assert.equal(isSupportedInputFile({ name: 'Score.MUSX' }), true);
  assert.equal(isSupportedInputFile({ name: 'Score.ENIGMAXML' }), true);
  assert.equal(isSupportedInputFile({ name: 'Score.EnigmaXML.ZIP' }), true);
  assert.equal(isSupportedInputFile({ name: 'Score.xml' }), false);
  assert.equal(isSupportedInputFile({ name: 'Score.enigmaxml.zip.txt' }), false);
  assert.equal(isSupportedInputFile(undefined), false);
});

test('output names preserve Unicode and remove unsafe path characters', () => {
  assert.equal(baseName('Symphony.musx'), 'Symphony');
  assert.equal(baseName('Symphony.enigmaxml'), 'Symphony');
  assert.equal(baseName('Symphony.enigmaxml.zip'), 'Symphony');
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
    denigmaOnlineCommit: 'def456',
    buildVersion: 'online456',
    format: 'MNX',
    options: { tempo: true },
    diagnostics: [
      { severity: 'warning', message: 'Test warning' },
      { severity: 'verbose', message: 'Report-only detail' }
    ]
  });
  assert.match(report, /Denigma Online conversion report/);
  assert.match(report, /Denigma Online commit: def456/);
  assert.match(report, /Denigma Online build: online456/);
  assert.match(report, /Denigma version: 4\.0\.0/);
  assert.match(report, /\[WARNING\] Test warning/);
  assert.match(report, /\[VERBOSE\] Report-only detail/);
  assert.match(report, /Source file contents are not included/);
});

test('verbose and info diagnostics are excluded from the on-screen diagnostic list', () => {
  const diagnostics = [
    { severity: 'info', message: 'Report-only information' },
    { severity: 'verbose', message: 'Report-only detail' },
    { severity: 'warning', message: 'Visible warning' },
    { severity: 'error', message: 'Visible error' }
  ];
  assert.deepEqual(visibleDiagnostics(diagnostics), [diagnostics[2], diagnostics[3]]);
});

test('tool version checks compare semantic numeric components', () => {
  assert.equal(versionAtLeast('3.24.0', '3.24.0'), true);
  assert.equal(versionAtLeast('3.25.0', '3.24.0'), true);
  assert.equal(versionAtLeast('4.0.0', '3.24.0'), true);
  assert.equal(versionAtLeast('3.23.99', '3.24.0'), false);
  assert.equal(versionAtLeast('19.9.0', '20.0.0'), false);
});

test('resource exhaustion is described in plain words and keeps the original message', () => {
  const overflow = 'Aborted(stack overflow (Attempt to set SP to 0x0014b080, with stack limits [0x0014b590 - 0x00153590]).';
  assert.equal(describeFailure(overflow), `Denigma ran out of stack space while converting this file. (${overflow})`);
  assert.equal(describeFailure('std::bad_alloc'), 'Denigma ran out of memory while converting this file. (std::bad_alloc)');
  assert.match(describeFailure('Aborted(Cannot enlarge memory arrays to size 2147549184 bytes (OOM).)'), /^Denigma ran out of memory/);
  assert.equal(describeFailure('Select the score or at least one linked part.'), 'Select the score or at least one linked part.');
});
