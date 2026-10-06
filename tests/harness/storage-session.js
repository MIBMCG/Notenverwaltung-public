'use strict';
const { loadModules, localStorageStub } = require('./load');
const { createLockManagerStub } = require('./shared-session');
const sessions = new WeakMap();
// These historical storage tests model consecutive reopenings, not concurrent
// windows. Make that handover explicit and reuse one manager for the same bytes.
async function openStorageSession(options = {}) {
  const storage = options.storage || localStorageStub();
  const previous = sessions.get(storage);
  if (previous) await previous.Storage.lockSession();
  const lockManager = previous ? previous.lockManager : createLockManagerStub();
  const modules = loadModules({ ...options, storage, lockManager });
  const result = await modules.sessionCoordinator.acquire();
  if (result !== 'acquired') throw new Error('Synthetic sequential session could not acquire');
  sessions.set(storage, modules);
  return modules;
}
module.exports = { openStorageSession };
