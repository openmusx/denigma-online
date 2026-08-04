// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [, , moduleArg, wasmArg] = process.argv;
if (!moduleArg || !wasmArg) {
  console.error('usage: node scripts/build-web.mjs <denigma.js> <denigma.wasm>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'src', 'web');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');

function hash(contents) {
  return createHash('sha256').update(contents).digest('hex').slice(0, 12);
}

function repositoryCommit() {
  const override = process.env.DENIGMA_ONLINE_COMMIT?.trim();
  if (override) return /^[0-9a-f]{7,40}$/i.test(override) ? override : 'unknown';
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  return /^[0-9a-f]{40}$/i.test(commit) ? commit : 'unknown';
}

async function emit(name, extension, contents) {
  const fileName = `${name}.${hash(contents)}.${extension}`;
  await writeFile(join(assets, fileName), contents);
  return `./assets/${fileName}`;
}

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const wasm = await readFile(resolve(wasmArg));
const wasmUrl = await emit('denigma', 'wasm', wasm);
const wasmGzip = gzipSync(wasm, { level: 9 });
await writeFile(join(dist, `${wasmUrl.slice(2)}.gz`), wasmGzip);
const moduleSource = await readFile(resolve(moduleArg));
const moduleUrl = await emit('denigma', 'js', moduleSource);
const buildVersion = hash(Buffer.concat([wasm, moduleSource]));
const denigmaOnlineCommit = repositoryCommit();

const osmdSource = await readFile(join(root, 'node_modules', 'opensheetmusicdisplay', 'build', 'opensheetmusicdisplay.min.js'));
const osmdUrl = await emit('osmd', 'js', osmdSource);
const osmdGzip = gzipSync(osmdSource, { level: 9 });
await writeFile(join(dist, `${osmdUrl.slice(2)}.gz`), osmdGzip);

let previewSource = await readFile(join(source, 'preview.js'), 'utf8');
previewSource = previewSource.replace('__OSMD_SCRIPT_URL__', osmdUrl.replace('./assets/', './'));
const previewUrl = await emit('preview', 'js', previewSource);

let workerSource = await readFile(join(source, 'worker.js'), 'utf8');
workerSource = workerSource
  .replace('__DENIGMA_MODULE_URL__', moduleUrl.replace('./assets/', './'))
  .replace('__DENIGMA_WASM_URL__', wasmUrl.replace('./assets/', './'))
  .replace('__DENIGMA_ONLINE_COMMIT__', denigmaOnlineCommit)
  .replace('__BUILD_VERSION__', buildVersion);
const workerUrl = await emit('worker', 'js', workerSource);

const coreSource = await readFile(join(source, 'core.js'));
const coreUrl = await emit('core', 'js', coreSource);

const zipSource = await readFile(join(source, 'zip.js'));
const zipUrl = await emit('zip', 'js', zipSource);

let appSource = await readFile(join(source, 'app.js'), 'utf8');
appSource = appSource
  .replace('__CORE_MODULE_URL__', coreUrl.replace('./assets/', './'))
  .replace('__ZIP_MODULE_URL__', zipUrl.replace('./assets/', './'))
  .replace('__PREVIEW_MODULE_URL__', previewUrl.replace('./assets/', './'))
  .replace('__WORKER_MODULE_URL__', workerUrl.replace('./assets/', './'));
const appUrl = await emit('app', 'js', appSource);

const stylesSource = await readFile(join(source, 'styles.css'));
const stylesUrl = await emit('styles', 'css', stylesSource);

let html = await readFile(join(source, 'index.html'), 'utf8');
html = html.replace('__STYLES_URL__', stylesUrl).replace('__APP_URL__', appUrl);
await writeFile(join(dist, 'index.html'), html);
await cp(join(root, 'LICENSE'), join(dist, 'LICENSE.txt'));
await cp(join(root, 'node_modules', 'opensheetmusicdisplay', 'LICENSE'), join(dist, 'LICENSE-OSMD.txt'));
await cp(join(root, 'deploy', 'apache.htaccess'), join(dist, '.htaccess'));
await writeFile(join(dist, 'asset-manifest.json'), `${JSON.stringify({
  buildVersion,
  denigmaOnlineCommit,
  wasm: wasmUrl,
  module: moduleUrl,
  worker: workerUrl,
  core: coreUrl,
  zip: zipUrl,
  preview: previewUrl,
  osmd: osmdUrl,
  app: appUrl,
  styles: stylesUrl,
  wasmBytes: wasm.byteLength,
  wasmGzipBytes: wasmGzip.byteLength,
  osmdBytes: osmdSource.byteLength,
  osmdGzipBytes: osmdGzip.byteLength
}, null, 2)}\n`);

console.log(`Built ${dist}`);
console.log(`${basename(wasmUrl)}: ${wasm.byteLength} bytes`);
console.log(`${basename(wasmUrl)}.gz: ${wasmGzip.byteLength} bytes`);
console.log(`${basename(osmdUrl)}: ${osmdSource.byteLength} bytes`);
console.log(`${basename(osmdUrl)}.gz: ${osmdGzip.byteLength} bytes`);
