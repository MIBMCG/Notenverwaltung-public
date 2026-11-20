'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment } = require('./harness/fixtures.js');

function loadValidators() {
  return loadEsmGraph('src/transfer/import-validation.js').exports;
}

function cloned(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRejectedWithoutMutation(validator, candidate, expected) {
  const before = cloned(candidate);
  assert.throws(() => validator(candidate), expected);
  assert.equal(JSON.stringify(candidate), JSON.stringify(before));
}

test('B3: raw import and merge use the effective year of each external course key', () => {
  const m = loadModules();
  const D = m.DomainModel;
  const base = D.createEmptyState();
  base.settings.halfYearSettings.seckI.schoolYearStartYear = 2026;
  const current = D.createCourse({id: 'current', name: 'Lokal', importKey: 'BIO', schoolYearStartYear: 2026});
  base.courses.push(current);
  const incoming = cloned(base);
  incoming.courses = [D.createCourse({id: 'foreign', name: 'Import', importKey: 'bio'})];
  const duplicates = cloned(base);
  duplicates.courses.push(incoming.courses[0]);
  assertRejectedWithoutMutation(loadValidators().validateImportedState, duplicates, /doppelte externe Kurskennung/);
  assert.equal(m.ImportMerge.mergeImportedStateIntoCurrent(base, incoming).state.courses.length, 1);
  incoming.settings.halfYearSettings.seckI.schoolYearStartYear = 2024;
  const result = m.ImportMerge.mergeImportedStateIntoCurrent(base, incoming).state;
  const imported = result.courses.find(course => course.id === 'foreign');
  assert.equal(imported.schoolYearStartYear, 2024);
  assert.equal(imported.importKey, 'bio');
  assert.equal(m.ImportMerge.mergeImportedStateIntoCurrent(result, incoming).state.courses.length, 2);
});

test('B3: absent legacy course year and absent period settings inherit target year on merge', () => {
  const m = loadModules();
  const base = m.DomainModel.createEmptyState();
  base.settings.halfYearSettings.seckI.schoolYearStartYear = 2024;
  base.courses.push(m.DomainModel.createCourse({ id: 'shared', name: 'Biologie', importKey: 'BIO' }));
  const historic = cloned(base);
  delete historic.settings.halfYearSettings;
  delete historic.courses[0].schoolYearStartYear;
  const merged = m.ImportMerge.mergeImportedStateIntoCurrent(base, historic);
  assert.equal(merged.state.courses.length, 1);
  assert.equal(merged.state.courses[0].importKey, 'BIO');
});

test('shared import validators accept a valid empty state without changing it', () => {
  const validators = loadValidators();
  const state = loadModules().DomainModel.createEmptyState();
  const before = JSON.stringify(state);

  assert.equal(validators.validateImportedState(state), true);
  assert.equal(validators.validateRawTermResults(state), true);
  assert.equal(validators.validateRawUpperSecContexts(state), true);
  assert.equal(JSON.stringify(state), before);
});

test('C1: raw import rejects a dangling active or global written category before migration', () => {
  const { validateRawUpperSecContexts } = loadValidators();
  for (const scope of ['global', 'course']) {
    const ctx = buildCourseState(loadModules(), { schemaMode: 'uppersec' });
    const owner = scope === 'global' ? ctx.state.settings : ctx.course;
    owner.categoryRoles = { upperSecWrittenCategoryId: 'missing-category' };
    assertRejectedWithoutMutation(validateRawUpperSecContexts, ctx.state, /unbekannte Klausurkategorie/);
  }
});

test('archive restore mappings must refer to unique historical categories and subcategories', () => {
  const { validateImportedState } = loadValidators();
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const valid = { id: ctx.categoryIds.written, targetId: ctx.categoryIds.other, subcategories: [] };
  for (const categories of [[{ ...valid, id: 'absent' }], [valid, valid], [{ ...valid, subcategories: [{ id: 'absent', targetId: 'new' }] }]]) {
    ctx.course.archiveRestoreReferences = { categories };
    assertRejectedWithoutMutation(validateImportedState, ctx.state, /Reaktivierung/);
  }
});

test('shared full-state validator rejects duplicate students and assessments with unknown courses without mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const duplicateStudents = modules.DomainModel.createEmptyState();
  duplicateStudents.students.push({ id: 'stu_duplicate' }, { id: 'stu_duplicate' });
  assertRejectedWithoutMutation(validators.validateImportedState, duplicateStudents, /Schüler: Doppelte ID/);

  const ctx = buildCourseState(modules);
  const assessment = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral });
  assessment.courseId = 'course_unknown';
  assertRejectedWithoutMutation(validators.validateImportedState, ctx.state, /Leistung verweist auf einen unbekannten Kurs/);
});

test('shared raw validators reject malformed and duplicate term results without mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  ctx.course.termResults = [
    { studentId: ctx.students[0].id, term: '2025-H1', points: 11 },
    { studentId: ctx.students[0].id, term: '2025-H1', points: 12 }
  ];
  assertRejectedWithoutMutation(validators.validateRawTermResults, ctx.state, /doppelte Festsetzung/);
  ctx.course.termResults = [{ studentId: ctx.students[0].id, term: 'Q4', points: 11.5 }];
  assertRejectedWithoutMutation(validators.validateRawTermResults, ctx.state, /ungueltige Festsetzung/);
});

test('shared upper-secondary validator accepts legacy courses and rejects invalid live and archived context without mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const legacy = buildCourseState(modules);
  delete legacy.course.upperSecContext;
  for (const enrollment of legacy.course.enrollments) delete enrollment.writtenExamSubjectQ4;
  assert.equal(validators.validateRawUpperSecContexts(legacy.state), true);

  const live = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  live.course.upperSecContext = { courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: null, weightingDeviationReason: null };
  live.course.upperSecContext.courseType = 'invalid';
  assertRejectedWithoutMutation(validators.validateRawUpperSecContexts, live.state, /ungueltige Kursart/);

  const archived = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  archived.course.upperSecContext = { courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: null, weightingDeviationReason: null };
  archived.course.enrollments[0].writtenExamSubjectQ4 = true;
  modules.DomainModel.archiveCourse(archived.state, archived.course.id, 'manual', {});
  archived.course.archiveSnapshot.enrollments[0].writtenExamSubjectQ4 = 'ja';
  assertRejectedWithoutMutation(validators.validateRawUpperSecContexts, archived.state, /Archiv-Snapshot.*ungueltiges Q4-Pruefungsfach/);
});

test('R02: raw backup validation keeps rejecting malformed archive snapshots without mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  for (const snapshot of [null, [], 'x', {}]) {
    const ctx = buildCourseState(modules, { studentCount: 1 });
    modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
    ctx.course.archiveSnapshot = snapshot;
    assertRejectedWithoutMutation(
      validators.validateImportedState,
      ctx.state,
      /archivierter Kurs.*vollständigen Bewertungs-Snapshot/i
    );
  }
});

test('R18/D3: raw import accepts missing live active but rejects other nonboolean values', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const accepted = modules.DomainModel.createEmptyState();
  delete accepted.settings.categories[0].active;
  accepted.settings.categories[1].active = false;
  assert.equal(validators.validateImportedState(accepted), true);

  for (const invalidActive of [null, 0, 1, 'true']) {
    const candidate = modules.DomainModel.createEmptyState();
    candidate.settings.categories[0].active = invalidActive;
    assertRejectedWithoutMutation(validators.validateImportedState, candidate, /Kategorie.*boolesch.*active/i);
  }
});

test('R18/D3: raw import rejects missing or nonboolean historical category activity', () => {
  const validators = loadValidators();
  const modules = loadModules();
  for (const invalidActive of [undefined, null, 1, 'false']) {
    const ctx = buildCourseState(modules, { studentCount: 1 });
    modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
    const category = ctx.course.archiveSnapshot.categories[0];
    if (invalidActive === undefined) delete category.active;
    else category.active = invalidActive;
    assertRejectedWithoutMutation(
      validators.validateImportedState,
      ctx.state,
      /Archiv-Snapshot.*Kategorie.*boolesch.*active/i
    );
  }
});

test('D3: raw import accepts weight values from 0 to 100 and rejects all other values', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const valid = modules.DomainModel.createEmptyState();
  valid.settings.weightTemplates[0].items[0].weightPercent = 0;
  valid.settings.weightTemplates[0].items[1].weightPercent = 100;
  assert.equal(validators.validateImportedState(valid), true);

  for (const invalidWeight of [-1, 101, NaN, Infinity, '50']) {
    const candidate = modules.DomainModel.createEmptyState();
    candidate.settings.weightTemplates[0].items[0].weightPercent = invalidWeight;
    assertRejectedWithoutMutation(validators.validateImportedState, candidate, /Gewichtungsvorlage.*0 und 100/i);
  }

  const archived = buildCourseState(modules, { studentCount: 1 });
  archived.course.weightTemplateId = archived.state.settings.weightTemplates[0].id;
  modules.DomainModel.archiveCourse(archived.state, archived.course.id, 'manual', {});
  archived.course.archiveSnapshot.weightTemplate.items[0].weightPercent = -1;
  assertRejectedWithoutMutation(
    validators.validateImportedState,
    archived.state,
    /Archiv-Snapshot.*Gewicht.*0 und 100/i
  );
});

test('D4/R19: raw import accepts canonicalizable terms and rejects unknown terms or provenance without mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const accepted = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, accepted, {
    categoryId: accepted.categoryIds.oral,
    date: '2026-02-05',
    term: ' 2025-h2 '
  });
  const beforeAccepted = JSON.stringify(accepted.state);
  assert.equal(validators.validateImportedState(accepted.state), true);
  assert.equal(JSON.stringify(accepted.state), beforeAccepted, 'raw validation must not canonicalize in place');

  for (const mutation of [
    candidate => { candidate.assessments[0].term = '2025-H3'; },
    candidate => { candidate.assessments[0].termAssignment = 'guessed'; }
  ]) {
    const candidate = cloned(accepted.state);
    mutation(candidate);
    assertRejectedWithoutMutation(validators.validateImportedState, candidate, /Leistung.*Halbjahr|Leistung.*Zuordnung/i);
  }

  assessment.termAssignment = 'manual';
  assert.equal(validators.validateImportedState(accepted.state), true);
});

test('merge identity preflight rejects unresolved term-result references without normalization or mutation', () => {
  const validators = loadValidators();
  const modules = loadModules();
  const incoming = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });
  incoming.course.termResults = [{ studentId: 'student_unknown', term: '2025-H1', points: 11 }];
  const before = JSON.stringify(incoming.state);

  assert.throws(
    () => validators.validateMergeIdentityPreflight(modules.DomainModel.createEmptyState(), incoming.state),
    /ungueltige Festsetzung|unbekannten Schüler/
  );
  assert.equal(JSON.stringify(incoming.state), before);
});
