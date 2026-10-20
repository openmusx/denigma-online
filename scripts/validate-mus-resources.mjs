// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest, finalizeResources } from '../src/web/mus-resources.js';

const [, , modulePath, wasmPath, manifestPath] = process.argv;
if (!modulePath || !wasmPath || !manifestPath) throw new Error('Usage: node scripts/validate-mus-resources.mjs <denigma.js> <denigma.wasm> <manifest.json>');
const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const entries = await Promise.all(manifest.files.map(async (file) => {
  const bytes = await readFile(resolve(dirname(manifestPath), file.path));
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`Integrity check failed for ${file.name}`);
  }
  return { ...file, bytes };
}));
const createModule = (await import(pathToFileURL(resolve(modulePath)))).default;
const Module = await createModule({ wasmBinary: await readFile(wasmPath) });
const handle = finalizeResources(Module, entries);
Module._denigma_mus_resources_destroy(handle);
console.log(`Validated ${manifest.version}: ${entries.length} resources.`);
