'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source.js');

const copy = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createQueue() {
  let tail = Promise.resolve();
  return task => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}

function baseState() {
  return {
    school: { id: 'school_1', name: 'Alt' },
    categories: [{ id: 'category_1', name: 'Mündlich' }]
  };
}

async function loadCommitter() {
  return importEsmSource('src/ui/state-commit.js');
}

test('queued changes derive cumulative candidates from the latest confirmed state', async () => {
  const { createStateCommitter } = await loadCommitter();
  const original = baseState();
  let published = original;
  const writes = [];
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();

  const committer = createStateCommitter({
    readState: () => published,
    persistState: async candidate => {
      writes.push(copy(candidate));
      if (writes.length === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      }
    },
    publishState: candidate => { published = candidate; },
    enqueue: createQueue(),
    readEpoch: () => 0
  });

  const schoolCommit = committer.commit(candidate => {
    candidate.school.name = 'Neu';
  });
  await firstSaveStarted.promise;
  const categoryCommit = committer.commit(candidate => {
    candidate.categories.push({ id: 'category_2', name: 'Schriftlich' });
  });

  assert.equal(writes.length, 1, 'zweite Änderung muss hinter dem laufenden Save warten');
  assert.deepEqual(original, baseState(), 'bestätigter Eingabezustand bleibt bis zur Veröffentlichung unverändert');

  releaseFirstSave.resolve();
  await Promise.all([schoolCommit, categoryCommit]);

  assert.deepEqual(writes, [
    {
      school: { id: 'school_1', name: 'Neu' },
      categories: [{ id: 'category_1', name: 'Mündlich' }]
    },
    {
      school: { id: 'school_1', name: 'Neu' },
      categories: [
        { id: 'category_1', name: 'Mündlich' },
        { id: 'category_2', name: 'Schriftlich' }
      ]
    }
  ]);
  assert.deepEqual(published, writes[1]);
  assert.notStrictEqual(published, original);
  assert.deepEqual(original, baseState());
});

test('a failed save does not publish its candidate or poison the next queued change', async () => {
  const { createStateCommitter } = await loadCommitter();
  const original = baseState();
  let published = original;
  let saveAttempt = 0;
  const attemptedCandidates = [];
  const persistenceError = new Error('Synthetischer Speicherfehler');

  const committer = createStateCommitter({
    readState: () => published,
    persistState: async candidate => {
      saveAttempt += 1;
      attemptedCandidates.push(copy(candidate));
      if (saveAttempt === 1) throw persistenceError;
    },
    publishState: candidate => { published = candidate; },
    enqueue: createQueue(),
    readEpoch: () => 0
  });

  const failedCommit = committer.commit(candidate => {
    candidate.school.name = 'Darf nicht erscheinen';
  });
  const survivingCommit = committer.commit(candidate => {
    candidate.categories.push({ id: 'category_2', name: 'Schriftlich' });
  });

  await assert.rejects(failedCommit, error => error === persistenceError);
  await survivingCommit;

  assert.equal(attemptedCandidates.length, 2);
  assert.equal(attemptedCandidates[0].school.name, 'Darf nicht erscheinen');
  assert.equal(attemptedCandidates[1].school.name, 'Alt', 'Folgeänderung startet vom bestätigten Zustand');
  assert.deepEqual(published, attemptedCandidates[1]);
  assert.deepEqual(original, baseState());
});

test('an epoch change before the queue head aborts without persisting or publishing', async () => {
  const { createStateCommitter, STATE_COMMIT_ABORTED } = await loadCommitter();
  let published = baseState();
  let epoch = 4;
  let persistenceCalls = 0;
  let publishCalls = 0;
  const queue = createQueue();
  const releaseBlocker = deferred();
  const blocker = queue(() => releaseBlocker.promise);

  const committer = createStateCommitter({
    readState: () => published,
    persistState: async () => { persistenceCalls += 1; },
    publishState: candidate => { publishCalls += 1; published = candidate; },
    enqueue: queue,
    readEpoch: () => epoch
  });

  const staleCommit = committer.commit(candidate => {
    candidate.school.name = 'Veraltet';
  });
  epoch += 1;
  releaseBlocker.resolve();
  await blocker;

  await assert.rejects(staleCommit, error => error && error.code === STATE_COMMIT_ABORTED);
  assert.equal(persistenceCalls, 0);
  assert.equal(publishCalls, 0);
  assert.equal(published.school.name, 'Alt');

  await committer.commit(candidate => {
    candidate.school.name = 'Aktuell';
  });
  assert.equal(persistenceCalls, 1, 'Queue bleibt nach dem Abbruch verwendbar');
  assert.equal(publishCalls, 1);
  assert.equal(published.school.name, 'Aktuell');
});

test('an epoch change during persistence prevents publication and is distinct from save failure', async () => {
  const { createStateCommitter, STATE_COMMIT_ABORTED } = await loadCommitter();
  const original = baseState();
  let published = original;
  let epoch = 8;
  let saveAttempt = 0;
  let publishCalls = 0;
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();

  const committer = createStateCommitter({
    readState: () => published,
    persistState: async () => {
      saveAttempt += 1;
      if (saveAttempt === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      }
    },
    publishState: candidate => { publishCalls += 1; published = candidate; },
    enqueue: createQueue(),
    readEpoch: () => epoch
  });

  const staleCommit = committer.commit(candidate => {
    candidate.school.name = 'Während Save veraltet';
  });
  await firstSaveStarted.promise;
  epoch += 1;
  releaseFirstSave.resolve();

  await assert.rejects(staleCommit, error =>
    error && error.code === STATE_COMMIT_ABORTED && error.name === 'StateCommitAbortedError'
  );
  assert.equal(publishCalls, 0);
  assert.strictEqual(published, original);

  await committer.commit(candidate => {
    candidate.school.name = 'Neue Sitzung';
  });
  assert.equal(saveAttempt, 2);
  assert.equal(publishCalls, 1);
  assert.equal(published.school.name, 'Neue Sitzung');
});

test('change callbacks must be synchronous and cannot mutate the confirmed input', async () => {
  const { createStateCommitter } = await loadCommitter();
  const original = baseState();
  let persistenceCalls = 0;
  let publishCalls = 0;

  const committer = createStateCommitter({
    readState: () => original,
    persistState: async () => { persistenceCalls += 1; },
    publishState: () => { publishCalls += 1; },
    enqueue: createQueue(),
    readEpoch: () => 0
  });

  await assert.rejects(
    committer.commit(async candidate => {
      candidate.school.name = 'Async';
    }),
    /synchron/
  );

  assert.equal(persistenceCalls, 0);
  assert.equal(publishCalls, 0);
  assert.deepEqual(original, baseState());
});
