// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

export async function openResourceArchive(bytes) {
  await import('__JSZIP_URL__');
  const archive = await globalThis.JSZip.loadAsync(bytes);
  return async (path) => {
    const file = archive.file(path);
    if (!file || file.dir || (file.unsafeOriginalName && file.unsafeOriginalName !== path)) {
      throw new Error(`Support archive is missing ${path}.`);
    }
    return file.async('uint8array');
  };
}
