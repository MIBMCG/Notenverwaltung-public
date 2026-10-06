'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { loadCsvHelper, loadCsvImporter, loadCsvExporter } = require('./harness/csv-transfer.js');
const { createCsvDocumentStub, collectCsvElementText } = require('./harness/csv-document.js');

function findCsvElement(element, predicate) {
  if (!element) return null;
  if (predicate(element)) return element;
  for (const child of element.children || []) {
    const match = findCsvElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test('Low CSV parser: leading whitespace before a quoted field keeps embedded semicolons in one cell', () => {
  const modules = loadModules();
  const parseCsv = loadCsvHelper(modules, 'parseSemicolonCsv');

  const rows = parseCsv('a; "x;y";b');

  assert.deepEqual(Array.from(rows[0].fields), ['a', ' x;y', 'b']);
});

test('Low CSV import: fatality is carried by issue metadata, not German message text', () => {
  const modules = loadModules();
  const isFatal = loadCsvHelper(modules, 'isFatalCsvImportIssue');

  assert.equal(isFatal({ fatal: true, issues: ['beliebig umformulierter Hinweis'] }), true);
  assert.equal(isFatal({ fatal: false, issues: ['Ungültiges Geburtsdatum'] }), false);
});

test('Low CSV import: a fatal-dialog rendering failure aborts without offering recoverable decisions', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  const createElement = document.createElement;
  let createElementCalls = 0;
  document.createElement = tagName => {
    createElementCalls++;
    if (createElementCalls === 1) throw new Error('Fataldialog kann nicht angezeigt werden');
    return createElement(tagName);
  };
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  let saveCalls = 0;
  modules.Storage.saveState = async () => { saveCalls++; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-02-30'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 0);
  assert.equal(findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  ), null);
  assert.equal(findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
  ), null);
  assert.ok(alerts.some(message => /CSV-Import wurde abgebrochen.*Keine Änderungen wurden angewendet\./i.test(message)));
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('M31: a valid legacy eight-column CSV still imports as a Sek-I course', async () => {
  const modules = loadModules();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-10;Biologie 10;Biologie;10a;person-1;Muster;Mia;2010-04-03'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der unveränderte Altimport muss gespeichert werden');
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.courses[0].schemaMode, modules.DomainModel.SCHEMA_MODES.GRADES);
  assert.equal(savedState.courses[0].upperSecContext, null);
  assert.equal(savedState.students[0].lastName, 'Muster');
  assert.equal(savedState.courses[0].enrollments.length, 1);
});

test('T7: queued CSV imports resolve stable IDs against the latest confirmed state', async () => {
  const modules = loadModules();
  const firstSave = createDeferred();
  const savedCandidates = [];
  modules.Storage.saveState = async candidate => {
    savedCandidates.push(JSON.parse(JSON.stringify(candidate)));
    if (savedCandidates.length === 1) await firstSave.promise;
  };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';

  const firstImport = importer.importCsvText([
    header,
    'bio-stabil;Biologie;Biologie;9a;student-a;Muster;Mia;2010-04-03'
  ].join('\n'));
  await Promise.resolve();
  assert.equal(savedCandidates.length, 1);

  const secondImport = importer.importCsvText([
    header,
    'chem-stabil;Chemie;Chemie;9a;student-b;Beispiel;Ben;2010-05-04'
  ].join('\n'));
  await Promise.resolve();
  assert.equal(savedCandidates.length, 1, 'der zweite Import wartet auf den ersten Commit');

  firstSave.resolve();
  await Promise.all([firstImport, secondImport]);

  assert.equal(savedCandidates.length, 2);
  assert.deepEqual(
    savedCandidates[1].courses.map(course => course.importKey).sort(),
    ['bio-stabil', 'chem-stabil']
  );
  const firstStudentId = savedCandidates[0].students.find(student => student.lastName === 'Muster').id;
  assert.equal(
    savedCandidates[1].students.find(student => student.lastName === 'Muster').id,
    firstStudentId,
    'die interne ID aus dem ersten bestätigten Kandidaten bleibt stabil'
  );
  const confirmedStudentIds = new Set(savedCandidates[1].students.map(student => student.id));
  assert.equal(savedCandidates[1].students.length, 2);
  assert.ok(savedCandidates[1].courses
    .flatMap(course => course.enrollments)
    .every(enrollment => confirmedStudentIds.has(enrollment.studentId)));
  assert.deepEqual(
    JSON.parse(JSON.stringify(importer.getState())),
    savedCandidates[1],
    'veröffentlicht wird genau der zuletzt persistierte Kandidat'
  );
});

test('M31: the extended CSV imports one mixed Q4 basic course with person-specific flags', async () => {
  const modules = loadModules();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich',
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja',
    'bio-q4;Biologie GK;Biologie;;person-2;Beispiel;Ben;2008-07-05;Sek II;GK;Q3/Q4;Nein'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der erweiterte Import muss gespeichert werden');
  assert.equal(savedState.courses.length, 1);
  const course = savedState.courses[0];
  assert.deepEqual(JSON.parse(JSON.stringify(course.upperSecContext)), {
    courseType: 'basic',
    qualificationYear: 'q3-q4',
    weightingDeviationReason: null
  });
  assert.deepEqual(Array.from(course.enrollments, enrollment => enrollment.writtenExamSubjectQ4), [true, false]);
});

test('M31: CSV import rejects context that contradicts an existing course with the same stable key', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    name: 'Biologie Kurs',
    subject: 'Biologie',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2
    }
  });
  course.importKey = 'bio-stabil';
  modules.DomainModel.addCourseToState(state, course);
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, state);
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich',
    'bio-stabil;Biologie Kurs;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(savedState, null, 'widersprüchliche Kursfelder dürfen nicht gespeichert werden');
  assert.equal(importer.getState().students.length, 0);
  assert.equal(course.upperSecContext.courseType, modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED);
});

test('M31 review: an eight-column header cannot smuggle undeclared Sek-II columns in data rows', async () => {
  const modules = loadModules();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(savedState, null);
  assert.equal(importer.getState().courses.length, 0);
});

test('M31 task-7: legacy CSV inherits an existing Sek-II course context without creating a Sek-I duplicate', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    name: 'Biologie Kurs',
    subject: 'Biologie',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  course.importKey = 'bio-schema';
  modules.DomainModel.addCourseToState(state, course);
  let savedState = null;
  const alerts = [];
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  modules.sandbox.window.alert = message => alerts.push(String(message));
  const importer = loadCsvImporter(modules, state);
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-schema;Biologie Kurs;Biologie;;person-1;Muster;Mia;2008-04-03'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der alte Achtspalten-Import muss den vorhandenen Sek-II-Kurs verwenden');
  assert.equal(savedState.courses.length, 1, 'die stabile ID darf keinen Sek-I-Duplikatkurs erzeugen');
  assert.equal(savedState.courses[0].schemaMode, modules.DomainModel.SCHEMA_MODES.UPPERSEC);
  assert.deepEqual(JSON.parse(JSON.stringify(savedState.courses[0].upperSecContext)), {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  });
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.match(alerts.join('\n'), /Keine Sek-II-Angaben.*bestehende Kurskontext/i);
});

test('M31 review: an omitted Q4 column preserves an existing personal Ja flag', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const student = modules.DomainModel.createStudent({
    lastName: 'Muster', firstName: 'Mia', birthDate: '2008-04-03'
  });
  const course = modules.DomainModel.createCourse({
    name: 'Biologie GK',
    subject: 'Biologie',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  course.importKey = 'bio-ohne-flag';
  modules.DomainModel.addStudentToState(state, student);
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  modules.DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, state);
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt',
    'bio-ohne-flag;Biologie GK;Biologie;;;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState);
  assert.equal(savedState.courses[0].enrollments[0].writtenExamSubjectQ4, true);
});

test('M31 final re-review: contradictory duplicate Q4 flags reject CSV import in either row order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich';
  for (const flags of [['Ja', 'Nein'], ['Nein', 'Ja']]) {
    const modules = loadModules();
    let savedState = null;
    modules.Storage.saveState = async candidate => { savedState = candidate; };
    const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
    const rows = flags.map(flag =>
      `bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;${flag}`
    );

    importer.importCsvText([header, ...rows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(savedState, null, `widersprüchliche Reihenfolge ${flags.join('/')} darf nicht gespeichert werden`);
    assert.equal(importer.getState().courses.length, 0);
  }
});

test('M31 final re-review: identical duplicate Q4 flags retain the existing merged-import behavior', async () => {
  const modules = loadModules();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich',
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja',
    'bio-q4;Biologie GK;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState);
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.equal(savedState.courses[0].enrollments[0].writtenExamSubjectQ4, true);
});

test('H10: each isolated identity-field conflict rejects a new-person import atomically in either order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const conflictCases = [
    {
      field: 'Nachname',
      identities: [
        { lastName: 'PrivatnameA', firstName: 'Rufname', birthDate: '2010-01-01' },
        { lastName: 'PrivatnameB', firstName: 'Rufname', birthDate: '2010-01-01' }
      ]
    },
    {
      field: 'Vorname',
      identities: [
        { lastName: 'Familie', firstName: 'PrivatvornameA', birthDate: '2010-01-01' },
        { lastName: 'Familie', firstName: 'PrivatvornameB', birthDate: '2010-01-01' }
      ]
    },
    {
      field: 'Geburtsdatum',
      identities: [
        { lastName: 'Familie', firstName: 'Rufname', birthDate: '2010-01-01' },
        { lastName: 'Familie', firstName: 'Rufname', birthDate: '2011-05-05' }
      ]
    }
  ];

  for (const conflictCase of conflictCases) {
    const baseRows = conflictCase.identities.map((identity, index) =>
      `kurs-${index + 1};Kurs ${index + 1};Fach;9a;PRIVATE-ID-7;${identity.lastName};${identity.firstName};${identity.birthDate}`
    );
    for (const rows of [baseRows, [...baseRows].reverse()]) {
      const modules = loadModules();
      const document = createCsvDocumentStub();
      modules.sandbox.document = document;
      const initialState = modules.DomainModel.createEmptyState();
      const initialSnapshot = JSON.parse(JSON.stringify(initialState));
      let saveCalls = 0;
      modules.Storage.saveState = async () => { saveCalls++; };
      const importer = loadCsvImporter(modules, initialState);

      importer.importCsvText([header, ...rows].join('\n'));
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(saveCalls, 0, `${conflictCase.field} in Reihenfolge ${rows === baseRows ? 'A/B' : 'B/A'} darf nicht persistieren`);
      assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
      const fatalText = collectCsvElementText(document.body);
      assert.match(fatalText, new RegExp(conflictCase.field));
      assert.doesNotMatch(
        fatalText,
        /PRIVATE-ID-7|PrivatnameA|PrivatnameB|PrivatvornameA|PrivatvornameB|Familie|Rufname|2010-01-01|2011-05-05/i,
        'die fatale Meldung darf keine konkrete SchuelerID oder Identitaetswerte offenlegen'
      );
    }
  }
});

test('H10: each row order starts from its matching local identity and preserves that person on conflict', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const identityPairs = [
    [
      { lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' },
      { lastName: 'Mueller', firstName: 'Max', birthDate: '2010-01-01' }
    ],
    [
      { lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' },
      { lastName: 'Meier', firstName: 'Moritz', birthDate: '2010-01-01' }
    ],
    [
      { lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' },
      { lastName: 'Meier', firstName: 'Max', birthDate: '2011-05-05' }
    ]
  ];

  for (const identityPair of identityPairs) {
    for (const orderedIdentities of [identityPair, [...identityPair].reverse()]) {
      const modules = loadModules();
      const initialState = modules.DomainModel.createEmptyState();
      const localStudent = modules.DomainModel.createStudent({ ...orderedIdentities[0], homeClass: '9a' });
      modules.DomainModel.addStudentToState(initialState, localStudent);
      const initialSnapshot = JSON.parse(JSON.stringify(initialState));
      let saveCalls = 0;
      modules.Storage.saveState = async () => { saveCalls++; };
      const importer = loadCsvImporter(modules, initialState);
      const rows = orderedIdentities.map((identity, index) =>
        `kurs-${index + 1};Kurs ${index + 1};Fach;9a;S7;${identity.lastName};${identity.firstName};${identity.birthDate}`
      );

      importer.importCsvText([header, ...rows].join('\n'));
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(saveCalls, 0);
      assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
      assert.deepEqual(
        JSON.parse(JSON.stringify(importer.getState().students[0])),
        JSON.parse(JSON.stringify(localStudent))
      );
    }
  }
});

test('H10: the central identity check accepts each empty identity field in both directions', () => {
  const modules = loadModules();
  const validateIdentity = loadCsvHelper(modules, 'validateCsvStudentIdentity');
  const complete = { lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' };

  for (const field of ['lastName', 'firstName', 'birthDate']) {
    assert.deepEqual(
      Array.from(validateIdentity({ ...complete, [field]: '' }, complete)),
      [],
      `${field}: leer -> befüllt darf kein Konflikt sein`
    );
    assert.deepEqual(
      Array.from(validateIdentity(complete, { ...complete, [field]: '' })),
      [],
      `${field}: befüllt -> leer darf kein Konflikt sein`
    );
  }
});

test('H10/R08: real import accepts an empty last or first name with both course enrollments in either row order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const fieldCases = [
    {
      field: 'Nachname',
      incompleteRow: 'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01',
      completeRow: 'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01'
    },
    {
      field: 'Vorname',
      incompleteRow: 'mathe-9;Mathematik 9;Mathematik;9a;S7;Meier;;2010-01-01',
      completeRow: 'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01'
    }
  ];

  for (const fieldCase of fieldCases) {
    const rowOrders = [
      { label: 'leer -> befüllt', rows: [fieldCase.incompleteRow, fieldCase.completeRow] },
      { label: 'befüllt -> leer', rows: [fieldCase.completeRow, fieldCase.incompleteRow] }
    ];
    for (const rowOrder of rowOrders) {
      const modules = loadModules();
      const document = createCsvDocumentStub();
      modules.sandbox.document = document;
      const initialState = modules.DomainModel.createEmptyState();
      const initialSnapshot = JSON.parse(JSON.stringify(initialState));
      let saveCalls = 0;
      let savedState = null;
      modules.Storage.saveState = async candidate => { saveCalls++; savedState = candidate; };
      const importer = loadCsvImporter(modules, initialState);

      importer.importCsvText([header, ...rowOrder.rows].join('\n'));
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(saveCalls, 0, `${fieldCase.field} ${rowOrder.label}: vor Nutzerentscheidung darf nicht persistiert werden`);
      assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
      const acceptButton = findCsvElement(
        document.body,
        element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
      );
      assert.ok(acceptButton, `${fieldCase.field} ${rowOrder.label}: der reale Warnungsdialog muss die Übernahme anbieten`);

      await acceptButton.click();
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(saveCalls, 1);
      assert.ok(savedState);
      assert.deepEqual(
        {
          lastName: savedState.students[0].lastName,
          firstName: savedState.students[0].firstName,
          birthDate: savedState.students[0].birthDate
        },
        { lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01' }
      );
      const acceptedEnrollments = savedState.courses.flatMap(course => course.enrollments);
      assert.equal(savedState.courses.length, 2, `${fieldCase.field} ${rowOrder.label}: beide Kurszeilen bleiben nach Übernahme erhalten`);
      assert.equal(acceptedEnrollments.length, 2, `${fieldCase.field} ${rowOrder.label}: beide akzeptierten Zeilen müssen eingeschrieben sein`);
      assert.ok(acceptedEnrollments.every(enrollment => enrollment.studentId === savedState.students[0].id));
      assert.deepEqual(
        JSON.parse(JSON.stringify(importer.getState())),
        JSON.parse(JSON.stringify(savedState)),
        `${fieldCase.field} ${rowOrder.label}: der persistierte Kandidat muss der neue Live-Zustand sein`
      );
    }
  }
});

test('R08: skipping an incomplete duplicate row leaves only the complete row course in either order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const incompleteRow = 'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01';
  const completeRow = 'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01';
  const rowOrders = [
    { label: 'unvollständig zuerst', rows: [incompleteRow, completeRow] },
    { label: 'vollständig zuerst', rows: [completeRow, incompleteRow] }
  ];

  for (const rowOrder of rowOrders) {
    const modules = loadModules();
    const document = createCsvDocumentStub();
    modules.sandbox.document = document;
    let savedState = null;
    modules.Storage.saveState = async candidate => { savedState = candidate; };
    const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

    importer.importCsvText([header, ...rowOrder.rows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));
    const skipButton = findCsvElement(
      document.body,
      element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
    );
    assert.ok(skipButton, `${rowOrder.label}: Warnungsdialog muss Überspringen anbieten`);
    assert.equal(savedState, null, `${rowOrder.label}: vor der Entscheidung darf nicht gespeichert werden`);

    await skipButton.click();
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(savedState, `${rowOrder.label}: Skip speichert den bereinigten Kandidaten`);
    assert.equal(savedState.students.length, 1);
    assert.equal(savedState.students[0].lastName, 'Meier');
    assert.deepEqual(Array.from(savedState.courses, course => course.name), ['Physik 9']);
    assert.equal(savedState.courses[0].enrollments.length, 1);
    assert.equal(savedState.courses[0].enrollments[0].studentId, savedState.students[0].id);
  }
});

test('R08: cancelling the same incomplete-identity import leaves no candidate changes in either order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const incompleteRow = 'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01';
  const completeRow = 'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01';
  const rowOrders = [
    { label: 'unvollständig zuerst', rows: [incompleteRow, completeRow] },
    { label: 'vollständig zuerst', rows: [completeRow, incompleteRow] }
  ];

  for (const rowOrder of rowOrders) {
    const modules = loadModules();
    const document = createCsvDocumentStub();
    modules.sandbox.document = document;
    const alerts = [];
    modules.sandbox.window.alert = message => alerts.push(String(message));
    const initialState = modules.DomainModel.createEmptyState();
    const before = JSON.parse(JSON.stringify(initialState));
    let saveCalls = 0;
    modules.Storage.saveState = async () => { saveCalls++; };
    const importer = loadCsvImporter(modules, initialState);

    importer.importCsvText([header, ...rowOrder.rows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));
    const closeButton = findCsvElement(
      document.body,
      element => element.tagName === 'BUTTON' && element.textContent === 'Schließen'
    );
    assert.ok(closeButton, `${rowOrder.label}: Warnungsdialog muss Abbruch anbieten`);

    await closeButton.click();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(saveCalls, 0, `${rowOrder.label}: Abbruch darf keinen Save starten`);
    assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), before);
    assert.ok(alerts.some(message => /Import abgebrochen\. Keine Änderungen wurden übernommen\./.test(message)));
    assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
  }
});

test('H10: consistent duplicate SchuelerID rows fill optional blanks without overwriting in either row order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const rows = [
    'mathe-9;Mathematik 9;Mathematik;;S7;Meier;Max;',
    'physik-9;Physik 9;Physik;9a;S7;MEIER;MAX;2010-01-01'
  ];

  const rowOrders = [
    { orderedRows: rows, expectedNames: { lastName: 'Meier', firstName: 'Max' } },
    { orderedRows: [...rows].reverse(), expectedNames: { lastName: 'MEIER', firstName: 'MAX' } }
  ];

  for (const { orderedRows, expectedNames } of rowOrders) {
    const modules = loadModules();
    let savedState = null;
    modules.Storage.saveState = async candidate => { savedState = candidate; };
    const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

    importer.importCsvText([header, ...orderedRows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(savedState);
    assert.equal(savedState.students.length, 1);
    assert.deepEqual(
      {
        lastName: savedState.students[0].lastName,
        firstName: savedState.students[0].firstName,
        birthDate: savedState.students[0].birthDate,
        homeClass: savedState.students[0].homeClass
      },
      { ...expectedNames, birthDate: '2010-01-01', homeClass: '9a' }
    );
  }
});

test('H10 review: blank-first same-ID rows reuse one compatible existing local student in either order', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const rows = [
    'mathe-9;Mathematik 9;Mathematik;9a;S7;;Max;2010-01-01',
    'physik-9;Physik 9;Physik;9a;S7;Meier;Max;2010-01-01'
  ];

  for (const orderedRows of [rows, [...rows].reverse()]) {
    const modules = loadModules();
    const document = createCsvDocumentStub();
    modules.sandbox.document = document;
    const initialState = modules.DomainModel.createEmptyState();
    const localStudent = modules.DomainModel.createStudent({
      lastName: 'Meier', firstName: 'Max', birthDate: '2010-01-01', homeClass: '9a'
    });
    modules.DomainModel.addStudentToState(initialState, localStudent);
    let savedState = null;
    modules.Storage.saveState = async candidate => { savedState = candidate; };
    const importer = loadCsvImporter(modules, initialState);

    importer.importCsvText([header, ...orderedRows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));

    const acceptButton = findCsvElement(
      document.body,
      element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
    );
    if (acceptButton) {
      await acceptButton.click();
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.ok(savedState);
    assert.equal(savedState.students.length, 1, 'die lokale Person darf nicht dupliziert werden');
    assert.equal(savedState.students[0].id, localStudent.id);
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedState.courses.flatMap(
        course => course.enrollments.map(enrollment => enrollment.studentId)
      ))),
      [localStudent.id, localStudent.id]
    );
  }
});

test('H10 re-review: ambiguous exact and compatible local identities abort without exposing identity data', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag';
  const csv = [
    header,
    'mathe-9;Mathematik 9;Mathematik;9a;PRIVATE-ID-9;Privatname;Rufname;2010-01-01'
  ].join('\n');
  const localCases = [
    [
      { lastName: 'Privatname', firstName: 'Rufname', birthDate: '2010-01-01' },
      { lastName: 'Privatname', firstName: 'Rufname', birthDate: '2010-01-01' }
    ],
    [
      { lastName: 'Privatname', firstName: 'Rufname', birthDate: '' },
      { lastName: 'Privatname', firstName: 'Rufname', birthDate: '' }
    ]
  ];

  for (const localIdentities of localCases) {
    const modules = loadModules();
    const document = createCsvDocumentStub();
    modules.sandbox.document = document;
    const initialState = modules.DomainModel.createEmptyState();
    for (const identity of localIdentities) {
      modules.DomainModel.addStudentToState(initialState, modules.DomainModel.createStudent(identity));
    }
    const initialSnapshot = JSON.parse(JSON.stringify(initialState));
    let saveCalls = 0;
    modules.Storage.saveState = async () => { saveCalls++; };
    const importer = loadCsvImporter(modules, initialState);

    importer.importCsvText(csv);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(saveCalls, 0, 'eine mehrdeutige lokale Identität darf nicht gespeichert werden');
    assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
    const fatalText = collectCsvElementText(document.body);
    assert.match(fatalText, /mehreren vorhandenen Personen/i);
    assert.doesNotMatch(
      fatalText,
      /PRIVATE-ID-9|Privatname|Rufname|2010-01-01/i,
      'die Fehlermeldung darf keine Identitätswerte offenlegen'
    );
  }
});

test('H10: a later non-empty home class cannot overwrite the first non-empty value', async () => {
  const modules = loadModules();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'mathe-9;Mathematik 9;Mathematik;9a;S7;Meier;Max;2010-01-01',
    'physik-9;Physik 9;Physik;9b;S7;Meier;Max;2010-01-01'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.students[0].homeClass, '9a');
  assert.equal(importer.getState().students[0].homeClass, '9a');
});

test('M14/M31: CSV headers accept legacy prefixes and the appended home-class column only', () => {
  const modules = loadModules();
  const validateHeader = loadCsvHelper(modules, 'validateCsvTransferHeader');
  const headers = [
    'KursID', 'Kurs', 'Fach', 'Klasse', 'SchuelerID', 'Nachname', 'Vorname', 'Geburtstag',
    'Schema', 'Kursart', 'Qualifikationsabschnitt', '3. Pruefungsfach schriftlich', 'Stammklasse'
  ];

  for (let length = 8; length <= 13; length++) {
    assert.equal(validateHeader(headers.slice(0, length)).columnCount, length);
  }
  assert.throws(() => validateHeader(headers.slice(0, 7)), /Kopfzeile/);
  assert.throws(() => validateHeader([...headers, 'Zusatz']), /Kopfzeile/);
});

test('M14 review: legacy nine- through twelve-column CSV files still import', async () => {
  const headers = [
    'KursID', 'Kurs', 'Fach', 'Klasse', 'SchuelerID', 'Nachname', 'Vorname', 'Geburtstag',
    'Schema', 'Kursart', 'Qualifikationsabschnitt', '3. Pruefungsfach schriftlich'
  ];
  const row = [
    'informatik-9', 'Informatik 9', 'Informatik', '9a', 'student-9a', 'Muster', 'Mia', '2010-04-03',
    'Sek I', '', '', ''
  ];

  for (let columnCount = 9; columnCount <= 12; columnCount++) {
    const modules = loadModules();
    let restored = null;
    modules.Storage.saveState = async candidate => { restored = candidate; };
    const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());
    importer.importCsvText([
      headers.slice(0, columnCount).join(';'),
      row.slice(0, columnCount).join(';')
    ].join('\n'));
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(restored, `${columnCount} Spalten müssen importierbar bleiben`);
    assert.equal(restored.courses[0].classLabel, '9a');
    assert.equal(restored.students[0].homeClass, '9a');
  }
});

test('M31: CSV context parser maps supported GK, LK and other-course values without guessing blanks', () => {
  const modules = loadModules();
  const parseContext = loadCsvHelper(modules, 'parseCsvTransferContextFields');
  const cases = [
    { fields: ['Sek II', 'GK', 'Q3/Q4', 'Ja'], schema: 'uppersec', type: 'basic', year: 'q3-q4', flag: true },
    { fields: ['Sek II', 'LK', 'Q1/Q2', 'Nein'], schema: 'uppersec', type: 'advanced', year: 'q1-q2', flag: false },
    { fields: ['Sek II', 'Sonstiger Kurs', 'Q3/Q4', ''], schema: 'uppersec', type: 'other', year: 'q3-q4', flag: false },
    { fields: ['', '', '', ''], schema: 'grades', type: null, year: null, flag: false }
  ];

  for (const item of cases) {
    const parsed = parseContext(item.fields);
    assert.deepEqual(Array.from(parsed.issues), []);
    assert.equal(parsed.schemaMode, item.schema);
    assert.equal(parsed.upperSecContext && parsed.upperSecContext.courseType, item.type);
    assert.equal(parsed.upperSecContext && parsed.upperSecContext.qualificationYear, item.year);
    assert.equal(parsed.writtenExamSubjectQ4, item.flag);
  }
});

test('M31: CSV context parser reports unknown values, incomplete Sek II and an unsuitable Ja flag', () => {
  const modules = loadModules();
  const parseContext = loadCsvHelper(modules, 'parseCsvTransferContextFields');

  assert.match(parseContext(['Sek III', '', '', '']).issues.join(' '), /Schema/);
  assert.match(parseContext(['Sek II', '', 'Q1\/Q2', '']).issues.join(' '), /Kursart/);
  assert.match(parseContext(['Sek II', 'GK', 'Q5', '']).issues.join(' '), /Qualifikationsabschnitt/);
  assert.match(parseContext(['Sek II', 'LK', 'Q3\/Q4', 'Ja']).issues.join(' '), /Pruefungsfach/);
  assert.match(parseContext(['Sek II', 'GK', 'Q3\/Q4', 'Vielleicht']).issues.join(' '), /Ja oder Nein/);
});

test('M31: the first complete CSV course context wins and later deviations are reported', () => {
  const modules = loadModules();
  const validateConsistency = loadCsvHelper(modules, 'validateCsvCourseContextConsistency');
  const seen = new Map();
  const first = {
    schemaMode: 'uppersec',
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null },
    writtenExamSubjectQ4: true,
    issues: []
  };
  const differing = {
    ...first,
    upperSecContext: { ...first.upperSecContext, courseType: 'advanced' }
  };

  assert.deepEqual(Array.from(validateConsistency(seen, 'bio-q4', first)), []);
  assert.match(validateConsistency(seen, 'bio-q4', differing).join(' '), /Kurskontext/);
});

test('M31: CSV context export and import retain course fields and the personal flag', () => {
  const modules = loadModules();
  const formatContext = loadCsvHelper(modules, 'formatCsvTransferContextFields');
  const parseContext = loadCsvHelper(modules, 'parseCsvTransferContextFields');
  const course = {
    schemaMode: 'uppersec',
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null }
  };

  const fields = formatContext(course, { writtenExamSubjectQ4: true });
  assert.deepEqual(Array.from(fields), ['Sek II', 'GK', 'Q3/Q4', 'Ja']);
  const parsed = parseContext(fields);
  assert.equal(parsed.upperSecContext.courseType, 'basic');
  assert.equal(parsed.upperSecContext.qualificationYear, 'q3-q4');
  assert.equal(parsed.writtenExamSubjectQ4, true);
});

test('M31: the real transfer export writes the extended header and person-specific Q4 value', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const student = modules.DomainModel.createStudent({ lastName: '=FORMEL', firstName: 'Mia' });
  const course = modules.DomainModel.createCourse({
    name: 'Biologie GK',
    subject: 'Biologie',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  modules.DomainModel.addStudentToState(state, student);
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  modules.DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);

  const download = loadCsvExporter(modules, state)([course]);
  const lines = download.content.replace(/^\uFEFF/, '').split('\n');

  assert.equal(lines[0], 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz');
  assert.match(lines[1], /;'=FORMEL;Mia;;Sek II;GK;Q3\/Q4;Ja;;nv1:20$/);
});

test('D7: real export/import/export preserves protected display text and stable course identity', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const student = sourceModules.DomainModel.createStudent({
    lastName: "'=Echt",
    firstName: '  +Mia',
    birthDate: '2010-04-03'
  });
  const course = sourceModules.DomainModel.createCourse({
    name: '  =Biologie',
    subject: 'Biologie',
    classLabel: '9a'
  });
  sourceModules.DomainModel.addStudentToState(sourceState, student);
  sourceModules.DomainModel.addCourseToState(sourceState, course);
  sourceModules.DomainModel.enrollStudentInCourse(sourceState, course.id, student.id);

  const firstExport = loadCsvExporter(sourceModules, sourceState)([course]).content;
  const firstRows = firstExport.replace(/^\uFEFF/, '').split('\n');
  assert.equal(firstRows[0].split(';').length, 14);
  assert.match(firstRows[1], /;'  =Biologie;Biologie;9a;[^;]+;'=Echt;'  \+Mia;2010-04-03;Sek I;;;;;nv1:42$/);

  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(firstExport);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(restored);
  assert.equal(restored.courses.length, 1);
  assert.equal(restored.courses[0].name, '  =Biologie');
  assert.equal(restored.students[0].lastName, "'=Echt");
  assert.equal(restored.students[0].firstName, '  +Mia');

  importer.importCsvText(firstExport);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restored.courses.length, 1, 'the exported internal course ID must not create a duplicate');

  const roundTripExportModules = loadModules();
  const secondExport = loadCsvExporter(roundTripExportModules, restored)([restored.courses[0]]).content;
  const secondRow = secondExport.replace(/^\uFEFF/, '').split('\n')[1];
  assert.match(secondRow, /;'  =Biologie;Biologie;9a;[^;]+;'=Echt;'  \+Mia;2010-04-03;Sek I;;;;;nv1:42$/);
});

test('M31 review: real export followed by real import preserves a mixed Q4 course', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const students = [
    sourceModules.DomainModel.createStudent({ lastName: 'Muster', firstName: 'Mia', birthDate: '2008-04-03' }),
    sourceModules.DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ben', birthDate: '2008-07-05' })
  ];
  const course = sourceModules.DomainModel.createCourse({
    name: 'Biologie GK', subject: 'Biologie', schemaMode: sourceModules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: sourceModules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: sourceModules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  for (const student of students) sourceModules.DomainModel.addStudentToState(sourceState, student);
  sourceModules.DomainModel.addCourseToState(sourceState, course);
  for (const student of students) sourceModules.DomainModel.enrollStudentInCourse(sourceState, course.id, student.id);
  sourceModules.DomainModel.setWrittenExamSubjectQ4(sourceState, course.id, students[0].id, true);
  const exported = loadCsvExporter(sourceModules, sourceState)([course]).content;

  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(exported);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored);
  assert.equal(restored.courses[0].upperSecContext.courseType, 'basic');
  assert.equal(restored.courses[0].upperSecContext.qualificationYear, 'q3-q4');
  assert.deepEqual(Array.from(restored.courses[0].enrollments, item => item.writtenExamSubjectQ4), [true, false]);
});

test('M14: CSV round-trip keeps the course label separate from each student home class', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const students = [
    sourceModules.DomainModel.createStudent({
      lastName: 'Muster', firstName: 'Mia', birthDate: '2010-04-03', homeClass: '9a'
    }),
    sourceModules.DomainModel.createStudent({
      lastName: 'Beispiel', firstName: 'Ben', birthDate: '2010-07-05', homeClass: '9n'
    })
  ];
  const course = sourceModules.DomainModel.createCourse({
    name: 'Informatik 9', subject: 'Informatik', classLabel: 'Wahlpflicht 9'
  });
  for (const student of students) sourceModules.DomainModel.addStudentToState(sourceState, student);
  sourceModules.DomainModel.addCourseToState(sourceState, course);
  for (const student of students) sourceModules.DomainModel.enrollStudentInCourse(sourceState, course.id, student.id);

  const exported = loadCsvExporter(sourceModules, sourceState)([course]).content;
  const exportedLines = exported.replace(/^\uFEFF/, '').split('\n');
  assert.match(exportedLines[0], /;Stammklasse;CSV-Schutz$/);
  assert.match(exportedLines[1], /;Wahlpflicht 9;[^;]+;Muster;Mia;2010-04-03;Sek I;;;;9a;nv1:0$/);
  assert.match(exportedLines[2], /;Wahlpflicht 9;[^;]+;Beispiel;Ben;2010-07-05;Sek I;;;;9n;nv1:0$/);

  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(exported);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored);
  assert.equal(restored.courses[0].classLabel, 'Wahlpflicht 9');
  assert.deepEqual(Array.from(restored.students, student => student.homeClass), ['9a', '9n']);
  assert.deepEqual(
    Array.from(restored.courses[0].enrollments, enrollment => enrollment.homeClassAtEnrollment),
    ['9a', '9n']
  );
});

test('M14: a mixed course without a course label does not invent one from the first student', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const students = [
    sourceModules.DomainModel.createStudent({ lastName: 'Muster', firstName: 'Mia', homeClass: '9a' }),
    sourceModules.DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ben', homeClass: '9n' })
  ];
  const course = sourceModules.DomainModel.createCourse({ name: 'Informatik 9', subject: 'Informatik' });
  for (const student of students) sourceModules.DomainModel.addStudentToState(sourceState, student);
  sourceModules.DomainModel.addCourseToState(sourceState, course);
  for (const student of students) sourceModules.DomainModel.enrollStudentInCourse(sourceState, course.id, student.id);

  const exported = loadCsvExporter(sourceModules, sourceState)([course]).content;
  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(exported);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored);
  assert.equal(restored.courses[0].classLabel, '');
  assert.deepEqual(Array.from(restored.students, student => student.homeClass), ['9a', '9n']);
});

test('M14: importing a new enrollment keeps a newer local home class but uses the transferred enrollment class', async () => {
  const modules = loadModules();
  const initialState = modules.DomainModel.createEmptyState();
  const localStudent = modules.DomainModel.createStudent({
    id: 'local-student', lastName: 'Muster', firstName: 'Mia', birthDate: '2010-04-03', homeClass: '10a'
  });
  modules.DomainModel.addStudentToState(initialState, localStudent);
  let restored = null;
  modules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(modules, initialState);
  const csv = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse',
    'informatik-9;Informatik 9;Informatik;Wahlpflicht 9;source-student;Muster;Mia;2010-04-03;Sek I;;;;9a'
  ].join('\n');

  importer.importCsvText(csv);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored);
  assert.equal(restored.students[0].homeClass, '10a');
  assert.equal(restored.courses[0].enrollments[0].homeClassAtEnrollment, '9a');
});

test('M14 review: a course without enrollments round-trips through the protected format', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const course = sourceModules.DomainModel.createCourse({
    name: 'Robotik AG', subject: 'Informatik', classLabel: 'AG'
  });
  sourceModules.DomainModel.addCourseToState(sourceState, course);
  const exported = loadCsvExporter(sourceModules, sourceState)([course]).content;

  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(exported);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored);
  assert.equal(restored.courses.length, 1);
  assert.equal(restored.courses[0].classLabel, 'AG');
  assert.equal(restored.courses[0].enrollments.length, 0);
  assert.equal(restored.students.length, 0);
});

test('Task 8: CSV round-trips applicable Q4 flags but exports inactive and contextless legacy Sek-II data without inventing context', async () => {
  const sourceModules = loadModules();
  const sourceState = sourceModules.DomainModel.createEmptyState();
  const student = sourceModules.DomainModel.createStudent({
    lastName: 'Muster', firstName: 'Mia', birthDate: '2008-04-03'
  });
  const applicable = sourceModules.DomainModel.createCourse({
    name: 'Biologie GK', subject: 'Biologie', schemaMode: sourceModules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: sourceModules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: sourceModules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  const inactive = sourceModules.DomainModel.createCourse({
    name: 'Biologie LK', subject: 'Biologie', schemaMode: sourceModules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: sourceModules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
      qualificationYear: sourceModules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  const legacy = sourceModules.DomainModel.createCourse({
    name: 'Biologie Altbestand', subject: 'Biologie', schemaMode: sourceModules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: null
  });
  sourceModules.DomainModel.addStudentToState(sourceState, student);
  for (const course of [applicable, inactive, legacy]) {
    sourceModules.DomainModel.addCourseToState(sourceState, course);
    sourceModules.DomainModel.enrollStudentInCourse(sourceState, course.id, student.id);
  }
  sourceModules.DomainModel.setWrittenExamSubjectQ4(sourceState, applicable.id, student.id, true);
  sourceModules.DomainModel.findEnrollment(inactive, student.id).writtenExamSubjectQ4 = true;
  sourceModules.DomainModel.findEnrollment(legacy, student.id).writtenExamSubjectQ4 = true;

  const exported = loadCsvExporter(sourceModules, sourceState)([applicable, inactive, legacy]).content;
  const rows = exported.replace(/^\uFEFF/, '').split('\n');
  assert.match(rows.find(row => row.includes('Biologie GK')), /;Sek II;GK;Q3\/Q4;Ja;;nv1:0$/);
  assert.match(rows.find(row => row.includes('Biologie LK')), /;Sek II;LK;Q3\/Q4;;;nv1:0$/);
  assert.match(rows.find(row => row.includes('Biologie Altbestand')), /;Sek II;;;;;nv1:0$/);

  const targetModules = loadModules();
  let restored = null;
  targetModules.Storage.saveState = async candidate => { restored = candidate; };
  const importer = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState());
  importer.importCsvText(exported);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(restored, 'der Export darf nicht am eigenen Importvertrag scheitern');
  const restoredApplicable = restored.courses.find(course => course.name === 'Biologie GK');
  const restoredInactive = restored.courses.find(course => course.name === 'Biologie LK');
  const restoredLegacy = restored.courses.find(course => course.name === 'Biologie Altbestand');
  assert.equal(restoredApplicable.enrollments[0].writtenExamSubjectQ4, true);
  assert.equal(restoredInactive.enrollments[0].writtenExamSubjectQ4, false);
  assert.equal(restoredLegacy.schemaMode, targetModules.DomainModel.SCHEMA_MODES.UPPERSEC);
  assert.equal(restoredLegacy.upperSecContext, null, 'fehlender Legacy-Kontext darf nicht erfunden werden');
});

test('M31: CSV cells neutralize spreadsheet formulas before quoting', () => {
  const modules = loadModules();
  const csvCell = loadCsvHelper(modules, 'csvCell');

  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"');
  assert.equal(csvCell('+SUM(1;2)'), '"\'+SUM(1;2)"');
  assert.equal(csvCell('-1+2'), "'-1+2");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('Biologie'), 'Biologie');
});

test('M12/M13: recoverable CSV errors do not report completion before the user decides', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  let saveCalls = 0;
  modules.Storage.saveState = async () => { saveCalls++; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 0, 'vor der Nutzerentscheidung darf nicht gespeichert werden');
  assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
});

test('M12/M13: closing the recoverable-error dialog reports cancellation without completion', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  modules.Storage.saveState = async () => {};
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const closeButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && element.textContent === 'Schließen'
  );
  assert.ok(closeButton, 'der reale Warnungsdialog muss einen Schließen-Button enthalten');

  await closeButton.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(alerts.some(message => /Import abgebrochen\. Keine Änderungen wurden übernommen\./.test(message)));
  assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
});

test('P33: a recoverable CSV decision from an invalidated UI epoch cannot save', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  let saveCalls = 0;
  modules.Storage.saveState = async () => { saveCalls++; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  assert.ok(skipButton);

  importer.invalidateStateEpoch();
  await skipButton.click();
  await Promise.resolve();

  assert.equal(saveCalls, 0, 'eine veraltete Entscheidung darf keinen Kandidaten persistieren');
  assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
  assert.equal(findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  ), null, 'der veraltete Dialog wird still geschlossen');
});

test('M12/M13: skipping errors summarizes replayed course, student, and enrollment counts', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01',
    'chem-9;Chemie 9;Chemie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  assert.ok(skipButton, 'der reale Warnungsdialog muss das Überspringen anbieten');

  await skipButton.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der bereinigte Kandidat muss gespeichert werden');
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.equal(importer.getState().courses.length, 1, 'the published state after Save matches the replay');
  assert.equal(importer.getState().students.length, 1);
  const summaries = alerts.filter(message => /CSV-Import abgeschlossen/.test(message));
  assert.equal(summaries.length, 1, 'Skip darf genau eine abgeschlossene Zusammenfassung anzeigen');
  assert.match(summaries[0], /Neue Kurse: 1/);
  assert.match(summaries[0], /Neue Schüler:innen: 1/);
  assert.match(summaries[0], /Anmeldungen \(Kurszuordnungen\): 1/);
});

test('M12/M13: accepting recoverable errors reports completion only after a successful save', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  modules.Storage.saveState = async () => { throw new Error('Speicherfehler'); };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const acceptButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
  );
  assert.ok(acceptButton, 'der reale Warnungsdialog muss die Übernahme anbieten');

  await acceptButton.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(alerts.some(message => /Fehler beim Abschließen des Imports/.test(message)));
  assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
});

test('M12/M13: accepted CSV errors use actual saved counts and include a warning', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = candidate; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01',
    'chem-9;Chemie 9;Chemie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const acceptButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
  );
  assert.ok(acceptButton);

  await acceptButton.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState);
  assert.equal(savedState.courses.length, 2);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.courses.flatMap(course => course.enrollments).length, 2);
  const summaries = alerts.filter(message => /CSV-Import abgeschlossen/.test(message));
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /Neue Kurse: 2/);
  assert.match(summaries[0], /Neue Schüler:innen: 1/);
  assert.match(summaries[0], /Anmeldungen \(Kurszuordnungen\): 2/);
  assert.match(summaries[0], /Warnung: Fehlerhafte Zeilen wurden übernommen \(1\)/);
});

test('M12/M13 review fix: close during Skip save is inert and cannot create a second terminal result', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  const saveDeferred = createDeferred();
  let saveCalls = 0;
  modules.Storage.saveState = async () => {
    saveCalls++;
    return saveDeferred.promise;
  };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01',
    'chem-9;Chemie 9;Chemie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  const closeButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && element.textContent === 'Schließen'
  );
  assert.ok(skipButton);
  assert.ok(closeButton);

  const skipPromise = skipButton.click();
  // Der produktive Committer startet auch die erste Transaktion am Queue-Kopf
  // in einer Microtask. Die Aussage bleibt: Close trifft einen laufenden Save.
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  await closeButton.click();
  assert.deepEqual(alerts, [], 'Close darf während der Persistenz kein Abbruchergebnis auslösen');

  saveDeferred.resolve();
  await skipPromise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 1);
  assert.equal(alerts.filter(message => /CSV-Import abgeschlossen/.test(message)).length, 1);
  assert.equal(alerts.some(message => /Import abgebrochen/.test(message)), false);
});

test('M12/M13 review fix: concurrent Skip and Accept decisions perform one save and one summary', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  const saveDeferred = createDeferred();
  let saveCalls = 0;
  modules.Storage.saveState = async () => {
    saveCalls++;
    return saveDeferred.promise;
  };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01',
    'chem-9;Chemie 9;Chemie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  const acceptButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
  );
  assert.ok(skipButton);
  assert.ok(acceptButton);

  const skipPromise = skipButton.click();
  const acceptPromise = acceptButton.click();
  // Queue-Start abwarten, ohne den absichtlich blockierten Save aufzulösen.
  await Promise.resolve();
  assert.equal(saveCalls, 1, 'konkurrierende Entscheidungen dürfen nur einen Save starten');

  saveDeferred.resolve();
  await Promise.all([skipPromise, acceptPromise]);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(alerts.filter(message => /CSV-Import abgeschlossen/.test(message)).length, 1);
});

test('M12/M13 review fix: failed Skip save leaves the original candidate for a later Accept', async () => {
  const modules = loadModules();
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  const firstSave = createDeferred();
  const secondSave = createDeferred();
  const savedCandidates = [];
  let saveCalls = 0;
  modules.Storage.saveState = async candidate => {
    saveCalls++;
    savedCandidates.push(JSON.parse(JSON.stringify(candidate)));
    return (saveCalls === 1 ? firstSave : secondSave).promise;
  };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

  importer.importCsvText([
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01',
    'chem-9;Chemie 9;Chemie;9a;S1;Meier;;2010-01-01'
  ].join('\n'));
  await new Promise(resolve => setImmediate(resolve));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  const acceptButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Trotz Fehler übernehmen/.test(element.textContent)
  );
  assert.ok(skipButton);
  assert.ok(acceptButton);

  const skipPromise = skipButton.click();
  // Der reale Queue-Vertrag plant den Persistenzaufruf für die nächste Microtask.
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  firstSave.reject(new Error('Skip-Speicherfehler'));
  await skipPromise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alerts.filter(message => /CSV-Import abgeschlossen/.test(message)).length, 0);

  const acceptPromise = acceptButton.click();
  // Auch der Retry läuft über denselben produktiven Queue-Kopf.
  await Promise.resolve();
  assert.equal(saveCalls, 2);
  secondSave.resolve();
  await acceptPromise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(savedCandidates[1].courses.length, 2, 'Accept muss den unbeschnittenen Kandidaten speichern');
  assert.equal(savedCandidates[1].students.length, 1);
  assert.equal(savedCandidates[1].courses.flatMap(course => course.enrollments).length, 2);
  const summaries = alerts.filter(message => /CSV-Import abgeschlossen/.test(message));
  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /Neue Kurse: 2/);
  assert.match(summaries[0], /Anmeldungen \(Kurszuordnungen\): 2/);
});

test('M12/M13 review fix: error-free imports report completion only after deferred save resolution', async () => {
  for (const shouldReject of [false, true]) {
    const modules = loadModules();
    const document = createCsvDocumentStub();
    modules.sandbox.document = document;
    const alerts = [];
    modules.sandbox.window.alert = message => alerts.push(String(message));
    const saveDeferred = createDeferred();
    modules.Storage.saveState = async () => saveDeferred.promise;
    const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState());

    importer.importCsvText([
      'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
      'bio-9;Biologie 9;Biologie;9a;S1;Meier;Max;2010-01-01'
    ].join('\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);

    if (shouldReject) saveDeferred.reject(new Error('Speicherfehler'));
    else saveDeferred.resolve();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(
      alerts.some(message => /CSV-Import abgeschlossen/.test(message)),
      !shouldReject,
      shouldReject ? 'bei Reject darf kein Erfolg erscheinen' : 'nach Resolve muss Erfolg erscheinen'
    );
  }
});
