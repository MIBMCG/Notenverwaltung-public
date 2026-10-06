'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadModules } = require('./harness/load.js');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

const modules = loadModules();
const { GradingLogic } = modules;

function statisticsForSingleGrade(raw) {
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const asm = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1' });
  setScore(modules, asm, ctx.students[0].id, raw);
  return GradingLogic.computeCourseStatistics(ctx.course, ctx.state);
}

function bucketTotal(stats) {
  return (stats.distribution || []).reduce((sum, bucket) => sum + bucket.count, 0);
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

function loadOverallMetricLabel(modules) {
  const source = `${extractFunction(readSourceLines(), 'getOverallMetricLabel')}\n` +
    'globalThis.__label = getOverallMetricLabel;';
  vm.runInContext(source, modules.sandbox, { filename: 'getOverallMetricLabel.js' });
  return modules.sandbox.__label;
}

test('computeCourseStatistics counts a gradeable student', () => {
  const stats = statisticsForSingleGrade('3');
  assert.equal(stats.count, 1);
  // Ein Kurs ohne Gewichtungsvorlage rechnet gleichverteilt ueber die aktiven
  // Kategorien; nur "Schriftlich" hat Daten, also ist das Ergebnis exakt 3.
  assert.equal(stats.mean, 3);
  assert.equal(stats.median, 3);
  assert.equal(bucketTotal(stats), 1);
});

test('H6: a student graded 1+ must appear in the distribution', () => {
  const stats = statisticsForSingleGrade('1+');
  assert.equal(stats.count, 1);
  assert.equal(bucketTotal(stats), 1, 'Durchschnitt 0,7 faellt in keinen Bereich');
});

test('H6: every counted student lands in exactly one bucket', () => {
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const first = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1' });
  const second = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S2' });
  const third = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S3' });
  setScore(modules, first, ctx.students[0].id, '1-');
  setScore(modules, second, ctx.students[0].id, '2-');
  setScore(modules, third, ctx.students[0].id, '2-');
  const stats = GradingLogic.computeCourseStatistics(ctx.course, ctx.state);
  assert.equal(bucketTotal(stats), stats.count, 'Durchschnitt 1,9667 faellt in keinen Bereich');
});

test('H6: upper-secondary decimal averages cannot fall into a micro-gap', () => {
  const ctx = buildCourseState(modules, { studentCount: 1 });
  ctx.course.schemaMode = modules.DomainModel.SCHEMA_MODES.UPPERSEC;
  const lower = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Klausur 1', weight: 1.0002
  });
  const upper = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Klausur 2', weight: 1
  });
  setScore(modules, lower, ctx.students[0].id, '4');
  setScore(modules, upper, ctx.students[0].id, '5');

  const stats = GradingLogic.computeCourseStatistics(ctx.course, ctx.state);

  assert.equal(stats.count, 1);
  assert.ok(stats.mean > 4.4999 && stats.mean < 4.5, `unerwarteter Testmittelwert ${stats.mean}`);
  assert.equal(bucketTotal(stats), 1, 'Sek-II-Mittelwert faellt in die Luecke vor 4,5');
});

test('an empty course returns a well-formed zero result', () => {
  const ctx = buildCourseState(modules, { studentCount: 0 });
  const stats = GradingLogic.computeCourseStatistics(ctx.course, ctx.state);
  assert.equal(stats.count, 0);
  assert.ok(Array.isArray(stats.distribution));
});

test('current upper-secondary statistics exclude populated next-term assessments', () => {
  const currentModules = loadModules({ dateImpl: fixedDateClass('2026-09-15') });
  const ctx = buildCourseState(currentModules, { schemaMode: 'uppersec', studentCount: 2 });
  ctx.course.upperSecContext = {
    courseType: currentModules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: currentModules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
  const current = addAssessment(currentModules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q1-Leistung', date: '2026-09-15', term: '2026-H1'
  });
  const next = addAssessment(currentModules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q2-Leistung', date: '2027-03-15', term: '2026-H2'
  });
  setScore(currentModules, current, ctx.students[0].id, '12');
  setScore(currentModules, current, ctx.students[1].id, '6');
  setScore(currentModules, next, ctx.students[0].id, '10');
  setScore(currentModules, next, ctx.students[1].id, '4');

  const stats = currentModules.GradingLogic.computeCourseStatistics(ctx.course, ctx.state);

  assert.equal(stats.count, 2);
  assert.equal(stats.mean, 9);
  assert.deepEqual(Array.from(stats.values), [6, 12]);
});

test('M32: upper-sec statistics explicitly describe calculated values', () => {
  const source = extractFunction(readSourceLines(), 'renderStatsSection');
  assert.match(source, /Rechenwert/);
  assert.doesNotMatch(source, /Mittelwert \(Gesamtpunkte\)/);
});

test('M32: overall metric labels distinguish Sek-I grades from Sek-II calculated values', () => {
  const modules = loadModules();
  const label = loadOverallMetricLabel(modules);
  assert.equal(label('grades', 'mean'), 'Mittelwert (Gesamtnoten)');
  assert.equal(label('uppersec', 'mean'), 'Mittelwert (Rechenwerte)');
  assert.equal(label('uppersec', 'median'), 'Median (Rechenwerte)');
  assert.equal(label('uppersec', 'distribution'), 'Verteilung Rechenwerte');
  assert.equal(label('uppersec', 'combined'), 'Rechenwert inkl. Vorhalbjahr');
  assert.equal(label('grades', 'combined'), 'Gesamtnote inkl. Vorhalbjahr');
});

test('M32 final review: schema-aware value nouns drive course settings and at-risk output', () => {
  const modules = loadModules();
  const label = loadOverallMetricLabel(modules);
  assert.equal(label('grades', 'value'), 'Gesamtnote');
  assert.equal(label('grades', 'plural'), 'Gesamtnoten');
  assert.equal(label('uppersec', 'value'), 'Rechenwert');
  assert.equal(label('uppersec', 'plural'), 'Rechenwerte');

  const lines = readSourceLines();
  const courses = extractFunction(lines, 'renderCoursesSection');
  const hintStart = courses.indexOf('const smallHint');
  const enrolledStart = courses.indexOf('// --- Schüler im Kurs anzeigen', hintStart);
  assert.match(
    courses.slice(hintStart, enrolledStart),
    /getOverallMetricLabel\(currentCourse\.schemaMode,\s*['"]plural['"]\)/
  );

  const statistics = extractFunction(lines, 'renderStatsSection');
  const riskHeaderStart = statistics.indexOf('const atRiskThead');
  const riskBodyStart = statistics.indexOf('const atRiskTbody', riskHeaderStart);
  assert.match(
    statistics.slice(riskHeaderStart, riskBodyStart),
    /getOverallMetricLabel\(data\.course\.schemaMode,\s*['"]value['"]\)/
  );
});

test('M31: statistics keep the upper-sec calculated-value terminology without exposing weighting reasons', () => {
  const statistics = extractFunction(readSourceLines(), 'renderStatsSection');
  assert.match(statistics, /Rechenwert/);
  assert.doesNotMatch(statistics, /weightingDeviationReason/);
});
