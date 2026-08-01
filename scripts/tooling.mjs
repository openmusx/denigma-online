// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { accessSync, constants, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

function executableExtensions(environment) {
  return isWindows ? (environment.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
}

function executableOnPath(name, environment) {
  for (const directory of (environment.PATH || '').split(delimiter).filter(Boolean)) {
    for (const extension of executableExtensions(environment)) {
      try {
        accessSync(join(directory, isWindows ? `${name}${extension}` : name), isWindows ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return false;
}

function emsdkCandidates(workspace) {
  return [...new Set([
    process.env.DENIGMA_EMSDK,
    process.env.EMSDK,
    resolve(workspace, '..', 'emsdk'),
    join(homedir(), 'emsdk')
  ].filter(Boolean).map((value) => resolve(value)))];
}

function parseEnvironment(output, separator) {
  const environment = { ...process.env };
  for (const entry of output.split(separator)) {
    const equals = entry.indexOf('=');
    if (equals > 0) environment[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return environment;
}

function activateEmsdk(root) {
  if (isWindows) {
    const script = join(root, 'emsdk_env.bat');
    if (!existsSync(script)) return undefined;
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `call "${script}" >nul && set`], {
      encoding: 'utf8',
      windowsHide: true
    });
    return result.status === 0 ? parseEnvironment(result.stdout, /\r?\n/) : undefined;
  }

  const script = join(root, 'emsdk_env.sh');
  if (!existsSync(script)) return undefined;
  const result = spawnSync('/bin/bash', ['-c', 'source "$1" >/dev/null && env -0', 'bash', script], {
    encoding: 'utf8'
  });
  return result.status === 0 ? parseEnvironment(result.stdout, '\0') : undefined;
}

export function developmentEnvironment(workspace = process.cwd()) {
  if (executableOnPath('emcmake', process.env) && executableOnPath('emcc', process.env)) {
    return { environment: { ...process.env }, emsdkRoot: process.env.EMSDK };
  }
  for (const root of emsdkCandidates(workspace)) {
    const environment = activateEmsdk(root);
    if (environment && executableOnPath('emcmake', environment) && executableOnPath('emcc', environment)) {
      return { environment, emsdkRoot: root };
    }
  }
  return { environment: { ...process.env }, emsdkRoot: undefined };
}

export async function findExecutable(name, environment = process.env) {
  const extensions = executableExtensions(environment);
  for (const directory of (environment.PATH || '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, isWindows ? `${name}${extension}` : name);
      try {
        await access(candidate, isWindows ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

export function runExecutable(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.environment || process.env,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding,
    windowsHide: true,
    shell: isWindows && /\.(bat|cmd)$/i.test(executable)
  });
}

export function versionAtLeast(actual, required) {
  const actualParts = actual.split('.').map(Number);
  const requiredParts = required.split('.').map(Number);
  const count = Math.max(actualParts.length, requiredParts.length);
  for (let index = 0; index < count; index += 1) {
    const actualPart = actualParts[index] || 0;
    const requiredPart = requiredParts[index] || 0;
    if (actualPart > requiredPart) return true;
    if (actualPart < requiredPart) return false;
  }
  return true;
}
