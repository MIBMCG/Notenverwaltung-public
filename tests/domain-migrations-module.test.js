'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seededRandom } = require('./harness/load.js');
const { loadLegacyDomain: loadModules } = require('./harness/load-legacy-domain.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { buildCourseState } = require('./harness/fixtures.js');

const FIXED_INSTANT = '2026-09-04T08:09:10.000Z';
const fixedDate = class extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_INSTANT);
    else super(...args);
  }
  static now() { return Date.parse(FIXED_INSTANT); }
};
const now = () => new Date(FIXED_INSTANT);
const serializable = value => JSON.parse(JSON.stringify(value));
const withoutResumeReference = value => {
  const comparable = serializable(value);
  delete comparable.lastGradesheetCourseId;
  delete comparable.settings.schoolProfile;
  for (const assessment of comparable.assessments || []) delete assessment.termAssignment;
  return comparable;
};

function loadModern(seed = 71) {
  const math = Object.assign(Object.create(Math), { random: seededRandom(seed) });
  return loadEsmGraph('src/domain/migrations.js', { globals: { Math: math } }).exports;
}

function loadPair(seed = 71) {
  const legacyModules = loadModules({ seed, dateImpl: fixedDate });
  return {
    legacyModules,
    legacy: legacyModules.DomainModel,
    modern: loadModern(seed),
    termServices: {
      getSettingsForCourse: legacyModules.GradingLogic.getSettingsForCourse,
      resolveAssessmentTermFromDateValue: legacyModules.GradingLogic.resolveAssessmentTermFromDateValue
    }
  };
}

function normalizePair(input, seed = 71) {
  const pair = loadPair(seed);
  const legacyResult = pair.legacy.ensureStateShape(serializable(input));
  const modernResult = pair.modern.ensureStateShape(serializable(input), now, pair.termServices);
  const legacyComparable = withoutResumeReference(legacyResult);
  const modernComparable = withoutResumeReference(modernResult);
  assert.deepEqual(modernComparable, legacyComparable);
  return { ...pair, legacyResult, modernResult };
}

function buildArchivedIntegrityState(seed = 141) {
  const modules = loadModules({ seed, dateImpl: fixedDate });
  const { state, course, categoryIds } = buildCourseState(modules, { studentCount: 1 });
  for (const [index, categoryId] of [categoryIds.oral, categoryIds.written].entries()) {
    modules.DomainModel.addAssessmentToState(state, modules.DomainModel.createAssessment({
      id: `assessment_archive_integrity_${index + 1}`,
      courseId: course.id,
      categoryId,
      title: `Synthetische Archivleistung ${index + 1}`,
      term: '2025-H1'
    }));
  }
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  course.id = 'course_archive_integrity';
  for (const assessment of state.assessments) assessment.courseId = course.id;
  return { modules, state, course };
}

function assertArchiveIntegrityError(action, courseId) {
  assert.throws(action, error => error && error.code === 'ARCHIVE_INTEGRITY_INVALID' &&
    String(error.message).includes(courseId) && /Backup/.test(String(error.message)));
}

test('resume course reference keeps only one unique active course ID', () => {
  const pair = loadPair(140);
  const normalize = input => pair.modern.ensureStateShape(serializable(input), now, pair.termServices);
  const active = pair.legacy.createCourse({ id: 'resume-active', name: 'Biologie', classLabel: '10a' });
  const archived = pair.legacy.createCourse({ id: 'resume-archived', name: 'Chemie', classLabel: '10b' });
  const archiveSource = pair.legacy.createEmptyState();
  archiveSource.courses = [archived];
  pair.legacy.archiveCourse(archiveSource, archived.id, 'manual', {});

  const fresh = normalize(pair.legacy.createEmptyState());
  assert.equal(fresh.lastGradesheetCourseId, null);

  const valid = pair.legacy.createEmptyState();
  valid.courses = [active, archived];
  valid.lastGradesheetCourseId = active.id;
  assert.equal(normalize(valid).lastGradesheetCourseId, active.id);

  for (const invalidReference of [undefined, null, '', '   ', 42, archived.id, 'resume-missing']) {
    const invalid = pair.legacy.createEmptyState();
    invalid.courses = [active, archived];
    if (invalidReference !== undefined) invalid.lastGradesheetCourseId = invalidReference;
    assert.equal(normalize(invalid).lastGradesheetCourseId, null,
      `ungültige Referenz ${JSON.stringify(invalidReference)} muss verworfen werden`);
  }

  const ambiguous = pair.legacy.createEmptyState();
  ambiguous.courses = [
    pair.legacy.createCourse({ id: 'resume-duplicate', name: 'Erster Kurs' }),
    pair.legacy.createCourse({ id: 'resume-duplicate', name: 'Zweiter Kurs' })
  ];
  ambiguous.lastGradesheetCourseId = 'resume-duplicate';
  assert.equal(normalize(ambiguous).lastGradesheetCourseId, null);
});

test('Wave 3.1 migration preserves base-shape parity and reaches the legacy-stable shape', () => {
  const cases = [
    null,
    {},
    { settings: [] },
    { students: [null, { id: 's1', firstName: 'Ada', custom: { keep: true } }] },
    {
      students: [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }],
      courses: [{
        id: 'c1', name: 'Bio', subject: 'Bio', schemaMode: 'uppersec',
        enrollments: [{ studentId: 's1', customEnrollment: 7 }],
        termResults: [{ studentId: 's1', term: '2026-H1', points: 12 }]
      }],
      assessments: [],
      settings: {}
    }
  ];

  cases.forEach((input, index) => {
    const { legacy, modern, termServices } = normalizePair(input, 100 + index);
    if (input && typeof input === 'object') {
      const legacyOnce = legacy.ensureStateShape(serializable(input));
      const modernOnce = modern.ensureStateShape(serializable(input), now, termServices);
      assert.deepEqual(withoutResumeReference(modernOnce), withoutResumeReference(legacyOnce));
      const legacyTwice = legacy.ensureStateShape(serializable(legacyOnce));
      const modernTwice = modern.ensureStateShape(serializable(modernOnce), now, termServices);
      assert.deepEqual(withoutResumeReference(modernTwice), withoutResumeReference(legacyTwice));
      const stable = modern.ensureStateShape(serializable(modernTwice), now, termServices);
      assert.deepEqual(serializable(stable), serializable(modernTwice));
    }
  });

  const baselineEdge = loadPair(118);
  const once = baselineEdge.modern.ensureStateShape(serializable(cases[4]), now, baselineEdge.termServices);
  const twice = baselineEdge.modern.ensureStateShape(serializable(once), now, baselineEdge.termServices);
  assert.equal(once.courses[0].schoolYearStartYear, null);
  assert.equal(twice.courses[0].schoolYearStartYear, 0);

  const custom = normalizePair(cases[3], 119).modernResult;
  assert.deepEqual(serializable(custom.students[0].custom), { keep: true });
  const enrollment = normalizePair(cases[4], 120).modernResult.courses[0].enrollments[0];
  assert.equal(enrollment.customEnrollment, 7);
});

test('Wave 3.1 migration validates its clock and term services before mutation', () => {
  const modern = loadModern();
  const cases = [
    [null, { getSettingsForCourse() {}, resolveAssessmentTermFromDateValue() {} }, 'now muss eine Funktion sein.'],
    [now, null, 'termServices muss getSettingsForCourse und resolveAssessmentTermFromDateValue bereitstellen.'],
    [now, { getSettingsForCourse() {} }, 'termServices muss getSettingsForCourse und resolveAssessmentTermFromDateValue bereitstellen.'],
    [now, { getSettingsForCourse: true, resolveAssessmentTermFromDateValue() {} }, 'termServices muss getSettingsForCourse und resolveAssessmentTermFromDateValue bereitstellen.']
  ];
  for (const [clock, termServices, message] of cases) {
    const input = { students: 'unveraendert', marker: { keep: true } };
    const before = serializable(input);
    assert.throws(
      () => modern.ensureStateShape(input, clock, termServices),
      { name: 'TypeError', message }
    );
    assert.deepEqual(input, before);
  }
});

test('R02: malformed snapshots stop normalization before archived assessments can be filtered', () => {
  for (const [index, snapshot] of [null, [], 'x', {}].entries()) {
    const { state, course } = buildArchivedIntegrityState(141 + index);
    course.archiveSnapshot = snapshot;
    const before = serializable(state);
    const modern = loadModern(141 + index);

    assertArchiveIntegrityError(
      () => modern.ensureStateShape(state, now, {
        getSettingsForCourse() { throw new Error('Termauflösung darf vor der Integritätsprüfung nicht starten.'); },
        resolveAssessmentTermFromDateValue() { throw new Error('Termauflösung darf vor der Integritätsprüfung nicht starten.'); }
      }),
      course.id
    );
    assert.deepEqual(serializable(state), before, 'Integritätsfehler darf den Rohbestand nicht verändern');
  }
});

test('R02: unresolved archived category and subcategory references stop normalization without mutation', () => {
  for (const brokenReference of ['category', 'subcategory']) {
    const { modules, state, course } = buildArchivedIntegrityState(brokenReference === 'category' ? 146 : 147);
    if (brokenReference === 'category') {
      state.assessments[0].categoryId = 'category_missing_from_archive';
    } else {
      const category = course.archiveSnapshot.categories.find(item => item.id === state.assessments[0].categoryId);
      category.subcategories = [{ id: 'subcategory_kept', name: 'Vorhanden' }];
      state.assessments[0].subcategoryId = 'subcategory_missing_from_archive';
    }
    const before = serializable(state);
    const modern = loadModern(brokenReference === 'category' ? 146 : 147);

    assertArchiveIntegrityError(
      () => modern.ensureStateShape(state, now, {
        getSettingsForCourse: modules.GradingLogic.getSettingsForCourse,
        resolveAssessmentTermFromDateValue: modules.GradingLogic.resolveAssessmentTermFromDateValue
      }),
      course.id
    );
    assert.deepEqual(serializable(state), before);
  }
});

test('R18/D3: live categories default missing active to true and preserve explicit false', () => {
  const pair = loadPair(149);
  const state = pair.legacy.createEmptyState();
  delete state.settings.categories[0].active;
  state.settings.categories[1].active = false;

  const result = pair.modern.ensureStateShape(state, now, pair.termServices);

  assert.equal(result.settings.categories[0].active, true);
  assert.equal(result.settings.categories[1].active, false);
});

test('R18/D3: incomplete historical category activity stops normalization without mutation', () => {
  for (const [index, invalidActive] of [[0, undefined], [1, 'true']]) {
    const { modules, state, course } = buildArchivedIntegrityState(149 + index);
    const category = course.archiveSnapshot.categories[0];
    if (invalidActive === undefined) delete category.active;
    else category.active = invalidActive;
    const before = serializable(state);

    assertArchiveIntegrityError(
      () => loadModern(149 + index).ensureStateShape(state, now, {
        getSettingsForCourse: modules.GradingLogic.getSettingsForCourse,
        resolveAssessmentTermFromDateValue: modules.GradingLogic.resolveAssessmentTermFromDateValue
      }),
      course.id
    );
    assert.deepEqual(serializable(state), before);
  }
});

test('R18/D3: incomplete archive-history category activity stops normalization without mutation', () => {
  const pair = loadPair(151);
  const state = pair.legacy.createEmptyState();
  const course = pair.legacy.createCourse({
    id: 'course_history_active', name: 'Historie', subject: 'Testfach', classLabel: 'T1'
  });
  pair.legacy.addCourseToState(state, course);
  pair.legacy.archiveCourse(state, course.id, 'manual', {});
  pair.legacy.restoreCourse(state, course.id);
  delete course.archiveHistory[0].snapshot.categories[0].active;
  const before = serializable(state);

  assertArchiveIntegrityError(
    () => pair.modern.ensureStateShape(state, now, pair.termServices),
    course.id
  );
  assert.deepEqual(serializable(state), before);
});

test('D3: migration preserves invalid legacy weights and marks the old standard name for review', () => {
  const pair = loadPair(151);
  const state = pair.legacy.createEmptyState();
  const [firstCategory, secondCategory] = state.settings.categories;
  state.settings.weightTemplates = [{
    id: 'legacy_invalid_weights',
    name: 'Standard Sek I (67/33)',
    items: [
      { categoryId: firstCategory.id, weightPercent: 150 },
      { categoryId: secondCategory.id, weightPercent: -50 }
    ]
  }];

  const result = pair.modern.ensureStateShape(state, now, pair.termServices);
  const migrated = result.settings.weightTemplates.find(template => template.id === 'legacy_invalid_weights');

  assert.deepEqual(serializable(migrated.items.map(item => item.weightPercent)), [150, -50]);
  assert.match(migrated.name, /^Altbestand Sek I \(67\/33\).*prüfen/);
});

test('R02: a complete archived snapshot with no categories or assessments remains loadable', () => {
  const { modules, state, course } = buildArchivedIntegrityState(148);
  state.assessments = [];
  course.archiveSnapshot.categories = [];
  course.archiveSnapshot.weightTemplate = null;
  course.weightTemplateId = null;

  const result = loadModern(148).ensureStateShape(state, now, {
    getSettingsForCourse: modules.GradingLogic.getSettingsForCourse,
    resolveAssessmentTermFromDateValue: modules.GradingLogic.resolveAssessmentTermFromDateValue
  });

  assert.equal(result.courses[0].id, course.id);
  assert.deepEqual(serializable(result.courses[0].archiveSnapshot.categories), []);
  assert.deepEqual(serializable(result.assessments), []);
});

test('M26: migration clears every non-valid Sek-I score and preserves valid scores', () => {
  const { legacy } = loadPair(126);
  const state = legacy.createEmptyState();
  const categoryId = state.settings.categories[0].id;
  const student = legacy.createStudent({ id: 'student_m26', lastName: 'Test', firstName: 'M26' });
  const sekiCourse = legacy.createCourse({
    id: 'course_m26_seki', name: 'Sek I M26', subject: 'Testfach', classLabel: 'T1'
  });
  const sekiiCourse = legacy.createCourse({
    id: 'course_m26_sekii', name: 'Sek II M26', subject: 'Testfach', classLabel: 'Q1',
    schemaMode: legacy.SCHEMA_MODES.UPPERSEC
  });
  legacy.addStudentToState(state, student);
  legacy.addCourseToState(state, sekiCourse);
  legacy.addCourseToState(state, sekiiCourse);
  legacy.enrollStudentInCourse(state, sekiCourse.id, student.id);
  legacy.enrollStudentInCourse(state, sekiiCourse.id, student.id);

  const addAssessmentWithScore = (id, courseId, score) => {
    const assessment = legacy.createAssessment({
      id, courseId, categoryId, title: id, term: '2025-H1'
    });
    assessment.scores[student.id] = score;
    legacy.addAssessmentToState(state, assessment);
  };
  addAssessmentWithScore('assessment_m26_missing', sekiCourse.id, {
    valueRaw: '15.3', status: legacy.SCORE_STATUS.MISSING, valueNumeric: 15.3
  });
  addAssessmentWithScore('assessment_m26_excused', sekiCourse.id, {
    valueRaw: '2', status: legacy.SCORE_STATUS.EXCUSED, valueNumeric: 2
  });
  addAssessmentWithScore('assessment_m26_invalid', sekiCourse.id, {
    valueRaw: '1-', status: 'invalid', valueNumeric: 1.3
  });
  addAssessmentWithScore('assessment_m26_valid_seki', sekiCourse.id, {
    valueRaw: '1-', status: legacy.SCORE_STATUS.VALID, valueNumeric: 1.3
  });
  addAssessmentWithScore('assessment_m26_valid_sekii', sekiiCourse.id, {
    valueRaw: '12', status: legacy.SCORE_STATUS.VALID, valueNumeric: 12
  });

  const result = normalizePair(state, 126).modernResult;
  const scoreFor = id => result.assessments.find(assessment => assessment.id === id).scores.student_m26;
  assert.deepEqual(serializable(scoreFor('assessment_m26_missing')), {
    valueRaw: null, status: 'missing', valueNumeric: null
  });
  assert.deepEqual(serializable(scoreFor('assessment_m26_excused')), {
    valueRaw: null, status: 'excused', valueNumeric: null
  });
  assert.deepEqual(serializable(scoreFor('assessment_m26_invalid')), {
    valueRaw: null, status: 'invalid', valueNumeric: null
  });
  assert.deepEqual(serializable(scoreFor('assessment_m26_valid_seki')), {
    valueRaw: '1-', status: 'valid', valueNumeric: 1.3
  });
  assert.deepEqual(serializable(scoreFor('assessment_m26_valid_sekii')), {
    valueRaw: '12', status: 'valid', valueNumeric: 12
  });
});

test('M9: duplicate roots keep the first object and remove ambiguous inbound references', () => {
  const { legacy } = loadPair(129);
  const state = legacy.createEmptyState();
  const categoryId = state.settings.categories[0].id;
  state.students = [
    legacy.createStudent({ id: 'student_dup', lastName: 'Erste', firstName: 'Person' }),
    legacy.createStudent({ id: 'student_dup', lastName: 'Zweite', firstName: 'Person' }),
    legacy.createStudent({ id: 'student_ok', lastName: 'Gueltig', firstName: 'Person' })
  ];
  const firstCourse = legacy.createCourse({ id: 'course_dup', name: 'Erster Kurs', subject: 'Bio' });
  const secondCourse = legacy.createCourse({ id: 'course_dup', name: 'Zweiter Kurs', subject: 'Bio' });
  const validCourse = legacy.createCourse({ id: 'course_ok', name: 'Gueltiger Kurs', subject: 'Bio' });
  validCourse.enrollments = [
    { studentId: 'student_dup', subgroup: null },
    { studentId: 'student_ok', subgroup: null },
    { studentId: 'student_ok', subgroup: 'spaeteres Duplikat' },
    { studentId: 'student_missing', subgroup: null }
  ];
  state.courses = [firstCourse, secondCourse, validCourse];
  state.assessments = [
    legacy.createAssessment({ id: 'assessment_dup', courseId: 'course_dup', categoryId, title: 'Mehrdeutig' }),
    legacy.createAssessment({ id: 'assessment_ok', courseId: 'course_ok', categoryId, title: 'Gueltig' }),
    legacy.createAssessment({ id: 'assessment_ok', courseId: 'course_ok', categoryId, title: 'Doppelt' }),
    legacy.createAssessment({ id: 'assessment_orphan', courseId: 'course_missing', categoryId, title: 'Verwaist' })
  ];
  state.assessments[1].scores = {
    student_dup: { valueRaw: '2', valueNumeric: 2, status: 'valid' },
    student_ok: { valueRaw: '1', valueNumeric: 1, status: 'valid' },
    student_missing: { valueRaw: '3', valueNumeric: 3, status: 'valid' }
  };

  const result = normalizePair(state, 129).modernResult;
  assert.deepEqual(serializable(result.students.map(item => item.lastName)), ['Erste', 'Gueltig']);
  assert.deepEqual(serializable(result.courses.map(item => item.name)), ['Erster Kurs', 'Gueltiger Kurs']);
  assert.deepEqual(serializable(result.assessments.map(item => item.title)), ['Gueltig']);
  assert.deepEqual(serializable(result.courses.find(item => item.id === 'course_ok').enrollments.map(item => item.studentId)), ['student_ok']);
  assert.deepEqual(Object.keys(result.assessments[0].scores), ['student_ok']);
});

test('M17: archive history survives normalization and legacy courses receive an empty history', () => {
  const { legacy } = loadPair(117);
  const state = legacy.createEmptyState();
  const oldCategoryId = state.settings.categories[0].id;
  state.settings.categories[0].id = 'cat_archive';
  for (const template of state.settings.weightTemplates) {
    for (const item of template.items) {
      if (item.categoryId === oldCategoryId) item.categoryId = 'cat_archive';
    }
  }
  const course = legacy.createCourse({ id: 'course_archive', name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  legacy.addCourseToState(state, course);
  legacy.archiveCourse(state, course.id, 'manual', {});
  legacy.restoreCourse(state, course.id);
  const legacyCourse = legacy.createCourse({ id: 'course_legacy', name: 'Legacy', subject: 'Testfach', classLabel: 'T2' });
  delete legacyCourse.archiveHistory;
  state.courses.push(legacyCourse);

  const result = normalizePair(state, 117).modernResult;
  assert.equal(result.courses[0].archiveHistory.length, 1);
  assert.equal(result.courses[0].archiveHistory[0].archivedAt, FIXED_INSTANT);
  assert.equal(result.courses[0].archiveHistory[0].snapshot.categories[0].id, 'cat_archive');
  assert.deepEqual(serializable(result.courses[1].archiveHistory), []);
});

test('M30: repeated normalization does not duplicate recommended profiles', () => {
  const { legacy, modern, termServices } = loadPair(130);
  const state = legacy.createEmptyState();
  const once = modern.ensureStateShape(serializable(state), now, termServices);
  const twice = modern.ensureStateShape(serializable(once), now, termServices);
  for (const id of [
    'wt_berlin_seki_50_50_example',
    'wt_berlin_sekii_one_exam',
    'wt_berlin_sekii_two_exams'
  ]) {
    assert.equal(twice.settings.weightTemplates.filter(item => item.id === id).length, 1);
  }
  assert.deepEqual(serializable(twice), serializable(once));
});

test('M27: unknown and self-referencing predecessors are cleared conservatively', () => {
  for (const predecessor of ['course_missing', 'course_self']) {
    const pair = loadPair(127);
    const ctx = buildCourseState(pair.legacyModules);
    ctx.course.id = 'course_self';
    ctx.course.carriedForwardFromCourseId = predecessor;
    const result = normalizePair(ctx.state, 127).modernResult;
    assert.equal(result.courses[0].id, 'course_self');
    assert.equal(result.courses[0].carriedForwardFromCourseId, null);
  }
});

test('configured Sek-II courses preserve normalized context and literal reason', () => {
  const { legacy } = loadPair(131);
  const state = legacy.createEmptyState();
  state.courses = [{
    id: 'course_upper_context',
    name: 'Synthetischer Oberstufenkurs',
    subject: 'Biologie',
    classLabel: 'Q-Test',
    schemaMode: 'uppersec',
    upperSecContext: {
      courseType: 'basic',
      qualificationYear: 'q3-q4',
      weightingDeviationReason: '  Fachkonferenz-Beschluss  '
    }
  }];
  const result = normalizePair(state, 131).modernResult;
  assert.deepEqual(serializable(result.courses[0].upperSecContext), {
    courseType: 'basic',
    qualificationYear: 'q3-q4',
    weightingDeviationReason: 'Fachkonferenz-Beschluss'
  });
});

test('M32: normalization keeps the first valid unique term result and drops malformed data', () => {
  const { legacyModules, legacy } = loadPair(132);
  const { state, students: [student], course } = buildCourseState(legacyModules, {
    schemaMode: 'uppersec', studentCount: 1
  });
  course.termResults = [
    { studentId: student.id, term: '2025-H1', points: 11 },
    { studentId: student.id, term: '2025-H1', points: 12 },
    { studentId: student.id, term: 'Q1', points: 13 },
    { studentId: 'stu_unknown', term: '2025-H2', points: 10 }
  ];
  assert.equal(course.schemaMode, legacy.SCHEMA_MODES.UPPERSEC);
  const result = normalizePair(state, 132).modernResult;
  assert.deepEqual(serializable(result.courses[0].termResults), [
    { studentId: student.id, term: '2025-H1', points: 11 }
  ]);
});

test('migration term derivation uses real services for dated, undated and archived cutoff paths', () => {
  const { legacy } = loadPair(133);
  const state = legacy.createEmptyState();
  const globalCategoryId = state.settings.categories[0].id;
  state.students = [{ id: 'student_terms', lastName: 'Term', firstName: 'Test' }];

  const dated = legacy.createCourse({ id: 'course_dated', name: 'Datiert', schemaMode: 'uppersec' });
  const undated = legacy.createCourse({ id: 'course_undated', name: 'Undatiert', schemaMode: 'grades' });
  const archived = legacy.createCourse({
    id: 'course_archived', name: 'Archiviert', schemaMode: 'grades', weightTemplateId: 'snapshot_template'
  });
  archived.archivedAt = '2026-07-31T00:00:00.000Z';
  archived.termCutoffs = { h1EndMonth: 2, h1EndDay: 28, h2StartMonth: 3, h2StartDay: 1 };
  archived.archiveSnapshot = {
    id: 'snapshot_course_archived',
    schemaMode: 'grades',
    gradeMapping: { '1': 1 },
    categories: [{ id: 'snapshot_category', name: 'Archivkategorie', active: true, subcategories: [] }],
    weightTemplate: {
      id: 'snapshot_template', name: 'Archivvorlage',
      items: [{ categoryId: 'snapshot_category', weightPercent: 100 }]
    },
    categoryRoles: {},
    halfYearNames: { seckI: { h1: 'H1', h2: 'H2' } },
    halfYearSettings: { seckI: { schoolYearStartMonth: 9, schoolYearStartDay: 8 } },
    termCutoffs: { h1EndMonth: 2, h1EndDay: 28, h2StartMonth: 3, h2StartDay: 1 },
    termCutoffSource: 'course',
    enrollments: []
  };
  state.courses = [dated, undated, archived];
  state.assessments = [
    legacy.createAssessment({
      id: 'assessment_dated', courseId: 'course_dated', categoryId: globalCategoryId,
      title: 'Datiert', date: '2026-02-09', term: null
    }),
    legacy.createAssessment({
      id: 'assessment_undated', courseId: 'course_undated', categoryId: globalCategoryId,
      title: 'Undatiert', date: null, term: null
    }),
    legacy.createAssessment({
      id: 'assessment_archived', courseId: 'course_archived', categoryId: 'snapshot_category',
      title: 'Archiviert', date: '2026-02-15', term: null
    })
  ];

  const result = normalizePair(state, 133).modernResult;
  assert.deepEqual(serializable(result.assessments.map(assessment => assessment.term)), [
    '2025-H2',
    '2025-H2',
    '2025-H1'
  ]);
  assert.deepEqual(serializable(result.assessments.map(assessment => assessment.termAssignment)), [
    'auto',
    'auto',
    'auto'
  ]);
});

test('D4: archived ISO dates use the local calendar boundary and keep stored manual terms', { concurrency: false }, () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const { legacy, modern, termServices } = loadPair(134);
    const state = legacy.createEmptyState();
    state.settings.halfYearSettings.seckI = {
      schoolYearStartYear: 2025,
      schoolYearStartMonth: 9,
      schoolYearStartDay: 8,
      h1EndYear: 2026,
      h1EndMonth: 1,
      h1EndDay: 30,
      h2StartYear: 2026,
      h2StartMonth: 2,
      h2StartDay: 9
    };
    const course = legacy.createCourse({ id: 'course_local_calendar_archive', name: 'Archiv Grenzdatum' });
    legacy.addCourseToState(state, course);
    const boundaryAssessment = legacy.createAssessment({
      id: 'assessment_local_calendar_boundary', courseId: course.id,
      categoryId: state.settings.categories[0].id, title: 'Grenzdatum',
      date: '2026-02-09', term: null
    });
    const storedManualAssessment = legacy.createAssessment({
      id: 'assessment_local_calendar_manual', courseId: course.id,
      categoryId: state.settings.categories[0].id, title: 'Manueller Altterm',
      date: '2026-02-09', term: '2025-H1'
    });
    legacy.addAssessmentToState(state, boundaryAssessment);
    legacy.addAssessmentToState(state, storedManualAssessment);
    legacy.archiveCourse(state, course.id, 'manual', {});
    delete boundaryAssessment.term;
    delete boundaryAssessment.termAssignment;
    const rawState = serializable(state);
    const result = modern.ensureStateShape(serializable(rawState), now, termServices);

    const migratedBoundary = result.assessments.find(assessment => assessment.id === boundaryAssessment.id);
    const migratedManual = result.assessments.find(assessment => assessment.id === storedManualAssessment.id);
    assert.equal(migratedBoundary.term, '2025-H2');
    assert.equal(migratedBoundary.termAssignment, 'auto');
    assert.equal(migratedManual.term, '2025-H1');
    assert.equal(migratedManual.termAssignment, 'manual');

    process.env.TZ = 'Europe/Berlin';
    const berlinResult = modern.ensureStateShape(serializable(rawState), now, termServices);
    assert.equal(berlinResult.assessments.find(assessment => assessment.id === boundaryAssessment.id).term, '2025-H2');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('D4/R19: migration canonicalizes legacy terms and assigns conservative provenance', () => {
  const pair = loadPair(154);
  const state = pair.legacy.createEmptyState();
  const course = pair.legacy.createCourse({ id: 'course_d4_legacy', name: 'D4 legacy' });
  const student = pair.legacy.createStudent({ id: 'student_d4', lastName: 'D4', firstName: 'Test' });
  pair.legacy.addStudentToState(state, student);
  pair.legacy.addCourseToState(state, course);
  pair.legacy.enrollStudentInCourse(state, course.id, student.id);
  state.assessments = [pair.legacy.createAssessment({
    id: 'assessment_d4_legacy', courseId: course.id,
    categoryId: state.settings.categories[0].id, title: 'Legacy',
    date: '2026-02-05', term: ' 2025-h2 '
  })];
  const score = { valueRaw: '2', status: pair.legacy.SCORE_STATUS.VALID, valueNumeric: 2 };
  state.assessments[0].scores[student.id] = score;

  const result = pair.modern.ensureStateShape(state, now, pair.termServices);

  assert.equal(result.assessments[0].term, '2025-H2');
  assert.equal(result.assessments[0].termAssignment, 'manual');
  assert.strictEqual(result.assessments[0].scores[student.id], score);
  const twice = pair.modern.ensureStateShape(result, now, pair.termServices);
  assert.equal(twice.assessments[0].term, '2025-H2');
  assert.equal(twice.assessments[0].termAssignment, 'manual');
});

test('D4/R19: invalid local terms and provenance fail before any normalization mutation', () => {
  for (const [index, fixture] of [
    { date: '2026-02-05', term: '2025-H3' },
    { date: null, term: 'Q1' },
    { date: '2026-02-05', term: '2025-H2', termAssignment: 'guessed' }
  ].entries()) {
    const pair = loadPair(160 + index);
    const state = pair.legacy.createEmptyState();
    const course = pair.legacy.createCourse({ id: `course_bad_term_${index}`, name: 'Bad term' });
    pair.legacy.addCourseToState(state, course);
    const assessment = pair.legacy.createAssessment({
      id: `assessment_bad_term_${index}`, courseId: course.id,
      categoryId: state.settings.categories[0].id, title: 'Bad term',
      date: fixture.date, term: fixture.term
    });
    if (fixture.termAssignment) assessment.termAssignment = fixture.termAssignment;
    state.assessments = [assessment];
    const before = serializable(state);

    assert.throws(
      () => pair.modern.ensureStateShape(state, now, pair.termServices),
      error => error && error.code === 'ASSESSMENT_TERM_INTEGRITY_INVALID'
    );
    assert.deepEqual(serializable(state), before);
  }
});

test('D4/R19: invalid terms in archived assessments fail before mutation', () => {
  const { modules, state, course } = buildArchivedIntegrityState(170);
  state.assessments[0].term = '2025-H3';
  const before = serializable(state);

  assert.throws(
    () => loadModern(170).ensureStateShape(state, now, {
      getSettingsForCourse: modules.GradingLogic.getSettingsForCourse,
      resolveAssessmentTermFromDateValue: modules.GradingLogic.resolveAssessmentTermFromDateValue
    }),
    error => error && error.code === 'ASSESSMENT_TERM_INTEGRITY_INVALID'
  );
  assert.deepEqual(serializable(state), before);
  assert.equal(course.archivedAt !== null, true);
});
