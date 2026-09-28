// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../src/web/worker-host.js';

class FakeWorker {
  constructor(id) {
    this.id = id;
    this.posted = [];
    this.terminated = false;
    this.listeners = [];
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.push(listener);
  }

  postMessage(data, transfer = []) {
    this.posted.push({ data, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.listeners.forEach((listener) => listener({ data }));
  }
}

// A host over numbered fake workers that records the messages it delivers.
function fakeHost() {
  const workers = [];
  const delivered = [];
  let inputReads = 0;
  const host = createWorkerHost({
    spawn: () => {
      const worker = new FakeWorker(workers.length + 1);
      workers.push(worker);
      return worker;
    },
    onMessage: (data) => delivered.push(data),
    readInput: async () => {
      inputReads += 1;
      return { fileName: 'score.musx', buffer: new ArrayBuffer(8) };
    }
  });
  host.start();
  return { host, workers, delivered, inputReads: () => inputReads };
}

const input = () => ({ fileName: 'score.musx', buffer: new ArrayBuffer(8) });

test('the first worker compiles the module and later workers receive it', async () => {
  const { host, workers, delivered } = fakeHost();
  const compiled = { compiled: true };
  assert.deepEqual(workers[0].posted[0].data, { type: 'init', wasmModule: undefined });
  workers[0].emit({ type: 'ready', denigmaVersion: '4.0.0', wasmModule: compiled });
  assert.deepEqual(delivered, [{ type: 'ready', denigmaVersion: '4.0.0' }]);

  await host.send({ type: 'inspect', requestId: 1 }, input());
  await host.send({ type: 'inspect', requestId: 2 }, input());
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(workers[1].posted[0].data, { type: 'init', wasmModule: compiled });
});

test('a new file uses the current worker until it has run a request', async () => {
  const { host, workers } = fakeHost();
  const first = input();
  await host.send({ type: 'inspect', requestId: 1 }, first);
  assert.equal(workers.length, 1);
  const request = workers[0].posted[1];
  assert.deepEqual(request.data, { type: 'inspect', requestId: 1, fileName: 'score.musx', buffer: first.buffer });
  assert.deepEqual(request.transfer, [first.buffer]);

  await host.send({ type: 'convert', requestId: 2 });
  assert.equal(workers.length, 1);
  await host.send({ type: 'inspect', requestId: 3 }, input());
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
});

test('a request after a result that did not succeed gets a fresh worker and the file', async () => {
  const { host, workers, inputReads } = fakeHost();
  await host.send({ type: 'inspect', requestId: 1 }, input());
  workers[0].emit({ type: 'converted', requestId: 1, success: false });
  await host.send({ type: 'convert', requestId: 2, options: {} });
  assert.equal(workers[0].terminated, true);
  assert.equal(inputReads(), 1);
  const request = workers[1].posted[1].data;
  assert.equal(request.type, 'convert');
  assert.equal(request.fileName, 'score.musx');
  assert.ok(request.buffer instanceof ArrayBuffer);
});

test('a request after a worker error, such as an abort, gets a fresh worker', async () => {
  const { host, workers } = fakeHost();
  await host.send({ type: 'inspect', requestId: 1 }, input());
  workers[0].emit({ type: 'worker-error', requestId: 1, message: 'Aborted(stack overflow)' });
  await host.send({ type: 'convert', requestId: 2, options: {} });
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
});

test('messages from a terminated worker are dropped', async () => {
  const { host, workers, delivered } = fakeHost();
  await host.send({ type: 'inspect', requestId: 1 }, input());
  await host.send({ type: 'inspect', requestId: 2 }, input());
  workers[0].emit({ type: 'inspected', requestId: 1, success: true });
  assert.deepEqual(delivered, []);
  workers[1].emit({ type: 'inspected', requestId: 2, success: true });
  assert.deepEqual(delivered, [{ type: 'inspected', requestId: 2, success: true }]);
});

test('only the first worker announces that the page is ready', async () => {
  const { host, workers, delivered } = fakeHost();
  workers[0].emit({ type: 'ready', wasmModule: {} });
  await host.send({ type: 'inspect', requestId: 1 }, input());
  await host.send({ type: 'inspect', requestId: 2 }, input());
  workers[1].emit({ type: 'ready' });
  assert.deepEqual(delivered.map(({ type }) => type), ['ready']);
});
