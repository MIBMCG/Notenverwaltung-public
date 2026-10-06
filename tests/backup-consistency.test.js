'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');
const { loadDashboardUi, findByAttribute } = require('./harness/dashboard-app.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function openBackupFixture() {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const studentId = ctx.students[0].id;
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Synthetische Leistung',
    date: '2025-10-15',
    term: '2025-H2'
  });
  setScore(modules, assessment, studentId, '4');
  const app = await loadDashboardUi({ state: ctx.state });
  const downloads = [];
  const alerts = [];
  app.sandbox.downloadBlobFile = (content, type, filename) => downloads.push({ content, type, filename });
  app.sandbox.window.alert = message => alerts.push(message);
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const row = app.root.querySelectorAll('tr').find(item =>
    item.dataset.student === studentId && item.querySelectorAll('.gradesheet-input').length > 0);
  assert.ok(row);
  const input = row.querySelectorAll('.gradesheet-input')[0];
  const backupButton = app.root._find(element => element.className === 'header-action header-action-primary');
  assert.ok(input && backupButton);
  return { app, input, backupButton, downloads, alerts, studentId };
}

async function restoredScore(fixture) {
  const payload = fixture.downloads[0].content;
  const restored = JSON.parse(await fixture.app.Storage._decryptPayload(payload, fixture.app.password));
  return restored.assessments[0].scores[fixture.studentId].valueRaw;
}

// Model the browser's default-edit boundary, not an application event listener:
// native paste changes a text control only while it is editable, then emits input.
async function nativePaste(input, value) {
  if (input.disabled || input.readOnly) return false;
  input.value = value;
  await input.dispatch('input', { inputType: 'insertFromPaste' });
  return true;
}

test('header backup waits for the real pending grade save and decrypts to the new value', async () => {
  const fixture = await openBackupFixture();
  const saveGate = deferred();
  const saved = fixture.app.Storage.saveState.bind(fixture.app.Storage);
  fixture.app.Storage.saveState = async candidate => { await saveGate.promise; return saved(candidate); };

  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  const backingUp = fixture.backupButton.dispatch('click');
  await Promise.resolve();
  assert.equal(fixture.downloads.length, 0);
  saveGate.resolve();
  await Promise.all([saving, backingUp]);
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');
});

test('native paste cannot change a grade during a gated backup, and editing resumes afterward', async () => {
  const fixture = await openBackupFixture();
  const saveGate = deferred();
  const saveStarted = deferred();
  const saved = fixture.app.Storage.saveState.bind(fixture.app.Storage);
  fixture.app.Storage.saveState = async candidate => {
    saveStarted.resolve();
    await saveGate.promise;
    return saved(candidate);
  };

  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  await saveStarted.promise;
  const backingUp = fixture.backupButton.dispatch('click');
  let pastedDuringCapture;
  try {
    pastedDuringCapture = await nativePaste(fixture.input, '3');
    assert.equal(fixture.downloads.length, 0);
  } finally {
    saveGate.resolve();
  }
  await Promise.all([saving, backingUp]);
  assert.equal(pastedDuringCapture, false);
  assert.equal(fixture.input.value, '2');
  assert.equal(fixture.input.readOnly, false);
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');

  assert.equal(await nativePaste(fixture.input, '3'), true);
  await fixture.input.dispatch('change');
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 2);
  const restored = JSON.parse(await fixture.app.Storage._decryptPayload(
    fixture.downloads[1].content, fixture.app.password
  ));
  assert.equal(restored.assessments[0].scores[fixture.studentId].valueRaw, '3');
});

test('a control mounted during a gated capture is noneditable until cleanup', async () => {
  const fixture = await openBackupFixture();
  const previousReadOnly = fixture.app.document.createElement('input');
  previousReadOnly.type = 'text';
  previousReadOnly.readOnly = true;
  fixture.app.root.appendChild(previousReadOnly);
  const checkbox = fixture.app.document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  fixture.app.root.appendChild(checkbox);
  const previousDisabled = fixture.app.document.createElement('select');
  previousDisabled.disabled = true;
  fixture.app.root.appendChild(previousDisabled);
  const editable = fixture.app.document.createElement('div');
  editable.setAttribute('contenteditable', 'plaintext-only');
  fixture.app.root.appendChild(editable);
  const saveGate = deferred();
  const saveStarted = deferred();
  const saved = fixture.app.Storage.saveState.bind(fixture.app.Storage);
  fixture.app.Storage.saveState = async candidate => {
    saveStarted.resolve();
    await saveGate.promise;
    return saved(candidate);
  };

  // Model childList observer delivery after a new root descendant is mounted.
  let observer = null;
  let lastObserver = null;
  fixture.app.sandbox.MutationObserver = class {
    constructor(callback) { this.callback = callback; lastObserver = this; }
    observe() { observer = this; }
    disconnect() { if (observer === this) observer = null; }
  };
  const appendChild = fixture.app.root.appendChild.bind(fixture.app.root);
  fixture.app.root.appendChild = child => {
    const mounted = appendChild(child);
    if (observer) queueMicrotask(() => { if (observer) observer.callback([]); });
    return mounted;
  };

  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  await saveStarted.promise;
  const backingUp = fixture.backupButton.dispatch('click');
  let pasted;
  try {
    assert.equal(previousReadOnly.readOnly, true);
    assert.equal(checkbox.disabled, true);
    if (!checkbox.disabled) checkbox.checked = true; // browser default click boundary
    assert.equal(checkbox.checked, false);
    assert.equal(previousDisabled.disabled, true);
    assert.equal(editable.getAttribute('contenteditable'), 'false');
    const lateInput = fixture.app.document.createElement('input');
    lateInput.type = 'text';
    lateInput.value = 'untouched';
    fixture.app.root.appendChild(lateInput);
    await Promise.resolve();
    pasted = await nativePaste(lateInput, 'changed');
    assert.equal(lateInput.value, 'untouched');
    assert.equal(fixture.downloads.length, 0);
  } finally {
    saveGate.resolve();
  }
  await Promise.all([saving, backingUp]);
  assert.equal(pasted, false);
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');
  assert.equal(observer, null);
  assert.equal(previousReadOnly.readOnly, true);
  assert.equal(checkbox.disabled, false);
  assert.equal(previousDisabled.disabled, true);
  assert.equal(editable.getAttribute('contenteditable'), 'plaintext-only');
  const afterInput = fixture.app.document.createElement('input');
  afterInput.type = 'text';
  fixture.app.root.appendChild(afterInput);
  lastObserver.callback([]); // a queued callback from the disposed capture
  assert.equal(afterInput.readOnly, false);
});

test('hard lock during capture removes private content without reactivating the old editor', async () => {
  const fixture = await openBackupFixture();
  const saveGate = deferred();
  const saveStarted = deferred();
  const saved = fixture.app.Storage.saveState.bind(fixture.app.Storage);
  fixture.app.Storage.saveState = async candidate => {
    saveStarted.resolve();
    await saveGate.promise;
    return saved(candidate);
  };
  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  await saveStarted.promise;
  const backingUp = fixture.backupButton.dispatch('click');
  assert.equal(fixture.input.readOnly, true);
  fixture.app.root.hidden = true;
  fixture.app.root.inert = true; // Task 4's external lock overlay owns these flags.
  fixture.app.Storage.lockSession();
  saveGate.resolve();
  await Promise.all([saving, backingUp]);
  assert.equal(fixture.downloads.length, 0);
  assert.equal(fixture.app.root.hidden, false, 'the cleaned root holds the neutral lock view');
  assert.equal(fixture.app.root.inert, false);
  assert.equal(fixture.app.root.textContent.includes('Synthetische Leistung'), false);
  assert.equal(fixture.input.readOnly, true, 'stale cleanup must not reenable the old editor');
});

test('backup waits for a UI commit queued before its Storage write begins', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const app = await loadDashboardUi({ state: ctx.state });
  const downloads = [];
  app.sandbox.downloadBlobFile = content => downloads.push(content);
  await app.UiShell.init('app');
  const saveGate = deferred();
  const saveStarted = deferred();
  const saved = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = async candidate => {
    saveStarted.resolve();
    await saveGate.promise;
    return saved(candidate);
  };
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  const opening = card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const backupButton = app.root._find(element => element.className === 'header-action header-action-primary');
  const backingUp = backupButton.dispatch('click');
  await saveStarted.promise;
  assert.equal(downloads.length, 0);
  saveGate.resolve();
  await Promise.all([opening, backingUp]);
  assert.equal(downloads.length, 1);
  const restored = JSON.parse(await app.Storage._decryptPayload(downloads[0], app.password));
  assert.equal(restored.lastGradesheetCourseId, ctx.course.id);
});

test('a background UI save that fails before the FIFO barrier still blocks backup', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const app = await loadDashboardUi({ state: ctx.state });
  const downloads = [];
  app.sandbox.downloadBlobFile = content => downloads.push(content);
  await app.UiShell.init('app');
  const saveGate = deferred();
  const saveStarted = deferred();
  app.Storage.saveState = async () => {
    saveStarted.resolve();
    await saveGate.promise;
    throw new Error('synthetic quota failure');
  };
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  const opening = card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const backupButton = app.root._find(element => element.className === 'header-action header-action-primary');
  const backingUp = backupButton.dispatch('click');
  await saveStarted.promise;
  saveGate.resolve();
  await Promise.all([opening, backingUp]);
  assert.equal(downloads.length, 0);
});

test('invalid nonempty grade prevents backup and leaves its error and focus usable', async () => {
  const fixture = await openBackupFixture();
  fixture.input.value = '99';
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 0);
  assert.strictEqual(fixture.app.document.activeElement, fixture.input);
  assert.equal(fixture.input.getAttribute('aria-invalid'), 'true');
  assert.equal(fixture.input.readOnly, false);
  fixture.input.value = '2';
  await fixture.input.dispatch('change');
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');
});

test('intentional clearing reaches the decrypted complete backup', async () => {
  const fixture = await openBackupFixture();
  fixture.input.value = '';
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 1);
  const restored = JSON.parse(await fixture.app.Storage._decryptPayload(
    fixture.downloads[0].content, fixture.app.password
  ));
  assert.equal(restored.assessments[0].scores[fixture.studentId].valueRaw, null);
});

test('pending upper-secondary finalized result is in the decrypted backup', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const studentId = ctx.students[0].id;
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, studentId, '2025-H2', 12);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Synthetische Punkte',
    date: '2025-10-15',
    term: '2025-H2'
  });
  setScore(modules, assessment, studentId, '4');
  const app = await loadDashboardUi({ state: ctx.state });
  const downloads = [];
  app.sandbox.downloadBlobFile = content => downloads.push(content);
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const input = app.root.querySelectorAll('.gradesheet-term-result-input').find(item => item.value === '12');
  const gradeInput = app.root.querySelectorAll('.gradesheet-input').find(item => item.value === '4');
  assert.ok(input && gradeInput);
  const saveGate = deferred();
  const saved = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = async candidate => { await saveGate.promise; return saved(candidate); };
  input.value = '0';
  gradeInput.value = '2';
  const savingResult = input.dispatch('change');
  const savingGrade = gradeInput.dispatch('change');
  const backupButton = app.root._find(element => element.className === 'header-action header-action-primary');
  const backingUp = backupButton.dispatch('click');
  assert.equal(downloads.length, 0);
  saveGate.resolve();
  await Promise.all([savingResult, savingGrade, backingUp]);
  assert.equal(downloads.length, 1);
  const restored = JSON.parse(await app.Storage._decryptPayload(downloads[0], app.password));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.courses[0].termResults)), [
    { studentId, term: '2025-H2', points: 0 }
  ]);
  assert.equal(restored.assessments[0].scores[studentId].valueRaw, '2');
});

test('failed pending save blocks backup; explicit correction allows a later backup', async () => {
  const fixture = await openBackupFixture();
  const saveGate = deferred();
  const saveStarted = deferred();
  const saved = fixture.app.Storage.saveState.bind(fixture.app.Storage);
  let first = true;
  fixture.app.Storage.saveState = candidate => {
    if (first) { first = false; saveStarted.resolve(); return saveGate.promise; }
    return saved(candidate);
  };

  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  const backingUp = fixture.backupButton.dispatch('click');
  await saveStarted.promise;
  saveGate.reject(new Error('synthetic quota failure'));
  await Promise.all([saving, backingUp]);
  assert.equal(fixture.downloads.length, 0);
  fixture.input.value = '2';
  await fixture.input.dispatch('change');
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');
});

test('actual storage quota failure prevents backup until the grade is retried', async () => {
  const fixture = await openBackupFixture();
  const originalSetItem = fixture.app.storage.setItem.bind(fixture.app.storage);
  let failNextPayload = true;
  fixture.app.storage.setItem = (key, value) => {
    if (failNextPayload && key === 'notenverwaltung_v1_state_enc') {
      failNextPayload = false;
      const error = new Error('synthetic storage quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    return originalSetItem(key, value);
  };
  fixture.input.value = '2';
  const saving = fixture.input.dispatch('change');
  const backingUp = fixture.backupButton.dispatch('click');
  await Promise.all([saving, backingUp]);
  assert.equal(fixture.downloads.length, 0);
  assert.equal(fixture.input.readOnly, false);
  fixture.input.focus();
  assert.equal(fixture.app.document.activeElement === fixture.input, true);
  fixture.input.value = '2';
  await fixture.input.dispatch('change');
  await fixture.backupButton.dispatch('click');
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '2');
});

test('a failed diagnostic direct save cannot back up its unsaved in-memory mutation', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const app = await loadDashboardUi({ state: ctx.state });
  app.storage.setItem('__debugMode', '1');
  app.sandbox.alert = () => {};
  const downloads = [];
  app.sandbox.downloadBlobFile = content => downloads.push(content);
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  assert.equal(typeof app.sandbox.window.runCreatePersistentUpperSecTestCourse, 'function');
  const failedSave = Promise.reject(new Error('synthetic diagnostic save failure'));
  failedSave.catch(() => {});
  app.Storage.saveState = () => failedSave;
  app.sandbox.window.runCreatePersistentUpperSecTestCourse();
  await new Promise(resolve => setImmediate(resolve));
  const backupButton = app.root._find(element => element.className === 'header-action header-action-primary');
  await backupButton.dispatch('click');
  assert.equal(downloads.length, 0);
});

test('lock during encryption and a second backup click cannot produce a late duplicate', async () => {
  const fixture = await openBackupFixture();
  const encryptionGate = deferred();
  const encrypted = deferred();
  const encrypt = fixture.app.Storage.encryptForBackup.bind(fixture.app.Storage);
  fixture.app.Storage.encryptForBackup = async json => {
    const result = await encrypt(json);
    encrypted.resolve();
    await encryptionGate.promise;
    return result;
  };
  const first = fixture.backupButton.dispatch('click');
  const second = fixture.backupButton.dispatch('click');
  await encrypted.promise;
  fixture.app.Storage.lockSession();
  encryptionGate.resolve();
  await Promise.all([first, second]);
  assert.equal(fixture.downloads.length, 0);
});

test('two backup clicks during encryption produce one decryptable download', async () => {
  const fixture = await openBackupFixture();
  const encryptionGate = deferred();
  const encrypted = deferred();
  const encrypt = fixture.app.Storage.encryptForBackup.bind(fixture.app.Storage);
  fixture.app.Storage.encryptForBackup = async json => {
    const result = await encrypt(json);
    encrypted.resolve();
    await encryptionGate.promise;
    return result;
  };
  const first = fixture.backupButton.dispatch('click');
  const second = fixture.backupButton.dispatch('click');
  await encrypted.promise;
  assert.equal(fixture.downloads.length, 0);
  encryptionGate.resolve();
  await Promise.all([first, second]);
  assert.equal(fixture.downloads.length, 1);
  assert.equal(await restoredScore(fixture), '4');
});
