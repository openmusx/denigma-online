// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import createDenigmaModule from '__DENIGMA_MODULE_URL__';

const wasmUrl = new URL('__DENIGMA_WASM_URL__', import.meta.url).href;
// The worker's one instance; the helpers below all use it. The page terminates the
// worker for a new file or after a failed request, which releases its memory.
let Module;
let selectedBytes;
let selectedName = '';

const severityNames = ['info', 'warning', 'error', 'verbose'];

function stringAt(pointer) {
  return pointer ? Module.UTF8ToString(pointer) : '';
}

function allocateBytes(bytes) {
  const pointer = Module._denigma_malloc(bytes.byteLength);
  if (!pointer && bytes.byteLength) throw new Error('Unable to allocate memory for the input file.');
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
      outputIndex: Module._denigma_result_part_output_index(resultPointer, index),
      pageSize: {
        widthMm: Module._denigma_result_part_page_width_mm(resultPointer, index),
        heightMm: Module._denigma_result_part_page_height_mm(resultPointer, index),
        spatiumMm: Module._denigma_result_part_spatium_mm(resultPointer, index),
        hasMargins: Module._denigma_result_part_has_page_margins(resultPointer, index) === 1,
        marginTopSp: Module._denigma_result_part_page_margin_top_sp(resultPointer, index),
        marginBottomSp: Module._denigma_result_part_page_margin_bottom_sp(resultPointer, index),
        marginLeftSp: Module._denigma_result_part_page_margin_left_sp(resultPointer, index),
        marginRightSp: Module._denigma_result_part_page_margin_right_sp(resultPointer, index)
      }
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
      outputs.push({
        suggestedName: stringAt(Module._denigma_result_output_name(resultPointer, index)),
        outputIndex: Module._denigma_result_output_index(resultPointer, index),
        data
      });
      transfers.push(data);
    }
  }

  return {
    value: {
      success: Module._denigma_result_success(resultPointer) === 1,
      scoreName: stringAt(Module._denigma_result_score_name(resultPointer)),
      scorePageSize: {
        widthMm: Module._denigma_result_score_page_width_mm(resultPointer),
        heightMm: Module._denigma_result_score_page_height_mm(resultPointer),
        spatiumMm: Module._denigma_result_score_spatium_mm(resultPointer),
        hasMargins: Module._denigma_result_score_has_page_margins(resultPointer) === 1,
        marginTopSp: Module._denigma_result_score_page_margin_top_sp(resultPointer),
        marginBottomSp: Module._denigma_result_score_page_margin_bottom_sp(resultPointer),
        marginLeftSp: Module._denigma_result_score_page_margin_left_sp(resultPointer),
        marginRightSp: Module._denigma_result_score_page_margin_right_sp(resultPointer)
      },
      diagnostics,
      parts,
      outputs
    },
    transfers
  };
}

function withInput(callback) {
  if (!selectedBytes) throw new Error('No input file is loaded.');
  const inputPointer = allocateBytes(selectedBytes);
  const namePointer = allocateString(selectedName);
  try {
    return callback(inputPointer, namePointer);
  } finally {
    // After an abort the instance is discarded, so a failed free must not
    // replace the error that caused it.
    try {
      Module._denigma_free(inputPointer);
      Module._denigma_free(namePointer);
    } catch {}
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
        options.allFontsAvailable ? 1 : 0,
        options.useFinaleRestPosition ? 1 : 0,
        options.splitInstruments ? 1 : 0,
        options.indentSpaces,
        options.cueLayer,
        selectionPointer,
        selections.length,
        0, // writeGapReport: the site never reads the MNX gap report
        options.validate ? 1 : 0
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function compileWasm() {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Unable to download ${wasmUrl} (HTTP ${response.status}).`);
  return WebAssembly.compile(await response.arrayBuffer());
}

function instantiate(wasmModule) {
  return new Promise((resolve, reject) => {
    createDenigmaModule({
      instantiateWasm(imports, receiveInstance) {
        WebAssembly.instantiate(wasmModule, imports)
          .then((instance) => receiveInstance(instance, wasmModule), reject);
        return {};
      },
      print() {},
      printErr(message) {
        postMessage({ type: 'runtime-message', message: String(message) });
      }
    }).then(resolve, reject);
  });
}

// The page passes the compiled module to every worker after the first, which
// compiles it and returns it with 'ready'.
async function initialize(providedModule) {
  const wasmModule = providedModule ?? await compileWasm();
  Module = await instantiate(wasmModule);
  postMessage({
    type: 'ready',
    denigmaVersion: stringAt(Module._denigma_version()),
    denigmaCommit: stringAt(Module._denigma_commit()),
    denigmaOnlineCommit: '__DENIGMA_ONLINE_COMMIT__',
    buildVersion: '__BUILD_VERSION__',
    wasmModule: providedModule ? undefined : wasmModule
  });
}

let loading;

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'init') {
    loading = initialize(data.wasmModule);
    loading.catch((error) => postMessage({ type: 'load-error', message: errorMessage(error) }));
    return;
  }
  try {
    await loading;
    // Any request can select the file, so a fresh worker can convert without a
    // separate inspection.
    if (data.buffer) {
      selectedBytes = new Uint8Array(data.buffer);
      selectedName = data.fileName;
    }
    if (data.type === 'inspect') {
      postMessage({ type: 'inspected', requestId: data.requestId, ...inspect().value });
      return;
    }
    if (data.type === 'convert') {
      const result = convert(data.options);
      postMessage({ type: 'converted', requestId: data.requestId, ...result.value }, result.transfers);
    }
  } catch (error) {
    postMessage({ type: 'worker-error', requestId: data.requestId, message: errorMessage(error) });
  }
});
