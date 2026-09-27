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
import {
  EXIT_UNAVAILABLE,
  Unavailable,
  download,
  githubJson,
  githubSlug,
  githubToken,
  stampContents,
  unzip
} from './github-fetch.mjs';

export { EXIT_UNAVAILABLE };
const ARTIFACT_NAME = 'denigma-wasm';
const MODULE_FILES = ['denigma.js', 'denigma.wasm'];

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
