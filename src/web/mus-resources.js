// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

export const SYMBOL_FONTS_KEY = 'denigma-online.symbol-fonts.v1';
const MAX_SYMBOL_BYTES = 1024 * 1024;

export function normalizeSymbolFonts(input) {
  let bytes = new Uint8Array(input);
  if (bytes.length > MAX_SYMBOL_BYTES) throw new Error('The symbol font list must be smaller than 1 MiB.');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  if (bytes.includes(0) || !bytes.some((byte) => byte > 32)) {
    throw new Error('Choose a nonempty plain-text symbol font list.');
  }
  const normalized = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    normalized.push(byte === 13 ? 10 : byte);
    if (byte === 13 && bytes[index + 1] === 10) index += 1;
  }
  return new Uint8Array(normalized);
}

export function readSymbolFonts(storage) {
  try {
    const saved = JSON.parse(storage.getItem(SYMBOL_FONTS_KEY));
    if (!saved || typeof saved.name !== 'string' || typeof saved.base64 !== 'string') return undefined;
    const bytes = normalizeSymbolFonts(Uint8Array.from(atob(saved.base64), (character) => character.charCodeAt(0)));
    return { name: saved.name, bytes };
  } catch {
    return undefined;
  }
}

export function saveSymbolFonts(storage, override) {
  if (!override) storage.removeItem(SYMBOL_FONTS_KEY);
  else {
    const bytes = normalizeSymbolFonts(override.bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    storage.setItem(SYMBOL_FONTS_KEY, JSON.stringify({ name: override.name, base64: btoa(binary) }));
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest.version !== 'string' || !manifest.version || !Array.isArray(manifest.files)
      || !manifest.files.length) throw new Error('Invalid legacy resource manifest.');
  const singletons = new Set();
  for (const file of manifest.files) {
    if (!Number.isInteger(file.kind) || file.kind < 0 || file.kind > 4 || typeof file.name !== 'string' || !file.name
        || typeof file.path !== 'string' || !/^[\w ./-]+$/.test(file.path)
        || file.path.startsWith('/') || file.path.split('/').some((part) => !part || part === '.' || part === '..')
        || !Number.isSafeInteger(file.size) || file.size <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Invalid legacy resource manifest entry.');
    }
    if ([0, 2, 4].includes(file.kind)) {
      if (singletons.has(file.kind)) throw new Error('Duplicate singleton resource.');
      singletons.add(file.kind);
    }
  }
  if (![0, 2, 4].every((kind) => singletons.has(kind)) || ![1, 3].every((kind) => manifest.files.some((file) => file.kind === kind))) {
    throw new Error('The legacy resource set is incomplete.');
  }
  return manifest;
}

export async function downloadResources(config, fetchFile = fetch, cacheStorage = globalThis.caches, openArchive) {
  const manifest = validateManifest(config.manifest);
  if (!config.baseUrl) throw new Error('The legacy support-file host has not been configured.');
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:') throw new Error('Legacy resources require an HTTPS host.');
  let cache;
  try { cache = await cacheStorage?.open('denigma-online.mus-resources.v1'); } catch {}
  const fetchOptions = () => ({ credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
  let archivePromise;
  async function archiveFile(path) {
    archivePromise ??= (async () => {
      const archiveUrl = new URL(config.archiveUrl);
      if (archiveUrl.protocol !== 'https:') throw new Error('Legacy resources require an HTTPS archive.');
      if (!openArchive) throw new Error('The support archive reader is unavailable.');
      const response = await fetchFile(archiveUrl.href, fetchOptions());
      if (!response.ok) throw new Error(`Unable to load the support archive (HTTP ${response.status}).`);
      return openArchive(await response.arrayBuffer());
    })();
    return (await archivePromise)(path);
  }
  async function verified(response, file) {
    if (!response.ok) throw new Error(`Unable to load ${file.name} (HTTP ${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== file.size || sha256 !== file.sha256) throw new Error(`Integrity check failed for ${file.name}.`);
    return bytes;
  }
  // Keep manifest order: both percussion and soundmap matching use it.
  return Promise.all(manifest.files.map(async (file) => {
    const url = new URL(file.path.split('/').map(encodeURIComponent).join('/'), base);
    // A checksum key lets later resource sets reuse unchanged bytes, even when
    // their version directories change. The key is local to this site's cache.
    const cacheKey = new URL(`sha256/${file.sha256}`, base).href;
    try {
      const cached = await cache?.match(cacheKey);
      if (cached) return { kind: file.kind, name: file.name, bytes: await verified(cached, file) };
    } catch {
      try { await cache?.delete(cacheKey); } catch {}
    }
    const response = config.archiveUrl
      ? new Response(await archiveFile(file.path))
      : await fetchFile(url.href, fetchOptions());
    const bytes = await verified(response, file);
    try { await cache?.put(cacheKey, new Response(bytes)); } catch {}
    return { kind: file.kind, name: file.name, bytes };
  }));
}

export function finalizeResources(Module, entries) {
  const handle = Module._denigma_mus_resources_create();
  if (!handle) throw new Error('Unable to allocate legacy resources.');
  function check(result) {
    if (!result) throw new Error('Denigma did not return a resource result.');
    try {
      if (!Module._denigma_result_success(result)) {
        const messages = Array.from({ length: Module._denigma_result_diagnostic_count(result) }, (_, index) =>
          Module.UTF8ToString(Module._denigma_result_diagnostic_message(result, index)));
        throw new Error(messages.join('\n') || 'Invalid legacy resources.');
      }
    } finally {
      Module._denigma_result_destroy(result);
    }
  }
  try {
    for (const { kind, name, bytes } of entries) {
      const encodedName = new TextEncoder().encode(`${name}\0`);
      let namePointer = 0;
      let dataPointer = 0;
      try {
        namePointer = Module._denigma_malloc(encodedName.length);
        dataPointer = Module._denigma_malloc(bytes.length);
        if (!namePointer || !dataPointer) throw new Error('Unable to allocate legacy resource bytes.');
        Module.HEAPU8.set(encodedName, namePointer);
        Module.HEAPU8.set(bytes, dataPointer);
        check(Module._denigma_mus_resources_add(handle, kind, namePointer, dataPointer, bytes.length));
      } finally {
        if (namePointer) Module._denigma_free(namePointer);
        if (dataPointer) Module._denigma_free(dataPointer);
      }
    }
    check(Module._denigma_mus_resources_finalize(handle));
    return handle;
  } catch (error) {
    Module._denigma_mus_resources_destroy(handle);
    throw error;
  }
}
