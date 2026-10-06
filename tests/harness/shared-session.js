'use strict';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// One instance is shared by every synthetic window in a test. The callback's
// returned promise owns the exclusive lease until it settles, as in Web Locks.
function createLockManagerStub() {
  const entries = new Map();

  function start(name, entry, job) {
    entry.held = true;
    function finish() {
      entry.held = false;
      const next = entry.queue.shift();
      if (next) start(name, entry, next);
      else entries.delete(name);
    }
    Promise.resolve()
      .then(() => job.callback({ name, mode: 'exclusive' }))
      .then(
        value => { finish(); job.resolve(value); },
        error => { finish(); job.reject(error); }
      );
  }

  function request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof name !== 'string' || !name || typeof callback !== 'function') {
      return Promise.reject(new TypeError('A lock name and callback are required.'));
    }
    if (options?.mode && options.mode !== 'exclusive') {
      return Promise.reject(new TypeError('Only exclusive locks are supported by this test stub.'));
    }
    let entry = entries.get(name);
    if (!entry) {
      entry = { held: false, queue: [] };
      entries.set(name, entry);
    }
    if (options?.ifAvailable && (entry.held || entry.queue.length)) {
      return Promise.resolve().then(() => callback(null));
    }
    return new Promise((resolve, reject) => {
      const job = { callback, resolve, reject };
      if (entry.held) entry.queue.push(job);
      else start(name, entry, job);
    });
  }

  return { request };
}

module.exports = { createLockManagerStub, deferred };
