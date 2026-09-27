// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleHost } from '../src/web/module-host.js';

// A host over numbered fake instances. Each request returns { success } and
// records which instance it ran on.
function fakeHost({ failLoadsAfter = Infinity } = {}) {
  let created = 0;
  const loadErrors = [];
  const host = createModuleHost({
    create: async () => {
      if (created >= failLoadsAfter) throw new Error('load failed');
      created += 1;
      return { id: created };
    },
    succeeded: (result) => result.success,
    onLoadError: (error) => loadErrors.push(error.message)
  });
  return { host, loadErrors, created: () => created };
}

test('successful requests keep using the same instance', async () => {
  const { host, created } = fakeHost();
  await host.load();
  const first = await host.run((instance) => ({ success: true, id: instance.id }));
  const second = await host.run((instance) => ({ success: true, id: instance.id }));
  assert.deepEqual([first.id, second.id], [1, 1]);
  assert.equal(created(), 1);
});

test('a result that did not succeed replaces the instance before the next request', async () => {
  const { host } = fakeHost();
  await host.load();
  const failed = await host.run((instance) => ({ success: false, id: instance.id }));
  const next = await host.run((instance) => ({ success: true, id: instance.id }));
  assert.equal(failed.id, 1);
  assert.equal(next.id, 2);
});

test('a thrown error, such as an abort, is rethrown and replaces the instance', async () => {
  const { host } = fakeHost();
  await host.load();
  await assert.rejects(
    host.run(() => { throw new Error('Aborted(stack overflow (Attempt to set SP to 0x0014ad30))'); }),
    /stack overflow/);
  const next = await host.run((instance) => ({ success: true, id: instance.id }));
  assert.equal(next.id, 2);
});

test('the next request waits for a replacement that loads slowly', async () => {
  let release;
  let created = 0;
  const host = createModuleHost({
    create: () => {
      created += 1;
      const id = created;
      if (id === 1) return Promise.resolve({ id });
      return new Promise((resolve) => { release = () => resolve({ id }); });
    },
    succeeded: (result) => result.success,
    onLoadError: () => {}
  });
  await host.load();
  await host.run(() => ({ success: false }));
  const next = host.run((instance) => ({ success: true, id: instance.id }));
  let settled = false;
  next.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  release();
  assert.equal((await next).id, 2);
});

test('a replacement that fails to load is reported and fails the next request', async () => {
  const { host, loadErrors } = fakeHost({ failLoadsAfter: 1 });
  await host.load();
  await host.run(() => ({ success: false }));
  await assert.rejects(host.run(() => ({ success: true })), /load failed/);
  assert.deepEqual(loadErrors, ['load failed']);
});
