'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadLegacyGrading } = require('./harness/load-legacy-grading.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

const FIXED_INSTANT = '2026-02-15T12:00:00.000Z';

function fixedDateClass(instant = FIXED_INSTANT) {
  const fixedMillis = Date.parse(instant);
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixedMillis]));
    }

    static now() {
      return fixedMillis;
    }
  };
}

function loadPair(instant = FIXED_INSTANT, options = {}) {
  const FixedDate = fixedDateClass(instant);
  const legacyModules = loadLegacyGrading({ seed: 83, dateImpl: FixedDate });
  const { exports } = loadEsmGraph('src/domain/grading-logic.js', {
    globals: { Date: FixedDate }
  });
  const now = options.now || (() => new FixedDate());
  return {
    FixedDate,
    legacy: legacyModules.GradingLogic,
    legacyModules,
    createGradingLogic: exports.createGradingLogic,
    modern: exports.createGradingLogic({ now, diagnostics: options.diagnostics })
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function scopeSummary(scope) {
  return {
    allAssessmentIds: Array.from(scope.allAssessments, item => item.id),
    assessmentIds: Array.from(scope.assessments, item => item.id),
    assessmentTerms: Array.from(scope.assessmentTerms, ([item, term]) => [item.id, term]),
    currentTerm: scope.currentTerm,
    includedTerms: Array.from(scope.includedTerms),
    previousTerm: scope.previousTerm,
    settings: plain(scope.settings)
  };
}

function buildRepresentativeCase(modules) {
  const ctx = buildCourseState(modules, { studentCount: 2 });
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'H1-Leistung',
    term: '2025-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'H2-Leistung',
    term: '2025-H2'
  });
  setScore(modules, h1, ctx.students[0].id, '1');
  setScore(modules, h1, ctx.students[1].id, '2');
  setScore(modules, h2, ctx.students[0].id, '3');
  setScore(modules, h2, ctx.students[1].id, '4');
  return { ...ctx, h1, h2 };
}

// D4 adds one shared boundary helper while the frozen historical surface stays
// unchanged. Every older method keeps its order, identity contract and arity.
test('D4: facade adds the boundary helper without changing the historical surface', () => {
  const { createGradingLogic, legacy, modern } = loadPair();
  assert.deepEqual(
    Object.keys(modern).filter(name => name !== 'resolveSchoolYearBoundaries'),
    Object.keys(legacy)
  );
  assert.equal(Object.keys(modern).length, 21);
  assert.equal(typeof modern.resolveSchoolYearBoundaries, 'function');
  assert.deepEqual(Object.keys({ createGradingLogic }), ['createGradingLogic']);
  for (const name of Object.keys(legacy)) {
    assert.equal(typeof modern[name], 'function', name);
    assert.equal(modern[name].length, legacy[name].length, name);
  }
  assert.equal(Object.getPrototypeOf(modern).constructor.name, 'Object');
  assert.equal(Object.isExtensible(modern), true);
  modern.consumerMarker = 'mutable';
  assert.equal(modern.consumerMarker, 'mutable');
  delete modern.consumerMarker;
});

// Break caught: an incorrectly wired direct export or wrapper argument would
// diverge from the frozen application behavior on a real course/state graph.
test('all 20 facade methods preserve representative historical results', () => {
  const { FixedDate, legacy, legacyModules, modern } = loadPair();
  const ctx = buildRepresentativeCase(legacyModules);
  const settings = ctx.state.settings;
  const score = ctx.h1.scores[ctx.students[0].id];
  const scale = [{ label: '1' }, { label: '2' }, { label: '6' }];
  const thresholds = { '1': 90, '2': 60, '6': 0 };
  const date = new FixedDate(2026, 1, 15, 12, 0, 0);
  const calls = [
    ['parseGradeLabel', [' 2 ', settings.gradeMapping]],
    ['parseGradeMappingInput', ['2,5']],
    ['parseUpperSecPoints', ['12']],
    ['isValidRawForCourse', ['2', ctx.course, settings]],
    ['getNumericScoreForEntry', [score, ctx.course, settings]],
    ['getUpperSecGradeLabel', [12]],
    ['validatePercentageThresholds', [scale, thresholds, '6']],
    ['getSettingsForCourse', [ctx.course, ctx.state]],
    ['resolveAssessmentTermFromDateValue', [date, ctx.course, settings]],
    ['resolveUpperSecGradingContext', [ctx.course, ctx.students[0].id, '2025-H2', settings]],
    ['resolveUpperSecAssessmentWarning', [[ctx.h1, ctx.h2], ctx.course, ctx.students[0].id, '2025-H2', settings]],
    ['resolveEffectiveCategoryWeights', [ctx.course, ctx.students[0].id, '2025-H2', settings]],
    ['resolveAssessmentTermsForResult', [ctx.course, '2025-H2']],
    ['isSchoolYearResultTerm', [ctx.course, '2025-H2']],
    ['formatCourseTermLabel', ['2025-H2', ctx.course, settings, { fullStartYear: true }]],
    ['computeCategoryAverage', [[ctx.h1, ctx.h2], ctx.course, ctx.students[0].id, ctx.categoryIds.written, settings]],
    ['computeWeightedOverallForAssessments', [[ctx.h1, ctx.h2], ctx.course, ctx.students[0].id, settings, '2025-H2']],
    ['computeOverallGrade', [ctx.course, ctx.students[0].id, ctx.state, '2025-H2']],
    ['computeCourseStatistics', [ctx.course, ctx.state]]
  ];
  assert.equal(calls.length, 19);
  for (const [name, args] of calls) {
    assert.deepEqual(plain(modern[name](...args)), plain(legacy[name](...args)), name);
  }

  const modernScope = modern.resolveGradingResultScope(ctx.course, ctx.state, '2025-H2');
  const legacyScope = legacy.resolveGradingResultScope(ctx.course, ctx.state, '2025-H2');
  assert.deepEqual(scopeSummary(modernScope), scopeSummary(legacyScope));
  assert.strictEqual(modernScope.allAssessments[0], ctx.h1);
  assert.strictEqual(Array.from(modernScope.assessmentTerms.keys())[1], ctx.h2);
});

// Break caught: factory setup must stay side-effect free and reject an absent
// clock before any consumer state can be touched.
test('facade requires a clock and does not read time or diagnostics during construction', () => {
  const FixedDate = fixedDateClass();
  const { exports } = loadEsmGraph('src/domain/grading-logic.js', { globals: { Date: FixedDate } });
  for (const options of [undefined, {}, { now: null }, { now: 1 }]) {
    assert.throws(() => exports.createGradingLogic(options), {
      name: 'TypeError', message: 'now muss eine Funktion sein.'
    });
  }

  let clockCalls = 0;
  const diagnostics = {};
  Object.defineProperties(diagnostics, {
    assessment: { get() { throw new Error('diagnostics read during construction'); } },
    result: { get() { throw new Error('diagnostics read during construction'); } }
  });
  const facade = exports.createGradingLogic({
    now: () => { clockCalls++; return new FixedDate(); },
    diagnostics
  });
  assert.equal(clockCalls, 0);
  const scope = facade.resolveGradingResultScope(
    { id: 'c', schemaMode: 'grades' },
    { assessments: [], settings: {} },
    '2026-H2'
  );
  assert.equal(scope.currentTerm, '2026-H2');
  assert.equal(clockCalls, 0);
});

// Break caught: wrapper defaults must forward the injected clock and observer
// per calculation, while explicit and historical terms stay clock-free.
test('time-aware wrappers preserve explicit, fallback, archive and statistics paths', () => {
  const FixedDate = fixedDateClass();
  let clockCalls = 0;
  const events = [];
  const { legacyModules, modern } = loadPair(FIXED_INSTANT, {
    now: () => { clockCalls++; return new FixedDate(); },
    diagnostics: {
      assessment(scope, course, assessment) {
        events.push(['assessment', scope.currentTerm, course.id, assessment.id]);
      },
      result(course, result) {
        events.push(['result', course.id, result]);
      }
    }
  });
  const ctx = buildRepresentativeCase(legacyModules);

  assert.equal(modern.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H2'), 2);
  assert.equal(clockCalls, 0);
  assert.deepEqual(events.map(event => event[0]), ['assessment', 'assessment', 'result']);

  events.length = 0;
  modern.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state);
  assert.equal(clockCalls, 1);
  assert.deepEqual(events.map(event => event[0]), ['assessment', 'assessment', 'result']);

  ctx.course.archivedAt = '2026-07-01T00:00:00.000Z';
  events.length = 0;
  modern.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state);
  assert.equal(clockCalls, 1);
  assert.deepEqual(events.map(event => event[0]), ['assessment', 'assessment', 'result']);

  ctx.course.archivedAt = null;
  events.length = 0;
  const statistics = modern.computeCourseStatistics(ctx.course, ctx.state);
  assert.equal(statistics.count, 2);
  assert.equal(clockCalls, 3);
  assert.deepEqual(events.map(event => event[0]), [
    'assessment', 'assessment', 'result',
    'assessment', 'assessment', 'result'
  ]);
});
