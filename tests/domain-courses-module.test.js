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
const fixedDate = class extends Date {
  constructor(...args) {
    if (args.length === 0) super('2026-09-04T08:09:10.000Z');
    else super(...args);
  }
  static now() { return Date.parse('2026-09-04T08:09:10.000Z'); }
};
const now = () => new fixedDate();

function loadCourses(seed = 19) {
  const math = Object.assign(Object.create(Math), { random: seededRandom(seed) });
  return loadEsmGraph('src/domain/courses.js', { globals: { Math: math } }).exports;
}

function stateFixture(legacy) {
  const state = { students: [{ id: 's1', homeClass: '10b' }], courses: [], assessments: [] };
  const course = legacy.createCourse({
    id: 'c1', name: 'Bio', subject: 'Biologie', classLabel: 'Q3',
    schemaMode: legacy.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null }
  });
  state.courses.push(course);
  return { state, course };
}

test('Wave 3.1 course context and factory shapes preserve legacy behavior', () => {
  const legacy = loadModules({ seed: 19 }).DomainModel;
  const mod = loadCourses(19);
  assert.deepEqual(Object.keys(mod).sort(), [
    'addCourseToState', 'archiveCourse', 'createArchiveSnapshot', 'createCourse',
    'createEnrollment', 'createSuccessorCourseCandidate', 'enrollStudentInCourse', 'findCourseById',
    'findEnrollment', 'listActiveCourses', 'listArchivedCourses', 'listEnrollmentsForCourse',
    'listReferencedStudentIdsForCourse', 'listStudentReportCourses',
    'normalizeArchiveHistory', 'normalizeArchiveNote', 'normalizeArchiveRetentionUntil',
    'normalizeUpperSecContext', 'planCourseSuccessor', 'removeCourseFromState',
    'resolveQualificationPhase', 'resolveUpperSecWrittenCategoryId', 'restoreCourse',
    'setWrittenExamSubjectQ4', 'studentHasArchivedCourseReference'
  ]);
  const contexts = [
    [legacy.SCHEMA_MODES.GRADES, { courseType: 'basic' }],
    [legacy.SCHEMA_MODES.UPPERSEC, { courseType: 'advanced', qualificationYear: 'q1-q2', weightingDeviationReason: '  Beschluss  ' }],
    [legacy.SCHEMA_MODES.UPPERSEC, { courseType: 'basic' }],
    [legacy.SCHEMA_MODES.UPPERSEC, { courseType: 'ungültig', qualificationYear: 'q9', weightingDeviationReason: 'x' }],
    [legacy.SCHEMA_MODES.UPPERSEC, { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: ` ${'x'.repeat(1001)} ` }]
  ];
  for (const [schemaMode, context] of contexts) {
    assert.deepEqual(serializable(mod.normalizeUpperSecContext(schemaMode, context)), serializable(legacy.normalizeUpperSecContext(schemaMode, context)));
  }
  assert.deepEqual(serializable(mod.createEnrollment({ studentId: 's1', writtenExamSubjectQ4: true })), serializable(legacy.createEnrollment({ studentId: 's1', writtenExamSubjectQ4: true })));
  const inputs = [
    { id: 'seki', name: 'Sek I', subject: 'Bio', classLabel: '10a', termResults: [{ studentId: 's1', term: '2026-H1', points: 12 }] },
    { id: 'lk', name: 'LK', schemaMode: legacy.SCHEMA_MODES.UPPERSEC, upperSecContext: { courseType: 'advanced', qualificationYear: 'q1-q2' } },
    { id: 'gk', name: 'GK', schemaMode: legacy.SCHEMA_MODES.UPPERSEC, upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4' } }
  ];
  for (const input of inputs) assert.deepEqual(serializable(mod.createCourse(input)), serializable(legacy.createCourse(input)));
  const sourceTermResults = [{ studentId: 's1', term: '2026-H1', points: 12 }];
  const legacyCopied = legacy.createCourse({ id: 'copy-legacy', name: 'Kopie', termResults: sourceTermResults });
  const modernCopied = mod.createCourse({ id: 'copy-modern', name: 'Kopie', termResults: sourceTermResults });
  sourceTermResults[0].points = 3;
  assert.deepEqual(serializable(modernCopied.termResults), serializable(legacyCopied.termResults));
  assert.deepEqual(serializable(modernCopied.termResults), [{ studentId: 's1', term: '2026-H1', points: 12 }]);
  const archived = mod.createCourse({ name: 'Archiv' });
  assert.deepEqual(serializable({ archivedAt: archived.archivedAt, archiveReason: archived.archiveReason, archiveRetentionUntil: archived.archiveRetentionUntil, archiveNote: archived.archiveNote, archiveSnapshot: archived.archiveSnapshot, archiveHistory: archived.archiveHistory }), { archivedAt: null, archiveReason: null, archiveRetentionUntil: null, archiveNote: null, archiveSnapshot: null, archiveHistory: [] });
});

test('Wave 3.1 course lookups, enrollment and listing preserve legacy behavior', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  const { state, course } = stateFixture(legacy);
  const direct = serializable(state);
  assert.deepEqual(serializable(mod.findCourseById(direct, 'c1')), serializable(legacy.findCourseById(state, 'c1')));
  assert.deepEqual(serializable(mod.listEnrollmentsForCourse(direct, 'c1')), serializable(legacy.listEnrollmentsForCourse(state, 'c1')));
  assert.equal(mod.enrollStudentInCourse(direct, 'c1', 's1'), legacy.enrollStudentInCourse(state, 'c1', 's1'));
  assert.deepEqual(serializable(direct.courses[0].enrollments), serializable(state.courses[0].enrollments));
  assert.equal(mod.enrollStudentInCourse(direct, 'c1', 's1'), legacy.enrollStudentInCourse(state, 'c1', 's1'));
  assert.deepEqual(serializable(direct.courses[0].enrollments), serializable(state.courses[0].enrollments));
  assert.deepEqual(serializable(mod.findEnrollment(direct, 'c1', 's1')), serializable(legacy.findEnrollment(state, 'c1', 's1')));
  assert.deepEqual(serializable(mod.findEnrollment(direct.courses[0], 's1')), serializable(legacy.findEnrollment(state.courses[0], 's1')));
  direct.courses.push({ id: 'archived', archivedAt: '2026-01-01' });
  assert.deepEqual(serializable(mod.listActiveCourses(direct)), serializable(legacy.listActiveCourses(direct)));
  assert.deepEqual(serializable(mod.listArchivedCourses(direct)), serializable(legacy.listArchivedCourses(direct)));
  assert.equal(mod.resolveQualificationPhase(direct.courses[0], '2026-H1'), 'Q3');
  assert.equal(mod.resolveQualificationPhase(direct.courses[0], '2026-H2'), 'Q4');
  assert.equal(mod.resolveQualificationPhase({ schemaMode: 'grades' }, '2026-H1'), null);
  assert.ok(course);
});

test('Wave 3.1 Q4 written-exam mutation preserves all rejection paths', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  const { state, course } = stateFixture(legacy);
  legacy.enrollStudentInCourse(state, 'c1', 's1');
  const direct = serializable(state);
  assert.equal(mod.setWrittenExamSubjectQ4(direct, 'c1', 's1', true), true);
  assert.equal(mod.findEnrollment(direct, 'c1', 's1').writtenExamSubjectQ4, true);
  const cases = [
    [{ ...direct, courses: [] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem aktiven Kurs erlaubt.'],
    [{ ...direct, courses: [{ ...direct.courses[0], archivedAt: '2026-01-01' }] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem aktiven Kurs erlaubt.'],
    [{ ...direct, courses: [{ ...direct.courses[0], schemaMode: 'grades' }] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.'],
    [{ ...direct, courses: [{ ...direct.courses[0], upperSecContext: null }] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.'],
    [{ ...direct, courses: [{ ...direct.courses[0], upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' } }] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.'],
    [{ ...direct, courses: [{ ...direct.courses[0], upperSecContext: { courseType: 'advanced', qualificationYear: 'q3-q4' } }] }, 'c1', 's1', false, 'Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.'],
    [direct, 'c1', 's1', 'ja', 'Die Kennzeichnung muss Ja oder Nein sein.'],
    [direct, 'c1', 'missing', false, 'Die Person ist nicht in diesem Kurs eingeschrieben.']
  ];
  for (const [input, courseId, studentId, value, expected] of cases) {
    assert.equal(thrownMessage(() => mod.setWrittenExamSubjectQ4(serializable(input), courseId, studentId, value)), expected);
  }
  assert.ok(course);
});

test('Wave 3.1 archive normalizers preserve legacy behavior', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  for (const value of ['2026-02-28', '2026-02-30', '', ' text ']) {
    assert.equal(mod.normalizeArchiveRetentionUntil(value), legacy.normalizeArchiveRetentionUntil(value));
    assert.equal(mod.normalizeArchiveNote(value), legacy.normalizeArchiveNote(value));
  }
  const history = [{ archivedAt: '2026-08-01', snapshot: { id: 'snapshot', schemaMode: 'grades' }, archiveNote: '  Notiz  ' }, null];
  assert.deepEqual(serializable(mod.normalizeArchiveHistory(history, 'uppersec')), [{
    archivedAt: '2026-08-01', schemaMode: 'grades', archiveReason: null,
    archiveRetentionUntil: null, archiveNote: 'Notiz', snapshot: { id: 'snapshot', schemaMode: 'grades' }
  }]);
});

test('Wave 3.1 archive category resolution and frozen snapshots preserve legacy behavior', () => {
  const legacy = loadModules({ dateImpl: fixedDate }).DomainModel;
  const mod = loadCourses();
  const templateSettings = {
    gradeMapping: { '1': 1 },
    categories: [{ id: 'oral', name: 'Mündlich' }, { id: 'written', name: 'Schriftlich' }],
    weightTemplates: [
      {
        id: 'wt_berlin_sekii_one_exam',
        name: 'Eine Klausur',
        items: [{ categoryId: 'written', weightPercent: 33.33 }, { categoryId: 'oral', weightPercent: 66.67 }]
      },
      {
        id: 'wt_berlin_sekii_two_exams',
        name: 'Zwei Klausuren',
        items: [{ categoryId: 'written', weightPercent: 50 }, { categoryId: 'oral', weightPercent: 50 }]
      }
    ],
    halfYearNames: { seckII: { h1: 'Q1', h2: 'Q2' } },
    halfYearSettings: { seckII: { schoolYearStartYear: 2026, h1EndMonth: 1, h1EndDay: 30 } }
  };

  for (const settings of [
    { ...templateSettings, categoryRoles: { upperSecWrittenCategoryId: 'snapshotted-written' } },
    templateSettings,
    {
      ...templateSettings,
      weightTemplates: templateSettings.weightTemplates.map(template => ({
        ...template,
        items: template.items.concat({ categoryId: 'second-written', weightPercent: template.id.endsWith('one_exam') ? 33.33 : 50 })
      }))
    }
  ]) {
    assert.equal(mod.resolveUpperSecWrittenCategoryId(settings), legacy.resolveUpperSecWrittenCategoryId(settings));
  }

  const state = { settings: serializable(templateSettings), assessments: [] };
  const course = {
    id: 'archive-source',
    schemaMode: 'uppersec',
    weightTemplateId: 'wt_berlin_sekii_one_exam',
    termCutoffs: { h1EndMonth: 2, h1EndDay: 1 },
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' },
    enrollments: [{ studentId: 's1', writtenExamSubjectQ4: true }]
  };
  let nowCalls = 0;
  const snapshot = mod.createArchiveSnapshot(state, course, () => {
    nowCalls += 1;
    return now();
  });
  const legacySnapshot = legacy.createArchiveSnapshot(serializable(state), serializable(course));
  assert.deepEqual(serializable(snapshot), serializable(legacySnapshot));
  assert.equal(nowCalls, 1);
  assert.equal(snapshot.createdAt, '2026-09-04T08:09:10.000Z');
  assert.equal(snapshot.termCutoffSource, 'course');
  state.settings.categories[0].name = 'Geändert';
  course.enrollments[0].writtenExamSubjectQ4 = false;
  assert.equal(snapshot.categories[0].name, 'Mündlich');
  assert.equal(snapshot.enrollments[0].writtenExamSubjectQ4, true);
  assert.throws(
    () => mod.createArchiveSnapshot(state, course, null),
    { name: 'TypeError', message: 'now muss eine Funktion sein.' }
  );
});

test('Wave 3.1 archive and restore mutations preserve metadata, history, and clock behavior', () => {
  const legacy = loadModules({ seed: 31, dateImpl: fixedDate }).DomainModel;
  const mod = loadCourses(31);
  const state = legacy.createEmptyState();
  const course = legacy.createCourse({
    id: 'archive-course',
    name: 'Archivkurs',
    subject: 'Biologie',
    classLabel: 'Q1',
    schemaMode: legacy.SCHEMA_MODES.UPPERSEC,
    weightTemplateId: 'wt_berlin_sekii_one_exam',
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' }
  });
  course.enrollments.push(legacy.createEnrollment({ studentId: 's1', writtenExamSubjectQ4: true }));
  state.courses.push(course);
  const direct = serializable(state);
  const untouched = serializable(direct);

  assert.throws(
    () => mod.archiveCourse(direct, course.id, 'manual', {}, undefined),
    { name: 'TypeError', message: 'now muss eine Funktion sein.' }
  );
  assert.deepEqual(serializable(direct), untouched);

  let nowCalls = 0;
  const metadata = { archiveRetentionUntil: '2028-07-31', archiveNote: '  Abschluss  ' };
  assert.equal(mod.archiveCourse(direct, course.id, 'school-year', metadata, () => {
    nowCalls += 1;
    return now();
  }), legacy.archiveCourse(state, course.id, 'school-year', metadata));
  assert.equal(nowCalls, 2);
  assert.deepEqual(serializable(direct), serializable(state));
  assert.equal(direct.courses[0].schoolYearStartYear, 2025);
  assert.equal(direct.courses[0].archiveSnapshot.createdAt, '2026-09-04T08:09:10.000Z');
  assert.equal(direct.courses[0].archivedAt, '2026-09-04T08:09:10.000Z');
  assert.equal(direct.courses[0].archiveRetentionUntil, '2028-07-31');
  assert.equal(direct.courses[0].archiveNote, 'Abschluss');
  assert.equal(mod.archiveCourse(direct, course.id, 'manual', {}, now), false);
  assert.equal(legacy.archiveCourse(state, course.id, 'manual', {}), false);

  assert.equal(mod.restoreCourse(direct, course.id), legacy.restoreCourse(state, course.id));
  assert.deepEqual(serializable(direct), serializable(state));
  assert.deepEqual(serializable(direct.courses[0].archiveHistory), [{
    archivedAt: '2026-09-04T08:09:10.000Z',
    schemaMode: 'uppersec',
    archiveReason: 'school-year',
    archiveRetentionUntil: '2028-07-31',
    archiveNote: 'Abschluss',
    snapshot: serializable(state.courses[0].archiveHistory[0].snapshot)
  }]);
  assert.equal(direct.courses[0].archiveSnapshot, null);
  assert.equal(mod.restoreCourse(direct, course.id), false);
});

test('archiving and deleting the resumed course clear only its root reference', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  const first = legacy.createCourse({ id: 'resume-first', name: 'Biologie' });
  const second = legacy.createCourse({ id: 'resume-second', name: 'Chemie' });

  const archivedState = legacy.createEmptyState();
  archivedState.courses = [serializable(first), serializable(second)];
  archivedState.lastGradesheetCourseId = first.id;
  assert.equal(mod.archiveCourse(archivedState, first.id, 'manual', {}, now), true);
  assert.equal(archivedState.lastGradesheetCourseId, null);

  const unrelatedArchive = legacy.createEmptyState();
  unrelatedArchive.courses = [serializable(first), serializable(second)];
  unrelatedArchive.lastGradesheetCourseId = first.id;
  assert.equal(mod.archiveCourse(unrelatedArchive, second.id, 'manual', {}, now), true);
  assert.equal(unrelatedArchive.lastGradesheetCourseId, first.id);

  const deletedState = legacy.createEmptyState();
  deletedState.courses = [serializable(first), serializable(second)];
  deletedState.assessments = [{ id: 'resume-assessment', courseId: first.id }];
  deletedState.lastGradesheetCourseId = first.id;
  mod.removeCourseFromState(deletedState, first.id);
  assert.equal(deletedState.lastGradesheetCourseId, null);
  assert.deepEqual(deletedState.courses.map(course => course.id), [second.id]);
  assert.deepEqual(deletedState.assessments, []);
});

test('Wave 3.1 archived references and student report scope preserve legacy behavior', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  const state = {
    students: [],
    courses: [
      { id: 'active', archivedAt: null, enrollments: [{ studentId: 's1' }], termResults: [], archiveHistory: [] },
      { id: 'other-active', archivedAt: null, enrollments: [{ studentId: 's2' }], termResults: [], archiveHistory: [] },
      {
        id: 'archived',
        archivedAt: '2026-07-31T00:00:00.000Z',
        enrollments: [{ studentId: 'current' }],
        termResults: [{ studentId: 'result-only', term: '2025-H2', points: 11 }],
        archiveSnapshot: { enrollments: [{ studentId: 's1' }, { studentId: 'snapshot-only' }] },
        archiveHistory: [{ snapshot: { enrollments: [{ studentId: 'history-only' }] } }]
      },
      {
        id: 'restored',
        archivedAt: null,
        enrollments: [],
        termResults: [],
        archiveHistory: [{ snapshot: { enrollments: [{ studentId: 'restored-history-only' }] } }]
      }
    ],
    assessments: [{ courseId: 'archived', scores: { 'score-only': { valueRaw: '12' } } }]
  };
  const expectedIds = ['current', 'history-only', 'result-only', 's1', 'score-only', 'snapshot-only'];
  assert.deepEqual([...mod.listReferencedStudentIdsForCourse(state, 'archived')].sort(), expectedIds);
  assert.deepEqual(
    [...mod.listReferencedStudentIdsForCourse(state, 'archived')].sort(),
    [...legacy.listReferencedStudentIdsForCourse(state, 'archived')].sort()
  );
  for (const studentId of expectedIds.concat('restored-history-only', 'missing')) {
    assert.equal(mod.studentHasArchivedCourseReference(state, studentId), legacy.studentHasArchivedCourseReference(state, studentId));
  }
  assert.deepEqual(
    mod.listStudentReportCourses(state, 's1').map(course => course.id),
    legacy.listStudentReportCourses(state, 's1').map(course => course.id)
  );
  assert.deepEqual(mod.listStudentReportCourses(state, 's1').map(course => course.id), ['active', 'archived']);
  assert.deepEqual(mod.listStudentReportCourses(state, 's1', 'active').map(course => course.id), ['active']);
  assert.deepEqual(mod.listStudentReportCourses(state, 's1', 'archived'), []);
});

test('Wave 3.1 successor planning preserves every legacy branch and validation message', () => {
  const legacy = loadModules().DomainModel;
  const mod = loadCourses();
  const targetYear = 2027;
  const courses = [
    { id: 'seki', schemaMode: 'grades' },
    { id: 'q1-q2', schemaMode: 'uppersec', upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' } },
    { id: 'q3-q4', schemaMode: 'uppersec', upperSecContext: { courseType: 'advanced', qualificationYear: 'q3-q4' } },
    { id: 'incomplete', schemaMode: 'uppersec', upperSecContext: { courseType: 'basic', qualificationYear: null } }
  ];
  for (const course of courses) {
    assert.deepEqual(
      serializable(mod.planCourseSuccessor(course, targetYear)),
      serializable(legacy.planCourseSuccessor(course, targetYear))
    );
  }
  for (const invalidYear of [1999, 2201, 2027.5, 'ungültig']) {
    assert.equal(thrownMessage(() => mod.planCourseSuccessor(courses[0], invalidYear)), 'Das Zieljahr ist ungültig.');
    assert.equal(
      thrownMessage(() => mod.planCourseSuccessor(courses[0], invalidYear)),
      thrownMessage(() => legacy.planCourseSuccessor(courses[0], invalidYear))
    );
  }
});

test('Wave 3.1 successor candidates, course insertion, and removal preserve legacy behavior', () => {
  const legacy = loadModules({ seed: 47 }).DomainModel;
  const mod = loadCourses(47);
  const oldCourse = legacy.createCourse({
    id: 'source-course',
    name: 'Biologie GK',
    subject: 'Biologie',
    classLabel: 'Q1',
    schemaMode: 'uppersec',
    weightTemplateId: 'old-weight',
    includePrevTermGrades: true,
    termCutoffs: { h1EndMonth: 1, h1EndDay: 31 },
    showAttendance: false,
    importKey: 'old-import',
    termResults: [{ studentId: 's1', term: '2026-H1', points: 13 }],
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2', weightingDeviationReason: 'Alt' }
  });
  oldCourse.enrollments = [
    legacy.createEnrollment({ studentId: 's1', subgroup: 'A', homeClassAtEnrollment: '11a', writtenExamSubjectQ4: true }),
    legacy.createEnrollment({ studentId: 's2', subgroup: null, homeClassAtEnrollment: '11b', writtenExamSubjectQ4: true })
  ];
  const plan = { ...legacy.planCourseSuccessor(oldCourse, 2027), targetWeightTemplateId: 'new-weight' };
  const successor = mod.createSuccessorCourseCandidate(serializable(oldCourse), 2027, serializable(plan));
  const legacySuccessor = legacy.createSuccessorCourseCandidate(serializable(oldCourse), 2027, serializable(plan));
  assert.deepEqual(serializable(successor), serializable(legacySuccessor));
  assert.equal(successor.carriedForwardFromCourseId, 'source-course');
  assert.equal(successor.schoolYearStartYear, 2027);
  assert.equal(successor.weightTemplateId, 'new-weight');
  assert.deepEqual(serializable(successor.upperSecContext), { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null });
  assert.deepEqual(successor.enrollments.map(enrollment => enrollment.writtenExamSubjectQ4), [false, false]);
  assert.deepEqual(serializable(successor.termResults), []);
  assert.equal(successor.importKey, null);
  assert.equal(oldCourse.enrollments[0].writtenExamSubjectQ4, true);

  const endPlan = legacy.planCourseSuccessor({ ...oldCourse, upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4' } }, 2027);
  assert.equal(mod.createSuccessorCourseCandidate(oldCourse, 2027, endPlan), null);
  assert.equal(
    thrownMessage(() => mod.createSuccessorCourseCandidate(oldCourse, 2028, plan)),
    'Der Nachfolgeplan passt nicht zum Zieljahr.'
  );

  const modernState = { courses: [{ id: 'keep' }], assessments: [{ id: 'a1', courseId: 'remove' }, { id: 'a2', courseId: 'keep' }] };
  const legacyState = serializable(modernState);
  assert.equal(mod.addCourseToState(modernState, { id: 'remove' }), legacy.addCourseToState(legacyState, { id: 'remove' }));
  assert.deepEqual(serializable(modernState), serializable(legacyState));
  assert.equal(mod.removeCourseFromState(modernState, 'remove'), legacy.removeCourseFromState(legacyState, 'remove'));
  assert.deepEqual(serializable(modernState), serializable(legacyState));
  assert.deepEqual(modernState, { courses: [{ id: 'keep' }], assessments: [{ id: 'a2', courseId: 'keep' }] });
});
