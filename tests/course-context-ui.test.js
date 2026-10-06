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

function loadCourseContextUiHelpers() {
  const modules = loadModules();
  const lines = readSourceLines();
  let source;
  try {
    source = `${extractFunction(lines, 'describeUpperSecRecommendation')}\n` +
      `${extractFunction(lines, 'applyUpperSecCourseContextChange')}\n` +
      `${extractFunction(lines, 'applyCourseSchemaContextChange')}\n` +
      `${extractFunction(lines, 'createUpperSecContextFields')}\n` +
      'globalThis.__courseContextUi = { describeUpperSecRecommendation, applyUpperSecCourseContextChange, applyCourseSchemaContextChange, createUpperSecContextFields };';
  } catch (error) {
    return { modules, helpers: null, loadError: error };
  }
  vm.runInContext(source, modules.sandbox, { filename: 'course-context-ui.js' });
  return { modules, helpers: modules.sandbox.__courseContextUi, loadError: null };
}

function loadCourseSchemaContextEditor() {
  const modules = loadModules();
  const lines = readSourceLines();
  let source;
  try {
    source = `${extractFunction(lines, 'describeUpperSecRecommendation')}\n` +
      `${extractFunction(lines, 'applyUpperSecCourseContextChange')}\n` +
      `${extractFunction(lines, 'applyCourseSchemaContextChange')}\n` +
      `${extractFunction(lines, 'createUpperSecContextFields')}\n` +
      `${extractFunction(lines, 'bindCourseSchemaContextEditor')}\n` +
      'globalThis.__courseSchemaContextEditor = bindCourseSchemaContextEditor;';
  } catch (error) {
    return { modules, bindEditor: null, loadError: error };
  }
  vm.runInContext(source, modules.sandbox, { filename: 'course-schema-context-editor.js' });
  return { modules, bindEditor: modules.sandbox.__courseSchemaContextEditor, loadError: null };
}

function createDocumentStub() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.value = '';
      this.textContent = '';
      this.checked = false;
      this.required = false;
      this.maxLength = -1;
      this.type = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) {
      const current = this.listeners.get(type) || [];
      current.push(listener);
      this.listeners.set(type, current);
    }
    async dispatch(type) {
      for (const listener of this.listeners.get(type) || []) await listener.call(this, {});
    }
  }
  return {
    createElement(tagName) { return new Element(tagName); },
    createTextNode(text) { const node = new Element('#text'); node.textContent = String(text); return node; }
  };
}

function addCustomWeightingTemplate(state) {
  const categories = state.settings.categories;
  state.settings.weightTemplates.push({
    id: 'custom-weighting',
    name: 'Benutzerdefinierte Gewichtung',
    items: [
      { categoryId: categories[0].id, weightPercent: 50 },
      { categoryId: categories[1].id, weightPercent: 50 }
    ]
  });
}

test('M31 review remediation: the real schema editor collects Sek-II context before persisting', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  const document = createDocumentStub();
  modules.sandbox.document = document;
  const state = modules.DomainModel.createEmptyState();
  addCustomWeightingTemplate(state);
  const course = modules.DomainModel.createCourse({
    id: 'course_seki_ui', name: 'Biologie 10', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES,
    weightTemplateId: 'custom-weighting'
  });
  state.courses.push(course);
  const writes = [];
  const commitHarness = createCommitHarness(modules, state, async candidate => { writes.push(candidate); });
  const schemaSelect = document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const contextHost = document.createElement('div');
  const binding = bindEditor({
    readState: commitHarness.readState,
    courseId: course.id,
    schemaSelect,
    contextHost,
    term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError(error) { assert.fail(error.message); },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId
  });

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  assert.equal(writes.length, 0, 'schema selection alone must not persist an incomplete Sek-II course');
  assert.equal(contextHost.children.length, 1, 'the same editor flow must reveal the required context fields');

  const editor = binding.getContextEditor();
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  await editor.courseTypeSelect.dispatch('change');
  assert.equal(writes.length, 0, 'one required field is still incomplete');
  editor.qualificationYearSelect.value = modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2;
  await editor.qualificationYearSelect.dispatch('change');

  assert.equal(writes.length, 1);
  const persistedCourse = modules.DomainModel.findCourseById(writes[0], course.id);
  assert.equal(persistedCourse.schemaMode, modules.DomainModel.SCHEMA_MODES.UPPERSEC);
  assert.deepEqual(JSON.parse(JSON.stringify(persistedCourse.upperSecContext)), {
    courseType: 'advanced', qualificationYear: 'q1-q2', weightingDeviationReason: null
  });
  assert.equal(persistedCourse.weightTemplateId, 'custom-weighting', 'the preview must not silently reweight');
  assert.equal(course.schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES, 'the pre-commit object remains unchanged');
  assert.equal(commitHarness.readState().courses[0].schemaMode, modules.DomainModel.SCHEMA_MODES.UPPERSEC);
});

test('M31 review remediation: cancelling an incomplete Sek-II schema candidate leaves state untouched', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  const document = createDocumentStub();
  modules.sandbox.document = document;
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course_cancel_ui', name: 'Biologie 10', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES
  });
  state.courses.push(course);
  let writes = 0;
  const commitHarness = createCommitHarness(modules, state, async () => { writes += 1; });
  const before = JSON.stringify(state);
  const schemaSelect = document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const contextHost = document.createElement('div');
  const binding = bindEditor({
    readState: commitHarness.readState, courseId: course.id, schemaSelect, contextHost, term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError(error) { assert.fail(error.message); },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId
  });

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  const editor = binding.getContextEditor();
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC;
  await editor.courseTypeSelect.dispatch('change');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  await schemaSelect.dispatch('change');

  assert.equal(writes, 0);
  assert.equal(contextHost.children.length, 0);
  assert.equal(JSON.stringify(commitHarness.readState()), before);
});

test('M31 review remediation: a rejected schema candidate does not mutate the live course', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  const document = createDocumentStub();
  modules.sandbox.document = document;
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course_failure_ui', name: 'Biologie 10', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES
  });
  state.courses.push(course);
  const commitHarness = createCommitHarness(modules, state, async () => { throw new Error('Speichern fehlgeschlagen'); });
  const before = JSON.stringify(state);
  const schemaSelect = document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const contextHost = document.createElement('div');
  let shownError = null;
  const binding = bindEditor({
    readState: commitHarness.readState, courseId: course.id, schemaSelect, contextHost, term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError: error => { shownError = error; },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId
  });

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  const editor = binding.getContextEditor();
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  await editor.courseTypeSelect.dispatch('change');
  editor.qualificationYearSelect.value = modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2;
  await editor.qualificationYearSelect.dispatch('change');

  assert.match(shownError && shownError.message, /Speichern fehlgeschlagen/);
  assert.equal(JSON.stringify(commitHarness.readState()), before);
  assert.equal(contextHost.children.length, 1, 'the complete candidate remains visible for correction or retry');
});

test('schema editor: a rapid Sek-I → Sek-II → Sek-I toggle commits the newest queued choice', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  const document = createDocumentStub();
  modules.sandbox.document = document;
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course_schema_rapid_toggle',
    name: 'Biologie 10',
    schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES
  });
  state.courses.push(course);

  let releaseBlocker;
  let signalBlockerStarted;
  const blockerGate = new Promise(resolve => { releaseBlocker = resolve; });
  const blockerStarted = new Promise(resolve => { signalBlockerStarted = resolve; });
  const commitHarness = createCommitHarness(modules, state, async candidate => {
    if (candidate._harnessBlocker) {
      signalBlockerStarted();
      await blockerGate;
    }
  });
  const blockerCommit = commitHarness.commitStateChange(candidate => { candidate._harnessBlocker = true; });
  await blockerStarted;

  const schemaSelect = document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const contextHost = document.createElement('div');
  const binding = bindEditor({
    readState: commitHarness.readState,
    courseId: course.id,
    schemaSelect,
    contextHost,
    term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError(error) { assert.fail(error.message); },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId
  });

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  const editor = binding.getContextEditor();
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  await editor.courseTypeSelect.dispatch('change');
  editor.qualificationYearSelect.value = modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2;
  const pendingSekIICommit = editor.qualificationYearSelect.dispatch('change');

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const pendingSekICommit = schemaSelect.dispatch('change');
  releaseBlocker();
  await blockerCommit;
  await Promise.all([pendingSekIICommit, pendingSekICommit]);

  const committedCourse = modules.DomainModel.findCourseById(commitHarness.readState(), course.id);
  assert.equal(committedCourse.schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
  assert.equal(committedCourse.upperSecContext, null);
});

test('schema editor: queued context commits keep each event snapshot', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  const document = createDocumentStub();
  modules.sandbox.document = document;
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course_context_snapshot',
    name: 'Biologie 10',
    schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES
  });
  state.courses.push(course);

  let releaseBlocker;
  let signalBlockerStarted;
  const blockerGate = new Promise(resolve => { releaseBlocker = resolve; });
  const blockerStarted = new Promise(resolve => { signalBlockerStarted = resolve; });
  const persistedContexts = [];
  let blockerUsed = false;
  const commitHarness = createCommitHarness(modules, state, async candidate => {
    if (candidate._harnessBlocker && !blockerUsed) {
      blockerUsed = true;
      signalBlockerStarted();
      await blockerGate;
      return;
    }
    const persistedCourse = modules.DomainModel.findCourseById(candidate, course.id);
    persistedContexts.push(JSON.parse(JSON.stringify(persistedCourse.upperSecContext)));
  });
  const blockerCommit = commitHarness.commitStateChange(candidate => { candidate._harnessBlocker = true; });
  await blockerStarted;

  const schemaSelect = document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.GRADES;
  const contextHost = document.createElement('div');
  const binding = bindEditor({
    readState: commitHarness.readState,
    courseId: course.id,
    schemaSelect,
    contextHost,
    term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError(error) { assert.fail(error.message); },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId
  });

  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  const editor = binding.getContextEditor();
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  await editor.courseTypeSelect.dispatch('change');
  editor.qualificationYearSelect.value = modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2;
  const firstContextCommit = editor.qualificationYearSelect.dispatch('change');
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC;
  const secondContextCommit = editor.courseTypeSelect.dispatch('change');

  releaseBlocker();
  await blockerCommit;
  await Promise.all([firstContextCommit, secondContextCommit]);

  assert.deepEqual(persistedContexts, [
    { courseType: 'advanced', qualificationYear: 'q1-q2', weightingDeviationReason: null },
    { courseType: 'basic', qualificationYear: 'q1-q2', weightingDeviationReason: null }
  ]);
});

test('M31 review remediation: the courses renderer uses the schema-context editor binding', () => {
  assert.match(extractFunction(readSourceLines(), 'renderCoursesSection'), /bindCourseSchemaContextEditor\(/);
});

function buildState(DomainModel) {
  const state = DomainModel.ensureStateShape({});
  const course = DomainModel.createCourse({
    id: 'course_q12_gk',
    name: 'Biologie GK',
    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    schoolYearStartYear: 2026,
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2
    },
    weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  });
  state.courses.push(course);
  return { state, course };
}

test('M31: the course-context presentation separates recommendation, active weighting and deviation', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { DomainModel } = modules;
  const { state, course } = buildState(DomainModel);

  const matching = helpers.describeUpperSecRecommendation(course, '2026-H1', state.settings);
  assert.equal(matching.visible, true);
  assert.equal(matching.courseTypeLabel, 'Grundkurs');
  assert.equal(matching.qualificationYearLabel, 'Q1/Q2');
  assert.equal(matching.recommendationLabel, 'Empfehlung: 1 Klausur, Klausurteil 1/3');
  assert.match(matching.activeWeightingLabel, /^Aktive Gewichtung: /);
  assert.equal(matching.deviationLabel, 'Keine Abweichung von der Empfehlung');

  course.weightTemplateId = 'custom-weighting';
  course.upperSecContext.weightingDeviationReason = 'Pädagogische Entscheidung';
  const deviating = helpers.describeUpperSecRecommendation(course, '2026-H1', state.settings);
  assert.equal(deviating.recommendationLabel, 'Empfehlung: 1 Klausur, Klausurteil 1/3');
  assert.equal(deviating.activeWeightingLabel, 'Aktive Gewichtung: Unbekannte oder entfernte Vorlage');
  assert.equal(deviating.deviationLabel, 'Abweichung: Pädagogische Entscheidung');
});

test('M31 final re-review: equal-distribution fallback remains a visible recommendation deviation', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { state, course } = buildState(modules.DomainModel);
  course.weightTemplateId = null;

  const presentation = helpers.describeUpperSecRecommendation(course, '2026-H1', state.settings);

  assert.match(presentation.activeWeightingLabel, /Gleichverteilung/);
  assert.equal(presentation.isWeightingDeviation, true);
  assert.match(presentation.deviationLabel, /^Abweichung:/);
});

test('M31: Sek-I courses expose no upper-secondary context controls', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const course = modules.DomainModel.createCourse({ name: 'Klasse 9' });
  const presentation = helpers.describeUpperSecRecommendation(course, '2026-H2', {});
  assert.equal(presentation.visible, false);
});

test('M31: a context edit keeps the existing weighting unless recommendation adoption is explicit', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { DomainModel } = modules;
  const { state, course } = buildState(DomainModel);
  addCustomWeightingTemplate(state);
  course.weightTemplateId = 'custom-weighting';
  const commitHarness = createCommitHarness(modules, state);
  const candidate = await commitHarness.commitStateChange(nextState => helpers.applyUpperSecCourseContextChange(nextState, course.id, {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: `  ${'x'.repeat(1005)}  `,
    term: '2026-H1',
    applyRecommendation: false
  }));

  assert.equal(candidate, commitHarness.readState());
  assert.equal(course.upperSecContext.courseType, DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    'the caller-held state remains unchanged after the isolated candidate is published');
  const changedCourse = DomainModel.findCourseById(commitHarness.readState(), course.id);
  assert.equal(changedCourse.upperSecContext.courseType, DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED);
  assert.equal(changedCourse.upperSecContext.weightingDeviationReason.length, 1000);
  assert.equal(changedCourse.weightTemplateId, 'custom-weighting');
  assert.equal(changedCourse.includePrevTermGrades, false);
});

test('M31: explicit recommendation adoption changes only the candidate course', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { DomainModel } = modules;
  const { state, course } = buildState(DomainModel);
  course.weightTemplateId = 'custom-weighting';
  const commitHarness = createCommitHarness(modules, state);
  await commitHarness.commitStateChange(nextState => helpers.applyUpperSecCourseContextChange(nextState, course.id, {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    term: '2026-H1',
    applyRecommendation: true
  }));

  assert.equal(course.weightTemplateId, 'custom-weighting');
  assert.equal(
    DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId,
    DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
  );
});

test('the bound course editor applies an explicitly checked weighting recommendation', async () => {
  const { modules, bindEditor, loadError } = loadCourseSchemaContextEditor();
  assert.equal(typeof bindEditor, 'function', loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const { state, course } = buildState(modules.DomainModel);
  addCustomWeightingTemplate(state);
  course.weightTemplateId = 'custom-weighting';
  const commitHarness = createCommitHarness(modules, state);
  const schemaSelect = modules.sandbox.document.createElement('select');
  schemaSelect.value = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  const contextHost = modules.sandbox.document.createElement('div');
  const binding = bindEditor({
    readState: commitHarness.readState,
    courseId: course.id,
    schemaSelect,
    contextHost,
    term: '2026-H1',
    commitStateChange: commitHarness.commitStateChange,
    onError(error) { assert.fail(error.message); },
    getWeightTemplateId: () => modules.DomainModel.findCourseById(
      commitHarness.readState(), course.id
    ).weightTemplateId
  });

  const editor = binding.getContextEditor();
  assert.equal(editor.applyRecommendationCheckbox.disabled, false);
  editor.applyRecommendationCheckbox.checked = true;
  await editor.applyRecommendationCheckbox.dispatch('change');

  const persistedCourse = modules.DomainModel.findCourseById(commitHarness.readState(), course.id);
  assert.equal(
    persistedCourse.weightTemplateId,
    modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
});

test('M31: rejected persistence leaves the complete live course unchanged', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { DomainModel } = modules;
  const { state, course } = buildState(DomainModel);
  const commitHarness = createCommitHarness(modules, state, async () => { throw new Error('Speichern fehlgeschlagen'); });
  const before = JSON.stringify(state);

  await assert.rejects(
    commitHarness.commitStateChange(nextState => helpers.applyUpperSecCourseContextChange(nextState, course.id, {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
      term: '2026-H1',
      applyRecommendation: true
    })),
    /Speichern fehlgeschlagen/
  );
  assert.equal(JSON.stringify(commitHarness.readState()), before);
});

test('M31: incomplete upper-secondary context is rejected before persistence', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { state, course } = buildState(modules.DomainModel);
  let writes = 0;
  const commitHarness = createCommitHarness(modules, state, async () => { writes += 1; });
  await assert.rejects(
    commitHarness.commitStateChange(nextState => helpers.applyUpperSecCourseContextChange(nextState, course.id, {
      courseType: '', qualificationYear: 'q1-q2', term: '2026-H1'
    })),
    /Kursart und Qualifikationsabschnitt/
  );
  assert.equal(writes, 0);
  assert.equal(commitHarness.readState(), state);
});

test('M31 final review: Sek-I to Sek-II conversion cannot persist without a complete context', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    id: 'course_seki', name: 'Biologie 10', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES,
    weightTemplateId: 'custom-weighting'
  });
  state.courses.push(course);
  let writes = 0;
  const commitHarness = createCommitHarness(modules, state, async () => { writes += 1; });

  await assert.rejects(
    commitHarness.commitStateChange(nextState => helpers.applyCourseSchemaContextChange(nextState, course.id, {
      schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
      upperSecContext: { courseType: 'basic', qualificationYear: '' }
    })),
    /Kursart und Qualifikationsabschnitt/
  );
  assert.equal(writes, 0);
  assert.equal(course.schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
});

test('M31 final review: a complete schema conversion preserves weighting and stored Q4 flags', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const state = modules.DomainModel.createEmptyState();
  addCustomWeightingTemplate(state);
  const course = modules.DomainModel.createCourse({
    id: 'course_seki', name: 'Biologie 10', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES,
    weightTemplateId: 'custom-weighting'
  });
  course.enrollments = [modules.DomainModel.createEnrollment({
    studentId: 'student-1', writtenExamSubjectQ4: true
  })];
  state.students.push(modules.DomainModel.createStudent({ id: 'student-1', lastName: 'Test', firstName: 'Ada' }));
  state.courses.push(course);
  const commitHarness = createCommitHarness(modules, state);
  await commitHarness.commitStateChange(nextState => helpers.applyCourseSchemaContextChange(nextState, course.id, {
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'advanced', qualificationYear: 'q1-q2' }
  }));

  const changedCourse = modules.DomainModel.findCourseById(commitHarness.readState(), course.id);
  assert.equal(course.schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
  assert.equal(changedCourse.schemaMode, modules.DomainModel.SCHEMA_MODES.UPPERSEC);
  assert.deepEqual(JSON.parse(JSON.stringify(changedCourse.upperSecContext)), {
    courseType: 'advanced', qualificationYear: 'q1-q2', weightingDeviationReason: null
  });
  assert.equal(changedCourse.weightTemplateId, 'custom-weighting', 'schema conversion must not reweight silently');
  assert.equal(changedCourse.enrollments[0].writtenExamSubjectQ4, true, 'inactive flag must remain reversible');
});

test('M31: the reusable course editor renders required Sek-II fields and no Sek-I fields', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const sekI = helpers.createUpperSecContextFields({
    schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES,
    settings: {}
  });
  assert.equal(sekI, null);

  const { state, course } = buildState(modules.DomainModel);
  const editor = helpers.createUpperSecContextFields({
    schemaMode: course.schemaMode,
    context: course.upperSecContext,
    term: '2026-H1',
    settings: state.settings,
    weightTemplateId: course.weightTemplateId,
    onChange() {}
  });
  assert.equal(editor.courseTypeSelect.required, true);
  assert.equal(editor.qualificationYearSelect.required, true);
  assert.equal(editor.reasonInput.maxLength, 1000);
  assert.equal(editor.recommendationText.textContent, 'Empfehlung: 1 Klausur, Klausurteil 1/3');
  assert.match(editor.activeWeightingText.textContent, /^Aktive Gewichtung: /);
  assert.equal(editor.deviationText.textContent, 'Keine Abweichung von der Empfehlung');
});

test('M31: changing a context field emits a complete explicit course-context decision', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const { state, course } = buildState(modules.DomainModel);
  let emitted = null;
  const editor = helpers.createUpperSecContextFields({
    schemaMode: course.schemaMode,
    context: course.upperSecContext,
    term: '2026-H1',
    settings: state.settings,
    weightTemplateId: 'custom-weighting',
    onChange(change) { emitted = change; }
  });
  editor.courseTypeSelect.value = modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  editor.qualificationYearSelect.value = modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4;
  editor.reasonInput.value = '  pädagogischer Spielraum  ';
  editor.applyRecommendationCheckbox.checked = false;
  await editor.courseTypeSelect.dispatch('change');

  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), {
    courseType: 'advanced',
    qualificationYear: 'q3-q4',
    weightingDeviationReason: '  pädagogischer Spielraum  ',
    term: '2026-H1',
    applyRecommendation: false
  });
});

test('M31 final review: create and edit presentations use canonical H2 for a Q3/Q4 LK', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const { state, course } = buildState(modules.DomainModel);
  const context = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  course.upperSecContext = context;
  course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  const options = {
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    context,
    settings: state.settings,
    weightTemplateId: course.weightTemplateId,
    now: '2026-03-15T12:00:00.000Z',
    onChange() {}
  };

  const createEditor = helpers.createUpperSecContextFields(options);
  const editEditor = helpers.createUpperSecContextFields({ ...options, course });
  for (const [label, editor] of [['Anlage', createEditor], ['Bearbeitung', editEditor]]) {
    const presentation = editor.refresh();
    assert.equal(presentation.qualificationPhase, 'Q4', label);
    assert.equal(presentation.expectedExamCount, 1, label);
    assert.equal(presentation.recommendedWeightTemplateId,
      modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM, label);
    assert.match(presentation.recommendationLabel, /1 Klausur.*1\/3/, label);
    assert.equal(presentation.isWeightingDeviation, true, label);
    assert.ok(editor.qualificationPhaseText, `${label}: sichtbare Q-Phase fehlt`);
    assert.equal(editor.qualificationPhaseText.textContent, 'Kurshalbjahr: Q4', label);
  }
});

test('M31 final review: Q4-GK presentation makes no course-wide personal exam claim', () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const state = modules.DomainModel.createEmptyState();
  const editor = helpers.createUpperSecContextFields({
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    context: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
      weightingDeviationReason: null
    },
    settings: state.settings,
    weightTemplateId: modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
    now: '2026-03-15T12:00:00.000Z',
    onChange() {}
  });
  const presentation = editor.refresh();

  assert.equal(presentation.qualificationPhase, 'Q4');
  assert.equal(presentation.expectedExamCount, null);
  assert.equal(presentation.recommendedWeightTemplateId, null);
  assert.match(presentation.recommendationLabel, /personenspezifisch/i);
  assert.doesNotMatch(presentation.recommendationLabel, /keine Klausur|nur allgemeiner Teil/i);
});

test('M31 final review: an edited 80/20 standard template cannot be offered or adopted as one third', async () => {
  const { modules, helpers, loadError } = loadCourseContextUiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  modules.sandbox.document = createDocumentStub();
  const { state, course } = buildState(modules.DomainModel);
  addCustomWeightingTemplate(state);
  const oneExam = state.settings.weightTemplates.find(template =>
    template.id === modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  oneExam.items[0].weightPercent = 80;
  oneExam.items[1].weightPercent = 20;
  if (oneExam.items[2]) oneExam.items[2].weightPercent = 0;
  course.weightTemplateId = 'custom-weighting';

  const editor = helpers.createUpperSecContextFields({
    schemaMode: course.schemaMode,
    course,
    context: course.upperSecContext,
    term: '2026-H1',
    settings: state.settings,
    weightTemplateId: course.weightTemplateId,
    onChange() {}
  });
  assert.match(editor.recommendationText.textContent, /nicht automatisch anwendbar/i);
  assert.equal(editor.applyRecommendationCheckbox.disabled, true);

  const commitHarness = createCommitHarness(modules, state);
  await commitHarness.commitStateChange(candidate => helpers.applyUpperSecCourseContextChange(candidate, course.id, {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    term: '2026-H1',
    applyRecommendation: true
  }));
  assert.equal(modules.DomainModel.findCourseById(commitHarness.readState(), course.id).weightTemplateId, 'custom-weighting');
});
