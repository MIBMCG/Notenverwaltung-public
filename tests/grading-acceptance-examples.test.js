'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

// Hand-calculated acceptance examples, documented in the report of 2026-09-13.
// Expected values are independent arithmetic, not copied legacy calculations.
const modules = loadModules();
const { DomainModel: D, GradingLogic: G } = modules;
const H1 = '2026-H1';
const H2 = '2026-H2';
const now = () => new Date('2027-03-15T12:00:00');
const near = (actual, expected) => {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
};
function score(ctx, category, raw, term = H2, weight = 1, studentIndex = 0, status) {
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds[category], term, weight
  });
  setScore(modules, assessment, ctx.students[studentIndex].id, raw, status);
  return assessment;
}
function overall(ctx, studentIndex = 0, term = H2) {
  return G.computeOverallGrade(ctx.course, ctx.students[studentIndex].id, ctx.state, term, now);
}
function upper(courseType = 'basic') {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  ctx.course.upperSecContext = { courseType, qualificationYear: 'q3-q4', weightingDeviationReason: null };
  ctx.course.weightTemplateId = D.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  for (let index = 0; index < 2; index++) {
    score(ctx, 'written', '15', H2, 1, index);
    score(ctx, 'oral', '9', H2, 1, index);
    score(ctx, 'other', '3', H2, 1, index);
    score(ctx, 'written', '1', H1, 1, index);
    score(ctx, 'oral', '1', H1, 1, index);
    score(ctx, 'other', '1', H1, 1, index);
  }
  return ctx;
}

test('acceptance: unequal assessment weights across H1/H2 pool into 17/6, not the mean of half-years', () => {
  const ctx = buildCourseState(modules);
  ctx.state.settings.weightTemplates.push({ id: 'acceptance-half', items: [
    { categoryId: ctx.categoryIds.written, weightPercent: 50 },
    { categoryId: ctx.categoryIds.oral, weightPercent: 50 }
  ] });
  ctx.course.weightTemplateId = 'acceptance-half';
  score(ctx, 'written', '2', H1, 1);
  score(ctx, 'written', '4', H1, 3);
  score(ctx, 'oral', '1', H1, 1);
  score(ctx, 'written', '1', H2, 2);
  score(ctx, 'oral', '5', H2, 1);
  score(ctx, 'oral', '3', H2, 3);
  // Different school years must not leak into either half or the annual result.
  score(ctx, 'written', '6', '2025-H2', 100);
  score(ctx, 'oral', '6', '2027-H1', 100);
  near(overall(ctx, 0, H1), 2.25); // written 3.5; oral 1.
  const h2Only = ctx.state.assessments.filter(item => item.term === H2);
  near(G.computeWeightedOverallForAssessments(h2Only, ctx.course,
    ctx.students[0].id, ctx.state.settings, H2), 2.25); // written 1; oral 3.5.
  near(overall(ctx), 17 / 6); // written 16/6; oral 15/5; each 50%.
  assert.equal(overall(ctx, 1), null, 'an entirely empty person has no result');
});

test('acceptance: an empty category is excluded from the denominator, while a second person stays empty', () => {
  const ctx = buildCourseState(modules);
  ctx.course.weightTemplateId = D.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKI_EXAMPLE;
  score(ctx, 'written', '');
  score(ctx, 'oral', '3');
  score(ctx, 'other', '5');
  near(overall(ctx), 3.4); // (3*40 + 5*10) / (40+10).
  assert.equal(overall(ctx, 1), null);
});

test('acceptance: mixed Q4 GK excludes exams per person and keeps unequal general category proportions', () => {
  const ctx = upper();
  D.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.students[0].id, true);
  near(overall(ctx, 0), 10.3998); // (15*33.33 + 9*56.67 + 3*10)/100.
  near(overall(ctx, 1), 540.03 / 66.67); // Only general categories; still 56.67:10.
  near(overall(ctx, 0, H1), 1);
  near(overall(ctx, 1, H1), 1);
  const preserved = ctx.state.assessments.find(item => item.term === H2 &&
    item.categoryId === ctx.categoryIds.written && item.scores[ctx.students[1].id]);
  assert.equal(preserved.scores[ctx.students[1].id].valueRaw, '15');
});

test('acceptance: LK Q4 recommends one exam but keeps the selected weighting until explicitly changed', () => {
  const ctx = upper('advanced');
  ctx.course.weightTemplateId = D.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  const context = G.resolveUpperSecGradingContext(ctx.course, ctx.students[0].id, H2, ctx.state.settings);
  assert.equal(context.expectedExamCount, 1);
  assert.equal(context.isWeightingDeviation, true);
  near(overall(ctx), 11.4); // selected 50:40:10.
  ctx.course.weightTemplateId = D.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  near(overall(ctx), 10.3998); // explicitly changed 33.33:56.67:10.
});

test('acceptance: LK Q3 zero-point exams produce 5, missed exams produce 10, both require a manual decision', () => {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec' });
  ctx.course.upperSecContext = { courseType: 'advanced', qualificationYear: 'q3-q4' };
  ctx.course.weightTemplateId = D.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  for (let index = 0; index < 2; index++) {
    score(ctx, 'oral', '10', H1, 1, index);
    score(ctx, 'other', '10', H1, 1, index);
  }
  for (let exam = 0; exam < 2; exam++) {
    const assessment = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: H1 });
    assessment.scores[ctx.students[0].id] = D.createScoreEntry({ valueRaw: '0', valueNumeric: 0, status: D.SCORE_STATUS.VALID });
    assessment.scores[ctx.students[1].id] = D.createScoreEntry({ status: D.SCORE_STATUS.MISSING });
  }
  near(overall(ctx, 0, H1), 5);
  near(overall(ctx, 1, H1), 10);
  for (const student of ctx.students) {
    assert.equal(G.resolveUpperSecAssessmentWarning(ctx.state.assessments, ctx.course,
      student.id, H1, ctx.state.settings).requiresManualDecision, true);
    assert.equal(D.getTermResult(ctx.course, student.id, H1), null);
  }
});

test('acceptance: a fixed zero survives normalization independently of the computed Q4 result', () => {
  const ctx = upper('advanced');
  D.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, H2, 0);
  const restored = D.ensureStateShape(JSON.parse(JSON.stringify(ctx.state)));
  const course = restored.courses.find(item => item.id === ctx.course.id);
  near(G.computeOverallGrade(course, ctx.students[0].id, restored, H2, now), 10.3998);
  assert.equal(D.getTermResult(course, ctx.students[0].id, H2), 0);
  assert.equal(D.getTermResult(course, ctx.students[0].id, H1), null);
  assert.equal(D.getTermResult(course, ctx.students[1].id, H2), null);
});
