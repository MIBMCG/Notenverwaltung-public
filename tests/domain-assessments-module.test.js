'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seededRandom } = require('./harness/load.js');
const { loadLegacyDomain: loadModules } = require('./harness/load-legacy-domain.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const serializable = value => JSON.parse(JSON.stringify(value));
const thrownMessage = fn => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};

function loadAssessments(seed = 7) {
  const math = Object.assign(Object.create(Math), { random: seededRandom(seed) });
  return loadEsmGraph('src/domain/assessments.js', { globals: { Math: math } }).exports;
}

test('Wave 3.1 assessment factories preserve legacy shapes', () => {
  const legacy = loadModules({ seed: 7 }).DomainModel;
  const mod = loadAssessments(7);
  const cases = [
    ['createCategory', { id: 'cat_1', name: 'Schriftlich', active: true, subcategories: [] }],
    ['createWeightTemplate', { id: 'wt_1', name: '50/50', items: [{ categoryId: 'cat_1', weightPercent: 50 }] }],
    ['createScoreEntry', { valueRaw: '12', status: 'valid', valueNumeric: 12 }],
    ['createAssessment', { id: 'asm_1', courseId: 'c_1', categoryId: 'cat_1', title: 'K1', weight: 0 }]
  ];
  for (const [name, input] of cases) {
    assert.deepEqual(serializable(mod[name](input)), serializable(legacy[name](input)), name);
  }
});

test('D4: assessment construction transports explicit provenance and canonicalizes legacy term spellings', () => {
  const mod = loadAssessments(8);
  const assessment = mod.createAssessment({
    id: 'asm_d4', courseId: 'course_d4', categoryId: 'category_d4', title: 'D4',
    date: '2026-02-05', term: '2025-H2', termAssignment: 'manual'
  });

  assert.equal(assessment.termAssignment, 'manual');
  assert.equal(mod.normalizeAssessmentTerm(' 2025-h2 '), '2025-H2');
  assert.equal(mod.normalizeAssessmentTerm('2025-H3'), null);
  assert.equal(mod.normalizeAssessmentTerm(null), null);
  assert.equal(mod.isCanonicalTerm(' 2025-h2 '), false, 'strict canonical checks remain strict');
});

test('Wave 3.1 assessment operations preserve lookup, list and insertion behavior', () => {
  const legacy = loadModules({ seed: 11 }).DomainModel;
  const mod = loadAssessments(11);
  const assessments = [
    legacy.createAssessment({ id: 'a1', courseId: 'c1', categoryId: 'cat', title: 'K1' }),
    legacy.createAssessment({ id: 'a2', courseId: 'c2', categoryId: 'cat', title: 'K2' })
  ];
  const left = { assessments: assessments.map(item => ({ ...item })) };
  const right = { assessments: assessments.map(item => ({ ...item })) };
  assert.deepEqual(serializable(mod.findAssessmentById(left, 'a1')), serializable(legacy.findAssessmentById(right, 'a1')));
  assert.deepEqual(serializable(mod.findAssessmentById(left, 'missing')), serializable(legacy.findAssessmentById(right, 'missing')));
  assert.deepEqual(serializable(mod.listAssessmentsForCourse(left, 'c1')), serializable(legacy.listAssessmentsForCourse(right, 'c1')));
  assert.equal(mod.addAssessmentToState(left, assessments[0]), legacy.addAssessmentToState(right, assessments[0]));
  assert.deepEqual(serializable(left), serializable(right));
});

test('Wave 3.1 subcategory weighting matches legacy', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadAssessments();
  assert.equal(mod.getDefaultSubcategoryWeight({ subcategories: [] }), legacy.getDefaultSubcategoryWeight({ subcategories: [] }));
  assert.equal(mod.getDefaultSubcategoryWeight({ subcategories: [{}] }), legacy.getDefaultSubcategoryWeight({ subcategories: [{}] }));
});

function upperSecFixture() {
  const legacy = loadModules().DomainModel;
  const state = legacy.createEmptyState();
  const student = legacy.createStudent({ firstName: 'Ada', lastName: 'Beispiel' });
  const course = legacy.createCourse({ name: 'QX', schemaMode: legacy.SCHEMA_MODES.UPPERSEC });
  legacy.addStudentToState(state, student);
  legacy.addCourseToState(state, course);
  legacy.enrollStudentInCourse(state, course.id, student.id);
  return { legacy, state, student, course };
}

test('Wave 3.1 finalized term results preserve success and rejection behavior', () => {
  const { legacy, state, student, course } = upperSecFixture();
  const mod = loadAssessments();
  const directState = serializable(state);
  assert.equal(mod.setTermResult(directState, course.id, student.id, '2025-H1', 12), 12);
  assert.equal(mod.getTermResult(directState.courses[0], student.id, '2025-H1'), 12);
  assert.equal(legacy.setTermResult(state, course.id, student.id, '2025-H1', 15), mod.setTermResult(directState, course.id, student.id, '2025-H1', 15));
  assert.equal(state.courses[0].termResults.length, 1);
  assert.equal(directState.courses[0].termResults.length, 1);
  assert.deepEqual(serializable(directState.courses[0].termResults), serializable(state.courses[0].termResults));
  assert.equal(legacy.setTermResult(state, course.id, student.id, '2025-H1', null), mod.setTermResult(directState, course.id, student.id, '2025-H1', null));
  assert.equal(state.courses[0].termResults.length, 0);
  assert.equal(directState.courses[0].termResults.length, 0);
  assert.equal(legacy.getTermResult(state.courses[0], student.id, '2025-H1'), null);
  assert.equal(mod.getTermResult(directState.courses[0], student.id, '2025-H1'), null);
  const invalid = [-1, 16, 11.5, NaN, '11'];
  for (const value of invalid) {
    const expected = thrownMessage(() => legacy.setTermResult(state, course.id, student.id, '2025-H1', value));
    const actual = thrownMessage(() => mod.setTermResult(directState, course.id, student.id, '2025-H1', value));
    assert.equal(actual, expected);
  }
  for (const [courseId, studentId, term] of [[course.id, student.id, 'Q1'], [course.id, 'unknown', '2025-H1']]) {
    const expected = thrownMessage(() => legacy.setTermResult(state, courseId, studentId, term, 11));
    const actual = thrownMessage(() => mod.setTermResult(directState, courseId, studentId, term, 11));
    assert.equal(actual, expected);
  }
  const unenrolledLegacy = upperSecFixture();
  const unenrolledDirect = serializable(unenrolledLegacy.state);
  const notEnrolled = unenrolledLegacy.legacy.createStudent({ firstName: 'Nicht', lastName: 'Eingeschrieben' });
  unenrolledLegacy.legacy.addStudentToState(unenrolledLegacy.state, notEnrolled);
  unenrolledDirect.students.push(serializable(notEnrolled));
  assert.equal(
    thrownMessage(() => mod.setTermResult(unenrolledDirect, unenrolledLegacy.course.id, notEnrolled.id, '2025-H1', 11)),
    thrownMessage(() => unenrolledLegacy.legacy.setTermResult(unenrolledLegacy.state, unenrolledLegacy.course.id, notEnrolled.id, '2025-H1', 11))
  );
  const sekILegacy = upperSecFixture();
  const sekIDirect = serializable(sekILegacy.state);
  const sekI = sekILegacy.legacy.createCourse({ name: 'Sek I', schemaMode: sekILegacy.legacy.SCHEMA_MODES.GRADES });
  sekILegacy.legacy.addCourseToState(sekILegacy.state, sekI);
  sekIDirect.courses.push(serializable(sekI));
  assert.equal(
    thrownMessage(() => mod.setTermResult(sekIDirect, sekI.id, sekILegacy.student.id, '2025-H1', 11)),
    thrownMessage(() => sekILegacy.legacy.setTermResult(sekILegacy.state, sekI.id, sekILegacy.student.id, '2025-H1', 11))
  );
  const archivedLegacy = upperSecFixture();
  const archivedDirect = serializable(archivedLegacy.state);
  archivedLegacy.legacy.archiveCourse(archivedLegacy.state, archivedLegacy.course.id, 'manual', {});
  const archivedCourse = archivedDirect.courses[0];
  archivedCourse.archivedAt = archivedLegacy.state.courses[0].archivedAt;
  assert.equal(
    thrownMessage(() => mod.setTermResult(archivedDirect, archivedLegacy.course.id, archivedLegacy.student.id, '2025-H1', 11)),
    thrownMessage(() => archivedLegacy.legacy.setTermResult(archivedLegacy.state, archivedLegacy.course.id, archivedLegacy.student.id, '2025-H1', 11))
  );
});
