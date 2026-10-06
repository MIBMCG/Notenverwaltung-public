'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadModules } = require('./harness/load.js');
const { readSourceLines, extractFunction } = require('./harness/extract.js');

function createExamDocumentStub() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.listeners = new Map();
      this.attributes = new Map();
      this.clickCount = 0;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    get firstChild() {
      return this.children[0] || null;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
      if (name === 'id') this.id = String(value);
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    async dispatch(type) {
      for (const listener of this.listeners.get(type) || []) {
        await listener.call(this, { target: this });
      }
    }

    click() {
      this.clickCount += 1;
      return this.dispatch('click');
    }
  }

  const createdElements = [];
  return {
    createdElements,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      createdElements.push(element);
      return element;
    },
    body: new FakeElement('body')
  };
}

function collectElements(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) collectElements(child, predicate, found);
  return found;
}

function findElement(root, predicate) {
  return collectElements(root, predicate)[0] || null;
}

function loadExamCalculator() {
  const modules = loadModules();
  const document = createExamDocumentStub();
  const alerts = [];
  const blobs = [];
  class CapturedBlob extends Blob {
    constructor(parts, options) {
      super(parts, options);
      this.sourceParts = [...parts];
      blobs.push(this);
    }
  }
  Object.assign(modules.sandbox, {
    document,
    window: { alert(message) { alerts.push(message); } },
    Blob: CapturedBlob,
    URL: {
      createObjectURL() { return 'blob:exam-export'; },
      revokeObjectURL() {}
    }
  });
  const source = `${extractFunction(readSourceLines(), 'renderExamSection')}\n` +
    'globalThis.__renderExamSection = renderExamSection;';
  vm.runInContext(source, modules.sandbox, { filename: 'renderExamSection.js' });
  const container = document.createElement('main');
  modules.sandbox.__renderExamSection(container);
  return { alerts, blobs, container, document };
}

function examConfigBox(container, sectionTitle) {
  const title = findElement(container, element =>
    (element.tagName === 'H3' || element.tagName === 'STRONG') && element.textContent === sectionTitle
  );
  assert.ok(title, `${sectionTitle}: Konfigurationsbereich fehlt`);
  return title.parentNode;
}

function downloadedAnchors(document) {
  return document.createdElements.filter(element =>
    element.tagName === 'A' && element.clickCount > 0
  );
}

function setThreshold(configBox, label, threshold) {
  const row = findElement(configBox, element =>
    element.tagName === 'TR' && element.children[0] && element.children[0].textContent === label
  );
  const input = row && findElement(row, element => element.tagName === 'INPUT');
  assert.ok(input, `Grenze fuer ${label} fehlt`);
  input.value = String(threshold);
}

function configureAndCalculate(container, sectionTitle, thresholds, maxPoints = 100) {
  const configBox = examConfigBox(container, sectionTitle);
  const maxPointsInput = findElement(configBox, element => element.tagName === 'INPUT');
  assert.ok(maxPointsInput, `${sectionTitle}: Maximalpunkteingabe fehlt`);
  maxPointsInput.value = String(maxPoints);

  for (const [label, threshold] of Object.entries(thresholds)) {
    setThreshold(configBox, label, threshold);
  }

  const calculate = findElement(configBox, element =>
    element.tagName === 'BUTTON' && /^Tabelle berechnen/.test(element.textContent)
  );
  assert.ok(calculate, `${sectionTitle}: Berechnungsschaltflaeche fehlt`);
  return calculate.dispatch('click');
}

test('Low exam export: Sek I blocks a stale table after the maximum points change', async () => {
  const sectionTitle = 'Sek I – schulinterne Beispielprofile';
  const { alerts, container, document } = loadExamCalculator();
  await configureAndCalculate(container, sectionTitle, {}, 100);

  const configBox = examConfigBox(container, sectionTitle);
  const maxPointsInput = findElement(configBox, element => element.tagName === 'INPUT');
  maxPointsInput.value = '120';
  const exportButton = findElement(configBox, element =>
    element.tagName === 'BUTTON' && element.textContent === 'Als CSV herunterladen (Sek I)'
  );
  await exportButton.dispatch('click');

  assert.equal(
    downloadedAnchors(document).length,
    0,
    'eine mit anderen Maximalpunkten berechnete Tabelle darf nicht heruntergeladen werden'
  );
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /neu berechnen/i);
});

test('Low exam export: Sek II blocks a stale table after the maximum points change', async () => {
  const sectionTitle = 'Sek II – 0–15 Punkte';
  const { alerts, container, document } = loadExamCalculator();
  await configureAndCalculate(container, sectionTitle, {}, 100);

  const configBox = examConfigBox(container, sectionTitle);
  const maxPointsInput = findElement(configBox, element => element.tagName === 'INPUT');
  maxPointsInput.value = '120';
  const exportButton = findElement(configBox, element =>
    element.tagName === 'BUTTON' && element.textContent === 'Als CSV herunterladen (Sek II)'
  );
  await exportButton.dispatch('click');

  assert.equal(
    downloadedAnchors(document).length,
    0,
    'eine mit anderen Maximalpunkten berechnete Tabelle darf nicht heruntergeladen werden'
  );
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /neu berechnen/i);
});

for (const staleThresholdCase of [
  {
    sectionTitle: 'Sek I – schulinterne Beispielprofile',
    buttonText: 'Als CSV herunterladen (Sek I)',
    initialThresholds: { '3-': 58, '4+': 57 },
    changedLabel: '4+',
    changedThreshold: 57.1
  },
  {
    sectionTitle: 'Sek II – 0–15 Punkte',
    buttonText: 'Als CSV herunterladen (Sek II)',
    initialThresholds: { '8': 58, '7': 57 },
    changedLabel: '7',
    changedThreshold: 57.1
  }
]) {
  test(`Low exam export: ${staleThresholdCase.sectionTitle} blocks changed thresholds`, async () => {
    const { alerts, container, document } = loadExamCalculator();
    await configureAndCalculate(container, staleThresholdCase.sectionTitle, staleThresholdCase.initialThresholds, 100);

    const configBox = examConfigBox(container, staleThresholdCase.sectionTitle);
    setThreshold(configBox, staleThresholdCase.changedLabel, staleThresholdCase.changedThreshold);
    const exportButton = findElement(configBox, element =>
      element.tagName === 'BUTTON' && element.textContent === staleThresholdCase.buttonText
    );
    await exportButton.dispatch('click');

    assert.equal(downloadedAnchors(document).length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /neu berechnen/i);
  });
}

for (const exportCase of [
  {
    sectionTitle: 'Sek I – schulinterne Beispielprofile',
    buttonText: 'Als CSV herunterladen (Sek I)',
    filenamePattern: /^klausurtabelle_sek1_100pkt_\d{4}-\d{2}-\d{2}\.csv$/,
    expectedHeader: '\ufeffPunkte;Prozent;Note',
    expectedFirstRow: '100;100,0;1+'
  },
  {
    sectionTitle: 'Sek II – 0–15 Punkte',
    buttonText: 'Als CSV herunterladen (Sek II)',
    filenamePattern: /^klausurtabelle_sek2_100pkt_\d{4}-\d{2}-\d{2}\.csv$/,
    expectedHeader: '\ufeffPunkte_Klausur;Prozent;Oberstufenpunkte',
    expectedFirstRow: '100;100,0;15'
  }
]) {
  test(`Low exam export: ${exportCase.sectionTitle} still exports an unchanged table`, async () => {
    const { alerts, blobs, container, document } = loadExamCalculator();
    await configureAndCalculate(container, exportCase.sectionTitle, {}, 100);

    assert.equal(gradeAt(container, 100, '100.0 %'), exportCase.sectionTitle.startsWith('Sek I –') ? '1+' : '15');

    const configBox = examConfigBox(container, exportCase.sectionTitle);
    const exportButton = findElement(configBox, element =>
      element.tagName === 'BUTTON' && element.textContent === exportCase.buttonText
    );
    await exportButton.dispatch('click');

    assert.deepEqual(alerts, []);
    const downloads = downloadedAnchors(document);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].download, exportCase.filenamePattern);
    assert.equal(blobs.length, 1);
    assert.equal(blobs[0].type, 'text/csv;charset=utf-8');
    const [header, firstRow] = blobs[0].sourceParts.join('').split('\n');
    assert.equal(header, exportCase.expectedHeader);
    assert.equal(firstRow, exportCase.expectedFirstRow);
  });
}

function gradeAt(container, points, expectedPercent) {
  const row = findElement(container, element =>
    element.tagName === 'TR' &&
    element.children.length === 3 &&
    element.children[0].textContent === String(points) &&
    element.children[1].textContent === expectedPercent
  );
  assert.ok(row, `Ergebniszeile fuer ${points} Punkte fehlt`);
  return row.children[2].textContent;
}

test('H12: Sek I keeps exact 57/100 and 58/100 on their configured boundaries', async () => {
  const { container } = loadExamCalculator();
  await configureAndCalculate(container, 'Sek I – schulinterne Beispielprofile', {
    '3-': 58,
    '4+': 57
  });

  assert.deepEqual({
    below57: gradeAt(container, 56, '56.0 %'),
    exact57: gradeAt(container, 57, '57.0 %'),
    exact58: gradeAt(container, 58, '58.0 %'),
    above58: gradeAt(container, 59, '59.0 %')
  }, {
    below57: '4',
    exact57: '4+',
    exact58: '3-',
    above58: '3-'
  });

  await configureAndCalculate(container, 'Sek I – schulinterne Beispielprofile', {
    '3-': 58,
    '4+': 57.04
  }, 10000);
  assert.equal(
    gradeAt(container, 5705, '57.0 %'),
    '4+',
    'die auf eine Nachkommastelle gerundete Anzeige darf die Grenzentscheidung nicht steuern'
  );
});

test('H12: Sek II keeps exact 57/100 and 58/100 on their configured boundaries', async () => {
  const { container } = loadExamCalculator();
  await configureAndCalculate(container, 'Sek II – 0–15 Punkte', {
    '8': 58,
    '7': 57
  });

  assert.deepEqual({
    below57: gradeAt(container, 56, '56.0 %'),
    exact57: gradeAt(container, 57, '57.0 %'),
    exact58: gradeAt(container, 58, '58.0 %'),
    above58: gradeAt(container, 59, '59.0 %')
  }, {
    below57: '6',
    exact57: '7',
    exact58: '8',
    above58: '8'
  });

  await configureAndCalculate(container, 'Sek II – 0–15 Punkte', {
    '8': 58,
    '7': 57.04
  }, 10000);
  assert.equal(
    gradeAt(container, 5705, '57.0 %'),
    '7',
    'die auf eine Nachkommastelle gerundete Anzeige darf die Grenzentscheidung nicht steuern'
  );
});

test('H12 review: Sek I treats 161/250 as exactly equal to a 64.4 percent boundary', async () => {
  const { container } = loadExamCalculator();
  await configureAndCalculate(container, 'Sek I – schulinterne Beispielprofile', {
    '3': 64.4
  }, 250);

  assert.deepEqual({
    below: gradeAt(container, 160, '64.0 %'),
    exact: gradeAt(container, 161, '64.4 %'),
    above: gradeAt(container, 162, '64.8 %')
  }, {
    below: '3-',
    exact: '3',
    above: '3'
  });
});

test('H12 review: Sek II treats 161/250 as exactly equal to a 64.4 percent boundary', async () => {
  const { container } = loadExamCalculator();
  await configureAndCalculate(container, 'Sek II – 0–15 Punkte', {
    '9': 64.4
  }, 250);

  assert.deepEqual({
    below: gradeAt(container, 160, '64.0 %'),
    exact: gradeAt(container, 161, '64.4 %'),
    above: gradeAt(container, 162, '64.8 %')
  }, {
    below: '8',
    exact: '9',
    above: '9'
  });
});
