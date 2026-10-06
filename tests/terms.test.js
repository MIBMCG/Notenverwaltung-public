'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');

const modules = loadModules();
const { DomainModel, GradingLogic } = modules;

// Evaluate the standalone helper in its own tiny context.
function loadRecalc() {
  const lines = readSourceLines();
  const source = extractFunction(lines, 'parseHalfYearDateValue') + '\n' +
    extractFunction(lines, 'recalcAssessmentTermsForCurrentState')
    + '\nglobalThis.__fn = recalcAssessmentTermsForCurrentState;';
  const context = {
    resolveAssessmentTermFromDateValue: GradingLogic.resolveAssessmentTermFromDateValue,
    parseCalendarDate: modules.sandbox.parseCalendarDate,
    calendarDateToLocalDate: modules.sandbox.calendarDateToLocalDate,
    console: { log() {}, warn() {}, error() {}, debug() {} }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__fn;
}

const recalc = loadRecalc();

// Extract UiShell helpers in the same module sandbox so their GradingLogic
// dependency remains the real application implementation.
function loadUiTermHelper(name, modules) {
  const source = `${extractFunction(readSourceLines(), name)}\n` +
    `globalThis.__termHelper = ${name};`;
  vm.runInContext(source, modules.sandbox, { filename: `${name}.js` });
  return modules.sandbox.__termHelper;
}

function fixedDateClass(isoDate) {
  const RealDate = Date;
  const fixedMillis = new RealDate(`${isoDate}T12:00:00`).getTime();
  return class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMillis]));
    }
    static now() { return fixedMillis; }
  };
}

// Default half-year settings: school year starts 08.09., H1 ends 30.01.,
// H2 starts 09.02. A date in November therefore belongs to H1 of that
// school year, and a date in January to H1 of the *previous* calendar year.
const CANONICAL_CASES = [
  { date: '2025-11-15', expected: '2025-H1' },
  { date: '2026-01-20', expected: '2025-H1' },
  { date: '2026-03-01', expected: '2025-H2' },
  { date: '2025-09-10', expected: '2025-H1' }
];

test('display term labels use German collation for mixed course contexts', () => {
  const modules = loadModules();
  const courses = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const labels = new Map([
    ['a', 'Zora'], ['b', 'Ordnung'], ['c', 'Änne'], ['d', 'Ökologie']
  ]);
  const original = modules.GradingLogic.formatCourseTermLabel;
  modules.GradingLogic.formatCourseTermLabel = (_term, course) => labels.get(course && course.id) || '';
  try {
    const format = loadUiTermHelper('formatTermLabelForCourses', modules);
    assert.equal(format('2025-H1', courses, {}), 'Änne / Ökologie / Ordnung / Zora');
  } finally {
    modules.GradingLogic.formatCourseTermLabel = original;
  }
});

test('the canonical derivation is school-year aware', () => {
  for (const testCase of CANONICAL_CASES) {
    const state = DomainModel.createEmptyState();
    const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
    DomainModel.addCourseToState(state, course);
    const asm = DomainModel.createAssessment({
      courseId: course.id, categoryId: state.settings.categories[0].id,
      title: 'S1', date: testCase.date, term: null, termAssignment: 'auto'
    });
    DomainModel.addAssessmentToState(state, asm);
    recalc(state);
    assert.equal(asm.term, testCase.expected, `Datum ${testCase.date}`);
  }
});

test('K1: archived courses keep their stored term', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Archivkurs', subject: 'Testfach', classLabel: 'T2' });
  DomainModel.addCourseToState(state, course);
  const asm = DomainModel.createAssessment({
    courseId: course.id, categoryId: state.settings.categories[0].id,
    title: 'Historische Leistung', date: '2026-02-05', term: '2025-H1', termAssignment: 'auto'
  });
  DomainModel.addAssessmentToState(state, asm);
  DomainModel.archiveCourse(state, course.id, 'manual', {});

  // Global cut-offs move after archiving.
  state.settings.halfYearSettings.seckI.h2StartMonth = 2;
  state.settings.halfYearSettings.seckI.h2StartDay = 1;

  recalc(state);
  assert.equal(asm.term, '2025-H1', 'archivierte Leistung wurde umgeschrieben');
});

test('an assessment without a date keeps a manually assigned term', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  const asm = DomainModel.createAssessment({
    courseId: course.id, categoryId: state.settings.categories[0].id,
    title: 'S1', date: null, term: '2024-H2', termAssignment: 'manual'
  });
  DomainModel.addAssessmentToState(state, asm);
  recalc(state);
  assert.equal(asm.term, '2024-H2');
});

test('R07: recalculation changes only active automatic terms and preserves manual and archived assignments', () => {
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckI.h2StartMonth = 3;
  state.settings.halfYearSettings.seckI.h2StartDay = 1;
  const activeCourse = DomainModel.createCourse({ id: 'course_r07_active', name: 'Aktiv' });
  const archivedCourse = DomainModel.createCourse({ id: 'course_r07_archive', name: 'Archiv' });
  DomainModel.addCourseToState(state, activeCourse);
  DomainModel.addCourseToState(state, archivedCourse);
  const categoryId = state.settings.categories[0].id;
  const manual = DomainModel.createAssessment({
    id: 'assessment_r07_manual', courseId: activeCourse.id, categoryId,
    title: 'Manuell', date: '2026-02-05', term: '2025-H2', termAssignment: 'manual'
  });
  const automatic = DomainModel.createAssessment({
    id: 'assessment_r07_auto', courseId: activeCourse.id, categoryId,
    title: 'Automatisch', date: '2026-02-05', term: '2025-H2', termAssignment: 'auto'
  });
  const archivedAutomatic = DomainModel.createAssessment({
    id: 'assessment_r07_archived', courseId: archivedCourse.id, categoryId,
    title: 'Archiviert', date: '2026-02-05', term: '2025-H2', termAssignment: 'auto'
  });
  for (const assessment of [manual, automatic, archivedAutomatic]) {
    DomainModel.addAssessmentToState(state, assessment);
  }
  DomainModel.archiveCourse(state, archivedCourse.id, 'manual', {});

  recalc(state);

  assert.deepEqual(
    [manual.term, manual.termAssignment, automatic.term, automatic.termAssignment,
      archivedAutomatic.term, archivedAutomatic.termAssignment],
    ['2025-H2', 'manual', '2025-H1', 'auto', '2025-H2', 'auto']
  );
});

test('R07: automatic recalculation keeps the browser calendar day in a negative UTC timezone', () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(new Date('2026-02-05').getDate(), 4, 'negative UTC offset is not active');
    const state = DomainModel.createEmptyState();
    Object.assign(state.settings.halfYearSettings.seckI, {
      schoolYearStartYear: 2025,
      schoolYearStartMonth: 9,
      schoolYearStartDay: 1,
      h1EndYear: 2026,
      h1EndMonth: 2,
      h1EndDay: 4,
      h2StartYear: 2026,
      h2StartMonth: 2,
      h2StartDay: 5
    });
    const course = DomainModel.createCourse({ id: 'course_r07_timezone', name: 'Kalendertag' });
    DomainModel.addCourseToState(state, course);
    const assessment = DomainModel.createAssessment({
      id: 'assessment_r07_timezone',
      courseId: course.id,
      categoryId: state.settings.categories[0].id,
      title: 'Grenztag',
      date: '2026-02-05',
      term: '2025-H1',
      termAssignment: 'auto'
    });
    DomainModel.addAssessmentToState(state, assessment);

    recalc(state);

    assert.equal(assessment.term, '2025-H2');
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('M31: result term scopes separate Sek II and combine a Sek-I school year only at H2', () => {
  const upperSec = DomainModel.createCourse({
    name: 'Sek II', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' },
    includePrevTermGrades: true
  });
  const sekI = DomainModel.createCourse({ name: 'Sek I', includePrevTermGrades: false });

  assert.deepEqual(
    Array.from(GradingLogic.resolveAssessmentTermsForResult(upperSec, '2026-H1')),
    ['2026-H1']
  );
  assert.deepEqual(
    Array.from(GradingLogic.resolveAssessmentTermsForResult(upperSec, '2026-H2')),
    ['2026-H2']
  );
  assert.deepEqual(
    Array.from(GradingLogic.resolveAssessmentTermsForResult(sekI, '2026-H1')),
    ['2026-H1']
  );
  assert.deepEqual(
    Array.from(GradingLogic.resolveAssessmentTermsForResult(sekI, '2026-H2')),
    ['2026-H2', '2026-H1']
  );
});

test('M5: missing undated terms use each course level and H2-start priority', () => {
  const { DomainModel } = loadModules({ dateImpl: fixedDateClass('2026-01-15') });
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckI.h2StartMonth = 2;
  state.settings.halfYearSettings.seckI.h2StartDay = 10;
  state.settings.halfYearSettings.seckII.h2StartMonth = 1;
  state.settings.halfYearSettings.seckII.h2StartDay = 5;

  const sekI = DomainModel.createCourse({ name: 'Sek I', schemaMode: DomainModel.SCHEMA_MODES.GRADES });
  const sekII = DomainModel.createCourse({ name: 'Sek II', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC });
  DomainModel.addCourseToState(state, sekI);
  DomainModel.addCourseToState(state, sekII);
  const assessments = [sekI, sekII].map((course, index) => DomainModel.createAssessment({
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: `A${index}`,
    date: null,
    term: null
  }));
  assessments.forEach(assessment => DomainModel.addAssessmentToState(state, assessment));

  DomainModel.ensureStateShape(state);

  assert.equal(assessments[0].term, '2025-H1');
  assert.equal(assessments[1].term, '2025-H2');
});

test('M5: an archived undated assessment uses frozen half-year cutoffs', () => {
  const { DomainModel } = loadModules({ dateImpl: fixedDateClass('2026-01-15') });
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckII.h2StartMonth = 2;
  state.settings.halfYearSettings.seckII.h2StartDay = 10;
  const course = DomainModel.createCourse({
    name: 'Archiv Sek II', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
  });
  DomainModel.addCourseToState(state, course);
  const assessment = DomainModel.createAssessment({
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: 'Ohne Datum', date: null, term: null
  });
  DomainModel.addAssessmentToState(state, assessment);
  DomainModel.archiveCourse(state, course.id, 'manual', {});
  state.settings.halfYearSettings.seckII.h2StartMonth = 1;
  state.settings.halfYearSettings.seckII.h2StartDay = 5;
  state.settings.halfYearSettings.seckI.h2StartMonth = 1;
  state.settings.halfYearSettings.seckI.h2StartDay = 5;
  state.settings.halfYearSettings.seckI.h1EndDay = 10;

  DomainModel.ensureStateShape(state);

  assert.equal(assessment.term, '2025-H1');
});

test('M7: gradesheet term derivation uses archived snapshot cutoffs', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckII.h2StartMonth = 3;
  state.settings.halfYearSettings.seckII.h2StartDay = 1;
  const course = modules.DomainModel.createCourse({
    name: 'Archiv Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  state.settings.halfYearSettings.seckII.h2StartMonth = 1;
  state.settings.halfYearSettings.seckII.h2StartDay = 1;

  const derive = loadUiTermHelper('resolveGradesheetTermFromDateValue', modules);
  assert.equal(derive(new modules.sandbox.Date('2026-02-01'), course, state), '2025-H1');
});

test('M7: gradesheet labels use archived snapshot names', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.settings.halfYearNames.seckI.h1 = 'Archiv-H1';
  const course = modules.DomainModel.createCourse({ name: 'Archiv Sek I' });
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  state.settings.halfYearNames.seckI.h1 = 'Neu-H1';

  const format = loadUiTermHelper('formatGradesheetTermLabel', modules);
  assert.equal(format('2025-H1', course, state), '25/26 Archiv-H1');
});
