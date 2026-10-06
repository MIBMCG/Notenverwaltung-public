'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadModules } = require('./harness/load.js');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');
const { bundleEsmGraph } = require('./harness/load-esm-graph.js');
const { readXlsxWorkbook } = require('./harness/read-xlsx.js');

let excelExportBundle;

function buildInactiveCategoryCase() {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  const written = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Aktive schriftliche Leistung'
  });
  const other = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.other,
    title: 'Deaktivierte sonstige Leistung'
  });
  setScore(modules, written, ctx.students[0].id, '1');
  setScore(modules, other, ctx.students[0].id, '6');
  ctx.state.settings.categories.find(category => category.id === ctx.categoryIds.other).active = false;
  ctx.course.weightTemplateId = ctx.state.settings.weightTemplates[0].id;
  return { modules, ctx, assessments: [written, other] };
}

function loadWeightedOverallCellRenderer(modules) {
  const source = `${extractFunction(readSourceLines(), 'renderWeightedOverallCell')}\n` +
    'globalThis.__renderWeightedOverallCell = renderWeightedOverallCell;';
  vm.runInContext(source, modules.sandbox, { filename: 'renderWeightedOverallCell.js' });
  return modules.sandbox.__renderWeightedOverallCell;
}

function loadUiShellHelper(modules, name) {
  const source = `${extractFunction(readSourceLines(), name)}\n` +
    `globalThis.__uiShellHelper = ${name};`;
  vm.runInContext(source, modules.sandbox, { filename: `${name}.js` });
  return modules.sandbox.__uiShellHelper;
}

function loadUpperSecContextPresentation(modules) {
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'resolveAssessmentTermFromDateValue')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    'globalThis.__buildUpperSecContextPresentation = buildUpperSecContextPresentation;';
  vm.runInContext(source, modules.sandbox, { filename: 'buildUpperSecContextPresentation.js' });
  return modules.sandbox.__buildUpperSecContextPresentation;
}

function loadExcelExporter(modules, state, onDownload, { createWorkbookBlob } = {}) {
  const lines = readSourceLines();
  if (!excelExportBundle) {
    excelExportBundle = bundleEsmGraph('src/transfer/excel-export.js', {
      globalName: '__excel_export_exports'
    });
  }
  Object.assign(modules.sandbox, {
    state,
    Blob,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    downloadTextFile: onDownload,
    downloadBlobFile: onDownload
  });
  vm.runInContext(excelExportBundle, modules.sandbox, { filename: 'src/transfer/excel-export.js.bundle.js' });
  Object.assign(modules.sandbox, modules.sandbox.__excel_export_exports);
  modules.sandbox.window.alert = message => { throw new Error(message); };
  if (createWorkbookBlob) modules.sandbox.createExcelWorkbookBlob = createWorkbookBlob;
  const source = `${extractFunction(lines, 'resolveAssessmentTermFromDateValue')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    `${extractFunction(lines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(lines, 'buildTransferRows')}\n` +
    `${extractFunction(lines, 'exportTransferExcel')}\n` +
    'globalThis.__exportTransferExcel = exportTransferExcel;';
  vm.runInContext(source, modules.sandbox, { filename: 'exportTransferExcel.js' });
  return modules.sandbox.__exportTransferExcel;
}

function workbookText(sheet) {
  return sheet.rows.flatMap(row => row || []).filter(value => value !== undefined).join('\n');
}

function findWorkbookRow(sheet, firstCell) {
  const rowIndex = sheet.rows.findIndex(row => row && row[0] === firstCell);
  assert.ok(rowIndex >= 0, `die Excel-Tabelle muss eine Zeile für ${firstCell} enthalten`);
  return { rowIndex, values: sheet.rows[rowIndex], cells: sheet.cellRows[rowIndex] };
}

function loadExcelExportButtonHandler(modules, { exportExcel, selectedCourses, alerts }) {
  const lines = readSourceLines();
  Object.assign(modules.sandbox, {
    exportTransferExcel: exportExcel,
    getSelectedTransferCourses: () => selectedCourses
  });
  modules.sandbox.window.alert = message => alerts.push(message);
  const source = `${extractFunction(lines, 'handleTransferExcelExport')}\n` +
    'globalThis.__handleTransferExcelExport = handleTransferExcelExport;';
  vm.runInContext(source, modules.sandbox, { filename: 'handleTransferExcelExport.js' });
  return modules.sandbox.__handleTransferExcelExport;
}

test('report term labels retain German display ordering across courses', () => {
  const modules = loadModules();
  const courses = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const labels = new Map([
    ['a', 'Zora'], ['b', 'Ordnung'], ['c', 'Änne'], ['d', 'Ökologie']
  ]);
  const original = modules.GradingLogic.formatCourseTermLabel;
  modules.GradingLogic.formatCourseTermLabel = (_term, course) => labels.get(course && course.id) || '';
  try {
    const format = loadUiShellHelper(modules, 'formatTermLabelForCourses');
    assert.equal(format('2025-H1', courses, {}), 'Änne / Ökologie / Ordnung / Zora');
  } finally {
    modules.GradingLogic.formatCourseTermLabel = original;
  }
});

test('Wave 2: Excel export keeps its German timestamp and UTC date filename', { concurrency: false }, async () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    class FixedDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : ['2026-08-30T14:15:16.000Z']));
      }
      static now() { return new Date('2026-08-30T14:15:16.000Z').getTime(); }
    }

    const modules = loadModules({ dateImpl: FixedDate });
    const ctx = buildCourseState(modules, { studentCount: 1 });
    let download = null;
    const exportExcel = loadExcelExporter(modules, ctx.state, (content, mimeType, filename) => {
      download = { content, mimeType, filename };
    });

    await exportExcel([ctx.course]);

    assert.ok(download, 'Excel-Download fehlt');
    const workbook = await readXlsxWorkbook(download.content);
    assert.match(workbookText(workbook.sheets[0]), /Erstellt am 30\.8\.2026, 16:15:16/);
    assert.equal(download.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(download.filename, 'notenverwaltung_kurs_export_Synthetischer_Kurs_2026-08-30.xlsx');
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

function readExcelAverageRow(sheet, studentName) {
  const headers = sheet.rows.find(row => row && row.some(value =>
    value === 'Rechenwert gesamt' || value === 'Ø Gesamt'
  ));
  assert.ok(headers, 'der Excel-Export muss eine Kopfzeile mit Gesamtwert enthalten');
  const { values } = findWorkbookRow(sheet, studentName);
  return new Map(
    headers
      .map((header, index) => [header, values[index]])
      .filter(([header]) => header.startsWith('Ø ') || header === 'Rechenwert gesamt' || header === 'Ø Gesamt')
  );
}

test('Excel acceptance: exported cells distinguish zero, no entry, cleared, missing, excused and fixed zero', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec' });
  ctx.course.upperSecContext = { courseType: 'basic', qualificationYear: 'q3-q4' };
  const term = '2025-H2';
  const assessments = ['Nullpunkte', 'Nie eingetragen', 'Geleert', 'Fehlt', 'Entschuldigt']
    .map(title => addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title, term }));
  assessments.push(addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Nicht vorgesehen',
    term
  }));
  const student = ctx.students[0];
  setScore(modules, assessments[0], student.id, '0');
  setScore(modules, assessments[2], student.id, '');
  setScore(modules, assessments[3], student.id, '', modules.DomainModel.SCORE_STATUS.MISSING);
  setScore(modules, assessments[4], student.id, '', modules.DomainModel.SCORE_STATUS.EXCUSED);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, student.id, term, 0);
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  let download;
  const exportExcel = loadExcelExporter(modules, ctx.state, (content, mimeType, filename) => {
    download = { content, mimeType, filename };
  });
  await exportExcel([ctx.course]);
  assert.equal(download.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(download.filename, /\.xlsx$/);
  const workbook = await readXlsxWorkbook(download.content);
  const sheet = workbook.sheets[0];
  const headers = sheet.rows.find(row => row && row.includes('Rechenwert gesamt'));
  assert.ok(headers);
  const cellsFor = name => {
    const row = findWorkbookRow(sheet, name);
    return row;
  };
  const populated = cellsFor('Testperson1, Vorname1');
  for (const [title, expected] of [
    ['Nullpunkte', '0'], ['Nie eingetragen', ''], ['Geleert', '–'], ['Fehlt', 'fehlt'],
    ['Entschuldigt', 'entsch.'], ['Nicht vorgesehen', 'nicht vorgesehen']
  ]) {
    const index = headers.findIndex(header => String(header || '').startsWith(title + '\n'));
    assert.ok(index >= 0, `missing assessment ${title}`);
    assert.equal(String(populated.values[index] ?? ''), expected, title);
  }
  const column = (row, label) => {
    const index = headers.indexOf(label);
    assert.ok(index >= 0, `missing column ${label}`);
    return { value: row.values[index] ?? '', cell: row.cells[index] };
  };
  assert.equal(column(populated, 'Ø Mündlich').value, 0);
  assert.equal(column(populated, 'Ø Mündlich').cell.type, 'number');
  assert.equal(column(populated, 'Rechenwert gesamt').value, 0);
  assert.equal(column(populated, 'Rechenwert gesamt').cell.type, 'number');
  assert.equal(column(populated, 'Festgesetzte Punktzahl 25/26 Q4').value, 0);
  assert.equal(column(populated, 'Festgesetzte Punktzahl 25/26 Q4').cell.type, 'number');
  const zeroScoreIndex = headers.findIndex(header => String(header || '').startsWith('Nullpunkte\n'));
  assert.equal(populated.cells[zeroScoreIndex].type, 'number');
  const empty = cellsFor('Testperson2, Vorname2');
  for (const [title, expected] of [
    ['Nullpunkte', ''], ['Nie eingetragen', ''], ['Geleert', ''], ['Fehlt', ''],
    ['Entschuldigt', ''], ['Nicht vorgesehen', 'nicht vorgesehen']
  ]) {
    const index = headers.findIndex(header => String(header || '').startsWith(title + '\n'));
    assert.equal(empty.values[index] ?? '', expected, title);
  }
  assert.equal(column(empty, 'Ø Mündlich').value, '');
  assert.equal(column(empty, 'Rechenwert gesamt').value, '');
  assert.equal(column(empty, 'Festgesetzte Punktzahl 25/26 Q4').value, '');
});

test('Excel acceptance: user text stays literal and formula-safe in the complete workbook', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const text = '=Öko; "A&B" <img src=x onerror=alert(1)></script>\nZweite Zeile';
  ctx.course.name = text;
  ctx.course.subject = text;
  ctx.course.classLabel = text;
  ctx.students[0].lastName = text;
  ctx.students[0].firstName = 'Änne';
  ctx.state.settings.categories.find(item => item.id === ctx.categoryIds.oral).name = text;
  const assessment = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: text, term: '2025-H1' });
  const scoreText = '=1+1 </td><td>Fremdzelle</td>';
  setScore(modules, assessment, ctx.students[0].id, scoreText);
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });
  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);
  assert.equal(workbook.sheets.length, 1);
  const sheet = workbook.sheets[0];
  const values = sheet.rows.flatMap(row => row || []).filter(value => value !== undefined);
  assert.ok(values.includes(`${text} (${text})`));
  assert.ok(values.includes(`Fach: ${text}`));
  assert.ok(values.includes(`${text}, Änne`));
  assert.ok(values.includes(text));
  assert.ok(values.some(value => String(value).startsWith(`${text}\n`)));
  assert.ok(values.includes(scoreText));
  assert.ok([...sheet.cells.values()].every(cell => cell.type !== 'formula'));
  assert.match(workbook.files['xl/sharedStrings.xml'], /&lt;img src=x onerror=alert\(1\)&gt;&lt;\/script&gt;/);
  assert.doesNotMatch(workbook.files['xl/sharedStrings.xml'], /<img|<td>Fremdzelle/);
});

test('Excel acceptance: long explicit and wrapped header lines receive content-aware row heights', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const titleLine = 'Sehr langer vollständiger Kurstitel für eine schmale Tabellenansicht mit zusätzlichem Kontext';
  const secondTitleLine = 'Zweite ausdrücklich gesetzte Titelzeile mit weiteren wichtigen Angaben';
  const assessmentTitle = 'Fiktive Exportleistung 0 mit Umlaut Ä & Zeilenumbruch';
  const subcategoryName = 'zweite Zeile';
  ctx.course.name = `${titleLine}\n${secondTitleLine}`;
  ctx.course.classLabel = '';
  const oralCategory = ctx.state.settings.categories.find(category => category.id === ctx.categoryIds.oral);
  oralCategory.subcategories = [{ id: 'long-subcategory', name: subcategoryName }];
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral,
    subcategoryId: 'long-subcategory',
    title: assessmentTitle,
    date: '2026-01-15',
    term: '2025-H2'
  });
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });

  await exportExcel([ctx.course]);

  const sheet = (await readXlsxWorkbook(blob)).sheets[0];
  assert.equal(sheet.rows[0][0], `${titleLine}\n${secondTitleLine}`);
  assert.ok(sheet.rowHeights.get(1) > 28, 'explicit and wrapped title lines must not keep the old fixed 28 pt height');
  const headerRowIndex = sheet.rows.findIndex(row => row && row.some(value =>
    typeof value === 'string' && value.startsWith(assessmentTitle + '\n')
  ));
  assert.ok(headerRowIndex >= 0, 'assessment header row missing');
  const assessmentHeader = sheet.rows[headerRowIndex].find(value =>
    typeof value === 'string' && value.startsWith(assessmentTitle + '\n')
  );
  assert.ok(assessmentHeader.includes(`\n${subcategoryName}\n2026-01-15\n`));
  assert.ok(sheet.rowHeights.get(headerRowIndex + 1) >= 105,
    'the native-Excel stress header must receive at least its measured 105 pt AutoFit height');
});

test('Excel acceptance: selected courses become separate uniquely named sheets with full titles inside', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const title = 'Biologie [Q3]/Leistung: sehr langer vollständiger Kurstitel';
  const courses = [title, title, title.toLocaleLowerCase('de-DE')].map(name =>
    modules.DomainModel.createCourse({ name, subject: 'Biologie' })
  );
  courses.forEach(course => modules.DomainModel.addCourseToState(state, course));
  let blob;
  const exportExcel = loadExcelExporter(modules, state, content => { blob = content; });

  await exportExcel(courses);

  const workbook = await readXlsxWorkbook(blob);
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), [
    'Biologie _Q3__Leistung_ sehr la',
    'Biologie _Q3__Leistung_ seh (2)',
    'biologie _q3__leistung_ seh (3)'
  ]);
  assert.deepEqual(workbook.sheets.map(sheet => sheet.rows[0][0]), [title, title, title.toLocaleLowerCase('de-DE')]);
});

test('Excel acceptance: an empty selected course exports a readable sheet and an empty selection downloads nothing', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 0 });
  const downloads = [];
  const exportExcel = loadExcelExporter(modules, ctx.state, (...args) => downloads.push(args));

  assert.throws(() => exportExcel([]), /keine Kurse/i);
  assert.equal(downloads.length, 0);

  await exportExcel([ctx.course]);
  assert.equal(downloads.length, 1);
  const workbook = await readXlsxWorkbook(downloads[0][0]);
  assert.match(workbookText(workbook.sheets[0]), /Keine eingeschriebenen Schüler:innen\./);
});

test('Excel acceptance: a session clear during generation cancels the old download even if state later changes', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 0 });
  const downloads = [];
  let resolveWorkbook;
  const workbookPending = new Promise(resolve => { resolveWorkbook = resolve; });
  const exportExcel = loadExcelExporter(
    modules,
    ctx.state,
    (...args) => downloads.push(args),
    { createWorkbookBlob: () => workbookPending }
  );

  const pending = exportExcel([ctx.course]);
  modules.sandbox.window.dispatchEvent(new Event('sessionCleared'));
  resolveWorkbook(new Blob(['stale workbook']));

  assert.equal(await pending, false);
  assert.equal(downloads.length, 0);
});

test('Excel button blocks duplicate pending exports and leaves stale UI untouched after session clear', async () => {
  const modules = loadModules();
  const selectedCourses = [{ id: 'course-a' }];
  const alerts = [];
  let resolveExport;
  let calls = 0;
  const exportPending = new Promise(resolve => { resolveExport = resolve; });
  const handler = loadExcelExportButtonHandler(modules, {
    selectedCourses,
    alerts,
    exportExcel(courses) {
      calls += 1;
      assert.equal(courses, selectedCourses);
      return exportPending;
    }
  });
  const attributes = new Map();
  const button = {
    disabled: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); }
  };
  const select = { value: 'course-a' };

  const first = handler(button, select);
  const duplicate = handler(button, select);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(select.value, 'course-a');
  assert.equal(await duplicate, false);

  modules.sandbox.window.dispatchEvent(new Event('sessionCleared'));
  resolveExport(true);
  assert.equal(await first, false);
  assert.equal(button.disabled, true, 'detached controls must not be revived after a session clear');
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.deepEqual(alerts, []);
});

test('Excel button does not start a queued exporter after an immediate session clear', async () => {
  const modules = loadModules();
  const alerts = [];
  let calls = 0;
  const handler = loadExcelExportButtonHandler(modules, {
    selectedCourses: [{ id: 'course-a' }],
    alerts,
    exportExcel() {
      calls += 1;
      return Promise.resolve(true);
    }
  });
  const button = {
    disabled: false,
    setAttribute() {},
    removeAttribute() {}
  };

  const pending = handler(button, { value: 'course-a' });
  modules.sandbox.window.dispatchEvent(new Event('sessionCleared'));

  assert.equal(await pending, false);
  assert.equal(calls, 0);
  assert.equal(button.disabled, true);
  assert.deepEqual(alerts, []);
});

test('Excel button reports generation errors and becomes usable again in the active session', async () => {
  const modules = loadModules();
  const alerts = [];
  const handler = loadExcelExportButtonHandler(modules, {
    selectedCourses: [{ id: 'course-a' }],
    alerts,
    exportExcel: () => Promise.reject(new Error('synthetic failure'))
  });
  const attributes = new Map();
  const button = {
    disabled: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); }
  };

  assert.equal(await handler(button, { value: 'course-a' }), false);
  assert.equal(button.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
  assert.deepEqual(alerts, ['Excel-Export fehlgeschlagen. Details siehe Konsole.']);
  assert.ok(modules.logs.some(entry => entry.level === 'error' && /Excel-Export/.test(String(entry.args[0]))));
});

test('Excel acceptance: ordinary grades are numeric, Sek-I plus-minus grades stay text and averages round to two decimals', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const specs = [
    { title: 'Plusminus', categoryId: ctx.categoryIds.oral, value: '2+' },
    ...Array.from({ length: 40 }, (_, index) => ({
      title: `K${index + 1}`,
      categoryId: ctx.categoryIds.written,
      value: index < 27 ? '3' : '2'
    }))
  ];
  specs.forEach(spec => {
    const assessment = addAssessment(modules, ctx, {
      categoryId: spec.categoryId,
      title: spec.title
    });
    setScore(modules, assessment, ctx.students[0].id, spec.value);
  });
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });

  await exportExcel([ctx.course]);

  const workbook = await readXlsxWorkbook(blob);
  const sheet = workbook.sheets[0];
  const headers = sheet.rows.find(row => row && row.includes('Ø Gesamt'));
  const student = findWorkbookRow(sheet, 'Testperson1, Vorname1');
  const firstIndex = headers.findIndex(value => String(value || '').startsWith('Plusminus'));
  const secondIndex = headers.findIndex(value => String(value || '').startsWith('K1'));
  const averageIndex = headers.indexOf('Ø Schriftlich');
  assert.equal(student.values[firstIndex], '2+');
  assert.equal(student.cells[firstIndex].type, 'string');
  assert.equal(student.values[secondIndex], 3);
  assert.equal(student.cells[secondIndex].type, 'number');
  assert.equal(student.values[averageIndex], 2.68);
  assert.equal(student.cells[averageIndex].type, 'number');
});

function createDetailDocumentStub() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.className = '';
      this.value = '';
      this.textContent = '';
      this.classList = { contains() { return false; } };
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    }
    get firstChild() { return this.children[0] || null; }
    addEventListener(type, listener) {
      const current = this.listeners.get(type) || [];
      current.push(listener);
      this.listeners.set(type, current);
    }
  }
  const body = new Element('body');
  return { body, createElement: tagName => new Element(tagName) };
}

function collectRenderedText(element) {
  return [element.textContent || '', ...element.children.flatMap(child => collectRenderedText(child))]
    .filter(Boolean)
    .join('\n');
}

function loadStudentDetailsConsumer(modules, state, document, currentTerm = '2026-H1') {
  const lines = readSourceLines();
  Object.assign(modules.sandbox, {
    state,
    document,
    currentTermLocal: currentTerm,
    deriveTermFromDateValue: (date, course) => modules.GradingLogic.resolveAssessmentTermFromDateValue(
      date, course, modules.GradingLogic.getSettingsForCourse(course, state)
    ),
    formatTermLabel: term => term,
    escapeHtml: value => String(value == null ? '' : value),
    getEvaluationSettingsForCourse: course => modules.GradingLogic.getSettingsForCourse(course, state),
    isPoorValue: () => false,
    computeReportOverallForAssessments: (assessments, course, studentId, settings, term) =>
      modules.GradingLogic.computeWeightedOverallForAssessments(assessments, course, studentId, settings, term),
    getStudentDetailOverallLabel: (course, term) => modules.GradingLogic.isSchoolYearResultTerm(course, term)
      ? 'Jahresgesamtnote (H1 + H2)'
      : 'Halbjahresnote',
    generateStudentGradePDF: () => {}
  });
  const source = `${extractFunction(lines, 'resolveAssessmentTermFromDateValue')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    `${extractFunction(lines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(lines, 'formatTermLabelForCourses')}\n` +
    `${extractFunction(lines, 'selectedOptionText')}\n` +
    `${extractFunction(lines, 'showStudentDetailsModal')}\n` +
    'globalThis.__showStudentDetailsModal = showStudentDetailsModal;';
  vm.runInContext(source, modules.sandbox, { filename: 'showStudentDetailsModal.js' });
  return modules.sandbox.__showStudentDetailsModal;
}

function buildLkWarningConsumerCase(modules, writtenValues) {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const term = '2026-H1';
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: 'INTERNER GRUND DARF NICHT EXPORTIERT WERDEN'
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  writtenValues.forEach((value, index) => {
    const written = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written, title: `Klausur ${index + 1}`, term
    });
    if (value === 'missing') {
      written.scores[ctx.students[0].id] = modules.DomainModel.createScoreEntry({
        status: modules.DomainModel.SCORE_STATUS.MISSING
      });
    } else {
      setScore(modules, written, ctx.students[0].id, String(value));
      written.scores[ctx.students[0].id].valueNumeric = Number(value);
    }
  });
  const general = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term
  });
  setScore(modules, general, ctx.students[0].id, '10');
  return ctx;
}

function loadMassPrintDropdownUpdater(modules, {
  course,
  courses,
  state: suppliedState,
  student,
  assessments,
  selectedTerm,
  selectionIsExplicit = true,
  currentTerm = '2025-H2'
}) {
  const sourceLines = readSourceLines();
  const reportCourses = courses || [course];
  const state = suppliedState || modules.DomainModel.createEmptyState();
  state.students = [student];
  state.assessments = assessments;
  const usesInitialPreferenceSentinel = sourceLines.some(line => line.includes('let preferredTermValue = null;'));
  const termSelect = {
    value: selectedTerm,
    options: [{ value: '' }, { value: selectedTerm }],
    remove(index) { this.options.splice(index, 1); },
    appendChild(option) { this.options.push(option); }
  };
  const nameFilterInput = { value: '' };
  Object.assign(modules.sandbox, {
    state,
    nameFilterInput,
    classFilterSelect: { value: '' },
    courseFilterSelect: { value: '' },
    coursesByStudent: new Map([[student.id, reportCourses]]),
    getFilteredStudents: () => nameFilterInput.value ? [] : [student],
    getCoursesForMassPrint: () => reportCourses,
    termSelect,
    currentTermLocal: currentTerm,
    defaultTermValue: '',
    termSelectionTouched: selectedTerm === '',
    preferredTermValue: selectionIsExplicit
      ? selectedTerm
      : (usesInitialPreferenceSentinel ? null : (currentTerm || '')),
    document: { createElement: () => ({}) }
  });
  const source = `${extractFunction(sourceLines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(sourceLines, 'formatTermLabelForCourses')}\n` +
    `${extractFunction(sourceLines, 'updateTermsInDropdown')}\n` +
    'globalThis.__updateMassPrintTerms = updateTermsInDropdown;';
  vm.runInContext(source, modules.sandbox, { filename: 'updateTermsInDropdown.js' });
  return { update: modules.sandbox.__updateMassPrintTerms, termSelect, nameFilterInput };
}

function findElementsByTagName(element, tagName) {
  const matches = element.tagName === tagName ? [element] : [];
  return matches.concat(...element.children.flatMap(child => findElementsByTagName(child, tagName)));
}

test('M8: cross-course term labels are snapshot-aware and order-independent', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.settings.halfYearNames.seckI.h1 = 'Archiv-H1';
  const archived = modules.DomainModel.createCourse({ name: 'Archiv Sek I' });
  const upper = modules.DomainModel.createCourse({
    name: 'Aktiv Sek II',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
      weightingDeviationReason: null
    }
  });
  modules.DomainModel.addCourseToState(state, archived);
  modules.DomainModel.addCourseToState(state, upper);
  modules.DomainModel.archiveCourse(state, archived.id, 'manual', {});
  state.settings.halfYearNames.seckI.h1 = 'Neu-H1';
  const format = loadUiShellHelper(modules, 'formatTermLabelForCourses');

  const forward = format('2024-H1', [archived, upper], state);
  const reverse = format('2024-H1', [upper, archived], state);

  assert.equal(forward, '24/25 Archiv-H1 / 24/25 Q1');
  assert.equal(reverse, forward);
  assert.equal(format('2024-H1', [archived, archived], state), '24/25 Archiv-H1');
});

test('M8: mass-print and student-detail dropdowns combine their reported course contexts', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.settings.halfYearNames.seckI.h1 = 'Archiv-H1';
  const student = modules.DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ada' });
  const archived = modules.DomainModel.createCourse({ name: 'Archiv Sek I' });
  const upper = modules.DomainModel.createCourse({
    name: 'Aktiv Sek II',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
      weightingDeviationReason: null
    }
  });
  modules.DomainModel.addStudentToState(state, student);
  modules.DomainModel.addCourseToState(state, archived);
  modules.DomainModel.addCourseToState(state, upper);
  modules.DomainModel.enrollStudentInCourse(state, archived.id, student.id);
  modules.DomainModel.enrollStudentInCourse(state, upper.id, student.id);
  modules.DomainModel.archiveCourse(state, archived.id, 'manual', {});
  state.settings.halfYearNames.seckI.h1 = 'Neu-H1';
  const assessments = [
    { id: 'asm_archived', courseId: archived.id, term: '2024-H1', scores: { [student.id]: {} } },
    { id: 'asm_upper', courseId: upper.id, term: '2024-H1', scores: { [student.id]: {} } }
  ];

  const { update, termSelect } = loadMassPrintDropdownUpdater(modules, {
    courses: [upper, archived], state, student, assessments, selectedTerm: '2024-H1'
  });
  update();
  const massPrintOption = termSelect.options.find(option => option.value === '2024-H1');
  assert.equal(massPrintOption.textContent, '24/25 Archiv-H1 / 24/25 Q1');

  state.assessments = assessments;
  const document = createDetailDocumentStub();
  loadStudentDetailsConsumer(modules, state, document, '2024-H1')(student);
  const detailSelect = findElementsByTagName(document.body, 'select')[0];
  const detailOption = detailSelect.children.find(option => option.value === '2024-H1');
  assert.equal(detailOption.textContent, '24/25 Archiv-H1 / 24/25 Q1');
});

function loadPdfAssessmentFilter(modules) {
  let helperSource;
  try {
    helperSource = extractFunction(readSourceLines(), 'filterPdfAssessments');
  } catch (error) {
    return null;
  }
  const source = `${extractFunction(readSourceLines(), 'getAssessmentTerm')}\n${helperSource}\n` +
    'globalThis.__filterPdfAssessments = filterPdfAssessments;';
  vm.runInContext(source, modules.sandbox, { filename: 'filterPdfAssessments.js' });
  return modules.sandbox.__filterPdfAssessments;
}

function loadPdfOverallAssessmentFilter(modules) {
  let helperSource;
  try {
    helperSource = extractFunction(readSourceLines(), 'filterPdfOverallAssessments');
  } catch (error) {
    return null;
  }
  const source = `${extractFunction(readSourceLines(), 'getPreviousTerm')}\n` +
    `${extractFunction(readSourceLines(), 'getAssessmentTerm')}\n` +
    `${extractFunction(readSourceLines(), 'filterPdfAssessments')}\n${helperSource}\n` +
    'globalThis.__filterPdfOverallAssessments = filterPdfOverallAssessments;';
  vm.runInContext(source, modules.sandbox, { filename: 'filterPdfOverallAssessments.js' });
  return modules.sandbox.__filterPdfOverallAssessments;
}

function createPdfPrintWindow() {
  const capture = { html: '' };
  return {
    capture,
    window: {
      open() {
        return {
          document: {
            images: [],
            open() {},
            write(html) { capture.html = String(html); },
            close() {}
          },
          focus() {},
          print() {}
        };
      }
    }
  };
}

function loadIndividualAllTermsPdfConsumer(modules, state) {
  const lines = readSourceLines();
  const print = createPdfPrintWindow();
  Object.assign(modules.sandbox, {
    state,
    window: print.window,
    alert(message) { throw new Error(message); },
    deriveTermFromDateValue: () => '2025-H2',
    formatTermLabel: term => term,
    escapeHtml: value => String(value == null ? '' : value),
    getEvaluationSettingsForCourse: course => modules.GradingLogic.getSettingsForCourse(course, state),
    isPoorValue: () => false,
    computeReportOverallForAssessments: (assessments, course, studentId, settings, term) =>
      modules.GradingLogic.computeWeightedOverallForAssessments(assessments, course, studentId, settings, term),
    getStudentDetailOverallLabel: () => 'Gesamtnote/-punkte'
  });
  const start = lines.findIndex(line => /^\s*function generateStudentGradePDF\s*\(/.test(line));
  const end = lines.findIndex((line, index) => index > start && line.includes('// Überschrift und Einleitung'));
  assert.ok(start >= 0 && end > start, 'der vollständige individuelle PDF-Consumer wurde nicht gefunden');
  const source = `${extractFunction(lines, 'getPreviousTerm')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    `${extractFunction(lines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(lines, 'filterPdfAssessments')}\n` +
    `${extractFunction(lines, 'filterPdfOverallAssessments')}\n` +
    `${extractFunction(lines, 'getPdfOverallLabel')}\n` +
    `${extractFunction(lines, 'getSchoolProfile')}\n` +
    `${extractFunction(lines, 'getSchoolLogoSources')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderHtml')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderCss')}\n` +
    `${extractFunction(lines, 'printWhenAssetsReady')}\n` +
    `${lines.slice(start, end).join('\n')}\n` +
    'globalThis.__generateStudentGradePDF = generateStudentGradePDF;';
  vm.runInContext(source, modules.sandbox, { filename: 'generateStudentGradePDF.js' });
  return { generate: modules.sandbox.__generateStudentGradePDF, capture: print.capture };
}

function loadMassAllTermsPdfConsumer(modules, state, course, student, options = {}) {
  const lines = readSourceLines();
  const print = createPdfPrintWindow();
  const courses = options.courses || [course];
  const selectedTerm = options.selectedTerm || '';
  const start = lines.findIndex(line => line.includes("massPrintBtn.addEventListener('click', function () {"));
  const after = lines.findIndex((line, index) => index > start && line.includes('massPrintBox.appendChild(massPrintBtn);'));
  const end = after < 0 ? -1 : lines.slice(0, after).lastIndexOf('          });');
  assert.ok(start >= 0 && end > start, 'der vollständige Massendruck-Consumer wurde nicht gefunden');
  Object.assign(modules.sandbox, {
    state,
    window: print.window,
    alert(message) { throw new Error(message); },
    updateTermsInDropdown() {},
    termSelect: { value: selectedTerm },
    nameFilterInput: { value: '' },
    classFilterSelect: { value: '' },
    courseFilterSelect: { value: '' },
    coursesByStudent: new Map([[student.id, courses]]),
    getFilteredStudents: () => [student],
    getCoursesForMassPrint: () => courses,
    deriveTermFromDateValue: () => '2025-H2',
    formatTermLabel: term => term,
    escapeHtml: value => String(value == null ? '' : value),
    getEvaluationSettingsForCourse: courseItem => modules.GradingLogic.getSettingsForCourse(courseItem, state),
    isPoorValue: () => false,
    computeReportOverallForAssessments: (assessments, courseItem, studentId, settings, term) =>
      modules.GradingLogic.computeWeightedOverallForAssessments(assessments, courseItem, studentId, settings, term)
  });
  const source = `${extractFunction(lines, 'getPreviousTerm')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    `${extractFunction(lines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(lines, 'filterPdfAssessments')}\n` +
    `${extractFunction(lines, 'filterPdfOverallAssessments')}\n` +
    `${extractFunction(lines, 'getPdfOverallLabel')}\n` +
    `${extractFunction(lines, 'getSchoolProfile')}\n` +
    `${extractFunction(lines, 'getSchoolLogoSources')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderHtml')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderCss')}\n` +
    `${extractFunction(lines, 'printWhenAssetsReady')}\n` +
    `function runMassPrintConsumer() {\n${lines.slice(start + 1, end).join('\n')}\n}\n` +
    'globalThis.__runMassPrintConsumer = runMassPrintConsumer;';
  vm.runInContext(source, modules.sandbox, { filename: 'massPrintConsumer.js' });
  return { generate: modules.sandbox.__runMassPrintConsumer, capture: print.capture };
}

function buildSignaturePaginationFixture(modules) {
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  ctx.course.name = 'Aktiver Druckkurs';

  for (let index = 1; index <= 100; index++) {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `Aktiv H1 ${String(index).padStart(3, '0')}`,
      term: '2025-H1'
    });
    setScore(modules, assessment, student.id, String((index % 6) + 1));
  }

  const activeH2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Aktiv H2 Gegenprobe',
    term: '2025-H2'
  });
  setScore(modules, activeH2, student.id, '2');

  const archivedCourse = modules.DomainModel.createCourse({
    name: 'Archivkurs ohne H1-Zeilen',
    subject: 'Archivfach',
    classLabel: 'AT1'
  });
  modules.DomainModel.addCourseToState(ctx.state, archivedCourse);
  modules.DomainModel.enrollStudentInCourse(ctx.state, archivedCourse.id, student.id);
  const archivedH2 = modules.DomainModel.createAssessment({
    courseId: archivedCourse.id,
    categoryId: ctx.categoryIds.written,
    title: 'Archiv H2 Gegenprobe',
    term: '2025-H2',
    maxPoints: null,
    weight: 1,
    visible: true
  });
  modules.DomainModel.addAssessmentToState(ctx.state, archivedH2);
  setScore(modules, archivedH2, student.id, '3');
  modules.DomainModel.archiveCourse(ctx.state, archivedCourse.id, 'manual', {});

  return { ...ctx, student, archivedCourse };
}

function assertSelectedAndAllTermsFixture(selectedHtml, allTermsHtml, archivedCourseHeading, emptyArchiveMessage) {
  assert.equal(
    (selectedHtml.match(/Aktiv H1 \d{3}/g) || []).length,
    100,
    'der ausgewählte Zeitraum muss alle 100 aktiven Zeilen behalten'
  );
  assert.match(selectedHtml, archivedCourseHeading);
  assert.match(selectedHtml, emptyArchiveMessage);
  assert.doesNotMatch(selectedHtml, /Aktiv H2 Gegenprobe|Archiv H2 Gegenprobe/);

  assert.equal(
    (allTermsHtml.match(/Aktiv H1 \d{3}/g) || []).length,
    100,
    'die Alle-Halbjahre-Gegenprobe muss alle 100 aktiven H1-Zeilen behalten'
  );
  assert.match(allTermsHtml, /Aktiv H2 Gegenprobe/);
  assert.match(allTermsHtml, /Archiv H2 Gegenprobe/);
  assert.match(allTermsHtml, archivedCourseHeading);
}

function assertCompactUnfragmentedSignatureArea(html) {
  const signatureRule = html.match(/\.signature-area\s*\{([^}]*)\}/);
  assert.ok(signatureRule, 'die erzeugte Druckansicht muss einen Signaturbereich gestalten');
  assert.match(signatureRule[1], /break-inside\s*:\s*avoid-page\s*;/);
  assert.match(signatureRule[1], /page-break-inside\s*:\s*avoid\s*;/);
  assert.match(signatureRule[1], /break-before\s*:\s*avoid-page\s*;/);
  assert.match(signatureRule[1], /page-break-before\s*:\s*avoid\s*;/);
  assert.match(signatureRule[1], /margin-top\s*:\s*0\.75em\s*;/);
  assert.match(signatureRule[1], /padding-top\s*:\s*0\.4em\s*;/);

  const signatureLineRule = html.match(/\.signature-line\s*\{([^}]*)\}/);
  assert.ok(signatureLineRule, 'die Schreiblinie des Signaturbereichs fehlt');
  assert.match(signatureLineRule[1], /height\s*:\s*2\.5em\s*;/);
}

function loadPrintWhenAssetsReady(modules) {
  const scheduled = [];
  let currentTime = 0;
  modules.sandbox.setTimeout = (callback, delay) => {
    const timer = { callback, delay, dueAt: currentTime + delay, cancelled: false, ran: false };
    scheduled.push(timer);
    return timer;
  };
  modules.sandbox.clearTimeout = timer => { timer.cancelled = true; };
  const lines = readSourceLines();
  vm.runInContext(
    `${extractFunction(lines, 'printWhenAssetsReady')}\nglobalThis.__printWhenAssetsReady = printWhenAssetsReady;`,
    modules.sandbox,
    { filename: 'printWhenAssetsReady.js' }
  );
  const advanceTo = targetTime => {
    while (true) {
      const nextTimer = scheduled
        .filter(timer => !timer.cancelled && !timer.ran && timer.dueAt <= targetTime)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!nextTimer) break;
      nextTimer.ran = true;
      currentTime = nextTimer.dueAt;
      nextTimer.callback();
    }
    currentTime = targetTime;
  };
  return { printWhenAssetsReady: modules.sandbox.__printWhenAssetsReady, scheduled, advanceTo };
}

function loadPrintPresentationHelpers(modules) {
  modules.sandbox.state = modules.DomainModel.createEmptyState();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'escapeHtml')}\n` +
    `${extractFunction(lines, 'getSchoolProfile')}\n` +
    `${extractFunction(lines, 'getSchoolLogoSources')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderHtml')}\n` +
    `${extractFunction(lines, 'buildPrintHeaderCss')}\n` +
    'globalThis.__printPresentationHelpers = { getSchoolLogoSources, buildPrintHeaderHtml, buildPrintHeaderCss };';
  vm.runInContext(source, modules.sandbox, { filename: 'printPresentationHelpers.js' });
  return modules.sandbox.__printPresentationHelpers;
}

function findPrintTimer(scheduled, delay) {
  const timer = scheduled.find(entry => entry.delay === delay);
  assert.ok(timer, `expected a ${delay}ms print timer`);
  return timer;
}

function runPrintTimer(timer) {
  assert.equal(timer.cancelled, false, 'the selected print timer must not be cancelled');
  timer.ran = true;
  timer.callback();
}

function loadReportScorePresentation(modules) {
  try {
    const lines = readSourceLines();
    const source = `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
      `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
      'globalThis.__formatReportScorePresentation = formatReportScorePresentation;';
    vm.runInContext(source, modules.sandbox, { filename: 'formatReportScorePresentation.js' });
    return modules.sandbox.__formatReportScorePresentation;
  } catch (error) {
    return null;
  }
}

function createFakeCell(classNames) {
  const classes = new Set(String(classNames || '').split(/\s+/).filter(Boolean));
  return {
    textContent: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

function createArchiveDocumentStub() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.textContent = '';
      this.listeners = new Map();
      const classNames = new Set();
      this.classList = {
        add: name => classNames.add(name),
        remove: name => classNames.delete(name),
        contains: name => classNames.has(name)
      };
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    setAttribute(name, value) { this[name] = String(value); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    focus() {}
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
    }
  }

  const body = new FakeElement('body');
  return {
    body,
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(text) {
      const node = new FakeElement('#text');
      node.textContent = String(text);
      return node;
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function collectArchiveElements(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) collectArchiveElements(child, predicate, found);
  return found;
}

function collectArchiveText(root) {
  return collectArchiveElements(root, () => true)
    .map(element => element.textContent)
    .filter(Boolean)
    .join(' ');
}

function findArchivedAssessmentDetails(document, assessmentTitle) {
  const row = collectArchiveElements(document.body, element =>
    element.tagName === 'tr' &&
    (element.children || []).some(child => child.tagName === 'td' && child.textContent === assessmentTitle)
  )[0];
  assert.ok(row, `archive assessment row for ${assessmentTitle} is missing`);
  const details = collectArchiveElements(row, element => element.tagName === 'details');
  assert.equal(details.length, 1, `archive assessment ${assessmentTitle} must have one score disclosure`);
  return details[0];
}

function loadArchivedCourseDetailsRenderer(modules, state) {
  const document = createArchiveDocumentStub();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'resolveAssessmentTermFromDateValue')}\n` +
    `${extractFunction(lines, 'getAssessmentTerm')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'formatReportScorePresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecResultPresentation')}\n` +
    `${extractFunction(lines, 'buildUpperSecContextPresentation')}\n` +
    `${extractFunction(lines, 'listReportedTermsForStudent')}\n` +
    `${extractFunction(lines, 'showArchivedCourseDetails')}\n` +
    'globalThis.__showArchivedCourseDetails = showArchivedCourseDetails;';
  Object.assign(modules.sandbox, { document, state });
  vm.runInContext(source, modules.sandbox, { filename: 'showArchivedCourseDetails.js' });
  return { document, render: modules.sandbox.__showArchivedCourseDetails };
}

test('M33: shared assessment calculation excludes inactive template categories', () => {
  const { modules, ctx, assessments } = buildInactiveCategoryCase();
  assert.equal(
    typeof modules.GradingLogic.computeWeightedOverallForAssessments,
    'function',
    'the shared detail and print calculation is missing'
  );

  assert.equal(
    modules.GradingLogic.computeWeightedOverallForAssessments(
      assessments,
      ctx.course,
      ctx.students[0].id,
      ctx.state.settings
    ),
    1,
    'the inactive grade 6 must not change the active grade 1'
  );
});

test('M33: the real detail and print helper excludes inactive template categories', () => {
  const { modules, ctx, assessments } = buildInactiveCategoryCase();
  const source = `${extractFunction(readSourceLines(), 'computeReportOverallForAssessments')}\n` +
    'globalThis.__computeReportOverallForAssessments = computeReportOverallForAssessments;';
  vm.runInContext(source, modules.sandbox, { filename: 'computeReportOverallForAssessments.js' });

  assert.equal(
    modules.sandbox.__computeReportOverallForAssessments(
      assessments,
      ctx.course,
      ctx.students[0].id,
      ctx.state.settings
    ),
    1,
    'detail and print output must agree with the main overall calculation'
  );
});

test('M33: the split term table cell displays only active template categories', () => {
  const { modules, ctx, assessments } = buildInactiveCategoryCase();
  const renderWeightedOverallCell = loadWeightedOverallCellRenderer(modules);
  const cell = createFakeCell('gradesheet-avg term-current');

  assert.equal(
    renderWeightedOverallCell(cell, assessments, ctx.course, ctx.students[0].id, ctx.state.settings),
    1
  );
  assert.equal(cell.textContent, '1.00');
  assert.equal(cell.classList.contains('text-muted'), false);
});

test('M33: the combined gradesheet cell displays only active template categories', () => {
  const { modules, ctx, assessments } = buildInactiveCategoryCase();
  const renderWeightedOverallCell = loadWeightedOverallCellRenderer(modules);
  const cell = createFakeCell('gradesheet-avg');

  assert.equal(
    renderWeightedOverallCell(cell, assessments, ctx.course, ctx.students[0].id, ctx.state.settings),
    1
  );
  assert.equal(cell.textContent, '1.00');
  assert.equal(cell.classList.contains('text-muted'), false);
});

test('M33: an archived course keeps the inactive category state from its snapshot', () => {
  const { modules, ctx, assessments } = buildInactiveCategoryCase();
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.state.settings.categories.find(category => category.id === ctx.categoryIds.other).active = true;

  const archiveSettings = modules.GradingLogic.getSettingsForCourse(ctx.course, ctx.state);
  assert.equal(
    modules.GradingLogic.computeWeightedOverallForAssessments(
      assessments,
      ctx.course,
      ctx.students[0].id,
      archiveSettings
    ),
    1,
    'later global changes must not reactivate a category in an archived gradesheet'
  );
});

test('H11: PDF reports exclude hidden assessments and respect the selected term', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  const visible = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Sichtbar',
    term: '2025-H1',
    visible: true
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Nur intern',
    term: '2025-H1',
    visible: false
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Anderes Halbjahr',
    term: '2025-H2',
    visible: true
  });
  const filterPdfAssessments = loadPdfAssessmentFilter(modules);

  assert.equal(typeof filterPdfAssessments, 'function', 'the shared PDF visibility filter is missing');
  assert.deepEqual(
    Array.from(filterPdfAssessments(ctx.state.assessments, ctx.course, '2025-H1', '2025-H1'), assessment => assessment.id),
    [visible.id]
  );
});

test('H11: hidden assessments remain part of internal grade calculations', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  const visible = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Sichtbar',
    term: '2025-H1',
    visible: true
  });
  const hidden = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Nur intern',
    term: '2025-H1',
    visible: false
  });
  setScore(modules, visible, ctx.students[0].id, '1');
  setScore(modules, hidden, ctx.students[0].id, '5');
  const filterPdfAssessments = loadPdfAssessmentFilter(modules);

  assert.equal(typeof filterPdfAssessments, 'function', 'the shared PDF visibility filter is missing');
  assert.equal(
    modules.GradingLogic.computeWeightedOverallForAssessments(
      ctx.state.assessments,
      ctx.course,
      ctx.students[0].id,
      ctx.state.settings
    ),
    3,
    'visibility must not change the internal grade calculation'
  );
  assert.equal(
    modules.GradingLogic.computeWeightedOverallForAssessments(
      filterPdfAssessments(ctx.state.assessments, ctx.course, null, '2025-H1'),
      ctx.course,
      ctx.students[0].id,
      ctx.state.settings
    ),
    1,
    'the PDF result must use only assessments released for reports'
  );
});

test('H11: date-only assessments use the PDF path term resolver', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  const dateOnly = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Nur Datum',
    date: '2025-10-15',
    visible: true
  });
  delete dateOnly.term;
  const filterPdfAssessments = loadPdfAssessmentFilter(modules);
  const resolvedTerms = [];

  assert.deepEqual(
    Array.from(
      filterPdfAssessments(
        ctx.state.assessments,
        ctx.course,
        '2025-H1',
        '2025-H2',
        (date, course) => {
          resolvedTerms.push({ year: date.getFullYear(), courseId: course.id });
          return '2025-H1';
        }
      ),
      assessment => assessment.id
    ),
    [dateOnly.id]
  );
  assert.deepEqual(resolvedTerms, [{ year: 2025, courseId: ctx.course.id }]);
});

test('M31 task-7: Sek-I H2 PDF totals include H1 and H2 independently of the legacy flag', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules);
  ctx.course.includePrevTermGrades = false;
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Aktuell',
    term: '2025-H2',
    visible: true
  });
  const previous = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Vorhalbjahr',
    term: '2025-H1',
    visible: true
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Vorhalbjahr intern',
    term: '2025-H1',
    visible: false
  });
  const filterPdfOverallAssessments = loadPdfOverallAssessmentFilter(modules);

  assert.equal(typeof filterPdfOverallAssessments, 'function', 'the shared PDF overall filter is missing');
  assert.deepEqual(
    Array.from(
      filterPdfOverallAssessments(ctx.state.assessments, ctx.course, '2025-H2', '2025-H2'),
      assessment => assessment.id
    ),
    [current.id, previous.id]
  );

  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  assert.ok(ctx.course.archivedAt, 'the regression fixture must use the archived report path');
  assert.deepEqual(
    Array.from(
      filterPdfOverallAssessments(ctx.state.assessments, ctx.course, '2025-H2', '2025-H2'),
      assessment => assessment.id
    ),
    [current.id, previous.id],
    'an archive snapshot must keep the same PDF-only visibility semantics'
  );
});

test('M32: presentation separates calculated and finalized upper-sec values', () => {
  const modules = loadModules();
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [{ studentId: 'stu_1', term: '2025-H1', points: 12 }]
  });
  const build = loadUiShellHelper(modules, 'buildUpperSecResultPresentation');

  assert.deepEqual(JSON.parse(JSON.stringify(build(course, 'stu_1', '2025-H1', 11.5))), {
    calculatedLabel: 'Rechenwert', calculatedText: '11.50',
    finalizedLabel: 'Festgesetzte Punktzahl', finalizedPoints: 12
  });
  assert.equal(build(course, 'stu_1', '2025-H1', 9.25).finalizedPoints, 12,
    'a changed calculated value must not invalidate the conscious decision');
  assert.equal(build(course, 'stu_1', '2025-H2', 10).finalizedPoints, null);
});

test('M32: a finalized term remains reportable without an assessment row', () => {
  const modules = loadModules();
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [{ studentId: 'stu_1', term: '2025-H1', points: 12 }]
  });
  const listTerms = loadUiShellHelper(modules, 'listReportedTermsForStudent');

  assert.deepEqual(Array.from(listTerms(course, 'stu_1', ['2025-H2'])), ['2025-H1', '2025-H2']);
});

test('M32: detail and PDF consumers use the shared result presentation', () => {
  const lines = readSourceLines();
  const detail = extractFunction(lines, 'showStudentDetailsModal');
  const individual = extractFunction(lines, 'generateStudentGradePDF');
  const studentsSection = extractFunction(lines, 'renderStudentsSection');
  for (const source of [detail, individual, studentsSection]) {
    assert.match(source, /buildUpperSecContextPresentation/);
    assert.match(source, /Festgesetzte Punktzahl/);
  }
  assert.doesNotMatch(individual, /Festgesetzte Punktzahl inkl\. Vorhalbjahr/);
  assert.doesNotMatch(studentsSection, /Festgesetzte Punktzahl inkl\. Vorhalbjahr/);
});

test('print presentation helpers retain the replaceable logo header and print-header style contract', () => {
  const modules = loadModules();
  const helpers = loadPrintPresentationHelpers(modules);

  assert.equal(
    helpers.buildPrintHeaderHtml('Notenübersicht & <Test>'),
    '<div class="print-header"><img class="print-logo" src="Logo.png" data-logo-fallback="placeholder-logo.svg" alt=""><div><h1>Notenübersicht &amp; &lt;Test&gt;</h1></div></div>'
  );
  const dangerousHeader = helpers.buildPrintHeaderHtml('X </script><img src=x onerror="alert(1)">');
  assert.match(dangerousHeader, /&lt;\/script&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(dangerousHeader, /<\/script>|<img src=x/);
  const css = helpers.buildPrintHeaderCss();
  assert.match(
    css,
    /\.print-header\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*0\.8em;\s*margin-bottom:\s*0\.3em;\s*\}/
  );
  assert.match(css, /\.print-header h1\s*\{\s*margin:\s*0;\s*\}/);
  assert.match(css, /\.print-logo\s*\{\s*width:\s*auto;\s*height:\s*46px;\s*object-fit:\s*contain;\s*flex:\s*0 0 auto;\s*\}/);
});

test('individual and batch print reports retain the replaceable logo markup and print-header styles', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Leistung',
    term: '2025-H1'
  });
  setScore(modules, assessment, student.id, '2');

  const individual = loadIndividualAllTermsPdfConsumer(modules, ctx.state);
  individual.generate(student, '2025-H1');
  const batch = loadMassAllTermsPdfConsumer(modules, ctx.state, ctx.course, student);
  batch.generate();

  const expectedHeader = '<div class="print-header"><img class="print-logo" src="Logo.png" data-logo-fallback="placeholder-logo.svg" alt=""><div><h1>Notenübersicht: Testperson1, Vorname1</h1></div></div>';
  for (const html of [individual.capture.html, batch.capture.html]) {
    assert.ok(html.includes(expectedHeader), 'the rendered report must retain the replaceable logo header');
    assert.match(html, /\.print-header\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*0\.8em;\s*margin-bottom:\s*0\.3em;\s*\}/);
    assert.match(html, /\.print-logo\s*\{\s*width:\s*auto;\s*height:\s*46px;\s*object-fit:\s*contain;\s*flex:\s*0 0 auto;\s*\}/);
  }
});

test('custom school and logo reach individual and batch print reports; no-logo mode suppresses images', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const assessment = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'Leistung', term: '2025-H1' });
  setScore(modules, assessment, student.id, '2');
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  ctx.state.settings.schoolProfile = { name: 'Testschule', logoMode: 'custom', logoDataUrl: logo };
  const individual = loadIndividualAllTermsPdfConsumer(modules, ctx.state);
  individual.generate(student, '2025-H1');
  const batch = loadMassAllTermsPdfConsumer(modules, ctx.state, ctx.course, student);
  batch.generate();
  for (const html of [individual.capture.html, batch.capture.html]) {
    assert.ok(html.includes('<div class="print-school">Testschule</div>'));
    assert.ok(html.includes('src="' + logo + '"'));
    assert.doesNotMatch(html, /hwg-logo|Hildegard|Wegscheider/);
  }
  const helpers = loadPrintPresentationHelpers(modules);
  modules.sandbox.state.settings.schoolProfile = { name: 'A & <B>', logoMode: 'none', logoDataUrl: '' };
  const header = helpers.buildPrintHeaderHtml('Notenübersicht');
  assert.ok(header.includes('A &amp; &lt;B&gt;'));
  assert.doesNotMatch(header, /<img/);
});

test('print waits for legacy logo fallback before opening the print dialog', () => {
  const modules = loadModules();
  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  const listeners = {};
  const attrs = { src: 'Logo.png', 'data-logo-fallback': 'placeholder-logo.svg' };
  const image = {
    complete: false, naturalWidth: 0, style: {},
    getAttribute(name) { return attrs[name]; },
    removeAttribute(name) { delete attrs[name]; },
    setAttribute(name, value) { attrs[name] = value; },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  let printed = 0;
  printWhenAssetsReady({ document: { images: [image] }, focus() {}, print() { printed += 1; } });
  listeners.error();
  assert.equal(attrs.src, 'placeholder-logo.svg');
  assert.equal(printed, 0);
  assert.equal(scheduled.length, 1, 'do not print before fallback has loaded');
  listeners.load();
  findPrintTimer(scheduled, 50).callback();
  assert.equal(printed, 1);
});

test('printing uses the 50ms success path and cancels the 1500ms safety timeout', () => {
  const modules = loadModules();
  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  const listeners = {};
  const image = {
    complete: false,
    style: {},
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const calls = [];
  const printWin = {
    document: { images: [image] },
    focus() { calls.push('focus'); },
    print() { calls.push('print'); }
  };

  printWhenAssetsReady(printWin);
  assert.deepEqual(calls, []);
  listeners.load();
  assert.equal(scheduled.length, 2, 'load handling and safety timeout must both be scheduled');
  const safetyTimer = findPrintTimer(scheduled, 1500);
  assert.equal(safetyTimer.cancelled, true, 'the safety timeout must be cancelled after load');
  findPrintTimer(scheduled, 50).callback();
  assert.deepEqual(calls, ['focus', 'print']);
});

test('a second image event after successful load does not hide or re-plan printing', () => {
  const modules = loadModules();
  const listeners = {};
  const image = {
    complete: false,
    style: {},
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const calls = [];
  const printWin = {
    document: { images: [image] },
    focus() { calls.push('focus'); },
    print() { calls.push('print'); }
  };

  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  printWhenAssetsReady(printWin);
  listeners.load();
  listeners.error();
  assert.equal(image.style.display, '', 'a later error must not hide a successfully loaded logo');
  assert.equal(scheduled.filter(timer => timer.delay === 50).length, 1,
    'a second image event must not schedule another print');
  runPrintTimer(findPrintTimer(scheduled, 50));
  listeners.load();
  assert.deepEqual(calls, ['focus', 'print'], 'focus and print must each run exactly once');
  assert.equal(scheduled.filter(timer => timer.delay === 50).length, 1,
    'events after printing must not schedule another print');
});

test('a load just before the safety deadline remains the only print after 1500ms', () => {
  const modules = loadModules();
  const listeners = {};
  const image = {
    complete: false,
    style: {},
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const calls = [];
  const printWin = {
    document: { images: [image] },
    focus() { calls.push('focus'); },
    print() { calls.push('print'); }
  };

  const { printWhenAssetsReady, scheduled, advanceTo } = loadPrintWhenAssetsReady(modules);
  printWhenAssetsReady(printWin);
  advanceTo(1490);
  assert.deepEqual(calls, [], 'printing must still wait before the image settles');
  listeners.load();
  assert.equal(findPrintTimer(scheduled, 1500).cancelled, true);
  advanceTo(1600);
  assert.equal(image.style.display, '', 'the cancelled safety fallback must not hide the loaded logo');
  assert.deepEqual(calls, ['focus', 'print'], 'the 50ms layout delay must produce one print');
});

test('a missing companion logo is hidden and does not block printing', () => {
  const modules = loadModules();
  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  const listeners = {};
  const image = {
    complete: false,
    style: {},
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  let printCount = 0;
  const printWin = {
    document: { images: [image] },
    focus() {},
    print() { printCount += 1; }
  };

  printWhenAssetsReady(printWin);
  listeners.error();
  assert.equal(image.style.display, 'none');
  findPrintTimer(scheduled, 50).callback();
  assert.equal(printCount, 1);
});

test('the 1500ms safety timeout hides a still-pending companion logo', () => {
  const modules = loadModules();
  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  const image = {
    complete: false,
    style: {},
    addEventListener() {}
  };
  let printCount = 0;
  const printWin = {
    document: { images: [image] },
    focus() {},
    print() { printCount += 1; }
  };

  printWhenAssetsReady(printWin);
  assert.equal(scheduled.length, 1, 'only the safety timeout should be pending');
  const safetyTimer = findPrintTimer(scheduled, 1500);
  safetyTimer.callback();
  assert.equal(image.style.display, 'none');
  assert.equal(printCount, 1);
});

test('a logo loaded after the safety timeout is shown again', () => {
  const modules = loadModules();
  const image = {
    complete: false,
    style: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    listeners: {}
  };
  let printCount = 0;
  const printWin = {
    document: { images: [image] },
    focus() {},
    print() { printCount += 1; }
  };

  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  printWhenAssetsReady(printWin);
  const safetyTimer = findPrintTimer(scheduled, 1500);
  safetyTimer.callback();
  assert.equal(image.style.display, 'none');
  assert.equal(printCount, 1);
  image.listeners.load();
  assert.equal(image.style.display, '', 'a late successful load must restore the logo');
});

test('an image completing while listeners are attached uses the 50ms success path', () => {
  const modules = loadModules();
  let complete = false;
  const image = {
    get complete() { return complete; },
    naturalWidth: 222,
    style: {},
    addEventListener() { complete = true; }
  };
  let printCount = 0;
  const printWin = {
    document: { images: [image] },
    focus() {},
    print() { printCount += 1; }
  };

  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  printWhenAssetsReady(printWin);
  assert.equal(scheduled.length, 2, 'the success and safety timers should both be observable');
  findPrintTimer(scheduled, 50).callback();
  assert.equal(printCount, 1);
  assert.equal(findPrintTimer(scheduled, 1500).cancelled, true);
});

test('printing does nothing when the print window is already closed', () => {
  const modules = loadModules();
  const image = { complete: true, naturalWidth: 222, style: {}, addEventListener() {} };
  const calls = [];
  const printWin = {
    closed: true,
    document: { images: [image] },
    focus() { calls.push('focus'); },
    print() { calls.push('print'); }
  };

  const { printWhenAssetsReady, scheduled } = loadPrintWhenAssetsReady(modules);
  printWhenAssetsReady(printWin);
  findPrintTimer(scheduled, 50).callback();
  assert.deepEqual(calls, [], 'closed windows must not receive focus or print calls');
});

test('M32: detail labels only an all-term result with included previous term accordingly', () => {
  const detail = extractFunction(readSourceLines(), 'showStudentDetailsModal');
  assert.match(detail, /const detailOverallLabel = getStudentDetailOverallLabel\(course, selectedDetailTerm\);/);
  assert.match(detail, /if \(detailOverallLabel\)/);
});

test('M32: batch-print dropdown includes a term finalized without an assessment row', () => {
  const dropdown = extractFunction(readSourceLines(), 'updateTermsInDropdown');
  assert.match(dropdown, /listReportedTermsForStudent\(course, student\.id, assessmentTerms\)/);
});

test('M32: batch-print click keeps a result-only term in its rebuilt dropdown', () => {
  const section = extractFunction(readSourceLines(), 'renderStudentsSection');
  const clickStart = section.indexOf("massPrintBtn.addEventListener('click'");
  const printStart = section.indexOf('// PDF für alle gefilterten Schüler erstellen', clickStart);
  assert.ok(clickStart >= 0 && printStart > clickStart, 'the click path must rebuild its dropdown before printing');
  const dropdownRebuild = section.slice(clickStart, printStart);
  assert.match(dropdownRebuild, /updateTermsInDropdown\(\)/);
});

test('M32: batch-print refresh preserves a selected result-only term before printing', () => {
  const modules = loadModules();
  const student = { id: 'stu_1', lastName: 'Beispiel', firstName: 'Ada' };
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [{ studentId: student.id, term: '2025-H1', points: 12 }]
  });
  const { update, termSelect } = loadMassPrintDropdownUpdater(modules, {
    course,
    student,
    selectedTerm: '2025-H1',
    assessments: [{ courseId: course.id, term: '2025-H2', scores: { [student.id]: {} } }]
  });

  update();

  assert.equal(termSelect.value, '2025-H1');
  const section = extractFunction(readSourceLines(), 'renderStudentsSection');
  const clickStart = section.indexOf("massPrintBtn.addEventListener('click'");
  const printStart = section.indexOf('// PDF für alle gefilterten Schüler erstellen', clickStart);
  const clickRebuild = section.slice(clickStart, printStart);
  assert.ok(clickRebuild.indexOf('updateTermsInDropdown()') < clickRebuild.indexOf('const selectedTerm = termSelect.value'));
});

test('M32 review: batch-print refresh preserves the explicit all-terms selection', () => {
  const modules = loadModules();
  const student = { id: 'stu_1', lastName: 'Beispiel', firstName: 'Ada' };
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [{ studentId: student.id, term: '2025-H1', points: 12 }]
  });
  const { update, termSelect } = loadMassPrintDropdownUpdater(modules, {
    course,
    student,
    selectedTerm: '',
    assessments: [{ courseId: course.id, term: '2025-H2', scores: { [student.id]: {} } }]
  });

  update();

  assert.equal(termSelect.value, '', 'eine bewusste Auswahl aller Halbjahre darf nicht ersetzt werden');
});

test('M32 re-review: a concrete batch-print term survives a temporarily empty filter', () => {
  const modules = loadModules();
  const student = { id: 'stu_1', lastName: 'Beispiel', firstName: 'Ada' };
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [
      { studentId: student.id, term: '2025-H1', points: 11 },
      { studentId: student.id, term: '2025-H2', points: 12 }
    ]
  });
  const { update, termSelect, nameFilterInput } = loadMassPrintDropdownUpdater(modules, {
    course, student, selectedTerm: '2025-H1', assessments: []
  });

  nameFilterInput.value = 'ohne Treffer';
  update();
  assert.equal(termSelect.value, '');
  nameFilterInput.value = '';
  update();

  assert.equal(termSelect.value, '2025-H1');
});

test('M32 re-review: initial result-only terms select the current available term', () => {
  const modules = loadModules();
  const student = { id: 'stu_1', lastName: 'Beispiel', firstName: 'Ada' };
  const course = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    termResults: [
      { studentId: student.id, term: '2025-H1', points: 11 },
      { studentId: student.id, term: '2025-H2', points: 12 }
    ]
  });
  const { update, termSelect } = loadMassPrintDropdownUpdater(modules, {
    course, student, selectedTerm: '', selectionIsExplicit: false, currentTerm: '', assessments: []
  });

  update();

  assert.equal(termSelect.value, '2025-H2');
});

test('M32: Excel exports separate term-specific calculated and finalized columns', () => {
  const source = extractFunction(readSourceLines(), 'exportTransferExcel');
  assert.match(source, /Rechenwert/);
  assert.match(source, /Festgesetzte Punktzahl/);
  assert.match(source, /buildUpperSecContextPresentation/);
  assert.match(source, /listReferencedStudentIdsForCourse/);
});

test('M10: Excel category averages use the same archived Sek-II result scope as the overall value', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2
  };
  ctx.course.weightTemplateId = ctx.state.settings.weightTemplates[0].id;
  const otherCategory = ctx.state.settings.categories.find(category => category.id === ctx.categoryIds.other);
  otherCategory.active = false;
  const template = ctx.state.settings.weightTemplates[0];
  template.items.find(item => item.categoryId === ctx.categoryIds.written).weightPercent = 50;
  template.items.find(item => item.categoryId === ctx.categoryIds.oral).weightPercent = 50;

  const oldWritten = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Alte Klausur', term: '2024-H1'
  });
  const currentWritten = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Aktuelle Klausur', term: '2024-H2'
  });
  const oldOral = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Altes Gespräch', term: '2024-H1'
  });
  const currentOral = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Aktuelles Gespräch', term: '2024-H2'
  });
  setScore(modules, oldWritten, ctx.students[0].id, '2');
  setScore(modules, currentWritten, ctx.students[0].id, '12');
  setScore(modules, oldOral, ctx.students[0].id, '4');
  setScore(modules, currentOral, ctx.students[0].id, '10');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});

  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });
  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);

  const averages = readExcelAverageRow(workbook.sheets[0], 'Testperson1, Vorname1');
  assert.equal(averages.get('Ø Mündlich'), 10, 'der Kategorie-Ø muss nur den archivierten Ergebnis-Term enthalten');
  assert.equal(averages.get('Ø Schriftlich'), 12, 'der Kategorie-Ø muss nur den archivierten Ergebnis-Term enthalten');
  assert.equal(averages.get('Rechenwert gesamt'), 11, 'der Gesamtwert muss aus genau denselben aktuellen Leistungen berechnet werden');
});

test('Wave 2: Excel stores rounded decimal averages as numbers', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const first = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'K1' });
  const second = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'K2' });
  setScore(modules, first, ctx.students[0].id, '2');
  setScore(modules, second, ctx.students[0].id, '3');
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });
  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);
  const averages = readExcelAverageRow(workbook.sheets[0], 'Testperson1, Vorname1');
  assert.equal(averages.get('Ø Schriftlich'), 2.5);
});

test('Wave 2 fix: Excel leaves an invalid calculated value empty', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.OTHER,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2
  };
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, '2025-H1', 12);

  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });
  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);
  const text = workbookText(workbook.sheets[0]);

  assert.match(text, /Klausurzahl prüfen: /);
  assert.doesNotMatch(text, /Klausurzahl prüfen: null/);
});

test('M32 final review: archive details render exact-term calculated and finalized values read-only', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  const term = '2025-H1';
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, term, 12);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[1].id, term, 10);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Synthetische Klausur',
    term
  });
  setScore(modules, assessment, ctx.students[1].id, '11');
  ctx.course.enrollments = [];
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const { document, render } = loadArchivedCourseDetailsRenderer(modules, ctx.state);

  render(ctx.course, null);

  const text = collectArchiveText(document.body);
  assert.match(text, /Testperson1, Vorname1/);
  assert.match(text, /2025\/26 Q1 .*Rechenwert: –; Festgesetzte Punktzahl: 12/);
  assert.match(text, /2025\/26 Q1 .*Rechenwert: 11\.00; Festgesetzte Punktzahl: 10/);
  assert.equal(
    collectArchiveElements(document.body, element => element.tagName === 'input' || element.tagName === 'select').length,
    0,
    'archive result values must not expose editable controls'
  );
});

test('M32 final review: archive details calculate a date-only assessment in a finalized term', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const term = '2025-H1';
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, term, 12);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Datum ohne Halbjahr',
    date: '2025-10-15'
  });
  delete assessment.term;
  setScore(modules, assessment, ctx.students[0].id, '11');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const { document, render } = loadArchivedCourseDetailsRenderer(modules, ctx.state);

  render(ctx.course, null);

  assert.match(
    collectArchiveText(document.body),
    /2025\/26 Q1 .*Rechenwert: 11\.00; Festgesetzte Punktzahl: 12/
  );
});

test('archive details disclose Sek-I grades per assessment, including retained score-only students, as safe read-only text', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'grades', studentCount: 2 });
  ctx.students[1].lastName = 'Testperson <img src=x onerror=alert(1)>';
  ctx.course.enrollments = ctx.course.enrollments.filter(enrollment => enrollment.studentId === ctx.students[0].id);
  const written = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Klassenarbeit'
  });
  const oral = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral,
    title: 'Referat'
  });
  setScore(modules, written, ctx.students[0].id, '2+');
  setScore(modules, written, ctx.students[1].id, '3');
  setScore(modules, oral, ctx.students[0].id, '1');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const { document, render } = loadArchivedCourseDetailsRenderer(modules, ctx.state);

  render(ctx.course, null);

  const writtenDetails = findArchivedAssessmentDetails(document, 'Klassenarbeit');
  const writtenText = collectArchiveText(writtenDetails);
  assert.match(writtenText, /Einzelnoten \(2\)/);
  assert.match(writtenText, /Name Note Status/);
  assert.match(writtenText, /Testperson1, Vorname1 2\+ gültig/);
  assert.match(writtenText, /Testperson <img src=x onerror=alert\(1\)>, Vorname2 3 gültig/);
  assert.equal(collectArchiveElements(writtenDetails, element => element.tagName === 'img').length, 0);

  const oralDetails = findArchivedAssessmentDetails(document, 'Referat');
  assert.match(collectArchiveText(oralDetails), /Testperson1, Vorname1 1 gültig/);
  assert.doesNotMatch(collectArchiveText(oralDetails), /Vorname2/);
  assert.equal(
    collectArchiveElements(document.body, element => ['input', 'select', 'textarea'].includes(element.tagName)).length,
    0,
    'archive score disclosures must not expose editable controls'
  );
});

test('archive details preserve Sek-II zero points and explain missing and excused score statuses', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 3 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Punktetest'
  });
  setScore(modules, assessment, ctx.students[0].id, '0');
  setScore(modules, assessment, ctx.students[1].id, null, modules.DomainModel.SCORE_STATUS.MISSING);
  setScore(modules, assessment, ctx.students[2].id, null, modules.DomainModel.SCORE_STATUS.EXCUSED);
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const { document, render } = loadArchivedCourseDetailsRenderer(modules, ctx.state);

  render(ctx.course, null);

  const text = collectArchiveText(findArchivedAssessmentDetails(document, 'Punktetest'));
  assert.match(text, /Name Punkte Status/);
  assert.match(text, /Testperson1, Vorname1 0 gültig/);
  assert.match(text, /Testperson2, Vorname2 – fehlt/);
  assert.match(text, /Testperson3, Vorname3 – entschuldigt/);
});

test('archive details show a score-empty indication and opening them leaves archived data unchanged', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.other,
    title: 'Ohne Einzelnoten'
  });
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const stateBeforeOpening = JSON.stringify(ctx.state);
  const { document, render } = loadArchivedCourseDetailsRenderer(modules, ctx.state);

  render(ctx.course, null);

  const details = findArchivedAssessmentDetails(document, 'Ohne Einzelnoten');
  assert.match(collectArchiveText(details), /Einzelnoten \(0\) Keine Einzelnoten vorhanden\./);
  assert.equal(collectArchiveElements(details, element => element.tagName === 'table').length, 0);
  assert.equal(JSON.stringify(ctx.state), stateBeforeOpening);
});

test('M31: archived Q4 recommendation keeps its frozen written-category role after global template edits', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const course = modules.DomainModel.createCourse({
    name: 'Archivierter Q4-GK', subject: 'Biologie', classLabel: 'Q4',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    weightTemplateId: modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q3-q4', weightingDeviationReason: null }
  });
  const student = modules.DomainModel.createStudent({ lastName: 'Archiv', firstName: 'Bea' });
  modules.DomainModel.addStudentToState(state, student);
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});

  state.settings.weightTemplates = [];
  state.settings.categories.forEach(category => { category.name = 'Später geändert'; });
  const archiveSettings = modules.GradingLogic.getSettingsForCourse(course, state);
  const result = modules.GradingLogic.resolveUpperSecGradingContext(course, student.id, '2026-H2', archiveSettings);

  assert.equal(result.status, 'general-only');
  assert.equal(result.expectedExamCount, 0);
  assert.ok(archiveSettings.categoryRoles.upperSecWrittenCategoryId);
  assert.equal(archiveSettings.weightTemplates[0].id, course.weightTemplateId);
});

test('M31 review: Excel archive output uses the central snapshotted grading settings', () => {
  const source = extractFunction(readSourceLines(), 'exportTransferExcel');
  assert.match(source, /GradingLogic\.getSettingsForCourse\(course, state\)/);
  assert.doesNotMatch(source, /const gradingSettings = snapshot \? \{/);
});

test('M31: school-year preview and write path share the per-course successor plan', () => {
  const source = extractFunction(readSourceLines(), 'openSchoolYearAssistant');
  assert.match(source, /row\.plan = DomainModel\.planCourseSuccessor/);
  assert.match(source, /courseRows\.some\(row => row\.plan\.action === "review"\)/);
  assert.match(source, /if \(plan\.action !== 'continue'\) continue;/);
  assert.match(source, /createSuccessorCourseCandidate\(oldCourse, targetYear, plan\)/);
  assert.match(source, /requiresWeightingConfirmation/);
  assert.match(source, /Kontext prüfen/);
  assert.doesNotMatch(source, /selected\.length\s*!==\s*sourceCourses\.length/);
});

test('M31 task-7: school-year assistant previews and applies the exact safe successor weighting', () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const source = modules.DomainModel.createCourse({
    name: 'Biologie GK',
    subject: 'Biologie',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2
    }
  });
  const decorate = loadUiShellHelper(modules, 'decorateSuccessorPlanWithWeighting');
  const basePlan = modules.DomainModel.planCourseSuccessor(source, 2027);
  const plan = decorate(source, basePlan, state.settings);

  assert.equal(plan.requiresWeightingConfirmation, true);
  assert.equal(
    plan.targetWeightTemplateId,
    modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  assert.match(plan.targetWeightingLabel, /eine Klausur 1\/3 zu 2\/3/);
  const successor = modules.DomainModel.createSuccessorCourseCandidate(source, 2027, plan);
  assert.equal(successor.weightTemplateId, plan.targetWeightTemplateId);

  const unsafeSettings = JSON.parse(JSON.stringify(state.settings));
  unsafeSettings.weightTemplates = unsafeSettings.weightTemplates.filter(
    template => template.id !== modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  const openPlan = decorate(source, basePlan, unsafeSettings);
  assert.equal(openPlan.requiresWeightingConfirmation, false);
  assert.equal(openPlan.targetWeightTemplateId, null);
  assert.match(openPlan.targetWeightingLabel, /Keine sichere Empfehlung/);
});

test('M32 final review: generic student-detail output is reserved for an explicit combined upper-sec value', () => {
  const modules = loadModules();
  let labelFor = null;
  try { labelFor = loadUiShellHelper(modules, 'getStudentDetailOverallLabel'); } catch (error) {}
  assert.equal(typeof labelFor, 'function', 'the detail output decision helper is missing');
  const sekI = modules.DomainModel.createCourse({ name: 'Sek I', includePrevTermGrades: false });
  assert.equal(labelFor(sekI, '2025-H1'), 'Halbjahresnote');
  assert.equal(labelFor(sekI, '2025-H2'), 'Jahresgesamtnote (H1 + H2)');
  const upperSec = modules.DomainModel.createCourse({
    name: 'Sek II', schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  assert.equal(labelFor(upperSec, '2025-H1'), null);
  assert.equal(labelFor(upperSec, null), null);
  upperSec.includePrevTermGrades = true;
  assert.equal(labelFor(upperSec, null), null, 'Sek II bleibt trotz Altdaten-Flag termweise');

  const detail = extractFunction(readSourceLines(), 'showStudentDetailsModal');
  assert.match(detail, /getStudentDetailOverallLabel\(course, selectedDetailTerm\)/);
});

test('M32: Excel labels the combined upper-sec calculation as a Rechenwert', () => {
  const source = extractFunction(readSourceLines(), 'exportTransferExcel');
  assert.match(source, /course\.schemaMode === DomainModel\.SCHEMA_MODES\.UPPERSEC\s*\?\s*'Rechenwert gesamt'\s*:\s*'Ø Gesamt'/);
});

test('M31: the shared upper-sec presentation reports Q4 context and person-specific effective values', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  const term = '2026-H2';
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: 'Nur intern'
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  modules.DomainModel.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.students[0].id, true);
  const written = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'Klausur', term });
  const general = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term });
  setScore(modules, written, ctx.students[0].id, '15');
  setScore(modules, general, ctx.students[0].id, '9');
  setScore(modules, written, ctx.students[1].id, '15');
  setScore(modules, general, ctx.students[1].id, '9');
  const build = loadUpperSecContextPresentation(modules);

  assert.deepEqual(JSON.parse(JSON.stringify(build(ctx.course, ctx.students[0].id, term, ctx.state))), {
    courseTypeLabel: 'Grundkurs', qualificationPhase: 'Q4',
    examRequirementLabel: 'Klausur vorgesehen',
    manualDecisionWarning: null,
    calculatedLabel: 'Rechenwert', calculatedText: '11.22',
    finalizedLabel: 'Festgesetzte Punktzahl', finalizedPoints: null
  });
  assert.equal(build(ctx.course, ctx.students[1].id, term, ctx.state).examRequirementLabel, 'nur allgemeiner Teil');
  assert.equal(build(ctx.course, ctx.students[1].id, term, ctx.state).calculatedText, '9.00');
});

test('M31 task-7: retained non-applicable Q4 exam values stay internal in student score presentation', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  const written = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Erhaltene Q4-Klausur',
    term: '2025-H2'
  });
  setScore(modules, written, ctx.students[0].id, '15');
  const format = loadReportScorePresentation(modules);

  assert.equal(typeof format, 'function', 'eine zentrale schüler-/intern-sichere Wertdarstellung fehlt');
  assert.deepEqual(
    JSON.parse(JSON.stringify(format(ctx.course, written, ctx.students[0].id, ctx.state.settings, 'student'))),
    { text: 'nicht vorgesehen', numeric: null, status: 'not-scheduled' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(format(ctx.course, written, ctx.students[0].id, ctx.state.settings, 'internal'))),
    { text: 'nicht vorgesehen (Altwert: 15)', numeric: null, status: 'not-scheduled' }
  );
  assert.equal(written.scores[ctx.students[0].id].valueRaw, '15', 'der gespeicherte Altwert bleibt intern erhalten');
});

test('M31 final review: the shared LK presentation warns without replacing calculated or finalized values', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const term = '2026-H1';
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  for (let index = 0; index < 2; index += 1) {
    const written = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written, title: `Klausur ${index + 1}`, term
    });
    written.scores[ctx.students[0].id] = modules.DomainModel.createScoreEntry({
      status: modules.DomainModel.SCORE_STATUS.MISSING
    });
  }
  const general = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term
  });
  setScore(modules, general, ctx.students[0].id, '10');
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, term, 8);

  const presentation = loadUpperSecContextPresentation(modules)(
    ctx.course, ctx.students[0].id, term, ctx.state
  );
  assert.match(presentation.manualDecisionWarning, /manuell|fachlich/i);
  assert.equal(presentation.calculatedText, '10.00');
  assert.equal(presentation.finalizedPoints, 8);
});

test('M31 review remediation: the visible student detail renders the manual LK warning only for all-missed or all-zero exams', () => {
  const cases = [
    { values: ['missing', 'missing'], expected: true, label: 'all missed' },
    { values: [0, 0], expected: true, label: 'all zero' },
    { values: [0, 1], expected: false, label: 'one nonzero' }
  ];
  for (const scenario of cases) {
    const modules = loadModules();
    const ctx = buildLkWarningConsumerCase(modules, scenario.values);
    const document = createDetailDocumentStub();
    const showDetails = loadStudentDetailsConsumer(modules, ctx.state, document);

    showDetails(ctx.students[0]);

    const renderedText = collectRenderedText(document.body);
    assert.equal(/Fachlicher Warnhinweis:.*manuell/i.test(renderedText), scenario.expected, scenario.label);
    assert.doesNotMatch(renderedText, /INTERNER GRUND DARF NICHT EXPORTIERT WERDEN/, scenario.label);
  }
});

test('Task 8: the H2 student detail uses the same Sek-I annual result as the shared resolver after an edit', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const h1 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1', term: '2025-H1' });
  const h2 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2', term: '2025-H2' });
  setScore(modules, h1, student.id, '1');
  setScore(modules, h2, student.id, '5');
  const document = createDetailDocumentStub();
  const showDetails = loadStudentDetailsConsumer(modules, ctx.state, document, '2025-H2');

  showDetails(student);

  assert.match(collectRenderedText(document.body), /Jahresgesamtnote \(H1 \+ H2\): 3\.00/);
  h2.scores[student.id] = modules.DomainModel.createScoreEntry({ valueRaw: '3' });
  const refreshed = createDetailDocumentStub();
  loadStudentDetailsConsumer(modules, ctx.state, refreshed, '2025-H2')(student);
  assert.match(collectRenderedText(refreshed.body), /Jahresgesamtnote \(H1 \+ H2\): 2\.00/);
});

test('Task 8 fix round 1: the individual all-terms PDF labels a Sek-I H2 annual value and keeps term-only H1 wording', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const h1 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1', term: '2025-H1' });
  const h2 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2', term: '2025-H2' });
  setScore(modules, h1, student.id, '1');
  setScore(modules, h2, student.id, '5');
  const pdf = loadIndividualAllTermsPdfConsumer(modules, ctx.state);

  pdf.generate(student, null);

  assert.match(pdf.capture.html, /Jahresgesamtnote \(H1 \+ H2\): 3\.00/);
  assert.match(pdf.capture.html, /Halbjahrs-Durchschnitt: 1\.00/);
  assert.doesNotMatch(pdf.capture.html, /Halbjahrs-Durchschnitt: 3\.00/);
});

test('Task 8 fix round 1: both PDF paths share the term label decision without changing Sek-II wording', () => {
  const modules = loadModules();
  const labelFor = loadUiShellHelper(modules, 'getPdfOverallLabel');
  const sekI = modules.DomainModel.createCourse({ schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES });
  const sekII = modules.DomainModel.createCourse({ schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC });

  assert.equal(labelFor(sekI, '2025-H2', 'Halbjahrs-Durchschnitt'), 'Jahresgesamtnote (H1 + H2)');
  assert.equal(labelFor(sekI, '2025-H1', 'Halbjahrs-Durchschnitt'), 'Halbjahrs-Durchschnitt');
  assert.equal(labelFor(sekII, '2025-H2', 'Durchschnitt 2025-H2'), 'Durchschnitt 2025-H2');
});

test('Task 8 fix round 2: the real mass all-terms PDF shows the H2 annual value and a stable annual label', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const h1 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1', term: '2025-H1' });
  const h2 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2', term: '2025-H2' });
  setScore(modules, h1, student.id, '1');
  setScore(modules, h2, student.id, '5');
  const pdf = loadMassAllTermsPdfConsumer(modules, ctx.state, ctx.course, student);

  pdf.generate();

  assert.match(pdf.capture.html, /Jahresgesamtnote \(H1 \+ H2\): 3\.00/);
  assert.match(pdf.capture.html, /Durchschnitt 2025-H1: 1\.00/);
  assert.doesNotMatch(pdf.capture.html, /Durchschnitt 2025-H2: 3\.00/);
});

test('Task 4: individual print keeps the selected-term fixture and protects its compact signature block', () => {
  const modules = loadModules();
  const fixture = buildSignaturePaginationFixture(modules);
  const selected = loadIndividualAllTermsPdfConsumer(modules, fixture.state);
  selected.generate(fixture.student, '2025-H1');
  const allTerms = loadIndividualAllTermsPdfConsumer(modules, fixture.state);
  allTerms.generate(fixture.student, null);

  assertSelectedAndAllTermsFixture(
    selected.capture.html,
    allTerms.capture.html,
    /Archivkurs ohne H1-Zeilen \(AT1\)/,
    /Noch keine Noten eingetragen\./
  );
  assertCompactUnfragmentedSignatureArea(selected.capture.html);
});

test('Task 4: mass print keeps the selected-term fixture and protects its compact signature block', () => {
  const modules = loadModules();
  const fixture = buildSignaturePaginationFixture(modules);
  const courses = [fixture.course, fixture.archivedCourse];
  const selected = loadMassAllTermsPdfConsumer(
    modules,
    fixture.state,
    fixture.course,
    fixture.student,
    { courses, selectedTerm: '2025-H1' }
  );
  selected.generate();
  const allTerms = loadMassAllTermsPdfConsumer(
    modules,
    fixture.state,
    fixture.course,
    fixture.student,
    { courses }
  );
  allTerms.generate();

  assertSelectedAndAllTermsFixture(
    selected.capture.html,
    allTerms.capture.html,
    /Archivkurs ohne H1-Zeilen \(AT1\) \[Archiv\]/,
    /Keine gespeicherten Leistungen; Archivzuordnung ist vorhanden\./
  );
  assertCompactUnfragmentedSignatureArea(selected.capture.html);
});

test('M31 review remediation: the teacher Excel output renders the manual LK warning only for all-missed or all-zero exams', async () => {
  const cases = [
    { values: ['missing', 'missing'], expected: true, label: 'all missed' },
    { values: [0, 0], expected: true, label: 'all zero' },
    { values: [0, 1], expected: false, label: 'one nonzero' }
  ];
  for (const scenario of cases) {
    const modules = loadModules();
    const ctx = buildLkWarningConsumerCase(modules, scenario.values);
    let blob;
    const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });

    await exportExcel([ctx.course]);
    const workbook = await readXlsxWorkbook(blob);
    const text = workbookText(workbook.sheets[0]);

    assert.equal(/Fachlicher Warnhinweis:.*manuell/i.test(text), scenario.expected, scenario.label);
    assert.doesNotMatch(text, /INTERNER GRUND DARF NICHT EXPORTIERT WERDEN/, scenario.label);
  }
});

test('M31: archived presentation keeps its snapshotted context and effective weighting', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const term = '2026-H2';
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: 'Nur intern'
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  const written = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'Klausur', term });
  const general = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term });
  setScore(modules, written, ctx.students[0].id, '15');
  setScore(modules, general, ctx.students[0].id, '9');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  ctx.state.settings.weightTemplates = [];
  ctx.state.settings.categories.forEach(category => { category.name = 'Spaeter geaendert'; });
  const build = loadUpperSecContextPresentation(modules);

  const presentation = build(ctx.course, ctx.students[0].id, term, ctx.state);
  assert.equal(presentation.qualificationPhase, 'Q4');
  assert.equal(presentation.examRequirementLabel, 'nur allgemeiner Teil');
  assert.equal(presentation.calculatedText, '9.00');
});

test('M31 regression: dated assessments without a term stay in their own presentation half-year', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1 ohne Term', date: '2025-10-15'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2 ohne Term', date: '2026-03-15'
  });
  delete h1.term;
  delete h2.term;
  setScore(modules, h1, ctx.students[0].id, '15');
  setScore(modules, h2, ctx.students[0].id, '3');
  const build = loadUpperSecContextPresentation(modules);

  assert.equal(build(ctx.course, ctx.students[0].id, '2025-H1', ctx.state).calculatedText, '15.00');
  assert.equal(build(ctx.course, ctx.students[0].id, '2025-H2', ctx.state).calculatedText, '3.00');
});

test('M31 final review: archived date-only assessments use the same H1/H2 scope in overall and reports', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.schoolYearStartYear = 2025;
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  modules.DomainModel.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.students[0].id, true);
  const october = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q3 nur Datum', date: '2025-10-15'
  });
  const march = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q4 nur Datum', date: '2026-03-15'
  });
  delete october.term;
  delete march.term;
  setScore(modules, october, ctx.students[0].id, '15');
  setScore(modules, march, ctx.students[0].id, '3');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  const build = loadUpperSecContextPresentation(modules);

  const h1Presentation = Number(build(ctx.course, ctx.students[0].id, '2025-H1', ctx.state).calculatedText);
  const h2Presentation = Number(build(ctx.course, ctx.students[0].id, '2025-H2', ctx.state).calculatedText);
  assert.equal(h1Presentation, 15);
  assert.equal(h2Presentation, 3);
  assert.equal(
    modules.GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H1'),
    h1Presentation
  );
  assert.equal(
    modules.GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2025-H2'),
    h2Presentation
  );
});

test('M31 final re-review: archive migration keeps date-only October and March in distinct report terms', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.schoolYearStartYear = 2025;
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  modules.DomainModel.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.students[0].id, true);
  const october = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q3 nur Datum', date: '2025-10-15'
  });
  const march = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q4 nur Datum', date: '2026-03-15'
  });
  delete october.term;
  delete march.term;
  setScore(modules, october, ctx.students[0].id, '15');
  setScore(modules, march, ctx.students[0].id, '3');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});

  const migrated = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(ctx.state)));
  const migratedCourse = modules.DomainModel.findCourseById(migrated, ctx.course.id);
  const migratedOctober = migrated.assessments.find(assessment => assessment.title === 'Q3 nur Datum');
  const migratedMarch = migrated.assessments.find(assessment => assessment.title === 'Q4 nur Datum');
  const build = loadUpperSecContextPresentation(modules);

  assert.equal(migratedOctober.term, '2025-H1');
  assert.equal(migratedMarch.term, '2025-H2');
  for (const [term, expected] of [['2025-H1', 15], ['2025-H2', 3]]) {
    const reportValue = Number(build(migratedCourse, ctx.students[0].id, term, migrated).calculatedText);
    assert.equal(reportValue, expected, `Reporting ${term}`);
    assert.equal(
      modules.GradingLogic.computeOverallGrade(migratedCourse, ctx.students[0].id, migrated, term),
      expected,
      `Berechnung ${term}`
    );
  }
});

test('M31 task-5 review: archived custom cutoffs survive import, reporting and calculation', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.schoolYearStartYear = 2025;
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = modules.DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  ctx.course.termCutoffs = {
    h1EndMonth: 3,
    h1EndDay: 31,
    h2StartMonth: 4,
    h2StartDay: 1
  };
  const march = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Q3 mit archiviertem Sonderstichtag',
    date: '2026-03-15'
  });
  delete march.term;
  setScore(modules, march, ctx.students[0].id, '12');
  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  assert.equal(ctx.course.archiveSnapshot.termCutoffs.h1EndMonth, 3);

  // Der eingefrorene Snapshot muss auch dann fuehren, wenn der Kurswert spaeter abweicht.
  ctx.course.termCutoffs = {
    h1EndMonth: 1,
    h1EndDay: 30,
    h2StartMonth: 2,
    h2StartDay: 9
  };
  const imported = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(ctx.state)));
  const importedCourse = modules.DomainModel.findCourseById(imported, ctx.course.id);
  const importedMarch = imported.assessments.find(assessment => assessment.title === march.title);
  const build = loadUpperSecContextPresentation(modules);

  assert.equal(importedMarch.term, '2025-H1');
  assert.equal(
    Number(build(importedCourse, ctx.students[0].id, '2025-H1', imported).calculatedText),
    12
  );
  assert.equal(
    modules.GradingLogic.computeOverallGrade(importedCourse, ctx.students[0].id, imported, '2025-H1'),
    12
  );
});

test('M31 task-7: archive without course cutoffs keeps the frozen Sek-II cutoff source', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.schoolYearStartYear = 2025;
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.termCutoffs = null;
  ctx.state.settings.halfYearSettings.seckII = {
    schoolYearStartYear: 2025,
    schoolYearStartMonth: 8,
    schoolYearStartDay: 1,
    h1EndYear: 2026,
    h1EndMonth: 3,
    h1EndDay: 31,
    h2StartYear: 2026,
    h2StartMonth: 4,
    h2StartDay: 1
  };
  ctx.state.settings.termCutoffs = {
    schoolYearStartMonth: 8,
    h1EndMonth: 1,
    h1EndDay: 30,
    h2StartMonth: 2,
    h2StartDay: 9
  };
  const date = new Date('2026-03-15T12:00:00');

  assert.equal(
    modules.GradingLogic.resolveAssessmentTermFromDateValue(date, ctx.course, ctx.state.settings),
    '2025-H1',
    'die aktive Sek-II-Konfiguration muss vor der Archivierung gelten'
  );

  modules.DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  assert.equal(ctx.course.archiveSnapshot.termCutoffSource, 'schema');
  assert.equal(ctx.course.archiveSnapshot.termCutoffs, null);
  assert.equal(
    modules.GradingLogic.resolveAssessmentTermFromDateValue(
      date,
      ctx.course,
      modules.GradingLogic.getSettingsForCourse(ctx.course, ctx.state)
    ),
    '2025-H1',
    'Archivierung darf nicht auf den Legacy-Globalwert umschalten'
  );

  const imported = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(ctx.state)));
  const importedCourse = modules.DomainModel.findCourseById(imported, ctx.course.id);
  assert.equal(importedCourse.archiveSnapshot.termCutoffSource, 'schema');
  assert.equal(
    modules.GradingLogic.resolveAssessmentTermFromDateValue(
      date,
      importedCourse,
      modules.GradingLogic.getSettingsForCourse(importedCourse, imported)
    ),
    '2025-H1',
    'die eingefrorene schemaabhängige Quelle muss den JSON-Rundlauf überleben'
  );
});

test('M31 task-5 review: active course cutoffs override globals without changing defaults', () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const date = new Date('2026-03-15');

  assert.equal(
    modules.GradingLogic.resolveAssessmentTermFromDateValue(date, ctx.course, ctx.state.settings),
    '2025-H2'
  );

  ctx.course.termCutoffs = {
    h1EndMonth: 3,
    h1EndDay: 31,
    h2StartMonth: 4,
    h2StartDay: 1
  };
  assert.equal(
    modules.GradingLogic.resolveAssessmentTermFromDateValue(date, ctx.course, ctx.state.settings),
    '2025-H1'
  );
});

test('M31 task-7: central course term labels derive Q1 to Q4 from qualificationYear', () => {
  const modules = loadModules();
  const settings = modules.DomainModel.createEmptyState().settings;
  const q12 = modules.DomainModel.createCourse({
    name: 'Q1/Q2',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2
    }
  });
  const q34 = modules.DomainModel.createCourse({
    name: 'Q3/Q4',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
      qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  const format = modules.GradingLogic.formatCourseTermLabel;

  assert.equal(typeof format, 'function', 'ein zentraler kurskontextabhängiger Term-Formatter fehlt');
  assert.equal(format('2025-H1', q12, settings), '25/26 Q1');
  assert.equal(format('2025-H2', q12, settings), '25/26 Q2');
  assert.equal(format('2025-H1', q34, settings), '25/26 Q3');
  assert.equal(format('2025-H2', q34, settings), '25/26 Q4');
});

test('M31 task-7: Q3/Q4 Excel headers use Q3 and Q4 instead of global Q1/Q2 names', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q3-Klausur', term: '2025-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q4-Klausur', term: '2025-H2'
  });
  setScore(modules, h1, ctx.students[0].id, '12');
  setScore(modules, h2, ctx.students[0].id, '11');
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });

  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);
  const text = workbookText(workbook.sheets[0]);

  assert.match(text, /25\/26 Q3/);
  assert.match(text, /25\/26 Q4/);
  assert.doesNotMatch(text, /25\/26 Q1|25\/26 Q2/);
});

test('M31 regression: Excel creates separate term columns for date-only upper-sec assessments', async () => {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1 ohne Term', date: '2025-10-15'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2 ohne Term', date: '2026-03-15'
  });
  delete h1.term;
  delete h2.term;
  setScore(modules, h1, ctx.students[0].id, '15');
  setScore(modules, h2, ctx.students[0].id, '3');
  let blob;
  const exportExcel = loadExcelExporter(modules, ctx.state, content => { blob = content; });

  await exportExcel([ctx.course]);
  const workbook = await readXlsxWorkbook(blob);
  const text = workbookText(workbook.sheets[0]);

  assert.match(text, /Rechenwert 25\/26 Q1/);
  assert.match(text, /Rechenwert 25\/26 Q2/);
});

test('M31: detail, PDF, Excel and CSV use the shared student-safe upper-sec presentation', () => {
  const lines = readSourceLines();
  const consumers = [
    extractFunction(lines, 'showArchivedCourseDetails'),
    extractFunction(lines, 'showStudentDetailsModal'),
    extractFunction(lines, 'generateStudentGradePDF'),
    extractFunction(lines, 'renderStudentsSection'),
    extractFunction(lines, 'exportTransferExcel')
  ];
  for (const source of consumers) assert.match(source, /buildUpperSecContextPresentation/);

  for (const source of [
    extractFunction(lines, 'generateStudentGradePDF'),
    extractFunction(lines, 'renderStudentsSection'),
    extractFunction(lines, 'formatCsvTransferContextFields')
  ]) {
    assert.doesNotMatch(source, /weightingDeviationReason/);
  }
});

test('M31 review remediation: the teacher-only manual warning is absent from student PDF and CSV renderers', () => {
  const lines = readSourceLines();
  const studentsSection = extractFunction(lines, 'renderStudentsSection');
  const studentBatchPrintWithoutTeacherDetail = studentsSection.replace(
    extractFunction(lines, 'showStudentDetailsModal'),
    ''
  );
  for (const source of [
    extractFunction(lines, 'generateStudentGradePDF'),
    studentBatchPrintWithoutTeacherDetail,
    extractFunction(lines, 'formatCsvTransferContextFields')
  ]) {
    assert.doesNotMatch(source, /manualDecisionWarning|Fachlicher Warnhinweis/);
  }
});
