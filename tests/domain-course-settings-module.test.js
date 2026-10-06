'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source.js');
const { loadLegacyGrading } = require('./harness/load-legacy-grading.js');

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

test('active settings preserve identity and archived settings preserve snapshot precedence', async () => {
  const { getSettingsForCourse } = await importEsmSource('src/domain/course-settings.js');
  const settings = { gradeMapping: { '1': 1 }, categories: [{ id: 'live' }], custom: 7 };
  assert.strictEqual(getSettingsForCourse({}, { settings }), settings);
  const archiveSnapshot = { gradeMapping: { '1': 9 }, categories: [{ id: 'frozen' }] };
  const result = getSettingsForCourse({ archivedAt: '2026-01-01', archiveSnapshot }, { settings });
  assert.strictEqual(result.gradeMapping, archiveSnapshot.gradeMapping);
  assert.strictEqual(result.categories, archiveSnapshot.categories);
  assert.equal(result.custom, 7);
  assert.deepEqual(result.weightTemplates, []);
  assert.equal(result.termCutoffs, null);
});

test('only archived courses with an object snapshot leave the active settings identity', async () => {
  const { getSettingsForCourse } = await importEsmSource('src/domain/course-settings.js');
  const settings = { marker: 'global' };
  for (const course of [
    null,
    {},
    { archivedAt: '' },
    { archivedAt: '2026-01-01' },
    { archivedAt: '2026-01-01', archiveSnapshot: null },
    { archivedAt: '2026-01-01', archiveSnapshot: 'not-a-snapshot' }
  ]) {
    assert.strictEqual(getSettingsForCourse(course, { settings }), settings);
  }
  assert.deepEqual(getSettingsForCourse(null, null), {});
});

test('archived settings replace grading values while retaining unrelated active settings', async () => {
  const { getSettingsForCourse } = await importEsmSource('src/domain/course-settings.js');
  const settings = {
    custom: { source: 'live' },
    gradeMapping: { '1': 1 }, categories: [{ id: 'live-category' }],
    weightTemplates: [{ id: 'live-template' }], categoryRoles: { written: 'live-category' },
    halfYearNames: { seckI: { h1: 'Live H1' } }, halfYearSettings: { seckI: { h2StartDay: 1 } },
    termCutoffs: { term: 'live' }
  };
  const archiveSnapshot = {
    gradeMapping: { '1': 9 }, categories: [{ id: 'frozen-category' }],
    weightTemplate: { id: 'frozen-template' }, categoryRoles: { written: 'frozen-category' },
    halfYearNames: { seckI: { h1: 'Frozen H1' } }, halfYearSettings: { seckI: { h2StartDay: 9 } },
    termCutoffs: { term: 'frozen' }
  };
  const result = getSettingsForCourse({ archivedAt: '2026-01-01', archiveSnapshot }, { settings });
  assert.strictEqual(result.custom, settings.custom);
  assert.strictEqual(result.gradeMapping, archiveSnapshot.gradeMapping);
  assert.strictEqual(result.categories, archiveSnapshot.categories);
  assert.deepEqual(result.weightTemplates, [archiveSnapshot.weightTemplate]);
  assert.strictEqual(result.categoryRoles, archiveSnapshot.categoryRoles);
  assert.strictEqual(result.halfYearNames, archiveSnapshot.halfYearNames);
  assert.strictEqual(result.halfYearSettings, archiveSnapshot.halfYearSettings);
  assert.strictEqual(result.termCutoffs, archiveSnapshot.termCutoffs);
});

test('empty archive snapshots use the frozen defaults without mutating their inputs', async () => {
  const { getSettingsForCourse } = await importEsmSource('src/domain/course-settings.js');
  const settings = { categories: [{ id: 'live' }], custom: { preserved: true } };
  const archiveSnapshot = {};
  const course = { archivedAt: '2026-01-01', archiveSnapshot };
  const before = snapshot({ settings, course });
  const result = getSettingsForCourse(course, { settings });
  assert.deepEqual(result, {
    categories: [], custom: { preserved: true }, gradeMapping: {}, weightTemplates: [],
    categoryRoles: {}, halfYearNames: {}, halfYearSettings: {}, termCutoffs: null
  });
  assert.deepEqual({ settings, course }, before);
});

test('extracted settings agree with the frozen grading oracle for representative fallback cases', async () => {
  const { getSettingsForCourse } = await importEsmSource('src/domain/course-settings.js');
  const { GradingLogic } = loadLegacyGrading();
  const cases = [
    [null, null],
    [{}, { settings: { marker: 'active' } }],
    [{ archivedAt: '2026-01-01' }, { settings: { marker: 'missing snapshot' } }],
    [{ archivedAt: '2026-01-01', archiveSnapshot: {} }, { settings: { custom: 'kept' } }],
    [{ archivedAt: '2026-01-01', archiveSnapshot: { gradeMapping: { '1': 15 }, categories: [{ id: 'archived' }], weightTemplate: { id: 'archive-template' }, categoryRoles: { written: 'archived' }, halfYearNames: { seckI: { h1: 'Archiv H1' } }, halfYearSettings: { seckI: { h2StartDay: 8 } }, termCutoffs: { h1: '2026-01-30' } } }, { settings: { custom: 'kept', gradeMapping: { '1': 1 }, categories: [{ id: 'active' }] } }]
  ];
  for (const [course, state] of cases) {
    assert.deepEqual(
      snapshot(getSettingsForCourse(snapshot(course), snapshot(state))),
      snapshot(GradingLogic.getSettingsForCourse(snapshot(course), snapshot(state)))
    );
  }
});

test('frozen grading loader exposes the complete reference and captures optional debug logging', () => {
  const { GradingLogic, sandbox, logs } = loadLegacyGrading();
  assert.deepEqual(Object.keys(GradingLogic).sort(), [
    'computeCategoryAverage', 'computeCourseStatistics', 'computeOverallGrade',
    'computeWeightedOverallForAssessments', 'formatCourseTermLabel', 'getNumericScoreForEntry',
    'getSettingsForCourse', 'getUpperSecGradeLabel', 'isSchoolYearResultTerm',
    'isValidRawForCourse', 'parseGradeLabel', 'parseGradeMappingInput', 'parseUpperSecPoints',
    'resolveAssessmentTermFromDateValue', 'resolveAssessmentTermsForResult',
    'resolveEffectiveCategoryWeights', 'resolveGradingResultScope',
    'resolveUpperSecAssessmentWarning', 'resolveUpperSecGradingContext',
    'validatePercentageThresholds'
  ]);
  sandbox.window.DEBUG_PREVTERM = true;
  sandbox.console.debug('reference logging');
  assert.deepEqual(logs, [{ level: 'debug', args: ['reference logging'] }]);
});
