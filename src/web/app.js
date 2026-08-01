// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import {
  FORMATS,
  diagnosticReport,
  formatBytes,
  isMusxFile,
  outputFileName,
  uniquifyFileNames
} from '__CORE_MODULE_URL__';

const ISSUE_URL = 'https://github.com/rpatters1/denigma/issues';
const worker = new Worker(new URL('__WORKER_MODULE_URL__', import.meta.url), { type: 'module' });
const elements = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), (element) => [element.id, element]));

let requestId = 0;
let pendingRequest = 0;
let wasmReady = false;
let busy = false;
let inputFile;
let parts = [];
let outputs = [];
let objectUrls = [];
let diagnostics = [];
let lastConversion;
let runtime = {
  denigmaVersion: 'unknown',
  denigmaCommit: 'unknown',
  denigmaOnlineCommit: 'unknown',
  buildVersion: 'unknown'
};

function shortCommit(value) {
  return /^[0-9a-f]{8,}$/i.test(value) ? value.slice(0, 7) : value;
}

function setStatus(message, kind = 'info') {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function setBusy(value) {
  busy = value;
  elements.file.disabled = value || !wasmReady;
  elements.convert.disabled = value || !wasmReady || !inputFile || !hasValidSelection();
  elements.format.disabled = value;
  elements.musicxmlOptions.disabled = value;
  elements.mnxOptions.disabled = value;
  elements.enigmaxmlOptions.disabled = value;
}

function hasValidSelection() {
  if (elements.format.value !== 'musicxml') return true;
  return Boolean(elements.documents.querySelector('input:checked'));
}

function revokeObjectUrls() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
}

function clearOutputs() {
  revokeObjectUrls();
  outputs = [];
  diagnostics = [];
  lastConversion = undefined;
  elements.results.hidden = true;
  elements.outputList.replaceChildren();
  elements.diagnostics.replaceChildren();
  elements.failureActions.hidden = true;
  elements.copyReport.hidden = true;
}

function selectedFormat() {
  return FORMATS[elements.format.value];
}

function showFormatOptions() {
  const format = elements.format.value;
  elements.musicxmlOptions.hidden = format !== 'musicxml';
  elements.mnxOptions.hidden = format !== 'mnx';
  elements.enigmaxmlOptions.hidden = format !== 'enigmaxml';
  setBusy(busy);
}

function makePartControl(part) {
  const label = document.createElement('label');
  label.className = 'check-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'document';
  input.value = String(part.outputIndex);
  input.checked = true;
  input.addEventListener('change', () => setBusy(busy));
  const text = document.createElement('span');
  text.textContent = part.name;
  label.append(input, text);
  return label;
}

function renderParts() {
  elements.linkedParts.replaceChildren(...parts.map(makePartControl));
  elements.noParts.hidden = parts.length !== 0;
}

function renderDiagnostics(items) {
  elements.diagnostics.replaceChildren();
  if (!items.length) {
    elements.diagnosticsSection.hidden = true;
    return;
  }
  elements.diagnosticsSection.hidden = false;
  for (const item of items) {
    const row = document.createElement('li');
    row.className = `diagnostic diagnostic-${item.severity}`;
    const severity = document.createElement('strong');
    severity.textContent = `${item.severity}: `;
    row.append(severity, document.createTextNode(item.message));
    elements.diagnostics.append(row);
  }
}

function conversionOptions() {
  const formatKey = elements.format.value;
  const cueSelect = formatKey === 'musicxml' ? elements.musicxmlCueLayer : elements.mnxCueLayer;
  return {
    format: FORMATS[formatKey].id,
    includeTempo: formatKey === 'musicxml' ? elements.musicxmlTempo.checked : elements.mnxTempo.checked,
    splitInstruments: formatKey === 'mnx' && elements.mnxSplit.checked,
    indentSpaces: formatKey === 'mnx' && elements.mnxPretty.checked ? 2 : -1,
    cueLayer: Number(cueSelect?.value || 0),
    selectedOutputs: formatKey === 'musicxml'
      ? Array.from(elements.documents.querySelectorAll('input:checked'), (input) => Number(input.value))
      : []
  };
}

function reportOptions(options) {
  const formatKey = elements.format.value;
  if (formatKey === 'enigmaxml') return { 'Export options': 'None' };
  const result = {
    'Include playback tempo changes': options.includeTempo,
    'Cue layer': options.cueLayer || 'Automatic'
  };
  if (formatKey === 'musicxml') result.Documents = options.selectedOutputs.join(', ');
  if (formatKey === 'mnx') {
    result['Split instruments into separate MNX parts'] = options.splitInstruments;
    result['Pretty-print JSON'] = options.indentSpaces >= 0;
  }
  return result;
}

async function saveOutput(output) {
  if ('showSaveFilePicker' in window) {
    try {
      const format = selectedFormat();
      const handle = await window.showSaveFilePicker({
        id: `denigma-${elements.format.value}`,
        suggestedName: output.name,
        types: [{ description: format.label, accept: { [format.mime]: [`.${format.extension}`] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(output.blob);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setStatus(`Could not use the save picker; starting a browser download instead. ${error.message || error}`, 'warning');
    }
  }
  const anchor = document.createElement('a');
  anchor.href = output.url;
  anchor.download = output.name;
  anchor.click();
}

function renderOutputs(rawOutputs) {
  revokeObjectUrls();
  const formatKey = elements.format.value;
  const format = selectedFormat();
  const named = rawOutputs.map((output, index) => ({
    name: outputFileName(inputFile.name, formatKey, output.suggestedName, index, rawOutputs.length),
    data: output.data
  }));
  outputs = uniquifyFileNames(named).map((output) => {
    const blob = new Blob([output.data], { type: format.mime });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return { ...output, blob, url };
  });

  elements.outputList.replaceChildren();
  outputs.forEach((output) => {
    const item = document.createElement('li');
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = output.name;
    info.append(name, document.createTextNode(` · ${formatBytes(output.data.byteLength)}`));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'secondary small';
    save.textContent = 'Save';
    save.addEventListener('click', () => saveOutput(output));
    item.append(info, save);
    elements.outputList.append(item);
  });
  elements.saveAll.hidden = outputs.length < 2;
}

async function loadFile(file) {
  if (!isMusxFile(file)) {
    clearOutputs();
    inputFile = undefined;
    parts = [];
    renderParts();
    elements.inputSummary.hidden = true;
    setStatus('Choose a Finale .musx file.', 'error');
    setBusy(false);
    return;
  }
  clearOutputs();
  inputFile = file;
  parts = [];
  renderParts();
  elements.inputName.textContent = file.name;
  elements.inputMeta.textContent = formatBytes(file.size);
  elements.inputSummary.hidden = false;
  setBusy(true);
  setStatus(`Reading ${file.name}…`);
  const buffer = await file.arrayBuffer();
  pendingRequest = ++requestId;
  worker.postMessage({ type: 'inspect', requestId: pendingRequest, fileName: file.name, buffer }, [buffer]);
}

function handleFailure(message, returnedDiagnostics = []) {
  diagnostics = returnedDiagnostics.length ? returnedDiagnostics : [{ severity: 'error', message }];
  renderDiagnostics(diagnostics);
  elements.results.hidden = false;
  elements.failureActions.hidden = false;
  elements.copyReport.hidden = false;
  setStatus(message, 'error');
  setBusy(false);
}

worker.addEventListener('message', ({ data }) => {
  if (data.type === 'ready') {
    runtime = data;
    wasmReady = true;
    elements.version.textContent = `Denigma ${data.denigmaVersion} · commit ${shortCommit(data.denigmaCommit)}`;
    setStatus('Ready. Choose a Finale MUSX file.');
    setBusy(false);
    return;
  }
  if (data.type === 'load-error') {
    handleFailure(`Unable to load Denigma WebAssembly: ${data.message}`);
    elements.file.disabled = true;
    return;
  }
  if (data.requestId && data.requestId !== pendingRequest) return;
  if (data.type === 'worker-error') {
    handleFailure(`Conversion failed: ${data.message}`);
    return;
  }
  if (data.type === 'inspected') {
    diagnostics = data.diagnostics;
    if (!data.success) {
      inputFile = undefined;
      elements.file.value = '';
      elements.inputSummary.hidden = true;
      handleFailure('The selected file could not be read as a Finale MUSX file.', data.diagnostics);
      return;
    }
    parts = data.parts;
    renderParts();
    renderDiagnostics(diagnostics);
    if (diagnostics.length) elements.results.hidden = false;
    setStatus(`${elements.inputName.textContent} is ready. Choose a format and convert.`);
    setBusy(false);
    return;
  }
  if (data.type === 'converted') {
    diagnostics = data.diagnostics;
    renderDiagnostics(diagnostics);
    elements.results.hidden = false;
    if (!data.success || data.outputs.length === 0) {
      handleFailure('Conversion failed. Review the diagnostics below.', diagnostics);
      return;
    }
    renderOutputs(data.outputs);
    elements.failureActions.hidden = true;
    elements.copyReport.hidden = false;
    const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
    setStatus(`Conversion complete: ${data.outputs.length} file${data.outputs.length === 1 ? '' : 's'} generated${warningCount ? ` with ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}.`, warningCount ? 'warning' : 'success');
    setBusy(false);
  }
});

elements.file.addEventListener('change', () => {
  const file = elements.file.files?.[0];
  if (file) loadFile(file).catch((error) => {
    inputFile = undefined;
    elements.inputSummary.hidden = true;
    handleFailure(`Unable to read the file: ${error.message || error}`);
  });
});

elements.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!busy && wasmReady) elements.dropZone.classList.add('dragging');
});

elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove('dragging');
  if (busy || !wasmReady) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file).catch((error) => {
    inputFile = undefined;
    elements.inputSummary.hidden = true;
    handleFailure(`Unable to read the file: ${error.message || error}`);
  });
});

elements.format.addEventListener('change', () => {
  clearOutputs();
  showFormatOptions();
});

elements.convert.addEventListener('click', () => {
  clearOutputs();
  const options = conversionOptions();
  if (elements.format.value === 'musicxml' && options.selectedOutputs.length === 0) {
    setStatus('Select the score or at least one linked part.', 'error');
    return;
  }
  setBusy(true);
  lastConversion = { formatKey: elements.format.value, options, reportOptions: reportOptions(options) };
  setStatus(`Converting to ${selectedFormat().label}…`);
  pendingRequest = ++requestId;
  worker.postMessage({ type: 'convert', requestId: pendingRequest, options });
});

elements.saveAll.addEventListener('click', async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const directory = await window.showDirectoryPicker({ id: 'denigma-outputs', mode: 'readwrite' });
      for (const output of outputs) {
        const handle = await directory.getFileHandle(output.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(output.blob);
        await writable.close();
      }
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setStatus(`Could not save to that folder; starting browser downloads instead. ${error.message || error}`, 'warning');
    }
  }
  for (const output of outputs) {
    const anchor = document.createElement('a');
    anchor.href = output.url;
    anchor.download = output.name;
    anchor.click();
  }
});

elements.copyReport.addEventListener('click', async () => {
  const snapshot = lastConversion || {
    formatKey: elements.format.value,
    options: conversionOptions(),
    reportOptions: reportOptions(conversionOptions())
  };
  const report = diagnosticReport({
    ...runtime,
    format: FORMATS[snapshot.formatKey].label,
    options: snapshot.reportOptions,
    diagnostics
  });
  try {
    await navigator.clipboard.writeText(report);
    elements.copyReport.textContent = 'Copied';
    window.setTimeout(() => { elements.copyReport.textContent = 'Copy diagnostic report'; }, 1500);
  } catch {
    window.prompt('Copy this diagnostic report:', report);
  }
});

elements.reportIssue.href = ISSUE_URL;
elements.failureIssue.href = ISSUE_URL;
elements.aboutIssue.href = ISSUE_URL;
window.addEventListener('pagehide', revokeObjectUrls);
showFormatOptions();
setBusy(false);
