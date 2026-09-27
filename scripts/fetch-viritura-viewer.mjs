// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT
//
// Fetches Viritura's standalone score engine and viewer for a pinned revision.
// A tag pin (score-engine-v<version>) is served by the release's zip, checked
// against its .sha256 asset; a commit pin by the score-engine-<version>-<sha12>
// workflow artifact of the push to main that built it.
//
// usage: node scripts/fetch-viritura-viewer.mjs --repository <url> --revision <tag|sha> --output <dir>
//
// Exit status 0 means <dir> holds the distribution, every file checked against
// its manifest.json, alongside a stamp recording where it came from. Exit
// status 3 means no usable distribution was available. Anything else is a
// usage error.

import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

export const STAMP_NAME = 'viritura.stamp';
// The files the site loads; a distribution without them is not usable.
export const REQUIRED_FILES = ['score-viewer.js', 'score-engine.js', 'score-engine.worker.js', 'LICENSE'];

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
    throw new Error('usage: node scripts/fetch-viritura-viewer.mjs --repository <url> --revision <tag|sha> --output <dir>');
  }
  return options;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// Release zips hold one top-level directory; workflow artifacts hold the files
// directly. Either way the distribution root is wherever manifest.json is.
export function distributionFiles(entries) {
  const manifestPaths = [...entries.keys()].filter((name) => name === 'manifest.json' || name.endsWith('/manifest.json'));
  const manifestPath = manifestPaths.sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new Unavailable('the downloaded archive has no manifest.json');
  const prefix = manifestPath.slice(0, -'manifest.json'.length);
  let manifest;
  try {
    manifest = JSON.parse(entries.get(manifestPath).toString('utf8'));
  } catch {
    throw new Unavailable('manifest.json is not valid JSON');
  }
  if (!Array.isArray(manifest.files)) throw new Unavailable('manifest.json lists no files');

  const files = new Map([['manifest.json', entries.get(manifestPath)]]);
  for (const { path, size, sha256: expected } of manifest.files) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Unavailable(`manifest.json lists an unsafe path: ${path}`);
    }
    const data = entries.get(prefix + path);
    if (!data) throw new Unavailable(`the downloaded archive has no ${path}`);
    if (data.byteLength !== size || sha256(data) !== expected) {
      throw new Unavailable(`${path} does not match its manifest.json size and hash`);
    }
    files.set(path, data);
  }
  for (const name of REQUIRED_FILES) {
    if (!files.has(name)) throw new Unavailable(`the distribution has no ${name}`);
  }
  return { manifest, files };
}

// A .sha256 asset is sha256sum output: "<hex>  <file name>".
export function checksumFromSha256File(text) {
  const match = text.match(/^([0-9a-f]{64})\b/i);
  if (!match) throw new Unavailable('the .sha256 asset is not sha256sum output');
  return match[1].toLowerCase();
}

async function locateArchive(slug, revision, token) {
  if (/^[0-9a-f]{40}$/i.test(revision)) {
    const runs = await githubJson(
      `https://api.github.com/repos/${slug}/actions/runs?head_sha=${revision}&event=push&per_page=100`, token);
    const suffix = `-${revision.slice(0, 12).toLowerCase()}`;
    for (const run of runs?.workflow_runs ?? []) {
      const listing = await githubJson(`https://api.github.com/repos/${slug}/actions/runs/${run.id}/artifacts`, token);
      const artifact = listing?.artifacts?.find((candidate) =>
        candidate.name.startsWith('score-engine-') && candidate.name.toLowerCase().endsWith(suffix));
      if (!artifact) continue;
      if (artifact.expired) throw new Unavailable(`the ${artifact.name} artifact has expired`);
      if (!token) throw new Unavailable('downloading a workflow artifact needs a GitHub token (set GITHUB_TOKEN or sign in with gh)');
      return { origin: `artifact:${artifact.id}`, url: artifact.archive_download_url, token };
    }
    throw new Unavailable(`no score-engine artifact exists for ${revision} (not a push to main that changed the engine, or its build has not finished)`);
  }
  const release = await githubJson(`https://api.github.com/repos/${slug}/releases/tags/${encodeURIComponent(revision)}`, token);
  const archive = release?.assets?.find((candidate) => /^score-engine-.+\.zip$/.test(candidate.name));
  if (!archive) throw new Unavailable(`release ${revision} has no score-engine zip`);
  const checksum = release.assets.find((candidate) => candidate.name === `${archive.name}.sha256`);
  if (!checksum) throw new Unavailable(`release ${revision} has no ${archive.name}.sha256`);
  return {
    origin: `release:${archive.id}`,
    url: archive.browser_download_url,
    checksumUrl: checksum.browser_download_url,
    token: undefined
  };
}

async function fetchViewer({ repository, revision, output }) {
  const slug = githubSlug(repository);
  const auth = await githubToken(process.env);
  const location = await locateArchive(slug, revision, auth?.token);
  const archive = await download(location.url, location.token);
  if (location.checksumUrl) {
    const expected = checksumFromSha256File((await download(location.checksumUrl)).toString('utf8'));
    if (sha256(archive) !== expected) throw new Unavailable('the release zip does not match its .sha256 asset');
  }
  const { manifest, files } = distributionFiles(unzip(archive));
  if (/^[0-9a-f]{40}$/i.test(revision) && manifest.commit?.toLowerCase() !== revision.toLowerCase()) {
    throw new Unavailable(`the downloaded distribution reports commit ${manifest.commit}, not ${revision}`);
  }

  // Staged beside the destination, then swapped in, so a failed fetch never
  // leaves a partial distribution behind.
  const destination = resolve(output);
  const staging = `${destination}.fetch-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  try {
    for (const [path, data] of files) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), data);
    }
    await writeFile(join(staging, STAMP_NAME), stampContents(location.origin, repository, revision));
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    await rename(staging, destination);
    console.log(`Using Viritura score viewer ${manifest.scoreViewerVersion} (engine ${manifest.version}, ${manifest.commit}) `
      + `from ${slug} ${location.origin}${auth ? ` via ${auth.source}` : ''}`);
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
    await fetchViewer(options);
  } catch (error) {
    console.error(`Prebuilt Viritura score viewer unavailable: ${error.message}`);
    process.exit(EXIT_UNAVAILABLE);
  }
}
