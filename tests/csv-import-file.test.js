'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { loadEsmGraph } = require('./harness/load-esm-graph');
const fs = require('node:fs');
const path = require('node:path');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', `acceptance-csv-${name}.csv`), 'utf8');
const VALID = fixture('valid');
const WARNING = fixture('warning');

async function harness() {
  const app = await loadDashboardUi();
  const csvBlobs = [];
  const revokedUrls = [];
  app.sandbox.Blob = Blob;
  app.sandbox.URL = {
    createObjectURL(blob) {
      csvBlobs.push(blob);
      return 'blob:csv-transfer-test';
    },
    revokeObjectURL(url) { revokedUrls.push(url); }
  };
  const createElement = app.document.createElement.bind(app.document);
  app.document.createElement = tagName => {
    const element = createElement(tagName);
    if (String(tagName).toLowerCase() === 'a') element.click = () => {};
    return element;
  };
  app.sandbox.CsvImportOrchestrator = loadEsmGraph('src/transfer/csv-import-orchestrator.js')
    .exports.createCsvImportOrchestrator({ DomainModel: app.DomainModel });
  const person = app.DomainModel.createStudent({ lastName: 'Bestand', firstName: 'Fiktiv' });
  const initial = await app.Storage.loadState();
  app.DomainModel.addStudentToState(initial, person);
  await app.Storage.saveState(initial);
  await app.UiShell.init('app');
  const nav = app.root._find(item => item.classList.contains('nav-main'));
  await findByText(nav, 'Import / Export').dispatch('click');
  const input = findByAttribute(app.root, 'id', 'csv-import-file');
  const alerts = [];
  app.sandbox.window.alert = message => alerts.push(String(message));
  let readDone = Promise.resolve();
  let reads = 0;
  let textReads = 0;
  app.sandbox.FileReader = class {
    readAsArrayBuffer(file) {
      reads++;
      readDone = Promise.resolve().then(() => {
        if (file.error) {
          this.error = file.error;
          this.onerror?.({ target: this });
        } else {
          const bytes = file.bytes || new TextEncoder().encode(file.text || '');
          const copy = Uint8Array.from(bytes);
          this.onload({ target: { result: copy.buffer } });
        }
      });
    }
    readAsText() {
      textReads++;
      throw new Error('CSV files must be read as bytes');
    }
  };
  const originalSave = app.Storage.saveState;
  let saves = 0;
  let saved = Promise.resolve();
  app.Storage.saveState = (...args) => {
    saves++;
    saved = originalSave(...args);
    return saved;
  };
  const snapshot = JSON.stringify(await app.Storage.loadState());
  return {
    app, input, alerts, snapshot, csvBlobs, revokedUrls,
    reads: () => reads, textReads: () => textReads, saves: () => saves,
    state: () => app.Storage.loadState(),
    async settle() { await saved; await new Promise(resolve => setImmediate(resolve)); },
    async select(file) {
      input.files = file ? [file] : [];
      input.value = file ? file.name : '';
      await input.dispatch('change');
      await readDone;
      await this.settle();
    },
    button(text) {
      return app.document.body._find(element => element.tagName === 'BUTTON' && element.textContent === text);
    }
  };
}

test('the real CSV template download uses the protected fourteen-column format', async () => {
  const h = await harness();
  const download = h.button('CSV-Vorlage herunterladen');
  assert.ok(download);
  assert.equal(download._listeners('click').length, 1);

  await download.dispatch('click');

  assert.equal(h.csvBlobs.length, 1, JSON.stringify({ alerts: h.alerts }));
  const lines = (await h.csvBlobs[0].text()).replace(/^\uFEFF/, '').split('\n');
  assert.equal(
    lines[0],
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz'
  );
  assert.equal(lines.length, 21);
  assert.ok(lines.slice(1).every(line => line === ';;;;;;;;;;;;;nv1:0'));
  assert.deepEqual(h.revokedUrls, ['blob:csv-transfer-test']);
});

test('CSV file read errors explain failure, preserve stored data and allow retry of the same file', async () => {
  const h = await harness();
  await h.select({ name: 'test.csv', error: new Error('Synthetischer Lesefehler') });
  assert.equal(JSON.stringify(await h.state()), h.snapshot);
  assert.equal(h.saves(), 0);
  assert.deepEqual(h.alerts, ['CSV-Datei konnte nicht gelesen werden. Der bisherige Datenbestand bleibt erhalten. Bitte wählen Sie die Datei erneut aus.']);
  assert.equal(h.input.value, '');
  await h.select({ name: 'test.csv', text: VALID });
  assert.equal(h.textReads(), 0);
  assert.equal(h.saves(), 1);
  assert.deepEqual(Array.from((await h.state()).students, item => item.lastName).sort(), ['Bestand', 'Müller']);
  assert.equal(h.alerts.filter(item => /CSV-Import abgeschlossen/.test(item)).length, 1);
});

function windows1252CsvWithUmlaut() {
  const before = new TextEncoder().encode(
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n' +
    'bio-9;Biologie 9;Biologie;9a;S1;M'
  );
  const after = new TextEncoder().encode('ller;Mia;2010-04-03');
  return Uint8Array.from([...before, 0xfc, ...after]);
}

test('invalid UTF-8 offers an explicit Windows-1252 preview and saves only after apply', async () => {
  const h = await harness();
  await h.select({ name: 'windows.csv', bytes: windows1252CsvWithUmlaut() });

  assert.equal(h.reads(), 1);
  assert.equal(h.saves(), 0, 'strict UTF-8 failure must not prepare or save an import');
  assert.equal(h.alerts.some(item => /CSV-Import abgeschlossen/.test(item)), false);
  const retry = h.button('Als Windows-1252 erneut lesen');
  assert.ok(retry, 'the existing import card must offer the explicit retry');

  await retry.dispatch('click');
  await h.settle();

  assert.equal(h.reads(), 1, 'retry must decode the already read byte sequence');
  assert.equal(h.saves(), 0, 'the decoded retry must remain a preview until explicitly applied');
  const preview = findByAttribute(h.app.root, 'id', 'csv-import-decode-preview');
  assert.match(preview.textContent, /Müller/);
  const apply = h.button('CSV-Vorschau übernehmen');
  assert.ok(apply);
  await apply.dispatch('click');
  await h.settle();

  assert.equal(h.saves(), 1);
  assert.deepEqual(Array.from((await h.state()).students, item => item.lastName).sort(), ['Bestand', 'Müller']);
});

test('cancelling a decode retry discards pending bytes and cannot create a later preview', async () => {
  const h = await harness();
  await h.select({ name: 'windows.csv', bytes: windows1252CsvWithUmlaut() });
  const retry = h.button('Als Windows-1252 erneut lesen');
  assert.ok(retry);
  await retry.dispatch('click');
  const cancel = h.button('Abbrechen');
  const apply = h.button('CSV-Vorschau übernehmen');
  assert.ok(cancel);
  assert.ok(apply);
  assert.match(findByAttribute(h.app.root, 'id', 'csv-import-decode-preview').textContent, /Müller/);

  await cancel.dispatch('click');
  assert.equal(retry.parentNode.parentNode.style.display, 'none');
  assert.equal(findByAttribute(h.app.root, 'id', 'csv-import-decode-preview').textContent, '');
  await apply.dispatch('click');
  await h.settle();

  assert.equal(h.reads(), 1);
  assert.equal(h.saves(), 0);
  assert.equal(JSON.stringify(await h.state()), h.snapshot);
  assert.equal(h.alerts.some(item => /CSV-Import abgeschlossen/.test(item)), false);
});

test('legacy formula apostrophes remain data and the successful summary explains the ambiguity', async () => {
  const h = await harness();
  const legacy = [
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag',
    "musik-9;Musik 9;Musik;9a;S1;'=Chor;Mia;2010-04-03"
  ].join('\n');

  await h.select({ name: 'legacy.csv', text: legacy });

  assert.equal(h.saves(), 1);
  assert.ok((await h.state()).students.some(student => student.lastName === "'=Chor"));
  assert.match(
    h.alerts.find(item => /CSV-Import abgeschlossen/.test(item)) || '',
    /Führende Apostrophe.*beibehalten.*ohne CSV-Schutz/i
  );
});

test('closing a CSV warning through the rendered file handler preserves the encrypted original', async () => {
  const h = await harness();
  await h.select({ name: 'warnung.csv', text: WARNING });
  assert.equal(h.saves(), 0);
  const close = h.button('Schließen');
  assert.ok(close);
  await close.dispatch('click');
  await h.settle();
  assert.equal(h.saves(), 0);
  assert.equal(JSON.stringify(await h.state()), h.snapshot);
  assert.ok(h.alerts.some(item => /Import abgebrochen/.test(item)));
  assert.equal(h.alerts.some(item => /CSV-Import abgeschlossen/.test(item)), false);
});

test('skipping CSV warning rows commits only valid additions through real encrypted storage', async () => {
  const h = await harness();
  await h.select({ name: 'warnung.csv', text: WARNING });
  const skip = h.button('Fehlerhafte Zeilen überspringen');
  assert.ok(skip);
  await skip.dispatch('click');
  await h.settle();
  const state = await h.state();
  assert.equal(h.saves(), 1);
  assert.deepEqual(Array.from(state.students, item => item.lastName).sort(), ['Bestand', 'Müller']);
  assert.equal(state.courses.length, 1);
  assert.equal(state.courses[0].enrollments.length, 1);
});

test('fatal contradictory student identity from a CSV file leaves the entire original unchanged', async () => {
  const h = await harness();
  await h.select({ name: 'konflikt.csv', text: fixture('conflict') });
  assert.equal(h.saves(), 0);
  assert.equal(JSON.stringify(await h.state()), h.snapshot);
  assert.ok(h.button('Schließen'), 'fatal conflict must show its actual dialog');
  assert.equal(h.button('Trotz Fehler übernehmen'), null);
  assert.equal(h.alerts.some(item => /CSV-Import abgeschlossen/.test(item)), false);
});

test('cancelled file selection and unsupported Excel file never read or change stored data', async () => {
  const h = await harness();
  await h.select(null);
  assert.deepEqual(h.alerts, []);
  await h.select({ name: 'test.xlsx', text: VALID });
  assert.equal(h.reads(), 0);
  assert.equal(h.saves(), 0);
  assert.equal(JSON.stringify(await h.state()), h.snapshot);
  assert.equal(h.input.value, '');
  assert.ok(h.alerts.some(item => /CSV-Datei/.test(item)));
});
