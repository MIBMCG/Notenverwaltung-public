'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLegacyDomain } = require('./harness/load-legacy-domain.js');
const { seededRandom } = require('./harness/load.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const expected = [
  'SCHEMA_MODES', 'UPPERSEC_COURSE_TYPES', 'QUALIFICATION_YEARS', 'SCORE_STATUS',
  'STANDARD_GRADE_LABELS', 'RECOMMENDED_WEIGHT_TEMPLATE_IDS', 'generateId',
  'createEmptyState', 'createDefaultGradeMapping', 'createStudent', 'createEnrollment',
  'createCourse', 'createCategory', 'getDefaultSubcategoryWeight',
  'createWeightTemplate', 'createScoreEntry', 'createAssessment', 'findStudentById',
  'findCourseById', 'findAssessmentById', 'getTermResult', 'setTermResult',
  'listAssessmentsForCourse', 'listEnrollmentsForCourse', 'findEnrollment',
  'enrollStudentInCourse', 'setWrittenExamSubjectQ4', 'resolveQualificationPhase',
  'listActiveCourses', 'listArchivedCourses', 'studentHasArchivedCourseReference',
  'listReferencedStudentIdsForCourse', 'listStudentReportCourses',
  'resolveUpperSecWrittenCategoryId', 'createArchiveSnapshot',
  'normalizeArchiveRetentionUntil', 'normalizeArchiveNote', 'normalizeUpperSecContext',
  'planCourseSuccessor', 'createSuccessorCourseCandidate', 'archiveCourse',
  'restoreCourse', 'addStudentToState', 'addCourseToState', 'addAssessmentToState',
  'removeStudentFromState', 'removeCourseFromState', 'ensureStateShape'
].sort();
const json = value => JSON.parse(JSON.stringify(value));
const FIXED_INSTANT = '2026-09-04T08:09:10.000Z';

function assertModernStateMatchesFrozenLegacy(modernValue, legacyValue, selectState = value => value) {
  const modernComparable = json(modernValue);
  const modernState = selectState(modernComparable);
  assert.equal(modernState.lastGradesheetCourseId, null);
  delete modernState.lastGradesheetCourseId;
  delete modernState.settings.schoolProfile;
  assert.deepEqual(modernComparable, json(legacyValue));
}

function loadPair(instant = FIXED_INSTANT) {
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(instant);
      else super(...args);
    }
    static now() { return Date.parse(instant); }
  }
  const legacyModules = loadLegacyDomain({ seed: 71, dateImpl: FixedDate });
  const exports = loadEsmGraph('src/domain/domain-model.js', {
    globals: { Date: FixedDate, Math: Object.assign(Object.create(Math), { random: seededRandom(71) }) }
  }).exports;
  const now = () => new FixedDate();
  const termServices = {
    getSettingsForCourse: legacyModules.GradingLogic.getSettingsForCourse,
    resolveAssessmentTermFromDateValue: legacyModules.GradingLogic.resolveAssessmentTermFromDateValue
  };
  return { exports, now, termServices, legacy: legacyModules.DomainModel,
    modern: exports.createDomainModel({ now, termServices }) };
}

test('facade preserves legacy public keys and adds the school profile normalizer', () => {
  const { exports, modern, legacy } = loadPair();
  assert.deepEqual(Object.keys(exports), ['createDomainModel']);
  assert.deepEqual(Object.keys(modern).sort(), [...expected, 'normalizeSchoolProfile'].sort());
  assert.deepEqual(Object.keys(legacy).sort(), expected);
  for (const name of expected) {
    if (typeof legacy[name] === 'function') assert.equal(modern[name].length, legacy[name].length, name);
    else assert.deepEqual(json(modern[name]), json(legacy[name]), name);
  }
});

test('facade keeps representative factory defaults, deterministic IDs and mutation results', () => {
  const { modern, legacy } = loadPair();
  function scenario(domain) {
    const state = domain.createEmptyState();
    const student = domain.createStudent({ firstName: 'Ada', lastName: 'Test' });
    const course = domain.createCourse({ name: 'Bio' });
    domain.addStudentToState(state, student);
    domain.addCourseToState(state, course);
    domain.enrollStudentInCourse(state, course.id, student.id);
    const assessment = domain.createAssessment({ courseId: course.id, categoryId: state.settings.categories[0].id });
    domain.addAssessmentToState(state, assessment);
    return state;
  }
  const actual = scenario(modern);
  assertModernStateMatchesFrozenLegacy(actual, scenario(legacy));
  assert.equal(actual.courses[0].enrollments[0].writtenExamSubjectQ4, false);
});

test('facade preserves thrown error messages for rejected consumer operations', () => {
  const { modern, legacy } = loadPair();
  const cases = [
    domain => domain.planCourseSuccessor({}, 1900),
    domain => domain.setTermResult({ courses: [] }, 'missing', 's1', '2026-H1', 12)
  ];
  for (const scenario of cases) {
    let expectedError;
    try { scenario(legacy); } catch (error) { expectedError = { name: error.name, message: error.message }; }
    assert.ok(expectedError, 'historical operation must reject');
    assert.throws(() => scenario(modern), expectedError);
  }
  for (const domain of [modern, legacy]) {
    assert.equal(domain.archiveCourse({ courses: [] }, 'missing'), false);
    assert.equal(domain.enrollStudentInCourse({ courses: [], students: [] }, 'missing', 's1'), false);
  }
});

test('facade binds the clock to archive snapshots and default/manual archive metadata', () => {
  const { modern, legacy } = loadPair();
  function scenario(domain) {
    const state = domain.createEmptyState();
    const course = domain.createCourse({ id: 'c1', name: 'Bio' });
    domain.addCourseToState(state, course);
    const snapshot = domain.createArchiveSnapshot(state, course);
    domain.archiveCourse(state, course.id);
    return { state, snapshot };
  }
  const actual = scenario(modern);
  assertModernStateMatchesFrozenLegacy(actual, scenario(legacy), value => value.state);
  assert.equal(actual.snapshot.createdAt, FIXED_INSTANT);
  assert.equal(actual.state.courses[0].archivedAt, FIXED_INSTANT);
  assert.equal(actual.state.courses[0].archiveReason, 'manual');
});

test('facade injects real term services and clock for dated and undated migration', () => {
  for (const [instant, undatedTerm] of [
    ['2026-09-04T08:09:10.000Z', '2025-H2'],
    ['2026-10-04T08:09:10.000Z', '2026-H1']
  ]) {
    const { modern, legacy } = loadPair(instant);
    const input = {
      students: [], courses: [
        { id: 'c1', name: 'Bio', schemaMode: 'grades' },
        { id: 'c2', name: 'Undated', schemaMode: 'grades' }
      ],
      settings: { categories: [{ id: 'cat1', name: 'Test', active: true, subcategories: [] }] },
      assessments: [
        { id: 'a1', courseId: 'c1', categoryId: 'cat1', date: '2026-02-09', term: null },
        { id: 'a2', courseId: 'c2', categoryId: 'cat1', date: null, term: null }
      ]
    };
    const actual = modern.ensureStateShape(json(input));
    const actualWithoutNewAssignmentMetadata = json(actual);
    for (const assessment of actualWithoutNewAssignmentMetadata.assessments) {
      delete assessment.termAssignment;
    }
    assertModernStateMatchesFrozenLegacy(actualWithoutNewAssignmentMetadata, legacy.ensureStateShape(json(input)));
    assert.deepEqual(json(actual.assessments.map(item => [item.id, item.termAssignment])), [
      ['a1', 'auto'],
      ['a2', 'auto']
    ]);
    assert.deepEqual(json(actual.assessments.map(item => item.term)), ['2025-H2', undatedTerm]);
    assert.equal(actual.courses[0].schoolYearStartYear, null);
  }
});

test('facade rejects missing or invalid dependencies without mutating consumer state', () => {
  const { exports, now } = loadPair();
  for (const options of [undefined, {}, { now: null }, { now: 1 }]) {
    assert.throws(() => exports.createDomainModel(options), { name: 'TypeError', message: 'now muss eine Funktion sein.' });
  }
  for (const termServices of [undefined, null, {}, { getSettingsForCourse() {} },
    { getSettingsForCourse: true, resolveAssessmentTermFromDateValue() {} }]) {
    const input = { students: 'unchanged' };
    assert.throws(() => {
      const facade = exports.createDomainModel({ now, termServices });
      facade.ensureStateShape(input);
    }, { name: 'TypeError', message: 'termServices muss getSettingsForCourse und resolveAssessmentTermFromDateValue bereitstellen.' });
    assert.deepEqual(input, { students: 'unchanged' });
  }
});

test('facade creation permits lazy callbacks to later-initialized real GradingLogic', () => {
  const { exports, now, legacy } = loadPair();
  const facade = exports.createDomainModel({ now, termServices: {
    getSettingsForCourse: (...args) => grading.getSettingsForCourse(...args),
    resolveAssessmentTermFromDateValue: (...args) => grading.resolveAssessmentTermFromDateValue(...args)
  } });
  const grading = loadLegacyDomain().GradingLogic;
  assertModernStateMatchesFrozenLegacy(facade.ensureStateShape({}), legacy.ensureStateShape({}));
});
