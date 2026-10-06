'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

function createCommitHarness(modules, initialState, persistState = async () => {}) {
  let confirmedState = initialState;
  let queue = Promise.resolve();
  const { createStateCommitter } = loadEsmGraph('src/ui/state-commit.js').exports;
  const committer = createStateCommitter({
    readState: () => confirmedState,
    persistState,
    publishState(candidate) {
      confirmedState = candidate;
      modules.sandbox.state = candidate;
    },
    enqueue(operation) {
      const pending = queue.then(operation, operation);
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
    readEpoch: () => 0
  });
  const readState = () => confirmedState;
  const commitStateChange = (change, options = {}) => {
    void options;
    return committer.commit(change);
  };
  modules.sandbox.state = confirmedState;
  modules.sandbox.readState = readState;
  modules.sandbox.commitStateChange = commitStateChange;
  return { readState, commitStateChange };
}

function createDocumentStub() {
  const clickedElements = [];
  let documentStub = null;

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.ownerDocument = documentStub;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.textContent = '';
      this.value = '';
      this.listeners = new Map();
      const classes = new Set();
      this.classList = {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle: (name, force) => {
          const next = force === undefined ? !classes.has(name) : !!force;
          if (next) classes.add(name); else classes.delete(name);
          return next;
        }
      };
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    get firstChild() { return this.children[0] || null; }
    get options() { return this.children; }

    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] === undefined ? null : String(this[name]); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    async dispatch(type) {
      const listener = this.listeners.get(type);
      if (listener) await listener.call(this, { target: this });
    }
    focus() {}
    click() { clickedElements.push(this); }
    remove(index) {
      if (typeof index === 'number') {
        if (this.children[index]) this.removeChild(this.children[index]);
        return;
      }
      if (!this.parentNode) return;
      this.parentNode.removeChild(this);
    }
    replaceChildren(...children) {
      this.children = [];
      for (const child of children) this.appendChild(child);
    }
  }

  documentStub = {
    body: null,
    _clickedElements: clickedElements,
    createElement(tagName) { return new FakeElement(tagName); },
    createElementNS(namespaceURI, tagName) {
      const element = new FakeElement(tagName);
      element.namespaceURI = namespaceURI;
      return element;
    },
    createTextNode(text) {
      const node = new FakeElement('#text');
      node.textContent = String(text);
      return node;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  documentStub.body = new FakeElement('body');
  return documentStub;
}

function collectText(root) {
  return [root.textContent, ...(root.children || []).map(collectText)]
    .filter(Boolean)
    .join(' ');
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function loadCoursesRenderer(modules, state, document, options = {}) {
  const commitHarness = createCommitHarness(modules, state, options.persistState);
  Object.assign(modules.sandbox, {
    document,
    state: commitHarness.readState(),
    currentCourseId: options.currentCourseId || null,
    courseEditorOpenForId: null,
    currentSection: 'courses',
    focusTargetHeading: false,
    dashboardMount: null,
    currentAppearance: { family: 'modern', accent: 'standard', background: 'standard' },
    currentTheme: 'light',
    effectiveMotion() { return 'off'; },
    dashboardIsAllowed() { return true; },
    readState: commitHarness.readState,
    commitStateChange: commitHarness.commitStateChange,
    render: () => {},
    bindCourseSchemaContextEditor() {},
    canManageWrittenExamSubjectQ4() { return false; },
    getOverallMetricLabel() { return 'Gesamtnoten'; },
    window: {
      alert: options.alert || (() => {}),
      confirm: options.confirm || (() => true)
    }
  });
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'isStateCommitAborted')}\n` +
    `${extractFunction(lines, 'requireActiveCourse')}\n` +
    `${extractFunction(lines, 'requireStudent')}\n` +
    `${extractFunction(lines, 'renderCoursesSection')}\n` +
    'globalThis.__renderCoursesSection = renderCoursesSection;';
  vm.runInContext(source, modules.sandbox, { filename: 'renderCoursesSection.js' });
  return modules.sandbox.__renderCoursesSection;
}

function loadStudentsRenderer(modules, state, document, options = {}) {
  const commitHarness = createCommitHarness(modules, state, options.persistState);
  Object.assign(modules.sandbox, {
    document,
    state: commitHarness.readState(),
    readState: commitHarness.readState,
    commitStateChange: commitHarness.commitStateChange,
    render: () => {},
    window: {
      alert: options.alert || (() => {}),
      confirm: options.confirm || (() => true)
    }
  });
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'isStateCommitAborted')}\n` +
    `${extractFunction(lines, 'requireStudent')}\n` +
    `${extractFunction(lines, 'renderStudentsSection')}\n` +
    'globalThis.__renderStudentsSection = renderStudentsSection;';
  vm.runInContext(source, modules.sandbox, { filename: 'renderStudentsSection.js' });
  return modules.sandbox.__renderStudentsSection;
}

test('Low student deletion: course details report an incomplete record instead of an archive block', async () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const state = DomainModel.createEmptyState();
  const student = { id: '', firstName: 'Unvollständig', lastName: 'Datensatz', homeClass: '' };
  const course = DomainModel.createCourse({ id: 'course_invalid_student', name: 'Biologie 10' });
  course.enrollments.push({ studentId: '', subgroup: null });
  state.students.push(student);
  state.courses.push(course);
  const alerts = [];
  let saveCalls = 0;
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadCoursesRenderer(modules, state, document, {
    currentCourseId: course.id,
    alert: message => alerts.push(String(message)),
    persistState: async () => { saveCalls++; }
  })(container);

  const deleteButton = findElement(container, element => element.textContent === 'Schüler löschen');
  assert.ok(deleteButton, 'Löschbutton im Kursdetail fehlt');
  await deleteButton.dispatch('click');

  assert.equal(saveCalls, 0);
  assert.equal(modules.sandbox.readState().students.length, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0], 'Der Schülerdatensatz ist unvollständig und kann nicht gelöscht werden.');
  assert.doesNotMatch(alerts[0], /archiv/i);
});

test('Low student deletion: master data report an incomplete record instead of an archive block', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.students.push({ id: '', firstName: 'Unvollständig', lastName: 'Datensatz', homeClass: '' });
  const alerts = [];
  let saveCalls = 0;
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadStudentsRenderer(modules, state, document, {
    alert: message => alerts.push(String(message)),
    persistState: async () => { saveCalls++; }
  })(container);

  assert.doesNotMatch(collectText(container), /Fehler beim Laden der Stammdaten/, collectText(container));
  const deleteButton = findElement(container, element => element.textContent === 'Löschen');
  assert.ok(deleteButton, 'Löschbutton in den Stammdaten fehlt');
  await deleteButton.dispatch('click');

  assert.equal(saveCalls, 0);
  assert.equal(modules.sandbox.readState().students.length, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0], 'Löschen nicht möglich: Der Personendatensatz ist unvollständig.');
  assert.doesNotMatch(alerts[0], /archiv/i);
});

test('Low student inline edit: persistence receives an isolated candidate and completion is awaited', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const student = modules.DomainModel.createStudent({
    id: 'student_inline_edit',
    firstName: 'Ada',
    lastName: 'Alt',
    birthDate: '2010-01-02',
    homeClass: '9a'
  });
  state.students.push(student);
  let directSaveCalls = 0;
  modules.Storage.saveState = async () => { directSaveCalls++; };

  let persistedCandidate = null;
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadStudentsRenderer(modules, state, document, {
    persistState: async candidate => {
      persistedCandidate = candidate;
      await saveGate;
    }
  })(container);

  const editButton = findElement(container, element => element.textContent === 'Edit');
  assert.ok(editButton, 'Bearbeiten-Schaltfläche in den Stammdaten fehlt');
  await editButton.dispatch('click');

  const lastInput = findElement(container, element => element.value === 'Alt');
  const firstInput = findElement(container, element => element.value === 'Ada');
  const birthInput = findElement(container, element => element.value === '2010-01-02');
  const classInput = findElement(container, element => element.tagName === 'input' && element.value === '9a');
  assert.ok(lastInput && firstInput && birthInput && classInput, 'Inline-Eingabefelder fehlen');
  lastInput.value = 'Neu';
  firstInput.value = 'Grace';
  birthInput.value = '   ';
  classInput.value = ' 10b ';

  const saveButton = findElement(container, element => element.textContent === 'Speichern');
  assert.ok(saveButton, 'Speichern-Schaltfläche beim Inline-Bearbeiten fehlt');
  let saveCompleted = false;
  const saving = saveButton.dispatch('click').then(() => { saveCompleted = true; });
  await Promise.resolve();

  assert.ok(persistedCandidate, 'Der zentrale Speicherweg wurde nicht aufgerufen');
  assert.notStrictEqual(persistedCandidate, state);
  assert.deepEqual(
    {
      lastName: persistedCandidate.students[0].lastName,
      firstName: persistedCandidate.students[0].firstName,
      birthDate: persistedCandidate.students[0].birthDate,
      homeClass: persistedCandidate.students[0].homeClass
    },
    { lastName: 'Neu', firstName: 'Grace', birthDate: null, homeClass: '10b' }
  );
  assert.deepEqual(
    { lastName: student.lastName, firstName: student.firstName, birthDate: student.birthDate, homeClass: student.homeClass },
    { lastName: 'Alt', firstName: 'Ada', birthDate: '2010-01-02', homeClass: '9a' }
  );
  assert.equal(modules.sandbox.readState(), state, 'the latest confirmed state stays published while persistence is pending');
  assert.equal(saveCompleted, false);

  releaseSave();
  await saving;
  assert.equal(saveCompleted, true);
  assert.equal(directSaveCalls, 0);
  assert.equal(modules.sandbox.readState(), persistedCandidate, 'the isolated candidate publishes only after persistence succeeds');
});

test('Low student inline edit: pending persistence locks row actions and ignores a second save click', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.students.push(modules.DomainModel.createStudent({
    id: 'student_inline_pending',
    firstName: 'Ada',
    lastName: 'Alt',
    homeClass: '9a'
  }));

  let saveCalls = 0;
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadStudentsRenderer(modules, state, document, {
    persistState: async () => {
      saveCalls++;
      await saveGate;
    }
  })(container);

  await findElement(container, element => element.textContent === 'Edit').dispatch('click');
  const saveButton = findElement(container, element => element.textContent === 'Speichern');
  const cancelButton = findElement(container, element => element.textContent === 'Abbrechen');
  const deleteButton = findElement(container, element => element.textContent === 'Löschen');
  const firstSave = saveButton.dispatch('click');
  await Promise.resolve();
  const secondSave = saveButton.dispatch('click');
  await Promise.resolve();

  assert.equal(saveCalls, 1);
  assert.equal(saveButton.disabled, true);
  assert.equal(cancelButton.disabled, true);
  assert.equal(deleteButton.disabled, true);

  releaseSave();
  await Promise.all([firstSave, secondSave]);
  assert.equal(saveButton.disabled, false);
  assert.equal(cancelButton.disabled, false);
  assert.equal(deleteButton.disabled, false);
});

test('Low student inline edit: rejected persistence keeps live data and reports the failure', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const student = modules.DomainModel.createStudent({
    id: 'student_inline_rejected',
    firstName: 'Ada',
    lastName: 'Alt',
    birthDate: '2010-01-02',
    homeClass: '9a'
  });
  state.students.push(student);
  const alerts = [];
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadStudentsRenderer(modules, state, document, {
    alert: message => alerts.push(String(message)),
    persistState: async () => { throw new Error('Speichern fehlgeschlagen'); }
  })(container);

  const editButton = findElement(container, element => element.textContent === 'Edit');
  await editButton.dispatch('click');
  const lastInput = findElement(container, element => element.tagName === 'input' && element.value === 'Alt');
  lastInput.value = 'Neu';
  const saveButton = findElement(container, element => element.textContent === 'Speichern');

  await assert.doesNotReject(() => saveButton.dispatch('click'));

  assert.equal(modules.sandbox.readState().students[0].lastName, 'Alt');
  assert.deepEqual(alerts, ['Stammdaten konnten nicht gespeichert werden: Speichern fehlgeschlagen']);
  assert.ok(findElement(container, element => element.textContent === 'Speichern'));
});

test('Low student inline edit: candidate preparation failures are reported and unlock saving', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.students.push(modules.DomainModel.createStudent({
    id: 'student_inline_candidate_failure',
    firstName: 'Ada',
    lastName: 'Alt',
    homeClass: '9a'
  }));
  state.circularReference = state;
  const alerts = [];
  let saveCalls = 0;
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadStudentsRenderer(modules, state, document, {
    alert: message => alerts.push(String(message)),
    persistState: async () => { saveCalls++; }
  })(container);

  await findElement(container, element => element.textContent === 'Edit').dispatch('click');
  const saveButton = findElement(container, element => element.textContent === 'Speichern');

  await assert.doesNotReject(() => saveButton.dispatch('click'));

  assert.equal(saveCalls, 0);
  assert.equal(saveButton.disabled, false);
  assert.equal(modules.sandbox.readState(), state, 'failed candidate preparation must not publish a replacement state');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^Stammdaten konnten nicht gespeichert werden: /);
});

test('M28: archive list counts a student retained only by a stored score', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const state = DomainModel.createEmptyState();
  const enrolled = DomainModel.createStudent({ id: 'student_enrolled', firstName: 'Ada', lastName: 'Enrolled' });
  const scoreOnly = DomainModel.createStudent({ id: 'student_score_only', firstName: 'Grace', lastName: 'Score' });
  const course = DomainModel.createCourse({ id: 'course_archive', name: 'Biologie 10' });
  const assessment = DomainModel.createAssessment({
    id: 'assessment_archive',
    courseId: course.id,
    title: 'Klausur'
  });
  assessment.scores[scoreOnly.id] = DomainModel.createScoreEntry({ valueRaw: '2' });
  state.students.push(enrolled, scoreOnly);
  state.courses.push(course);
  DomainModel.enrollStudentInCourse(state, course.id, enrolled.id);
  state.assessments.push(assessment);
  DomainModel.archiveCourse(state, course.id, 'manual', {});

  assert.equal(DomainModel.listReferencedStudentIdsForCourse(state, course.id).size, 2);

  const document = createDocumentStub();
  const container = document.createElement('main');
  loadCoursesRenderer(modules, state, document)(container);

  assert.match(collectText(container), /2 Schüler:innen, 1 Leistungen/);
});

test('Wave 2: archive rows and details keep their German date text', { concurrency: false }, async () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const modules = loadModules();
    const state = modules.DomainModel.createEmptyState();
    const course = modules.DomainModel.createCourse({ id: 'course_dates', name: 'Biologie 10' });
    state.courses.push(course);
    modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
    course.archivedAt = '2026-08-30T14:15:16.000Z';
    course.archiveRetentionUntil = '2027-08-30';

    const document = createDocumentStub();
    const container = document.createElement('main');
    loadCoursesRenderer(modules, state, document)(container);

    assert.match(collectText(container), /30\.8\.2026/);
    assert.match(collectText(container), /30\.8\.2027/);
    const detailsButton = findElement(container, element => element.textContent === 'Ansehen');
    assert.ok(detailsButton, 'Archivdetails-Schaltfläche fehlt');
    await detailsButton.dispatch('click');
    const detailText = collectText(document.body);
    assert.match(detailText, /30\.8\.2026/);
    assert.match(detailText, /30\.8\.2027/);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('Low archive export privacy: the downloaded filename exposes no course metadata', async () => {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-08-30T14:15:16.000Z']));
    }
    static now() { return new Date('2026-08-30T14:15:16.000Z').getTime(); }
  }

  const modules = loadModules({ dateImpl: FixedDate });
  const { DomainModel } = modules;
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({
    id: 'course_private_archive',
    name: 'Biologie 10a - vertraulich',
    classLabel: '10a'
  });
  state.courses.push(course);
  DomainModel.archiveCourse(state, course.id, 'manual', {});

  let encryptedJson = null;
  let createdBlob = null;
  const revokedUrls = [];
  modules.Storage.encryptForBackup = async json => {
    encryptedJson = json;
    return 'encrypted-archive-payload';
  };
  Object.assign(modules.sandbox, {
    Blob,
    URL: {
      createObjectURL(blob) {
        createdBlob = blob;
        return 'blob:archive-download';
      },
      revokeObjectURL(url) { revokedUrls.push(url); }
    }
  });

  const alerts = [];
  const document = createDocumentStub();
  const container = document.createElement('main');
  loadCoursesRenderer(modules, state, document, {
    alert: message => alerts.push(String(message))
  })(container);

  const exportButton = findElement(container, element => element.textContent === 'Archiv exportieren');
  assert.ok(exportButton, 'Archivexport-Schaltfläche fehlt');
  await exportButton.dispatch('click');

  assert.equal(alerts.length, 0);
  assert.equal(document._clickedElements.length, 1);
  const download = document._clickedElements[0];
  assert.equal(download.download, 'notenverwaltung_archiv_2026-08-30T14-15-16.enc.json');
  assert.equal(download.href, 'blob:archive-download');
  assert.equal(createdBlob.type, 'application/json;charset=utf-8');
  assert.equal(await createdBlob.text(), 'encrypted-archive-payload');
  assert.match(encryptedJson, /Biologie 10a - vertraulich/);
  assert.deepEqual(revokedUrls, ['blob:archive-download']);
});
