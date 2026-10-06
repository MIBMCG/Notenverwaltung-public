'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const names = ['parseCsvTransferContextFields', 'validateCsvCourseContextConsistency',
  'csvCourseContextMatches', 'validateCsvStudentIdentity', 'findCompatibleCsvStudent'];
const plain = value => JSON.parse(JSON.stringify(value));

test('CSV rule module exposes only the five existing rules without browser effects', () => {
  const window = {};
  const { exports: r, sandbox } = loadEsmGraph('src/transfer/csv-import-rules.js', { globals: { window } });
  assert.deepEqual(Object.keys(r).sort(), names.slice().sort());
  assert.deepEqual(Object.keys(window), []);
  for (const name of names) assert.equal(Object.hasOwn(sandbox, name), false);
  assert.doesNotThrow(() => loadEsmGraph('src/transfer/csv-import-rules.js'));
});

test('context rules preserve supported values and first-context Map semantics', () => {
  const { exports: r } = loadEsmGraph('src/transfer/csv-import-rules.js');
  for (const [label, value] of [['GK', 'basic'], ['LK', 'advanced'], ['Sonstiger Kurs', 'other']]) {
    for (const [year, code] of [['Q1/Q2', 'q1-q2'], ['Q3/Q4', 'q3-q4']]) {
      const fields = Object.freeze(['Sek II', label, year, 'Nein']);
      const c = r.parseCsvTransferContextFields(fields);
      assert.equal(c.schemaMode, 'uppersec');
      assert.equal(c.upperSecContext.courseType, value);
      assert.equal(c.upperSecContext.qualificationYear, code);
      assert.equal(c.issues.length, 0);
    }
  }
  const first = r.parseCsvTransferContextFields(['Sek II', 'GK', 'Q3/Q4', 'Ja']);
  assert.equal(first.writtenExamSubjectQ4, true);
  assert.equal(first.writtenExamSubjectQ4Specified, true);
  const other = r.parseCsvTransferContextFields(['Sek II', 'LK', 'Q1/Q2', 'Nein']);
  const map = new Map();
  assert.equal(r.validateCsvCourseContextConsistency(map, 'bio', first).length, 0);
  const before = JSON.stringify([...map]);
  assert.equal(r.validateCsvCourseContextConsistency(map, 'bio', other).length, 1);
  assert.equal(JSON.stringify([...map]), before);
  const second = new Map();
  assert.equal(r.validateCsvCourseContextConsistency(second, 'bio', other).length, 0);
  assert.equal(second.get('bio').courseType, 'advanced');
  for (const fields of [[], ['unbekannt'], ['Sek II', 'LK', 'Q1/Q2', 'Ja']]) {
    const isolated = new Map();
    r.validateCsvCourseContextConsistency(isolated, 'bio', r.parseCsvTransferContextFields(fields));
    assert.equal(isolated.size, 0);
  }
  const legacy = r.parseCsvTransferContextFields(['Sek II']);
  assert.equal(legacy.upperSecContext, null);
  assert.equal(legacy.issues.length, 0);
  assert.equal(legacy.writtenExamSubjectQ4Specified, false);
  assert.equal(r.parseCsvTransferContextFields([]).contextProvided, false);
  for (const fields of [['Sek I', 'GK'], ['Sek II', '?', 'Q1/Q2'], ['Sek II', 'GK', '?'], ['Sek II', 'GK', 'Q3/Q4', '?']]) {
    assert.ok(r.parseCsvTransferContextFields(fields).issues.length > 0);
  }
  const course = Object.freeze({ schemaMode: 'uppersec', upperSecContext: Object.freeze({ courseType: 'basic', qualificationYear: 'q3-q4' }) });
  assert.equal(r.csvCourseContextMatches(course, first), true);
  assert.equal(r.csvCourseContextMatches(course, other), false);
  assert.equal(r.csvCourseContextMatches(course, r.parseCsvTransferContextFields([])), true);
  assert.equal(r.csvCourseContextMatches(null, first), false);
});

test('Nein is neutral in unsuitable exam contexts but remains explicit for GK Q3/Q4', () => {
  const { exports: r } = loadEsmGraph('src/transfer/csv-import-rules.js');
  const unsuitableContexts = [
    ['Sek II', 'LK', 'Q1/Q2', 'Nein'],
    ['Sek II', 'LK', 'Q3/Q4', 'Nein'],
    ['Sek II', 'GK', 'Q1/Q2', 'Nein'],
    ['Sek II', 'Sonstiger Kurs', 'Q3/Q4', 'Nein']
  ];

  for (const fields of unsuitableContexts) {
    const parsed = r.parseCsvTransferContextFields(fields);
    assert.deepEqual(plain(parsed.issues), [], `Nein must be neutral for ${fields[1]} ${fields[2]}`);
    assert.equal(parsed.writtenExamSubjectQ4, false);
    assert.equal(parsed.writtenExamSubjectQ4Specified, false);
  }

  const suitableNo = r.parseCsvTransferContextFields(['Sek II', 'GK', 'Q3/Q4', 'Nein']);
  assert.equal(suitableNo.writtenExamSubjectQ4, false);
  assert.equal(suitableNo.writtenExamSubjectQ4Specified, true);
  const suitableYes = r.parseCsvTransferContextFields(['Sek II', 'GK', 'Q3/Q4', 'Ja']);
  assert.equal(suitableYes.writtenExamSubjectQ4, true);
  assert.equal(suitableYes.writtenExamSubjectQ4Specified, true);
});

test('Ja in an unsuitable exam context is an issue without a specified flag value', () => {
  const { exports: r } = loadEsmGraph('src/transfer/csv-import-rules.js');
  const parsed = r.parseCsvTransferContextFields(['Sek II', 'LK', 'Q1/Q2', 'Ja']);

  assert.equal(parsed.issues.length, 1);
  assert.match(parsed.issues[0], /nur bei einem GK in Q3\/Q4/);
  assert.equal(parsed.writtenExamSubjectQ4, false);
  assert.equal(parsed.writtenExamSubjectQ4Specified, false);
});

test('identity rules preserve blanks, conflicts and ambiguous matches without mutation', () => {
  const { exports: r } = loadEsmGraph('src/transfer/csv-import-rules.js');
  const person = Object.freeze({ id: 'p1', lastName: 'Muster', firstName: 'Mia', birthDate: '2012-02-29' });
  const input = Object.freeze({ lastName: ' muster ', firstName: ' MIA ', birthDate: '2012-02-29' });
  assert.deepEqual(plain(r.validateCsvStudentIdentity(person, input)), []);
  for (const [key, label] of [['lastName', 'Nachname'], ['firstName', 'Vorname'], ['birthDate', 'Geburtsdatum']]) {
    assert.deepEqual(plain(r.validateCsvStudentIdentity(person, { ...input, [key]: 'anders' })), [label]);
    assert.equal(r.validateCsvStudentIdentity(person, { ...input, [key]: '' }).length, 0);
    assert.equal(r.validateCsvStudentIdentity({ ...person, [key]: '' }, input).length, 0);
  }
  assert.equal(r.validateCsvStudentIdentity(null, input).length, 1);
  assert.deepEqual(plain(r.findCompatibleCsvStudent([], input)), { studentId: null, ambiguous: false });
  assert.deepEqual(plain(r.findCompatibleCsvStudent(Object.freeze([person]), input)), { studentId: 'p1', ambiguous: false });
  assert.deepEqual(plain(r.findCompatibleCsvStudent([person, { ...person, id: 'p2' }], input)), { studentId: null, ambiguous: true });
  assert.deepEqual(plain(person), { id: 'p1', lastName: 'Muster', firstName: 'Mia', birthDate: '2012-02-29' });
});
