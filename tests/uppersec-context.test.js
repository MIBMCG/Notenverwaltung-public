'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');

const { DomainModel, GradingLogic } = loadModules();
const UPPERSEC = DomainModel.SCHEMA_MODES.UPPERSEC;

function upperSecCourse(context = null, extra = {}) {
  return DomainModel.createCourse({
    name: 'Synthetischer Oberstufenkurs',
    subject: 'Biologie',
    classLabel: 'Q-Test',
    schemaMode: UPPERSEC,
    upperSecContext: context,
    ...extra
  });
}

function stateWithEnrollment(context, { writtenExamSubjectQ4 = false } = {}) {
  const state = DomainModel.createEmptyState();
  const course = upperSecCourse(context);
  const student = DomainModel.createStudent({ lastName: 'Testperson', firstName: 'Ada' });
  DomainModel.addCourseToState(state, course);
  DomainModel.addStudentToState(state, student);
  DomainModel.enrollStudentInCourse(state, course.id, student.id);
  course.enrollments[0].writtenExamSubjectQ4 = writtenExamSubjectQ4;
  return { state, course, student };
}

test('new Sek-I courses have no upper-secondary context', () => {
  const course = DomainModel.createCourse({ name: 'Sek-I-Kurs', subject: 'Test', classLabel: '9a' });
  assert.equal(course.upperSecContext, null);
});

test('configured Sek-II courses preserve normalized course context and reason', () => {
  const context = {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: '  Fachkonferenz-Beschluss  '
  };
  const course = upperSecCourse(context);
  assert.deepEqual(JSON.parse(JSON.stringify(course.upperSecContext)), {
    courseType: 'basic',
    qualificationYear: 'q3-q4',
    weightingDeviationReason: 'Fachkonferenz-Beschluss'
  });
});

test('legacy Sek-II courses without context remain loadable without guessing', () => {
  const raw = {
    version: 1,
    students: [],
    courses: [{ id: 'legacy-course', name: 'Alt', subject: 'Test', classLabel: 'Q', schemaMode: UPPERSEC }],
    assessments: [],
    settings: DomainModel.createEmptyState().settings
  };
  const state = DomainModel.ensureStateShape(raw);
  assert.equal(state.courses[0].upperSecContext, null);
});

test('old enrollments migrate the Q4 written-exam flag to false', () => {
  const state = DomainModel.ensureStateShape({
    version: 1,
    students: [{ id: 'student-1', lastName: 'Alt', firstName: 'Person' }],
    courses: [{
      id: 'course-1', name: 'Alt', subject: 'Test', classLabel: 'Q', schemaMode: UPPERSEC,
      enrollments: [{ studentId: 'student-1', subgroup: null, homeClassAtEnrollment: null }]
    }],
    assessments: [],
    settings: DomainModel.createEmptyState().settings
  });
  assert.equal(state.courses[0].enrollments[0].writtenExamSubjectQ4, false);
});

test('createEnrollment defaults and preserves the Q4 written-exam flag', () => {
  assert.equal(
    DomainModel.createEnrollment({ studentId: 'student-1' }).writtenExamSubjectQ4,
    false
  );
  assert.equal(
    DomainModel.createEnrollment({ studentId: 'student-1', writtenExamSubjectQ4: true }).writtenExamSubjectQ4,
    true
  );
});

test('invalid context enums are repaired to an explicitly incomplete context', () => {
  const course = upperSecCourse({
    courseType: 'honors',
    qualificationYear: 'q5-q6',
    weightingDeviationReason: 'Begruendung'
  });
  const state = DomainModel.ensureStateShape({
    ...DomainModel.createEmptyState(),
    courses: [course]
  });
  assert.equal(state.courses[0].upperSecContext.courseType, null);
  assert.equal(state.courses[0].upperSecContext.qualificationYear, null);
});

test('weighting-deviation reasons are trimmed and capped at 1000 characters', () => {
  const reason = `  ${'x'.repeat(1001)}  `;
  const course = upperSecCourse({
    courseType: 'basic',
    qualificationYear: 'q1-q2',
    weightingDeviationReason: reason
  });
  assert.equal(course.upperSecContext.weightingDeviationReason.length, 1000);
  assert.equal(course.upperSecContext.weightingDeviationReason, 'x'.repeat(1000));
});

test('Sek-I context and Q4 flags on unsuitable courses are inert', () => {
  const course = DomainModel.createCourse({
    name: 'Sek-I-Kurs', subject: 'Test', classLabel: '9a',
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: 'x' }
  });
  assert.equal(course.upperSecContext, null);
  const { state, course: upperCourse, student } = stateWithEnrollment({
    courseType: 'advanced', qualificationYear: 'q1-q2', weightingDeviationReason: null
  });
  assert.throws(
    () => DomainModel.setWrittenExamSubjectQ4(state, upperCourse.id, student.id, true),
    /Q3\/Q4|Grundkurs|erlaubt/i
  );
});

test('M31 final review: temporarily inactive Q4 flags stay stored but have no grading effect', () => {
  const { state, course, student } = stateWithEnrollment({
    courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null
  }, { writtenExamSubjectQ4: true });
  course.upperSecContext = {
    courseType: 'advanced', qualificationYear: 'q3-q4', weightingDeviationReason: null
  };

  const normalized = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state)));
  const normalizedCourse = DomainModel.findCourseById(normalized, course.id);
  assert.equal(
    DomainModel.findEnrollment(normalizedCourse, student.id).writtenExamSubjectQ4,
    true,
    'a reversible context edit must not erase the stored person-level decision'
  );
  const gradingContext = GradingLogic.resolveUpperSecGradingContext(
    normalizedCourse, student.id, '2026-H2', normalized.settings
  );
  assert.equal(gradingContext.expectedExamCount, 1, 'the inactive GK-only flag must not affect an LK Q4');
});

test('setWrittenExamSubjectQ4 changes only active Q3/Q4 basic-course enrollments', () => {
  const { state, course, student } = stateWithEnrollment({
    courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null
  });
  assert.equal(DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true), true);
  assert.equal(DomainModel.findEnrollment(state, course.id, student.id).writtenExamSubjectQ4, true);
  course.archivedAt = '2026-08-28T00:00:00.000Z';
  assert.throws(() => DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, false), /aktiv/i);
});

test('resolveQualificationPhase maps qualification section and canonical half-year', () => {
  const cases = [
    ['q1-q2', '2026-H1', 'Q1'], ['q1-q2', '2026-H2', 'Q2'],
    ['q3-q4', '2026-H1', 'Q3'], ['q3-q4', '2026-H2', 'Q4']
  ];
  for (const [qualificationYear, term, expected] of cases) {
    assert.equal(
      DomainModel.resolveQualificationPhase(
        upperSecCourse({ courseType: 'basic', qualificationYear, weightingDeviationReason: null }),
        term
      ),
      expected
    );
  }
  assert.equal(DomainModel.resolveQualificationPhase(DomainModel.createCourse({ name: 'Sek I' }), '2026-H1'), null);
});

test('resolveUpperSecGradingContext covers the complete GK/LK/other Q1-Q4 matrix', () => {
  const matrix = [
    ['GK Q1', 'basic', 'q1-q2', '2026-H1', false, 'Q1', 1, 33.33, 'wt_berlin_sekii_one_exam'],
    ['GK Q2', 'basic', 'q1-q2', '2026-H2', false, 'Q2', 1, 33.33, 'wt_berlin_sekii_one_exam'],
    ['LK Q1', 'advanced', 'q1-q2', '2026-H1', false, 'Q1', 2, 50, 'wt_berlin_sekii_two_exams'],
    ['LK Q2', 'advanced', 'q1-q2', '2026-H2', false, 'Q2', 2, 50, 'wt_berlin_sekii_two_exams'],
    ['GK Q3', 'basic', 'q3-q4', '2026-H1', false, 'Q3', 1, 33.33, 'wt_berlin_sekii_one_exam'],
    ['GK Q4 marked', 'basic', 'q3-q4', '2026-H2', true, 'Q4', 1, 33.33, 'wt_berlin_sekii_one_exam'],
    ['GK Q4 unmarked', 'basic', 'q3-q4', '2026-H2', false, 'Q4', 0, 0, null],
    ['LK Q3', 'advanced', 'q3-q4', '2026-H1', false, 'Q3', 2, 50, 'wt_berlin_sekii_two_exams'],
    ['LK Q4', 'advanced', 'q3-q4', '2026-H2', false, 'Q4', 1, 33.33, 'wt_berlin_sekii_one_exam'],
    ['other Q1', 'other', 'q1-q2', '2026-H1', false, 'Q1', null, null, null],
    ['other Q2', 'other', 'q1-q2', '2026-H2', false, 'Q2', null, null, null],
    ['other Q3', 'other', 'q3-q4', '2026-H1', false, 'Q3', null, null, null],
    ['other Q4', 'other', 'q3-q4', '2026-H2', false, 'Q4', null, null, null]
  ];
  const settings = DomainModel.createEmptyState().settings;
  for (const [label, courseType, qualificationYear, term, flag, phase, exams, percent, templateId] of matrix) {
    const { state, course, student } = stateWithEnrollment({ courseType, qualificationYear, weightingDeviationReason: null }, {
      writtenExamSubjectQ4: flag
    });
    const result = GradingLogic.resolveUpperSecGradingContext(course, student.id, term, settings);
    assert.equal(result.qualificationPhase, phase, label);
    assert.equal(result.expectedExamCount, exams, label);
    assert.equal(result.recommendedWrittenPercent, percent, label);
    assert.equal(result.recommendedWeightTemplateId, templateId, label);
    assert.ok(result.status, `${label}: maschinenlesbarer Status fehlt`);
    assert.ok(state, 'synthetischer State wird bewusst erzeugt');
  }
});

test('resolveUpperSecGradingContext marks missing or invalid context for review', () => {
  const state = DomainModel.createEmptyState();
  const course = upperSecCourse(null);
  const student = DomainModel.createStudent({ lastName: 'Alt', firstName: 'Person' });
  DomainModel.addCourseToState(state, course);
  DomainModel.addStudentToState(state, student);
  DomainModel.enrollStudentInCourse(state, course.id, student.id);
  const result = GradingLogic.resolveUpperSecGradingContext(
    course, student.id, '2026-H1', state.settings
  );
  assert.equal(result.status, 'needs-review');
  assert.equal(result.recommendedWrittenPercent, null);
});

test('M31: successor plan distinguishes Sek I, Q1/Q2, Q3/Q4 and incomplete Sek-II context', () => {
  const targetYear = 2027;
  const sekI = DomainModel.createCourse({ name: '9a Biologie', subject: 'Biologie', classLabel: '9a' });
  const q1q2 = upperSecCourse({ courseType: 'basic', qualificationYear: 'q1-q2', weightingDeviationReason: null });
  const q3q4 = upperSecCourse({ courseType: 'advanced', qualificationYear: 'q3-q4', weightingDeviationReason: null });
  const incomplete = upperSecCourse({ courseType: 'basic', qualificationYear: null, weightingDeviationReason: null });

  assert.deepEqual(JSON.parse(JSON.stringify(DomainModel.planCourseSuccessor(sekI, targetYear))), {
    action: 'continue', targetYear, targetQualificationYear: null,
    requiresWeightingConfirmation: false, label: 'wird fortgeführt'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(DomainModel.planCourseSuccessor(q1q2, targetYear))), {
    action: 'continue', targetYear, targetQualificationYear: 'q3-q4',
    requiresWeightingConfirmation: true, label: 'wird als Q3/Q4 fortgeführt'
  });
  assert.equal(DomainModel.planCourseSuccessor(q3q4, targetYear).action, 'end');
  assert.equal(DomainModel.planCourseSuccessor(q3q4, targetYear).label, 'endet');
  assert.equal(DomainModel.planCourseSuccessor(incomplete, targetYear).action, 'review');
  assert.equal(DomainModel.planCourseSuccessor(incomplete, targetYear).label, 'Kontext prüfen');
});

test('M31: Q1/Q2 successor becomes Q3/Q4 without flags or copied deviation reason', () => {
  const source = upperSecCourse({
    courseType: 'basic', qualificationYear: 'q1-q2', weightingDeviationReason: 'Nicht fortschreiben'
  }, {
    weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
    schoolYearStartYear: 2026
  });
  source.enrollments = [
    DomainModel.createEnrollment({ studentId: 'student-1', writtenExamSubjectQ4: true }),
    DomainModel.createEnrollment({ studentId: 'student-2', writtenExamSubjectQ4: true })
  ];

  const successor = DomainModel.createSuccessorCourseCandidate(source, 2027);
  assert.equal(successor.schoolYearStartYear, 2027);
  assert.equal(successor.carriedForwardFromCourseId, source.id);
  assert.equal(successor.upperSecContext.qualificationYear, 'q3-q4');
  assert.equal(successor.upperSecContext.courseType, 'basic');
  assert.equal(successor.upperSecContext.weightingDeviationReason, null);
  assert.equal(successor.weightTemplateId, null, 'the deviating source weighting must not be carried silently');
  assert.ok(successor.enrollments.every(enrollment => enrollment.writtenExamSubjectQ4 === false));
  assert.equal(successor.termResults.length, 0);
  assert.equal(DomainModel.planCourseSuccessor(source, 2027).requiresWeightingConfirmation, true);
});

test('M31: ending or review-required Sek-II courses cannot create automatic successors', () => {
  const ending = upperSecCourse({ courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null });
  const incomplete = upperSecCourse(null);
  assert.equal(DomainModel.createSuccessorCourseCandidate(ending, 2027), null);
  assert.equal(DomainModel.createSuccessorCourseCandidate(incomplete, 2027), null);
});
