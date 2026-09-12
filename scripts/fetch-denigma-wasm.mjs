// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT
//
// Fetches the WebAssembly module that Denigma's CI built for a pinned revision.
// A commit pin is served by the `denigma-wasm` workflow artifact of the push that
// built it; a tag pin by the `denigma.<tag>.wasm.zip` release asset.
//
// usage: node scripts/fetch-denigma-wasm.mjs --repository <url> --revision <sha|tag> --output <dir>
//
// Exit status 0 means denigma.js and denigma.wasm are in <dir> alongside a stamp
// recording where they came from. Exit status 3 means no usable module was
// available (missing, expired, no token, verification failed). Anything else is
// a usage error.

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { findExecutable, runExecutable } from './tooling.mjs';

export const EXIT_UNAVAILABLE = 3;
const ARTIFACT_NAME = 'denigma-wasm';
const MODULE_FILES = ['denigma.js', 'denigma.wasm'];

class Unavailable extends Error {}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repository' || argument === '--revision' || argument === '--output') {
      options[argument.slice(2)] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.repository || !options.revision || !options.output) {
    throw new Error('usage: node scripts/fetch-denigma-wasm.mjs --repository <url> --revision <sha|tag> --output <dir>');
  }
  return options;
}

export function githubSlug(repository) {
  const match = repository.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Unavailable(`${repository} is not a GitHub repository`);
  return `${match[1]}/${match[2]}`;
}

export function stampContents(origin, repository, revision) {
  return `${origin}\n${repository}@${revision}\n`;
}

async function githubToken(environment) {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    if (environment[name]?.trim()) return { token: environment[name].trim(), source: name };
  }
  const gh = await findExecutable('gh', environment);
  if (gh) {
    const result = runExecutable(gh, ['auth', 'token'], { environment, stdio: 'pipe', encoding: 'utf8' });
    const token = result.status === 0 ? result.stdout.trim() : '';
    if (token) return { token, source: 'gh auth token' };
  }
  return undefined;
}

async function githubJson(url, token) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Unavailable(`GitHub API responded ${response.status} for ${url}`);
  return response.json();
}

async function download(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Unavailable(`download of ${url} responded ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Extracts stored and deflated entries by walking the central directory.
export function unzip(buffer) {
  const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfDirectory < 0) throw new Unavailable('downloaded file is not a zip archive');
  const entryCount = buffer.readUInt16LE(endOfDirectory + 10);
  let offset = buffer.readUInt32LE(endOfDirectory + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Unavailable('zip central directory is corrupt');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Unavailable('zip local header is corrupt');
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Unavailable(`zip entry ${name} uses unsupported compression method ${method}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function locateArtifact(slug, revision, token) {
  if (/^[0-9a-f]{40}$/i.test(revision)) {
    const listing = await githubJson(
      `https://api.github.com/repos/${slug}/actions/artifacts?name=${ARTIFACT_NAME}&per_page=100`, token);
    const candidates = (listing?.artifacts ?? [])
      .filter((artifact) => artifact.workflow_run?.head_sha?.toLowerCase() === revision.toLowerCase());
    const artifact = candidates.find((candidate) => !candidate.expired);
    if (!artifact) {
      if (candidates.length) throw new Unavailable(`the ${ARTIFACT_NAME} artifact for ${revision} has expired`);
      throw new Unavailable(`no ${ARTIFACT_NAME} artifact exists for ${revision} (not a push to main, or its build has not finished)`);
    }
    if (!token) throw new Unavailable('downloading a workflow artifact needs a GitHub token (set GITHUB_TOKEN or sign in with gh)');
    return { origin: `artifact:${artifact.id}`, url: artifact.archive_download_url, token };
  }
  const release = await githubJson(`https://api.github.com/repos/${slug}/releases/tags/${encodeURIComponent(revision)}`, token);
  const asset = release?.assets?.find((candidate) => candidate.name === `denigma.${revision}.wasm.zip`);
  if (!asset) throw new Unavailable(`release ${revision} has no denigma.${revision}.wasm.zip asset`);
  return { origin: `release:${asset.id}`, url: asset.browser_download_url, token: undefined };
}

async function moduleCommit(directory) {
  const createModule = (await import(pathToFileURL(join(directory, 'denigma.js')))).default;
  const Module = await createModule({ wasmBinary: await readFile(join(directory, 'denigma.wasm')) });
  return {
    version: Module.UTF8ToString(Module._denigma_version()),
    commit: Module.UTF8ToString(Module._denigma_commit())
  };
}

async function fetchModule({ repository, revision, output }) {
  const slug = githubSlug(repository);
  const auth = await githubToken(process.env);
  const location = await locateArtifact(slug, revision, auth?.token);
  const entries = unzip(await download(location.url, location.token));
  for (const name of MODULE_FILES) {
    if (!entries.has(name)) throw new Unavailable(`the downloaded archive has no ${name}`);
  }

  // Staged on the destination's file system, so the final rename is atomic.
  await mkdir(resolve(output), { recursive: true });
  const staging = await mkdtemp(join(resolve(output), '.fetch-'));
  try {
    for (const name of MODULE_FILES) await writeFile(join(staging, name), entries.get(name));
    const { version, commit } = await moduleCommit(staging);
    const builtFrom = commit.replace(/-dirty$/, '');
    if (/^[0-9a-f]{40}$/i.test(revision) && !revision.toLowerCase().startsWith(builtFrom.toLowerCase())) {
      throw new Unavailable(`the downloaded module reports commit ${commit}, not ${revision}`);
    }
    for (const name of MODULE_FILES) await rename(join(staging, name), resolve(output, name));
    await writeFile(resolve(output, 'denigma-wasm.stamp'), stampContents(location.origin, repository, revision));
    console.log(`Using Denigma ${version} (${commit}) from ${slug} ${location.origin}${auth ? ` via ${auth.source}` : ''}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  try {
    await fetchModule(options);
  } catch (error) {
    console.error(`Prebuilt Denigma module unavailable: ${error.message}`);
    process.exit(EXIT_UNAVAILABLE);
  }
}
