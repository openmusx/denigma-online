// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { validateManifest } from '../src/web/mus-resources.js';

const [, , moduleArg, wasmArg, virituraArg] = process.argv;
if (!moduleArg || !wasmArg || !virituraArg) {
  console.error('usage: node scripts/build-web.mjs <denigma.js> <denigma.wasm> <viritura score-engine directory>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'src', 'web');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');
const resourceManifest = validateManifest(JSON.parse(await readFile(join(root, 'config', 'mus-resources.json'), 'utf8')));
let resourceBaseUrl = process.env.DENIGMA_MUS_RESOURCE_BASE_URL?.trim() || 'https://robertgpatterson.com/-fininfo/-downloads/';
let resourceOrigin = '';
if (resourceBaseUrl) {
  const url = new URL(resourceBaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('DENIGMA_MUS_RESOURCE_BASE_URL must be an HTTPS directory URL without credentials, query, or fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  resourceBaseUrl = url.href;
  resourceOrigin = url.origin;
}
const resourceArchiveUrl = new URL(process.env.DENIGMA_MUS_RESOURCE_ARCHIVE_URL?.trim()
  || 'denigma-online-finale27-support-v1.zip', resourceBaseUrl).href;
const archiveLocation = new URL(resourceArchiveUrl);
if (archiveLocation.protocol !== 'https:' || archiveLocation.username || archiveLocation.password || archiveLocation.hash) {
  throw new Error('DENIGMA_MUS_RESOURCE_ARCHIVE_URL must be an HTTPS URL without credentials or fragment.');
}
function resourceCsp(source) {
  const origins = [...new Set([resourceOrigin, archiveLocation.origin].filter(Boolean))];
  return source.replaceAll("connect-src 'self'", `connect-src 'self' ${origins.join(' ')}`);
}

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

// Viritura's modules find wasm/, fonts/ and their worker relative to themselves,
// so the distribution keeps its layout under one content-hashed directory. Only
// the files the viewer loads are published.
const viritura = resolve(virituraArg);
const virituraManifest = JSON.parse(await readFile(join(viritura, 'manifest.json'), 'utf8'));
const virituraFiles = ['score-viewer.js', 'score-engine.js', 'score-engine.worker.js'];
for (const directory of ['wasm', 'fonts']) {
  for (const name of (await readdir(join(viritura, directory))).sort()) virituraFiles.push(`${directory}/${name}`);
}
const virituraContents = new Map();
for (const path of virituraFiles) virituraContents.set(path, await readFile(join(viritura, path)));
const virituraHash = hash(Buffer.concat([...virituraContents].flatMap(([path, contents]) => [Buffer.from(`${path}\0`), contents])));
const virituraDirectory = `viritura.${virituraHash}`;
let virituraBytes = 0;
let virituraGzipBytes = 0;
for (const [path, contents] of virituraContents) {
  const target = join(assets, virituraDirectory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  virituraBytes += contents.byteLength;
  if (/\.(js|wasm|otf)$/.test(path)) {
    const compressed = gzipSync(contents, { level: 9 });
    await writeFile(`${target}.gz`, compressed);
    virituraGzipBytes += compressed.byteLength;
  } else {
    virituraGzipBytes += contents.byteLength;
  }
}
const virituraViewerUrl = `./assets/${virituraDirectory}/score-viewer.js`;

let previewSource = await readFile(join(source, 'preview.js'), 'utf8');
previewSource = previewSource
  .replace('__OSMD_SCRIPT_URL__', osmdUrl.replace('./assets/', './'))
  .replace('__VIRITURA_VIEWER_URL__', virituraViewerUrl.replace('./assets/', './'));
const previewUrl = await emit('preview', 'js', previewSource);

const musResourcesUrl = await emit('mus-resources', 'js', await readFile(join(source, 'mus-resources.js')));
const jszipUrl = await emit('jszip', 'js', await readFile(join(root, 'node_modules', 'jszip', 'dist', 'jszip.min.js')));
const resourceArchiveSource = (await readFile(join(source, 'resource-archive.js'), 'utf8'))
  .replace('__JSZIP_URL__', jszipUrl.replace('./assets/', './'));
const resourceArchiveModuleUrl = await emit('resource-archive', 'js', resourceArchiveSource);
const musConfigUrl = await emit('mus-config', 'js', `export default ${JSON.stringify({ baseUrl: resourceBaseUrl, archiveUrl: resourceArchiveUrl, manifest: resourceManifest })};\n`);

const workerHostSource = await readFile(join(source, 'worker-host.js'));
const workerHostUrl = await emit('worker-host', 'js', workerHostSource);

let workerSource = await readFile(join(source, 'worker.js'), 'utf8');
workerSource = workerSource
  .replace('__MUS_RESOURCES_URL__', musResourcesUrl.replace('./assets/', './'))
  .replace('__MUS_CONFIG_URL__', musConfigUrl.replace('./assets/', './'))
  .replace('__RESOURCE_ARCHIVE_URL__', resourceArchiveModuleUrl.replace('./assets/', './'))
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
  .replace('__MUS_RESOURCES_URL__', musResourcesUrl.replace('./assets/', './'))
  .replace('__CORE_MODULE_URL__', coreUrl.replace('./assets/', './'))
  .replace('__ZIP_MODULE_URL__', zipUrl.replace('./assets/', './'))
  .replace('__PREVIEW_MODULE_URL__', previewUrl.replace('./assets/', './'))
  .replace('__WORKER_MODULE_URL__', workerUrl.replace('./assets/', './'))
  .replace('__WORKER_HOST_URL__', workerHostUrl.replace('./assets/', './'));
const appUrl = await emit('app', 'js', appSource);

const stylesSource = await readFile(join(source, 'styles.css'));
const stylesUrl = await emit('styles', 'css', stylesSource);

let html = await readFile(join(source, 'index.html'), 'utf8');
html = html
  .replace('__STYLES_URL__', stylesUrl)
  .replace('__APP_URL__', appUrl)
  .replace('__VIRITURA_VERSION__', virituraManifest.scoreViewerVersion);
await writeFile(join(dist, 'index.html'), resourceCsp(html));
await cp(join(root, 'LICENSE'), join(dist, 'LICENSE.txt'));
await cp(join(root, 'node_modules', 'jszip', 'LICENSE.markdown'), join(dist, 'LICENSE-JSZip.txt'));
await cp(join(root, 'node_modules', 'opensheetmusicdisplay', 'LICENSE'), join(dist, 'LICENSE-OSMD.txt'));
await cp(join(viritura, 'LICENSE'), join(dist, 'LICENSE-Viritura.txt'));
await cp(join(viritura, 'LICENSES', 'OFL-1.1.txt'), join(dist, 'LICENSE-OFL.txt'));
await cp(join(viritura, 'THIRD_PARTY_NOTICES.md'), join(dist, 'NOTICES-Viritura.txt'));
await writeFile(join(dist, '.htaccess'), resourceCsp(await readFile(join(root, 'deploy', 'apache.htaccess'), 'utf8')));
await writeFile(join(dist, 'nginx.conf.example'), resourceCsp(await readFile(join(root, 'deploy', 'nginx.conf.example'), 'utf8')));
await writeFile(join(dist, 'asset-manifest.json'), `${JSON.stringify({
  buildVersion,
  denigmaOnlineCommit,
  musResources: musResourcesUrl,
  musConfig: musConfigUrl,
  resourceVersion: resourceManifest.version,
  resourceBaseUrl,
  resourceArchiveUrl,
  resourceArchiveModule: resourceArchiveModuleUrl,
  jszip: jszipUrl,
  wasm: wasmUrl,
  module: moduleUrl,
  worker: workerUrl,
  workerHost: workerHostUrl,
  core: coreUrl,
  zip: zipUrl,
  preview: previewUrl,
  osmd: osmdUrl,
  virituraViewer: virituraViewerUrl,
  virituraVersion: virituraManifest.scoreViewerVersion,
  virituraEngineVersion: virituraManifest.version,
  virituraCommit: virituraManifest.commit,
  app: appUrl,
  styles: stylesUrl,
  wasmBytes: wasm.byteLength,
  wasmGzipBytes: wasmGzip.byteLength,
  osmdBytes: osmdSource.byteLength,
  osmdGzipBytes: osmdGzip.byteLength,
  virituraBytes,
  virituraGzipBytes
}, null, 2)}\n`);

console.log(`Built ${dist}`);
console.log(`${basename(wasmUrl)}: ${wasm.byteLength} bytes`);
console.log(`${basename(wasmUrl)}.gz: ${wasmGzip.byteLength} bytes`);
console.log(`${basename(osmdUrl)}: ${osmdSource.byteLength} bytes`);
console.log(`${basename(osmdUrl)}.gz: ${osmdGzip.byteLength} bytes`);
console.log(`${virituraDirectory}: ${virituraBytes} bytes (${virituraGzipBytes} bytes gzipped)`);
