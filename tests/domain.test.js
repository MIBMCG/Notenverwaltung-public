'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules, localStorageStub } = require('./harness/load.js');

const { DomainModel } = loadModules();

const RECOMMENDED_IDS = [
  'wt_berlin_seki_50_50_example',
  'wt_berlin_sekii_one_exam',
  'wt_berlin_sekii_two_exams'
];

test('ensureStateShape accepts null, undefined and an empty object', () => {
  for (const input of [null, undefined, {}, []]) {
    const result = DomainModel.ensureStateShape(input);
    assert.ok(Array.isArray(result.students));
    assert.ok(Array.isArray(result.courses));
    assert.ok(Array.isArray(result.assessments));
    assert.equal(typeof result.settings, 'object');
  }
});

test('M26: a persisted reload clears all non-valid Sek-I score values without changing valid scores', async () => {
  const storage = localStorageStub();
  const writer = loadModules({ storage });
  const { DomainModel } = writer;
  const state = DomainModel.createEmptyState();
  const categoryId = state.settings.categories[0].id;
  const student = DomainModel.createStudent({ id: 'student_m26', lastName: 'Test', firstName: 'M26' });
  const sekiCourse = DomainModel.createCourse({
    id: 'course_m26_seki', name: 'Sek I M26', subject: 'Testfach', classLabel: 'T1'
  });
  const sekiiCourse = DomainModel.createCourse({
    id: 'course_m26_sekii', name: 'Sek II M26', subject: 'Testfach', classLabel: 'Q1',
    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
  });
  DomainModel.addStudentToState(state, student);
  DomainModel.addCourseToState(state, sekiCourse);
  DomainModel.addCourseToState(state, sekiiCourse);
  DomainModel.enrollStudentInCourse(state, sekiCourse.id, student.id);
  DomainModel.enrollStudentInCourse(state, sekiiCourse.id, student.id);

  const addAssessmentWithScore = (id, courseId, score) => {
    const assessment = DomainModel.createAssessment({
      id, courseId, categoryId, title: id, term: '2025-H1'
    });
    assessment.scores[student.id] = score;
    DomainModel.addAssessmentToState(state, assessment);
  };

  addAssessmentWithScore('assessment_m26_missing', sekiCourse.id, {
    valueRaw: '15.3', status: DomainModel.SCORE_STATUS.MISSING, valueNumeric: 15.3
  });
  addAssessmentWithScore('assessment_m26_excused', sekiCourse.id, {
    valueRaw: '2', status: DomainModel.SCORE_STATUS.EXCUSED, valueNumeric: 2
  });
  addAssessmentWithScore('assessment_m26_invalid', sekiCourse.id, {
    valueRaw: '1-', status: 'invalid', valueNumeric: 1.3
  });
  addAssessmentWithScore('assessment_m26_valid_seki', sekiCourse.id, {
    valueRaw: '1-', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 1.3
  });
  addAssessmentWithScore('assessment_m26_valid_sekii', sekiiCourse.id, {
    valueRaw: '12', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 12
  });

  storage.setItem('notenverwaltung_v1_state', JSON.stringify(state));
  await writer.sessionReady;
  await writer.Storage.lockSession();
  const reader = loadModules({ storage, lockManager: writer.lockManager });
  await reader.sessionCoordinator.acquire();
  const loaded = await reader.Storage.loadState();
  const scoreFor = id => loaded.assessments.find(assessment => assessment.id === id).scores[student.id];

  for (const id of ['assessment_m26_missing', 'assessment_m26_excused', 'assessment_m26_invalid']) {
    const score = scoreFor(id);
    assert.equal(score.valueRaw, null, `${id}: valueRaw wurde nicht geleert`);
    assert.equal(score.valueNumeric, null, `${id}: valueNumeric wurde nicht geleert`);
  }
  assert.equal(scoreFor('assessment_m26_missing').status, DomainModel.SCORE_STATUS.MISSING);
  assert.equal(scoreFor('assessment_m26_excused').status, DomainModel.SCORE_STATUS.EXCUSED);
  assert.equal(scoreFor('assessment_m26_invalid').status, 'invalid');
  assert.deepEqual(JSON.parse(JSON.stringify(scoreFor('assessment_m26_valid_seki'))), {
    valueRaw: '1-', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 1.3
  });
  assert.deepEqual(JSON.parse(JSON.stringify(scoreFor('assessment_m26_valid_sekii'))), {
    valueRaw: '12', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 12
  });

  const portableBackup = await writer.Storage.exportStateEncrypted('M26-Testpasswort-2026', state);
  const imported = await writer.Storage.importStateEncryptedFromText(portableBackup, 'M26-Testpasswort-2026');
  const normalizedImport = DomainModel.ensureStateShape(imported);
  const importedMissing = normalizedImport.assessments
    .find(assessment => assessment.id === 'assessment_m26_missing').scores[student.id];
  assert.equal(importedMissing.valueRaw, null, 'Importpfad hat valueRaw nicht normalisiert');
  assert.equal(importedMissing.valueNumeric, null, 'Importpfad hat valueNumeric nicht normalisiert');
  assert.deepEqual(JSON.parse(JSON.stringify(
    normalizedImport.assessments.find(assessment => assessment.id === 'assessment_m26_valid_seki').scores[student.id]
  )), {
    valueRaw: '1-', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 1.3
  });
});

test('ensureStateShape adds missing standard labels without overwriting custom ones', () => {
  const state = DomainModel.createEmptyState();
  state.settings.gradeMapping = { '1': 0.5, '2': 1.9, 'Eigen': 9 };
  const result = DomainModel.ensureStateShape(state);
  assert.equal(result.settings.gradeMapping['1'], 0.5, 'eigener Wert wurde ueberschrieben');
  assert.equal(result.settings.gradeMapping['2'], 1.9, 'eigener Wert wurde ueberschrieben');
  assert.equal(result.settings.gradeMapping['Eigen'], 9, 'benutzerdefinierter Schluessel ging verloren');
  // Exakter Standardwert, nicht nur der Typ: `typeof NaN === 'number'`, und ein
  // falsch ergaenzter Wert waere hier sonst nicht zu erkennen.
  assert.equal(result.settings.gradeMapping['3'], 3.0, 'Standardlabel fehlt oder ist falsch');
  assert.equal(result.settings.gradeMapping['1+'], 0.7, 'Standardlabel fehlt oder ist falsch');
});

test('H4: a non-array settings.categories is repaired, not fatal', () => {
  for (const broken of [{}, 'text', 5]) {
    const state = DomainModel.createEmptyState();
    const keep = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
    DomainModel.addCourseToState(state, keep);
    const keepStudent = DomainModel.createStudent({
      lastName: 'Testperson1', firstName: 'Vorname1', birthDate: '2010-01-01', homeClass: 'T1'
    });
    DomainModel.addStudentToState(state, keepStudent);
    state.settings.categories = broken;
    let result;
    assert.doesNotThrow(() => { result = DomainModel.ensureStateShape(state); },
      `categories = ${JSON.stringify(broken)}`);
    assert.ok(result && typeof result === 'object', 'kein State zurueckgegeben');
    assert.ok(Array.isArray(result.settings.categories),
      `categories wurde nicht repariert: ${JSON.stringify(broken)}`);
    assert.ok(result.courses.some(course => course && course.id === keep.id),
      `gueltiger Kurs ging verloren bei categories = ${JSON.stringify(broken)}`);
    assert.ok(result.students.some(student => student && student.id === keepStudent.id),
      `gueltiger Schueler ging verloren bei categories = ${JSON.stringify(broken)}`);
  }
});

test('H4: a null entry in courses is dropped, not fatal', () => {
  const state = DomainModel.createEmptyState();
  const keep = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, keep);
  state.courses.push(null);
  let result;
  assert.doesNotThrow(() => { result = DomainModel.ensureStateShape(state); });
  assert.ok(result && Array.isArray(result.courses), 'kein brauchbarer State zurueckgegeben');
  assert.ok(result.courses.every(course => course && typeof course === 'object'),
    'null-Eintrag blieb im Kursbestand');
  assert.ok(result.courses.some(course => course && course.id === keep.id), 'gueltiger Kurs ging verloren');
});

test('H4: a primitive settings object is replaced, not fatal', () => {
  const state = DomainModel.createEmptyState();
  const keep = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, keep);
  state.settings = 'kaputt';
  let result;
  assert.doesNotThrow(() => { result = DomainModel.ensureStateShape(state); });
  assert.ok(result && result.settings && typeof result.settings === 'object'
    && !Array.isArray(result.settings), 'settings wurde nicht ersetzt');
  assert.equal(typeof result.settings.gradeMapping, 'object', 'gradeMapping fehlt');
  assert.ok(result.courses.some(course => course && course.id === keep.id), 'gueltiger Kurs ging verloren');
});

test('H5: array-shaped settings must not survive a JSON round-trip empty', () => {
  const state = DomainModel.createEmptyState();
  const keepStudent = DomainModel.createStudent({
    lastName: 'Testperson1', firstName: 'Vorname1', birthDate: '2010-01-01', homeClass: 'T1'
  });
  DomainModel.addStudentToState(state, keepStudent);
  state.settings = [];
  const result = DomainModel.ensureStateShape(state);
  const roundTripped = JSON.parse(JSON.stringify(result));
  assert.ok(roundTripped.settings && !Array.isArray(roundTripped.settings), 'settings ist weiterhin ein Array');
  // Alle vier Unterobjekte pruefen, nicht nur gradeMapping als Stellvertreter:
  // ein Array verliert beim Serialisieren jede benannte Eigenschaft.
  assert.equal(typeof roundTripped.settings.gradeMapping, 'object', 'gradeMapping ging verloren');
  assert.ok(Array.isArray(roundTripped.settings.categories), 'categories ging verloren');
  assert.ok(Array.isArray(roundTripped.settings.weightTemplates), 'weightTemplates ging verloren');
  assert.ok(roundTripped.settings.halfYearSettings
    && typeof roundTripped.settings.halfYearSettings === 'object', 'halfYearSettings ging verloren');
  assert.equal(roundTripped.students.length, 1, 'gueltiger Schueler ging verloren');
});

test('H4: malformed members of root collections are dropped before lookups', () => {
  const state = DomainModel.createEmptyState();
  const student = DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ada' });
  state.students.push(student, null, 'kaputt');
  state.courses.push(null, 7);
  state.assessments.push(null, false);
  const result = DomainModel.ensureStateShape(state);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].id, student.id);
  assert.equal(result.courses.length, 0);
  assert.equal(result.assessments.length, 0);
});

test('H4: categories and subcategories without usable IDs are dropped', () => {
  const state = DomainModel.createEmptyState();
  const validCategory = state.settings.categories[0];
  validCategory.subcategories = [
    { id: 'sub_valid', name: 'Gueltig', weightPercent: 100 },
    {},
    { id: '   ', name: 'Leerzeichen-ID', weightPercent: 0 },
    null
  ];
  state.settings.categories.push(
    {},
    { id: null, name: 'Ohne ID' },
    { id: '   ', name: 'Leerzeichen-ID' }
  );

  const result = DomainModel.ensureStateShape(state);

  assert.equal(result.settings.categories.length, 3);
  assert.ok(result.settings.categories.every(category =>
    typeof category.id === 'string' && category.id.trim() !== ''
  ));
  const normalizedCategory = result.settings.categories.find(category => category.id === validCategory.id);
  assert.equal(normalizedCategory.subcategories.length, 1);
  assert.equal(normalizedCategory.subcategories[0].id, 'sub_valid');
});

test('H5: array-shaped nested settings are replaced with serializable objects', () => {
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings = [];
  state.settings.halfYearNames = [];
  state.settings.termCutoffs = [];
  const roundTripped = JSON.parse(JSON.stringify(DomainModel.ensureStateShape(state)));
  assert.ok(roundTripped.settings.halfYearSettings && !Array.isArray(roundTripped.settings.halfYearSettings));
  assert.ok(roundTripped.settings.halfYearNames && !Array.isArray(roundTripped.settings.halfYearNames));
  assert.ok(roundTripped.settings.termCutoffs && !Array.isArray(roundTripped.settings.termCutoffs));
});

test('M6: generated half-year settings end H1 in the year after school starts', () => {
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings = {};
  const result = DomainModel.ensureStateShape(state);
  for (const level of ['seckI', 'seckII']) {
    const settings = result.settings.halfYearSettings[level];
    assert.equal(settings.h1EndYear, settings.schoolYearStartYear + 1);
  }
});

test('M6: a missing h1EndYear derives from each stored school year', () => {
  const state = DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckI = { schoolYearStartYear: 2030 };
  state.settings.halfYearSettings.seckII = { schoolYearStartYear: 2034, h1EndYear: 2040 };
  const result = DomainModel.ensureStateShape(state);
  assert.equal(result.settings.halfYearSettings.seckI.h1EndYear, 2031);
  assert.equal(result.settings.halfYearSettings.seckII.h1EndYear, 2040);
});

test('M30: renamed Mitarbeit and Klassenarbeiten categories receive all Berlin profiles', () => {
  const state = DomainModel.createEmptyState();
  state.settings.categories[0].name = 'Mitarbeit';
  state.settings.categories[1].name = 'Klassenarbeiten';
  state.settings.weightTemplates = [];
  const result = DomainModel.ensureStateShape(state);
  for (const id of RECOMMENDED_IDS) {
    assert.ok(result.settings.weightTemplates.some(item => item.id === id), `Profil ${id} fehlt`);
  }
});

test('M30: ASCII Muendlich resolves the oral category', () => {
  const state = DomainModel.createEmptyState();
  const oralId = state.settings.categories[0].id;
  state.settings.categories[0].name = 'Muendlich';
  state.settings.weightTemplates = [];
  const result = DomainModel.ensureStateShape(state);
  const template = result.settings.weightTemplates.find(item => item.id === RECOMMENDED_IDS[0]);
  assert.ok(template, 'Berlin-Sek-I-Profil fehlt');
  assert.ok(template.items.some(item => item.categoryId === oralId && item.weightPercent === 40));
});

test('M30: legacy 67-33 template IDs survive arbitrary category renaming', () => {
  const state = DomainModel.createEmptyState();
  const oralId = state.settings.categories[0].id;
  const writtenId = state.settings.categories[1].id;
  state.settings.categories[0].name = 'Praxis';
  state.settings.categories[1].name = 'Theorie';
  state.settings.weightTemplates = [{
    id: 'legacy',
    name: 'Standard Sek I (67/33)',
    items: [
      { categoryId: oralId, weightPercent: 67 },
      { categoryId: writtenId, weightPercent: 33 }
    ]
  }];
  const result = DomainModel.ensureStateShape(state);
  const template = result.settings.weightTemplates.find(item => item.id === RECOMMENDED_IDS[0]);
  assert.ok(template, 'Berlin-Sek-I-Profil fehlt');
  assert.ok(template.items.some(item => item.categoryId === oralId && item.weightPercent === 40));
  assert.ok(template.items.some(item => item.categoryId === writtenId && item.weightPercent === 50));
});

test('M30: a stale legacy template is skipped for a later valid Altbestand template', () => {
  const state = DomainModel.createEmptyState();
  const oralId = state.settings.categories[0].id;
  const writtenId = state.settings.categories[1].id;
  state.settings.categories[0].name = 'Praxis';
  state.settings.categories[1].name = 'Theorie';
  state.settings.weightTemplates = [
    {
      id: 'legacy_stale',
      name: 'Standard Sek I (67/33)',
      items: [
        { categoryId: 'cat_deleted_oral', weightPercent: 67 },
        { categoryId: 'cat_deleted_written', weightPercent: 33 }
      ]
    },
    {
      id: 'legacy_valid',
      name: 'Altbestand Sek I (67/33) – Fachkonferenz prüfen',
      items: [
        { categoryId: oralId, weightPercent: 67 },
        { categoryId: writtenId, weightPercent: 33 }
      ]
    }
  ];

  const result = DomainModel.ensureStateShape(state);
  const template = result.settings.weightTemplates.find(item => item.id === RECOMMENDED_IDS[0]);
  assert.ok(template, 'Berlin-Sek-I-Profil fehlt');
  assert.ok(template.items.some(item => item.categoryId === oralId && item.weightPercent === 40));
  assert.ok(template.items.some(item => item.categoryId === writtenId && item.weightPercent === 50));
});

test('M30: repeated normalization does not duplicate recommended profiles', () => {
  const once = DomainModel.ensureStateShape(DomainModel.createEmptyState());
  const twice = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(once)));
  for (const id of RECOMMENDED_IDS) {
    assert.equal(twice.settings.weightTemplates.filter(item => item.id === id).length, 1);
  }
});

test('M30: arbitrary category positions do not invent semantic weighting roles', () => {
  const state = DomainModel.createEmptyState();
  state.settings.categories[0].name = 'Praxis';
  state.settings.categories[1].name = 'Theorie';
  state.settings.weightTemplates = [];
  const result = DomainModel.ensureStateShape(state);
  assert.equal(
    result.settings.weightTemplates.filter(item => RECOMMENDED_IDS.includes(item.id)).length,
    0
  );
});

test('M30: legacy template migration disambiguates names without changing IDs, items or course references', () => {
  const state = DomainModel.createEmptyState();
  const [oral, written] = state.settings.categories;
  const legacyItems = [
    { categoryId: oral.id, weightPercent: 67 },
    { categoryId: written.id, weightPercent: 33 }
  ];
  const legacyItemsSecond = [
    { categoryId: oral.id, weightPercent: 60 },
    { categoryId: written.id, weightPercent: 40 }
  ];
  const expectedLegacyItems = JSON.parse(JSON.stringify(legacyItems));
  const expectedLegacyItemsSecond = JSON.parse(JSON.stringify(legacyItemsSecond));
  state.settings.weightTemplates = [
    {
      id: 'already_migrated',
      name: 'Altbestand Sek I (67/33) – Fachkonferenz prüfen',
      items: [{ categoryId: oral.id, weightPercent: 55 }, { categoryId: written.id, weightPercent: 45 }]
    },
    { id: 'legacy_first', name: 'Standard Sek I (67/33)', items: legacyItems },
    { id: 'legacy_second', name: 'Standard Sek I (67/33)', items: legacyItemsSecond }
  ];
  const course = DomainModel.createCourse({
    id: 'course_legacy_template_collision',
    name: 'Legacy collision',
    subject: 'Testfach',
    classLabel: 'T1',
    weightTemplateId: 'legacy_second'
  });
  DomainModel.addCourseToState(state, course);

  const result = DomainModel.ensureStateShape(state);
  const templateById = id => result.settings.weightTemplates.find(template => template.id === id);
  assert.equal(templateById('already_migrated').name, 'Altbestand Sek I (67/33) – Fachkonferenz prüfen');
  assert.equal(templateById('legacy_first').name, 'Altbestand Sek I (67/33) – Fachkonferenz prüfen (2)');
  assert.equal(templateById('legacy_second').name, 'Altbestand Sek I (67/33) – Fachkonferenz prüfen (3)');
  assert.equal(result.courses[0].weightTemplateId, 'legacy_second');
  assert.deepEqual(templateById('legacy_first').items, expectedLegacyItems);
  assert.deepEqual(templateById('legacy_second').items, expectedLegacyItemsSecond);
});

test('M30: repeated legacy template migration remains deterministic and idempotent', () => {
  const state = DomainModel.createEmptyState();
  state.settings.weightTemplates = [
    { id: 'legacy_first', name: 'Standard Sek I (67/33)', items: [] },
    { id: 'legacy_second', name: 'Standard Sek I (67/33)', items: [] }
  ];

  const once = DomainModel.ensureStateShape(state);
  const twice = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(once)));
  const namesById = normalized => normalized.settings.weightTemplates
    .filter(template => ['legacy_first', 'legacy_second'].includes(template.id))
    .map(template => [template.id, template.name]);
  assert.equal(JSON.stringify(namesById(once)), JSON.stringify([
    ['legacy_first', 'Altbestand Sek I (67/33) – Fachkonferenz prüfen'],
    ['legacy_second', 'Altbestand Sek I (67/33) – Fachkonferenz prüfen (2)']
  ]));
  assert.equal(JSON.stringify(namesById(twice)), JSON.stringify(namesById(once)));
});

test('archiving captures a snapshot that later global edits cannot change', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  DomainModel.archiveCourse(state, course.id, 'manual', {});
  const originalName = state.settings.categories[0].name;
  state.settings.categories[0].name = 'Nachtraeglich umbenannt';
  assert.equal(course.archiveSnapshot.categories[0].name, originalName);
});

test('M17: restoring moves the complete archive episode into immutable history', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  DomainModel.archiveCourse(state, course.id, 'manual', {
    archiveRetentionUntil: '2032-07-31', archiveNote: 'Historische Notiz'
  });
  const archivedAt = course.archivedAt;
  const snapshot = JSON.parse(JSON.stringify(course.archiveSnapshot));

  assert.equal(DomainModel.restoreCourse(state, course.id), true);

  assert.equal(course.archivedAt, null);
  assert.equal(course.archiveSnapshot, null, 'aktive Kurse dürfen keinen aktuellen Archiv-Snapshot verwenden');
  assert.equal(course.archiveHistory.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(course.archiveHistory[0])), {
    archivedAt,
    schemaMode: DomainModel.SCHEMA_MODES.GRADES,
    archiveReason: 'manual',
    archiveRetentionUntil: '2032-07-31',
    archiveNote: 'Historische Notiz',
    snapshot
  });
});

test('M17: re-archiving creates a new snapshot without overwriting restored history', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  DomainModel.archiveCourse(state, course.id, 'manual', {});
  const firstCategoryName = course.archiveSnapshot.categories[0].name;
  DomainModel.restoreCourse(state, course.id);
  state.settings.categories[0].name = 'Neue Bewertungsgrundlage';

  DomainModel.archiveCourse(state, course.id, 'manual', {});

  assert.equal(course.archiveHistory.length, 1);
  assert.equal(course.archiveHistory[0].snapshot.categories[0].name, firstCategoryName);
  assert.equal(course.archiveSnapshot.categories[0].name, 'Neue Bewertungsgrundlage');
});

test('M17: archive history survives state normalization and legacy courses default to an empty history', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  DomainModel.archiveCourse(state, course.id, 'manual', {});
  DomainModel.restoreCourse(state, course.id);
  const normalized = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state)));
  assert.equal(normalized.courses[0].archiveHistory.length, 1);
  assert.equal(normalized.courses[0].archiveHistory[0].snapshot.categories[0].id, state.settings.categories[0].id);

  const legacy = DomainModel.createCourse({ name: 'Legacy', subject: 'Testfach', classLabel: 'T2' });
  delete legacy.archiveHistory;
  const legacyState = DomainModel.ensureStateShape({
    ...DomainModel.createEmptyState(), courses: [legacy]
  });
  assert.deepEqual(Array.from(legacyState.courses[0].archiveHistory), []);
});

test('M31: Sek-II archive snapshots freeze context, enrollment flags, template and category roles', () => {
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({
    name: 'Biologie GK Q3/Q4',
    subject: 'Biologie',
    classLabel: 'Q4',
    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
      weightingDeviationReason: 'Pädagogische Entscheidung'
    }
  });
  const student = DomainModel.createStudent({ lastName: 'Archiv', firstName: 'Ada' });
  DomainModel.addStudentToState(state, student);
  DomainModel.addCourseToState(state, course);
  DomainModel.enrollStudentInCourse(state, course.id, student.id);
  DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);

  DomainModel.archiveCourse(state, course.id, 'manual', {});
  const snapshot = course.archiveSnapshot;
  const activeTemplate = state.settings.weightTemplates.find(template => template.id === course.weightTemplateId);
  const writtenCategoryId = activeTemplate.items.find(item => Math.abs(item.weightPercent - 33.33) < 0.001).categoryId;

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.upperSecContext)), {
    courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: 'Pädagogische Entscheidung'
  });
  assert.equal(snapshot.enrollments[0].writtenExamSubjectQ4, true);
  assert.equal(snapshot.weightTemplate.id, course.weightTemplateId);
  assert.equal(snapshot.categoryRoles.upperSecWrittenCategoryId, writtenCategoryId);

  course.upperSecContext.courseType = DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED;
  course.enrollments[0].writtenExamSubjectQ4 = false;
  activeTemplate.items[0].weightPercent = 99;
  assert.equal(snapshot.upperSecContext.courseType, DomainModel.UPPERSEC_COURSE_TYPES.BASIC);
  assert.equal(snapshot.enrollments[0].writtenExamSubjectQ4, true);
  assert.notEqual(snapshot.weightTemplate.items[0].weightPercent, 99);
});

test('M31 final re-review: ambiguous percentage profiles freeze no arbitrary written category role', () => {
  const state = DomainModel.createEmptyState();
  const [firstCategory, secondCategory, thirdCategory] = state.settings.categories;
  state.settings.weightTemplates = [
    {
      id: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
      name: 'Mehrdeutig 1/3',
      items: [
        { categoryId: firstCategory.id, weightPercent: 33.33 },
        { categoryId: secondCategory.id, weightPercent: 33.33 },
        { categoryId: thirdCategory.id, weightPercent: 33.34 }
      ]
    },
    {
      id: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
      name: 'Mehrdeutig 1/2',
      items: [
        { categoryId: firstCategory.id, weightPercent: 50 },
        { categoryId: secondCategory.id, weightPercent: 50 },
        { categoryId: thirdCategory.id, weightPercent: 0 }
      ]
    }
  ];
  const course = DomainModel.createCourse({
    name: 'Mehrdeutiger LK',
    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  DomainModel.addCourseToState(state, course);

  DomainModel.archiveCourse(state, course.id, 'manual', {});

  assert.equal(course.archiveSnapshot.categoryRoles.upperSecWrittenCategoryId, null);
});

test('H2: the first subcategory starts at 100 percent and later ones at 0', () => {
  assert.equal(DomainModel.getDefaultSubcategoryWeight({ subcategories: [] }), 100);
  assert.equal(
    DomainModel.getDefaultSubcategoryWeight({
      subcategories: [{ id: 'subcat_existing', name: 'Vorhanden', weightPercent: 100 }]
    }),
    0
  );
});

test('M9: duplicate root IDs keep the first object but remove ambiguous inbound references', () => {
  const state = DomainModel.createEmptyState();
  const categoryId = state.settings.categories[0].id;
  state.students = [
    DomainModel.createStudent({ id: 'student_dup', lastName: 'Erste', firstName: 'Person' }),
    DomainModel.createStudent({ id: 'student_dup', lastName: 'Zweite', firstName: 'Person' }),
    DomainModel.createStudent({ id: 'student_ok', lastName: 'Gueltig', firstName: 'Person' })
  ];
  const firstCourse = DomainModel.createCourse({ id: 'course_dup', name: 'Erster Kurs', subject: 'Bio' });
  const secondCourse = DomainModel.createCourse({ id: 'course_dup', name: 'Zweiter Kurs', subject: 'Bio' });
  const validCourse = DomainModel.createCourse({ id: 'course_ok', name: 'Gueltiger Kurs', subject: 'Bio' });
  validCourse.enrollments = [
    { studentId: 'student_dup', subgroup: null },
    { studentId: 'student_ok', subgroup: null },
    { studentId: 'student_ok', subgroup: 'spaeteres Duplikat' },
    { studentId: 'student_missing', subgroup: null }
  ];
  state.courses = [firstCourse, secondCourse, validCourse];
  state.assessments = [
    DomainModel.createAssessment({ id: 'assessment_dup', courseId: 'course_dup', categoryId, title: 'Mehrdeutig' }),
    DomainModel.createAssessment({ id: 'assessment_ok', courseId: 'course_ok', categoryId, title: 'Gueltig' }),
    DomainModel.createAssessment({ id: 'assessment_ok', courseId: 'course_ok', categoryId, title: 'Doppelt' }),
    DomainModel.createAssessment({ id: 'assessment_orphan', courseId: 'course_missing', categoryId, title: 'Verwaist' })
  ];
  state.assessments[1].scores = {
    student_dup: { valueRaw: '2', valueNumeric: 2, status: 'valid' },
    student_ok: { valueRaw: '1', valueNumeric: 1, status: 'valid' },
    student_missing: { valueRaw: '3', valueNumeric: 3, status: 'valid' }
  };

  const result = DomainModel.ensureStateShape(state);

  assert.deepEqual(JSON.parse(JSON.stringify(result.students.map(item => item.lastName))), ['Erste', 'Gueltig']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.courses.map(item => item.name))), ['Erster Kurs', 'Gueltiger Kurs']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.assessments.map(item => item.title))), ['Gueltig']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.courses.find(item => item.id === 'course_ok').enrollments.map(item => item.studentId))), ['student_ok']);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(result.assessments[0].scores))), ['student_ok']);
});

test('M9: ambiguous students are removed from upper-sec term results', () => {
  const state = DomainModel.createEmptyState();
  state.students = [
    DomainModel.createStudent({ id: 'student_dup', lastName: 'A' }),
    DomainModel.createStudent({ id: 'student_dup', lastName: 'B' }),
    DomainModel.createStudent({ id: 'student_ok', lastName: 'C' })
  ];
  const course = DomainModel.createCourse({
    id: 'course_upper', name: 'Oberstufe', subject: 'Bio', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
  });
  course.termResults = [
    { studentId: 'student_dup', term: '2025-H1', points: 8 },
    { studentId: 'student_ok', term: '2025-H1', points: 12 }
  ];
  state.courses = [course];

  const result = DomainModel.ensureStateShape(state);

  assert.deepEqual(JSON.parse(JSON.stringify(result.courses[0].termResults)), [
    { studentId: 'student_ok', term: '2025-H1', points: 12 }
  ]);
});

test('M9: category and template repair preserves only safe references', () => {
  const state = DomainModel.createEmptyState();
  const firstCategory = state.settings.categories[0];
  const secondCategory = state.settings.categories[1];
  firstCategory.subcategories = [
    { id: 'sub_dup', name: 'Erste', weightPercent: 50 },
    { id: 'sub_dup', name: 'Zweite', weightPercent: 50 }
  ];
  state.settings.categories.push({ ...firstCategory, name: 'Doppelte Kategorie' });
  state.settings.weightTemplates = [
    { id: 'template_dup', name: 'Erste Vorlage', items: [{ categoryId: secondCategory.id, weightPercent: 100 }] },
    { id: 'template_dup', name: 'Zweite Vorlage', items: [{ categoryId: secondCategory.id, weightPercent: 100 }] },
    { id: 'template_safe', name: 'Sicher', items: [
      { categoryId: secondCategory.id, weightPercent: 100 },
      { categoryId: 'category_missing', weightPercent: 50 }
    ] }
  ];
  const course = DomainModel.createCourse({ id: 'course_settings', name: 'Kurs', subject: 'Bio', weightTemplateId: 'template_dup' });
  state.courses = [course];
  state.assessments = [
    DomainModel.createAssessment({ id: 'assessment_category_bad', courseId: course.id, categoryId: firstCategory.id, title: 'Mehrdeutige Kategorie' }),
    DomainModel.createAssessment({ id: 'assessment_sub_bad', courseId: course.id, categoryId: secondCategory.id, subcategoryId: 'sub_missing', title: 'Fehlende Unterkategorie' })
  ];

  const result = DomainModel.ensureStateShape(state);

  assert.equal(result.settings.categories.filter(item => item.id === firstCategory.id).length, 1);
  assert.equal(result.settings.categories[0].subcategories.length, 1);
  assert.equal(result.settings.weightTemplates.filter(item => item.id === 'template_dup').length, 1);
  assert.deepEqual(result.settings.weightTemplates.find(item => item.id === 'template_safe').items, [
    { categoryId: secondCategory.id, weightPercent: 100 }
  ]);
  assert.equal(result.courses[0].weightTemplateId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.assessments.map(item => item.id))), ['assessment_sub_bad']);
  assert.equal(result.assessments[0].subcategoryId, null);
});

test('M9/R02: ambiguous frozen archive categories stop normalization without data loss', () => {
  const state = DomainModel.createEmptyState();
  const student = DomainModel.createStudent({ id: 'student_archive', lastName: 'Archiv' });
  state.students = [student];
  const course = DomainModel.createCourse({ id: 'course_archive', name: 'Archiv', subject: 'Bio' });
  state.courses = [course];
  DomainModel.archiveCourse(state, course.id, 'manual', {});
  const snapshot = course.archiveSnapshot;
  const frozenCategory = snapshot.categories[0];
  snapshot.categories.push({ ...frozenCategory, name: 'Doppelt' });
  snapshot.enrollments = [
    { studentId: student.id, subgroup: null },
    { studentId: student.id, subgroup: 'doppelt' },
    { studentId: 'student_missing', subgroup: null }
  ];
  snapshot.weightTemplate = {
    id: 'snapshot_template',
    name: 'Historisch',
    items: [
      { categoryId: frozenCategory.id, weightPercent: 50 },
      { categoryId: 'snapshot_category_missing', weightPercent: 50 }
    ]
  };
  course.weightTemplateId = 'snapshot_template';
  course.archiveHistory = [{
    archivedAt: '2026-07-31T12:00:00.000Z',
    schemaMode: course.schemaMode,
    archiveReason: 'manual',
    archiveRetentionUntil: null,
    archiveNote: null,
    snapshot: JSON.parse(JSON.stringify(snapshot))
  }];
  state.assessments = [
    DomainModel.createAssessment({
      id: 'assessment_archive_ambiguous', courseId: course.id, categoryId: frozenCategory.id, title: 'Mehrdeutig eingefroren'
    })
  ];

  const before = JSON.parse(JSON.stringify(state));
  assert.throws(
    () => DomainModel.ensureStateShape(state),
    error => error && error.code === 'ARCHIVE_INTEGRITY_INVALID' &&
      String(error.message).includes(course.id) && /Backup/.test(String(error.message))
  );
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
});

test('M9: archived courses retain only their own frozen template reference', () => {
  const state = DomainModel.createEmptyState();
  const categoryId = state.settings.categories[0].id;
  const defaultTemplateId = state.settings.weightTemplates[0].id;
  state.settings.weightTemplates.push({
    id: 'global_template', name: 'Aktuell global', items: [{ categoryId, weightPercent: 100 }]
  });
  const matching = DomainModel.createCourse({
    id: 'course_archive_template_matching', name: 'Passend', subject: 'Bio', weightTemplateId: defaultTemplateId
  });
  const globalMismatch = DomainModel.createCourse({
    id: 'course_archive_template_global', name: 'Global', subject: 'Bio', weightTemplateId: defaultTemplateId
  });
  const unknown = DomainModel.createCourse({
    id: 'course_archive_template_unknown', name: 'Unbekannt', subject: 'Bio', weightTemplateId: defaultTemplateId
  });
  state.courses = [matching, globalMismatch, unknown];
  for (const course of state.courses) DomainModel.archiveCourse(state, course.id, 'manual', {});
  matching.archiveSnapshot.weightTemplate = {
    id: 'frozen_template_matching', name: 'Eingefroren', items: [{ categoryId, weightPercent: 100 }]
  };
  globalMismatch.archiveSnapshot.weightTemplate = {
    id: 'frozen_template_global', name: 'Andere eingefrorene Vorlage', items: [{ categoryId, weightPercent: 100 }]
  };
  unknown.archiveSnapshot.weightTemplate = {
    id: 'frozen_template_unknown', name: 'Eingefroren', items: [{ categoryId, weightPercent: 100 }]
  };
  matching.weightTemplateId = 'frozen_template_matching';
  globalMismatch.weightTemplateId = 'global_template';
  unknown.weightTemplateId = 'template_missing';

  const once = DomainModel.ensureStateShape(state);
  const twice = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(once)));

  assert.equal(once.courses.find(course => course.id === matching.id).weightTemplateId, 'frozen_template_matching');
  assert.equal(once.courses.find(course => course.id === globalMismatch.id).weightTemplateId, null);
  assert.equal(once.courses.find(course => course.id === unknown.id).weightTemplateId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(twice)), JSON.parse(JSON.stringify(once)));
});

test('M9/M27: local lineage and import keys are conservative and idempotent', () => {
  const state = DomainModel.createEmptyState();
  const predecessor = DomainModel.createCourse({ id: 'course_previous', name: 'Vorjahr', subject: 'Bio', schoolYearStartYear: 2024, importKey: '  EXT-1  ' });
  const successor = DomainModel.createCourse({ id: 'course_next', name: 'Folgejahr', subject: 'Bio', schoolYearStartYear: 2025, carriedForwardFromCourseId: predecessor.id });
  const selfRef = DomainModel.createCourse({ id: 'course_self', name: 'Selbst', subject: 'Bio', carriedForwardFromCourseId: 'course_self' });
  const orphanRef = DomainModel.createCourse({ id: 'course_orphan', name: 'Ohne', subject: 'Bio', carriedForwardFromCourseId: 'course_missing' });
  const duplicateKey = DomainModel.createCourse({ id: 'course_key_dup', name: 'Duplikat', subject: 'Bio', schoolYearStartYear: 2024, importKey: 'ext-1' });
  const ambiguousPreviousA = DomainModel.createCourse({ id: 'course_ambiguous', name: 'Mehrdeutig A', subject: 'Bio' });
  const ambiguousPreviousB = DomainModel.createCourse({ id: 'course_ambiguous', name: 'Mehrdeutig B', subject: 'Bio' });
  const ambiguousSuccessor = DomainModel.createCourse({ id: 'course_ambiguous_next', name: 'Mehrdeutige Folge', subject: 'Bio', carriedForwardFromCourseId: 'course_ambiguous' });
  state.courses = [predecessor, successor, selfRef, orphanRef, duplicateKey, ambiguousPreviousA, ambiguousPreviousB, ambiguousSuccessor];

  const once = DomainModel.ensureStateShape(state);
  const twice = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(once)));

  assert.equal(once.courses.find(item => item.id === successor.id).carriedForwardFromCourseId, predecessor.id);
  assert.equal(once.courses.find(item => item.id === selfRef.id).carriedForwardFromCourseId, null);
  assert.equal(once.courses.find(item => item.id === orphanRef.id).carriedForwardFromCourseId, null);
  assert.equal(once.courses.find(item => item.id === ambiguousSuccessor.id).carriedForwardFromCourseId, null);
  assert.equal(once.courses.find(item => item.id === predecessor.id).importKey, 'EXT-1');
  assert.equal(once.courses.find(item => item.id === duplicateKey.id).importKey, null);
  assert.deepEqual(JSON.parse(JSON.stringify(twice)), JSON.parse(JSON.stringify(once)));
});

test('ensureStateShape preserves unknown serializable student and enrollment fields', () => {
  const state = DomainModel.createEmptyState();
  const student = DomainModel.createStudent({
    id: 'stu_future',
    lastName: 'Muster',
    firstName: 'Mia',
    birthDate: '2010-04-03',
    homeClass: '10a'
  });
  student.futureProfile = { supportLanguage: 'fr', revision: 2 };
  const course = DomainModel.createCourse({
    id: 'course_future',
    name: 'Biologie 10',
    subject: 'Biologie',
    classLabel: '10a'
  });
  course.enrollments = [{
    studentId: student.id,
    subgroup: '',
    homeClassAtEnrollment: '',
    writtenExamSubjectQ4: 'ja',
    futurePlacement: { laboratoryGroup: 'B' }
  }];
  state.students = [student];
  state.courses = [course];

  const once = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state)));
  const twice = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(once)));

  assert.deepEqual(once.students[0].futureProfile, { supportLanguage: 'fr', revision: 2 });
  assert.deepEqual(once.courses[0].enrollments[0].futurePlacement, { laboratoryGroup: 'B' });
  assert.equal(once.courses[0].enrollments[0].subgroup, null);
  assert.equal(once.courses[0].enrollments[0].homeClassAtEnrollment, '10a');
  assert.equal(once.courses[0].enrollments[0].writtenExamSubjectQ4, false);
  assert.deepEqual(twice, once);
});
