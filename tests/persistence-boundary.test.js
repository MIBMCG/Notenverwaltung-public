'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function boundaryFor(options) {
  const { createPersistenceBoundary } = await importEsmSource('src/ui/persistence-boundary.js');
  return createPersistenceBoundary(options);
}

test('capture waits for editor save and FIFO drain before copying the latest state', async () => {
  const saved = deferred();
  const state = { scores: { student: '4' } };
  const busy = [];
  let finished = false;
  const boundary = await boundaryFor({
    listEditors: () => [{
      finish: async () => { await saved.promise; finished = true; return true; },
      isClean: () => finished,
      focus: () => {}
    }],
    isCurrent: () => true,
    drain: async () => { assert.equal(finished, true); },
    readState: () => state,
    setBusy: value => busy.push(value)
  });

  const capture = boundary.capture();
  assert.deepEqual(busy, [true]);
  state.scores.student = '2';
  saved.resolve();
  const result = await capture;
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.scores.student, '2');
  state.scores.student = '1';
  assert.equal(result.snapshot.scores.student, '2', 'snapshot must not alias the live state');
  assert.deepEqual(busy, [true, false]);
});

test('invalid editor prevents a snapshot and remains focused for correction', async () => {
  let focused = 0;
  let read = 0;
  let busy = false;
  const boundary = await boundaryFor({
    listEditors: () => [{ finish: () => false, isClean: () => false, focus: () => {
      assert.equal(busy, false, 'disabled controls must be restored before focus');
      focused++;
    } }],
    isCurrent: () => true,
    drain: async () => {},
    readState: () => { read++; return { private: true }; },
    setBusy: value => { busy = value; }
  });
  assert.deepEqual(await boundary.capture(), { ok: false, reason: 'invalid' });
  assert.equal(focused, 1);
  assert.equal(read, 0);
});

test('a failed drain blocks capture, then a corrected retry can succeed', async () => {
  let fail = true;
  const boundary = await boundaryFor({
    listEditors: () => [],
    isCurrent: () => true,
    drain: async () => { if (fail) throw new Error('quota'); },
    readState: () => ({ saved: true }),
    setBusy: () => {}
  });
  assert.deepEqual(await boundary.capture(), { ok: false, reason: 'save-failed' });
  fail = false;
  assert.deepEqual(await boundary.capture(), { ok: true, snapshot: { saved: true } });
});

test('parallel capture is declined and invalidation prevents a stale snapshot', async () => {
  const release = deferred();
  const busy = [];
  let current = true;
  const boundary = await boundaryFor({
    listEditors: () => [{ finish: () => release.promise, isClean: () => true, focus: () => {} }],
    isCurrent: () => current,
    drain: async () => {},
    readState: () => ({ stale: true }),
    setBusy: value => busy.push(value)
  });
  const first = boundary.capture();
  assert.deepEqual(await boundary.capture(), { ok: false, reason: 'stale' });
  current = false;
  boundary.invalidate();
  release.resolve(true);
  assert.deepEqual(await first, { ok: false, reason: 'stale' });
  assert.deepEqual(busy, [true, false]);
});

test('an old invalidated capture cannot clear the busy state of a new capture', async () => {
  const oldFinish = deferred();
  const newFinish = deferred();
  const busy = [];
  let phase = 'old';
  const boundary = await boundaryFor({
    listEditors: () => [{ finish: () => phase === 'old' ? oldFinish.promise : newFinish.promise,
      isClean: () => true, focus: () => {} }],
    isCurrent: () => true,
    drain: async () => {},
    readState: () => ({ phase }),
    setBusy: value => busy.push(value)
  });
  const first = boundary.capture();
  boundary.invalidate();
  phase = 'new';
  const second = boundary.capture();
  oldFinish.resolve(true);
  assert.deepEqual(await first, { ok: false, reason: 'stale' });
  assert.deepEqual(busy, [true, false, true], 'old cleanup must leave the new capture busy');
  newFinish.resolve(true);
  assert.deepEqual(await second, { ok: true, snapshot: { phase: 'new' } });
  assert.deepEqual(busy, [true, false, true, false]);
});
