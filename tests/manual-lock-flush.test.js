'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures');
const { loadDashboardUi, findByAttribute, findByText } = require('./harness/dashboard-app');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture() {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const studentId = ctx.students[0].id;
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Synthetische Leistung',
    date: '2025-10-15', term: '2025-H2'
  });
  setScore(modules, assessment, studentId, '4');
  const app = await loadDashboardUi({ state: ctx.state });
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const row = app.root.querySelectorAll('tr').find(item =>
    item.dataset.student === studentId && item.querySelectorAll('.gradesheet-input').length > 0);
  const input = row.querySelectorAll('.gradesheet-input')[0];
  const lock = app.root._find(item => item.className === 'header-action header-lock');
  assert.ok(input && lock);
  return { app, input, lock, studentId };
}

function lockedNotice(app) {
  return app.root._find(item => item.className === 'lock-card__message')?.textContent || '';
}

async function storedScore(f) {
  await f.app.sessionCoordinator.acquire();
  const state = await f.app.Storage.loadState();
  return state.assessments[0].scores[f.studentId].valueRaw;
}

test('manual lock masks and focuses synchronously, then persists a pending 4 to 2 edit', async () => {
  const f = await fixture();
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const locking = f.lock.dispatch('click');
  assert.equal(f.app.root.hidden, true);
  assert.equal(f.app.root.inert, true);
  const overlay = f.app.document.body._find(item => item.className === 'privacy-lock-overlay');
  assert.ok(overlay && overlay.parentNode === f.app.document.body);
  assert.equal(overlay.textContent.includes('Sperren läuft – Eingaben werden gespeichert.'), true);
  assert.equal(overlay._findAll(item => item === f.app.document.activeElement).length, 1);
  assert.equal(f.app.Storage.hasSessionPassword(), true);
  gate.resolve();
  await Promise.all([saving, locking]);
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(f.app.sessionCoordinator.getStatus(), 'idle');
  assert.equal(f.app.root.textContent.includes('Synthetische Leistung'), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), false);
  const unlock = f.app.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Entsperren');
  assert.ok(unlock);
  await unlock.dispatch('click');
  const card = f.app.root._find(item => item.getAttribute && item.getAttribute('data-course-id'));
  assert.ok(card);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const reopened = f.app.root.querySelectorAll('.gradesheet-input')[0];
  assert.equal(reopened.value, '2');
});

test('invalid edit hard-locks with a neutral loss notice and cannot replay the discarded draft', async () => {
  const f = await fixture();
  f.input.value = '99';
  const locking = f.lock.dispatch('click');
  assert.equal(f.app.root.hidden, true);
  assert.equal(f.app.root.inert, true);
  await locking;
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
  assert.equal(f.app.document.body.textContent.includes('99'), false);
  assert.equal(await storedScore(f), '4');
});

test('immediate discard ends a gated flush without persisting the stale edit', async () => {
  const f = await fixture();
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const locking = f.lock.dispatch('click');
  const discard = f.app.document.body._find(item => item.textContent === 'Sofort sperren und ungespeicherte Eingaben verwerfen');
  assert.ok(discard);
  await discard.dispatch('click');
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(f.app.sessionCoordinator.getStatus(), 'idle');
  gate.resolve();
  await Promise.all([saving, locking]);
  assert.equal(await storedScore(f), '4');
});

test('a failed old save handler cannot alter a new login while its completion is still gated', async () => {
  const f = await fixture();
  await f.app.Storage.flushPendingWrites();
  const gate = deferred();
  const started = deferred();
  const setItem = f.app.storage.setItem.bind(f.app.storage);
  let injectedFailure = false;
  let armFailure = false;
  f.app.storage.setItem = (key, value) => {
    if (armFailure && !injectedFailure && key === 'notenverwaltung_v1_state_enc') {
      injectedFailure = true;
      const error = new Error('synthetic quota during old save');
      error.name = 'QuotaExceededError';
      throw error;
    }
    return setItem(key, value);
  };
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  let observedError = null;
  f.app.Storage.saveState = async candidate => {
    armFailure = true;
    try {
      return await save(candidate);
    } catch (error) {
      observedError = error;
      started.resolve();
      await gate.promise;
      throw error;
    }
  };
  f.input.value = '2';
  const oldSave = f.input.dispatch('change');
  await started.promise;
  assert.equal(observedError.name, 'QuotaExceededError');
  assert.equal(injectedFailure, true);
  const locking = f.lock.dispatch('click');
  const discard = f.app.document.body._find(item =>
    item.textContent === 'Sofort sperren und ungespeicherte Eingaben verwerfen');
  await discard.dispatch('click');
  assert.equal(f.app.Storage.hasSessionPassword(), false);

  f.app.Storage.saveState = save;
  f.app.sandbox.window.promptPassword = async () => f.app.password;
  await f.app.UiShell.init('app');
  assert.equal(f.app.Storage.hasSessionPassword(), true);
  const card = f.app.root._find(item => item.getAttribute && item.getAttribute('data-course-id'));
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const newInput = f.app.root.querySelectorAll('tr').find(item => item.dataset.student === f.studentId &&
    item.querySelectorAll('.gradesheet-input').length > 0)
    .querySelectorAll('.gradesheet-input')[0];
  assert.equal(newInput.value, '4');

  gate.resolve();
  await Promise.all([oldSave, locking]);
  assert.equal(f.app.Storage.hasSessionPassword(), true);
  assert.equal(newInput.value, '4', 'old failed handler must not rewrite the fresh editor');
  assert.equal((await f.app.Storage.loadCurrentSessionState()).assessments[0].scores[f.studentId].valueRaw,
    '4', 'old failed save must not persist its stale candidate in the new session');
  newInput.value = '3';
  await newInput.dispatch('change');
  assert.equal((await f.app.Storage.loadCurrentSessionState()).assessments[0].scores[f.studentId].valueRaw, '3');
  assert.equal(newInput.value, '3');
});
test('automatic hard lock masks pending private input and reports a neutral loss', async () => {
  const f = await fixture();
  f.input.value = '2';
  await f.app.Storage.lockSession();
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(f.app.root.textContent.includes('Synthetische Leistung'), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
});

test('rejected save cannot turn a manual lock into a false success', async () => {
  const f = await fixture();
  f.app.Storage.saveState = async () => { throw new Error('synthetic quota error with private value 2'); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  const locking = f.lock.dispatch('click');
  assert.equal(f.app.root.hidden, true);
  await Promise.all([saving, locking]);
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
  assert.equal(f.app.document.body.textContent.includes('synthetic quota'), false);
  assert.equal(await storedScore(f), '4');
});

test('watchdog hard-locks at 30 seconds even while a save remains unsettled', async () => {
  const f = await fixture();
  let watchdog;
  f.app.sandbox.setTimeout = (callback, delay) => {
    if (delay === 30000) watchdog = callback;
    return 1;
  };
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const locking = f.lock.dispatch('click');
  assert.equal(typeof watchdog, 'function');
  assert.equal(f.app.root.hidden, true);
  watchdog();
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
  gate.resolve();
  await Promise.all([saving, locking]);
  assert.equal(await storedScore(f), '4');
});

test('double lock click and automatic lock during flush cannot restore the old session', async () => {
  const f = await fixture();
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const first = f.lock.dispatch('click');
  const second = f.lock.dispatch('click');
  assert.equal(f.app.document.body._findAll(item => item.className === 'privacy-lock-overlay').length, 1);
  await f.app.Storage.lockSession();
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
  gate.resolve();
  await Promise.all([saving, first, second]);
  assert.equal(await storedScore(f), '4');
});

test('beforeunload requests a native warning for a dirty editor before the hard boundary', async () => {
  const f = await fixture();
  f.input.value = '2';
  const event = new Event('beforeunload', { cancelable: true });
  f.app.sandbox.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(f.app.root.textContent.includes('Synthetische Leistung'), false);
});

test('beforeunload does not request a warning when no input or write is pending', async () => {
  const f = await fixture();
  await f.app.Storage.flushPendingWrites();
  await new Promise(resolve => setImmediate(resolve));
  const event = new Event('beforeunload', { cancelable: true });
  f.app.sandbox.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.app.Storage.hasSessionPassword(), false);
});

test('beforeunload warns for an unsettled write even after the editor is clean', async () => {
  const f = await fixture();
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const event = new Event('beforeunload', { cancelable: true });
  f.app.sandbox.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.app.root.textContent.includes('Synthetische Leistung'), false);
  gate.resolve();
  await saving;
});

test('pagehide remains a hard boundary for a dirty editor', async () => {
  const f = await fixture();
  f.input.value = '2';
  f.app.sandbox.window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.app.Storage.hasSessionPassword(), false);
  assert.equal(f.app.root.textContent.includes('Synthetische Leistung'), false);
  assert.equal(lockedNotice(f.app).includes('Die letzte Eingabe wurde nicht gespeichert.'), true);
});

test('a private body-level dialog is masked during flush and removed after lock', async () => {
  const f = await fixture();
  const dialog = f.app.document.createElement('div');
  dialog.textContent = 'Synthetischer privater Dialog';
  f.app.document.body.appendChild(dialog);
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const locking = f.lock.dispatch('click');
  assert.equal(dialog.hidden, true);
  assert.equal(dialog.inert, true);
  gate.resolve();
  await Promise.all([saving, locking]);
  assert.equal(dialog.parentNode, null);
  assert.equal(f.app.document.body.textContent.includes('Synthetischer privater Dialog'), false);
});

test('manual flush retains window A ownership until B can load the new saved value', async () => {
  const f = await fixture();
  const b = await loadDashboardUi({
    storage: f.app.storage, lockManager: f.app.lockManager, useExistingStorage: true
  });
  await b.UiShell.init('app');
  assert.equal(b.sessionCoordinator.getStatus(), 'busy');
  const gate = deferred();
  const started = deferred();
  const save = f.app.Storage.saveState.bind(f.app.Storage);
  f.app.Storage.saveState = async candidate => { started.resolve(); await gate.promise; return save(candidate); };
  f.input.value = '2';
  const saving = f.input.dispatch('change');
  await started.promise;
  const locking = f.lock.dispatch('click');
  assert.equal(b.sessionCoordinator.getStatus(), 'busy');
  assert.equal(f.app.sessionCoordinator.getStatus(), 'held');
  gate.resolve();
  await Promise.all([saving, locking]);
  await b.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Erneut versuchen').dispatch('click');
  assert.equal(b.sessionCoordinator.getStatus(), 'held');
  const card = b.root._find(item => item.getAttribute && item.getAttribute('data-course-id'));
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  assert.equal(b.root.querySelectorAll('.gradesheet-input')[0].value, '2');
});

test('an old password dialog cannot rotate credentials after manual lock', async () => {
  const f = await fixture();
  await findByText(f.app.root, 'Einstellungen').dispatch('click');
  await findByAttribute(f.app.root, 'data-settings-area', 'security').dispatch('click');
  const gate = deferred();
  f.app.sandbox.window.promptPassword = () => gate.promise;
  let changes = 0;
  const change = f.app.Storage.changePassword.bind(f.app.Storage);
  f.app.Storage.changePassword = (...args) => { changes += 1; return change(...args); };
  const dialog = findByText(f.app.root, 'Passwort ändern').dispatch('click');
  const lock = f.app.root._find(item => item.className === 'header-action header-lock');
  await lock.dispatch('click');
  gate.resolve(f.app.password);
  await dialog;
  assert.equal(changes, 0);
  assert.equal(f.app.Storage.hasSessionPassword(), false);
});
