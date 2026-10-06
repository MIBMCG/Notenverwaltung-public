'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules } = require('./harness/load.js');

const HEADER_8 = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
const HEADER_12 = `${HEADER_8};Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich`;
const HEADER_13 = `${HEADER_12};Stammklasse`;
const clone = value => JSON.parse(JSON.stringify(value));

function subject() {
  const modules = loadModules();
  const { exports } = loadEsmGraph('src/transfer/csv-import-orchestrator.js');
  return { domain: modules.DomainModel, importer: exports.createCsvImportOrchestrator({ DomainModel: modules.DomainModel }) };
}

test('R23-03: excluding the warned Q4 record preserves the existing false flag', () => {
  const { domain, importer } = subject();
  const base = domain.createEmptyState();
  const student = domain.createStudent({ id: 's1', lastName: 'Muster', firstName: 'Mia', birthDate: '2008-04-03' });
  const course = domain.createCourse({
    id: 'c1', name: 'Biologie GK', subject: 'Biologie', schemaMode: domain.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: domain.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: domain.QUALIFICATION_YEARS.Q3_Q4 }
  });
  course.importKey = 'bio-q4';
  domain.addStudentToState(base, student);
  domain.addCourseToState(base, course);
  domain.enrollStudentInCourse(base, course.id, student.id);
  domain.setWrittenExamSubjectQ4(base, course.id, student.id, false);
  const before = clone(base);
  const csv = [HEADER_12, 'bio-q4;Biologie GK;Biologie;;external-s1;Muster;;2008-04-03;Sek II;GK;Q3/Q4;Ja'].join('\n');

  const preview = importer.prepareCsvImport(csv, base);
  assert.deepEqual(clone(preview.errors.map(issue => issue.line)), [2]);
  const replay = importer.prepareCsvImport(csv, base, { excludeStartLines: [2] });

  assert.deepEqual(clone(replay.errors), []);
  assert.equal(replay.importCandidate.courses[0].enrollments[0].writtenExamSubjectQ4, false);
  assert.deepEqual(clone(replay.importCandidate), clone(domain.ensureStateShape(clone(base))));
  assert.deepEqual(clone(replay.skippedStartLines), [2]);
  assert.deepEqual(clone(replay.appliedStartLines), []);
  assert.equal(replay.createdEnrollments, 0);
  assert.deepEqual(clone(base), before);
});

test('excluded identity and home-class fields do not complete a later record with the same external ID', () => {
  const { domain, importer } = subject();
  const base = domain.createEmptyState();
  const csv = [
    HEADER_13,
    'bio;Biologie;Biologie;;external-1;Muster;;2010-04-03;Sek I;;;;9a',
    'bio;Biologie;Biologie;;external-1;Muster;Mia;;Sek I;;;;'
  ].join('\n');
  const preview = importer.prepareCsvImport(csv, base);
  assert.ok(preview.errors.some(issue => issue.line === 2 && !issue.fatal));

  const replay = importer.prepareCsvImport(csv, base, { excludeStartLines: [2] });
  assert.deepEqual(clone(replay.errors), []);
  assert.equal(replay.importCandidate.students.length, 1);
  assert.equal(replay.importCandidate.students[0].birthDate, null);
  assert.equal(replay.importCandidate.students[0].homeClass || '', '');
  assert.equal(replay.importCandidate.courses[0].enrollments.length, 1);
  assert.deepEqual(clone(replay.skippedStartLines), [2]);
  assert.deepEqual(clone(replay.appliedStartLines), [3]);
  assert.equal(base.students.length, 0);
});

test('quoted multiline records use their physical start and duplicate requested lines count once', () => {
  const { domain, importer } = subject();
  const csv = [
    HEADER_8,
    'bio;"Biologie\nKurs";Biologie;9a;external-1;Muster;;2010-04-03',
    'chem;Chemie;Chemie;9a;external-2;Beispiel;Ben;2010-05-04'
  ].join('\n');
  const preview = importer.prepareCsvImport(csv, domain.createEmptyState());
  assert.ok(preview.errors.some(issue => issue.line === 2));
  const replay = importer.prepareCsvImport(csv, domain.createEmptyState(), { excludeStartLines: [2, 2] });
  assert.deepEqual(clone(replay.errors), []);
  assert.deepEqual(clone(replay.skippedStartLines), [2]);
  assert.deepEqual(clone(replay.appliedStartLines), [4]);
  assert.equal(replay.importCandidate.courses.length, 1);
  assert.equal(replay.importCandidate.courses[0].name, 'Chemie');
});
