// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createZipBlob } from '../src/web/zip.js';

const [, , moduleArg, wasmArg, musxArg] = process.argv;
if (!moduleArg || !wasmArg || !musxArg) {
  console.error('usage: node tests/wasm-smoke.mjs <denigma.js> <denigma.wasm> <sample.musx>');
  process.exit(2);
}

const createModule = (await import(pathToFileURL(resolve(moduleArg)))).default;
const Module = await createModule({ wasmBinary: await readFile(resolve(wasmArg)) });
const input = await readFile(resolve(musxArg));
const inputPointer = Module._denigma_malloc(input.byteLength);
Module.HEAPU8.set(input, inputPointer);

const source = new TextEncoder().encode('sample.musx\0');
const sourcePointer = Module._denigma_malloc(source.byteLength);
Module.HEAPU8.set(source, sourcePointer);

function messages(result) {
  const count = Module._denigma_result_diagnostic_count(result);
  return Array.from({ length: count }, (_, index) =>
    Module.UTF8ToString(Module._denigma_result_diagnostic_message(result, index))).join('\n');
}

function assertResult(result, label, outputMarker, expectedOutputCount = 1, expectVerbose = false, expectedOutputIndices) {
  let firstOutput;
  try {
    if (!Module._denigma_result_success(result)) throw new Error(`${label} failed:\n${messages(result)}`);
    if (expectVerbose) {
      const diagnosticCount = Module._denigma_result_diagnostic_count(result);
      const hasVerbose = Array.from({ length: diagnosticCount }, (_, index) =>
        Module._denigma_result_diagnostic_severity(result, index)).includes(3);
      if (!hasVerbose) throw new Error(`${label} did not return verbose diagnostics`);
    }
    const outputCount = Module._denigma_result_output_count(result);
    if (outputCount !== expectedOutputCount) {
      throw new Error(`${label} produced ${outputCount} outputs; expected ${expectedOutputCount}`);
    }
    if (expectedOutputIndices) {
      const actual = Array.from({ length: outputCount }, (_, index) => Module._denigma_result_output_index(result, index));
      if (actual.some((value, index) => value !== expectedOutputIndices[index])) {
        throw new Error(`${label} output indices were ${actual}; expected ${expectedOutputIndices}`);
      }
    }
    const pointer = Module._denigma_result_output_data(result, 0);
    const size = Module._denigma_result_output_size(result, 0);
    firstOutput = Module.HEAPU8.slice(pointer, pointer + size);
    const text = new TextDecoder().decode(firstOutput);
    if (!text.includes(outputMarker)) throw new Error(`${label} output did not include ${outputMarker}`);
    console.log(`${label}: ${size} bytes`);
  } finally {
    Module._denigma_result_destroy(result);
  }
  return firstOutput;
}

function withAllocatedInput(bytes, name, callback) {
  const dataPointer = Module._denigma_malloc(bytes.byteLength);
  Module.HEAPU8.set(bytes, dataPointer);
  const encodedName = new TextEncoder().encode(`${name}\0`);
  const namePointer = Module._denigma_malloc(encodedName.byteLength);
  Module.HEAPU8.set(encodedName, namePointer);
  try {
    return callback(dataPointer, namePointer);
  } finally {
    Module._denigma_free(namePointer);
    Module._denigma_free(dataPointer);
  }
}

function exerciseEnigmaXmlInput(bytes, name, label) {
  withAllocatedInput(bytes, name, (dataPointer, namePointer) => {
    const inspection = Module._denigma_inspect(dataPointer, bytes.byteLength, namePointer);
    try {
      if (!Module._denigma_result_success(inspection)) throw new Error(`${label} inspection failed:\n${messages(inspection)}`);
      if (!Module.UTF8ToString(Module._denigma_result_score_name(inspection))) {
        throw new Error(`${label} inspection returned no score name or fallback`);
      }
      if (Module._denigma_result_score_page_width_mm(inspection) <= 0
          || Module._denigma_result_score_page_height_mm(inspection) <= 0
          || Module._denigma_result_score_spatium_mm(inspection) <= 0) {
        throw new Error(`${label} inspection returned no score page metrics`);
      }
      if (Module._denigma_result_score_has_page_margins(inspection) !== 1) {
        throw new Error(`${label} inspection returned no score page margins`);
      }
    } finally {
      Module._denigma_result_destroy(inspection);
    }

    const selectionPointer = Module._denigma_malloc(4);
    new DataView(Module.HEAPU8.buffer).setInt32(selectionPointer, 0, true);
    try {
      assertResult(
        Module._denigma_convert(dataPointer, bytes.byteLength, namePointer, 0, 0, 0, 2, 0, selectionPointer, 1),
        `${label} to MusicXML`, '<score-partwise', 1, false, [0]);
    } finally {
      Module._denigma_free(selectionPointer);
    }
    assertResult(
      Module._denigma_convert(dataPointer, bytes.byteLength, namePointer, 1, 0, 0, 2, 0, 0, 0),
      `${label} to MNX`, '"mnx"');
    assertResult(
      Module._denigma_convert(dataPointer, bytes.byteLength, namePointer, 2, 0, 0, 2, 0, 0, 0),
      `${label} pass-through`, '<finale');
  });
}

try {
  let firstPartOutputIndex;
  const inspection = Module._denigma_inspect(inputPointer, input.byteLength, sourcePointer);
  try {
    if (!Module._denigma_result_success(inspection)) throw new Error(`Inspection failed:\n${messages(inspection)}`);
    const scoreName = Module.UTF8ToString(Module._denigma_result_score_name(inspection));
    if (!scoreName) throw new Error('Inspection returned no score name or fallback');
    const scoreWidth = Module._denigma_result_score_page_width_mm(inspection);
    const scoreHeight = Module._denigma_result_score_page_height_mm(inspection);
    const scoreSpatium = Module._denigma_result_score_spatium_mm(inspection);
    if (scoreWidth <= 0 || scoreHeight <= 0 || scoreSpatium <= 0) {
      throw new Error('Inspection returned no score page metrics');
    }
    if (Module._denigma_result_score_has_page_margins(inspection) !== 1) {
      throw new Error('Inspection returned no score page margins');
    }
    const scoreMargins = [
      Module._denigma_result_score_page_margin_top_sp(inspection),
      Module._denigma_result_score_page_margin_bottom_sp(inspection),
      Module._denigma_result_score_page_margin_left_sp(inspection),
      Module._denigma_result_score_page_margin_right_sp(inspection)
    ];
    if (scoreMargins.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`Inspection returned invalid score page margins: ${scoreMargins}`);
    }
    const partCount = Module._denigma_result_part_count(inspection);
    if (partCount) {
      firstPartOutputIndex = Module._denigma_result_part_output_index(inspection, 0);
      if (Module._denigma_result_part_page_width_mm(inspection, 0) <= 0
          || Module._denigma_result_part_page_height_mm(inspection, 0) <= 0
          || Module._denigma_result_part_spatium_mm(inspection, 0) <= 0) {
        throw new Error('Inspection returned no linked-part page metrics');
      }
      if (Module._denigma_result_part_has_page_margins(inspection, 0) !== 1) {
        throw new Error('Inspection returned no linked-part page margins');
      }
    }
    console.log(`Inspection: ${scoreName}, ${partCount} linked parts, ${scoreWidth.toFixed(1)} × ${scoreHeight.toFixed(1)} mm, ${scoreSpatium.toFixed(2)} mm spatium`);
  } finally {
    Module._denigma_result_destroy(inspection);
  }

  const selectionPointer = Module._denigma_malloc(firstPartOutputIndex === undefined ? 4 : 8);
  new DataView(Module.HEAPU8.buffer).setInt32(selectionPointer, 0, true);
  try {
    assertResult(
      Module._denigma_convert(inputPointer, input.byteLength, sourcePointer, 0, 0, 0, 2, 0, selectionPointer, 1),
      'MusicXML', '<score-partwise', 1, false, [0]);
    if (firstPartOutputIndex !== undefined) {
      new DataView(Module.HEAPU8.buffer).setInt32(selectionPointer, firstPartOutputIndex, true);
      assertResult(
        Module._denigma_convert(inputPointer, input.byteLength, sourcePointer, 0, 1, 0, 2, 0, selectionPointer, 1),
        'MusicXML linked part', '<score-partwise', 1, false, [firstPartOutputIndex]);
      new DataView(Module.HEAPU8.buffer).setInt32(selectionPointer, 0, true);
      new DataView(Module.HEAPU8.buffer).setInt32(selectionPointer + 4, firstPartOutputIndex, true);
      assertResult(
        Module._denigma_convert(inputPointer, input.byteLength, sourcePointer, 0, 0, 0, 2, 0, selectionPointer, 2),
        'MusicXML score and linked part', '<score-partwise', 2, false, [0, firstPartOutputIndex]);
    }
  } finally {
    Module._denigma_free(selectionPointer);
  }
  assertResult(
    Module._denigma_convert(inputPointer, input.byteLength, sourcePointer, 1, 0, 0, 2, 0, 0, 0),
    'MNX with verbose logging', '"mnx"', 1, true);
  const enigmaXml = assertResult(
    Module._denigma_convert(inputPointer, input.byteLength, sourcePointer, 2, 0, 0, 2, 0, 0, 0),
    'EnigmaXML', '<finale');

  exerciseEnigmaXmlInput(enigmaXml, 'sample.enigmaxml', 'EnigmaXML input');
  const zippedBlob = await createZipBlob([{ name: 'sample.enigmaxml', data: enigmaXml }]);
  const zippedEnigmaXml = new Uint8Array(await zippedBlob.arrayBuffer());
  exerciseEnigmaXmlInput(zippedEnigmaXml, 'sample.enigmaxml.zip', 'Zipped EnigmaXML input');

  const invalidPointer = Module._denigma_malloc(3);
  Module.HEAPU8.set([1, 2, 3], invalidPointer);
  try {
    const invalidResult = Module._denigma_inspect(invalidPointer, 3, sourcePointer);
    try {
      if (Module._denigma_result_success(invalidResult)) throw new Error('Invalid MUSX input unexpectedly succeeded');
      if (!messages(invalidResult)) throw new Error('Invalid MUSX input returned no diagnostic');
      console.log('Invalid MUSX: rejected with diagnostics');
    } finally {
      Module._denigma_result_destroy(invalidResult);
    }
  } finally {
    Module._denigma_free(invalidPointer);
  }
} finally {
  Module._denigma_free(sourcePointer);
  Module._denigma_free(inputPointer);
}
