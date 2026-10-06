'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { loadCsvImporter } = require('./harness/csv-transfer.js');
const { createCsvDocumentStub, collectCsvElementText } = require('./harness/csv-document.js');

const HEADER_8 = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
const clone = value => JSON.parse(JSON.stringify(value));

function button(element, label) {
  if (!element) return null;
  if (element.tagName === 'BUTTON' && element.textContent.includes(label)) return element;
  for (const child of element.children || []) {
    const found = button(child, label);
    if (found) return found;
  }
  return null;
}

function setup(base) {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  const saved = [];
  modules.sandbox.window.alert = text => alerts.push(String(text));
  modules.Storage.saveState = async candidate => saved.push(clone(candidate));
  const importer = loadCsvImporter(modules, base || modules.DomainModel.createEmptyState());
  return { modules, document, alerts, saved, importer };
}

test('all warned records skipped leaves published state untouched and does not save', async () => {
  const h = setup();
  const before = clone(h.importer.getState());
  h.importer.importCsvText([HEADER_8, 'bio;Biologie;Biologie;9a;student-1;Muster;;2010-04-03'].join('\n'));
  assert.ok(button(h.document.body, 'Fehlerhafte Zeilen überspringen'));

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();

  assert.deepEqual(h.saved, []);
  assert.deepEqual(clone(h.importer.getState()), before);
  assert.ok(h.alerts.some(message => message.includes('Keine gültigen Zeilen übernommen')));
});

test('Skip replays from the current base and keeps an existing Q4 flag false after save', async () => {
  const h = setup();
  const domain = h.modules.DomainModel;
  const base = h.importer.getState();
  const student = domain.createStudent({ id: 's1', lastName: 'Muster', firstName: 'Mia', birthDate: '2008-04-03' });
  const course = domain.createCourse({ id: 'c1', name: 'Biologie GK', subject: 'Biologie', schemaMode: domain.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: domain.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: domain.QUALIFICATION_YEARS.Q3_Q4 } });
  course.importKey = 'bio-q4';
  domain.addStudentToState(base, student);
  domain.addCourseToState(base, course);
  domain.enrollStudentInCourse(base, 'c1', 's1');
  domain.setWrittenExamSubjectQ4(base, 'c1', 's1', false);
  const csv = [
    `${HEADER_8};Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich`,
    'bio-q4;Biologie GK;Biologie;;external-s1;Muster;;2008-04-03;Sek II;GK;Q3/Q4;Ja',
    'bio-q4;Biologie GK;Biologie;;external-s2;Beispiel;Ben;2008-05-04;Sek II;GK;Q3/Q4;Nein'
  ].join('\n');
  h.importer.importCsvText(csv);
  assert.ok(button(h.document.body, 'Fehlerhafte Zeilen überspringen'));

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();

  assert.equal(h.saved.length, 1);
  assert.equal(h.importer.getState().courses[0].enrollments[0].writtenExamSubjectQ4, false);
  assert.equal(h.importer.getState().courses[0].enrollments.length, 2);
  assert.ok(h.alerts.some(message => /übersprungen \(1\)/.test(message)));
});

test('a different published state invalidates both warning choices and opens a fresh warning preview', async () => {
  for (const label of ['Fehlerhafte Zeilen überspringen', 'Trotz Fehler übernehmen']) {
    const h = setup();
    h.importer.importCsvText([HEADER_8, 'bio;Biologie;Biologie;9a;student-1;Muster;;2010-04-03'].join('\n'));
    const oldButton = button(h.document.body, label);
    assert.ok(oldButton);
    await h.importer.commitOtherChange(candidate => { candidate.settings.schoolProfile.name = 'Neuer Bestand'; });
    assert.equal(h.saved.length, 1);

    await oldButton.click();

    assert.equal(h.saved.length, 1, `${label} must not save against stale consent`);
    assert.equal(h.importer.getState().settings.schoolProfile.name, 'Neuer Bestand');
    assert.ok(button(h.document.body, label), 'current state needs a new choice');
    assert.notEqual(button(h.document.body, label), oldButton);
  }
});

test('an in-place debug save cannot reuse an older CSV warning decision', async () => {
  const h = setup();
  h.importer.importCsvText([HEADER_8, 'bio;Biologie;Biologie;9a;student-1;Muster;;2010-04-03'].join('\n'));
  const oldSkip = button(h.document.body, 'Fehlerhafte Zeilen überspringen');
  h.importer.getState().settings.schoolProfile.name = 'Debugänderung';
  await h.modules.Storage.saveState(h.importer.getState());
  assert.equal(h.saved.length, 1);

  await oldSkip.click();

  assert.equal(h.saved.length, 1);
  assert.equal(h.importer.getState().settings.schoolProfile.name, 'Debugänderung');
  const renewedSkip = button(h.document.body, 'Fehlerhafte Zeilen überspringen');
  assert.ok(renewedSkip);
  assert.notEqual(renewedSkip, oldSkip);
  assert.equal(h.alerts.some(message => message.includes('Keine gültigen Zeilen übernommen')), false);
});

test('a stale warning that became clean still requires a new explicit choice', async () => {
  const h = setup();
  const csv = [HEADER_8, 'bio;;Biologie;9a;student-1;Muster;Mia;2010-04-03'].join('\n');
  h.importer.importCsvText(csv);
  const oldAccept = button(h.document.body, 'Trotz Fehler übernehmen');
  assert.ok(oldAccept);
  await h.importer.commitOtherChange(candidate => {
    const course = h.modules.DomainModel.createCourse({ id: 'bio-course', name: 'Biologie', subject: 'Biologie' });
    course.importKey = 'bio';
    h.modules.DomainModel.addCourseToState(candidate, course);
  });
  assert.equal(h.saved.length, 1);

  await oldAccept.click();

  assert.equal(h.saved.length, 1);
  assert.ok(button(h.document.body, 'CSV-Vorschau übernehmen'));
  assert.equal(h.importer.getState().students.length, 0);

  await button(h.document.body, 'CSV-Vorschau übernehmen').click();
  assert.equal(h.saved.length, 2);
  assert.equal(h.importer.getState().students.length, 1);
});

test('a stale warning that became fatal cannot save and displays the new fatal preview', async () => {
  const h = setup();
  const csv = [HEADER_8, 'bio;;Biologie;9a;student-1;Muster;Mia;2010-04-03'].join('\n');
  h.importer.importCsvText(csv);
  const oldAccept = button(h.document.body, 'Trotz Fehler übernehmen');
  await h.importer.commitOtherChange(candidate => {
    const course = h.modules.DomainModel.createCourse({ id: 'bio-course', name: 'Mathematik', subject: 'Mathematik' });
    course.importKey = 'bio';
    h.modules.DomainModel.addCourseToState(candidate, course);
  });

  await oldAccept.click();

  assert.equal(h.saved.length, 1);
  assert.match(collectCsvElementText(h.document.body), /fatale Fehler|fatal/i);
  assert.equal(h.importer.getState().students.length, 0);
});

test('Skip reveals a new warning in a retained record and requires another decision', async () => {
  const h = setup();
  const csv = [
    HEADER_8,
    'bio;Biologie;Biologie;9a;student-1;Muster;;2010-04-03',
    'bio;;Biologie;9a;student-1;Muster;Mia;2010-04-03'
  ].join('\n');
  h.importer.importCsvText(csv);
  assert.ok(button(h.document.body, 'Fehlerhafte Zeilen überspringen'));

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();

  assert.equal(h.saved.length, 0);
  assert.equal(h.importer.getState().courses.length, 0);
  assert.match(collectCsvElementText(h.document.body), /Zeile 3:/);
  assert.ok(button(h.document.body, 'Fehlerhafte Zeilen überspringen'));

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();
  assert.equal(h.saved.length, 0);
  assert.equal(h.importer.getState().courses.length, 0);
  assert.ok(h.alerts.some(message => message.includes('Keine gültigen Zeilen übernommen')));
});

test('a queued state change preserves earlier excluded records in either renewed decision', async () => {
  const csv = [
    HEADER_8,
    'bio;Biologie;Biologie;9a;student-1;Muster;;2010-04-03',
    'bio;;Biologie;9a;student-1;Muster;Mia;2010-04-03'
  ].join('\n');
  for (const secondChoice of ['Fehlerhafte Zeilen überspringen', 'Trotz Fehler übernehmen']) {
    const h = setup();
    h.importer.importCsvText(csv);
    await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();
    assert.match(collectCsvElementText(h.document.body), /Zeile 3:/);
    assert.doesNotMatch(collectCsvElementText(h.document.body), /Zeile 2:/);
    const oldChoice = button(h.document.body, secondChoice);
    assert.ok(oldChoice);

    await h.importer.commitOtherChange(candidate => { candidate.settings.schoolProfile.name = 'Nach der ersten Entscheidung'; });
    assert.equal(h.saved.length, 1);
    await oldChoice.click();

    const freshText = collectCsvElementText(h.document.body);
    assert.equal(h.saved.length, 1, `${secondChoice} cannot commit with stale consent`);
    assert.match(freshText, /Zeile 3:/);
    assert.doesNotMatch(freshText, /Zeile 2:/);
    assert.notEqual(button(h.document.body, secondChoice), oldChoice);
    assert.equal(h.importer.getState().students.length, 0);

    await button(h.document.body, 'Trotz Fehler übernehmen').click();
    assert.equal(h.saved.length, 2);
    assert.equal(h.importer.getState().courses.length, 0, 'the earlier excluded course record stays excluded');
  }
});

test('multiple warnings on one physical record count as one skipped line', async () => {
  const h = setup();
  const csv = [
    HEADER_8,
    'bio;Biologie;Biologie;9a;student-1;Muster;Mia;2010-04-03',
    ';;;;student-1;Muster;;2010-04-03'
  ].join('\n');
  h.importer.importCsvText(csv);
  assert.match(collectCsvElementText(h.document.body), /Fehlzeilen \(2\)/);

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();

  assert.equal(h.saved.length, 1);
  assert.equal(h.importer.getState().courses.length, 1);
  assert.ok(h.alerts.some(message => /übersprungen \(1\)/.test(message)));
});

test('Skip summary omits a legacy apostrophe hint from an excluded record', async () => {
  const h = setup();
  const csv = [
    HEADER_8,
    "bio;Biologie;Biologie;9a;student-1;'=Muster;;2010-04-03",
    'chem;Chemie;Chemie;9a;student-2;Beispiel;Ben;2010-05-04'
  ].join('\n');
  h.importer.importCsvText(csv);

  await button(h.document.body, 'Fehlerhafte Zeilen überspringen').click();

  const summary = h.alerts.find(message => message.includes('CSV-Import abgeschlossen'));
  assert.ok(summary);
  assert.doesNotMatch(summary, /Führende Apostrophe/);
  assert.equal(h.importer.getState().students.length, 1);
  assert.equal(h.importer.getState().students[0].lastName, 'Beispiel');
});
