'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules } = require('./harness/load.js');

const HEADER_8 = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
const HEADER_12 = `${HEADER_8};Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich`;
const HEADER_14 = `${HEADER_12};Stammklasse;CSV-Schutz`;
const clone = value => JSON.parse(JSON.stringify(value));

function createSubject() {
  const modules = loadModules();
  const { exports: csv } = loadEsmGraph('src/transfer/csv-import-orchestrator.js');
  return {
    modules,
    orchestrator: csv.createCsvImportOrchestrator({ DomainModel: modules.DomainModel })
  };
}

test('CSV orchestrator prepares a legacy eight-column import without changing the base state', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();
  const before = clone(baseState);

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    'bio-10;Biologie 10;Biologie;10a;person-1;Muster;Mia;2010-04-03'
  ].join('\n'), baseState);

  assert.equal(result.errorMessage, undefined);
  assert.equal(result.transferHeader.columnCount, 8);
  assert.equal(result.createdCourses, 1);
  assert.equal(result.createdStudents, 1);
  assert.equal(result.createdEnrollments, 1);
  assert.equal(result.importCandidate.courses[0].schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
  assert.equal(result.importCandidate.students[0].birthDate, '2010-04-03');
  assert.equal(result.importCandidate.assessments.length, 2);
  assert.deepEqual(clone(result.appliedStartLines), [2]);
  assert.deepEqual(clone(result.skippedStartLines), []);
  assert.deepEqual(clone(baseState), before);
});

test('CSV orchestrator prepares complete upper-secondary context and personal Q4 flags', () => {
  const { orchestrator } = createSubject();
  const result = orchestrator.prepareCsvImport([
    HEADER_12,
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja',
    'bio-q4;Biologie GK;Biologie;;person-2;Beispiel;Ben;2008-07-05;Sek II;GK;Q3/Q4;Nein'
  ].join('\n'), { students: [], courses: [], assessments: [], settings: {} });

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.importCandidate.courses.length, 1);
  assert.deepEqual(clone(result.importCandidate.courses[0].upperSecContext), {
    courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null
  });
  assert.deepEqual(
    clone(result.importCandidate.courses[0].enrollments.map(item => item.writtenExamSubjectQ4)),
    [true, false]
  );
});

test('CSV orchestrator treats Nein as neutral for unsuitable Sek-II exam contexts', () => {
  const contexts = [
    ['LK', 'Q1/Q2'],
    ['LK', 'Q3/Q4'],
    ['GK', 'Q1/Q2'],
    ['Sonstiger Kurs', 'Q3/Q4']
  ];

  for (const [courseType, qualificationYear] of contexts) {
    const { modules, orchestrator } = createSubject();
    const baseState = modules.DomainModel.createEmptyState();
    const csv = [
      HEADER_12,
      `course-${courseType}-${qualificationYear};Biologie ${courseType};Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;${courseType};${qualificationYear};Nein`
    ].join('\n');
    let result;
    assert.doesNotThrow(() => { result = orchestrator.prepareCsvImport(csv, baseState); }, `${courseType} ${qualificationYear}`);
    assert.deepEqual(clone(result.errors), []);
    const enrollment = result.importCandidate.courses[0].enrollments[0];
    assert.equal(enrollment.writtenExamSubjectQ4, false);
  }
});

test('CSV orchestrator collects an unsuitable Ja as a row error without throwing', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();
  const before = clone(baseState);
  const csv = [
    HEADER_12,
    'bio-lk-q1;Biologie LK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;LK;Q1/Q2;Ja'
  ].join('\n');
  let result;

  assert.doesNotThrow(() => { result = orchestrator.prepareCsvImport(csv, baseState); });
  assert.deepEqual(clone(result.errors.map(error => [error.line, error.fatal, error.issues.join(' ')])), [
    [2, true, 'Ungültiger CSV-Kurskontext: Das 3. Pruefungsfach schriftlich ist nur bei einem GK in Q3/Q4 zulässig.']
  ]);
  assert.equal(result.importCandidate.courses.length, 0);
  assert.equal(result.importCandidate.students.length, 0);
  assert.deepEqual(clone(baseState), before);
});

test('R09: an exported internal course ID reuses its course even after a name change', () => {
  const { modules, orchestrator } = createSubject();
  const domain = modules.DomainModel;
  const baseState = domain.createEmptyState();
  const ownCourse = domain.createCourse({
    id: 'course-local-17', name: 'Biologie bisher', subject: 'Biologie', classLabel: '9a',
    schemaMode: domain.SCHEMA_MODES.GRADES
  });
  domain.addCourseToState(baseState, ownCourse);

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    'course-local-17;Biologie aktuell;Biologie;9a;person-1;Muster;Mia;2010-04-03'
  ].join('\n'), baseState);

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.createdCourses, 0);
  assert.equal(result.importCandidate.courses.length, 1);
  assert.equal(result.importCandidate.courses[0].id, 'course-local-17');
  assert.equal(result.importCandidate.courses[0].name, 'Biologie bisher');
  assert.deepEqual(clone(result.importCandidate.courses[0].enrollments.map(item => item.studentId)), [
    result.importCandidate.students[0].id
  ]);
});

test('R09: unknown explicit course IDs remain distinct when names and subjects match', () => {
  const { modules, orchestrator } = createSubject();
  const rows = [
    'foreign-course-a;Biologie 9;Biologie;9a;person-1;Muster;Mia;2010-04-03',
    'foreign-course-b;Biologie 9;Biologie;9a;person-1;Muster;Mia;2010-04-03'
  ];

  const result = orchestrator.prepareCsvImport([HEADER_8, ...rows].join('\n'), modules.DomainModel.createEmptyState());

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.createdCourses, 2);
  assert.equal(result.createdEnrollments, 2);
  assert.equal(result.importCandidate.courses.length, 2);
  assert.deepEqual(Array.from(result.importCandidate.courses, course => course.importKey).sort(), [
    'foreign-course-a', 'foreign-course-b'
  ]);
  assert.notEqual(result.importCandidate.courses[0].id, result.importCandidate.courses[1].id);
});

test('R09: ID-free name matching reuses one unique compatible course', () => {
  const { modules, orchestrator } = createSubject();
  const domain = modules.DomainModel;
  const baseState = domain.createEmptyState();
  const existingCourse = domain.createCourse({
    id: 'course-unique', name: 'Biologie 9', subject: 'Biologie', classLabel: '9a',
    schemaMode: domain.SCHEMA_MODES.GRADES
  });
  domain.addCourseToState(baseState, existingCourse);

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    ';Biologie 9;Biologie;9a;person-1;Muster;Mia;2010-04-03'
  ].join('\n'), baseState);

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.createdCourses, 0);
  assert.equal(result.importCandidate.courses.length, 1);
  assert.equal(result.importCandidate.courses[0].id, 'course-unique');
  assert.equal(result.importCandidate.courses[0].enrollments.length, 1);
});

test('R09: explicit course ID subject conflicts are fatal before creating students or courses', () => {
  const { modules, orchestrator } = createSubject();
  const domain = modules.DomainModel;
  const baseState = domain.createEmptyState();
  const ownCourse = domain.createCourse({
    id: 'course-local-chemistry', name: 'Naturwissenschaften', subject: 'Biologie', classLabel: '9a',
    schemaMode: domain.SCHEMA_MODES.GRADES
  });
  domain.addCourseToState(baseState, ownCourse);
  const before = clone(baseState);

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    'course-local-chemistry;Naturwissenschaften;Chemie;9a;person-bad;Beispiel;Ben;2010-04-03'
  ].join('\n'), baseState);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
  assert.equal(result.errors[0].fatal, true);
  assert.match(result.errors[0].issues.join(' '), /Fach.*KursID|KursID.*Fach/);
  assert.equal(result.importCandidate.courses.length, 1);
  assert.equal(result.importCandidate.students.length, 0);
  assert.deepEqual(clone(baseState), before);
});

test('R09: explicit schema conflicts are checked while absent legacy schema remains unspecified', () => {
  const { modules, orchestrator } = createSubject();
  const domain = modules.DomainModel;
  const baseState = domain.createEmptyState();
  const upperSecCourse = domain.createCourse({
    id: 'course-local-uppersec', name: 'Biologie GK', subject: 'Biologie', classLabel: 'Q3/Q4',
    schemaMode: domain.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4' }
  });
  domain.addCourseToState(baseState, upperSecCourse);

  const legacyResult = orchestrator.prepareCsvImport([
    HEADER_8,
    'course-local-uppersec;Biologie GK;Biologie;Q3/Q4;person-legacy;Muster;Mia;2008-04-03'
  ].join('\n'), baseState);
  assert.deepEqual(clone(legacyResult.errors), []);
  assert.equal(legacyResult.createdCourses, 0);
  assert.equal(legacyResult.importCandidate.courses.length, 1);
  assert.equal(legacyResult.importCandidate.courses[0].id, 'course-local-uppersec');

  const explicitSchemaResult = orchestrator.prepareCsvImport([
    HEADER_12,
    'course-local-uppersec;Biologie GK;Biologie;Q3/Q4;person-explicit;Muster;Mia;2008-04-03;Sek I;;;'
  ].join('\n'), baseState);
  assert.equal(explicitSchemaResult.errors.length, 1);
  assert.equal(explicitSchemaResult.errors[0].fatal, true);
  assert.match(explicitSchemaResult.errors[0].issues.join(' '), /Schema.*KursID|KursID.*Schema/);
  assert.equal(explicitSchemaResult.importCandidate.courses.length, 1);
  assert.equal(explicitSchemaResult.importCandidate.students.length, 0);
});

test('R09: ambiguous ID-free fallback rejects only that row and leaves no candidate remnants', () => {
  const { modules, orchestrator } = createSubject();
  const domain = modules.DomainModel;
  const baseState = domain.createEmptyState();
  for (const classLabel of ['9a', '9b']) {
    domain.addCourseToState(baseState, domain.createCourse({
      name: 'Biologie 9', subject: 'Biologie', classLabel, schemaMode: domain.SCHEMA_MODES.GRADES
    }));
  }

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    ';Chemie 10;Chemie;10a;person-good;Meier;Mia;2010-04-03',
    ';Biologie 9;Biologie;;person-ambiguous;Beispiel;Ben;2010-05-06'
  ].join('\n'), baseState);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
  assert.equal(result.errors[0].fatal, true);
  assert.match(result.errors[0].issues.join(' '), /mehrere passende Kurse|nicht eindeutig/i);
  assert.equal(result.createdCourses, 1);
  assert.equal(result.createdStudents, 1);
  assert.equal(result.createdEnrollments, 1);
  assert.equal(result.importCandidate.courses.length, 3);
  assert.deepEqual(Array.from(result.importCandidate.students, student => student.lastName), ['Meier']);
  assert.equal(result.importCandidate.courses.filter(course => course.name === 'Biologie 9')
    .every(course => course.enrollments.length === 0), true);
  assert.equal(baseState.students.length, 0);
});

test('R16: validated 14-column protection is decoded before identity creation; malformed masks leave no row remnants', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();
  const validRow = [
    'foreign-valid', 'Mathematik', 'Mathematik', '9a', 'person-good', "'=Beispiel", 'Ada',
    '2010-04-03', '', '', '', '', '9a', 'nv1:20'
  ].join(';');
  const invalidRow = [
    'foreign-invalid', 'Biologie', 'Biologie', '9a', 'person-bad', "'=Muster", 'Ben',
    '2010-05-06', '', '', '', '', '9a', 'nv1:2000'
  ].join(';');

  const result = orchestrator.prepareCsvImport([HEADER_14, validRow, invalidRow].join('\n'), baseState);

  assert.equal(result.errorMessage, undefined);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
  assert.equal(result.errors[0].fatal, true);
  assert.match(result.errors[0].issues.join(' '), /CSV-Schutz|Maske/);
  assert.equal(result.createdCourses, 1);
  assert.equal(result.createdStudents, 1);
  assert.equal(result.createdEnrollments, 1);
  assert.deepEqual(Array.from(result.importCandidate.courses, course => course.importKey), ['foreign-valid']);
  assert.deepEqual(Array.from(result.importCandidate.students, student => student.lastName), ['=Beispiel']);
});

test('R16: decoded 14-column imports preserve leading whitespace in new visible names', () => {
  const { modules, orchestrator } = createSubject();
  const { exports: csv } = loadEsmGraph('src/transfer/csv-format.js');
  const baseState = modules.DomainModel.createEmptyState();
  const rawFields = [
    'foreign-course-whitespace', '\t=Biologie', 'Biologie', '9a', 'person-whitespace',
    '  -Muster', ' \t+Mia', '2010-04-03', '', '', '', '', '9a'
  ];

  const result = orchestrator.prepareCsvImport([
    HEADER_14,
    csv.encodeCsvTransferRow(rawFields)
  ].join('\n'), baseState);

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.importCandidate.courses[0].name, rawFields[1]);
  assert.equal(result.importCandidate.students[0].lastName, rawFields[5]);
  assert.equal(result.importCandidate.students[0].firstName, rawFields[6]);

  const genuineApostropheFields = [...rawFields];
  genuineApostropheFields[0] = 'foreign-course-apostrophe';
  genuineApostropheFields[4] = 'person-apostrophe';
  genuineApostropheFields[5] = "'=Muster";
  const genuineApostropheResult = orchestrator.prepareCsvImport([
    HEADER_14,
    csv.encodeCsvTransferRow(genuineApostropheFields)
  ].join('\n'), baseState);
  assert.deepEqual(clone(genuineApostropheResult.errors), []);
  assert.equal(genuineApostropheResult.importCandidate.students[0].lastName, "'=Muster");
  assert.equal(genuineApostropheResult.legacyFormulaProtectionHint, false);
});

test('R16: possible legacy protection apostrophes are kept and reported instead of stripped', () => {
  const { modules, orchestrator } = createSubject();

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    'legacy-course;Musik 9;Musik;9a;person-legacy;\'=Chor;Mia;2010-04-03'
  ].join('\n'), modules.DomainModel.createEmptyState());

  assert.deepEqual(clone(result.errors), []);
  assert.equal(result.importCandidate.students[0].lastName, "'=Chor");
  assert.equal(result.legacyFormulaProtectionHint, true);
});

test('R08: accepted incomplete and complete rows consolidate identity before creating enrollments in either order', () => {
  const rowVariants = [
    [
      'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01',
      'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01'
    ],
    [
      'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01',
      'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01'
    ]
  ];
  const summarize = candidate => {
    const stableCandidate = clone(candidate);
    return {
      students: stableCandidate.students.map(student => ({
        lastName: student.lastName,
        firstName: student.firstName,
        birthDate: student.birthDate
      })),
      courses: stableCandidate.courses.map(course => ({
        name: course.name,
        enrolledStudents: course.enrollments.map(enrollment => {
          const student = stableCandidate.students.find(item => item.id === enrollment.studentId);
          return `${student.lastName}|${student.firstName}|${student.birthDate}`;
        })
      })).sort((left, right) => left.name.localeCompare(right.name))
    };
  };

  const summaries = rowVariants.map(rows => {
    const { modules, orchestrator } = createSubject();
    const result = orchestrator.prepareCsvImport([HEADER_8, ...rows].join('\n'), modules.DomainModel.createEmptyState());
    assert.equal(result.errors.length, 1, 'the incomplete row requires the same explicit warning decision');
    assert.equal(result.errors[0].fatal, undefined);
    assert.match(result.errors[0].issues.join(' '), /Vorname oder Nachname fehlt/);
    return summarize(result.importCandidate);
  });

  const expected = {
    students: [{ lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' }],
    courses: [
      { name: 'Mathematik 9', enrolledStudents: ['Meier|Max|2010-01-01'] },
      { name: 'Physik 9', enrolledStudents: ['Meier|Max|2010-01-01'] }
    ]
  };
  assert.deepEqual(summaries[0], expected);
  assert.deepEqual(summaries[1], expected);
});

test('CSV orchestrator returns the existing messages for malformed text, empty data and invalid headers', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();

  assert.deepEqual(clone(orchestrator.prepareCsvImport(null, baseState)), {
    errorMessage: 'CSV-Inhalt ist ungültig.'
  });
  assert.deepEqual(clone(orchestrator.prepareCsvImport(HEADER_8, baseState)), {
    errorMessage: 'Die CSV-Datei enthält keine Datenzeilen.'
  });
  assert.deepEqual(clone(orchestrator.prepareCsvImport(
    HEADER_8.replace('KursID', 'Falsch') + '\nrow', baseState
  )), {
    errorMessage: 'CSV-Import abgebrochen: Die Kopfzeile muss aus den ersten 8 bis 13 Spalten oder zusätzlich aus CSV-Schutz bestehen.'
  });
});

test('CSV orchestrator reports fatal date and column issues without changing the base state', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();
  const before = clone(baseState);

  const result = orchestrator.prepareCsvImport([
    HEADER_8,
    'bio-10;Biologie 10;Biologie;10a;person-1;Muster;Mia;2010-02-30',
    'mathe-10;Mathematik 10;Mathematik;10a;person-2;Beispiel;Ben;2010-04-03;unerlaubt'
  ].join('\n'), baseState);

  assert.deepEqual(clone(result.errors.map(issue => [issue.line, issue.fatal, issue.issues[0]])), [
    [2, true, 'Ungültiges Geburtsdatum; erwartet wird YYYY-MM-DD oder DD.MM.YYYY.'],
    [3, true, 'Die Spaltenanzahl passt nicht zur Kopfzeile; erwartet werden 8 Spalten.'],
    [3, true, 'Ungültiger CSV-Kurskontext: Unbekanntes Schema; erlaubt sind Sek I oder Sek II.']
  ]);
  assert.deepEqual(clone(baseState), before);
});

test('CSV orchestrator keeps context conflicts and duplicate Q4 flags fatal', () => {
  const { modules, orchestrator } = createSubject();
  const baseState = modules.DomainModel.createEmptyState();
  const existingCourse = modules.DomainModel.createCourse({
    name: 'Biologie GK', subject: 'Biologie', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'advanced', qualificationYear: 'q1-q2' }
  });
  existingCourse.importKey = 'bio-q4';
  modules.DomainModel.addCourseToState(baseState, existingCourse);
  const before = clone(baseState);

  const conflictingCourse = orchestrator.prepareCsvImport([
    HEADER_12,
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja'
  ].join('\n'), baseState);
  assert.equal(conflictingCourse.errors[0].fatal, true);
  assert.match(conflictingCourse.errors[0].issues.join(' '), /Kurskontext widerspricht dem bereits vorhandenen Kurs/);

  const duplicateQ4 = orchestrator.prepareCsvImport([
    HEADER_12,
    'neu-q4;Neue Biologie;Biologie;;person-2;Beispiel;Ben;2008-07-05;Sek II;GK;Q3/Q4;Ja',
    'neu-q4;Neue Biologie;Biologie;;person-2;Beispiel;Ben;2008-07-05;Sek II;GK;Q3/Q4;Nein'
  ].join('\n'), baseState);
  assert.equal(duplicateQ4.errors[0].fatal, true);
  assert.match(duplicateQ4.errors[0].issues.join(' '), /Widersprüchliche Angaben zum 3\. Pruefungsfach/);
  assert.deepEqual(clone(baseState), before);
});

test('CSV replay keeps existing shared references while excluding a warned new course', () => {
  const { modules, orchestrator } = createSubject();
  const base = modules.DomainModel.createEmptyState();
  const existingStudent = modules.DomainModel.createStudent({
    lastName: 'Muster', firstName: 'Mia', birthDate: '2010-01-01'
  });
  const existingCourse = modules.DomainModel.createCourse({ name: 'Alt-Kurs', subject: 'Biologie', classLabel: '9a' });
  existingCourse.importKey = 'existing-course';
  modules.DomainModel.addStudentToState(base, existingStudent);
  modules.DomainModel.addCourseToState(base, existingCourse);
  modules.DomainModel.enrollStudentInCourse(base, existingCourse.id, existingStudent.id);
  const before = clone(base);
  const csv = [
    HEADER_8,
    'existing-course;Alt-Kurs;Biologie;9a;student-1;Muster;Mia;2010-01-01',
    'new-course;Neu;Biologie;9a;student-1;Muster;;2010-01-01'
  ].join('\n');
  const preview = orchestrator.prepareCsvImport(csv, base);
  assert.ok(preview.errors.some(issue => issue.line === 3));

  const replay = orchestrator.prepareCsvImport(csv, base, { excludeStartLines: [3] });
  assert.deepEqual(clone(replay.errors), []);
  assert.equal(replay.createdCourses, 0);
  assert.equal(replay.createdStudents, 0);
  assert.equal(replay.createdEnrollments, 0);
  assert.deepEqual(clone(replay.appliedStartLines), [2]);
  assert.deepEqual(clone(replay.skippedStartLines), [3]);
  assert.equal(replay.importCandidate.courses.length, 1);
  assert.equal(replay.importCandidate.students.length, 1);
  assert.equal(replay.importCandidate.courses[0].id, existingCourse.id);
  assert.equal(replay.importCandidate.students[0].id, existingStudent.id);
  assert.deepEqual(clone(base), before);
});
