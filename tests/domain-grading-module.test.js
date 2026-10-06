'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadLegacyGrading } = require('./harness/load-legacy-grading.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

const EXPORT_NAMES = [
  'computeCategoryAverage', 'computeCourseStatistics', 'computeOverallGrade',
  'computeWeightedOverallForAssessments', 'getNumericScoreForEntry', 'getUpperSecGradeLabel',
  'isValidRawForCourse', 'parseGradeLabel', 'parseGradeMappingInput', 'parseUpperSecPoints',
  'resolveEffectiveCategoryWeights', 'resolveUpperSecAssessmentWarning',
  'resolveUpperSecGradingContext', 'validatePercentageThresholds'
];

const EXPECTED_GRADE_VALUES = {
  '1+': 0.7, '1': 1, '1-': 1.3,
  '2+': 1.7, '2': 2, '2-': 2.3,
  '3+': 2.7, '3': 3, '3-': 3.3,
  '4+': 3.7, '4': 4, '4-': 4.3,
  '5+': 4.7, '5': 5, '5-': 5.3, '6': 6
};

function fixedDateClass(isoValue = '2026-01-15T12:00:00') {
  const RealDate = Date;
  const fixedMillis = new RealDate(isoValue).getTime();
  return class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMillis]));
    }

    static now() {
      return fixedMillis;
    }
  };
}

function loadPair(isoValue) {
  const FixedDate = fixedDateClass(isoValue);
  const { exports: grading } = loadEsmGraph('src/domain/grading.js', {
    globals: { Date: FixedDate }
  });
  const legacyModules = loadLegacyGrading({ seed: 31, dateImpl: FixedDate });
  return {
    FixedDate,
    grading,
    legacy: legacyModules.GradingLogic,
    legacyModules,
    now: () => new FixedDate()
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertMatchesLegacy(actual, expected, legacyActual) {
  assert.deepEqual(plain(actual), expected);
  assert.deepEqual(plain(actual), plain(legacyActual));
}

function makeUpperSecSettings(constants) {
  const { RECOMMENDED_WEIGHT_TEMPLATE_IDS } = constants;
  return {
    gradeMapping: {},
    categories: [
      { id: 'general', name: 'Allgemein', active: true },
      { id: 'written', name: 'Klausuren', active: true }
    ],
    categoryRoles: { upperSecWrittenCategoryId: 'written' },
    weightTemplates: [
      {
        id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
        items: [
          { categoryId: 'general', weightPercent: 66.67 },
          { categoryId: 'written', weightPercent: 33.33 }
        ]
      },
      {
        id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
        items: [
          { categoryId: 'general', weightPercent: 50 },
          { categoryId: 'written', weightPercent: 50 }
        ]
      },
      {
        id: 'deviating',
        items: [
          { categoryId: 'general', weightPercent: 60 },
          { categoryId: 'written', weightPercent: 40 }
        ]
      }
    ]
  };
}

function upperSecCourse(constants, courseType, qualificationYear, weightTemplateId = null) {
  return {
    id: 'course-uppersec',
    schemaMode: constants.SCHEMA_MODES.UPPERSEC,
    weightTemplateId,
    upperSecContext: { courseType, qualificationYear, weightingDeviationReason: null },
    enrollments: []
  };
}

// Break caught: an incomplete extraction, accidental extra export, or parser
// coercion would change this public surface or one of its literal results.
test('exports exactly the grading surface and keeps strict grade and point parsers', () => {
  const { grading, legacy, legacyModules } = loadPair();
  assert.deepEqual(Object.keys(grading).sort(), EXPORT_NAMES);

  const mapping = legacyModules.DomainModel.createDefaultGradeMapping();
  for (const [label, expected] of Object.entries(EXPECTED_GRADE_VALUES)) {
    assert.equal(grading.parseGradeLabel(label, mapping), expected);
    assert.equal(grading.parseGradeLabel(`  ${label}  `, mapping), expected);
    assert.equal(grading.parseGradeLabel(label, mapping), legacy.parseGradeLabel(label, mapping));
  }
  assert.equal(grading.parseGradeLabel('Eigen', { Eigen: 1.25 }), 1.25);
  assert.equal(grading.parseGradeLabel('1', { '1': NaN }), null);
  assert.equal(grading.parseGradeLabel('1', { '1': 0 }), 0);
  for (const input of ['6+', '6-', '3abc', '2,5', '2.5', '', '   ', null, undefined]) {
    assert.equal(grading.parseGradeLabel(input, mapping), null);
  }

  for (const [input, expected] of [['0', 0], ['1.25', 1.25], [' 2,5 ', 2.5]]) {
    assert.equal(grading.parseGradeMappingInput(input), expected);
    assert.equal(grading.parseGradeMappingInput(input), legacy.parseGradeMappingInput(input));
  }
  for (const input of ['', '-1', '2abc', null, Infinity]) {
    assert.equal(grading.parseGradeMappingInput(input), null);
  }

  for (const input of ['-1', '16', '1.5', '1,5', '']) assert.equal(grading.parseUpperSecPoints(input), null);
  assert.equal(grading.parseUpperSecPoints('15'), 15);
  assert.equal(grading.parseUpperSecPoints(' 0 '), 0);
  assert.equal(grading.getUpperSecGradeLabel(15), '1+');
  assert.equal(grading.getUpperSecGradeLabel(0), '6');
  for (const input of [-1, 1.5, 16, '15']) assert.equal(grading.getUpperSecGradeLabel(input), null);
});

// Break caught: score status or invalid cached numeric data must not bypass the
// schema-specific raw parser.
test('raw validation and numeric score resolution preserve status and raw fallback rules', () => {
  const { grading, legacyModules } = loadPair();
  const { DomainModel } = legacyModules;
  const settings = { gradeMapping: { Eigen: 2.75 } };
  const grades = { schemaMode: DomainModel.SCHEMA_MODES.GRADES };
  const uppersec = { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC };

  assert.equal(grading.isValidRawForCourse(' Eigen ', grades, settings), true);
  assert.equal(grading.isValidRawForCourse('2abc', grades, settings), false);
  assert.equal(grading.isValidRawForCourse('15', uppersec, settings), true);
  assert.equal(grading.isValidRawForCourse('15.0', uppersec, settings), false);
  assert.equal(grading.isValidRawForCourse('1', { schemaMode: 'foreign' }, settings), false);

  assert.equal(grading.getNumericScoreForEntry({ status: 'valid', valueRaw: 'Eigen' }, grades, settings), 2.75);
  for (const status of [DomainModel.SCORE_STATUS.MISSING, DomainModel.SCORE_STATUS.EXCUSED]) {
    assert.equal(grading.getNumericScoreForEntry({ status, valueRaw: '1' }, grades, settings), null);
  }
  assert.equal(grading.getNumericScoreForEntry({ status: 'valid', valueNumeric: 12, valueRaw: '4' }, uppersec, settings), 12);
  assert.equal(grading.getNumericScoreForEntry({ status: 'valid', valueNumeric: 1.5, valueRaw: '11' }, uppersec, settings), 11);
  assert.equal(grading.getNumericScoreForEntry({ status: 'valid', valueNumeric: Infinity, valueRaw: '10' }, uppersec, settings), 10);
  assert.equal(grading.getNumericScoreForEntry(null, uppersec, settings), null);
});

// Break caught: inclusive bounds, strict monotonicity, and validation of the
// fallback row all affect exam-table grading at exact percentage boundaries.
test('percentage threshold validation keeps exact bounds and fallback failures', () => {
  const { grading, legacy } = loadPair();
  const scale = [{ label: '1' }, { label: '2' }, { label: '6' }];
  const cases = [
    [{ '1': 100, '2': 50, '6': 0 }, { ok: true, message: '' }],
    [{ '1': 101, '2': 50, '6': 0 }, { ok: false, message: 'Die Prozentgrenze für 1 muss eine Zahl zwischen 0 und 100 sein.' }],
    [{ '1': 90, '2': 90, '6': 0 }, { ok: false, message: 'Die Prozentgrenze für 2 muss kleiner als die Grenze für 1 sein; doppelte oder nicht monotone Grenzen sind nicht zulässig.' }],
    [{ '1': 90, '2': 50, '6': '' }, { ok: false, message: 'Die Prozentgrenze für 6 muss eine Zahl zwischen 0 und 100 sein.' }],
    [{ '1': 90, '2': 50, '6': 50 }, { ok: false, message: 'Die Prozentgrenze für 6 muss kleiner als die Grenze für 2 sein; doppelte oder nicht monotone Grenzen sind nicht zulässig.' }]
  ];
  for (const [thresholds, expected] of cases) {
    assertMatchesLegacy(
      grading.validatePercentageThresholds(scale, thresholds, '6'),
      expected,
      legacy.validatePercentageThresholds(scale, thresholds, '6')
    );
  }
});

// Break caught: flat and hierarchical averaging must ignore invalid weights,
// while incomplete subcategory configuration deliberately falls back to flat.
test('category averages preserve weight filtering and incomplete hierarchy fallback', () => {
  const { grading, legacy, legacyModules } = loadPair();
  const ctx = buildCourseState(legacyModules);
  const category = ctx.state.settings.categories.find(item => item.id === ctx.categoryIds.written);
  const first = addAssessment(legacyModules, ctx, { categoryId: category.id, subcategoryId: 'exam', weight: 2 });
  const second = addAssessment(legacyModules, ctx, { categoryId: category.id, subcategoryId: 'oral', weight: 1 });
  const ignoredZero = addAssessment(legacyModules, ctx, { categoryId: category.id, subcategoryId: 'exam', weight: 0 });
  const ignoredNegative = addAssessment(legacyModules, ctx, { categoryId: category.id, subcategoryId: 'exam', weight: -1 });
  const ignoredInfinite = addAssessment(legacyModules, ctx, { categoryId: category.id, subcategoryId: 'exam', weight: 1 });
  ignoredInfinite.weight = Infinity;
  for (const [assessment, raw] of [[first, '1'], [second, '5'], [ignoredZero, '6'], [ignoredNegative, '6'], [ignoredInfinite, '6']]) {
    setScore(legacyModules, assessment, ctx.students[0].id, raw);
  }
  const assessments = [first, second, ignoredZero, ignoredNegative, ignoredInfinite];

  assert.equal(grading.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings), 7 / 3);
  category.subcategories = [
    { id: 'exam', weightPercent: 75 },
    { id: 'oral', weightPercent: 25 }
  ];
  assert.equal(grading.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings), 2);
  category.subcategories[1].weightPercent = 0;
  assert.equal(grading.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings), 7 / 3);
  second.subcategoryId = 'deleted';
  category.subcategories[1].weightPercent = 25;
  assert.equal(grading.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings), 7 / 3);
  assert.equal(
    grading.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings),
    legacy.computeCategoryAverage(assessments, ctx.course, ctx.students[0].id, category.id, ctx.state.settings)
  );
});

// D3 intentionally replaces the old split reader contract: missing `active`
// follows the category constructor default, while explicit false stays inactive.
test('effective category weights treat missing active as true and preserve explicit false', () => {
  const { grading, legacyModules } = loadPair();
  const { DomainModel } = legacyModules;
  const settings = makeUpperSecSettings(DomainModel);
  settings.categories[0].active = undefined;
  const course = upperSecCourse(
    DomainModel,
    DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  const weights = grading.resolveEffectiveCategoryWeights(course, null, '2025-H1', settings);
  assert.deepEqual(plain(weights), [
    { categoryId: 'general', weightPercent: 66.67 },
    { categoryId: 'written', weightPercent: 33.33 }
  ]);
  const context = grading.resolveUpperSecGradingContext(course, null, '2025-H1', settings);
  assert.equal(context.status, 'recommendation');
  assert.equal(context.isWeightingDeviation, false);

  settings.categories[0].active = false;
  assert.deepEqual(plain(grading.resolveEffectiveCategoryWeights(course, null, '2025-H1', settings)), [
    { categoryId: 'written', weightPercent: 33.33 }
  ]);
});

// Break caught: phase/course-type selection, Q4 per-person decisions, template
// safety, and normalized-profile deviation are distinct branches.
test('upper-secondary contexts preserve Q1-Q4 rules for GK, LK, OTHER and Q4 people', () => {
  const { grading, legacy, legacyModules } = loadPair();
  const { DomainModel } = legacyModules;
  const settings = makeUpperSecSettings(DomainModel);
  const phaseCases = [
    [DomainModel.QUALIFICATION_YEARS.Q1_Q2, '2025-H1', 'Q1'],
    [DomainModel.QUALIFICATION_YEARS.Q1_Q2, '2025-H2', 'Q2'],
    [DomainModel.QUALIFICATION_YEARS.Q3_Q4, '2025-H1', 'Q3'],
    [DomainModel.QUALIFICATION_YEARS.Q3_Q4, '2025-H2', 'Q4']
  ];
  for (const [qualificationYear, term, qualificationPhase] of phaseCases) {
    const basic = upperSecCourse(DomainModel, DomainModel.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear);
    const basicResult = grading.resolveUpperSecGradingContext(basic, null, term, settings);
    assert.equal(basicResult.qualificationPhase, qualificationPhase);
    if (qualificationPhase === 'Q4') {
      assert.equal(basicResult.status, 'person-specific');
    } else {
      assert.equal(basicResult.expectedExamCount, 1);
      assert.deepEqual(plain(basicResult), plain(legacy.resolveUpperSecGradingContext(basic, null, term, settings)));
    }

    const advanced = upperSecCourse(DomainModel, DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED, qualificationYear);
    const advancedResult = grading.resolveUpperSecGradingContext(advanced, null, term, settings);
    assert.equal(advancedResult.qualificationPhase, qualificationPhase);
    assert.equal(advancedResult.expectedExamCount, qualificationPhase === 'Q4' ? 1 : 2);
    assert.deepEqual(plain(advancedResult), plain(legacy.resolveUpperSecGradingContext(advanced, null, term, settings)));

    const other = upperSecCourse(DomainModel, DomainModel.UPPERSEC_COURSE_TYPES.OTHER, qualificationYear);
    assert.equal(grading.resolveUpperSecGradingContext(other, null, term, settings).status, 'no-recommendation');
  }

  const q4 = upperSecCourse(
    DomainModel, DomainModel.UPPERSEC_COURSE_TYPES.BASIC, DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  q4.enrollments = [
    { studentId: 'written-person', writtenExamSubjectQ4: true },
    { studentId: 'general-person', writtenExamSubjectQ4: false }
  ];
  assert.equal(grading.resolveUpperSecGradingContext(q4, null, '2025-H2', settings).status, 'person-specific');
  assert.equal(grading.resolveUpperSecGradingContext(q4, 'written-person', '2025-H2', settings).expectedExamCount, 1);
  assert.equal(grading.resolveUpperSecGradingContext(q4, 'general-person', '2025-H2', settings).status, 'general-only');
  assert.deepEqual(
    plain(grading.resolveEffectiveCategoryWeights(q4, 'general-person', '2025-H2', settings)),
    [{ categoryId: 'general', weightPercent: 66.67 }]
  );

  const safe = grading.resolveUpperSecGradingContext(q4, 'written-person', '2025-H2', settings);
  assert.equal(safe.recommendedWeightTemplateId, DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM);
  assert.equal(safe.isWeightingDeviation, false);
  q4.weightTemplateId = 'deviating';
  assert.equal(grading.resolveUpperSecGradingContext(q4, 'written-person', '2025-H2', settings).isWeightingDeviation, true);
  settings.weightTemplates[0].items[0].weightPercent = 60;
  assert.equal(grading.resolveUpperSecGradingContext(q4, 'written-person', '2025-H2', settings).status, 'not-applicable');
});

// Break caught: the warning recognizes a persisted numeric zero but does not
// reinterpret legacy raw "0" when the numeric cache is null.
test('advanced-course warning keeps missing/numeric-zero behavior and raw-zero quirk', () => {
  const { grading, legacy, legacyModules } = loadPair();
  const { DomainModel } = legacyModules;
  const settings = makeUpperSecSettings(DomainModel);
  const course = upperSecCourse(DomainModel, DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED, DomainModel.QUALIFICATION_YEARS.Q1_Q2);
  const assessments = [
    { categoryId: 'written', scores: { student: { status: 'missing', valueRaw: '' } } },
    { categoryId: 'written', scores: { student: { status: 'valid', valueRaw: '0', valueNumeric: 0 } } }
  ];
  const warning = grading.resolveUpperSecAssessmentWarning(assessments, course, 'student', '2025-H1', settings);
  assert.equal(warning.code, 'lk-written-manual-decision');
  assert.deepEqual(plain(warning), plain(legacy.resolveUpperSecAssessmentWarning(assessments, course, 'student', '2025-H1', settings)));
  assessments[1].scores.student.valueNumeric = null;
  assert.equal(grading.resolveUpperSecAssessmentWarning(assessments, course, 'student', '2025-H1', settings), null);
});

// Break caught: overall category weighting must retain iteration order and
// renormalize over categories that have an actual average.
test('weighted overall calculation renormalizes available categories without rounding', () => {
  const { grading, legacy, legacyModules } = loadPair();
  const ctx = buildCourseState(legacyModules);
  const written = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, weight: 1 });
  const oral = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.oral, weight: 1 });
  setScore(legacyModules, written, ctx.students[0].id, '1');
  setScore(legacyModules, oral, ctx.students[0].id, '4');
  ctx.state.settings.categories.find(item => item.id === ctx.categoryIds.other).active = false;
  ctx.course.weightTemplateId = ctx.state.settings.weightTemplates[0].id;
  const assessments = [written, oral];
  const actual = grading.computeWeightedOverallForAssessments(
    assessments, ctx.course, ctx.students[0].id, ctx.state.settings, '2025-H1'
  );
  assert.equal(actual, 210 / 90);
  assert.equal(actual, legacy.computeWeightedOverallForAssessments(
    assessments, ctx.course, ctx.students[0].id, ctx.state.settings, '2025-H1'
  ));
});

test('R05: overall calculation ignores nonpositive and nonfinite category factors', () => {
  const { grading, legacyModules } = loadPair();
  const ctx = buildCourseState(legacyModules, { studentCount: 1 });
  const written = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, weight: 1 });
  const oral = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.oral, weight: 1 });
  setScore(legacyModules, written, ctx.students[0].id, '1');
  setScore(legacyModules, oral, ctx.students[0].id, '5');
  const template = {
    id: 'weight_r05', name: 'R05', items: [
      { categoryId: ctx.categoryIds.written, weightPercent: 150 },
      { categoryId: ctx.categoryIds.oral, weightPercent: -50 }
    ]
  };
  ctx.state.settings.weightTemplates = [template];
  ctx.course.weightTemplateId = template.id;
  const compute = () => grading.computeWeightedOverallForAssessments(
    [written, oral], ctx.course, ctx.students[0].id, ctx.state.settings, '2025-H1'
  );

  assert.equal(compute(), 1, '150/-50 darf keinen negativen Gesamtwert erzeugen');
  for (const invalidFactor of [0, -1, NaN, Infinity]) {
    template.items[0].weightPercent = invalidFactor;
    template.items[1].weightPercent = 100;
    assert.equal(compute(), 5, `${String(invalidFactor)} darf nicht in Zaehler oder Nenner eingehen`);
  }
  template.items[0].weightPercent = 0;
  template.items[1].weightPercent = -10;
  assert.equal(compute(), null, 'ohne positiven Beitrag gilt der Leerwertvertrag');
});

// Break caught: diagnostics must observe every scoped assessment in insertion
// order, preserve object identity, and emit exactly one final result afterward.
test('overall diagnostics observe all assessments in order including excluded ones', () => {
  const { grading, legacy, legacyModules, now } = loadPair();
  const ctx = buildCourseState(legacyModules);
  const h1 = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H1', title: 'H1' });
  const h2 = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2', title: 'H2' });
  const old = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, term: '2024-H2', title: 'Alt' });
  setScore(legacyModules, h1, ctx.students[0].id, '1');
  setScore(legacyModules, h2, ctx.students[0].id, '3');
  setScore(legacyModules, old, ctx.students[0].id, '6');
  const calls = [];
  let observedScope = null;
  const diagnostics = {
    assessment(scope, course, assessment) {
      observedScope ||= scope;
      assert.strictEqual(scope, observedScope);
      assert.strictEqual(course, ctx.course);
      calls.push(['assessment', assessment]);
    },
    result(course, result) {
      assert.strictEqual(course, ctx.course);
      calls.push(['result', result]);
    }
  };
  const actual = grading.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H2', now, diagnostics);
  assert.equal(actual, 2);
  assert.equal(actual, legacy.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H2'));
  assert.deepEqual(calls.map(([type, value]) => [type, type === 'assessment' ? value.title : value]), [
    ['assessment', 'H1'], ['assessment', 'H2'], ['assessment', 'Alt'], ['result', 2]
  ]);
  assert.deepEqual(Array.from(observedScope.assessments, assessment => assessment.title), ['H1', 'H2']);
  assert.strictEqual(calls[0][1], h1);
  assert.strictEqual(calls[1][1], h2);
  assert.strictEqual(calls[2][1], old);
});

// Break caught: diagnostic callbacks and property access are an optional
// observation boundary and must never change the grade result.
test('throwing and getter-throwing diagnostics cannot change overall results', () => {
  const { grading, legacyModules, now } = loadPair();
  const ctx = buildCourseState(legacyModules);
  const assessment = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H1' });
  setScore(legacyModules, assessment, ctx.students[0].id, '2');
  const expected = grading.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H1', now);
  const throwingCallbacks = {
    assessment() { throw new Error('assessment observer failed'); },
    result() { throw new Error('result observer failed'); }
  };
  assert.equal(grading.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H1', now, throwingCallbacks), expected);

  const throwingGetters = {};
  Object.defineProperties(throwingGetters, {
    assessment: { get() { throw new Error('assessment getter failed'); } },
    result: { get() { throw new Error('result getter failed'); } }
  });
  assert.equal(grading.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H1', now, throwingGetters), expected);
});

function buildStatisticsCase(legacyModules, schemaMode, values) {
  const ctx = buildCourseState(legacyModules, { schemaMode, studentCount: values.length });
  ctx.state.settings.categories = [{ id: 'single', name: 'Einzelkategorie', active: true }];
  ctx.state.settings.weightTemplates = [];
  if (schemaMode === 'grades') {
    ctx.state.settings.gradeMapping = Object.fromEntries(values.map((value, index) => [`V${index}`, value]));
    const assessment = addAssessment(legacyModules, ctx, { categoryId: 'single', term: '2025-H1' });
    values.forEach((value, index) => setScore(legacyModules, assessment, ctx.students[index].id, `V${index}`));
  } else {
    values.forEach((value, index) => {
      const low = Math.floor(value);
      const high = Math.ceil(value);
      const first = addAssessment(legacyModules, ctx, { categoryId: 'single', term: '2025-H1', title: `A${index}` });
      const second = addAssessment(legacyModules, ctx, { categoryId: 'single', term: '2025-H1', title: `B${index}` });
      setScore(legacyModules, first, ctx.students[index].id, String(low));
      setScore(legacyModules, second, ctx.students[index].id, String(high));
    });
  }
  return ctx;
}

// Break caught: empty statistics omit values, medians remain exact, and every
// documented bucket boundary belongs to the following half-open bucket.
test('course statistics preserve empty shape, exact medians and distribution boundaries', () => {
  const { grading, legacy, legacyModules, now } = loadPair();
  const empty = buildCourseState(legacyModules, { studentCount: 1 });
  const emptyStats = grading.computeCourseStatistics(empty.course, empty.state, now);
  assert.deepEqual(plain(emptyStats), { count: 0, mean: null, median: null, distribution: [] });
  assert.equal(Object.hasOwn(emptyStats, 'values'), false);

  const grades = buildStatisticsCase(legacyModules, 'grades', [1, 1.95, 2.95, 3.95, 4.95, 5.95]);
  const gradeStats = grading.computeCourseStatistics(grades.course, grades.state, now);
  assert.deepEqual(plain(gradeStats), {
    count: 6,
    mean: 3.4583333333333335,
    median: 3.45,
    distribution: [
      { label: 'bis 1,9', count: 1 }, { label: '2,0–2,9', count: 1 },
      { label: '3,0–3,9', count: 1 }, { label: '4,0–4,9', count: 1 },
      { label: '5,0–5,9', count: 1 }, { label: 'ab 6,0', count: 1 }
    ],
    values: [1, 1.95, 2.95, 3.95, 4.95, 5.95]
  });
  assert.deepEqual(plain(gradeStats), plain(legacy.computeCourseStatistics(grades.course, grades.state)));

  const odd = buildStatisticsCase(legacyModules, 'grades', [5, 1, 3]);
  assert.equal(grading.computeCourseStatistics(odd.course, odd.state, now).median, 3);

  const uppersec = buildStatisticsCase(legacyModules, 'uppersec', [4, 4.5, 9.5, 12.5]);
  const upperStats = grading.computeCourseStatistics(uppersec.course, uppersec.state, now);
  assert.deepEqual(plain(upperStats.distribution), [
    { label: '0–4', count: 1 }, { label: '5–9', count: 1 },
    { label: '10–12', count: 1 }, { label: '13–15', count: 1 }
  ]);
  assert.equal(upperStats.median, 7);
});

// Break caught: statistics must use the same instrumented computation path
// once per enrollment and request the injected clock on each active scope.
test('course statistics forward diagnostics and clock once per enrollment path', () => {
  const { grading, legacyModules, FixedDate } = loadPair();
  const ctx = buildCourseState(legacyModules, { studentCount: 2 });
  const assessment = addAssessment(legacyModules, ctx, { categoryId: ctx.categoryIds.written, term: null });
  setScore(legacyModules, assessment, ctx.students[0].id, '1');
  setScore(legacyModules, assessment, ctx.students[1].id, '3');
  let clockCalls = 0;
  const events = [];
  const diagnostics = {
    assessment(scope, course, item) {
      events.push(['assessment', scope, course, item]);
    },
    result(course, result) {
      events.push(['result', course, result]);
    }
  };
  const stats = grading.computeCourseStatistics(ctx.course, ctx.state, () => {
    clockCalls++;
    return new FixedDate();
  }, diagnostics);
  assert.deepEqual(plain(stats.values), [1, 3]);
  assert.equal(clockCalls, 2);
  assert.deepEqual(events.map(event => event[0]), ['assessment', 'result', 'assessment', 'result']);
  assert.strictEqual(events[0][2], ctx.course);
  assert.strictEqual(events[0][3], assessment);
  assert.strictEqual(events[2][3], assessment);
});
