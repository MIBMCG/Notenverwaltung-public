'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadLegacyGrading } = require('./harness/load-legacy-grading.js');

function fixedDateClass(isoValue) {
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

function loadTermsAt(isoValue = '2026-02-15T12:00:00') {
  const FixedDate = fixedDateClass(isoValue);
  const { exports: terms } = loadEsmGraph('src/domain/terms.js', {
    globals: { Date: FixedDate }
  });
  const { GradingLogic: legacy } = loadLegacyGrading({ dateImpl: FixedDate });
  return { FixedDate, legacy, terms };
}

function assertMatchesLegacy(actual, expected, legacyActual) {
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual, legacyActual);
}

function summarizeScope(scope) {
  return {
    allAssessmentIds: Array.from(scope.allAssessments, assessment => assessment.id),
    assessmentIds: Array.from(scope.assessments, assessment => assessment.id),
    assessmentTerms: Array.from(scope.assessmentTerms, ([assessment, term]) => [assessment.id, term]),
    currentTerm: scope.currentTerm,
    includedTerms: Array.from(scope.includedTerms),
    previousTerm: scope.previousTerm
  };
}

test('date resolver preserves local boundary times, leap years, and invalid-date handling', () => {
  const { FixedDate, legacy, terms } = loadTermsAt();
  const settings = {};
  const course = { schemaMode: 'grades' };
  const cases = [
    { date: new FixedDate(2025, 8, 7, 23, 59, 59), expected: '2024-H2' },
    { date: new FixedDate(2025, 8, 8, 0, 0, 0), expected: '2025-H1' },
    { date: new FixedDate(2026, 0, 30, 23, 59, 59), expected: '2025-H1' },
    { date: new FixedDate(2026, 0, 31, 12, 0, 0), expected: '2025-H1' },
    { date: new FixedDate(2026, 1, 9, 0, 0, 0), expected: '2025-H2' },
    { date: new FixedDate(2024, 1, 29, 12, 0, 0), expected: '2023-H2' },
    { date: new FixedDate('2026-01-20T12:00:00'), expected: '2025-H1' },
    { date: new FixedDate('invalid'), expected: null },
    { date: null, expected: null },
    { date: {}, expected: null }
  ];

  for (const { date, expected } of cases) {
    assertMatchesLegacy(
      terms.resolveAssessmentTermFromDateValue(date, course, settings),
      expected,
      legacy.resolveAssessmentTermFromDateValue(date, course, settings)
    );
  }
});

test('date resolver retains global, course, and archived cutoff precedence including cutoff source', () => {
  const { FixedDate, legacy, terms } = loadTermsAt();
  const date = new FixedDate(2026, 1, 15, 12, 0, 0);
  const settings = {
    halfYearSettings: {
      seckI: { h2StartMonth: 3, h2StartDay: 1 }
    }
  };
  const cases = [
    {
      name: 'global',
      course: { schemaMode: 'grades' },
      settings,
      expected: '2025-H1'
    },
    {
      name: 'course',
      course: { schemaMode: 'grades', termCutoffs: { h2StartMonth: 2, h2StartDay: 1 } },
      settings,
      expected: '2025-H2'
    },
    {
      name: 'archived course source',
      course: {
        schemaMode: 'grades',
        archivedAt: '2026-07-01',
        termCutoffs: { h2StartMonth: 2, h2StartDay: 1 },
        archiveSnapshot: {
          termCutoffSource: 'course',
          termCutoffs: { h2StartMonth: 2, h2StartDay: 1 }
        }
      },
      settings,
      expected: '2025-H2'
    },
    {
      name: 'archived schema source',
      course: {
        schemaMode: 'grades',
        archivedAt: '2026-07-01',
        archiveSnapshot: {
          termCutoffSource: 'schema',
          termCutoffs: { h2StartMonth: 2, h2StartDay: 1 }
        }
      },
      settings,
      expected: '2025-H1'
    }
  ];

  for (const testCase of cases) {
    assertMatchesLegacy(
      terms.resolveAssessmentTermFromDateValue(date, testCase.course, testCase.settings),
      testCase.expected,
      legacy.resolveAssessmentTermFromDateValue(date, testCase.course, testCase.settings)
    );
  }
});

test('R10/D4: boundary years repeat configured offsets and drive both assignment and current scope', () => {
  const { FixedDate, terms } = loadTermsAt('2027-08-15T12:00:00');
  const course = { id: 'february-course', schemaMode: 'grades' };
  const settings = {
    halfYearSettings: {
      seckI: {
        schoolYearStartYear: 2026, schoolYearStartMonth: 2, schoolYearStartDay: 1,
        h1EndYear: 2026, h1EndMonth: 7, h1EndDay: 31,
        h2StartYear: 2026, h2StartMonth: 8, h2StartDay: 1
      }
    }
  };

  for (const [dateParts, expectedStartYear, expectedTerm] of [
    [[2026, 6, 31], 2026, '2026-H1'],
    [[2026, 7, 1], 2026, '2026-H2'],
    [[2027, 6, 31], 2027, '2027-H1'],
    [[2027, 7, 1], 2027, '2027-H2']
  ]) {
    const date = new FixedDate(...dateParts);
    const boundaries = terms.resolveSchoolYearBoundaries(date, course, settings);
    assert.equal(boundaries.schoolYearStartYear, expectedStartYear);
    assert.deepEqual(
      [boundaries.schoolYearStart.getFullYear(), boundaries.h1End.getFullYear(), boundaries.h2Start.getFullYear()],
      [expectedStartYear, expectedStartYear, expectedStartYear]
    );
    assert.equal(terms.resolveAssessmentTermFromDateValue(date, course, settings), expectedTerm);
  }

  const scope = terms.resolveGradingResultScope(
    course,
    { settings, assessments: [] },
    null,
    () => new FixedDate(2027, 7, 15)
  );
  assert.equal(scope.currentTerm, '2027-H2');
});

test('D4 review: archived partial settings derive omitted boundary years relative to the explicit school-year start', () => {
  const { FixedDate, terms } = loadTermsAt('2026-10-01T12:00:00');
  const { exports: courseSettings } = loadEsmGraph('src/domain/course-settings.js');
  const course = {
    id: 'archived-partial-settings',
    schemaMode: 'grades',
    archivedAt: '2027-07-01',
    archiveSnapshot: {
      halfYearSettings: {
        seckI: {
          schoolYearStartYear: 2026,
          schoolYearStartMonth: 9,
          schoolYearStartDay: 1,
          h1EndMonth: 1,
          h1EndDay: 31,
          h2StartMonth: 2,
          h2StartDay: 1
        }
      }
    }
  };
  const state = {
    settings: {
      halfYearSettings: {
        seckI: {
          schoolYearStartYear: 1999,
          h1EndYear: 2000,
          h2StartYear: 2000
        }
      }
    },
    assessments: []
  };
  const settings = courseSettings.getSettingsForCourse(course, state);
  const date = new FixedDate(2026, 9, 1);
  const boundaries = terms.resolveSchoolYearBoundaries(date, course, settings);

  assert.deepEqual(
    [boundaries.schoolYearStartYear, boundaries.h1End.getFullYear(), boundaries.h2Start.getFullYear()],
    [2026, 2027, 2027]
  );
  assert.equal(terms.resolveAssessmentTermFromDateValue(date, course, settings), '2026-H1');
  assert.equal(
    terms.resolveGradingResultScope(course, state, null, () => date).currentTerm,
    '2026-H1',
    'the real archived getSettingsForCourse path must use the same relative fallback'
  );
});

test('R10/R22: course month-day overrides stay inside the school year and H2 wins gaps and overlaps', () => {
  const { FixedDate, terms } = loadTermsAt();
  const settings = {
    halfYearSettings: {
      seckI: {
        schoolYearStartYear: 2026, schoolYearStartMonth: 2, schoolYearStartDay: 1,
        h1EndYear: 2026, h1EndMonth: 8, h1EndDay: 31,
        h2StartYear: 2026, h2StartMonth: 9, h2StartDay: 1
      }
    }
  };
  const gapCourse = {
    id: 'gap', schemaMode: 'grades',
    termCutoffs: { h1EndMonth: 6, h1EndDay: 30, h2StartMonth: 8, h2StartDay: 1 }
  };
  const gapDate = new FixedDate(2027, 6, 15);
  const gapBoundaries = terms.resolveSchoolYearBoundaries(gapDate, gapCourse, settings);
  assert.equal(gapBoundaries.h2Start.getFullYear(), 2027);
  assert.equal(terms.resolveAssessmentTermFromDateValue(gapDate, gapCourse, settings), '2027-H1');

  const overlapCourse = {
    id: 'overlap', schemaMode: 'grades',
    termCutoffs: { h1EndMonth: 9, h1EndDay: 30, h2StartMonth: 8, h2StartDay: 1 }
  };
  assert.equal(
    terms.resolveAssessmentTermFromDateValue(new FixedDate(2027, 7, 1), overlapCourse, settings),
    '2027-H2'
  );
});

test('D4: date resolver and current scope share strict uppersec casing', () => {
  const { FixedDate, legacy, terms } = loadTermsAt('2026-02-15T12:00:00');
  const settings = {
    halfYearSettings: {
      seckI: { h2StartMonth: 3, h2StartDay: 1 },
      seckII: { h2StartMonth: 2, h2StartDay: 1 }
    }
  };
  const date = new FixedDate(2026, 1, 15);
  const lowerCourse = { id: 'lower', schemaMode: 'uppersec' };
  const upperCourse = { id: 'upper', schemaMode: 'UPPERSEC' };

  assertMatchesLegacy(
    terms.resolveAssessmentTermFromDateValue(date, lowerCourse, settings),
    '2025-H2',
    legacy.resolveAssessmentTermFromDateValue(date, lowerCourse, settings)
  );
  assertMatchesLegacy(
    terms.resolveAssessmentTermFromDateValue(date, upperCourse, settings),
    '2025-H1',
    legacy.resolveAssessmentTermFromDateValue(date, upperCourse, settings)
  );

  const state = { settings, assessments: [] };
  const lowerScope = terms.resolveGradingResultScope(lowerCourse, state, null, () => new FixedDate());
  const upperScope = terms.resolveGradingResultScope(upperCourse, state, null, () => new FixedDate());
  assert.deepEqual(Array.from(lowerScope.includedTerms), ['2025-H2']);
  assert.deepEqual(Array.from(upperScope.includedTerms), ['2025-H1']);
  assert.deepEqual(summarizeScope(lowerScope), summarizeScope(legacy.resolveGradingResultScope(lowerCourse, state)));
});

test('result-term functions keep Sek I yearly scope, Sek II isolation, and invalid-term behavior', () => {
  const { legacy, terms } = loadTermsAt();
  const sekI = { schemaMode: 'grades' };
  const sekII = { schemaMode: 'uppersec' };
  const cases = [
    { course: sekI, term: '2026-H1', expected: ['2026-H1'], yearly: false },
    { course: sekI, term: '2026-H2', expected: ['2026-H2', '2026-H1'], yearly: true },
    { course: sekII, term: '2026-H1', expected: ['2026-H1'], yearly: false },
    { course: sekII, term: '2026-H2', expected: ['2026-H2'], yearly: false },
    { course: sekI, term: '2026-H3', expected: [], yearly: false },
    { course: sekI, term: null, expected: [], yearly: false }
  ];

  for (const testCase of cases) {
    assertMatchesLegacy(
      Array.from(terms.resolveAssessmentTermsForResult(testCase.course, testCase.term)),
      testCase.expected,
      Array.from(legacy.resolveAssessmentTermsForResult(testCase.course, testCase.term))
    );
    assertMatchesLegacy(
      terms.isSchoolYearResultTerm(testCase.course, testCase.term),
      testCase.yearly,
      legacy.isSchoolYearResultTerm(testCase.course, testCase.term)
    );
  }
});

test('term labels retain configured H1/H2 names, full year option, Q1-Q4, and archived context', () => {
  const { legacy, terms } = loadTermsAt();
  const settings = {
    halfYearNames: {
      seckI: { h1: 'erstes Halbjahr', h2: 'zweites Halbjahr' },
      seckII: { h1: 'unused-Q1', h2: 'unused-Q2' }
    }
  };
  const cases = [
    {
      term: '2025-H1', course: { schemaMode: 'grades' }, options: {},
      expected: '25/26 erstes Halbjahr'
    },
    {
      term: '2025-H2', course: { schemaMode: 'grades' }, options: { fullStartYear: true },
      expected: '2025/26 zweites Halbjahr'
    },
    {
      term: '2025-H1',
      course: { schemaMode: 'uppersec', upperSecContext: { qualificationYear: 'q1-q2' } },
      options: {}, expected: '25/26 Q1'
    },
    {
      term: '2025-H2',
      course: { schemaMode: 'uppersec', upperSecContext: { qualificationYear: 'q1-q2' } },
      options: {}, expected: '25/26 Q2'
    },
    {
      term: '2025-H1',
      course: { schemaMode: 'uppersec', upperSecContext: { qualificationYear: 'q3-q4' } },
      options: {}, expected: '25/26 Q3'
    },
    {
      term: '2025-H2',
      course: { schemaMode: 'uppersec', upperSecContext: { qualificationYear: 'q3-q4' } },
      options: {}, expected: '25/26 Q4'
    },
    {
      term: '2025-H1',
      course: {
        schemaMode: 'uppersec', archivedAt: '2026-07-01',
        upperSecContext: { qualificationYear: 'q1-q2' },
        archiveSnapshot: { upperSecContext: { qualificationYear: 'q3-q4' } }
      },
      options: {}, expected: '25/26 Q3'
    },
    { term: 'not-a-term', course: { schemaMode: 'grades' }, options: {}, expected: 'not-a-term' },
    { term: null, course: { schemaMode: 'grades' }, options: {}, expected: '' }
  ];

  for (const testCase of cases) {
    assertMatchesLegacy(
      terms.formatCourseTermLabel(testCase.term, testCase.course, settings, testCase.options),
      testCase.expected,
      legacy.formatCourseTermLabel(testCase.term, testCase.course, settings, testCase.options)
    );
  }
});

test('Sek I scope includes H2 then H1 and retains excluded assessment map keys and identities', () => {
  const { terms } = loadTermsAt();
  const course = { id: 'c', schemaMode: 'grades' };
  const h2 = { id: 'h2', courseId: 'c', term: '2026-H2' };
  const h1 = { id: 'h1', courseId: 'c', term: '2026-H1' };
  const old = { id: 'old', courseId: 'c', term: '2025-H2' };
  const other = { id: 'other', courseId: 'x', term: '2026-H2' };
  const state = { settings: {}, assessments: [h2, h1, old, other] };
  const scope = terms.resolveGradingResultScope(course, state, '2026-H2', () => {
    throw new Error('unexpected clock');
  });

  assert.deepEqual(Array.from(scope.includedTerms), ['2026-H2', '2026-H1']);
  assert.deepEqual(Array.from(scope.assessments), [h2, h1]);
  assert.deepEqual(Array.from(scope.assessmentTerms.keys()), [h2, h1, old]);
  assert.deepEqual(Array.from(scope.allAssessments), [h2, h1, old]);
  assert.strictEqual(scope.allAssessments[0], h2);
  assert.strictEqual(scope.assessments[1], h1);
  assert.strictEqual(Array.from(scope.assessmentTerms.keys())[2], old);
  assert.strictEqual(scope.settings, state.settings);
  assert.equal(scope.previousTerm, '2026-H1');
});

test('scope keeps explicit and archived terms clock-free, picks the highest canonical archive term, and matches legacy', () => {
  const { FixedDate, legacy, terms } = loadTermsAt('2035-05-01T12:00:00');
  const explicitCourse = { id: 'explicit', schemaMode: 'grades' };
  const explicitState = { settings: {}, assessments: [] };
  let explicitCalls = 0;
  const explicitScope = terms.resolveGradingResultScope(explicitCourse, explicitState, '2024-H1', () => {
    explicitCalls++;
    return new FixedDate();
  });
  assert.equal(explicitCalls, 0);
  assert.equal(explicitScope.currentTerm, '2024-H1');

  const archiveCourse = { id: 'archive', schemaMode: 'grades', archivedAt: '2027-07-01' };
  const dated = { id: 'dated', courseId: 'archive', date: '2026-10-01' };
  const high = { id: 'high', courseId: 'archive', term: '2027-H1' };
  const invalid = { id: 'invalid', courseId: 'archive', term: '9999-H3' };
  const archiveState = { settings: {}, assessments: [dated, high, invalid] };
  let archiveCalls = 0;
  const archiveScope = terms.resolveGradingResultScope(archiveCourse, archiveState, null, () => {
    archiveCalls++;
    return new FixedDate();
  });
  assert.equal(archiveCalls, 0);
  assert.equal(archiveScope.currentTerm, '2027-H1');
  assert.deepEqual(summarizeScope(archiveScope), summarizeScope(legacy.resolveGradingResultScope(archiveCourse, archiveState)));
});

test('D4: archived scope treats ISO dates as local days and timestamp values as instants', { concurrency: false }, () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const { FixedDate, terms } = loadTermsAt();
    const course = { id: 'archive-local-calendar', schemaMode: 'grades', archivedAt: '2026-07-01' };
    const dateOnly = { id: 'date-only-boundary', courseId: course.id, date: '2026-02-09' };
    const timestamp = { id: 'timestamp-before-boundary', courseId: course.id, date: '2026-02-09T00:00:00Z' };
    const manual = { id: 'manual-stored-term', courseId: course.id, date: '2026-02-09', term: '2025-H1' };
    const state = {
      settings: {
        halfYearSettings: {
          seckI: {
            schoolYearStartYear: 2025,
            schoolYearStartMonth: 9,
            schoolYearStartDay: 8,
            h1EndYear: 2026,
            h1EndMonth: 1,
            h1EndDay: 30,
            h2StartYear: 2026,
            h2StartMonth: 2,
            h2StartDay: 9
          }
        }
      },
      assessments: [dateOnly, timestamp, manual]
    };
    let clockCalls = 0;

    const scope = terms.resolveGradingResultScope(course, state, null, () => {
      clockCalls++;
      return new FixedDate();
    });

    assert.equal(clockCalls, 0, 'archived terms are derived from their stored assessment dates');
    assert.equal(scope.currentTerm, '2025-H2');
    assert.equal(scope.assessmentTerms.get(dateOnly), '2025-H2');
    assert.equal(scope.assessmentTerms.get(timestamp), '2025-H1', 'UTC timestamp keeps its instant meaning');
    assert.equal(scope.assessmentTerms.get(manual), '2025-H1', 'a stored canonical term remains authoritative');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('scope calls its clock once for invalid explicit terms and empty archives', () => {
  const { FixedDate, legacy, terms } = loadTermsAt('2026-01-20T12:00:00');
  const cases = [
    { course: { id: 'active', schemaMode: 'grades' }, selectedTerm: '2026-H3' },
    { course: { id: 'archive', schemaMode: 'grades', archivedAt: '2025-07-01' }, selectedTerm: null }
  ];

  for (const testCase of cases) {
    const state = { settings: {}, assessments: [] };
    let calls = 0;
    const scope = terms.resolveGradingResultScope(testCase.course, state, testCase.selectedTerm, () => {
      calls++;
      return new FixedDate();
    });
    assert.equal(calls, 1);
    assert.equal(scope.currentTerm, '2025-H1');
    assert.deepEqual(summarizeScope(scope), summarizeScope(legacy.resolveGradingResultScope(testCase.course, state, testCase.selectedTerm)));
  }
});

test('scope assigns dated and untagged assessments to terms without replacing their identities', () => {
  const { FixedDate, legacy, terms } = loadTermsAt('2026-02-15T12:00:00');
  const course = { id: 'c', schemaMode: 'grades' };
  const dated = { id: 'dated', courseId: 'c', date: '2026-01-20' };
  const untagged = { id: 'untagged', courseId: 'c' };
  const excluded = { id: 'excluded', courseId: 'c', date: '2024-01-20' };
  const state = { settings: {}, assessments: [dated, untagged, excluded] };
  const scope = terms.resolveGradingResultScope(course, state, null, () => new FixedDate());

  assert.equal(scope.currentTerm, '2025-H2');
  assert.deepEqual(Array.from(scope.assessments), [dated, untagged]);
  assert.equal(scope.assessmentTerms.get(dated), '2025-H1');
  assert.equal(scope.assessmentTerms.get(untagged), '2025-H2');
  assert.equal(scope.assessmentTerms.get(excluded), '2023-H1');
  assert.strictEqual(scope.assessments[0], dated);
  assert.strictEqual(scope.assessments[1], untagged);
  assert.deepEqual(summarizeScope(scope), summarizeScope(legacy.resolveGradingResultScope(course, state)));
});
