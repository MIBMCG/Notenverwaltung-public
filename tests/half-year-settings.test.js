'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadModules } = require('./harness/load.js');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { createStartDocument } = require('./harness/dashboard-app.js');
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

function loadHelpers() {
  const modules = loadModules();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'isStateCommitAborted')}\n` +
    `${extractFunction(lines, 'requireActiveCourse')}\n` +
    `${extractFunction(lines, 'parseHalfYearDateValue')}\n` +
    `${extractFunction(lines, 'validateHalfYearDateRange')}\n` +
    `${extractFunction(lines, 'applyHalfYearDateInputs')}\n` +
    'globalThis.__helpers = { parseHalfYearDateValue, validateHalfYearDateRange, applyHalfYearDateInputs };';
  vm.runInContext(source, modules.sandbox, { filename: 'half-year-settings.js' });
  return { modules, ...modules.sandbox.__helpers };
}

function validLevels(overrides = {}) {
  return [
    {
      level: 'seckI', label: 'Sek I', schoolYearStartValue: '2025-09-08',
      h1EndValue: '2026-01-30', h2StartValue: '2026-02-09',
      ...(overrides.seckI || {})
    },
    {
      level: 'seckII', label: 'Sek II', schoolYearStartValue: '2025-09-08',
      h1EndValue: '2026-01-30', h2StartValue: '2026-01-05',
      ...(overrides.seckII || {})
    }
  ];
}

function renderOpenCourseEditor(state, modules, course = null, options = {}) {
  const { document } = createStartDocument();
  const commitHarness = createCommitHarness(modules, state, options.persistState);
  Object.assign(modules.sandbox, {
    document,
    state: commitHarness.readState(),
    readState: commitHarness.readState,
    commitStateChange: commitHarness.commitStateChange,
    currentCourseId: course ? course.id : null,
    courseEditorOpenForId: options.openEditor === false ? null : (course ? course.id : null),
    courseEditorActiveTab: 'general',
    courseEditorTabCourseId: course ? course.id : null,
    currentSection: 'courses',
    focusTargetHeading: false,
    dashboardMount: null,
    currentAppearance: { family: 'modern', accent: 'standard', background: 'standard' },
    currentTheme: 'light',
    effectiveMotion() { return 'off'; },
    dashboardIsAllowed() { return true; },
    render() {},
    bindCourseSchemaContextEditor() {},
    createCourseSymbolPicker() {
      return {
        root: document.createElement('div'),
        select: { value: '' },
        updatePreview() {}
      };
    },
    canManageWrittenExamSubjectQ4() { return false; },
    getOverallMetricLabel() { return 'Gesamtnoten'; },
    resolveAssessmentTermFromDateValue: modules.GradingLogic.resolveAssessmentTermFromDateValue,
    window: {
      alert: options.alert || (() => {}),
      confirm: options.confirm || (() => true)
    }
  });
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'isStateCommitAborted')}\n` +
    `${extractFunction(lines, 'requireActiveCourse')}\n` +
    `${extractFunction(lines, 'parseHalfYearDateValue')}\n` +
    `${extractFunction(lines, 'recalcAssessmentTermsForCurrentState')}\n` +
    `${extractFunction(lines, 'renderCoursesSection')}\n` +
    'globalThis.__renderCoursesSection = renderCoursesSection;';
  vm.runInContext(source, modules.sandbox, { filename: 'course-term-cutoffs.js' });
  const container = document.createElement('main');
  modules.sandbox.__renderCoursesSection(container);
  return { document, container, readState: commitHarness.readState };
}

// Break caught: accepting browser-normalized or malformed input as a valid cutoff.
test('M15: strict parsing rejects malformed calendar dates', () => {
  const { parseHalfYearDateValue } = loadHelpers();
  assert.equal(parseHalfYearDateValue('2026-02-30'), null);
  assert.equal(parseHalfYearDateValue('2026/02/09'), null);
});

test('Low half-year dates keep their browser calendar day in a negative UTC timezone', () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(new Date('2026-02-09').getDate(), 8, 'negative UTC offset is not active');
    const { parseHalfYearDateValue } = loadHelpers();
    const parsed = parseHalfYearDateValue('2026-02-09');
    assert.deepEqual(
      [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()],
      [2026, 2, 9]
    );
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

// Break caught: rejecting H2 dates that overlap the H1 period despite the supported priority semantics.
test('M15: valid dates and an H2/H1 overlap remain accepted', () => {
  const { modules, applyHalfYearDateInputs } = loadHelpers();
  const state = modules.DomainModel.createEmptyState();

  const result = applyHalfYearDateInputs(state, validLevels());

  assert.equal(result.ok, true);
  assert.equal(state.settings.halfYearSettings.seckII.h2StartDay, 5);
  assert.equal(state.settings.halfYearSettings.seckII.h1EndDay, 30);
});

// Break caught: assigning a partial replacement after the first invalid cutoff is processed.
test('M15: a cutoff before school-year start is rejected without mutation', () => {
  const { modules, applyHalfYearDateInputs } = loadHelpers();
  const state = modules.DomainModel.createEmptyState();
  const before = JSON.stringify(state.settings.halfYearSettings);

  const result = applyHalfYearDateInputs(state, validLevels({
    seckI: { h1EndValue: '2025-08-30' }
  }));

  assert.equal(result.ok, false);
  assert.match(result.message, /Sek I.*gewählten Schuljahr/);
  assert.equal(JSON.stringify(state.settings.halfYearSettings), before);
});

// Break caught: accepting a cutoff in the following school year and replacing persisted settings.
test('M15: a cutoff in the following school year is rejected without mutation', () => {
  const { modules, applyHalfYearDateInputs } = loadHelpers();
  const state = modules.DomainModel.createEmptyState();
  const before = JSON.stringify(state.settings.halfYearSettings);

  const result = applyHalfYearDateInputs(state, validLevels({
    seckII: { h2StartValue: '2027-02-09' }
  }));

  assert.equal(result.ok, false);
  assert.match(result.message, /Sek II.*gewählten Schuljahr/);
  assert.equal(JSON.stringify(state.settings.halfYearSettings), before);
});

test('R22: course-specific overlap is accepted and recalculates only automatic active assessments', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course-cutoff-overlap', name: 'Biologie 10a', subject: 'Biologie', classLabel: '10a',
    schoolYearStartYear: 2025,
    termCutoffs: { h1EndMonth: 2, h1EndDay: 28, h2StartMonth: 2, h2StartDay: 1 }
  });
  modules.DomainModel.addCourseToState(state, course);
  const categoryId = state.settings.categories[0].id;
  for (const [id, termAssignment] of [['course-manual', 'manual'], ['course-auto', 'auto']]) {
    modules.DomainModel.addAssessmentToState(state, modules.DomainModel.createAssessment({
      id,
      courseId: course.id,
      categoryId,
      title: id,
      date: '2026-03-15',
      term: '2025-H1',
      termAssignment
    }));
  }
  const alerts = [];
  let saveCalls = 0;
  const { container, readState } = renderOpenCourseEditor(state, modules, course, {
    alert: message => alerts.push(String(message)),
    persistState: async () => { saveCalls += 1; }
  });
  assert.match(container.textContent, /H2-Start.*Vorrang/i);
  assert.match(container.textContent, /Lücke.*H1.*Überlappung.*H2/i);

  const cutoffEnabled = container._find(element => element.tagName === 'INPUT' && element.type === 'checkbox');
  cutoffEnabled.checked = true;
  await cutoffEnabled.dispatch('change');
  const dateInputs = container._findAll(element => element.tagName === 'INPUT' && element.type === 'date');
  assert.equal(dateInputs.length, 2);
  assert.match(dateInputs[0].value, /-02-28$/, 'stored H1 cutoff must reopen in the course editor');
  assert.match(dateInputs[1].value, /-02-01$/, 'stored H2 cutoff must reopen in the course editor');
  dateInputs[0].value = '2026-03-31';
  dateInputs[1].value = '2026-03-01';
  await container._find(element => element.tagName === 'BUTTON' && element.textContent === 'Stichtage speichern').dispatch('click');

  assert.deepEqual(alerts, []);
  assert.equal(saveCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(course.termCutoffs)), {
    h1EndMonth: 2, h1EndDay: 28, h2StartMonth: 2, h2StartDay: 1
  }, 'the pre-commit course reference remains unchanged');
  const confirmedState = readState();
  const confirmedCourse = modules.DomainModel.findCourseById(confirmedState, course.id);
  assert.deepEqual(JSON.parse(JSON.stringify(confirmedCourse.termCutoffs)), {
    h1EndMonth: 3, h1EndDay: 31, h2StartMonth: 3, h2StartDay: 1
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(confirmedState.assessments.map(assessment => [assessment.id, assessment.term, assessment.termAssignment]))),
    [
      ['course-manual', '2025-H1', 'manual'],
      ['course-auto', '2025-H2', 'auto']
    ]
  );

  const reloadedModules = loadModules();
  const reloadedState = reloadedModules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(confirmedState)));
  const reloadedCourse = reloadedState.courses.find(candidate => candidate.id === course.id);
  const reloaded = renderOpenCourseEditor(reloadedState, reloadedModules, reloadedCourse);
  const reloadedDates = reloaded.container._findAll(element => element.tagName === 'INPUT' && element.type === 'date');
  assert.match(reloadedDates[0].value, /-03-31$/);
  assert.match(reloadedDates[1].value, /-03-01$/);
});

test('R22: new-course cutoffs keep their calendar days in a negative UTC timezone and reject missing dates', async () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(new Date('2026-02-09').getDate(), 8, 'negative UTC offset is not active');
    const modules = loadModules();
    const state = modules.DomainModel.createEmptyState();
    const alerts = [];
    let savedCandidate = null;
    const { document, container, readState } = renderOpenCourseEditor(state, modules, null, {
      openEditor: false,
      alert: message => alerts.push(String(message)),
      persistState: async candidate => { savedCandidate = candidate; }
    });
    await container._find(element => element.tagName === 'BUTTON' && element.textContent === 'Kurs anlegen').dispatch('click');
    const dialog = document.body._find(element => element.className === 'new-course-dialog');
    assert.ok(dialog);
    const textInputs = dialog._findAll(element => element.tagName === 'INPUT' && element.type === 'text');
    textInputs.find(input => input.placeholder === 'z. B. 10c Biologie').value = 'Biologie 10c';
    textInputs.find(input => input.placeholder === 'z. B. Biologie').value = 'Biologie';
    textInputs.find(input => input.placeholder === 'z. B. 10c').value = '10c';
    const schemaSelect = dialog._find(element => element.tagName === 'SELECT' &&
      element.children.some(option => option.value === modules.DomainModel.SCHEMA_MODES.GRADES));
    schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
    const cutoffLabel = dialog._find(element => element.tagName === 'LABEL' &&
      /Eigene Halbjahres-Stichtage/.test(element.textContent));
    const cutoffToggle = cutoffLabel._find(element => element.tagName === 'INPUT' && element.type === 'checkbox');
    cutoffToggle.checked = true;
    await cutoffToggle.dispatch('change');
    const createButton = dialog._find(element => element.tagName === 'BUTTON' && element.textContent === 'Anlegen');

    await createButton.dispatch('click');
    assert.deepEqual(alerts, ['Bitte beide Stichtage (H1 Ende und H2 Start) ausfüllen.']);
    assert.equal(savedCandidate, null);

    const dateInputs = dialog._findAll(element => element.tagName === 'INPUT' && element.type === 'date');
    dateInputs[0].value = '2026-02-30';
    dateInputs[1].value = '2026-02-09';
    await createButton.dispatch('click');
    assert.deepEqual(alerts, [
      'Bitte beide Stichtage (H1 Ende und H2 Start) ausfüllen.',
      'Bitte gültige Stichtage verwenden.'
    ]);
    assert.equal(savedCandidate, null);

    dateInputs[0].value = '2026-01-30';
    dateInputs[1].value = '2026-02-09';
    await createButton.dispatch('click');

    assert.equal(alerts.length, 2);
    assert.ok(savedCandidate);
    assert.equal(readState(), savedCandidate);
    assert.deepEqual(JSON.parse(JSON.stringify(savedCandidate.courses[0].termCutoffs)), {
      h1EndMonth: 1, h1EndDay: 30, h2StartMonth: 2, h2StartDay: 9
    });
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});
