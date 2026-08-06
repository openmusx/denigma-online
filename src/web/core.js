// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

export const FORMATS = Object.freeze({
  musicxml: { id: 0, label: 'MusicXML (uncompressed)', extension: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml' },
  mnx: { id: 1, label: 'MNX (experimental)', extension: 'mnx', mime: 'application/json' },
  enigmaxml: { id: 2, label: 'EnigmaXML (proprietary Finale XML)', extension: 'enigmaxml', mime: 'application/xml' }
});

export function isSupportedInputFile(file) {
  return Boolean(file?.name && /\.(?:musx|enigmaxml(?:\.zip)?)$/i.test(file.name));
}

export function baseName(fileName) {
  return fileName.replace(/\.(?:musx|enigmaxml(?:\.zip)?)$/i, '') || 'converted';
}

export function safeNamePart(value) {
  return value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim() || 'part';
}

export function outputFileName(inputName, formatKey, suggestedName, index, total) {
  const format = FORMATS[formatKey];
  const stem = safeNamePart(baseName(inputName));
  if (!suggestedName) return `${stem}.${format.extension}`;
  const suffix = safeNamePart(suggestedName);
  return `${stem}.${suffix}.${format.extension}`;
}

export function uniquifyFileNames(outputs) {
  const used = new Map();
  return outputs.map((output) => {
    const count = used.get(output.name.toLowerCase()) || 0;
    used.set(output.name.toLowerCase(), count + 1);
    if (count === 0) return output;
    const dot = output.name.lastIndexOf('.');
    const name = dot < 0
      ? `${output.name}-${count + 1}`
      : `${output.name.slice(0, dot)}-${count + 1}${output.name.slice(dot)}`;
    return { ...output, name };
  });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export const VISIBLE_SEVERITIES = Object.freeze(['warning', 'error']);

export function visibleDiagnostics(diagnostics) {
  return diagnostics.filter((item) => VISIBLE_SEVERITIES.includes(item.severity));
}

export function diagnosticReport({ denigmaVersion, denigmaCommit, denigmaOnlineCommit, buildVersion, format, options, diagnostics }) {
  const optionLines = Object.entries(options).map(([key, value]) => `- ${key}: ${String(value)}`);
  const diagnosticLines = diagnostics.length
    ? diagnostics.map((item) => `[${item.severity.toUpperCase()}] ${item.message}`)
    : ['(No diagnostics were returned.)'];
  return [
    'Denigma Online conversion report',
    `Denigma version: ${denigmaVersion}`,
    `Denigma commit: ${denigmaCommit}`,
    `Denigma Online commit: ${denigmaOnlineCommit}`,
    `Denigma Online build: ${buildVersion}`,
    `Output format: ${format}`,
    'Options:',
    ...optionLines,
    'Diagnostics:',
    ...diagnosticLines,
    '',
    'Source file contents are not included.'
  ].join('\n');
}
