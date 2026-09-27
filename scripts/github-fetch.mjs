// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT
//
// GitHub download helpers shared by the scripts that fetch pinned prebuilt
// modules (Denigma's WebAssembly module and Viritura's score viewer).

import { inflateRawSync } from 'node:zlib';
import { findExecutable, runExecutable } from './tooling.mjs';

export const EXIT_UNAVAILABLE = 3;

// A download that could not be used; the callers exit with EXIT_UNAVAILABLE.
export class Unavailable extends Error {}

export function githubSlug(repository) {
  const match = repository.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Unavailable(`${repository} is not a GitHub repository`);
  return `${match[1]}/${match[2]}`;
}

export function stampContents(origin, repository, revision) {
  return `${origin}\n${repository}@${revision}\n`;
}

export async function githubToken(environment) {
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

export async function githubJson(url, token) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Unavailable(`GitHub API responded ${response.status} for ${url}`);
  return response.json();
}

export async function download(url, token) {
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

