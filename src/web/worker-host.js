// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

// Owns the page's conversion worker. WebAssembly memory grows but never shrinks,
// and the memory of a discarded instance returns only when it is garbage
// collected. Terminating a worker releases its whole heap at once, so the host
// starts a fresh worker for each new file and after any failed request: an abort
// leaves the instance unusable, and an exhausted heap stays at its maximum size.
//
// spawn() creates a worker. onMessage(data) receives the current worker's
// messages; messages from a terminated worker are dropped, and only the first
// worker's 'ready' message is delivered. readInput() returns a promise of
// { fileName, buffer } for the selected file, which a worker started after a
// failed request needs before it can convert.
//
// The first worker compiles the WebAssembly module and returns it with its
// 'ready' message. Every later worker receives it in its 'init' message, so a
// fresh worker instantiates the module without downloading or compiling it.
export function createWorkerHost({ spawn, onMessage, readInput }) {
  let worker;
  let wasmModule;
  let used = false;
  let failed = false;
  let announced = false;

  function start() {
    worker?.terminate();
    const current = spawn();
    worker = current;
    used = false;
    failed = false;
    current.addEventListener('message', ({ data }) => {
      if (current !== worker) return;
      if (data.type === 'ready') {
        const { wasmModule: compiled, ...ready } = data;
        wasmModule ??= compiled;
        if (!announced) onMessage(ready);
        announced = true;
        return;
      }
      if (data.type === 'load-error' || data.type === 'worker-error' || data.success === false) failed = true;
      onMessage(data);
    });
    current.postMessage({ type: 'init', wasmModule });
  }

  return {
    start,

    // Posts message to the worker. newInput ({ fileName, buffer }) selects a new
    // file, which gets a fresh worker unless the current one has not run a request
    // yet. A request after a failure also gets a fresh worker, and the selected
    // file is sent with it.
    async send(message, newInput) {
      let input = newInput;
      if (failed || (newInput && used)) {
        start();
        input ??= await readInput();
      }
      used = true;
      if (input) {
        worker.postMessage({ ...message, fileName: input.fileName, buffer: input.buffer }, [input.buffer]);
      } else {
        worker.postMessage(message);
      }
    }
  };
}
