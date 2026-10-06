'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

function findByClass(root, className) {
  return root._find(element => element.classList && element.classList.contains(className));
}

function transferTab(root, areaId) {
  return findByAttribute(root, 'data-transfer-area', areaId);
}

function transferPanel(root, areaId) {
  return findByAttribute(root, 'data-transfer-panel', areaId);
}

function findLabel(root, text) {
  return root._find(element => element.tagName === 'LABEL' && element.textContent === text);
}

function findButtonByText(root, text) {
  return root._find(element => element.tagName === 'BUTTON' && element.textContent === text);
}

function nav(root) {
  return findByClass(root, 'nav-main');
}

async function openTransfer(app) {
  await findByText(nav(app.root), 'Import / Export').dispatch('click');
}

async function transferFixture({ withCourses = true } = {}) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  let activeCourse = null;
  let archivedCourse = null;
  if (withCourses) {
    activeCourse = probe.DomainModel.createCourse({
      id: 'transfer-active', name: 'Biologie', subject: 'Biologie', classLabel: '10c'
    });
    archivedCourse = probe.DomainModel.createCourse({
      id: 'transfer-archive', name: 'Biologie 2025/26', subject: 'Biologie', classLabel: '10b',
      archivedAt: '2026-07-31T12:00:00.000Z'
    });
    probe.DomainModel.addCourseToState(state, activeCourse);
    probe.DomainModel.addCourseToState(state, archivedCourse);
  } else {
    archivedCourse = probe.DomainModel.createCourse({
      id: 'transfer-only-archive', name: 'Archivkurs', subject: 'Geschichte', classLabel: '9a',
      archivedAt: '2026-07-31T12:00:00.000Z'
    });
    probe.DomainModel.addCourseToState(state, archivedCourse);
  }
  archivedCourse.archiveSnapshot = probe.DomainModel.createArchiveSnapshot(state, archivedCourse);
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await openTransfer(app);
  return { app, activeCourse, archivedCourse };
}

test('Import / Export nutzt drei verbundene Tabs mit vollständiger Tastatursteuerung', async () => {
  const { app } = await transferFixture();
  const tablist = findByClass(app.root, 'transfer-tabs');
  const tabs = ['export', 'backup', 'csv'].map(areaId => transferTab(app.root, areaId));
  const panels = ['export', 'backup', 'csv'].map(areaId => transferPanel(app.root, areaId));

  assert.ok(tablist, 'die drei Aufgaben brauchen eine gemeinsame Navigation');
  assert.equal(tablist.getAttribute('role'), 'tablist');
  assert.equal(tablist.getAttribute('aria-label'), 'Import- und Exportbereiche');
  assert.deepEqual(tabs.map(tab => tab.textContent), ['Export', 'Backup wiederherstellen', 'CSV-Import']);
  for (let index = 0; index < tabs.length; index += 1) {
    assert.equal(tabs[index].getAttribute('role'), 'tab');
    assert.equal(tabs[index].getAttribute('aria-controls'), panels[index].id);
    assert.equal(panels[index].getAttribute('role'), 'tabpanel');
    assert.equal(panels[index].getAttribute('aria-labelledby'), tabs[index].id);
  }
  assert.deepEqual(tabs.map(tab => [tab.getAttribute('aria-selected'), tab.tabIndex]), [
    ['true', 0], ['false', -1], ['false', -1]
  ]);
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true]);

  let prevented = 0;
  await tabs[0].dispatch('keydown', { key: 'ArrowRight', preventDefault() { prevented += 1; } });
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(app.document.activeElement, tabs[1]);
  await tabs[1].dispatch('keydown', { key: 'End', preventDefault() { prevented += 1; } });
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  assert.equal(app.document.activeElement, tabs[2]);
  await tabs[2].dispatch('keydown', { key: 'ArrowRight', preventDefault() { prevented += 1; } });
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'Pfeil rechts umläuft zum ersten Tab');
  await tabs[0].dispatch('keydown', { key: 'ArrowLeft', preventDefault() { prevented += 1; } });
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true', 'Pfeil links umläuft zum letzten Tab');
  await tabs[2].dispatch('keydown', { key: 'Home', preventDefault() { prevented += 1; } });
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(prevented, 5);
});

test('bestehende Export-, Backup- und CSV-Elemente bleiben im passenden Panel montiert', async () => {
  const { app, activeCourse, archivedCourse } = await transferFixture();
  const exportPanel = transferPanel(app.root, 'export');
  const backupPanel = transferPanel(app.root, 'backup');
  const csvPanel = transferPanel(app.root, 'csv');
  const courseSelect = findByAttribute(exportPanel, 'id', 'transfer-course-select');

  assert.ok(findByText(exportPanel, 'CSV für Import exportieren'));
  assert.ok(findByText(exportPanel, 'Excel für Kolleg:innen exportieren'));
  assert.equal(courseSelect.value, activeCourse.id, 'der aktuell geöffnete Kurs bleibt vorausgewählt');
  assert.deepEqual(courseSelect.options.map(option => [option.value, option.textContent]), [
    ['__all__', 'Alle aktiven Kurse / Klassen'],
    [activeCourse.id, 'Biologie (10c)'],
    [archivedCourse.id, '[Archiv] Biologie 2025/26 (10b)']
  ]);

  const mergeCheckbox = findByAttribute(backupPanel, 'id', 'json-import-merge-checkbox');
  assert.ok(mergeCheckbox);
  assert.equal(mergeCheckbox.checked, false);
  assert.equal(findByAttribute(backupPanel, 'id', 'json-import-file').accept, 'application/json');

  assert.ok(findByText(csvPanel, 'CSV-Vorlage herunterladen'));
  assert.equal(findByAttribute(csvPanel, 'id', 'csv-import-file').accept, '.csv,text/csv');
});

test('reines Umschalten bewahrt Auswahl und Eingabeelemente und löst keine Datei- oder Speicheraktion aus', async () => {
  const { app, archivedCourse } = await transferFixture();
  const exportPanel = transferPanel(app.root, 'export');
  const backupPanel = transferPanel(app.root, 'backup');
  const csvPanel = transferPanel(app.root, 'csv');
  const courseSelect = findByAttribute(exportPanel, 'id', 'transfer-course-select');
  const mergeCheckbox = findByAttribute(backupPanel, 'id', 'json-import-merge-checkbox');
  const jsonInput = findByAttribute(backupPanel, 'id', 'json-import-file');
  const csvInput = findByAttribute(csvPanel, 'id', 'csv-import-file');
  courseSelect.value = archivedCourse.id;
  mergeCheckbox.checked = true;

  let saveCalls = 0;
  let readerCalls = 0;
  let downloadCalls = 0;
  const originalSaveState = app.Storage.saveState;
  app.Storage.saveState = function (...args) {
    saveCalls += 1;
    return originalSaveState(...args);
  };
  app.sandbox.FileReader = class {
    constructor() { readerCalls += 1; }
  };
  app.sandbox.URL = {
    createObjectURL() { downloadCalls += 1; return 'blob:test'; },
    revokeObjectURL() {}
  };

  await transferTab(app.root, 'backup').dispatch('click');
  await transferTab(app.root, 'csv').dispatch('click');
  await transferTab(app.root, 'export').dispatch('click');

  assert.equal(findByAttribute(app.root, 'id', 'transfer-course-select'), courseSelect);
  assert.equal(findByAttribute(app.root, 'id', 'json-import-merge-checkbox'), mergeCheckbox);
  assert.equal(findByAttribute(app.root, 'id', 'json-import-file'), jsonInput);
  assert.equal(findByAttribute(app.root, 'id', 'csv-import-file'), csvInput);
  assert.equal(courseSelect.value, archivedCourse.id);
  assert.equal(mergeCheckbox.checked, true);
  assert.deepEqual({ saveCalls, readerCalls, downloadCalls }, { saveCalls: 0, readerCalls: 0, downloadCalls: 0 });
});

test('sichtbare Beschriftungen und Hinweise erklären Export, Ersetzen, Merge und CSV-Grenzen', async () => {
  const { app } = await transferFixture();
  const exportPanel = transferPanel(app.root, 'export');
  const backupPanel = transferPanel(app.root, 'backup');
  const csvPanel = transferPanel(app.root, 'csv');
  const pageText = app.root.textContent;

  assert.equal(findLabel(exportPanel, 'Kurs / Klasse für Export').getAttribute('for'), 'transfer-course-select');
  assert.equal(findLabel(backupPanel, 'Backup-Datei auswählen').getAttribute('for'), 'json-import-file');
  assert.equal(findLabel(csvPanel, 'CSV-Datei auswählen').getAttribute('for'), 'csv-import-file');
  assert.match(exportPanel.textContent, /CSV.*Kurs- und Schülerzuordnungen/);
  assert.match(exportPanel.textContent, /Excel.*lesbare Notenübersicht/);
  assert.match(exportPanel.textContent, /kein vollständiges verschlüsseltes Backup/);
  assert.match(backupPanel.textContent, /Standardmäßig.*ersetzt/i);
  assert.match(backupPanel.textContent, /Merge-Modus/);
  assert.match(backupPanel.textContent, /gesamten Datenbestand/i);
  assert.match(csvPanel.textContent, /Pflichtspalten:/);
  assert.doesNotMatch(csvPanel.textContent, /Excel-Datei importieren/i);
  assert.match(pageText, /„Backup“.*Kopfleiste/);
  assert.doesNotMatch(pageText, /💾 Backup speichern/);
});

test('ohne Kurse bleibt Export verständlich und ein erneuter Aufruf startet wieder bei Export', async () => {
  const { app } = await transferFixture({ withCourses: false });
  const exportPanel = transferPanel(app.root, 'export');
  const select = findByAttribute(exportPanel, 'id', 'transfer-course-select');
  assert.equal(select.value, '__all__');
  assert.deepEqual(select.options.map(option => option.value), ['__all__', 'transfer-only-archive']);
  assert.match(exportPanel.textContent, /keine aktiven Kurse/i);

  await transferTab(app.root, 'csv').dispatch('click');
  await findByText(nav(app.root), 'Übersicht').dispatch('click');
  await openTransfer(app);
  assert.equal(transferTab(app.root, 'export').getAttribute('aria-selected'), 'true');
  assert.equal(transferPanel(app.root, 'export').hidden, false);
  assert.equal(transferPanel(app.root, 'csv').hidden, true);
});

test('die vorhandene CSV-Vorlage behält Bytefolge, Typ und Dateinamen', async () => {
  const { app } = await transferFixture();
  let blob = null;
  let anchor = null;
  vm.runInContext(`
    globalThis.__templateDownload = {};
    globalThis.Blob = class BlobDouble {
      constructor(parts, options) {
        globalThis.__templateDownload.blob = this;
        globalThis.__templateDownload.text = parts.join('');
        globalThis.__templateDownload.type = options.type;
      }
    };
    globalThis.URL = {
      createObjectURL(value) {
        globalThis.__templateDownload.createdFromBlob = value === globalThis.__templateDownload.blob;
        return 'blob:csv-template';
      },
      revokeObjectURL(value) { globalThis.__templateDownload.revoked = value; }
    };
    window.alert = message => { globalThis.__templateDownload.alert = String(message); };
    console.error = (...args) => {
      globalThis.__templateDownload.error = args.map(value => value && value.message ? value.message : String(value)).join(' | ');
    };
  `, app.sandbox);
  const createElement = app.document.createElement;
  app.document.createElement = function (tagName) {
    const element = createElement.call(this, tagName);
    if (String(tagName).toLowerCase() === 'a') {
      element.click = function () { anchor = element; };
    }
    return element;
  };

  const templateButton = findButtonByText(transferPanel(app.root, 'csv'), 'CSV-Vorlage herunterladen');
  await templateButton.dispatch('click');

  blob = app.sandbox.__templateDownload;
  assert.equal(blob.type, 'text/csv;charset=utf-8', blob.error || blob.alert);
  assert.equal(blob.createdFromBlob, true);
  const text = blob.text;
  const lines = text.split('\n');
  assert.equal(lines.length, 21);
  assert.equal(lines[0], '\ufeffKursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz');
  assert.ok(lines.slice(1).every(line => line === ';;;;;;;;;;;;;nv1:0'));
  assert.match(anchor.download, /^notenverwaltung_csv_vorlage_\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(anchor.href, 'blob:csv-template');
  assert.equal(blob.revoked, 'blob:csv-template');
});
