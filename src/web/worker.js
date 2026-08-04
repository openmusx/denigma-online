// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import createDenigmaModule from '__DENIGMA_MODULE_URL__';

const wasmUrl = new URL('__DENIGMA_WASM_URL__', import.meta.url).href;
let Module;
let selectedBytes;
let selectedName = '';

const severityNames = ['info', 'warning', 'error', 'verbose'];

function stringAt(pointer) {
  return pointer ? Module.UTF8ToString(pointer) : '';
}

function allocateBytes(bytes) {
  const pointer = Module._denigma_malloc(bytes.byteLength);
  if (!pointer && bytes.byteLength) throw new Error('Unable to allocate memory for the MUSX file.');
  Module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function allocateString(value) {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const pointer = Module._denigma_malloc(encoded.byteLength);
  if (!pointer) throw new Error('Unable to allocate the source filename.');
  Module.HEAPU8.set(encoded, pointer);
  return pointer;
}

function readResult(resultPointer, includeOutputs) {
  const diagnostics = [];
  const diagnosticCount = Module._denigma_result_diagnostic_count(resultPointer);
  for (let index = 0; index < diagnosticCount; index += 1) {
    diagnostics.push({
      severity: severityNames[Module._denigma_result_diagnostic_severity(resultPointer, index)] || 'error',
      message: stringAt(Module._denigma_result_diagnostic_message(resultPointer, index))
    });
  }

  const parts = [];
  const partCount = Module._denigma_result_part_count(resultPointer);
  for (let index = 0; index < partCount; index += 1) {
    parts.push({
      id: Module._denigma_result_part_id(resultPointer, index),
      name: stringAt(Module._denigma_result_part_name(resultPointer, index)),
      outputIndex: Module._denigma_result_part_output_index(resultPointer, index)
    });
  }

  const outputs = [];
  const transfers = [];
  if (includeOutputs) {
    const outputCount = Module._denigma_result_output_count(resultPointer);
    for (let index = 0; index < outputCount; index += 1) {
      const dataPointer = Module._denigma_result_output_data(resultPointer, index);
      const size = Module._denigma_result_output_size(resultPointer, index);
      const data = Module.HEAPU8.slice(dataPointer, dataPointer + size).buffer;
      outputs.push({ suggestedName: stringAt(Module._denigma_result_output_name(resultPointer, index)), data });
      transfers.push(data);
    }
  }

  return {
    value: {
      success: Module._denigma_result_success(resultPointer) === 1,
      scoreName: stringAt(Module._denigma_result_score_name(resultPointer)),
      diagnostics,
      parts,
      outputs
    },
    transfers
  };
}

function withInput(callback) {
  if (!selectedBytes) throw new Error('No MUSX file is loaded.');
  const inputPointer = allocateBytes(selectedBytes);
  const namePointer = allocateString(selectedName);
  try {
    return callback(inputPointer, namePointer);
  } finally {
    Module._denigma_free(inputPointer);
    Module._denigma_free(namePointer);
  }
}

function inspect() {
  return withInput((inputPointer, namePointer) => {
    const resultPointer = Module._denigma_inspect(inputPointer, selectedBytes.byteLength, namePointer);
    if (!resultPointer) throw new Error('Denigma did not return an inspection result.');
    try {
      return readResult(resultPointer, false);
    } finally {
      Module._denigma_result_destroy(resultPointer);
    }
  });
}

function convert(options) {
  return withInput((inputPointer, namePointer) => {
    const selections = new Int32Array(options.selectedOutputs || []);
    const selectionPointer = selections.byteLength ? allocateBytes(new Uint8Array(selections.buffer)) : 0;
    try {
      const resultPointer = Module._denigma_convert(
        inputPointer,
        selectedBytes.byteLength,
        namePointer,
        options.format,
        options.includeTempo ? 1 : 0,
        options.splitInstruments ? 1 : 0,
        options.indentSpaces,
        options.cueLayer,
        selectionPointer,
        selections.length
      );
      if (!resultPointer) throw new Error('Denigma did not return a conversion result.');
      try {
        return readResult(resultPointer, true);
      } finally {
        Module._denigma_result_destroy(resultPointer);
      }
    } finally {
      if (selectionPointer) Module._denigma_free(selectionPointer);
    }
  });
}

async function initialize() {
  Module = await createDenigmaModule({
    locateFile(path) {
      return path.endsWith('.wasm') ? wasmUrl : path;
    },
    print() {},
    printErr(message) {
      postMessage({ type: 'runtime-message', message: String(message) });
    }
  });
  postMessage({
    type: 'ready',
    denigmaVersion: stringAt(Module._denigma_version()),
    denigmaCommit: stringAt(Module._denigma_commit()),
    denigmaOnlineCommit: '__DENIGMA_ONLINE_COMMIT__',
    buildVersion: '__BUILD_VERSION__'
  });
}

self.addEventListener('message', ({ data }) => {
  try {
    if (data.type === 'inspect') {
      selectedBytes = new Uint8Array(data.buffer);
      selectedName = data.fileName;
      const result = inspect();
      postMessage({ type: 'inspected', requestId: data.requestId, ...result.value });
      return;
    }
    if (data.type === 'convert') {
      const result = convert(data.options);
      postMessage({ type: 'converted', requestId: data.requestId, ...result.value }, result.transfers);
    }
  } catch (error) {
    postMessage({
      type: 'worker-error',
      requestId: data.requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

initialize().catch((error) => {
  postMessage({ type: 'load-error', message: error instanceof Error ? error.message : String(error) });
});
