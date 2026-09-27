// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

// Owns the worker's Denigma WebAssembly instance. A failed request can leave the
// instance unusable: an abort, such as a stack overflow, stops it, and an exhausted
// heap stays at its maximum size. After any failed request the host therefore loads
// a fresh instance, and the next request waits for it.
//
// create() returns a promise of a new instance. succeeded(result) says whether a
// request's result was a success. onLoadError(error) reports a replacement that
// could not be loaded; the failed load also fails the requests waiting for it.
export function createModuleHost({ create, succeeded, onLoadError }) {
  let loading;

  function load() {
    loading = Promise.resolve().then(create);
    return loading;
  }

  function replace() {
    load().catch(onLoadError);
  }

  return {
    load,

    // Runs request(instance) on the current instance and returns its result. A
    // result that did not succeed, or a thrown error, replaces the instance.
    async run(request) {
      const instance = await loading;
      let result;
      try {
        result = request(instance);
      } catch (error) {
        replace();
        throw error;
      }
      if (!succeeded(result)) replace();
      return result;
    }
  };
}
