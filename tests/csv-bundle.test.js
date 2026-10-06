'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');
const { loadCsvImporter, loadCsvExporter } = require('./harness/csv-transfer.js');
const { createCsvDocumentStub, collectCsvElementText } = require('./harness/csv-document.js');

const CSV_NAMES = ['csvCell', 'encodeCsvTransferRow', 'decodeCsvTransferFields',
  'parseSemicolonCsv', 'validateCsvTransferHeader',
  'normalizeCsvDate', 'formatCsvImportIssuesText', 'formatCsvImportIssuesCsv'];
const CSV_PROTECTION_NAMES = new Set(['encodeCsvTransferRow', 'decodeCsvTransferFields']);
const RULE_NAMES = ['parseCsvTransferContextFields', 'validateCsvCourseContextConsistency',
  'csvCourseContextMatches', 'validateCsvStudentIdentity', 'findCompatibleCsvStudent'];
const htmlPath = path.join(__dirname, '..', 'Notenverwaltung.html');

function installHtmlCsvFunctions(modules, htmlLines) {
  const protectionStart = htmlLines.findIndex(line => /^  var CSV_TRANSFER_FIELDS = \[/.test(line));
  const parserStart = htmlLines.findIndex(line => /^  function parseSemicolonCsv\(text\)/.test(line));
  assert.ok(protectionStart >= 0 && parserStart > protectionStart, 'das Artefakt muss den vollständigen CSV-Schutzblock enthalten');
  const protectionSource = htmlLines.slice(protectionStart, parserStart).join('\n');
  const source = protectionSource + '\n\n' + CSV_NAMES
    .filter(name => !CSV_PROTECTION_NAMES.has(name))
    .map(name => extractFunction(htmlLines, name)).join('\n\n')
    + '\nglobalThis.__htmlCsv = { ' + CSV_NAMES.join(', ') + ' };';
  vm.runInContext(source, modules.sandbox, { filename: 'csv-from-artifact.js' });
  Object.assign(modules.sandbox, modules.sandbox.__htmlCsv);
  modules.sandbox.__csv_format_exports = modules.sandbox.__htmlCsv;

  vm.runInContext(
    extractFunction(htmlLines, 'isCanonicalTerm') + '\n' +
      extractFunction(htmlLines, 'normalizeAssessmentTerm'),
    modules.sandbox,
    { filename: 'assessment-term-from-artifact.js' }
  );

  const constantNames = ['SCHEMA_MODES', 'UPPERSEC_COURSE_TYPES', 'QUALIFICATION_YEARS'];
  const constants = constantNames.map(name => {
    const marker = `  var ${name} = {`;
    assert.equal(htmlLines.filter(line => line === marker).length, 1, name);
    const start = htmlLines.indexOf(marker);
    const end = htmlLines.indexOf('  };', start + 1);
    assert.ok(end > start, name);
    return htmlLines.slice(start, end + 1).join('\n');
  }).join('\n');
  const ruleSource = constants + '\n' + RULE_NAMES.map(name => extractFunction(htmlLines, name)).join('\n')
    + '\nreturn { ' + RULE_NAMES.join(', ') + ' };';
  const htmlRules = vm.runInContext('(function(){\n' + ruleSource + '\n})()', modules.sandbox);
  Object.assign(modules.sandbox, htmlRules);
  modules.sandbox.__csv_import_rules_exports = htmlRules;
}

function findCsvElement(element, predicate) {
  if (!element) return null;
  if (predicate(element)) return element;
  for (const child of element.children || []) {
    const match = findCsvElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function artifactLinesWithProvenanceParser() {
  const htmlLines = readSourceLines(htmlPath);
  const parserLine = htmlLines.findIndex(line => /^  function parseSemicolonCsv\(text\)/.test(line));
  assert.ok(parserLine >= 0, 'das Artefakt muss den CSV-Parser enthalten');
  htmlLines.splice(parserLine + 1, 0,
    '    if (text === "__artifact-provenance__") return [',
    '      { fields: ["KursID", "Kurs", "Fach", "Klasse", "SchuelerID", "Nachname", "Vorname", "Geburtstag"], line: 1 },',
    '      { fields: ["bio-artifact", "Biologie", "Biologie", "9a", "S1", "Muster", "Mia", "2012-02-29"], line: 2 },',
    '      { fields: ["chem-artifact", "Chemie", "Chemie", "9a", "S2", "Beispiel", "", "2012-02-29"], line: 3 }',
    '    ];'
  );
  const ruleLine = htmlLines.findIndex(line => /^  function parseCsvTransferContextFields\(fields\)/.test(line));
  assert.ok(ruleLine >= 0, 'das Artefakt muss die CSV-Kontextregel enthalten');
  htmlLines.splice(ruleLine + 1, 0, '    globalThis.__artifactCsvRuleUsed = true;');
  const stateCommitLine = htmlLines.findIndex(line => /^  function createStateCommitter\(\{/.test(line));
  const stateCommitBodyLine = htmlLines.findIndex((line, index) => index > stateCommitLine && line === '  }) {');
  assert.ok(stateCommitLine >= 0 && stateCommitBodyLine > stateCommitLine,
    'das Artefakt muss den Zustands-Committer enthalten');
  htmlLines.splice(stateCommitBodyLine + 1, 0, '    globalThis.__artifactStateCommitterUsed = true;');
  return htmlLines;
}

test('generated CSV artifact supplies preparation and skip-pruning without source fallback', async () => {
  const htmlLines = artifactLinesWithProvenanceParser();
  const modules = loadModules();
  installHtmlCsvFunctions(modules, htmlLines);
  const document = createCsvDocumentStub();
  modules.sandbox.document = document;
  const diagnostics = [];
  modules.sandbox.window.alert = message => diagnostics.push('alert: ' + String(message));
  modules.sandbox.console.error = (...args) => diagnostics.push('error: ' + args.map(String).join(' | '));
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = JSON.parse(JSON.stringify(candidate)); };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState(), htmlLines);

  importer.importCsvText('__artifact-provenance__');
  await new Promise(resolve => setImmediate(resolve));
  const skipButton = findCsvElement(
    document.body,
    element => element.tagName === 'BUTTON' && /Fehlerhafte Zeilen überspringen/.test(element.textContent)
  );
  assert.ok(skipButton, 'nur der Artefakt-Orchestrator erreicht die Skip-Entscheidung');
  await skipButton.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der Artefakt-Kandidat muss nach dem Pruning gespeichert werden; ' + diagnostics.join(' / '));
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.equal(savedState.courses[0].importKey, 'bio-artifact');
  assert.equal(modules.sandbox.__artifactCsvRuleUsed, true, 'die Artefakt-Kontextregel muss ausgeführt werden');
  assert.equal(modules.sandbox.__artifactStateCommitterUsed, true,
    'der Import muss den Zustands-Committer aus dem Artefakt ausführen');
});

test('generated CSV importer fails closed when the artifact state committer binding is missing', () => {
  const htmlLines = readSourceLines(htmlPath);
  const stateCommitStart = htmlLines.indexOf('  // src/ui/state-commit.js');
  const nextModuleStart = htmlLines.findIndex((line, index) =>
    index > stateCommitStart && /^  \/\/ src\//.test(line)
  );
  assert.ok(stateCommitStart >= 0 && nextModuleStart > stateCommitStart);
  htmlLines.splice(stateCommitStart, nextModuleStart - stateCommitStart);

  const modules = loadModules();
  installHtmlCsvFunctions(modules, htmlLines);
  assert.throws(
    () => loadCsvImporter(modules, modules.DomainModel.createEmptyState(), htmlLines),
    /Artefaktblock für Zustands-Commits nicht gefunden\./
  );
});

test('generated CSV helpers drive the real artifact importer and exporter', async () => {
  const htmlLines = readSourceLines(htmlPath);
  const sourceModules = loadModules();
  installHtmlCsvFunctions(sourceModules, htmlLines);
  let savedState = null;
  sourceModules.Storage.saveState = async candidate => { savedState = JSON.parse(JSON.stringify(candidate)); };
  const importer = loadCsvImporter(sourceModules, sourceModules.DomainModel.createEmptyState(), htmlLines);
  const csvText = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n'
    + 'bio-test;Biologie;Biologie;9a;S1;Muster;Mia;29.02.2012';

  importer.importCsvText(csvText);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState, 'der echte HTML-Import muss einen Kandidaten speichern');
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.students[0].lastName, 'Muster');
  assert.equal(savedState.students[0].birthDate, '2012-02-29');
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.courses[0].importKey, 'bio-test');
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.equal(savedState.courses[0].enrollments[0].studentId, savedState.students[0].id);

  const exportModules = loadModules();
  installHtmlCsvFunctions(exportModules, htmlLines);
  const exportCsv = loadCsvExporter(exportModules, savedState, htmlLines);
  const download = exportCsv([savedState.courses[0]]);
  assert.ok(download.content.startsWith('\ufeffKursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag'));
  assert.equal(download.mimeType, 'text/csv;charset=utf-8');
  assert.match(download.filename, /^notenverwaltung_kurs_export_Biologie_\d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(download.content.split('\n')[0], /;Stammklasse;CSV-Schutz$/);
  assert.match(download.content.split('\n')[1], /;nv1:0$/);

  const targetModules = loadModules();
  installHtmlCsvFunctions(targetModules, htmlLines);
  let roundTripState = null;
  targetModules.Storage.saveState = async candidate => { roundTripState = JSON.parse(JSON.stringify(candidate)); };
  const reimporter = loadCsvImporter(targetModules, targetModules.DomainModel.createEmptyState(), htmlLines);
  reimporter.importCsvText(download.content);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(roundTripState, 'der echte HTML-Reimport muss den Export speichern');
  assert.equal(roundTripState.students.length, 1);
  assert.equal(roundTripState.students[0].lastName, 'Muster');
  assert.equal(roundTripState.students[0].birthDate, '2012-02-29');
  assert.equal(roundTripState.courses.length, 1);
  assert.equal(roundTripState.courses[0].importKey, 'bio-test');
  assert.equal(roundTripState.courses[0].enrollments[0].studentId, roundTripState.students[0].id);
});

test('generated CSV importer rejects an invalid header without saving', async () => {
  const htmlLines = readSourceLines(htmlPath);
  const modules = loadModules();
  installHtmlCsvFunctions(modules, htmlLines);
  let saveCalls = 0;
  const alerts = [];
  modules.sandbox.window.alert = message => alerts.push(String(message));
  modules.Storage.saveState = async () => { saveCalls++; };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState(), htmlLines);

  importer.importCsvText('Falsch;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n'
    + 'bio-test;Biologie;Biologie;9a;S1;Muster;Mia;29.02.2012');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 0);
  assert.ok(alerts.includes('CSV-Import abgebrochen: Die Kopfzeile muss aus den ersten 8 bis 13 Spalten oder zusätzlich aus CSV-Schutz bestehen.'));
});

test('source imports CSV helpers and rules while generated HTML retains each exactly once', () => {
  const source = readSourceLines().join('\n');
  assert.match(source, /import \{ csvCell, encodeCsvTransferRow, parseSemicolonCsv, validateCsvTransferHeader, normalizeCsvDate,\s*formatCsvImportIssuesText, formatCsvImportIssuesCsv \} from '\.\.\/transfer\/csv-format\.js';/);
  assert.match(source, /import \{ decodeCsvBytes, CsvDecodeError \} from '\.\.\/transfer\/csv-decoding\.js';/);
  assert.match(source, /import \{ parseCsvTransferContextFields, validateCsvCourseContextConsistency,\s*csvCourseContextMatches, validateCsvStudentIdentity, findCompatibleCsvStudent\s*\} from '\.\.\/transfer\/csv-import-rules\.js';/);
  for (const name of CSV_NAMES) {
    assert.equal((source.match(new RegExp(`function ${name}\\s*\\(`, 'g')) || []).length, 0, name);
  }
  for (const name of RULE_NAMES) {
    assert.equal((source.match(new RegExp(`function ${name}\\s*\\(`, 'g')) || []).length, 0, name);
  }

  const htmlLines = readSourceLines(htmlPath);
  for (const name of [...CSV_NAMES, ...RULE_NAMES]) {
    assert.equal(htmlLines.filter(line => new RegExp(`function ${name}\\s*\\(`).test(line)).length, 1, name);
  }
});

test('generated CSV rules permit a valid upper-secondary import', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich';
  const good = 'bio-stabil;Biologie Kurs;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja';
  const htmlLines = readSourceLines(htmlPath);
  const modules = loadModules();
  installHtmlCsvFunctions(modules, htmlLines);
  modules.sandbox.document = createCsvDocumentStub();
  let savedState = null;
  modules.Storage.saveState = async candidate => { savedState = JSON.parse(JSON.stringify(candidate)); };
  const importer = loadCsvImporter(modules, modules.DomainModel.createEmptyState(), htmlLines);

  importer.importCsvText(header + '\n' + good);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(savedState);
  assert.equal(savedState.students.length, 1);
  assert.equal(savedState.courses.length, 1);
  assert.equal(savedState.courses[0].enrollments.length, 1);
  assert.equal(savedState.courses[0].schemaMode, 'uppersec');
  assert.equal(savedState.courses[0].upperSecContext.courseType, 'basic');
  assert.equal(savedState.courses[0].upperSecContext.qualificationYear, 'q3-q4');
  assert.equal(savedState.courses[0].enrollments[0].writtenExamSubjectQ4, true);
});

test('generated CSV rules reject a conflicting existing course context without saving', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich';
  const good = 'bio-stabil;Biologie Kurs;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja';
  const htmlLines = readSourceLines(htmlPath);
  const modules = loadModules();
  installHtmlCsvFunctions(modules, htmlLines);
  const document = createCsvDocumentStub();
  const alerts = [];
  modules.sandbox.document = document;
  modules.sandbox.window.alert = message => alerts.push(String(message));
  const initialState = modules.DomainModel.createEmptyState();
  initialState.courses.push(modules.DomainModel.createCourse({
    name: 'Biologie Kurs', subject: 'Biologie', schemaMode: 'uppersec',
    upperSecContext: { courseType: 'advanced', qualificationYear: 'q1-q2' }, importKey: 'bio-stabil'
  }));
  const initialSnapshot = JSON.parse(JSON.stringify(initialState));
  let saveCalls = 0;
  modules.Storage.saveState = async () => { saveCalls++; };
  const importer = loadCsvImporter(modules, initialState, htmlLines);

  importer.importCsvText(header + '\n' + good);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
  assert.match([collectCsvElementText(document.body), ...alerts].join('\n'), /Der Kurskontext widerspricht dem bereits vorhandenen Kurs\./);
});

test('generated CSV rules reject conflicting student identities in both row orders without saving', async () => {
  const header = 'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich';
  const good = 'bio-stabil;Biologie Kurs;Biologie;;person-1;Muster;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja';
  const identityConflict = 'bio-stabil;Biologie Kurs;Biologie;;person-1;Anders;Mia;2008-04-03;Sek II;GK;Q3/Q4;Ja';
  const htmlLines = readSourceLines(htmlPath);

  for (const rows of [[good, identityConflict], [identityConflict, good]]) {
    const modules = loadModules();
    installHtmlCsvFunctions(modules, htmlLines);
    const document = createCsvDocumentStub();
    const alerts = [];
    modules.sandbox.document = document;
    modules.sandbox.window.alert = message => alerts.push(String(message));
    const initialState = modules.DomainModel.createEmptyState();
    const initialSnapshot = JSON.parse(JSON.stringify(initialState));
    let saveCalls = 0;
    modules.Storage.saveState = async () => { saveCalls++; };
    const importer = loadCsvImporter(modules, initialState, htmlLines);

    importer.importCsvText([header, ...rows].join('\n'));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(saveCalls, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(importer.getState())), initialSnapshot);
    assert.match([collectCsvElementText(document.body), ...alerts].join('\n'), /Dieselbe SchuelerID enthält widersprüchliche Identitätsfelder \(Nachname\)\./);
  }
});
