'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

function loadMergeHelper(modules) {
  return modules.ImportMerge.mergeImportedStateIntoCurrent;
}

function loadImportHelper(modules, name) {
  return modules.importValidation[name];
}

test('K3: merging a same-name category with subcategories keeps local averages', () => {
  const modules = loadModules();
  const { DomainModel, GradingLogic } = modules;
  const local = buildCourseState(modules);
  const incoming = buildCourseState(modules);
  const localAssessment = addAssessment(modules, local, {
    categoryId: local.categoryIds.written,
    title: 'Lokale Leistung',
    term: '2025-H2'
  });
  setScore(modules, localAssessment, local.students[0].id, '2');
  const before = GradingLogic.computeCategoryAverage(
    [localAssessment],
    local.course,
    local.students[0].id,
    local.categoryIds.written,
    local.state.settings
  );
  assert.equal(before, 2);

  const incomingWritten = incoming.state.settings.categories.find(
    category => category.id === incoming.categoryIds.written
  );
  incomingWritten.subcategories = [
    { id: 'incoming_written_exam', name: 'Klausuren', weightPercent: 100 }
  ];

  const mergeImportedStateIntoCurrent = loadMergeHelper(modules);
  const merged = mergeImportedStateIntoCurrent(local.state, incoming.state).state;
  const mergedCourse = merged.courses.find(course => course.name === local.course.name);
  const mergedStudent = merged.students.find(student => student.lastName === local.students[0].lastName);
  const mergedWritten = merged.settings.categories.find(category => category.name === 'Schriftlich');
  const mergedAssessments = DomainModel.listAssessmentsForCourse(merged, mergedCourse.id);

  assert.equal(mergedWritten.subcategories.length, 1, 'der Test muss den historischen K3-Ausloeser herstellen');
  assert.equal(
    GradingLogic.computeCategoryAverage(
      mergedAssessments,
      mergedCourse,
      mergedStudent.id,
      mergedWritten.id,
      merged.settings
    ),
    before,
    'der Merge darf vorhandene unzugeordnete Leistungen nicht aus der Berechnung entfernen'
  );
});

test('M32: raw import validation rejects duplicate and malformed term results', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  const validateRawTermResults = loadImportHelper(modules, 'validateRawTermResults');
  ctx.course.termResults = [
    { studentId: ctx.students[0].id, term: '2025-H1', points: 11 },
    { studentId: ctx.students[0].id, term: '2025-H1', points: 12 }
  ];
  assert.throws(() => validateRawTermResults(ctx.state), /doppelte Festsetzung/);
  ctx.course.termResults = [{ studentId: ctx.students[0].id, term: 'Q1', points: 11.5 }];
  assert.throws(() => validateRawTermResults(ctx.state), /ungueltige Festsetzung/);
});

test('M31: raw import validation accepts legacy courses without Sek-II context fields', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  delete ctx.course.upperSecContext;
  for (const enrollment of ctx.course.enrollments) delete enrollment.writtenExamSubjectQ4;
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.doesNotThrow(() => validateRawUpperSecContexts(ctx.state));
});

test('M31: raw import validation rejects malformed Sek-II context values before normalization', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');
  const validContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };

  for (const [mutation, expected] of [
    [context => { context.courseType = 'unbekannt'; }, /ungueltige Kursart/],
    [context => { context.qualificationYear = 'Q4'; }, /ungueltigen Qualifikationsabschnitt/],
    [context => { context.weightingDeviationReason = 'x'.repeat(1001); }, /Begruendung ist zu lang/]
  ]) {
    ctx.course.upperSecContext = { ...validContext };
    mutation(ctx.course.upperSecContext);
    assert.throws(() => validateRawUpperSecContexts(ctx.state), expected);
  }

  ctx.course.upperSecContext = { ...validContext };
  ctx.course.enrollments[0].writtenExamSubjectQ4 = 'ja';
  assert.throws(() => validateRawUpperSecContexts(ctx.state), /ungueltiges Q4-Pruefungsfach/);
});

test('M31: raw import validation rejects Sek-II context on a Sek-I course', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Sek-I-Kurs enthaelt Sek-II-Kontext/);
});

test('M31: raw import validation rejects contradictory duplicate enrollment flags', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.enrollments.push({
    ...ctx.course.enrollments[0],
    writtenExamSubjectQ4: !ctx.course.enrollments[0].writtenExamSubjectQ4
  });
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /widerspruechliche doppelte Einschreibung/);
});

test('M31 final review: raw import rejects an invalid archived Sek-II course type before normalization', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.archiveSnapshot.upperSecContext.courseType = 'unbekannt';
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Archiv-Snapshot.*ungueltige Kursart/);
});

test('M31 final review: raw import rejects a non-boolean archived Q4 flag before normalization', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.enrollments[0].writtenExamSubjectQ4 = true;
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.archiveSnapshot.enrollments[0].writtenExamSubjectQ4 = 'ja';
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Archiv-Snapshot.*ungueltiges Q4-Pruefungsfach/);
});

test('M31 final review: raw import rejects an unknown archived written-category role before normalization', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.archiveSnapshot.categoryRoles.upperSecWrittenCategoryId = 'cat_unbekannt';
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Archiv-Snapshot.*unbekannte Klausurkategorie/);
});

test('M31 final review: raw import rejects duplicate archived enrollments before normalization', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.archiveSnapshot.enrollments.push({ ...ctx.course.archiveSnapshot.enrollments[0] });
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Archiv-Snapshot.*doppelte Einschreibung/);
});

test('M31 final review: full import validation rejects a frozen template item with an unknown category', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.archiveSnapshot.weightTemplate.items[0].categoryId = 'cat_unbekannt';
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.throws(() => validateImportedState(ctx.state), /Archiv-Snapshot.*Gewichtungsvorlage.*unbekannte Kategorie/);
});

test('M31 final review: full import validation rejects a course/template mismatch in an archive snapshot', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.throws(() => validateImportedState(ctx.state), /Archiv-Snapshot.*Gewichtungsvorlage.*Kursreferenz/);
});

test('M17: full import validation rejects malformed archive history entries', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(ctx.state, ctx.course.id);
  delete ctx.course.archiveHistory[0].archivedAt;
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.throws(() => validateImportedState(ctx.state), /Archivverlauf.*ungueltiger Eintrag/);
});

test('M17: full import validation rejects unsafe historical snapshots', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(ctx.state, ctx.course.id);
  ctx.course.archiveHistory[0].snapshot.enrollments[0].studentId = 'stu_unbekannt';
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.throws(() => validateImportedState(ctx.state), /Archivverlauf.*unbekannten Sch(?:ue|ü)ler/);
});

test('M17: raw import validation rejects invalid Sek-II data in historical snapshots', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(ctx.state, ctx.course.id);
  ctx.course.archiveHistory[0].snapshot.upperSecContext.courseType = 'unbekannt';
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.throws(() => validateRawUpperSecContexts(ctx.state), /Archivverlauf.*ungueltige Kursart/);
});

test('M17 review: merge preserves a distinct stable student ID inside imported archive history', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const incoming = buildCourseState(modules, { studentCount: 1 });
  const incomingId = 'student_import_history';
  incoming.students[0].id = incomingId;
  incoming.students[0].lastName = 'Importperson';
  incoming.students[0].firstName = 'Historie';
  incoming.course.enrollments[0].studentId = incomingId;
  modules.DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(incoming.state, incoming.course.id);
  const mergeImportedStateIntoCurrent = loadMergeHelper(modules);

  const merged = mergeImportedStateIntoCurrent(local.state, incoming.state).state;
  const importedStudent = merged.students.find(student => student.lastName === 'Importperson');
  const importedCourse = merged.courses.find(course => course.id !== local.course.id);

  assert.ok(importedStudent);
  assert.equal(importedStudent.id, incomingId);
  assert.equal(importedCourse.archiveHistory[0].snapshot.enrollments[0].studentId, importedStudent.id);
});

test('M17 review: merge preserves unique archive history on a matching active course', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  local.course.schoolYearStartYear = 2025;
  const incoming = JSON.parse(JSON.stringify(local.state));
  const incomingCourse = incoming.courses[0];
  modules.DomainModel.archiveCourse(incoming, incomingCourse.id, 'manual', {});
  modules.DomainModel.restoreCourse(incoming, incomingCourse.id);
  const mergeImportedStateIntoCurrent = loadMergeHelper(modules);

  const first = mergeImportedStateIntoCurrent(local.state, incoming).state;
  assert.equal(first.courses[0].archiveHistory.length, 1);

  const second = mergeImportedStateIntoCurrent(first, incoming).state;
  assert.equal(second.courses[0].archiveHistory.length, 1, 'wiederholter Import darf keine Episode duplizieren');
});

test('M17 review: historical Sek-II context remains valid after the active course changes schema', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(ctx.state, ctx.course.id);
  ctx.course.schemaMode = modules.DomainModel.SCHEMA_MODES.GRADES;
  ctx.course.upperSecContext = null;
  const validateRawUpperSecContexts = loadImportHelper(modules, 'validateRawUpperSecContexts');

  assert.doesNotThrow(() => validateRawUpperSecContexts(ctx.state));
});

test('M17 re-review: import accepts and migrates pre-schema archive history', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  modules.DomainModel.restoreCourse(ctx.state, ctx.course.id);
  delete ctx.course.archiveHistory[0].schemaMode;
  delete ctx.course.archiveHistory[0].snapshot.schemaMode;
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.doesNotThrow(() => validateImportedState(ctx.state));
  const migrated = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(ctx.state)));
  assert.equal(migrated.courses[0].archiveHistory[0].schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
});

test('M32 re-review: raw import accepts a finalized result after unenrollment', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  const validateRawTermResults = loadImportHelper(modules, 'validateRawTermResults');
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, '2025-H1', 11);
  ctx.course.enrollments = [];

  assert.doesNotThrow(() => validateRawTermResults(ctx.state));
});

test('M32: merge remaps term results and keeps local conflicts', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  modules.DomainModel.setTermResult(local.state, local.course.id, local.students[0].id, '2025-H1', 10);
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.courses[0].termResults[0].points = 12;
  const merged = loadMergeHelper(modules)(local.state, incoming);
  const targetCourse = merged.state.courses.find(course => course.name === local.course.name);
  const targetStudent = merged.state.students.find(student => student.lastName === local.students[0].lastName);
  assert.equal(modules.DomainModel.getTermResult(targetCourse, targetStudent.id, '2025-H1'), 10);
  assert.equal(merged.summary.termResultConflicts, 1);
});

test('M31: merge keeps local Sek-II context and local personal Q4 flag while reporting both conflicts', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  local.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: 'Lokale Entscheidung'
  };
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.courses[0].upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: 'Importierte Entscheidung'
  };
  local.course.enrollments[0].writtenExamSubjectQ4 = false;
  incoming.courses[0].enrollments[0].writtenExamSubjectQ4 = true;

  const merged = loadMergeHelper(modules)(local.state, incoming);
  const targetCourse = merged.state.courses.find(course => course.name === local.course.name);
  const targetStudent = merged.state.students.find(student => student.lastName === local.students[0].lastName);

  assert.deepEqual(JSON.parse(JSON.stringify(targetCourse.upperSecContext)), local.course.upperSecContext);
  assert.equal(modules.DomainModel.findEnrollment(targetCourse, targetStudent.id).writtenExamSubjectQ4, false);
  assert.equal(merged.summary.upperSecContextConflicts, 1);
  assert.equal(merged.summary.writtenExamSubjectConflicts, 1);
});

test('M31: merge imports context and remaps personal Q4 flags for a new course and person', () => {
  const modules = loadModules();
  const local = buildCourseState(modules);
  const incoming = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  incoming.course.name = 'Neuer Sek-II-Kurs';
  incoming.students[0].lastName = 'Neueperson';
  incoming.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  incoming.course.enrollments[0].writtenExamSubjectQ4 = true;

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const course = merged.courses.find(item => item.name === 'Neuer Sek-II-Kurs');
  const person = merged.students.find(student => student.lastName === 'Neueperson');

  assert.equal(course.upperSecContext.courseType, modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC);
  assert.equal(modules.DomainModel.findEnrollment(course, person.id).writtenExamSubjectQ4, true);
});

test('M32: merge keeps an existing local archive immutable', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: 'uppersec' });
  const incoming = buildCourseState(modules, { schemaMode: 'uppersec' });
  modules.DomainModel.setTermResult(local.state, local.course.id, local.students[0].id, '2025-H1', 10);
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  modules.DomainModel.setTermResult(incoming.state, incoming.course.id, incoming.students[0].id, '2025-H2', 12);
  const merged = loadMergeHelper(modules)(local.state, incoming.state);
  const archived = merged.state.courses.find(course => course.archivedAt);
  assert.deepEqual(Array.from(archived.termResults, result => ({ ...result })), [
    { studentId: local.students[0].id, term: '2025-H1', points: 10 }
  ]);
});

test('M32: merge imports a new archive with remapped term results', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: 'uppersec' });
  const incoming = buildCourseState(modules, { schemaMode: 'uppersec' });
  incoming.course.name = 'Synthetischer Archivimport';
  incoming.students[0].lastName = 'Archivperson';
  modules.DomainModel.setTermResult(incoming.state, incoming.course.id, incoming.students[0].id, '2025-H1', 12);
  modules.DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});
  const merged = loadMergeHelper(modules)(local.state, incoming.state);
  const archive = merged.state.courses.find(course => course.name === 'Synthetischer Archivimport');
  const person = merged.state.students.find(student => student.lastName === 'Archivperson');
  assert.equal(modules.DomainModel.getTermResult(archive, person.id, '2025-H1'), 12);
});

test('M31 final review: merge preserves the distinct stable person ID in a frozen Q4 enrollment', () => {
  const modules = loadModules();
  const { DomainModel, GradingLogic } = modules;
  const local = buildCourseState(modules, { studentCount: 1 });
  const incoming = buildCourseState(modules, { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  const incomingPersonId = 'student_import_archive';
  incoming.students[0].id = incomingPersonId;
  incoming.students[0].lastName = 'ImportierteArchivperson';
  incoming.course.name = 'Importierter Q4-GK';
  incoming.course.schoolYearStartYear = 2025;
  incoming.course.upperSecContext = {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  incoming.course.weightTemplateId = DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  incoming.course.enrollments[0].studentId = incomingPersonId;
  incoming.course.enrollments[0].writtenExamSubjectQ4 = true;
  DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const archive = merged.courses.find(course => course.name === 'Importierter Q4-GK');
  const importedPerson = merged.students.find(student => student.lastName === 'ImportierteArchivperson');

  assert.equal(importedPerson.id, incomingPersonId);
  assert.equal(archive.enrollments[0].studentId, importedPerson.id);
  assert.equal(archive.archiveSnapshot.enrollments[0].studentId, importedPerson.id);
  assert.equal(
    GradingLogic.resolveUpperSecGradingContext(
      archive,
      importedPerson.id,
      '2025-H2',
      GradingLogic.getSettingsForCourse(archive, merged)
    ).expectedExamCount,
    1
  );
});

test('M31 final review: merge keeps a new archive bound to its frozen template ID', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const local = buildCourseState(modules, { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  const incoming = buildCourseState(modules, { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  const sharedTemplateName = 'Synthetische eingefrorene Vorlage';
  local.state.settings.weightTemplates.push({
    id: 'wt_lokal',
    name: sharedTemplateName,
    items: [{ categoryId: local.categoryIds.written, weightPercent: 100 }]
  });
  incoming.state.settings.weightTemplates.push({
    id: 'wt_import',
    name: sharedTemplateName,
    items: [{ categoryId: incoming.categoryIds.written, weightPercent: 100 }]
  });
  incoming.course.name = 'Archiv mit eigener Vorlage';
  incoming.course.schoolYearStartYear = 2025;
  incoming.course.weightTemplateId = 'wt_import';
  incoming.students[0].lastName = 'VorlagenArchivperson';
  DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const archive = merged.courses.find(course => course.name === 'Archiv mit eigener Vorlage');
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.equal(archive.weightTemplateId, archive.archiveSnapshot.weightTemplate.id);
  assert.doesNotThrow(() => validateImportedState(merged));
});

test('M32 review: same-name archives from different school years remain separate historical units', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: 'uppersec' });
  const incoming = buildCourseState(modules, { schemaMode: 'uppersec' });
  local.course.schoolYearStartYear = 2024;
  incoming.course.schoolYearStartYear = 2025;
  modules.DomainModel.setTermResult(local.state, local.course.id, local.students[0].id, '2024-H1', 10);
  modules.DomainModel.setTermResult(incoming.state, incoming.course.id, incoming.students[0].id, '2025-H1', 12);
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  modules.DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const archives = merged.courses.filter(course => course.archivedAt);
  const importedArchive = archives.find(course => course.schoolYearStartYear === 2025);
  const person = merged.students.find(student => student.id === incoming.students[0].id);

  assert.equal(archives.length, 2);
  assert.ok(importedArchive, 'der eingehende Jahrgang muss ein eigenes Archiv bleiben');
  assert.equal(modules.DomainModel.getTermResult(importedArchive, person.id, '2025-H1'), 12);
});

test('M32 review: same-name active Sek-I and Sek-II courses never merge across schemas', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: 'grades' });
  const incoming = buildCourseState(modules, { schemaMode: 'uppersec' });
  local.course.importKey = 'shared-stable-key';
  incoming.course.importKey = 'shared-stable-key';
  modules.DomainModel.setTermResult(incoming.state, incoming.course.id, incoming.students[0].id, '2025-H1', 12);

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const upperSecCourse = merged.courses.find(course => course.schemaMode === 'uppersec');
  const person = merged.students.find(student => student.id === incoming.students[0].id);

  assert.equal(merged.courses.length, 2);
  assert.ok(upperSecCourse, 'der Sek-II-Kurs darf nicht auf den Sek-I-Kurs abgebildet werden');
  assert.equal(modules.DomainModel.getTermResult(upperSecCourse, person.id, '2025-H1'), 12);
});

test('M32 review: a discarded finalized-result conflict in the same archive is reported', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { schemaMode: 'uppersec' });
  const incoming = buildCourseState(modules, { schemaMode: 'uppersec' });
  local.course.importKey = 'stable-archive-key';
  incoming.course.importKey = 'stable-archive-key';
  incoming.students[0].id = local.students[0].id;
  incoming.course.enrollments[0].studentId = local.students[0].id;
  modules.DomainModel.setTermResult(local.state, local.course.id, local.students[0].id, '2025-H1', 10);
  modules.DomainModel.setTermResult(incoming.state, incoming.course.id, incoming.students[0].id, '2025-H1', 12);
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  modules.DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});

  const merged = loadMergeHelper(modules)(local.state, incoming.state);
  const archive = merged.state.courses.find(course => course.importKey === 'stable-archive-key');

  assert.equal(modules.DomainModel.getTermResult(archive, local.students[0].id, '2025-H1'), 10);
  assert.equal(merged.summary.termResultConflicts, 1);
});

test('Task 8: archived snapshot enrollments preserve distinct stable people and their Q4 flags', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const local = buildCourseState(modules, { studentCount: 1 });
  const incoming = buildCourseState(modules, { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, studentCount: 1 });
  const localPerson = local.students[0];
  const incomingPrimary = incoming.students[0];
  const incomingAlias = DomainModel.createStudent({
    id: 'stu_import_alias',
    lastName: localPerson.lastName,
    firstName: localPerson.firstName,
    birthDate: localPerson.birthDate
  });
  incoming.state.students.push(incomingAlias);
  incoming.course.name = 'Archiv mit kollidierender Snapshot-Einschreibung';
  incoming.course.upperSecContext = {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  incoming.course.enrollments[0].writtenExamSubjectQ4 = true;
  DomainModel.archiveCourse(incoming.state, incoming.course.id, 'manual', {});
  incoming.course.archiveSnapshot.enrollments.push({
    ...incoming.course.archiveSnapshot.enrollments[0],
    studentId: incomingAlias.id,
    writtenExamSubjectQ4: false
  });

  const merged = loadMergeHelper(modules)(local.state, incoming.state);
  const archive = merged.state.courses.find(course => course.name === incoming.course.name);

  assert.equal(archive.archiveSnapshot.enrollments.length, 2);
  assert.deepEqual(
    Array.from(archive.archiveSnapshot.enrollments, item => [item.studentId, item.writtenExamSubjectQ4]),
    [[incomingPrimary.id, true], [incomingAlias.id, false]]
  );
  assert.equal(merged.summary.writtenExamSubjectConflicts, 0);
  assert.notEqual(incomingPrimary.id, incomingAlias.id, 'die Fixture muss zwei Quell-IDs herstellen');
});

test('M27: full import validation rejects unknown and self-referencing predecessors', () => {
  for (const predecessor of ['course_missing', 'course_self']) {
    const modules = loadModules();
    const ctx = buildCourseState(modules);
    ctx.course.id = 'course_self';
    ctx.course.carriedForwardFromCourseId = predecessor;
    const validateImportedState = loadImportHelper(modules, 'validateImportedState');
    assert.throws(
      () => validateImportedState(ctx.state),
      predecessor === 'course_self' ? /Vorgaengerkurs.*selbst/ : /Vorgaengerkurs.*unbekannten Kurs/
    );
  }
});

test('M27: full import validation rejects malformed and duplicate scoped import keys', () => {
  const modules = loadModules();
  const first = buildCourseState(modules);
  const second = modules.DomainModel.createCourse({
    id: 'course_second', name: 'Zweiter Kurs', subject: 'Bio',
    schemaMode: first.course.schemaMode, schoolYearStartYear: first.course.schoolYearStartYear,
    importKey: 'stable-key'
  });
  first.course.importKey = 'STABLE-KEY';
  first.state.courses.push(second);
  const validateImportedState = loadImportHelper(modules, 'validateImportedState');

  assert.throws(() => validateImportedState(first.state), /doppelte externe Kurskennung/);
  second.schoolYearStartYear = Number(first.course.schoolYearStartYear || 2025) + 1;
  first.course.schoolYearStartYear = Number(first.course.schoolYearStartYear || 2025);
  assert.doesNotThrow(() => validateImportedState(first.state));
  second.importKey = '  stable-key  ';
  assert.throws(() => validateImportedState(first.state), /ungueltige externe Kurskennung/);
});

test('M27: merge maps a successor to the stable predecessor ID despite changed course metadata', () => {
  const modules = loadModules();
  const local = buildCourseState(modules);
  local.course.id = 'course_collision';
  local.course.name = 'Lokaler Kurs';
  const incoming = buildCourseState(modules);
  incoming.course.id = 'course_collision';
  incoming.course.name = 'Importierter Vorgänger';
  const successor = modules.DomainModel.createCourse({
    id: 'course_successor', name: 'Importierter Nachfolger', subject: 'Bio',
    schoolYearStartYear: Number(incoming.course.schoolYearStartYear || 2025) + 1,
    carriedForwardFromCourseId: incoming.course.id
  });
  incoming.state.courses.push(successor);

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const mappedPredecessor = merged.courses.find(item => item.id === 'course_collision');
  const mappedSuccessor = merged.courses.find(item => item.name === 'Importierter Nachfolger');

  assert.ok(mappedPredecessor);
  assert.equal(mappedPredecessor.name, 'Lokaler Kurs');
  assert.equal(mappedSuccessor.carriedForwardFromCourseId, mappedPredecessor.id);
});

test('M27: merge maps lineage to an existing course and preserves a local conflict', () => {
  const modules = loadModules();
  const local = buildCourseState(modules);
  local.course.id = 'course_local_previous';
  local.course.name = 'Gemeinsamer Vorgänger';
  local.course.importKey = 'previous-key';
  const localSuccessor = modules.DomainModel.createCourse({
    id: 'course_local_successor', name: 'Gemeinsamer Nachfolger', subject: 'Bio',
    schoolYearStartYear: Number(local.course.schoolYearStartYear || 2025) + 1,
    carriedForwardFromCourseId: local.course.id
  });
  local.state.courses.push(localSuccessor);
  localSuccessor.importKey = 'successor-key';

  const incoming = buildCourseState(modules);
  incoming.course.id = 'course_incoming_previous';
  incoming.course.name = local.course.name;
  incoming.course.schoolYearStartYear = local.course.schoolYearStartYear;
  incoming.course.importKey = local.course.importKey;
  const otherPrevious = modules.DomainModel.createCourse({
    id: 'course_other_previous', name: 'Anderer Vorgänger', subject: 'Bio',
    schoolYearStartYear: local.course.schoolYearStartYear
  });
  const incomingSuccessor = modules.DomainModel.createCourse({
    id: 'course_incoming_successor', name: localSuccessor.name, subject: localSuccessor.subject,
    schoolYearStartYear: localSuccessor.schoolYearStartYear,
    carriedForwardFromCourseId: otherPrevious.id
  });
  incomingSuccessor.importKey = localSuccessor.importKey;
  incoming.state.courses.push(otherPrevious, incomingSuccessor);

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const successor = merged.courses.find(item => item.id === localSuccessor.id);

  assert.equal(successor.carriedForwardFromCourseId, local.course.id);
});

test('M27: merge fills empty lineage when predecessor and successor already exist locally', () => {
  const modules = loadModules();
  const local = buildCourseState(modules);
  local.course.id = 'course_local_previous';
  local.course.name = 'Gemeinsamer Vorgänger';
  local.course.importKey = 'previous-key';
  const localSuccessor = modules.DomainModel.createCourse({
    id: 'course_local_successor', name: 'Gemeinsamer Nachfolger', subject: 'Bio',
    schoolYearStartYear: Number(local.course.schoolYearStartYear || 2025) + 1
  });
  local.state.courses.push(localSuccessor);
  localSuccessor.importKey = 'successor-key';

  const incoming = buildCourseState(modules);
  incoming.course.id = 'course_incoming_previous';
  incoming.course.name = local.course.name;
  incoming.course.schoolYearStartYear = local.course.schoolYearStartYear;
  incoming.course.importKey = local.course.importKey;
  const incomingSuccessor = modules.DomainModel.createCourse({
    id: 'course_incoming_successor', name: localSuccessor.name, subject: localSuccessor.subject,
    schoolYearStartYear: localSuccessor.schoolYearStartYear,
    carriedForwardFromCourseId: incoming.course.id
  });
  incomingSuccessor.importKey = localSuccessor.importKey;
  incoming.state.courses.push(incomingSuccessor);

  const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
  const successor = merged.courses.find(item => item.id === localSuccessor.id);

  assert.equal(successor.carriedForwardFromCourseId, local.course.id);
});

test('M27: merge adopts an unclaimed import key but never overwrites a local key', () => {
  for (const localKey of [null, 'local-key']) {
    const modules = loadModules();
    const local = buildCourseState(modules);
    const incoming = buildCourseState(modules);
    local.course.importKey = localKey;
    incoming.course.importKey = 'incoming-key';
    incoming.course.id = local.course.id;
    incoming.course.name = local.course.name;
    incoming.course.subject = local.course.subject;
    incoming.course.classLabel = local.course.classLabel;
    incoming.course.schoolYearStartYear = local.course.schoolYearStartYear;

    const merged = loadMergeHelper(modules)(local.state, incoming.state).state;
    const target = merged.courses.find(item => item.id === local.course.id);

    assert.equal(target.importKey, localKey || 'incoming-key');
  }
});

function buildExistingArchivePair(modules) {
  const local = buildCourseState(modules, { studentCount: 1 });
  const incoming = JSON.parse(JSON.stringify(local.state));
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  modules.DomainModel.archiveCourse(incoming, incoming.courses[0].id, 'manual', {});
  return { local, incoming, incomingCourse: incoming.courses[0] };
}

function addIncomingStudent(modules, state, lastName) {
  const student = modules.DomainModel.createStudent({
    id: `stu_${lastName.toLowerCase()}`,
    lastName,
    firstName: 'Import',
    birthDate: '2010-02-02',
    homeClass: 'T1'
  });
  modules.DomainModel.addStudentToState(state, student);
  return student;
}

test('archive merge: an identical enrollment on an existing archive is not a conflict', () => {
  const modules = loadModules();
  const { local, incoming } = buildExistingArchivePair(modules);

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.archiveConflicts, 0);
  assert.equal(merged.state.courses[0].enrollments.length, 1);
});

test('archive merge: a different or new enrollment on an existing archive is reported once', () => {
  for (const change of ['different', 'new']) {
    const modules = loadModules();
    const { local, incoming, incomingCourse } = buildExistingArchivePair(modules);
    if (change === 'different') {
      incomingCourse.enrollments[0].writtenExamSubjectQ4 = true;
    } else {
      const added = addIncomingStudent(modules, incoming, 'Neueinschreibung');
      incomingCourse.enrollments.push({ studentId: added.id, writtenExamSubjectQ4: false });
    }

    const merged = loadMergeHelper(modules)(local.state, incoming);

    assert.equal(merged.summary.archiveConflicts, 1, `${change} enrollment must be reported once`);
    assert.equal(merged.state.courses[0].enrollments.length, 1);
  }
});

test('archive merge: a new person referenced only by skipped archived content is not retained', () => {
  const modules = loadModules();
  const { local, incoming, incomingCourse } = buildExistingArchivePair(modules);
  const skipped = addIncomingStudent(modules, incoming, 'NurArchiv');
  incomingCourse.enrollments.push({ studentId: skipped.id, writtenExamSubjectQ4: false });
  incomingCourse.archiveSnapshot.enrollments.push({ studentId: skipped.id, writtenExamSubjectQ4: false });

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.state.students.some(student => student.lastName === 'NurArchiv'), false);
  assert.equal(merged.summary.studentsAdded, 0);
});

test('archive merge: a person with skipped and accepted course references is retained', () => {
  const modules = loadModules();
  const { local, incoming, incomingCourse } = buildExistingArchivePair(modules);
  const mixed = addIncomingStudent(modules, incoming, 'GemischteReferenz');
  incomingCourse.enrollments.push({ studentId: mixed.id, writtenExamSubjectQ4: false });
  const acceptedCourse = modules.DomainModel.createCourse({
    id: 'course_accepted_reference',
    name: 'Angenommener Kurs',
    subject: 'Testfach',
    classLabel: 'T1'
  });
  modules.DomainModel.addCourseToState(incoming, acceptedCourse);
  modules.DomainModel.enrollStudentInCourse(incoming, acceptedCourse.id, mixed.id);

  const merged = loadMergeHelper(modules)(local.state, incoming);
  const imported = merged.state.students.find(student => student.lastName === 'GemischteReferenz');
  const accepted = merged.state.courses.find(course => course.name === 'Angenommener Kurs');

  assert.ok(imported);
  assert.equal(accepted.enrollments.some(enrollment => enrollment.studentId === imported.id), true);
});

test('archive merge: a standalone incoming person remains importable', () => {
  const modules = loadModules();
  const { local, incoming } = buildExistingArchivePair(modules);
  addIncomingStudent(modules, incoming, 'OhneKursbezug');

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.state.students.some(student => student.lastName === 'OhneKursbezug'), true);
  assert.equal(merged.summary.studentsAdded, 1);
});

test('merge summary: identical active scores are not conflicts even when score property order differs', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, {
    categoryId: local.categoryIds.written,
    title: 'Gemeinsame Leistung'
  });
  assessment.scores[local.students[0].id] = {
    valueRaw: '2',
    status: modules.DomainModel.SCORE_STATUS.VALID,
    valueNumeric: 2
  };
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments[0].scores[local.students[0].id] = {
    valueNumeric: 2,
    status: modules.DomainModel.SCORE_STATUS.VALID,
    valueRaw: '2'
  };

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.scoreConflicts, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(merged.state.assessments[0].scores[local.students[0].id])),
    JSON.parse(JSON.stringify(assessment.scores[local.students[0].id]))
  );
});

test('merge summary: a mostly identical import reports only the source-only course and assessment', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const commonAssessment = addAssessment(modules, local, {
    categoryId: local.categoryIds.oral,
    title: 'Gemeinsame Leistung'
  });
  setScore(modules, commonAssessment, local.students[0].id, '2');
  const targetOnlyCourse = modules.DomainModel.createCourse({
    id: 'course_target_only', name: 'Nur im Ziel', subject: 'Testfach', classLabel: 'T1'
  });
  modules.DomainModel.addCourseToState(local.state, targetOnlyCourse);
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.courses = incoming.courses.filter(course => course.id !== targetOnlyCourse.id);
  const sourceOnlyCourse = modules.DomainModel.createCourse({
    id: 'course_source_only', name: 'Nur in der Quelle', subject: 'Testfach', classLabel: 'T1'
  });
  modules.DomainModel.addCourseToState(incoming, sourceOnlyCourse);
  modules.DomainModel.enrollStudentInCourse(incoming, sourceOnlyCourse.id, incoming.students[0].id);
  const sourceOnlyAssessment = modules.DomainModel.createAssessment({
    id: 'assessment_source_only',
    courseId: sourceOnlyCourse.id,
    categoryId: local.categoryIds.oral,
    title: 'Nur in der Quelle'
  });
  sourceOnlyAssessment.scores[incoming.students[0].id] = modules.DomainModel.createScoreEntry({ valueRaw: '3' });
  modules.DomainModel.addAssessmentToState(incoming, sourceOnlyAssessment);

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.coursesAdded, 1);
  assert.equal(merged.summary.assessmentsAdded, 1);
  assert.equal(merged.summary.scoreConflicts, 0);
  assert.equal(merged.summary.archiveConflicts, 0);
  assert.equal(merged.state.courses.length, 3);
  assert.equal(merged.state.assessments.filter(item => item.title === commonAssessment.title).length, 1);
});

test('merge summary: every genuine active score change counts once and keeps the local score', () => {
  const cases = [
    ['raw zero', { valueRaw: '2', status: 'valid', valueNumeric: null }, { valueRaw: '0', status: 'valid', valueNumeric: null }],
    ['cleared raw', { valueRaw: '2', status: 'valid', valueNumeric: null }, { valueRaw: '', status: 'valid', valueNumeric: null }],
    ['missing status', { valueRaw: '2', status: 'valid', valueNumeric: null }, { valueRaw: null, status: 'missing', valueNumeric: null }],
    ['numeric value', { valueRaw: '2', status: 'valid', valueNumeric: 2 }, { valueRaw: '2', status: 'valid', valueNumeric: 3 }]
  ];

  for (const [label, localScore, incomingScore] of cases) {
    const modules = loadModules();
    const local = buildCourseState(modules, { studentCount: 1 });
    const assessment = addAssessment(modules, local, {
      categoryId: local.categoryIds.written,
      title: `Leistung ${label}`
    });
    assessment.scores[local.students[0].id] = localScore;
    const incoming = JSON.parse(JSON.stringify(local.state));
    incoming.assessments[0].scores[local.students[0].id] = incomingScore;

    const merged = loadMergeHelper(modules)(local.state, incoming);

    assert.equal(merged.summary.scoreConflicts, 1, label);
    assert.deepEqual(
      JSON.parse(JSON.stringify(merged.state.assessments[0].scores[local.students[0].id])),
      localScore,
      label
    );
  }
});

test('merge summary: identical archived assessment and score match by stable IDs and ignore current category remapping', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, {
    categoryId: local.categoryIds.written,
    title: 'Historische Leistung',
    date: '2026-01-15'
  });
  assessment.scores[local.students[0].id] = {
    valueRaw: '2',
    status: modules.DomainModel.SCORE_STATUS.VALID,
    valueNumeric: 2
  };
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments[0].scores = {
    [local.students[0].id]: {
      valueNumeric: 2,
      status: modules.DomainModel.SCORE_STATUS.VALID,
      valueRaw: '2'
    }
  };
  const incomingWritten = incoming.settings.categories.find(category => category.id === local.categoryIds.written);
  const incomingWrittenId = incomingWritten.id;
  incomingWritten.id = 'category_current_source';
  for (const template of incoming.settings.weightTemplates) {
    for (const item of template.items || []) {
      if (item.categoryId === incomingWrittenId) item.categoryId = incomingWritten.id;
    }
  }
  const localWritten = local.state.settings.categories.find(category => category.id === local.categoryIds.written);
  const localWrittenId = localWritten.id;
  localWritten.id = 'category_current_target';
  for (const template of local.state.settings.weightTemplates) {
    for (const item of template.items || []) {
      if (item.categoryId === localWrittenId) item.categoryId = localWritten.id;
    }
  }

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.archiveConflicts, 0);
  assert.equal(merged.state.assessments.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(merged.state.assessments[0].scores[local.students[0].id])),
    JSON.parse(JSON.stringify(assessment.scores[local.students[0].id]))
  );
});

test('merge summary: archived metadata and changed or new scores are counted individually while the archive stays immutable', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, {
    categoryId: local.categoryIds.written,
    title: 'Historische Leistung',
    date: '2026-01-15'
  });
  setScore(modules, assessment, local.students[0].id, '2');
  modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  const incoming = JSON.parse(JSON.stringify(local.state));
  const addedStudent = addIncomingStudent(modules, incoming, 'NeueArchivperson');
  incoming.assessments[0].title = 'Geänderter Titel';
  incoming.assessments[0].date = '2026-01-16';
  incoming.assessments[0].scores[local.students[0].id].valueRaw = '3';
  incoming.assessments[0].scores[addedStudent.id] = modules.DomainModel.createScoreEntry({ valueRaw: '4' });
  const beforeAssessment = JSON.parse(JSON.stringify(local.state.assessments[0]));

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.archiveConflicts, 3, 'one metadata change, one changed score and one new score');
  assert.equal(merged.state.assessments[0].title, beforeAssessment.title);
  assert.equal(merged.state.assessments[0].date, beforeAssessment.date);
  assert.deepEqual(
    JSON.parse(JSON.stringify(merged.state.assessments[0].scores)),
    beforeAssessment.scores,
    'local scores stay unchanged and the archive-only score is not inserted'
  );
  assert.equal(merged.summary.studentsAdded, 0);
});

test('merge summary: archived weight and visibility changes are never missed', () => {
  for (const [field, value] of [['weight', 2], ['visible', false]]) {
    const modules = loadModules();
    const local = buildCourseState(modules, { studentCount: 1 });
    const assessment = addAssessment(modules, local, {
      categoryId: local.categoryIds.written,
      title: `Historische ${field}`
    });
    modules.DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
    const incoming = JSON.parse(JSON.stringify(local.state));
    incoming.assessments[0][field] = value;

    const merged = loadMergeHelper(modules)(local.state, incoming);

    assert.equal(merged.summary.archiveConflicts, 1, field);
    assert.equal(merged.state.assessments[0][field], assessment[field], field);
  }
});

test('merge summary: an incoming-only archived assessment still counts its metadata and scores', () => {
  const modules = loadModules();
  const { local, incoming } = buildExistingArchivePair(modules);
  const incomingAssessment = modules.DomainModel.createAssessment({
    id: 'assessment_archive_only',
    courseId: incoming.courses[0].id,
    categoryId: incoming.courses[0].archiveSnapshot.categories[0].id,
    title: 'Nur im Quellarchiv'
  });
  incomingAssessment.scores[incoming.students[0].id] = modules.DomainModel.createScoreEntry({ valueRaw: '2' });
  modules.DomainModel.addAssessmentToState(incoming, incomingAssessment);

  const merged = loadMergeHelper(modules)(local.state, incoming);

  assert.equal(merged.summary.archiveConflicts, 2);
  assert.equal(merged.state.assessments.length, 0);
});
