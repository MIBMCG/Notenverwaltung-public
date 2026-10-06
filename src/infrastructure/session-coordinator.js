// One native request owns a lease until its separate hold promise resolves.
// Retired requests may finish late, but can never publish a newer session.
export function createSessionCoordinator({ lockManager, resourceName, onLost }) {
  let status = 'idle';
  let current = null;
  let nextAcquire = null;
  let attemptId = 0;
  let releaseEpoch = 0;
  function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  }
  function acquire() {
    if (current && current.active) return current.result.promise;
    if (current && !current.ended) {
      if (!nextAcquire || nextAcquire.epoch !== releaseEpoch) {
        const waiting = { epoch: releaseEpoch, promise: null };
        waiting.promise = current.done.promise.then(() => {
          if (nextAcquire === waiting) nextAcquire = null;
          if (waiting.epoch !== releaseEpoch) return 'busy';
          return acquire();
        });
        nextAcquire = waiting;
      }
      return nextAcquire.promise;
    }
    if (!lockManager || typeof lockManager.request !== 'function') {
      status = 'unsupported';
      return Promise.resolve('unsupported');
    }
    const record = { id: ++attemptId, active: true, held: false, ended: false,
      result: deferred(), hold: deferred(), done: deferred() };
    current = record;
    status = 'acquiring';
    function finish(failed) {
      record.ended = true;
      if (current === record && record.active) {
        record.active = false;
        if (record.held) {
          status = 'idle';
          record.held = false;
          record.hold.resolve();
          if (typeof onLost === 'function') {
            try { onLost('native-lock-lost'); } catch (error) {}
          }
        } else if (failed) {
          status = 'unsupported';
          record.result.resolve('unsupported');
        }
      }
      record.done.resolve();
    }
    try {
      const request = lockManager.request(resourceName, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (current !== record || !record.active) return;
        if (!lock) {
          status = 'busy';
          record.result.resolve('busy');
          return;
        }
        record.held = true;
        status = 'held';
        record.result.resolve('acquired');
        return record.hold.promise;
      });
      Promise.resolve(request).then(() => finish(false), () => finish(true));
    } catch (error) { finish(true); }
    return record.result.promise;
  }
  function assertHeld() {
    if (status === 'held' && current && current.active && current.held) return;
    const error = new Error('Dieses Fenster hat keine Bearbeitungsberechtigung. Bitte erneut entsperren.');
    error.code = 'SESSION_NOT_OWNER';
    throw error;
  }
  function release() {
    releaseEpoch += 1;
    const record = current;
    if (!record) { status = 'idle'; return Promise.resolve(); }
    record.active = false;
    record.held = false;
    status = 'idle';
    record.result.resolve('busy');
    record.hold.resolve();
    return record.done.promise;
  }
  return { acquire, assertHeld, release, getStatus: () => status };
}
