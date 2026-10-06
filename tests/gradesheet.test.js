'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadDashboardUi, findByAttribute } = require('./harness/dashboard-app.js');

function installCommitHarness(modules) {
  const lines = readSourceLines();
  vm.runInContext(
    `${extractFunction(lines, 'createSerializedTransactionQueue')}\n` +
      'globalThis.__createGradesheetQueue = createSerializedTransactionQueue;',
    modules.sandbox,
    { filename: 'gradesheet-queue.js' }
  );
  const enqueue = modules.sandbox.__createGradesheetQueue();
  const { createStateCommitter } = loadEsmGraph('src/ui/state-commit.js').exports;
  const committer = createStateCommitter({
    readState: () => modules.sandbox.state,
    persistState: candidate => modules.sandbox.persistState(candidate),
    publishState: candidate => { modules.sandbox.state = candidate; },
    enqueue,
    readEpoch: () => 0
  });
  const commitStateChange = (change, options = {}) => committer.commit(change).then(candidate => {
    if (options.render !== false && typeof modules.sandbox.render === 'function') {
      modules.sandbox.render();
    }
    return candidate;
  });
  modules.sandbox.commitStateChange = commitStateChange;
  return {
    commitStateChange,
    readState: () => modules.sandbox.state
  };
}

function loadGradesheetHelper(name) {
  const modules = loadModules();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, name)}\n` +
    `globalThis.__gradesheetHelper = ${name};`;
  vm.runInContext(source, modules.sandbox, { filename: `${name}.js` });
  modules.sandbox.persistState = async () => {};
  const commitHarness = installCommitHarness(modules);
  return {
    helper: modules.sandbox.__gradesheetHelper,
    modules,
    ...commitHarness
  };
}

function loadTermResultPersistenceHelper() {
  const modules = loadModules();
  const source = `${extractFunction(readSourceLines(), 'persistTermResultWithRollback')}\n` +
    'globalThis.__helper = persistTermResultWithRollback;';
  vm.runInContext(source, modules.sandbox, { filename: 'persistTermResultWithRollback.js' });
  modules.sandbox.persistState = async () => {};
  return { modules, helper: modules.sandbox.__helper, ...installCommitHarness(modules) };
}

function buildUpperSecTermResultState(modules) {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  return { ...ctx, student: ctx.students[0] };
}

test('gradesheet assessment headers use German display ordering', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  for (const title of ['Zora', 'Ordnung', 'Änne', 'Ökologie']) {
    addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title, term: '2025-H2' });
  }
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const headers = collectElements(container, element => element.tagName === 'span')
    .map(element => element.textContent || element.innerHTML)
    .filter(text => ['Änne', 'Ökologie', 'Ordnung', 'Zora'].includes(text));
  assert.deepEqual(headers, ['Änne', 'Ökologie', 'Ordnung', 'Zora']);
});

function loadSimpleGradesheetHelper(name) {
  const modules = loadModules();
  const source = `${extractFunction(readSourceLines(), name)}\n` +
    `globalThis.__simpleHelper = ${name};`;
  vm.runInContext(source, modules.sandbox, { filename: `${name}.js` });
  return modules.sandbox.__simpleHelper;
}

test('gemeinsame Notenfarbskala bewahrt Grenzwerte und Poor-Overrides beider Schemata', () => {
  const resolveGradeColorBand = loadSimpleGradesheetHelper('resolveGradeColorBand');

  assert.deepEqual([
    resolveGradeColorBand('grades', 1.5),
    resolveGradeColorBand('grades', 1.51),
    resolveGradeColorBand('grades', 2.51),
    resolveGradeColorBand('grades', 4.24),
    resolveGradeColorBand('grades', 4.25),
    resolveGradeColorBand('grades', 4, '4-'),
    resolveGradeColorBand('grades', 5)
  ], ['best', 'good', 'middle', 'notice', 'critical', 'critical', 'critical']);

  assert.deepEqual([
    resolveGradeColorBand('uppersec', 15),
    resolveGradeColorBand('uppersec', 10),
    resolveGradeColorBand('uppersec', 7),
    resolveGradeColorBand('uppersec', 5),
    resolveGradeColorBand('uppersec', 4),
    resolveGradeColorBand('uppersec', 0)
  ], ['best', 'good', 'middle', 'notice', 'critical', 'critical']);

  assert.equal(resolveGradeColorBand('grades', null), null);
  assert.equal(resolveGradeColorBand('uppersec', Number.NaN), null);
});

function createEditorDocumentStub() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this._classNames = new Set();
      this.className = '';
      this._value = '';
      this.selected = false;
      this.disabled = false;
      this.validity = { badInput: false };
      this.attributes = new Map();
      this.listeners = new Map();
      this.classList = {
        add: (...names) => names.forEach(name => this._classNames.add(name)),
        remove: (...names) => names.forEach(name => this._classNames.delete(name)),
        contains: name => this._classNames.has(name),
        toggle: (name, force) => {
          const next = force === undefined ? !this._classNames.has(name) : !!force;
          if (next) this._classNames.add(name); else this._classNames.delete(name);
          return next;
        }
      };
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (String(this.tagName).toLowerCase() === 'select' &&
          String(child.tagName).toLowerCase() === 'option' &&
          !this.children.some(option => option !== child && option.selected)) {
        child.selected = true;
      }
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      const removedSelectedOption = String(this.tagName).toLowerCase() === 'select' && child.selected;
      child.selected = false;
      child.parentNode = null;
      if (removedSelectedOption) {
        const firstOption = this.children.find(element =>
          String(element.tagName).toLowerCase() === 'option'
        );
        if (firstOption) firstOption.selected = true;
      }
      return child;
    }

    get firstChild() {
      return this.children[0] || null;
    }

    get lastChild() {
      return this.children.at(-1) || null;
    }

    get className() {
      return Array.from(this._classNames || []).join(' ');
    }

    set className(value) {
      this._classNames = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }

    get value() {
      if (String(this.tagName).toLowerCase() === 'select') {
        const selectedOption = this.children.find(element =>
          String(element.tagName).toLowerCase() === 'option' && element.selected
        );
        return selectedOption ? String(selectedOption.value) : '';
      }
      return this._value;
    }

    set value(value) {
      const nextValue = value == null ? '' : String(value);
      if (String(this.tagName).toLowerCase() === 'select') {
        let matched = false;
        for (const option of this.children) {
          const shouldSelect = !matched && String(option.tagName).toLowerCase() === 'option' &&
            String(option.value) === nextValue;
          option.selected = shouldSelect;
          if (shouldSelect) matched = true;
        }
        this._value = matched ? nextValue : '';
        return;
      }
      this._value = nextValue;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    async dispatch(type, event = {}) {
      const dispatchedEvent = {
        stopPropagation() {},
        preventDefault() {},
        stopImmediatePropagation() {},
        ...event
      };
      for (const listener of this.listeners.get(type) || []) {
        await listener.call(this, dispatchedEvent);
      }
    }

    focus() {}
    select() {}
    closest(selector) {
      let current = this;
      const wantedTag = String(selector || '').toLowerCase();
      while (current) {
        if (String(current.tagName || '').toLowerCase() === wantedTag) return current;
        current = current.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const selectorParts = String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
      if (selectorParts.length > 1) {
        return Array.from(new Set(selectorParts.flatMap(part => this.querySelectorAll(part))));
      }
      const rowDataMatch = /^tr\[data-student="([^"]+)"\]\[data-term="([^"]+)"\]$/.exec(String(selector || ''));
      if (rowDataMatch) {
        return collectElements(this, element => element !== this &&
          String(element.tagName || '').toLowerCase() === 'tr' &&
          element.dataset.student === rowDataMatch[1] &&
          element.dataset.term === rowDataMatch[2]);
      }
      const enabledClassMatch = /^\.([a-z0-9_-]+):not\(\[disabled\]\)$/i.exec(String(selector || ''));
      if (enabledClassMatch) {
        return collectElements(this, element => element !== this &&
          String(element.className || '').split(/\s+/).includes(enabledClassMatch[1]) &&
          element.disabled !== true);
      }
      const match = /^(?:([a-z]+))?(?:\.([a-z0-9_-]+))?$/i.exec(String(selector || ''));
      if (!match) return [];
      const [, wantedTag, wantedClass] = match;
      return collectElements(this, element => {
        const tagMatches = !wantedTag || String(element.tagName || '').toLowerCase() === wantedTag.toLowerCase();
        const classes = String(element.className || '').split(/\s+/).filter(Boolean);
        return element !== this && tagMatches && (!wantedClass || classes.includes(wantedClass));
      });
    }
  }

  const body = new FakeElement('body');
  return {
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(text) {
      const node = new FakeElement('#text');
      node.textContent = String(text);
      return node;
    },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
    querySelector(selector) { return body.querySelectorAll(selector)[0] || null; },
    addEventListener() {},
    removeEventListener() {},
    body
  };
}

function collectElements(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) collectElements(child, predicate, found);
  return found;
}

function loadGradesheetRenderer(overrides = {}, moduleOptions = {}) {
  // The widely used 2025-H2 fixtures belong to spring 2026. Keep their
  // renderer scope stable while allowing tests with explicit dates to override it.
  const modules = loadModules({ dateImpl: fixedDateClass('2026-03-15'), ...moduleOptions });
  const initialStorageSaveState = modules.Storage.saveState;
  const document = createEditorDocumentStub();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'createSerializedTransactionQueue')}\n` +
    `${extractFunction(lines, 'isStateCommitAborted')}\n` +
    `${extractFunction(lines, 'requireActiveCourse')}\n` +
    `${extractFunction(lines, 'requireStudent')}\n` +
    `${extractFunction(lines, 'requireAssessment')}\n` +
    `${extractFunction(lines, 'createLatestInteractionGuard')}\n` +
    `${extractFunction(lines, 'parseTermResultInput')}\n` +
    `${extractFunction(lines, 'parseHalfYearDateValue')}\n` +
    `${extractFunction(lines, 'createTermResultInput')}\n` +
    `${extractFunction(lines, 'persistScoreEntryWithRollback')}\n` +
    `${extractFunction(lines, 'persistAssessmentDeletionWithRollback')}\n` +
    `${extractFunction(lines, 'persistTermResultWithRollback')}\n` +
    `${extractFunction(lines, 'renderWeightedOverallCell')}\n` +
    `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
    `${extractFunction(lines, 'findNextGradesheetInput')}\n` +
    `${extractFunction(lines, 'resolveGradesheetTermFromDateValue')}\n` +
    `${extractFunction(lines, 'formatGradesheetTermLabel')}\n` +
    `${extractFunction(lines, 'resolveGradeColorBand')}\n` +
    'const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();\n' +
    `${extractFunction(lines, 'renderGradesheetSection')}\n` +
    'globalThis.__renderGradesheet = renderGradesheetSection;';
  Object.assign(modules.sandbox, {
    document,
    window: { alert() {}, confirm() { return true; } },
    gradesheetView: 'entry',
    requestGradesheetAnnualView() {},
    setCurrentCourse() {},
    persistState(candidate) {
      if (modules.Storage.saveState === initialStorageSaveState) return Promise.resolve();
      return modules.Storage.saveState(candidate);
    },
    runWhenDebugModeEnabled() {}
  }, overrides);
  installCommitHarness(modules);
  vm.runInContext(source, modules.sandbox, { filename: 'renderGradesheetSection.js' });
  const renderGradesheet = modules.sandbox.__renderGradesheet;
  let mountedContainer = null;
  let mountedTransition = null;
  function render(container, dashboardTransition) {
    if (container) {
      mountedContainer = container;
      mountedTransition = dashboardTransition;
    } else if (mountedContainer) {
      while (mountedContainer.firstChild) mountedContainer.removeChild(mountedContainer.firstChild);
    }
    if (!mountedContainer) return null;
    return renderGradesheet(mountedContainer, mountedTransition);
  }
  modules.sandbox.render = render;
  return { modules, document, render };
}

function fixedDateClass(isoDate) {
  const RealDate = Date;
  const fixedMillis = new RealDate(`${isoDate}T12:00:00`).getTime();
  return class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMillis]));
    }
    static now() { return fixedMillis; }
  };
}

function findAssessmentCreationControls(container) {
  return {
    category: collectElements(container, element =>
      String(element.tagName).toLowerCase() === 'select' &&
      element.children.some(option => option.textContent === 'Kategorie wählen...')
    )[0],
    title: collectElements(container, element =>
      String(element.tagName).toLowerCase() === 'input' &&
      element.placeholder === 'Bezeichnung (z. B. M1, Test 1)'
    )[0],
    date: collectElements(container, element =>
      String(element.tagName).toLowerCase() === 'input' && element.type === 'date'
    )[0],
    term: collectElements(container, element =>
      String(element.tagName).toLowerCase() === 'select' &&
      element.children.some(option => /^\d{4}-H[12]$/.test(option.value))
    )[0],
    add: collectElements(container, element =>
      String(element.tagName).toLowerCase() === 'button' && element.textContent === 'Leistung hinzufügen'
    )[0]
  };
}

function findDetailsBySummary(container, summaryText) {
  return collectElements(container, element =>
    String(element.tagName).toLowerCase() === 'details' &&
    collectElements(element, child =>
      String(child.tagName).toLowerCase() === 'summary' && child.textContent === summaryText
    ).length === 1
  )[0];
}

function collectTextContent(root) {
  return collectElements(root, () => true)
    .map(element => element.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAnnualCellValue(cell) {
  const valueSurface = (cell.children || []).find(element =>
    element.classList && element.classList.contains('gradesheet-annual-value')
  );
  return valueSurface ? valueSurface.textContent : cell.textContent;
}

test('gradesheet presents the selected course with direct access to the existing assessment form', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Vorhandene Leistung',
    term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const heading = collectElements(container, element => element.tagName === 'h2')[0];
  assert.equal(heading.textContent, 'Noteneingabe');
  const identity = collectElements(container, element => element.className === 'gradesheet-course-identity')[0];
  assert.ok(identity, 'der ausgewählte Kurs muss direkt bei der Noteneingabe sichtbar sein');
  assert.match(collectTextContent(identity), /Synthetischer Kurs/);
  assert.match(collectTextContent(identity), /Testfach/);
  assert.match(collectTextContent(identity), /T1/);
  const directCreate = collectElements(container, element =>
    element.tagName === 'button' && element.textContent === 'Neue Leistung anlegen'
  )[0];
  assert.ok(directCreate, 'die Kopfaktion muss das vorhandene Anlageformular direkt öffnen');
  assert.equal(directCreate.type, 'button');
  assert.equal(directCreate.attributes.get('aria-controls'), 'gradesheet-new-assessment');
  assert.equal(findDetailsBySummary(container, 'Kurs wechseln'), undefined,
    'die frühere redundante Kurs-Schnellwahl ist an dieser Position ersetzt');
  const compactHeader = collectElements(container, element => element.className === 'gradesheet-header')[0];
  assert.ok(compactHeader, 'Kurskontext und Kopfaktionen brauchen eine gemeinsame kompakte Kopfzeile');
  assert.equal(collectElements(compactHeader, element => element === heading).length, 1);
  assert.equal(collectElements(compactHeader, element => element === identity).length, 1);
  assert.equal(collectElements(compactHeader, element => element === directCreate).length, 1);
  const management = findDetailsBySummary(container, 'Leistungen verwalten');
  assert.ok(management && collectElements(compactHeader, element => element === management).length === 1,
    'die zentrale Leistungsverwaltung muss als Kopfaktion erreichbar sein');
  const create = findDetailsBySummary(management, 'Neue Leistung anlegen');
  assert.equal(management.open, false);
  assert.equal(create.open, false);
  await directCreate.dispatch('click');
  assert.equal(management.open, true);
  assert.equal(create.open, true);
});

test('an empty course keeps assessment creation reachable in the compact header', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 0 });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);

  const management = findDetailsBySummary(container, 'Leistungen verwalten');
  const create = findDetailsBySummary(container, 'Neue Leistung anlegen');
  assert.ok(management && create, 'auch ohne Einschreibungen muss die echte Leistungsanlage erreichbar bleiben');
  assert.equal(management.open, true);
  assert.equal(create.open, true);
  const compactHeader = collectElements(container, element => element.className === 'gradesheet-header')[0];
  assert.equal(collectElements(compactHeader, element => element === management).length, 1);
});

test('upper-secondary gradesheet surfaces the configured course context before assessment setup', () => {
  const cases = [
    {
      name: 'Q1-Grundkurs',
      date: '2026-09-15',
      context: { courseType: 'basic', qualificationYear: 'q1-q2' },
      expected: ['Sekundarstufe II', 'Grundkurs', 'Qualifikationsabschnitt: Q1/Q2', 'Aktuelles Kurshalbjahr: 26/27 Q1'],
      forbidden: 'Klausurentscheidung je Person'
    },
    {
      name: 'Q4-Grundkurs',
      date: '2027-03-15',
      context: { courseType: 'basic', qualificationYear: 'q3-q4' },
      expected: ['Grundkurs', 'Qualifikationsabschnitt: Q3/Q4', 'Aktuelles Kurshalbjahr: 26/27 Q4', 'Q4-Grundkurs: Klausurentscheidung je Person'],
      forbidden: null
    },
    {
      name: 'Q3-Leistungskurs',
      date: '2026-09-15',
      context: { courseType: 'advanced', qualificationYear: 'q3-q4' },
      expected: ['Leistungskurs', 'Qualifikationsabschnitt: Q3/Q4', 'Aktuelles Kurshalbjahr: 26/27 Q3'],
      forbidden: 'Klausurentscheidung je Person'
    },
    {
      name: 'sonstiger Kurs',
      date: '2026-09-15',
      context: { courseType: 'other', qualificationYear: 'q1-q2' },
      expected: ['Sonstiger Kurs', 'Qualifikationsabschnitt: Q1/Q2', 'Aktuelles Kurshalbjahr: 26/27 Q1'],
      forbidden: 'Klausurentscheidung je Person'
    }
  ];

  for (const scenario of cases) {
    const { modules, document, render } = loadGradesheetRenderer({}, {
      dateImpl: fixedDateClass(scenario.date)
    });
    const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
    ctx.course.upperSecContext = scenario.context;
    Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
    const container = document.createElement('main');

    render(container);

    const strip = collectElements(container, element =>
      element.className === 'gradesheet-uppersec-context'
    )[0];
    assert.ok(strip, `${scenario.name}: der Sek-II-Kontext muss vor leeren Leistungen sichtbar bleiben`);
    const text = collectTextContent(strip);
    for (const expected of scenario.expected) assert.match(text, new RegExp(expected));
    if (scenario.forbidden) assert.doesNotMatch(text, new RegExp(scenario.forbidden));
  }
});

test('upper-secondary Q2 context stays visible before the no-enrollment notice', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 0 });
  ctx.course.upperSecContext = { courseType: 'basic', qualificationYear: 'q1-q2' };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const strip = collectElements(container, element =>
    element.className === 'gradesheet-uppersec-context'
  )[0];
  assert.match(collectTextContent(strip), /Aktuelles Kurshalbjahr: 26\/27 Q2/);
  assert.doesNotMatch(collectTextContent(strip), /Klausurentscheidung je Person/);
  assert.match(collectTextContent(container), /noch keine eingeschriebenen Schüler/);
});

test('gradesheet flags incomplete upper-secondary context and keeps the strip out of Sek I', () => {
  const upper = loadGradesheetRenderer({}, { dateImpl: fixedDateClass('2026-09-15') });
  const upperCtx = buildCourseState(upper.modules, { schemaMode: 'uppersec', studentCount: 1 });
  upperCtx.course.upperSecContext = null;
  Object.assign(upper.modules.sandbox, { state: upperCtx.state, currentCourseId: upperCtx.course.id });
  const upperContainer = upper.document.createElement('main');
  upper.render(upperContainer);

  const incomplete = collectElements(upperContainer, element =>
    element.className === 'gradesheet-uppersec-context'
  )[0];
  assert.ok(incomplete, 'unvollständige Sek-II-Kurse brauchen einen sichtbaren Prüfhinweis');
  assert.match(collectTextContent(incomplete), /Kursart und Qualifikationsabschnitt prüfen/);
  assert.doesNotMatch(collectTextContent(incomplete), /Aktuelles Kurshalbjahr:/);

  const sekI = loadGradesheetRenderer();
  const sekICtx = buildCourseState(sekI.modules, { studentCount: 1 });
  Object.assign(sekI.modules.sandbox, { state: sekICtx.state, currentCourseId: sekICtx.course.id });
  const sekIContainer = sekI.document.createElement('main');
  sekI.render(sekIContainer);
  assert.equal(collectElements(sekIContainer, element =>
    element.className === 'gradesheet-uppersec-context'
  ).length, 0, 'Sek-I-Kurse dürfen keinen Sek-II-Kontext anzeigen');
});

test('gradesheet flags a configured upper-secondary context when its Q phase cannot be derived', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = { courseType: 'basic', qualificationYear: 'q1-q2' };
  modules.GradingLogic.resolveAssessmentTermFromDateValue = () => 'ungültiger-zeitraum';
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const strip = collectElements(container, element =>
    element.className === 'gradesheet-uppersec-context'
  )[0];
  assert.match(collectTextContent(strip), /Grundkurs/);
  assert.match(collectTextContent(strip), /Qualifikationsabschnitt: Q1\/Q2/);
  assert.match(collectTextContent(strip), /Kurshalbjahr konnte nicht bestimmt werden.*Kurskontext prüfen/);
  assert.doesNotMatch(collectTextContent(strip), /Aktuelles Kurshalbjahr:/);
});

test('assessment creation disclosure uses persistent labels and preserves its draft across toggles', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  ctx.state.settings.categories.find(category => category.id === ctx.categoryIds.oral).subcategories = [
    { id: 'sub-vortrag', name: 'Vortrag' }
  ];
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const disclosure = findDetailsBySummary(container, 'Neue Leistung anlegen');
  assert.ok(disclosure);
  assert.equal(disclosure.open, true, 'ohne Leistungen muss das Anlegen direkt sichtbar sein');
  const controls = findAssessmentCreationControls(disclosure);
  const labeledControls = [
    ['Kategorie', controls.category],
    ['Unterkategorie', collectElements(disclosure, element =>
      element.tagName === 'select' && element.children.some(option => option.textContent === 'Unterkategorie wählen...')
    )[0]],
    ['Bezeichnung', controls.title],
    ['Datum', controls.date],
    ['Halbjahr', controls.term],
    ['Gewicht', collectElements(disclosure, element => element.type === 'number')[0]]
  ];
  for (const [text, control] of labeledControls) {
    const label = collectElements(disclosure, element => element.tagName === 'label' && element.textContent === text)[0];
    assert.ok(label, `sichtbare Beschriftung fehlt: ${text}`);
    assert.ok(control.id, `${text} braucht eine stabile ID`);
    assert.equal(label.htmlFor, control.id, `${text} muss programmatisch mit dem Feld verbunden sein`);
  }
  const subcategory = labeledControls[1][1];
  assert.equal(subcategory.parentNode.style.display, 'none', 'verborgene Unterkategorie darf keine Lücke lassen');

  controls.title.value = 'Entwurfsleistung';
  controls.date.value = '2026-03-12';
  disclosure.open = false;
  disclosure.open = true;
  assert.equal(controls.title.value, 'Entwurfsleistung');
  assert.equal(controls.date.value, '2026-03-12');

  controls.category.value = ctx.categoryIds.oral;
  await controls.category.dispatch('change');
  assert.equal(subcategory.parentNode.style.display, '');
  assert.equal(subcategory.value, 'sub-vortrag');
  controls.category.value = ctx.categoryIds.written;
  await controls.category.dispatch('change');
  assert.equal(subcategory.parentNode.style.display, 'none');
});

test('assessment creation disclosure starts closed once an assessment exists', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2' });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  assert.equal(findDetailsBySummary(container, 'Neue Leistung anlegen').open, false);
});

test('gradesheet guidance names H1, H2, and upper-secondary result scopes truthfully', () => {
  const cases = [
    {
      schemaMode: 'grades', date: '2025-10-15', expected: /Durchschnittswerte.*nur auf H1/i,
      forbidden: /H1 und H2 zusammen/
    },
    {
      schemaMode: 'grades', date: '2026-03-15', expected: /Einzelbewertungen aus H1 und H2.*kein einfacher Mittelwert/is,
      forbidden: /Ø Gesamt \(gesamt\)/
    },
    {
      schemaMode: 'uppersec', date: '2026-03-15', expected: /Rechenwert.*Festgesetzt/is,
      forbidden: /automatisch fest/
    }
  ];
  for (const scenario of cases) {
    const { modules, document, render } = loadGradesheetRenderer({}, {
      dateImpl: fixedDateClass(scenario.date)
    });
    const ctx = buildCourseState(modules, { schemaMode: scenario.schemaMode, studentCount: 1 });
    addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written });
    Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
    const container = document.createElement('main');
    render(container);
    const tableHelpContent = collectElements(container, element => element.className === 'gradesheet-table-help-content')[0];
    assert.ok(tableHelpContent, 'die komprimierten Hinweise müssen im Tabellen-Footer erhalten bleiben');
    const text = scenario.schemaMode === 'uppersec'
      ? collectTextContent(container)
      : collectTextContent(tableHelpContent);
    assert.match(text, scenario.expected);
    assert.doesNotMatch(text, scenario.forbidden);
  }
});

test('result-only upper-secondary gradesheet explains result roles and uniquely names every pupil-term editor', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-03-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  configureQ1Q2Course(modules, ctx.course);
  Object.assign(ctx.students[0], { lastName: 'Beispiel', firstName: 'Eva' });
  Object.assign(ctx.students[1], { lastName: 'Muster', firstName: 'Max <script>untrusted()</script>' });
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, '2025-H1', 11);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const guide = collectElements(container, element => element.className === 'gradesheet-result-guide')[0];
  assert.ok(guide, 'the result explanation must be present before the no-assessments return');
  assert.match(collectTextContent(guide), /Rechenwert.*automatisch.*eingetragenen Leistungen/is);
  assert.match(collectTextContent(guide), /Festgesetzt.*ganze Punktzahl.*0 bis 15/is);
  assert.match(collectTextContent(guide), /leeres Feld.*noch nicht festgesetzt/is);
  assert.match(collectTextContent(guide), /0 ist gültig/i);

  const inputs = collectElements(container, element => element.className === 'gradesheet-term-result-input');
  assert.deepEqual(inputs.map(input => input.attributes.get('aria-label')).sort(), [
    'Festgesetzte Punktzahl für Beispiel, Eva – 25/26 Q1',
    'Festgesetzte Punktzahl für Beispiel, Eva – 25/26 Q2',
    'Festgesetzte Punktzahl für Muster, Max <script>untrusted()</script> – 25/26 Q1',
    'Festgesetzte Punktzahl für Muster, Max <script>untrusted()</script> – 25/26 Q2'
  ].sort());
  assert.equal(collectElements(container, element => String(element.tagName).toLowerCase() === 'script').length, 0);
  const errors = collectElements(container, element => element.className === 'gradesheet-input-error');
  assert.equal(new Set(errors.map(error => error.id)).size, errors.length, 'each editor error needs a unique ID');
  for (const input of inputs) {
    assert.equal(input.attributes.get('aria-describedby'), guide.id);
    assert.equal(input.attributes.get('aria-invalid'), 'false');
  }
});

test('combined gradesheet names ordinary grade and status controls by pupil, assessment, and rendered term', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-03-15')
  });
  const ctx = buildCourseState(modules, { studentCount: 2 });
  Object.assign(ctx.students[0], { lastName: 'Beispiel', firstName: 'Eva' });
  Object.assign(ctx.students[1], { lastName: 'Muster', firstName: 'Max <script>untrusted()</script>' });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Probe <script>untrusted()</script>',
    term: '2025-H2'
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Probe <script>untrusted()</script>',
    date: '2025-10-15',
    term: null
  });
  const untitled = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'temporary',
    term: '2025-H2'
  });
  untitled.title = '';
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const inputs = collectElements(container, element => element.className === 'gradesheet-input');
  const statuses = collectElements(container, element => element.className === 'gradesheet-status');
  assert.deepEqual(inputs.map(input => input.attributes.get('aria-label')).sort(), [
    'Note für Beispiel, Eva – Leistung „L“ – 25/26 H2',
    'Note für Beispiel, Eva – Leistung „Probe <script>untrusted()</script>“ – 25/26 H1',
    'Note für Beispiel, Eva – Leistung „Probe <script>untrusted()</script>“ – 25/26 H2',
    'Note für Muster, Max <script>untrusted()</script> – Leistung „L“ – 25/26 H2',
    'Note für Muster, Max <script>untrusted()</script> – Leistung „Probe <script>untrusted()</script>“ – 25/26 H1',
    'Note für Muster, Max <script>untrusted()</script> – Leistung „Probe <script>untrusted()</script>“ – 25/26 H2'
  ].sort());
  assert.deepEqual(statuses.map(select => select.attributes.get('aria-label')).sort(), [
    'Eingabestatus für Beispiel, Eva – Leistung „L“ – 25/26 H2',
    'Eingabestatus für Beispiel, Eva – Leistung „Probe <script>untrusted()</script>“ – 25/26 H1',
    'Eingabestatus für Beispiel, Eva – Leistung „Probe <script>untrusted()</script>“ – 25/26 H2',
    'Eingabestatus für Muster, Max <script>untrusted()</script> – Leistung „L“ – 25/26 H2',
    'Eingabestatus für Muster, Max <script>untrusted()</script> – Leistung „Probe <script>untrusted()</script>“ – 25/26 H1',
    'Eingabestatus für Muster, Max <script>untrusted()</script> – Leistung „Probe <script>untrusted()</script>“ – 25/26 H2'
  ].sort());
  assert.equal(collectElements(container, element => String(element.tagName).toLowerCase() === 'script').length, 0);
  for (const input of inputs) {
    assert.ok(input.attributes.get('aria-describedby'), 'the existing inline error must stay associated');
    assert.equal(input.attributes.get('aria-invalid'), 'false');
  }
});

test('split gradesheet names same-title score and status controls with their actual previous, current, and future terms', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  configureQ1Q2Course(modules, ctx.course);
  Object.assign(ctx.students[0], { lastName: 'Beispiel', firstName: 'Eva' });
  Object.assign(ctx.students[1], { lastName: 'Muster', firstName: 'Max' });
  for (const term of ['2025-H2', '2026-H1', '2026-H2']) {
    addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: 'Wiederholung',
      term
    });
  }
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const expectedTerms = new Map([
    ['2025-H2', '25/26 Q2'],
    ['2026-H1', '26/27 Q1'],
    ['2026-H2', '26/27 Q2']
  ]);
  for (const student of ctx.students) {
    const studentName = `${student.lastName}, ${student.firstName}`;
    for (const [term, termLabel] of expectedTerms) {
      const row = findStudentTermRow(container, student.id, term);
      assert.ok(row, `the ${term} renderer row must be present for ${studentName}`);
      const input = collectElements(row, element => element.className === 'gradesheet-input')[0];
      const status = collectElements(row, element => element.className === 'gradesheet-status')[0];
      assert.equal(
        input.attributes.get('aria-label'),
        `Punktzahl für ${studentName} – Leistung „Wiederholung“ – ${termLabel}`
      );
      assert.equal(
        status.attributes.get('aria-label'),
        `Eingabestatus für ${studentName} – Leistung „Wiederholung“ – ${termLabel}`
      );
    }
  }
});

test('status legend exposes plain labels beside its icons', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2' });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);

  const legend = collectElements(container, element => element.className === 'gradesheet-legend')[0];
  for (const label of ['gültig', 'fehlt', 'entschuldigt']) {
    assert.ok(collectElements(legend, element =>
      element.className === 'gradesheet-status-label' && element.textContent === label
    ).length === 1, `${label} muss ohne Tooltip lesbar sein`);
  }
});

function configureQ1Q2Course(modules, course) {
  course.upperSecContext = {
    courseType: modules.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: modules.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
}

function findTermSection(container, heading) {
  return collectElements(container, element =>
    element.classList && element.classList.contains('term-section') &&
    collectElements(element, child => child.tagName === 'strong' && child.textContent === heading).length === 1
  )[0];
}

function findStudentTermRow(container, studentId, term) {
  return collectElements(container, element =>
    element.tagName === 'tr' &&
    element.dataset.student === studentId &&
    element.dataset.term === term
  )[0];
}

function readCombinedOverallCells(row) {
  return row.querySelectorAll('td.gradesheet-avg').slice(-3).map(cell => cell.textContent);
}

function confirmedCourse(modules, courseId) {
  return modules.DomainModel.findCourseById(modules.sandbox.state, courseId);
}

function confirmedAssessment(modules, assessmentId) {
  return modules.DomainModel.findAssessmentById(modules.sandbox.state, assessmentId);
}

function confirmedScore(fixture, studentId = fixture.ctx.students[0].id) {
  return confirmedAssessment(fixture.modules, fixture.assessment.id).scores[studentId];
}

async function createCollapsibleHalfYearFixture() {
  const storage = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q1-Leistung', date: '2026-09-15', term: '2026-H1'
  });
  const next = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q2-Leistung', date: '2027-03-15', term: '2026-H2'
  });
  setScore(modules, current, ctx.students[0].id, '12');
  setScore(modules, next, ctx.students[0].id, '10');
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.students[0].id, '2026-H2', 8);
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const realSaveState = modules.Storage.saveState.bind(modules.Storage);
  const pendingSaves = [];
  let saveCalls = 0;
  modules.sandbox.persistState = nextState => {
    saveCalls += 1;
    const pending = realSaveState(nextState);
    pendingSaves.push(pending);
    return pending;
  };
  const container = document.createElement('main');
  render(container);
  return {
    modules, document, render, ctx, container,
    saveCalls: () => saveCalls,
    awaitSaves: () => Promise.all(pendingSaves)
  };
}

function assertGradesheetNameColumnContract(root, expectedStudentRows) {
  const nameHeaders = collectElements(root, element =>
    element.tagName === 'th' && element.textContent === 'Schüler'
  );
  assert.equal(nameHeaders.length, 1);
  assert.equal(nameHeaders[0].rowSpan, 2);
  assert.equal(nameHeaders[0].classList.contains('gradesheet-student-name'), true);

  const studentRows = collectElements(root, element =>
    element.tagName === 'tr' && typeof element.dataset.student === 'string'
  );
  assert.equal(studentRows.length, expectedStudentRows);
  assert.ok(studentRows.every(row =>
    row.children[0] && row.children[0].classList.contains('gradesheet-student-name')
  ));

  const nonNameHeaders = collectElements(root, element =>
    element.tagName === 'th' && element !== nameHeaders[0]
  );
  assert.ok(nonNameHeaders.length > 0);
  assert.ok(nonNameHeaders.every(header =>
    !header.classList.contains('gradesheet-student-name')
  ));
}

async function assertContextualAssessmentActions({ root, actionsRoot, document, title, state, confirmCalls, saveCalls }) {
  const assessmentHeader = collectElements(root, element =>
    element.tagName === 'th' && element.classList.contains('gradesheet-assessment-header')
  ).find(header => collectElements(header, element =>
    element.classList && element.classList.contains('gradesheet-assessment-title') &&
    element.textContent === title
  ).length === 1);
  assert.ok(assessmentHeader, 'the real renderer must keep an untrusted long title as text in its assessment header');
  assert.equal(collectElements(assessmentHeader, element => element.tagName === 'img').length, 0);

  const management = findDetailsBySummary(actionsRoot, 'Leistungen verwalten');
  assert.ok(management, 'assessment actions must live in the compact central management disclosure');
  assert.equal(collectElements(assessmentHeader, element =>
    element.classList && element.classList.contains('gradesheet-assessment-actions')
  ).length, 0, 'the table header must remain compact');
  const editButton = collectElements(management, element =>
    element.tagName === 'button' &&
    element.attributes.get('aria-label') === `Leistung „${title}“ bearbeiten`
  )[0];
  const deleteButton = collectElements(management, element =>
    element.tagName === 'button' &&
    element.attributes.get('aria-label') === `Leistung „${title}“ löschen`
  )[0];
  assert.ok(editButton);
  assert.ok(deleteButton);
  assert.equal(editButton.attributes.get('aria-label'), `Leistung „${title}“ bearbeiten`);
  assert.equal(deleteButton.attributes.get('aria-label'), `Leistung „${title}“ löschen`);

  await editButton.dispatch('click');
  assert.equal(collectElements(document.body, element =>
    element.tagName === 'h3' && element.textContent === 'Leistung bearbeiten'
  ).length, 1, 'Bearbeiten must still open the existing editAssessment dialog');

  const beforeDelete = JSON.stringify(state);
  await deleteButton.dispatch('click');
  assert.equal(confirmCalls(), 1, 'Löschen must still use the existing confirmation path');
  assert.equal(saveCalls(), 0, 'cancelling deletion must not start persistence');
  assert.equal(JSON.stringify(state), beforeDelete, 'cancelling deletion must preserve the assessment and scores');
}

function createCombinedAssessmentHeaderFixture() {
  let confirmations = 0;
  let saves = 0;
  const { modules, document, render } = loadGradesheetRenderer({
    window: {
      alert() {},
      confirm() { confirmations += 1; return false; }
    },
    persistState() { saves += 1; }
  });
  const ctx = buildCourseState(modules, { studentCount: 2 });
  const longTitle = 'Sehr lange <img src=x onerror=alert(1)> & weiterhin lesbare H2-Leistung';
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1-Bestand', term: '2025-H1'
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: longTitle,
    date: '2026-02-18',
    term: '2025-H2',
    visible: false
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);

  render(container);

  const combinedTable = collectElements(container, element =>
    element.tagName === 'table' && collectElements(element, child =>
      child.tagName === 'tr' && child.dataset.term === 'all'
    ).length === 2
  )[0];
  assert.ok(combinedTable);
  return {
    modules, document, ctx, container, table: combinedTable, longTitle,
    confirmCalls: () => confirmations,
    saveCalls: () => saves
  };
}

test('combined assessment header marks only the row-spanning student name column', () => {
  const fixture = createCombinedAssessmentHeaderFixture();
  assertGradesheetNameColumnContract(fixture.table, 2);
});

test('combined assessment header keeps an untrusted title text-safe and centralizes contextual actions', async () => {
  const fixture = createCombinedAssessmentHeaderFixture();
  await assertContextualAssessmentActions({
    root: fixture.table,
    actionsRoot: fixture.container,
    document: fixture.document,
    title: fixture.longTitle,
    state: fixture.ctx.state,
    confirmCalls: fixture.confirmCalls,
    saveCalls: fixture.saveCalls
  });
});

function createSplitAssessmentHeaderFixture() {
  let confirmations = 0;
  let saves = 0;
  const { modules, document, render } = loadGradesheetRenderer({
    window: {
      alert() {},
      confirm() { confirmations += 1; return false; }
    },
    persistState() { saves += 1; }
  }, { dateImpl: fixedDateClass('2026-09-15') });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const longTitle = 'Ausführliche Q1-Leistung <script>untrusted()</script>';
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: longTitle,
    date: '2026-09-15',
    term: '2026-H1'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);

  render(container);

  const currentSection = findTermSection(container, 'Halbjahr: 26/27 Q1');
  assert.ok(currentSection);
  const splitTable = collectElements(currentSection, element => element.tagName === 'table')[0];
  assert.ok(splitTable);
  return {
    modules, document, ctx, container, table: splitTable, longTitle,
    confirmCalls: () => confirmations,
    saveCalls: () => saves
  };
}

test('split assessment header marks only the row-spanning student name column', () => {
  const fixture = createSplitAssessmentHeaderFixture();
  assertGradesheetNameColumnContract(fixture.table, 1);
});

test('split assessment header keeps an untrusted title text-safe and centralizes contextual actions', async () => {
  const fixture = createSplitAssessmentHeaderFixture();
  await assertContextualAssessmentActions({
    root: fixture.table,
    actionsRoot: fixture.container,
    document: fixture.document,
    title: fixture.longTitle,
    state: fixture.ctx.state,
    confirmCalls: fixture.confirmCalls,
    saveCalls: fixture.saveCalls
  });
});

test('half-year creation keeps the automatic choice after rebuilding its real select options', async () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const controls = findAssessmentCreationControls(container);

  controls.date.value = '2027-03-15';
  await controls.date.dispatch('change');

  assert.equal(controls.term.value, 'auto', 'March 2027 must remain assigned automatically after option rebuilding');
  assert.equal(
    controls.term.children.find(option => option.value === 'auto').textContent,
    'Automatisch nach Datum'
  );
  assert.match(
    controls.term.children.find(option => option.value === '2026-H2').textContent,
    /Q2 \(nächstes\)$/
  );
});

test('half-year creation accepts a date-derived future term through the automatic choice', async () => {
  const alerts = [];
  const { modules, document, render } = loadGradesheetRenderer({
    window: { alert(message) { alerts.push(message); }, confirm() { return true; } }
  }, { dateImpl: fixedDateClass('2026-09-15') });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const controls = findAssessmentCreationControls(container);

  controls.date.value = '2028-03-15';
  await controls.date.dispatch('change');
  assert.equal(controls.term.value, 'auto');
  assert.ok(controls.term.children.some(option => option.value === '2027-H2'));

  controls.category.value = ctx.categoryIds.written;
  controls.title.value = 'Spätere Leistung';
  await controls.add.dispatch('click');

  assert.deepEqual(alerts, []);
  const created = modules.sandbox.state.assessments.find(assessment => assessment.title === 'Spätere Leistung');
  const statusText = collectElements(container, element => element.attributes && element.attributes.get('role') === 'alert')
    .map(element => element.textContent)
    .filter(Boolean)
    .join(' | ');
  assert.ok(created, 'the displayed future choice must also be accepted by the create handler: ' + statusText);
  assert.equal(created.term, '2027-H2');
  assert.equal(created.termAssignment, 'auto');
});

test('assessment editor preserves an explicit manual term until automatic assignment is selected', async () => {
  let saveCalls = 0;
  const { modules, document, render } = loadGradesheetRenderer({
    persistState() { saveCalls += 1; }
  }, { dateImpl: fixedDateClass('2026-09-15') });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Manuell eingeordnet',
    date: '2027-03-15',
    term: '2026-H1'
  });
  assessment.termAssignment = 'manual';
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);

  const management = findDetailsBySummary(container, 'Leistungen verwalten');
  const editButton = collectElements(management, element =>
    element.tagName === 'button' &&
    element.attributes.get('aria-label') === 'Leistung „Manuell eingeordnet“ bearbeiten'
  )[0];
  await editButton.dispatch('click');

  const dialog = collectElements(document.body, element =>
    element.tagName === 'h3' && element.textContent === 'Leistung bearbeiten'
  )[0].parentNode;
  const termSelect = collectElements(dialog, element =>
    element.tagName === 'select' && element.children.some(option => option.value === 'auto')
  )[0];
  const dateInput = collectElements(dialog, element => element.tagName === 'input' && element.type === 'date')[0];
  assert.equal(termSelect.value, '2026-H1');
  assert.equal(termSelect.children.find(option => option.value === 'auto').textContent, 'Automatisch nach Datum');

  dateInput.value = '2027-04-01';
  await dateInput.dispatch('change');
  assert.equal(termSelect.value, '2026-H1', 'date changes must not override an explicit manual assignment');

  termSelect.value = 'auto';
  const saveButton = collectElements(dialog, element =>
    element.tagName === 'button' && element.textContent === 'Speichern'
  )[0];
  await saveButton.dispatch('click');

  assert.equal(saveCalls, 1);
  const confirmedAssessment = modules.DomainModel.findAssessmentById(modules.sandbox.state, assessment.id);
  assert.equal(confirmedAssessment.date, '2027-04-01');
  assert.equal(confirmedAssessment.term, '2026-H2');
  assert.equal(confirmedAssessment.termAssignment, 'auto');
});

test('assessment editor preserves an out-of-window manual term across an unrelated edit and encrypted reload', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Editorpasswort-2026';
  const DateImpl = fixedDateClass('2026-09-15');
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: DateImpl
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Historische manuelle Leistung',
    date: '2024-03-15',
    term: '2023-H2'
  });
  assessment.termAssignment = 'manual';
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  let pendingSave = Promise.resolve();
  modules.sandbox.persistState = nextState => {
    pendingSave = modules.Storage.saveState(nextState);
    return pendingSave;
  };
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);

  const management = findDetailsBySummary(container, 'Leistungen verwalten');
  const editButton = collectElements(management, element =>
    element.tagName === 'button' &&
    element.attributes.get('aria-label') === 'Leistung „Historische manuelle Leistung“ bearbeiten'
  )[0];
  await editButton.dispatch('click');
  const dialog = collectElements(document.body, element =>
    element.tagName === 'h3' && element.textContent === 'Leistung bearbeiten'
  )[0].parentNode;
  const termSelect = collectElements(dialog, element =>
    element.tagName === 'select' && element.children.some(option => option.value === 'auto')
  )[0];
  assert.equal(termSelect.value, '2023-H2');
  assert.ok(termSelect.children.some(option => option.value === '2023-H2'));

  const titleInput = collectElements(dialog, element => element.tagName === 'input' && element.type === 'text')[0];
  titleInput.value = 'Nur Titel geändert';
  await collectElements(dialog, element =>
    element.tagName === 'button' && element.textContent === 'Speichern'
  )[0].dispatch('click');
  await pendingSave;

  await modules.Storage.lockSession();
  const storageReader = loadModules({ storage, password, dateImpl: DateImpl, lockManager: modules.lockManager });
  await storageReader.sessionCoordinator.acquire();
  const reloaded = await storageReader.Storage.loadState();
  const stored = reloaded.assessments.find(candidate => candidate.id === assessment.id);
  assert.equal(stored.title, 'Nur Titel geändert');
  assert.equal(stored.term, '2023-H2');
  assert.equal(stored.termAssignment, 'manual');
});

test('half-year creation keeps Q2 for a second add while real saves delay the replacement render', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';
  const DateImpl = fixedDateClass('2026-09-15');
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: DateImpl
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  const renderGate = deferred();
  const realSaveState = modules.Storage.saveState.bind(modules.Storage);
  let saveCalls = 0;
  modules.Storage.saveState = nextState => {
    saveCalls += 1;
    const realPersistence = realSaveState(nextState);
    return Promise.all([realPersistence, renderGate.promise]).then(([result]) => result);
  };
  render(container);
  const controls = findAssessmentCreationControls(container);

  controls.date.value = '2027-03-15';
  await controls.date.dispatch('change');
  controls.term.value = '2026-H2';
  controls.category.value = ctx.categoryIds.written;
  controls.title.value = 'März 1';
  const firstAdd = controls.add.dispatch('click');
  await Promise.resolve();

  assert.equal(saveCalls, 1);
  assert.equal(controls.date.value, '2027-03-15');
  assert.equal(controls.term.value, '2026-H2', 'the still-mounted March form must keep Q2 selected');
  controls.category.value = ctx.categoryIds.written;
  controls.title.value = 'März 2';
  await controls.add.dispatch('click');

  assert.equal(saveCalls, 1, 'Save 2 must not start while Save 1 still holds the shared queue');
  renderGate.resolve();
  await firstAdd;
  const freshControls = findAssessmentCreationControls(container);
  assert.notEqual(freshControls.date, controls.date, 'completed persistence must replace the old form');
  assert.equal(freshControls.date.value, '');
  assert.equal(freshControls.term.value, 'auto');
  freshControls.date.value = '2027-03-15';
  await freshControls.date.dispatch('change');
  freshControls.term.value = '2026-H2';
  freshControls.category.value = ctx.categoryIds.written;
  freshControls.title.value = 'März 2';
  await freshControls.add.dispatch('click');

  assert.equal(saveCalls, 2);
  assert.deepEqual(
    Array.from(modules.sandbox.state.assessments, assessment => [assessment.title, assessment.term]),
    [['März 1', '2026-H2'], ['März 2', '2026-H2']]
  );

  await modules.Storage.lockSession();
  const storageReader = loadModules({ storage, password, dateImpl: DateImpl, lockManager: modules.lockManager });
  await storageReader.sessionCoordinator.acquire();
  const reloaded = await storageReader.Storage.loadState();
  assert.deepEqual(
    Array.from(reloaded.assessments, assessment => [assessment.title, assessment.term]),
    [['März 1', '2026-H2'], ['März 2', '2026-H2']]
  );
});

test('half-year creation preserves an explicit next-term choice when no date is entered', async () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const controls = findAssessmentCreationControls(container);

  controls.term.value = '2026-H2';
  controls.category.value = ctx.categoryIds.written;
  controls.title.value = 'Undatiert Q2';
  await controls.add.dispatch('click');

  const created = modules.sandbox.state.assessments.find(assessment => assessment.title === 'Undatiert Q2');
  assert.equal(created.date, null);
  assert.equal(created.term, '2026-H2');
  assert.equal(created.termAssignment, 'manual');
});

test('completed creation resets the form, then a re-entered March date saves a second visible Q2 assessment', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';
  const DateImpl = fixedDateClass('2026-09-15');
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: DateImpl
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  let rerenderCount = 0;
  modules.sandbox.persistState = nextState => modules.Storage.saveState(nextState);
  const renderFromCommit = modules.sandbox.render;
  modules.sandbox.render = (...args) => {
    if (!args[0]) rerenderCount += 1;
    return renderFromCommit(...args);
  };
  render(container);
  const firstControls = findAssessmentCreationControls(container);

  firstControls.date.value = '2027-03-15';
  await firstControls.date.dispatch('change');
  firstControls.term.value = '2026-H2';
  firstControls.category.value = ctx.categoryIds.written;
  firstControls.title.value = 'Gespeicherte Q2-Leistung 1';
  await firstControls.add.dispatch('click');

  const secondControls = findAssessmentCreationControls(container);
  assert.notEqual(secondControls.date, firstControls.date);
  assert.equal(secondControls.date.value, '', 'a completed save keeps the historical empty form reset');
  assert.equal(secondControls.term.value, 'auto');
  assert.equal(rerenderCount, 1);

  secondControls.date.value = '2027-03-15';
  await secondControls.date.dispatch('change');
  secondControls.term.value = '2026-H2';
  secondControls.category.value = ctx.categoryIds.written;
  secondControls.title.value = 'Gespeicherte Q2-Leistung 2';
  await secondControls.add.dispatch('click');

  assert.equal(rerenderCount, 2);
  assert.deepEqual(
    Array.from(modules.sandbox.state.assessments, assessment => [assessment.title, assessment.term]),
    [
      ['Gespeicherte Q2-Leistung 1', '2026-H2'],
      ['Gespeicherte Q2-Leistung 2', '2026-H2']
    ]
  );
  const finalControls = findAssessmentCreationControls(container);
  assert.equal(finalControls.date.value, '');
  assert.equal(finalControls.term.value, 'auto');
  assert.ok(collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.term === '2026-H2'
  ).length > 0, 'the saved Q2 assessments must remain visible after re-render');
  assert.deepEqual(
    collectElements(container, element => element.tagName === 'span' &&
      /^Gespeicherte Q2-Leistung /.test(element.textContent)
    ).map(element => element.textContent).sort(),
    ['Gespeicherte Q2-Leistung 1', 'Gespeicherte Q2-Leistung 2']
  );

  await modules.Storage.lockSession();
  const storageReader = loadModules({ storage, password, dateImpl: DateImpl, lockManager: modules.lockManager });
  await storageReader.sessionCoordinator.acquire();
  const reloaded = await storageReader.Storage.loadState();
  storageReader.sandbox.resolveAssessmentTermFromDateValue = (date, course, settings) =>
    storageReader.GradingLogic.resolveAssessmentTermFromDateValue(date, course, settings);
  vm.runInContext(
    `${extractFunction(readSourceLines(), 'recalcAssessmentTermsForCurrentState')}\n` +
      'globalThis.__recalcAssessmentTerms = recalcAssessmentTermsForCurrentState;',
    storageReader.sandbox,
    { filename: 'recalcAssessmentTermsForCurrentState.js' }
  );
  storageReader.sandbox.__recalcAssessmentTerms(reloaded);
  assert.deepEqual(
    Array.from(reloaded.assessments, assessment => [assessment.title, assessment.date, assessment.term]),
    [
      ['Gespeicherte Q2-Leistung 1', '2027-03-15', '2026-H2'],
      ['Gespeicherte Q2-Leistung 2', '2027-03-15', '2026-H2']
    ]
  );
});

test('split upper-secondary gradesheet renders current and populated next terms separately', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  configureQ1Q2Course(modules, ctx.course);
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q1-Leistung', date: '2026-09-15', term: '2026-H1'
  });
  const next = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q2-Leistung', date: '2027-03-15', term: '2026-H2'
  });
  setScore(modules, current, ctx.students[0].id, '12');
  setScore(modules, current, ctx.students[1].id, '6');
  setScore(modules, next, ctx.students[0].id, '10');
  setScore(modules, next, ctx.students[1].id, '4');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const headers = collectElements(container, element => element.tagName === 'strong')
    .map(element => element.textContent);
  assert.ok(headers.includes('Halbjahr: 26/27 Q1'));
  assert.ok(headers.includes('Halbjahr: 26/27 Q2'));
  assert.ok(headers.some(text => /^Archiv: /.test(text)), 'the existing previous-term archive remains rendered');
  assert.ok(!headers.includes('Archiv: 26/27 Q2'), 'the next term must remain an active editing section');

  const termTotals = term => collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.term === term
  ).map(row => row.querySelectorAll('td.gradesheet-avg').at(-1).textContent);
  assert.deepEqual(termTotals('2026-H1'), ['12.00', '6.00']);
  assert.deepEqual(termTotals('2026-H2'), ['10.00', '4.00']);
  const nextInputs = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2026-H2'
  );
  assert.equal(nextInputs.length, 2);
  assert.ok(nextInputs.every(input => input.disabled === false));
});

test('Sek-I H1 creates, edits, encrypts, and reloads the populated H2 preview without changing H1', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Sek-I-Testpasswort-2026';
  const DateImpl = fixedDateClass('2026-09-15');
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: DateImpl
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1-Bestand', date: '2026-10-01', term: '2026-H1'
  });
  setScore(modules, current, student.id, '2');
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  let stateChangeCalls = 0;
  modules.sandbox.persistState = nextState => {
    stateChangeCalls += 1;
    return modules.Storage.saveState(nextState);
  };

  render(container);
  assert.equal(findTermSection(container, 'Halbjahr: 26/27 H2'), undefined,
    'an empty immediate-next term must not add a section');
  assert.equal(findStudentTermRow(container, student.id, '2026-H1')
    .querySelectorAll('td.gradesheet-avg').at(-1).textContent, '2.00');

  const controls = findAssessmentCreationControls(container);
  controls.date.value = '2027-03-15';
  await controls.date.dispatch('change');
  assert.equal(controls.term.value, 'auto');
  controls.category.value = ctx.categoryIds.oral;
  controls.title.value = 'H2-Vorschau';
  await controls.add.dispatch('click');

  const nextSection = findTermSection(container, 'Halbjahr: 26/27 H2');
  assert.ok(nextSection, 'the saved immediate-next Sek-I H2 must be rendered');
  const nextInput = collectElements(nextSection, element =>
    element.className === 'gradesheet-input' &&
    element.dataset.gradesheetTerm === '2026-H2'
  )[0];
  assert.ok(nextInput);
  assert.equal(nextInput.disabled, false);
  nextInput.value = '4';
  await nextInput.dispatch('change');

  assert.equal(findStudentTermRow(container, student.id, '2026-H1')
    .querySelectorAll('td.gradesheet-avg').at(-1).textContent, '2.00');
  assert.equal(findStudentTermRow(container, student.id, '2026-H2')
    .querySelectorAll('td.gradesheet-avg').at(-1).textContent, '4.00');
  await nextSection.children[0].dispatch('click');
  assert.equal(nextSection.children[1].classList.contains('hidden'), true);
  assert.equal(stateChangeCalls, 2, 'assessment and score saves persist; the next preview collapse remains local');
  assert.equal(confirmedCourse(modules, ctx.course.id)._currCollapsed, undefined);
  assert.equal(confirmedCourse(modules, ctx.course.id)._prevCollapsed, undefined);

  await modules.Storage.lockSession();
  const storageReader = loadModules({ storage, password, dateImpl: DateImpl, lockManager: modules.lockManager });
  await storageReader.sessionCoordinator.acquire();
  const reloaded = await storageReader.Storage.loadState();
  const reader = loadGradesheetRenderer({}, { dateImpl: DateImpl });
  Object.assign(reader.modules.sandbox, { state: reloaded, currentCourseId: ctx.course.id });
  const fresh = reader.document.createElement('main');
  reader.document.body.appendChild(fresh);
  reader.render(fresh);
  const freshNext = findTermSection(fresh, 'Halbjahr: 26/27 H2');
  assert.ok(freshNext);
  assert.equal(freshNext.children[1].classList.contains('hidden'), false,
    'a fresh render opens the presentation-local next preview');
  assert.equal(collectElements(freshNext, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2026-H2'
  )[0].value, '4');
});

test('Sek-I H2 keeps current, previous, and annual results isolated from a saved next-school-year H1', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Sek-I-Testpasswort-2027';
  const DateImpl = fixedDateClass('2027-03-15');
  const { modules, document, render } = loadGradesheetRenderer({}, {
    storage, password, dateImpl: DateImpl
  });
  const ctx = buildCourseState(modules, { studentCount: 3 });
  const [studentA, studentB, studentC] = ctx.students;
  const assessments = {
    h1Oral1: addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'H1 mündlich 1', term: '2026-H1' }),
    h1Oral2: addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'H1 mündlich 2', term: '2026-H1' }),
    h1Written: addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1 schriftlich', term: '2026-H1' }),
    h2Oral: addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'H2 mündlich', term: '2026-H2' }),
    h2Written: addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2 schriftlich', term: '2026-H2' })
  };
  for (const [student, values] of [
    [studentA, ['2', null, '2', '3', '5']],
    [studentB, ['4', null, '4', '3', '1']],
    [studentC, ['1', '3', '2', '3', '5']]
  ]) {
    Object.values(assessments).forEach((assessment, index) => {
      if (values[index] !== null) setScore(modules, assessment, student.id, values[index]);
    });
  }
  await modules.sessionReady;
  await modules.Storage.enableEncryption(password, ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  modules.sandbox.persistState = nextState => modules.Storage.saveState(nextState);

  render(container);
  assert.equal(findTermSection(container, 'Halbjahr: 27/28 H1'), undefined,
    'no empty next-school-year preview is rendered');
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentA.id, 'all')), ['4.00', '2.00', '3.00']);
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentB.id, 'all')), ['2.00', '4.00', '3.00']);
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentC.id, 'all')), ['4.00', '2.00', '2.92'],
    'unequal assessment counts must aggregate individual assessments, not term means');

  const controls = findAssessmentCreationControls(container);
  controls.date.value = '2027-09-15';
  await controls.date.dispatch('change');
  assert.equal(controls.term.value, 'auto');
  controls.category.value = ctx.categoryIds.other;
  controls.title.value = 'Nächstes Schuljahr';
  await controls.add.dispatch('click');

  const nextSection = findTermSection(container, 'Halbjahr: 27/28 H1');
  assert.ok(nextSection);
  const nextInput = collectElements(nextSection, element =>
    element.className === 'gradesheet-input' &&
    element.dataset.gradesheetTerm === '2027-H1' &&
    element.dataset.gradesheetRow === '0'
  )[0];
  assert.ok(nextInput);
  nextInput.value = '6';
  await nextInput.dispatch('change');
  assert.equal(findStudentTermRow(container, studentA.id, '2027-H1')
    .querySelectorAll('td.gradesheet-avg').at(-1).textContent, '6.00');
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentA.id, 'all')), ['4.00', '2.00', '3.00'],
    'next-only categories and scores must not pollute the current annual table');
  assert.equal(collectElements(container, element =>
    element.tagName === 'th' && /Sonstiges \(2026-H[12]\)/.test(element.textContent || '')
  ).length, 0, 'a next-only category must not add current/previous average columns');

  const previousInput = collectElements(container, element =>
    element.className === 'gradesheet-input' &&
    element.dataset.gradesheetTerm === '2026-H1' &&
    element.dataset.gradesheetRow === '0' &&
    element.value === '2'
  )[0];
  previousInput.value = '4';
  await previousInput.dispatch('change');
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentA.id, 'all')), ['4.00', '3.00', '3.50'],
    'editing the previous H1 must keep the live current cell term-only and refresh the annual value');

  const currentInput = collectElements(container, element =>
    element.className === 'gradesheet-input' &&
    element.dataset.gradesheetTerm === 'all' &&
    element.dataset.gradesheetRow === '0' &&
    element.value === '5'
  )[0];
  currentInput.value = '1';
  await currentInput.dispatch('change');
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(container, studentA.id, 'all')), ['2.00', '3.00', '2.50'],
    'editing current H2 must keep current, previous, and annual live cells distinct');

  await modules.Storage.lockSession();
  const storageReader = loadModules({ storage, password, dateImpl: DateImpl, lockManager: modules.lockManager });
  await storageReader.sessionCoordinator.acquire();
  const reloaded = await storageReader.Storage.loadState();
  const reader = loadGradesheetRenderer({}, { dateImpl: DateImpl });
  Object.assign(reader.modules.sandbox, { state: reloaded, currentCourseId: ctx.course.id });
  const fresh = reader.document.createElement('main');
  reader.document.body.appendChild(fresh);
  reader.render(fresh);
  assert.deepEqual(readCombinedOverallCells(findStudentTermRow(fresh, studentA.id, 'all')), ['2.00', '3.00', '2.50']);
  const freshNext = findTermSection(fresh, 'Halbjahr: 27/28 H1');
  assert.ok(freshNext, 'the retained next-term record must render after encrypted reload without recreation');
  assert.equal(collectElements(freshNext, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2027-H1'
  )[0].value, '6');
});

test('persisted current and previous collapse leave the next upper-secondary section open after rerender', async () => {
  const fixture = await createCollapsibleHalfYearFixture();
  const currentSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q1');
  const nextSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q2');
  const previousSection = collectElements(fixture.container, element =>
    element.classList && element.classList.contains('term-section') &&
    element.classList.contains('prev-term')
  )[0];

  await currentSection.children[0].dispatch('click');
  await previousSection.children[0].dispatch('click');
  await fixture.awaitSaves();

  assert.equal(fixture.saveCalls(), 2, 'current and previous collapse remain persisted behavior');
  const confirmed = confirmedCourse(fixture.modules, fixture.ctx.course.id);
  assert.equal(confirmed._currCollapsed, true);
  assert.equal(confirmed._prevCollapsed, true);
  assert.equal(nextSection.children[1].classList.contains('hidden'), false);

  const rerendered = fixture.document.createElement('main');
  fixture.render(rerendered);
  assert.equal(findTermSection(rerendered, 'Halbjahr: 26/27 Q1').children[1].classList.contains('hidden'), true);
  assert.equal(findTermSection(rerendered, 'Halbjahr: 26/27 Q2').children[1].classList.contains('hidden'), false);
  const rerenderedPrevious = collectElements(rerendered, element =>
    element.classList && element.classList.contains('term-section') &&
    element.classList.contains('prev-term')
  )[0];
  assert.equal(rerenderedPrevious.children[1].classList.contains('hidden'), true);
});

test('next upper-secondary collapse is local, leaves flags and current section unchanged, and preserves inputs', async () => {
  const fixture = await createCollapsibleHalfYearFixture();
  const currentSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q1');
  const nextSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q2');
  const nextHeader = nextSection.children[0];
  const nextContent = nextSection.children[1];

  await nextHeader.dispatch('click');

  assert.equal(nextContent.classList.contains('hidden'), true);
  assert.equal(nextHeader.classList.contains('collapsed'), true);
  assert.equal(currentSection.children[1].classList.contains('hidden'), false);
  assert.equal(fixture.ctx.course._currCollapsed, undefined);
  assert.equal(fixture.ctx.course._prevCollapsed, undefined);
  assert.equal(fixture.saveCalls(), 0, 'presentation-only next collapse must not persist state');
  const rerendered = fixture.document.createElement('main');
  fixture.render(rerendered);
  assert.equal(
    findTermSection(rerendered, 'Halbjahr: 26/27 Q2').children[1].classList.contains('hidden'),
    false,
    'a full render must initialize the presentation-local next section open again'
  );

  await nextHeader.dispatch('click');

  assert.equal(nextContent.classList.contains('hidden'), false);
  assert.equal(nextHeader.classList.contains('collapsed'), false);
  assert.equal(fixture.saveCalls(), 0);
  const scoreInput = collectElements(nextSection, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2026-H2'
  )[0];
  const resultInput = collectElements(nextSection, element =>
    element.className === 'gradesheet-term-result-input'
  )[0];
  assert.equal(scoreInput.value, '10');
  assert.equal(scoreInput.disabled, false);
  assert.equal(resultInput.value, '8');
  assert.equal(resultInput.disabled, false);
});

test('split gradesheet marks current and archive sections and every editable grade cell semantically', async () => {
  const fixture = await createCollapsibleHalfYearFixture();
  const currentSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q1');
  const nextSection = findTermSection(fixture.container, 'Halbjahr: 26/27 Q2');
  const archiveSection = collectElements(fixture.container, element =>
    element.classList && element.classList.contains('term-section') &&
    element.classList.contains('prev-term')
  )[0];

  assert.equal(currentSection.classList.contains('term-section-current'), true);
  assert.equal(nextSection.classList.contains('term-section-current'), true);
  assert.equal(archiveSection.classList.contains('term-section-archive'), true);

  const scoreInputs = collectElements(fixture.container, element =>
    element.classList && element.classList.contains('gradesheet-input')
  );
  assert.ok(scoreInputs.length > 0);
  assert.ok(scoreInputs.every(input => input.closest('td').classList.contains('gradesheet-editor-cell')),
    'score and status focus must share the marked table cell');
  assert.ok(scoreInputs.every(input => input.closest('td').querySelectorAll('select.gradesheet-status').length === 1));

  const resultInputs = collectElements(fixture.container, element =>
    element.classList && element.classList.contains('gradesheet-term-result-input')
  );
  assert.ok(resultInputs.length > 0);
  assert.ok(resultInputs.every(input => input.closest('td').classList.contains('gradesheet-editor-cell')),
    'finalized term-result inputs must use the same focusable cell boundary');
});

test('combined Sek-I renderer marks H2, H1, and year summary boundaries in headers and rows', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1-Grenze', term: '2025-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2-Grenze', term: '2025-H2'
  });
  setScore(modules, h1, student.id, '2');
  setScore(modules, h2, student.id, '3');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const headersWith = className => collectElements(container, element =>
    element.tagName === 'th' && element.classList.contains(className)
  );
  assert.equal(headersWith('gradesheet-summary-current').length, 2,
    'current H2 category and total headers need the current-term boundary');
  assert.equal(headersWith('gradesheet-summary-previous').length, 2,
    'previous H1 category and total headers need the previous-term boundary');
  assert.deepEqual(headersWith('gradesheet-summary-current').map(header => header.textContent),
    ['Ø Schriftlich (25/26 H2)', 'Ø Gesamt (25/26 H2)'],
    'current category and total summaries must use the same teacher-facing term label');
  assert.deepEqual(headersWith('gradesheet-summary-previous').map(header => header.textContent),
    ['Ø Schriftlich (25/26 H1)', 'Ø Gesamt (25/26 H1)'],
    'previous category and total summaries must use the same teacher-facing term label');
  assert.deepEqual(headersWith('gradesheet-summary-year').map(header => header.textContent),
    ['Jahresgesamtnote (H1 + H2)']);

  const row = findStudentTermRow(container, student.id, 'all');
  assert.equal(row.querySelectorAll('td.gradesheet-summary-current').length, 2);
  assert.equal(row.querySelectorAll('td.gradesheet-summary-previous').length, 2);
  assert.equal(row.querySelectorAll('td.gradesheet-summary-year').length, 1);
  assert.ok(row.querySelectorAll('.gradesheet-input').every(input =>
    input.closest('td').classList.contains('gradesheet-editor-cell')),
  'the combined renderer must mark editable grade cells like the split renderer');
});

test('gradesheet keeps assessment management reachable outside compact table headers', async () => {
  const { modules, document, render } = loadGradesheetRenderer({
    window: {
      alert() {},
      confirm() { return false; }
    }
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Konzeptleistung',
    term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const management = findDetailsBySummary(container, 'Leistungen verwalten');
  assert.ok(management, 'die zentrale Leistungsverwaltung muss direkt erreichbar sein');
  assert.equal(management.open, false);
  assert.ok(findDetailsBySummary(management, 'Neue Leistung anlegen'),
    'das echte Anlageformular muss innerhalb der Leistungsverwaltung erhalten bleiben');
  const editButton = collectElements(management, element =>
    element.tagName === 'button' && element.title === 'Leistung bearbeiten'
  )[0];
  const deleteButton = collectElements(management, element =>
    element.tagName === 'button' && element.title === 'Leistung löschen'
  )[0];
  assert.ok(editButton);
  assert.ok(deleteButton);
  const tableHeaders = collectElements(container, element =>
    element.tagName === 'th' && element.classList.contains('gradesheet-assessment-header')
  );
  assert.ok(tableHeaders.length > 0);
  assert.equal(tableHeaders.some(header => collectElements(header, element =>
    element.classList && element.classList.contains('gradesheet-assessment-actions')
  ).length > 0), false, 'Tabellenköpfe dürfen nicht länger durch Bearbeitungsschalter verbreitert werden');

  // Der reale Löschhandler bleibt verbunden; Abbruch muss die Leistung unverändert lassen.
  await deleteButton.dispatch('click');
  assert.equal(modules.DomainModel.findAssessmentById(ctx.state, assessment.id), assessment);
});

test('name search filters existing rows only after all visible grade drafts finish cleanly', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 2 });
  Object.assign(ctx.students[0], { lastName: 'Adler', firstName: 'Anna' });
  Object.assign(ctx.students[1], { lastName: 'Berg', firstName: 'Ben' });
  addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2' });
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);

  const search = collectElements(container, element =>
    element.tagName === 'input' && element.attributes.get('aria-label') === 'Schüler in Notentabelle suchen'
  )[0];
  assert.ok(search);
  const mainRows = collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.term === 'all'
  );
  const originalRows = mainRows.slice();

  search.value = 'berg';
  await search.dispatch('input');

  assert.equal(originalRows[0].hidden, true);
  assert.equal(originalRows[1].hidden, false);
  assert.equal(collectElements(container, element => element === originalRows[1]).length, 1,
    'der Filter darf die Tabellenzeile nicht neu erzeugen');

  const invalidInput = collectElements(originalRows[1], element => element.className === 'gradesheet-input')[0];
  invalidInput.value = '99';
  search.value = 'adler';
  await search.dispatch('input');

  assert.equal(search.value, 'berg', 'ein ungültiger Entwurf muss die letzte sichere Suche erhalten');
  assert.equal(originalRows[0].hidden, true);
  assert.equal(originalRows[1].hidden, false, 'die Zeile mit ungültigem Fokus darf nicht verschwinden');
  assert.equal(invalidInput.attributes.get('aria-invalid'), 'true');
});

test('name search rechecks earlier editors after a later pending save before hiding rows', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 2 });
  Object.assign(ctx.students[0], { lastName: 'Adler', firstName: 'Anna' });
  Object.assign(ctx.students[1], { lastName: 'Berg', firstName: 'Ben' });
  addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2' });
  const pendingSave = deferred();
  modules.Storage.saveState = () => pendingSave.promise;
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);

  const search = collectElements(container, element =>
    element.attributes && element.attributes.get('aria-label') === 'Schüler in Notentabelle suchen'
  )[0];
  const mainRows = collectElements(container, element => element.tagName === 'tr' && element.dataset.term === 'all');
  const inputs = mainRows.map(row => collectElements(row, element => element.className === 'gradesheet-input')[0]);
  let focusedInput = null;
  for (const input of inputs) input.focus = () => { focusedInput = input; };
  inputs[1].value = '2';
  const save = inputs[1].dispatch('change');
  await Promise.resolve();
  search.value = 'berg';
  const filtering = search.dispatch('input');
  await Promise.resolve();
  inputs[0].value = '99';
  pendingSave.resolve();
  await save;
  await filtering;

  assert.equal(mainRows[0].hidden, false, 'der neue ungültige Entwurf darf nach dem Warten nicht verborgen werden');
  assert.equal(mainRows[1].hidden, false);
  assert.equal(search.value, '', 'die noch nicht sichere Suche muss verworfen werden');
  assert.equal(focusedInput, inputs[0]);
});

test('filtered grade and term-result navigation skips hidden student rows', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 3 });
  Object.assign(ctx.students[0], { lastName: 'Adler', firstName: 'Anna' });
  Object.assign(ctx.students[1], { lastName: 'Berg', firstName: 'Ben' });
  Object.assign(ctx.students[2], { lastName: 'Adler', firstName: 'Clara' });
  addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, term: '2025-H2' });
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);

  const search = collectElements(container, element =>
    element.attributes && element.attributes.get('aria-label') === 'Schüler in Notentabelle suchen'
  )[0];
  search.value = 'adler';
  await search.dispatch('input');
  const mainRows = collectElements(container, element => element.tagName === 'tr' && element.dataset.term === 'all');
  assert.deepEqual(mainRows.map(row => row.hidden), [false, false, true]);
  const gradeInputs = mainRows.map(row => collectElements(row, element => element.className === 'gradesheet-input')[0]);
  let focusedGradeInput = null;
  for (const gradeInput of gradeInputs) gradeInput.focus = () => { focusedGradeInput = gradeInput; };
  modules.sandbox.setTimeout = callback => { callback(); return 1; };
  gradeInputs[0].focus();
  await gradeInputs[0].dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(focusedGradeInput, gradeInputs[1], 'Pfeil ab muss die gefilterte Zwischenzeile überspringen');

  const upper = loadGradesheetRenderer({}, { dateImpl: fixedDateClass('2026-09-15') });
  const upperCtx = buildCourseState(upper.modules, { schemaMode: 'uppersec', studentCount: 3 });
  configureQ1Q2Course(upper.modules, upperCtx.course);
  Object.assign(upperCtx.students[0], { lastName: 'Adler', firstName: 'Anna' });
  Object.assign(upperCtx.students[1], { lastName: 'Berg', firstName: 'Ben' });
  Object.assign(upperCtx.students[2], { lastName: 'Adler', firstName: 'Clara' });
  upper.modules.Storage.saveState = async () => {};
  Object.assign(upper.modules.sandbox, { state: upperCtx.state, currentCourseId: upperCtx.course.id });
  const upperContainer = upper.document.createElement('main');
  upper.document.body.appendChild(upperContainer);
  upper.render(upperContainer);
  const upperSearch = collectElements(upperContainer, element =>
    element.attributes && element.attributes.get('aria-label') === 'Schüler in Notentabelle suchen'
  )[0];
  upperSearch.value = 'adler';
  await upperSearch.dispatch('input');
  const resultRows = collectElements(upperContainer, element => element.tagName === 'tr' &&
    collectElements(element, child => child.className === 'gradesheet-term-result-input').length === 1);
  assert.deepEqual(resultRows.map(row => row.hidden), [false, false, true]);
  const resultInputs = resultRows.map(row => collectElements(row, element => element.className === 'gradesheet-term-result-input')[0]);
  let focusedResultInput = null;
  for (const resultInput of resultInputs) resultInput.focus = () => { focusedResultInput = resultInput; };
  upper.modules.sandbox.setTimeout = callback => { callback(); return 1; };
  resultInputs[0].focus();
  await resultInputs[0].dispatch('keydown', { key: 'Enter' });
  assert.equal(focusedResultInput, resultInputs[1],
    'die Ergebnisnavigation muss dieselbe gefilterte Zwischenzeile überspringen');
});

test('main and term rows expose one entry-status disclosure and keep untouched blanks neutral', async () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Leerzustand',
    term: '2026-H1'
  });
  const previous = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Statuswert',
    term: '2025-H2'
  });
  previous.scores[ctx.students[0].id] = modules.DomainModel.createScoreEntry({
    status: modules.DomainModel.SCORE_STATUS.MISSING
  });
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);

  const renderedRows = collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.student === ctx.students[0].id
  );
  assert.ok(renderedRows.length >= 2, 'Haupt- und Halbjahrestabelle müssen denselben Statuszugang bieten');
  for (const row of renderedRows) {
    const studentName = `${ctx.students[0].lastName}, ${ctx.students[0].firstName}`;
    const disclosure = collectElements(row, element =>
      element.className === 'gradesheet-row-status' && collectElements(element, child =>
        child.tagName === 'summary' &&
        child.attributes.get('aria-label') === `Eintragstatus für ${studentName}`
      ).length === 1
    )[0];
    assert.ok(disclosure, `Statuszugang fehlt in ${row.dataset.term}`);
    assert.equal(disclosure.open, false);
  }

  const blankInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2026-H1'
  )[0];
  const blankCell = blankInput.closest('td');
  const blankIcon = collectElements(blankCell, element => element.classList &&
    element.classList.contains('gradesheet-status-icon'))[0];
  assert.equal(blankIcon.children[0].innerHTML || '', '', 'ein unberührtes Leerfeld darf keinen grünen Haken zeigen');
  assert.equal(blankCell.style.backgroundColor || '', '', 'ein unberührtes Leerfeld bleibt farbneutral');

  const missingInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2025-H2'
  )[0];
  const missingCell = missingInput.closest('td');
  assert.ok(collectElements(missingCell, element =>
    element.className === 'gradesheet-entry-state' && element.textContent === 'fehlt'
  ).length === 1, 'nicht numerische Zustände müssen direkt in der Zelle lesbar bleiben');
  const missingStatus = collectElements(missingCell, element => element.className === 'gradesheet-status')[0];
  missingStatus.value = modules.DomainModel.SCORE_STATUS.EXCUSED;
  await missingStatus.dispatch('change');
  assert.equal(confirmedAssessment(modules, previous.id).scores[ctx.students[0].id].status, modules.DomainModel.SCORE_STATUS.EXCUSED,
    'der bestehende Status-Speicherhandler muss am Disclosure-Steuerelement erhalten bleiben');
  assert.ok(collectElements(missingCell, element =>
    element.className === 'gradesheet-entry-state' && element.textContent === 'entschuldigt'
  ).length === 1);
});

test('editable gradesheet cells use the shared palette including the critical 4-minus boundary', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 2 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Palette',
    term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '1');
  setScore(modules, assessment, ctx.students[1].id, '4-');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);

  const cells = collectElements(container, element =>
    element.classList && element.classList.contains('gradesheet-editor-cell') &&
    collectElements(element, child => child.className === 'gradesheet-input' && child.dataset.gradesheetTerm === 'all').length
  );
  assert.equal(cells[0].style.backgroundColor, 'var(--grade-bg-best)');
  assert.equal(cells[1].style.backgroundColor, 'var(--grade-bg-critical)');
  const coloredInputs = collectElements(container, element => element.className === 'gradesheet-input');
  assert.ok(coloredInputs.length >= 2);
  for (const input of coloredInputs) {
    assert.equal(input.style.backgroundColor || '', input.closest('td').style.backgroundColor || '',
      'das gerundete Eingabefeld trägt dieselbe fachliche Farbe wie seine Zelle');
  }
  const key = collectElements(container, element => element.className === 'gradesheet-grade-key gradesheet-entry-grade-key')[0];
  assert.ok(key, 'die editierbare Tabelle braucht eine palette-gebundene Legende');
  assert.match(collectTextContent(key), /Bewertungsfarben.*kritisch/i);
});

test('compact gradesheet styles constrain editors, expand row status in flow, and keep dark errors legible', () => {
  const stylesheet = fs.readFileSync('src/styles/legacy.css', 'utf8');
  assert.match(stylesheet, /\.gradesheet-input-wrap\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*width:\s*100%/s);
  assert.match(stylesheet, /\.gradesheet-cell\s*\{[^}]*min-width:\s*0/s);
  const statusControl = stylesheet.match(/\.gradesheet-status-control\s*\{([^}]*)\}/s);
  assert.ok(statusControl);
  assert.doesNotMatch(statusControl[1], /position:\s*absolute/,
    'geöffnete Statusfelder müssen die Zeile vergrößern statt Folgezeilen zu überdecken');
  assert.match(statusControl[1], /width:\s*100%/);
  assert.match(stylesheet, /body\.theme-dark \.gradesheet-input-invalid\s*\{[^}]*color:\s*var\(--gradesheet-result-error-input\)/s);
});

test('Sek-I Jahresansicht zeigt beide Halbjahre, konfigurierte Kategorien und die gewichtete Jahresnote ohne Editoren', () => {
  const { modules, document, render } = loadGradesheetRenderer({ gradesheetView: 'year' }, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  ctx.state.settings.categories.forEach(category => { category.active = true; });
  ctx.state.settings.weightTemplates.push({
    id: 'annual-weighting',
    items: [
      { categoryId: ctx.categoryIds.oral, weightPercent: 50 },
      { categoryId: ctx.categoryIds.written, weightPercent: 30 },
      { categoryId: ctx.categoryIds.other, weightPercent: 20 }
    ]
  });
  ctx.course.weightTemplateId = 'annual-weighting';
  const h1Oral = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'H1 mündlich', term: '2026-H1' });
  const h1Written = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1 schriftlich', term: '2026-H1' });
  const h1Other = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.other, title: 'H1 sonstig', term: '2026-H1' });
  const h2Oral = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'H2 mündlich', term: '2026-H2' });
  const h2Written = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2 schriftlich', term: '2026-H2' });
  const h2Other = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.other, title: 'H2 sonstig', term: '2026-H2' });
  setScore(modules, h1Oral, student.id, '1');
  setScore(modules, h1Written, student.id, '4');
  setScore(modules, h1Other, student.id, '2');
  setScore(modules, h2Oral, student.id, '3');
  setScore(modules, h2Written, student.id, '2');
  setScore(modules, h2Other, student.id, '4');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id, gradesheetView: 'year' });
  const container = document.createElement('main');

  render(container);

  assert.match(collectTextContent(container), /Gesamtes Schuljahr/);
  assert.doesNotMatch(collectTextContent(container), /Trage die im Notenschema hinterlegten Noten ein/);
  assert.match(collectTextContent(container), /reine Auswertung/i);
  assert.deepEqual(collectElements(container, element => element.tagName === 'h2').map(element => element.textContent), ['Gesamtes Schuljahr']);
  assert.match(collectTextContent(container), /26\/27 H1/);
  assert.match(collectTextContent(container), /26\/27 H2/);
  assert.deepEqual(collectElements(container, element => element.className === 'gradesheet-annual-view-button').map(element => element.textContent), [
    'Noteneingabe', 'Gesamtes Schuljahr'
  ]);
  const panel = collectElements(container, element => element.className === 'gradesheet-annual-panel')[0];
  assert.ok(panel, 'die Jahresansicht braucht eine gerahmte Panelwurzel');
  assert.equal(collectElements(panel, element => element.className === 'gradesheet-annual-toolbar').length, 1);
  assert.deepEqual(collectElements(panel, element => element.textContent === 'Nur lesen').map(element => element.className), [
    'gradesheet-annual-readonly'
  ], 'der Nur-lesen-Hinweis darf nicht den blau fest codierten generischen Badge-Stil erben');
  assert.equal(collectElements(panel, element => element.className === 'gradesheet-grade-key').length, 1);
  const table = collectElements(panel, element => element.className === 'gradesheet-table gradesheet-annual-table')[0];
  const headerRows = collectElements(table, element => element.tagName === 'tr').slice(0, 2);
  assert.deepEqual(headerRows[0].children.map(header => header.textContent), [
    'Schüler', '26/27 H1', '26/27 H2', 'Jahr'
  ]);
  assert.deepEqual(headerRows[0].children.map(header => header.colSpan || 1), [1, 3, 3, 4]);
  assert.equal(headerRows[0].children[0].rowSpan, 2);
  assert.deepEqual(headerRows[1].children.map(header => header.textContent), [
    'Mündlich', 'Schriftlich', 'Sonstiges',
    'Mündlich', 'Schriftlich', 'Sonstiges',
    'Mündlich', 'Schriftlich', 'Sonstiges', 'Gesamt'
  ]);
  assert.deepEqual(headerRows[1].children
    .map((header, index) => header.classList.contains('gradesheet-annual-group-start') ? index : null)
    .filter(index => index !== null), [3, 6]);
  const row = findStudentTermRow(container, student.id, 'year');
  assert.deepEqual(row.children.map(readAnnualCellValue), [
    'Testperson1, Vorname1',
    '1,00', '4,00', '2,00',
    '3,00', '2,00', '4,00',
    '2,00', '3,00', '3,00', '2,50'
  ], '50:30:20 muss auf allen drei realen Kategorien den handberechneten Jahreswert 2,50 ergeben');
  const gradeBands = [
    'gradesheet-grade-color--best',
    'gradesheet-grade-color--good',
    'gradesheet-grade-color--middle',
    'gradesheet-grade-color--notice',
    'gradesheet-grade-color--critical'
  ];
  const annualValueCells = row.children.slice(1);
  const annualValueSurfaces = collectElements(row, element =>
    element.classList && element.classList.contains('gradesheet-annual-value')
  );
  assert.equal(annualValueSurfaces.length, 10,
    'jeder numerische Jahreswert braucht eine eigene gerundete Farbfläche');
  assert.ok(annualValueSurfaces.every(surface => gradeBands.some(band => surface.classList.contains(band))),
    'die bestehenden Notenfarbbänder gehören auf die inneren Wertflächen');
  assert.ok(annualValueCells.every(cell => gradeBands.every(band => !cell.classList.contains(band))),
    'Tabellenzellen einschließlich Leistungsanzahl müssen neutral bleiben');
  const firstDetail = collectElements(annualValueCells[0], element =>
    element.classList && element.classList.contains('gradesheet-annual-detail')
  )[0];
  assert.equal(firstDetail.parentNode, annualValueCells[0],
    'die Leistungsanzahl steht als Geschwisterelement außerhalb der Farbfläche');
  assert.equal(annualValueSurfaces[0].children.includes(firstDetail), false);
  assert.deepEqual(row.children
    .map((cell, index) => cell.classList.contains('gradesheet-annual-group-start') ? index : null)
    .filter(index => index !== null), [4, 7]);
  const detailTexts = collectElements(row, element => element.className === 'gradesheet-annual-detail')
    .map(element => element.textContent);
  assert.equal(detailTexts.filter(text => text === '1 berücksichtigte Leistung').length, 6);
  assert.equal(detailTexts.filter(text => text === '2 berücksichtigte Leistungen').length, 3);
  assert.equal(detailTexts.at(-1), '3 Kategorien gewichtet');
  assert.match(collectTextContent(panel), /Gewichtung: Mündlich 50 % · Schriftlich 30 % · Sonstiges 20 %/);
  assert.equal(collectElements(container, element => element.classList && element.classList.contains('gradesheet-input')).length, 0);
  assert.equal(collectElements(container, element => element.classList && element.classList.contains('gradesheet-status')).length, 0);
});

test('Sek-I Jahresdetails zählen nur Leistungen und Kategorien mit positiver Gewichtung', () => {
  const { modules, document, render } = loadGradesheetRenderer({ gradesheetView: 'year' }, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  ctx.state.settings.categories.forEach(category => { category.active = true; });
  ctx.state.settings.weightTemplates.push({
    id: 'annual-zero-weighting',
    items: [
      { categoryId: ctx.categoryIds.oral, weightPercent: 50 },
      { categoryId: ctx.categoryIds.written, weightPercent: 50 },
      { categoryId: ctx.categoryIds.other, weightPercent: 0 }
    ]
  });
  ctx.course.weightTemplateId = 'annual-zero-weighting';
  const oral = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Mündlich berücksichtigt', term: '2026-H1', weight: 1
  });
  const oralZero = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Mündlich Gewicht null', term: '2026-H1', weight: 0
  });
  const written = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Schriftlich berücksichtigt', term: '2026-H1', weight: 1
  });
  const other = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.other, title: 'Sonstiges mit Kategoriegewicht null', term: '2026-H1', weight: 1
  });
  setScore(modules, oral, student.id, '2');
  setScore(modules, oralZero, student.id, '6');
  setScore(modules, written, student.id, '4');
  setScore(modules, other, student.id, '1');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id, gradesheetView: 'year' });
  const container = document.createElement('main');

  render(container);

  const row = findStudentTermRow(container, student.id, 'year');
  assert.equal(readAnnualCellValue(row.children[1]), '2,00', 'eine gültige Leistung mit Gewicht 0 darf den Mittelwert nicht verändern');
  assert.equal(readAnnualCellValue(row.children.at(-1)), '3,00', 'eine Kategorie mit Gewicht 0 darf die Gesamtnote nicht verändern');
  assert.deepEqual(collectElements(row, element => element.className === 'gradesheet-annual-detail')
    .map(element => element.textContent), [
    '1 berücksichtigte Leistung', '1 berücksichtigte Leistung', '1 berücksichtigte Leistung',
    '0 berücksichtigte Leistungen', '0 berücksichtigte Leistungen', '0 berücksichtigte Leistungen',
    '1 berücksichtigte Leistung', '1 berücksichtigte Leistung', '1 berücksichtigte Leistung',
    '2 Kategorien gewichtet'
  ]);
  assert.match(collectTextContent(container), /Berücksichtigte Einzelbewertungen haben ein positives Gewicht/);
});

test('Sek-I Jahresansicht erklärt eine leere Einschreibung ohne Eingabeoberfläche', () => {
  const { modules, document, render } = loadGradesheetRenderer({ gradesheetView: 'year' }, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { studentCount: 0 });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id, gradesheetView: 'year' });
  const container = document.createElement('main');

  render(container);

  assert.match(collectTextContent(container), /noch keine eingeschriebenen Schüler/);
  assert.equal(findStudentTermRow(container, 'student-1', 'year'), undefined);
  assert.equal(collectElements(container, element => element.classList && element.classList.contains('gradesheet-input')).length, 0);
  assert.deepEqual(collectElements(container, element => element.className === 'gradesheet-annual-view-button').map(element => element.textContent), [
    'Noteneingabe', 'Gesamtes Schuljahr'
  ]);
});

test('Sek-I Jahresansicht kennzeichnet fehlende Leistungen und alle fehlenden Werte als Strich', () => {
  const { modules, document, render } = loadGradesheetRenderer({ gradesheetView: 'year' }, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id, gradesheetView: 'year' });
  const container = document.createElement('main');

  render(container);

  assert.match(collectTextContent(container), /Für dieses Schuljahr sind noch keine Leistungen angelegt/);
  const row = findStudentTermRow(container, student.id, 'year');
  assert.ok(row, 'die eingeschriebene Person bleibt auch ohne Leistungen in der Jahresansicht sichtbar');
  assert.ok(row.children.slice(1).every(cell => cell.textContent === '–'),
    'fehlende H1-, H2-, Jahreskategorie- und Gesamtwerte müssen einheitlich als Strich erscheinen');
  assert.equal(collectElements(container, element => element.classList && element.classList.contains('gradesheet-input')).length, 0);
});

test('Sek-II behält die Noteneingabe ohne Jahresansichtsregister', () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2027-03-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id, gradesheetView: 'entry' });
  const container = document.createElement('main');

  render(container);

  assert.deepEqual(collectElements(container, element => element.className === 'gradesheet-annual-view-button'), []);
  assert.equal(collectElements(container, element => element.tagName === 'h2')[0].textContent, 'Noteneingabe');
});

function renderMainScoreInputWithSaveSpy(key) {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: `Tastatur ${key}`,
    term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '5');
  let saveCalls = 0;
  modules.Storage.saveState = async () => { saveCalls += 1; };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const input = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const statusSelect = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-status'
  )[0];
  return { modules, ctx, assessment, input, statusSelect, saveCalls: () => saveCalls };
}

function renderSplitTermKeyboardFixture(column) {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-09-15')
  });
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const assessments = ['A', 'B'].map(title => {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `Tastatur ${title}`,
      date: '2026-09-15',
      term: '2026-H1'
    });
    setScore(modules, assessment, ctx.students[0].id, '10');
    return assessment;
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const input = collectElements(container, element =>
    element.className === 'gradesheet-input' &&
    element.dataset.gradesheetTerm === '2026-H1' &&
    element.dataset.gradesheetColumn === String(column)
  )[0];
  return { modules, ctx, assessment: assessments[column], input };
}

function createDashboardTransitionRecorder() {
  const editors = [];
  return {
    editors,
    register(editor) {
      editors.push(editor);
      return function unregister() {
        const index = editors.indexOf(editor);
        if (index >= 0) editors.splice(index, 1);
      };
    }
  };
}

function renderMainScoreEditorWithTransition() {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Abschlusseditor',
    term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '5');
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const transition = createDashboardTransitionRecorder();
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container, transition);
  const input = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const statusSelect = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-status'
  )[0];
  return { modules, ctx, assessment, input, statusSelect, transition };
}

test('combined Sek-I editor explains invalid values without saving them', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  let saves = 0;
  fixture.modules.Storage.saveState = async () => { saves += 1; };
  fixture.input.value = '99';

  await fixture.input.dispatch('change');

  const error = collectElements(fixture.input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(saves, 0);
  assert.equal(fixture.assessment.scores[fixture.ctx.students[0].id].valueRaw, '5');
  assert.match(error.textContent, /Nicht gespeichert.*1\+ bis 6/i);
  assert.equal(fixture.input.attributes.get('aria-invalid'), 'true');
  assert.equal(fixture.input.attributes.get('aria-describedby'), error.id);
});

test('split upper-secondary editor explains its whole-point range without saving invalid input', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Punkte', term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '10');
  let saves = 0;
  modules.Storage.saveState = async () => { saves += 1; };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const input = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2025-H2'
  )[0];
  input.value = '11,5';

  await input.dispatch('change');

  const error = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(saves, 0);
  assert.equal(assessment.scores[ctx.students[0].id].valueRaw, '10');
  assert.match(error.textContent, /Nicht gespeichert.*0 bis 15.*ganze/i);
  assert.equal(input.attributes.get('aria-invalid'), 'true');
  assert.equal(input.attributes.get('aria-describedby'), error.id);
});

test('custom grade mapping feedback lists only accepted labels and keeps a valid custom label usable', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  ctx.state.settings.gradeMapping = {
    ...ctx.state.settings.gradeMapping,
    Eigen: 2,
    '6+': 6.3,
    '6-': 5.7,
    OhneWert: null,
    Negativ: -1,
    Unendlich: Infinity
  };
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Eigenes Schema', term: '2025-H2'
  });
  let saves = 0;
  modules.Storage.saveState = async () => { saves += 1; };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const input = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  input.value = 'D';

  await input.dispatch('change');

  const error = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(saves, 0);
  assert.equal(assessment.scores[ctx.students[0].id], undefined);
  assert.match(error.textContent, /Nicht gespeichert.*Eigen/);
  for (const rejectedLabel of ['6+', '6-', 'OhneWert', 'Negativ', 'Unendlich']) {
    assert.doesNotMatch(error.textContent, new RegExp(rejectedLabel.replace(/[+]/g, '\\$&')));
  }

  input.value = 'Eigen';
  await input.dispatch('change');

  assert.equal(saves, 1);
  assert.equal(confirmedAssessment(modules, assessment.id).scores[ctx.students[0].id].valueRaw, 'Eigen');
});

test('dashboard finish wartet auf das bereits per change gestartete Speichern ohne Doppelaufruf', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const save = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  fixture.input.value = '1';

  const changed = fixture.input.dispatch('change');
  let changeSettled = false;
  changed.then(() => { changeSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saveCalls, 1);
  assert.equal(changeSettled, false, 'change darf vor der ausstehenden Persistenz nicht abschließen');
  assert.equal(fixture.transition.editors.length, 1, 'sichtbarer Editor muss am Übergang registriert sein');
  const finished = fixture.transition.editors[0].finish();
  let finishSettled = false;
  finished.then(() => { finishSettled = true; });
  await Promise.resolve();
  assert.equal(saveCalls, 1, 'finish muss das laufende Signatur-Promise teilen');
  assert.equal(finishSettled, false, 'finish darf vor der ausstehenden Persistenz nicht erfolgreich werden');
  save.resolve();
  await changed;
  assert.equal(await finished, true);
});

test('dashboard finish speichert eine während des eigenen laufenden Grade-Saves entstandene neue Eingabe', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const first = deferred();
  const second = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.findAssessmentById(
      candidate, fixture.assessment.id
    ).scores[fixture.ctx.students[0].id].valueRaw);
    return persistedValues.length === 1 ? first.promise : second.promise;
  };
  fixture.input.value = '3';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const finished = fixture.transition.editors[0].finish();
  fixture.input.value = '4';
  first.resolve();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(persistedValues, ['3', '4']);
  let finishSettled = false;
  finished.then(() => { finishSettled = true; });
  await Promise.resolve();
  assert.equal(finishSettled, false, 'der Abschluss muss auch den neueren Entwurf abwarten');
  second.resolve();
  assert.equal(await finished, true);
  assert.equal(confirmedScore(fixture).valueRaw, '4');
});

test('ein eigenständig ausgelöster neuer Grade-change speichert nach dem Fehler des älteren Changes', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const first = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.findAssessmentById(
      candidate, fixture.assessment.id
    ).scores[fixture.ctx.students[0].id].valueRaw);
    return persistedValues.length === 1 ? first.promise : Promise.resolve();
  };
  fixture.input.value = '3';
  const firstChange = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  fixture.input.value = '4';
  const secondChange = fixture.input.dispatch('change');

  first.reject(new Error('erster Save scheitert'));
  await firstChange;
  await secondChange;

  assert.deepEqual(persistedValues, ['3', '4']);
  assert.equal(confirmedScore(fixture).valueRaw, '4');
  assert.equal(fixture.input.value, '4');
  const error = collectElements(fixture.input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(error.style.display, 'none', 'der ältere Fehler darf den erfolgreich gespeicherten neuen Wert nicht markieren');
});

test('ein zweiter Grade-change desselben fehlgeschlagenen Werts löst keinen automatischen Retry aus', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const first = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => {
    saveCalls += 1;
    return saveCalls === 1 ? first.promise : Promise.resolve();
  };
  fixture.input.value = '3';
  const firstChange = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const duplicateChange = fixture.input.dispatch('change');

  first.reject(new Error('Save scheitert'));
  await firstChange;
  await duplicateChange;

  assert.equal(saveCalls, 1);
  assert.equal(confirmedScore(fixture).valueRaw, '5');
  assert.equal(fixture.input.value, '5');
  const error = collectElements(fixture.input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(error.style.display, 'block');
});

test('dashboard finish wartet vor der unveränderten Signatur und persistiert die Rückkehr zum Grade-Ausgangswert', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const first = deferred();
  const second = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.findAssessmentById(
      candidate, fixture.assessment.id
    ).scores[fixture.ctx.students[0].id].valueRaw);
    return persistedValues.length === 1 ? first.promise : second.promise;
  };
  fixture.input.value = '3';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  fixture.input.value = '5';
  const finished = fixture.transition.editors[0].finish();
  first.resolve();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(persistedValues, ['3', '5']);
  second.resolve();
  assert.equal(await finished, true);
  assert.equal(confirmedScore(fixture).valueRaw, '5');
});

test('dashboard finish blockiert ein zuvor verlassenes ungültiges Notenfeld ohne Speichern', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = async () => { saveCalls += 1; };
  fixture.input.value = '9';
  await fixture.input.dispatch('change');

  assert.equal(await fixture.transition.editors[0].finish(), false);
  assert.equal(saveCalls, 0);
  assert.equal(fixture.input.classList.contains('gradesheet-input-invalid'), true);
});

test('ein fehlgeschlagenes change stellt den Originalscore wieder her und blockiert den unmittelbaren Abschluss', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  fixture.modules.Storage.saveState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  fixture.input.value = '1';
  await fixture.input.dispatch('change');

  assert.equal(fixture.input.value, '5');
  assert.equal(await fixture.transition.editors[0].finish(), false);
  assert.equal(await fixture.transition.editors[0].finish(), true,
    'ein später bewusster Wechsel ohne offenen Entwurf darf weitergehen');
});

test('ein vom aktiven Grade-Abschluss beobachteter Speicherfehler wird nicht in den nächsten Klick getragen', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const save = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  fixture.input.value = '3';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const activeFinish = fixture.transition.editors[0].finish();
  save.reject(new Error('Speichern fehlgeschlagen'));
  await changed;

  assert.equal(await activeFinish, false);
  assert.equal(await fixture.transition.editors[0].finish(), true,
    'der bereits im aktiven Versuch beobachtete Fehler darf keinen zweiten bewussten Klick blockieren');
  assert.equal(saveCalls, 1);
});

test('dashboard finish wartet auch auf einen begonnenen Statuswechsel', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const save = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  fixture.statusSelect.value = fixture.modules.DomainModel.SCORE_STATUS.MISSING;

  const changed = fixture.statusSelect.dispatch('change');
  let changeSettled = false;
  changed.then(() => { changeSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  const finished = fixture.transition.editors[0].finish();
  let finishSettled = false;
  finished.then(() => { finishSettled = true; });
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  assert.equal(changeSettled, false, 'Statuswechsel darf vor der Persistenz nicht abschließen');
  assert.equal(finishSettled, false, 'Status-finish darf vor der Persistenz nicht abschließen');
  save.resolve();
  await changed;
  assert.equal(await finished, true);
  assert.equal(confirmedScore(fixture).status,
    fixture.modules.DomainModel.SCORE_STATUS.MISSING);
});

test('dashboard finish registriert und wartet auch den sichtbaren Oberstufen-Ergebniseditor ab', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildUpperSecTermResultState(modules);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const transition = createDashboardTransitionRecorder();
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container, transition);
  const input = collectElements(container, element => element.className === 'gradesheet-term-result-input')[0];
  const save = deferred();
  let saveCalls = 0;
  modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  input.value = '12';

  const changed = input.dispatch('change');
  let changeSettled = false;
  changed.then(() => { changeSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(transition.editors.length, 1, 'genau der sichtbare Ergebniseditor muss registriert sein');
  const editor = transition.editors[0];
  let focused = 0;
  input.focus = () => { focused += 1; };
  editor.focus();
  assert.equal(focused, 1, 'der registrierte Fokus muss das sichtbare Ergebniseingabefeld treffen');
  const finished = editor.finish();
  let finishSettled = false;
  finished.then(() => { finishSettled = true; });
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  assert.equal(changeSettled, false, 'Ergebnis-change darf vor der Persistenz nicht abschließen');
  assert.equal(finishSettled, false, 'Ergebnis-finish darf vor der Persistenz nicht abschließen');
  save.resolve();
  await changed;
  assert.equal(await finished, true);
});

function renderTermResultEditorWithTransition() {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 10);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const transition = createDashboardTransitionRecorder();
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container, transition);
  const input = collectElements(container, element => element.className === 'gradesheet-term-result-input')[0];
  return { modules, ctx, input, transition };
}

test('dashboard finish speichert einen während des eigenen laufenden Ergebnis-Saves entstandenen neuen Wert', async () => {
  const fixture = renderTermResultEditorWithTransition();
  const first = deferred();
  const second = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.getTermResult(
      fixture.modules.DomainModel.findCourseById(candidate, fixture.ctx.course.id),
      fixture.ctx.student.id,
      '2025-H1'
    ));
    return persistedValues.length === 1 ? first.promise : second.promise;
  };
  fixture.input.value = '11';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const finished = fixture.transition.editors[0].finish();
  fixture.input.value = '12';
  first.resolve();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(persistedValues, [11, 12]);
  second.resolve();
  assert.equal(await finished, true);
  assert.equal(fixture.modules.DomainModel.getTermResult(
    confirmedCourse(fixture.modules, fixture.ctx.course.id), fixture.ctx.student.id, '2025-H1'
  ), 12);
});

test('ein eigenständig ausgelöster neuer Ergebnis-change speichert nach dem Fehler des älteren Changes', async () => {
  const fixture = renderTermResultEditorWithTransition();
  const first = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.getTermResult(
      fixture.modules.DomainModel.findCourseById(candidate, fixture.ctx.course.id),
      fixture.ctx.student.id,
      '2025-H1'
    ));
    return persistedValues.length === 1 ? first.promise : Promise.resolve();
  };
  fixture.input.value = '11';
  const firstChange = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  fixture.input.value = '12';
  const secondChange = fixture.input.dispatch('change');

  first.reject(new Error('erster Save scheitert'));
  await firstChange;
  await secondChange;

  assert.deepEqual(persistedValues, [11, 12]);
  assert.equal(fixture.modules.DomainModel.getTermResult(
    confirmedCourse(fixture.modules, fixture.ctx.course.id), fixture.ctx.student.id, '2025-H1'
  ), 12);
  assert.equal(fixture.input.value, '12');
  assert.equal(fixture.input.classList.contains('gradesheet-input-invalid'), false);
});

test('ein zweiter Ergebnis-change desselben fehlgeschlagenen Werts löst keinen automatischen Retry aus', async () => {
  const fixture = renderTermResultEditorWithTransition();
  const first = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => {
    saveCalls += 1;
    return saveCalls === 1 ? first.promise : Promise.resolve();
  };
  fixture.input.value = '11';
  const firstChange = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const duplicateChange = fixture.input.dispatch('change');

  first.reject(new Error('Save scheitert'));
  await firstChange;
  await duplicateChange;

  assert.equal(saveCalls, 1);
  assert.equal(fixture.modules.DomainModel.getTermResult(
    confirmedCourse(fixture.modules, fixture.ctx.course.id), fixture.ctx.student.id, '2025-H1'
  ), 10);
  assert.equal(fixture.input.value, '10');
  assert.equal(fixture.input.classList.contains('gradesheet-input-invalid'), false);
  assert.equal(fixture.input.attributes.get('aria-invalid'), 'false');
});

test('dashboard finish wartet vor der unveränderten Ergebnis-Signatur und persistiert den Ausgangswert erneut', async () => {
  const fixture = renderTermResultEditorWithTransition();
  const first = deferred();
  const second = deferred();
  const persistedValues = [];
  fixture.modules.Storage.saveState = candidate => {
    persistedValues.push(fixture.modules.DomainModel.getTermResult(
      fixture.modules.DomainModel.findCourseById(candidate, fixture.ctx.course.id),
      fixture.ctx.student.id,
      '2025-H1'
    ));
    return persistedValues.length === 1 ? first.promise : second.promise;
  };
  fixture.input.value = '11';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  fixture.input.value = '10';
  const finished = fixture.transition.editors[0].finish();
  first.resolve();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(persistedValues, [11, 10]);
  second.resolve();
  assert.equal(await finished, true);
});

test('ein Ergebnisfehler vor dem Abschluss blockiert genau einen bewussten Klick', async () => {
  const fixture = renderTermResultEditorWithTransition();
  fixture.modules.Storage.saveState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  fixture.input.value = '11';
  await fixture.input.dispatch('change');

  assert.equal(await fixture.transition.editors[0].finish(), false);
  assert.equal(await fixture.transition.editors[0].finish(), true);
});

test('ein vom aktiven Ergebnis-Abschluss beobachteter Fehler blockiert den nächsten Klick nicht erneut', async () => {
  const fixture = renderTermResultEditorWithTransition();
  const save = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  fixture.input.value = '11';
  const changed = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const activeFinish = fixture.transition.editors[0].finish();
  save.reject(new Error('Speichern fehlgeschlagen'));
  await changed;

  assert.equal(await activeFinish, false);
  assert.equal(await fixture.transition.editors[0].finish(), true);
  assert.equal(saveCalls, 1);
});

test('ein späteres Ergebnis eines alten Speicherns überschreibt keinen neueren sichtbaren Entwurf', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  const first = deferred();
  const second = deferred();
  let saves = 0;
  fixture.modules.Storage.saveState = () => {
    saves += 1;
    return saves === 1 ? first.promise : second.promise;
  };
  fixture.input.value = '1';
  const firstChange = fixture.input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  fixture.input.value = '2';
  const secondChange = fixture.input.dispatch('change');
  first.resolve();
  await firstChange;
  assert.equal(fixture.input.value, '2');
  second.resolve();
  await secondChange;
  assert.equal(fixture.input.value, '2');
});

test('eine erfolgreich korrigierte Eingabe entfernt den alten Validierungstitel', async () => {
  const fixture = renderMainScoreEditorWithTransition();
  fixture.modules.Storage.saveState = async () => {};
  fixture.input.value = '9';
  await fixture.input.dispatch('change');
  assert.equal(fixture.input.title, 'Ungültiger Wert für dieses Bewertungsschema');

  fixture.input.value = '1';
  await fixture.input.dispatch('change');
  assert.equal(fixture.input.title, '');
});

function loadTermResultEditor() {
  const modules = loadModules();
  const document = createEditorDocumentStub();
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'createSerializedTransactionQueue')}\n` +
    `${extractFunction(lines, 'createLatestInteractionGuard')}\n` +
    `${extractFunction(lines, 'parseTermResultInput')}\n` +
    `${extractFunction(lines, 'createTermResultInput')}\n` +
    `${extractFunction(lines, 'persistTermResultWithRollback')}\n` +
    'const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();\n' +
    'let gradesheetErrorSequence = 0;\n' +
    `${extractFunction(lines, 'appendTermResultEditor')}\n` +
    'globalThis.__termResultEditor = appendTermResultEditor;';
  modules.sandbox.document = document;
  modules.sandbox.dashboardTransition = null;
  vm.runInContext(source, modules.sandbox, { filename: 'appendTermResultEditor.js' });
  return { modules, document, editor: modules.sandbox.__termResultEditor };
}

function findFirstInput(element) {
  if (element.tagName === 'input') return element;
  for (const child of element.children || []) {
    const input = findFirstInput(child);
    if (input) return input;
  }
  return null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadQ4UiHelpers() {
  const modules = loadModules();
  const lines = readSourceLines();
  try {
    const source = `${extractFunction(lines, 'canManageWrittenExamSubjectQ4')}\n` +
      `${extractFunction(lines, 'isAssessmentNotScheduledForStudent')}\n` +
      `${extractFunction(lines, 'listExistingQ4WrittenScoresForStudent')}\n` +
      `${extractFunction(lines, 'applyWrittenExamSubjectQ4Change')}\n` +
      `${extractFunction(lines, 'findNextGradesheetInput')}\n` +
      'globalThis.__q4Ui = { canManageWrittenExamSubjectQ4, isAssessmentNotScheduledForStudent, ' +
      'listExistingQ4WrittenScoresForStudent, applyWrittenExamSubjectQ4Change, findNextGradesheetInput };';
    vm.runInContext(source, modules.sandbox, { filename: 'q4-ui.js' });
    return { modules, helpers: modules.sandbox.__q4Ui, loadError: null };
  } catch (error) {
    return { modules, helpers: null, loadError: error };
  }
}

function buildQ4BasicCourse(modules) {
  const { DomainModel } = modules;
  const state = DomainModel.ensureStateShape({});
  const course = DomainModel.createCourse({
    id: 'course_q4_basic',
    name: 'Biologie GK Q3/Q4',
    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    schoolYearStartYear: 2025,
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4
    },
    weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  });
  const student = DomainModel.createStudent({ id: 'stu_q4', lastName: 'Test', firstName: 'Ada' });
  state.courses.push(course);
  state.students.push(student);
  DomainModel.enrollStudentInCourse(state, course.id, student.id, null);
  const oneExamTemplate = state.settings.weightTemplates.find(template =>
    template.id === DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  const writtenItem = oneExamTemplate.items.find(item => Math.abs(item.weightPercent - 33.33) < 0.001);
  const generalItem = oneExamTemplate.items.find(item => item.categoryId !== writtenItem.categoryId);
  const written = DomainModel.createAssessment({
    id: 'asm_q4_written', courseId: course.id, categoryId: writtenItem.categoryId,
    title: 'Q4-Klausur', term: '2025-H2'
  });
  const general = DomainModel.createAssessment({
    id: 'asm_q4_general', courseId: course.id, categoryId: generalItem.categoryId,
    title: 'Allgemeiner Teil', term: '2025-H2'
  });
  state.assessments.push(written, general);
  return { state, course, student, written, general };
}

test('M32: a failed term-result save restores the exact previous list', async () => {
  const { modules, helper, commitStateChange } = loadTermResultPersistenceHelper();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 10);
  modules.sandbox.state = ctx.state;
  modules.sandbox.persistState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  await assert.rejects(
    helper(ctx.course.id, ctx.student.id, '2025-H1', 12, commitStateChange),
    /Speichern fehlgeschlagen/
  );
  const confirmedCourse = modules.DomainModel.findCourseById(modules.sandbox.state, ctx.course.id);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H1'), 10);
});

test('M32 review: a failed save rolls back only the affected student and term', async () => {
  const { modules, helper, commitStateChange } = loadTermResultPersistenceHelper();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 10);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H2', 8);
  modules.sandbox.state = ctx.state;
  const pending = deferred();
  modules.sandbox.persistState = () => pending.promise;

  const saving = helper(ctx.course.id, ctx.student.id, '2025-H1', 12, commitStateChange);
  await new Promise(resolve => setImmediate(resolve));
  modules.DomainModel.setTermResult(modules.sandbox.state, ctx.course.id, ctx.student.id, '2025-H2', 9);
  pending.reject(new Error('Speichern fehlgeschlagen'));

  await assert.rejects(saving, /Speichern fehlgeschlagen/);
  const confirmedCourse = modules.DomainModel.findCourseById(modules.sandbox.state, ctx.course.id);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H1'), 10);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H2'), 9);
});

test('M32 re-review: a failed pending save cannot restore a result after person deletion', async () => {
  const { modules, helper, commitStateChange } = loadTermResultPersistenceHelper();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 10);
  modules.sandbox.state = ctx.state;
  const pending = deferred();
  modules.sandbox.persistState = () => pending.promise;

  const saving = helper(ctx.course.id, ctx.student.id, '2025-H1', 12, commitStateChange);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(modules.DomainModel.removeStudentFromState(modules.sandbox.state, ctx.student.id), true);
  pending.reject(new Error('Speichern fehlgeschlagen'));

  await assert.rejects(saving, /Speichern fehlgeschlagen/);
  assert.equal(modules.DomainModel.findStudentById(modules.sandbox.state, ctx.student.id), null);
  const confirmedCourse = modules.DomainModel.findCourseById(modules.sandbox.state, ctx.course.id);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H1'), null);
});

test('M32 re-review: a failed pending save cannot overwrite a newer same-term result', async () => {
  const { modules, helper, commitStateChange } = loadTermResultPersistenceHelper();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 10);
  modules.sandbox.state = ctx.state;
  const pending = deferred();
  modules.sandbox.persistState = () => pending.promise;

  const saving = helper(ctx.course.id, ctx.student.id, '2025-H1', 12, commitStateChange);
  await new Promise(resolve => setImmediate(resolve));
  modules.DomainModel.setTermResult(modules.sandbox.state, ctx.course.id, ctx.student.id, '2025-H1', 9);
  pending.reject(new Error('Speichern fehlgeschlagen'));

  await assert.rejects(saving, /Speichern fehlgeschlagen/);
  const confirmedCourse = modules.DomainModel.findCourseById(modules.sandbox.state, ctx.course.id);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H1'), 9);
});

test('M32: queued set and clear execute in invocation order', async () => {
  const { modules, helper, commitStateChange } = loadTermResultPersistenceHelper();
  const ctx = buildUpperSecTermResultState(modules);
  modules.sandbox.state = ctx.state;
  const first = deferred();
  const order = [];
  modules.sandbox.persistState = candidate => {
    const course = modules.DomainModel.findCourseById(candidate, ctx.course.id);
    const points = modules.DomainModel.getTermResult(course, ctx.student.id, '2025-H1');
    order.push(points === null ? 'clear' : 'set');
    return order.length === 1 ? first.promise : Promise.resolve();
  };
  const setting = helper(ctx.course.id, ctx.student.id, '2025-H1', 12, commitStateChange);
  const clearing = helper(ctx.course.id, ctx.student.id, '2025-H1', null, commitStateChange);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['set']);
  first.resolve();
  await setting;
  await clearing;
  assert.deepEqual(order, ['set', 'clear']);
  const confirmedCourse = modules.DomainModel.findCourseById(modules.sandbox.state, ctx.course.id);
  assert.equal(modules.DomainModel.getTermResult(confirmedCourse, ctx.student.id, '2025-H1'), null);
});

function createScorePersistenceFixture(initialScores = {}) {
  const { modules, helper, commitStateChange } = loadGradesheetHelper('persistScoreEntryWithRollback');
  const ctx = buildCourseState(modules, { studentCount: 2 });
  const assessment = addAssessment(modules, ctx, {
    id: 'asm-score-persistence',
    categoryId: ctx.categoryIds.written,
    title: 'Persistenztest',
    term: '2025-H2'
  });
  assessment.scores = JSON.parse(JSON.stringify(initialScores));
  modules.sandbox.state = ctx.state;
  return { modules, helper, commitStateChange, ctx, assessment };
}

test('K4: a failed gradesheet save restores an existing score', async () => {
  const fixture = createScorePersistenceFixture({
    [ 'student_0' ]: { status: 'valid', valueRaw: '2', valueNumeric: 2 }
  });
  const studentId = fixture.ctx.students[0].id;
  fixture.assessment.scores[studentId] = fixture.assessment.scores.student_0;
  delete fixture.assessment.scores.student_0;
  fixture.modules.sandbox.persistState = async () => { throw new Error('Speicherkontingent erschoepft'); };

  await assert.rejects(
    fixture.helper(
      fixture.assessment.id,
      studentId,
      { status: 'valid', valueRaw: '5', valueNumeric: 5 },
      fixture.commitStateChange
    ),
    /Speicherkontingent/
  );

  const confirmed = fixture.modules.DomainModel.findAssessmentById(fixture.modules.sandbox.state, fixture.assessment.id);
  assert.deepEqual(
    JSON.parse(JSON.stringify(confirmed.scores[studentId])),
    { status: 'valid', valueRaw: '2', valueNumeric: 2 }
  );
});

test('K4: a failed first gradesheet save removes the unsaved score', async () => {
  const fixture = createScorePersistenceFixture();
  const studentId = fixture.ctx.students[0].id;
  fixture.modules.sandbox.persistState = async () => { throw new Error('Kein Sitzungspasswort'); };

  await assert.rejects(
    fixture.helper(
      fixture.assessment.id,
      studentId,
      { status: 'valid', valueRaw: '3', valueNumeric: 3 },
      fixture.commitStateChange
    ),
    /Sitzungspasswort/
  );

  const confirmed = fixture.modules.DomainModel.findAssessmentById(fixture.modules.sandbox.state, fixture.assessment.id);
  assert.equal(Object.hasOwn(confirmed.scores, studentId), false);
});

test('K4: a successful gradesheet save keeps the new score', async () => {
  const fixture = createScorePersistenceFixture();
  const studentId = fixture.ctx.students[0].id;
  let observedRaw = null;
  fixture.modules.sandbox.persistState = async candidate => {
    observedRaw = fixture.modules.DomainModel.findAssessmentById(candidate, fixture.assessment.id).scores[studentId].valueRaw;
  };

  const saved = await fixture.helper(
    fixture.assessment.id,
    studentId,
    { status: 'valid', valueRaw: '1-', valueNumeric: 1.3 },
    fixture.commitStateChange
  );

  assert.equal(observedRaw, '1-');
  const confirmed = fixture.modules.DomainModel.findAssessmentById(fixture.modules.sandbox.state, fixture.assessment.id);
  assert.equal(saved, confirmed.scores[studentId]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(saved)),
    { status: 'valid', valueRaw: '1-', valueNumeric: 1.3 }
  );
});

test('K4: a later same-cell edit survives an earlier failed save', async () => {
  const fixture = createScorePersistenceFixture();
  const studentId = fixture.ctx.students[0].id;
  fixture.assessment.scores[studentId] = { status: 'valid', valueRaw: '2', valueNumeric: 2 };
  const firstSave = deferred();
  const secondSave = deferred();
  let secondStarted = false;
  let persistenceCalls = 0;
  fixture.modules.sandbox.persistState = () => {
    persistenceCalls += 1;
    if (persistenceCalls === 1) return firstSave.promise;
    secondStarted = true;
    return secondSave.promise;
  };

  const firstResult = assert.rejects(
    fixture.helper(
      fixture.assessment.id,
      studentId,
      { status: 'valid', valueRaw: '4', valueNumeric: 4 },
      fixture.commitStateChange
    ),
    /erster Save fehlgeschlagen/
  );
  const secondResult = fixture.helper(
    fixture.assessment.id,
    studentId,
    { status: 'valid', valueRaw: '1', valueNumeric: 1 },
    fixture.commitStateChange
  );

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondStarted, false, 'der zweite Save startete vor Abschluss des ersten');
  firstSave.reject(new Error('erster Save fehlgeschlagen'));
  await firstResult;
  await Promise.resolve();
  assert.equal(secondStarted, true);
  assert.equal(fixture.modules.DomainModel.findAssessmentById(
    fixture.modules.sandbox.state, fixture.assessment.id
  ).scores[studentId].valueRaw, '2', 'the second candidate is not published before persistence');
  secondSave.resolve();
  await secondResult;
  assert.equal(fixture.modules.DomainModel.findAssessmentById(
    fixture.modules.sandbox.state, fixture.assessment.id
  ).scores[studentId].valueRaw, '1');
});

test('K4: edits in different cells are persisted in invocation order', async () => {
  const fixture = createScorePersistenceFixture();
  const [firstStudent, secondStudent] = fixture.ctx.students;
  fixture.assessment.scores[firstStudent.id] = { status: 'valid', valueRaw: '2', valueNumeric: 2 };
  fixture.assessment.scores[secondStudent.id] = { status: 'valid', valueRaw: '3', valueNumeric: 3 };
  const firstSave = deferred();
  const secondSave = deferred();
  const order = [];
  fixture.modules.sandbox.persistState = () => {
    const label = order.length === 0 ? 'first' : 'second';
    order.push(label);
    return label === 'first' ? firstSave.promise : secondSave.promise;
  };

  const firstResult = fixture.helper(
    fixture.assessment.id,
    firstStudent.id,
    { status: 'valid', valueRaw: '4', valueNumeric: 4 },
    fixture.commitStateChange
  );
  const secondResult = fixture.helper(
    fixture.assessment.id,
    secondStudent.id,
    { status: 'valid', valueRaw: '1', valueNumeric: 1 },
    fixture.commitStateChange
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first']);
  assert.equal(fixture.modules.DomainModel.findAssessmentById(
    fixture.modules.sandbox.state, fixture.assessment.id
  ).scores[secondStudent.id].valueRaw, '3', 'zweite Zelle wurde vorzeitig mutiert');
  firstSave.resolve();
  await firstResult;
  await Promise.resolve();
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(fixture.modules.DomainModel.findAssessmentById(
    fixture.modules.sandbox.state, fixture.assessment.id
  ).scores[secondStudent.id].valueRaw, '3', 'second candidate remains unpublished while its save is held');
  secondSave.resolve();
  await secondResult;
  assert.equal(fixture.modules.DomainModel.findAssessmentById(
    fixture.modules.sandbox.state, fixture.assessment.id
  ).scores[secondStudent.id].valueRaw, '1');
});

test('H14: a failed assessment deletion restores the exact state and reports the error', async () => {
  const alerts = [];
  const { modules, document, render } = loadGradesheetRenderer({
    window: {
      confirm() { return true; },
      alert(message) { alerts.push(String(message)); }
    },
    persistState() { throw new Error('Verschlüsseltes Speichern fehlgeschlagen'); }
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Zu erhaltende Leistung',
    term: '2025-H2'
  });
  const before = JSON.stringify(ctx.state);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const deleteButton = collectElements(container, element => element.title === 'Leistung löschen')[0];
  assert.ok(deleteButton, 'the rendered assessment needs its delete control');

  await assert.doesNotReject(deleteButton.dispatch('click'));

  assert.equal(JSON.stringify(ctx.state), before, 'der fehlgeschlagene Löschvorgang veränderte den Zustand');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /nicht gelöscht|Speichern fehlgeschlagen/i);
});

test('H14: a successful assessment deletion waits for persistence before completing', async () => {
  const save = deferred();
  let clickCompleted = false;
  let persistedCandidate = null;
  const { modules, document, render } = loadGradesheetRenderer({
    window: { confirm() { return true; }, alert() {} },
    persistState(candidate) {
      persistedCandidate = candidate;
      return save.promise;
    }
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Erfolgreich zu löschen',
    term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const deleteButton = collectElements(container, element => element.title === 'Leistung löschen')[0];

  const click = deleteButton.dispatch('click').then(() => { clickCompleted = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clickCompleted, false, 'der Klick meldete Abschluss vor dem verschlüsselten Speichern');
  assert.equal(
    ctx.state.assessments.some(item => item.id === assessment.id),
    true,
    'der Live-Zustand darf die noch nicht gespeicherte Löschung nicht veröffentlichen'
  );
  assert.equal(persistedCandidate.assessments.some(item => item.id === assessment.id), false);

  save.resolve();
  await click;
});

test('H14 review: a render during failed deletion still sees the assessment', async () => {
  let renderDuringSave = null;
  const { modules, document, render } = loadGradesheetRenderer({
    window: { confirm() { return true; }, alert() {} },
    persistState() {
      renderDuringSave();
      throw new Error('Speichern fehlgeschlagen');
    }
  });
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Sichtbar bleiben', term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  renderDuringSave = () => render(container);
  render(container);
  const deleteButton = collectElements(container, element => element.title === 'Leistung löschen')[0];

  await deleteButton.dispatch('click');

  assert.equal(ctx.state.assessments.some(item => item.id === assessment.id), true);
  assert.ok(
    collectElements(container, element => element.title === 'Leistung löschen').length > 0,
    'ein konkurrierendes Rendern darf die ungespeicherte Löschung nicht anzeigen'
  );
});

test('H14 review: a failed first deletion cannot contaminate a succeeding second deletion', async () => {
  const persistedCandidates = [];
  let modulesRef = null;
  const { modules, document, render } = loadGradesheetRenderer({
    window: { confirm() { return true; }, alert() {} },
    async persistState(candidate) {
      persistedCandidates.push(candidate);
      if (persistedCandidates.length === 1) throw new Error('erste Speicherung fehlgeschlagen');
    }
  });
  modulesRef = modules;
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const first = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'A Leistung', term: '2025-H2'
  });
  const second = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'B Leistung', term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const deleteButtons = collectElements(container, element => element.title === 'Leistung löschen');

  await Promise.all([deleteButtons[0].dispatch('click'), deleteButtons[1].dispatch('click')]);

  assert.equal(persistedCandidates.length, 2);
  const initialIds = [first.id, second.id];
  const firstRemovedId = initialIds.find(id => !persistedCandidates[0].assessments.some(item => item.id === id));
  const secondRemovedId = initialIds.find(id => !persistedCandidates[1].assessments.some(item => item.id === id));
  assert.notEqual(firstRemovedId, secondRemovedId, 'beide Klicks müssen verschiedene Leistungen betreffen');
  assert.deepEqual(
    JSON.parse(JSON.stringify(modules.sandbox.state.assessments.map(item => item.id))),
    [firstRemovedId],
    'die fehlgeschlagene erste Löschung bleibt erhalten, nur die zweite wird veröffentlicht'
  );
});

test('H14: consecutive assessment deletions serialize their persistence attempts', async () => {
  const firstSave = deferred();
  const secondSave = deferred();
  const persistenceOrder = [];
  let modulesRef = null;
  const { modules, document, render } = loadGradesheetRenderer({
    window: { confirm() { return true; }, alert() {} },
    persistState(candidate) {
      const call = persistenceOrder.length;
      persistenceOrder.push(call === 0 ? 'first' : 'second');
      const save = call === 0 ? firstSave.promise : secondSave.promise;
      return save;
    }
  });
  modulesRef = modules;
  const ctx = buildCourseState(modules, { studentCount: 1 });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'A Leistung', term: '2025-H2'
  });
  addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'B Leistung', term: '2025-H2'
  });
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const deleteButtons = collectElements(container, element => element.title === 'Leistung löschen');

  const firstClick = deleteButtons[0].dispatch('click');
  const secondClick = deleteButtons[1].dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(persistenceOrder, ['first']);

  firstSave.resolve();
  await firstClick;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(persistenceOrder, ['first', 'second']);
  secondSave.resolve();
  await secondClick;
  assert.equal(modules.sandbox.state.assessments.length, 0);
});

for (const { key, column } of [
  { key: 'Enter', column: 1 },
  { key: 'Tab', column: 0 }
]) {
  test(`split term ${key} explicitly awaits score persistence`, async () => {
    const fixture = renderSplitTermKeyboardFixture(column);
    const save = deferred();
    let saveCalls = 0;
    let persistedRaw = null;
    fixture.modules.Storage.saveState = state => {
      saveCalls += 1;
      persistedRaw = state.assessments
        .find(assessment => assessment.id === fixture.assessment.id)
        .scores[fixture.ctx.students[0].id].valueRaw;
      return save.promise;
    };
    fixture.input.value = '11';

    let eventSettled = false;
    const event = fixture.input.dispatch('keydown', { key }).then(() => { eventSettled = true; });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(saveCalls, 1, `${key} must invoke the split renderer's existing score persistence path`);
    assert.equal(persistedRaw, '11');
    assert.equal(eventSettled, false, `${key} must not complete before encrypted persistence`);
    save.resolve();
    await event;
    assert.equal(confirmedScore(fixture).valueRaw, '11');
  });
}

test('K4: keydown, input change and status change await the real shared persistence path', async () => {
  const cases = [
    {
      begin(fixture) {
        fixture.input.value = '1';
        return fixture.input.dispatch('keydown', { key: 'Enter' });
      }
    },
    {
      begin(fixture) {
        fixture.input.value = '1';
        return fixture.input.dispatch('keydown', { key: 'Tab' });
      }
    },
    {
      begin(fixture) {
        fixture.input.value = '1';
        return fixture.input.dispatch('change');
      }
    },
    {
      begin(fixture) {
        fixture.statusSelect.value = fixture.modules.DomainModel.SCORE_STATUS.MISSING;
        return fixture.statusSelect.dispatch('change');
      }
    }
  ];
  for (const { begin } of cases) {
    const fixture = renderMainScoreInputWithSaveSpy('Enter');
    const save = deferred();
    let saveCalls = 0;
    fixture.modules.Storage.saveState = () => { saveCalls += 1; return save.promise; };
    const event = begin(fixture);
    let eventSettled = false;
    event.then(() => { eventSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saveCalls, 1);
    assert.equal(eventSettled, false, 'der reale Ereignishandler darf vor der Persistenz nicht abschließen');
    save.resolve();
    await event;
  }
});

test('K4: only the latest overlapping cell interaction may update visible feedback', () => {
  const { helper: createLatestInteractionGuard } = loadGradesheetHelper('createLatestInteractionGuard');
  const beginInteraction = createLatestInteractionGuard();
  const firstIsLatest = beginInteraction();
  const secondIsLatest = beginInteraction();

  assert.equal(firstIsLatest(), false, 'an older completion must not overwrite newer UI state');
  assert.equal(secondIsLatest(), true, 'the newest completion may update the UI');
});

for (const key of ['Enter', 'Tab']) {
  test(`M20: ${key} plus its identical change persists the score once`, async () => {
    const fixture = renderMainScoreInputWithSaveSpy(key);
    fixture.input.value = '1';
    await fixture.input.dispatch('keydown', { key });
    await fixture.input.dispatch('change');
    assert.equal(fixture.saveCalls(), 1);
    assert.equal(confirmedScore(fixture).valueRaw, '1');
  });
}

test('M20: a later different change is not suppressed', async () => {
  const fixture = renderMainScoreInputWithSaveSpy('Enter');
  fixture.input.value = '1';
  await fixture.input.dispatch('keydown', { key: 'Enter' });
  await fixture.input.dispatch('change');
  fixture.input.value = '2';
  await fixture.input.dispatch('change');
  assert.equal(fixture.saveCalls(), 2);
  assert.equal(confirmedScore(fixture).valueRaw, '2');
});

test('M20: a failed keyboard save does not poison later keyboard deduplication', async () => {
  const fixture = renderMainScoreInputWithSaveSpy('Enter');
  let calls = 0;
  fixture.modules.Storage.saveState = async () => {
    calls += 1;
    if (calls === 1) throw new Error('Speichern fehlgeschlagen');
  };
  fixture.input.value = '1';
  await fixture.input.dispatch('keydown', { key: 'Enter' });
  assert.equal(fixture.input.value, '5', 'der fehlgeschlagene Save muss zurueckrollen');
  fixture.input.value = '2';
  await fixture.input.dispatch('change');
  assert.equal(calls, 2);
  assert.equal(confirmedScore(fixture).valueRaw, '2');
});

test('M20: a status change prevents suppression of the same raw value', async () => {
  for (const key of ['Enter', 'Tab']) {
    const fixture = renderMainScoreInputWithSaveSpy(key);
    fixture.input.value = '1';
    await fixture.input.dispatch('keydown', { key });
    fixture.statusSelect.value = fixture.modules.DomainModel.SCORE_STATUS.MISSING;
    await fixture.input.dispatch('change');
    assert.equal(fixture.saveCalls(), 2, `${key}: der Statuswechsel muss den Change speichern`);
    assert.equal(
      confirmedScore(fixture).status,
      fixture.modules.DomainModel.SCORE_STATUS.MISSING
    );
  }
});

test('M20: unchanged identical follow-up changes are not persisted again', async () => {
  for (const key of ['Enter', 'Tab']) {
    const fixture = renderMainScoreInputWithSaveSpy(key);
    fixture.input.value = '1';
    await fixture.input.dispatch('keydown', { key });
    await fixture.input.dispatch('change');
    await fixture.input.dispatch('change');
    assert.equal(fixture.saveCalls(), 1, `${key}: unveränderte Signaturen dürfen nicht erneut speichern`);
    assert.equal(confirmedScore(fixture).valueRaw, '1');
  }
});

test('M19: assessment create and edit use the shared candidate commit without a direct duplicate save', () => {
  const section = extractFunction(readSourceLines(), 'renderGradesheetSection');
  const editStart = section.indexOf('await commitStateChange(function (candidate)');
  const editEnd = section.indexOf('const cancelBtn', editStart);
  const editCommit = section.slice(editStart, editEnd);
  assert.doesNotMatch(editCommit, /Storage\.saveState\(state\)/);
  assert.match(editCommit, /requireAssessment\(candidate, assessmentId\)/);
  assert.match(editCommit, /requireActiveCourse\(candidate, candidateAssessment\.courseId\)/);

  const createStart = section.indexOf('const courseId = course.id;');
  const createEnd = section.indexOf('newAsmBox.appendChild(formRow)', createStart);
  const createCommit = section.slice(createStart, createEnd);
  assert.doesNotMatch(createCommit, /Storage\.saveState\(state\)/);
  assert.match(createCommit, /await commitStateChange\(function \(candidate\)/);
  assert.match(createCommit, /requireActiveCourse\(candidate, courseId\)/);
  assert.match(createCommit, /DomainModel\.addAssessmentToState\(candidate, created\)/);
});

test('M24: editing the previous-term table refreshes the matching combined-row averages', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const previous = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1-Leistung', term: '2025-H1'
  });
  const current = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2-Leistung', term: '2025-H2'
  });
  setScore(modules, previous, student.id, '5');
  setScore(modules, current, student.id, '5');
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);

  const combinedRow = collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.term === 'all' && element.dataset.student === student.id
  )[0];
  assert.ok(combinedRow, 'die Hauptzeile muss für gezielte Aktualisierungen adressierbar sein');
  assert.equal(
    document.querySelector(`tr[data-student="${student.id}"][data-term="all"]`),
    combinedRow,
    'der reale Selektor muss genau die Hauptzeile finden'
  );
  const before = combinedRow.querySelectorAll('td.gradesheet-avg').map(cell => cell.textContent);
  const previousTermInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === '2025-H1'
  )[0];
  assert.ok(previousTermInput, 'die echte H1-Archivtabelle muss gerendert sein');

  previousTermInput.value = '1';
  await previousTermInput.dispatch('change');
  assert.equal(confirmedAssessment(modules, previous.id).scores[student.id].valueRaw, '1',
    'die echte Archivtabelle muss den State gespeichert haben');

  const after = combinedRow.querySelectorAll('td.gradesheet-avg').map(cell => cell.textContent);
  assert.notDeepEqual(after, before,
    `Hauptdurchschnitte dürfen nach der H1-Eingabe nicht veraltet bleiben: ${JSON.stringify({ before, after })}`);
  assert.ok(after.includes('1.00'), 'der aktualisierte aktuelle Durchschnitt muss in der Hauptzeile erscheinen');
  assert.ok(after.includes('5.00'), 'der unveränderte Vorjahreswert muss erhalten bleiben');
});

test('M25: saving a main-table score refreshes that cell from poor red to the new grade color', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Farbwechsel', term: '2025-H2'
  });
  setScore(modules, assessment, student.id, '5');
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const mainInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const scoreCell = mainInput.closest('td');
  assert.equal(scoreCell.style.backgroundColor, 'var(--grade-bg-critical)');

  mainInput.value = '1';
  await mainInput.dispatch('change');

  assert.notEqual(scoreCell.style.backgroundColor, 'var(--grade-bg-critical)');
  assert.notEqual(scoreCell.style.backgroundColor, '', 'die gültige neue Note muss ihre neue Skalenfarbe erhalten');
});

test('M25: changing a score status clears the stale grade color', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Statuswechsel', term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '5');
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const mainInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const scoreCell = mainInput.closest('td');
  const statusSelect = collectElements(scoreCell, element => element.className === 'gradesheet-status')[0];
  assert.equal(scoreCell.style.backgroundColor, 'var(--grade-bg-critical)');

  statusSelect.value = modules.DomainModel.SCORE_STATUS.MISSING;
  await statusSelect.dispatch('change');

  assert.equal(scoreCell.style.backgroundColor, '');
  assert.equal(confirmedAssessment(modules, assessment.id).scores[ctx.students[0].id].status,
    modules.DomainModel.SCORE_STATUS.MISSING);
  assert.equal(mainInput.style.backgroundColor || '', '', 'fehlt entfernt auch die Farbe des Eingabefelds');
});

test('M25: a failed score save restores both the old value and its color', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Rollback-Farbe', term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '5');
  modules.Storage.saveState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const mainInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const scoreCell = mainInput.closest('td');

  mainInput.value = '1';
  await mainInput.dispatch('change');

  assert.equal(mainInput.value, '5');
  assert.equal(assessment.scores[ctx.students[0].id].valueRaw, '5');
  assert.equal(scoreCell.style.backgroundColor, 'var(--grade-bg-critical)');
});

test('M25: Enter persistence repaints the current score cell', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Tastatur-Farbe', term: '2025-H2'
  });
  setScore(modules, assessment, ctx.students[0].id, '5');
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const mainInput = collectElements(container, element =>
    element.className === 'gradesheet-input' && element.dataset.gradesheetTerm === 'all'
  )[0];
  const scoreCell = mainInput.closest('td');

  mainInput.value = '1';
  await mainInput.dispatch('keydown', { key: 'Enter' });

  assert.equal(confirmedAssessment(modules, assessment.id).scores[ctx.students[0].id].valueRaw, '1');
  assert.notEqual(scoreCell.style.backgroundColor, 'var(--grade-bg-critical)');
  assert.notEqual(scoreCell.style.backgroundColor, '');
});

test('M32: term-result input accepts blank and exact whole points only', () => {
  const parse = loadSimpleGradesheetHelper('parseTermResultInput');
  assert.equal(parse(''), null);
  assert.equal(parse('  '), null);
  assert.equal(parse('0'), 0);
  assert.equal(parse('15'), 15);
  for (const raw of ['-1', '16', '11.5', '11,5', '+11', '11x']) {
    assert.throws(() => parse(raw), /0 bis 15/);
  }
});

test('M32: browser-sanitized invalid term-result input cannot clear an existing result', async () => {
  const { modules, editor } = loadTermResultEditor();
  const ctx = buildUpperSecTermResultState(modules);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H1', 12);
  modules.sandbox.state = ctx.state;
  modules.sandbox.course = ctx.course;
  let persistenceWrites = 0;
  modules.Storage.saveState = async () => { persistenceWrites += 1; };

  const row = { children: [], appendChild(child) { this.children.push(child); return child; } };
  editor(row, ctx.student, '2025-H1');
  const input = findFirstInput(row);
  input.value = '';
  input.validity = { badInput: true };
  await input.dispatch('change');

  assert.equal(persistenceWrites, 0);
  assert.equal(modules.DomainModel.getTermResult(ctx.course, ctx.student.id, '2025-H1'), 12);
  assert.equal(input.classList.contains('gradesheet-input-invalid'), true);
});

test('M32: the real gradesheet wires exact-term result editors through persistence', () => {
  const section = extractFunction(readSourceLines(), 'renderGradesheetSection');
  assert.match(section, /Rechenwert/);
  assert.match(section, /Festgesetzt/);
  assert.match(section, /DomainModel\.getTermResult\(course,\s*stu\.id,/);
  assert.match(section, /await persistTermResultWithRollback\(/);
  assert.match(section, /commitStateChange/);
  assert.match(section, /course\.archivedAt/);
  assert.match(section, /parseTermResultInput/);
  assert.doesNotMatch(section, /Festgesetzt \(gesamt\)/);
});

test('M32 final review: an active upper-sec course with no assessments still renders its exact-term editor', () => {
  const { modules, render } = loadGradesheetRenderer();
  const ctx = buildUpperSecTermResultState(modules);
  const currentTerm = '2025-H2';
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, currentTerm, 12);
  Object.assign(modules.sandbox, {
    state: ctx.state,
    currentCourseId: ctx.course.id
  });
  const container = modules.sandbox.document.createElement('main');

  render(container);

  const resultInputs = collectElements(container, element => element.className === 'gradesheet-term-result-input');
  assert.equal(resultInputs.length, 1, 'the finalized-only term must remain editable without assessments');
  assert.equal(resultInputs[0].value, '12');
  assert.equal(resultInputs[0].disabled, false);
});

test('upper-secondary result validation associates only the active error and preserves saved zero versus blank', async () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-03-15')
  });
  const ctx = buildUpperSecTermResultState(modules);
  configureQ1Q2Course(modules, ctx.course);
  let saves = 0;
  modules.Storage.saveState = async () => { saves += 1; };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const input = collectElements(container, element =>
    element.className === 'gradesheet-term-result-input'
  )[0];
  const guide = collectElements(container, element =>
    element.className === 'gradesheet-result-guide'
  )[0];
  const error = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  assert.equal(input.attributes.get('aria-describedby'), guide.id);
  assert.equal(input.attributes.get('aria-invalid'), 'false');

  input.value = '11.5';
  await input.dispatch('change');

  assert.equal(saves, 0);
  assert.equal(input.attributes.get('aria-invalid'), 'true');
  assert.deepEqual(input.attributes.get('aria-describedby').split(' '), [guide.id, error.id]);
  assert.match(error.textContent, /ganze Punktzahl von 0 bis 15/i);

  input.value = '0';
  await input.dispatch('change');

  assert.equal(modules.DomainModel.getTermResult(
    confirmedCourse(modules, ctx.course.id), ctx.student.id, '2025-H2'
  ), 0);
  assert.equal(input.value, '0');
  assert.equal(input.attributes.get('aria-invalid'), 'false');
  assert.equal(input.attributes.get('aria-describedby'), guide.id);
  assert.equal(error.style.display, 'none');

  input.value = '';
  await input.dispatch('change');

  assert.equal(modules.DomainModel.getTermResult(
    confirmedCourse(modules, ctx.course.id), ctx.student.id, '2025-H2'
  ), null);
  assert.equal(input.value, '');
  assert.equal(saves, 2);
});

test('upper-secondary result save failures stay described without marking the restored input invalid', async () => {
  const { modules, document, render } = loadGradesheetRenderer({}, {
    dateImpl: fixedDateClass('2026-03-15')
  });
  const ctx = buildUpperSecTermResultState(modules);
  configureQ1Q2Course(modules, ctx.course);
  modules.DomainModel.setTermResult(ctx.state, ctx.course.id, ctx.student.id, '2025-H2', 10);
  modules.Storage.saveState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');

  render(container);

  const input = collectElements(container, element =>
    element.className === 'gradesheet-term-result-input'
  )[0];
  const guide = collectElements(container, element =>
    element.className === 'gradesheet-result-guide'
  )[0];
  const error = collectElements(input.closest('td'), element =>
    element.className === 'gradesheet-input-error'
  )[0];
  input.value = '11';
  await input.dispatch('change');

  assert.equal(input.value, '10');
  assert.equal(input.attributes.get('aria-invalid'), 'false');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), false);
  assert.deepEqual(input.attributes.get('aria-describedby').split(' '), [guide.id, error.id]);
  assert.match(error.textContent, /Speichern fehlgeschlagen/i);
});

test('M31: the Q4 written-exam control is available only for active Q3/Q4 basic courses', () => {
  const { modules, helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { course } = buildQ4BasicCourse(modules);
  assert.equal(helpers.canManageWrittenExamSubjectQ4(course), true);
  assert.equal(helpers.canManageWrittenExamSubjectQ4({ ...course, archivedAt: '2026-07-01T00:00:00Z' }), false);
  assert.equal(helpers.canManageWrittenExamSubjectQ4({
    ...course, upperSecContext: { ...course.upperSecContext, courseType: 'advanced' }
  }), false);
  assert.equal(helpers.canManageWrittenExamSubjectQ4({
    ...course, upperSecContext: { ...course.upperSecContext, qualificationYear: 'q1-q2' }
  }), false);
});

test('M31: only an unmarked Q4 written assessment is not scheduled for the student', () => {
  const { modules, helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { state, course, student, written, general } = buildQ4BasicCourse(modules);

  assert.equal(helpers.isAssessmentNotScheduledForStudent(course, written, student.id, state.settings), true);
  assert.equal(helpers.isAssessmentNotScheduledForStudent(course, general, student.id, state.settings), false);
  assert.equal(helpers.isAssessmentNotScheduledForStudent(course, { ...written, term: '2025-H1' }, student.id, state.settings), false);
  modules.DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);
  assert.equal(helpers.isAssessmentNotScheduledForStudent(course, written, student.id, state.settings), false);
});

test('M31: unmarking preserves an existing Q4 written score and reports the conflict', async () => {
  const { modules, helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { state, course, student, written } = buildQ4BasicCourse(modules);
  modules.DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);
  written.scores[student.id] = { status: 'valid', valueRaw: '12', valueNumeric: 12 };

  const conflicts = helpers.listExistingQ4WrittenScoresForStudent(
    state, course, student.id, state.settings
  );
  assert.deepEqual(Array.from(conflicts, assessment => assessment.title), ['Q4-Klausur']);

  const candidate = JSON.parse(JSON.stringify(state));
  helpers.applyWrittenExamSubjectQ4Change(candidate, course.id, student.id, false);
  assert.equal(modules.DomainModel.findEnrollment(course, student.id).writtenExamSubjectQ4, true);
  const candidateCourse = modules.DomainModel.findCourseById(candidate, course.id);
  assert.equal(modules.DomainModel.findEnrollment(candidateCourse, student.id).writtenExamSubjectQ4, false);
  const candidateAssessment = modules.DomainModel.findAssessmentById(candidate, written.id);
  assert.equal(candidateAssessment.scores[student.id].valueRaw, '12');
});

test('M31: a failed Q4 flag save leaves the live enrollment unchanged', async () => {
  const { modules, helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const { state, course, student } = buildQ4BasicCourse(modules);
  modules.sandbox.state = state;
  modules.sandbox.persistState = async () => { throw new Error('Speichern fehlgeschlagen'); };
  const { commitStateChange } = installCommitHarness(modules);
  const before = JSON.stringify(state);
  await assert.rejects(
    commitStateChange(candidate => {
      helpers.applyWrittenExamSubjectQ4Change(candidate, course.id, student.id, true);
    }),
    /Speichern fehlgeschlagen/
  );
  assert.equal(JSON.stringify(modules.sandbox.state), before);
});

test('M31: keyboard navigation skips a locked gradesheet cell in the same column', () => {
  const { helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const inputs = [
    { dataset: { gradesheetRow: '0', gradesheetColumn: '0' } },
    { dataset: { gradesheetRow: '0', gradesheetColumn: '1' } },
    { dataset: { gradesheetRow: '1', gradesheetColumn: '1' } },
    { dataset: { gradesheetRow: '2', gradesheetColumn: '0' } },
    { dataset: { gradesheetRow: '2', gradesheetColumn: '1' } }
  ];
  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[0], 'Tab'), inputs[1]);
  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[0], 'Enter'), inputs[3]);
  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[3], 'ArrowUp'), inputs[0]);
  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[4], 'ArrowDown'), null);
});

test('M31: keyboard navigation skips inputs in rows hidden by the name filter', () => {
  const { helpers, loadError } = loadQ4UiHelpers();
  assert.ok(helpers, loadError && loadError.message);
  const rows = [{ hidden: false }, { hidden: true }, { hidden: false }];
  const inputs = rows.map((row, index) => ({
    dataset: { gradesheetRow: String(index), gradesheetColumn: '0', gradesheetTerm: 'all' },
    parentNode: row
  }));
  rows.forEach(row => { row.parentNode = null; });

  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[0], 'ArrowDown'), inputs[2]);
  assert.equal(helpers.findNextGradesheetInput(inputs, inputs[0], 'Tab'), inputs[2]);
});

test('M31: the real Q4 gradesheet replaces only an unmarked written cell with not scheduled', () => {
  const { modules, render } = loadGradesheetRenderer();
  const ctx = buildQ4BasicCourse(modules);
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = modules.sandbox.document.createElement('main');

  render(container);
  const locked = collectElements(container, element => element.className === 'gradesheet-not-scheduled');
  const inputs = collectElements(container, element => element.className === 'gradesheet-input');
  assert.equal(locked.length, 1);
  assert.equal(locked[0].textContent, 'nicht vorgesehen');
  assert.equal(inputs.length, 1, 'the general assessment must remain editable');

  ctx.written.scores[ctx.student.id] = { status: 'valid', valueRaw: '12', valueNumeric: 12 };
  const withConflict = modules.sandbox.document.createElement('main');
  render(withConflict);
  const conflict = collectElements(
    withConflict,
    element => element.className === 'gradesheet-not-scheduled-conflict'
  );
  assert.equal(conflict.length, 1);
  assert.match(conflict[0].textContent, /Vorhandener Wert: 12/);
  assert.equal(ctx.written.scores[ctx.student.id].valueRaw, '12');

  modules.DomainModel.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.student.id, true);
  const marked = modules.sandbox.document.createElement('main');
  render(marked);
  assert.equal(collectElements(marked, element => element.className === 'gradesheet-not-scheduled').length, 0);
  assert.equal(collectElements(marked, element => element.className === 'gradesheet-input').length, 2);
});

test('Task 8 characterization: a full synthetic rerender keeps the Sek-I H2 annual value and label', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const h1 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H1', term: '2025-H1' });
  const h2 = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'H2', term: '2025-H2' });
  setScore(modules, h1, student.id, '1');
  setScore(modules, h2, student.id, '5');
  Object.assign(modules.sandbox, {
    state: ctx.state,
    currentCourseId: ctx.course.id,
    deriveTermFromDateValue: () => '2025-H2'
  });

  const before = document.createElement('main');
  render(before);
  const beforeAnnualRow = collectElements(before, element => element.tagName === 'tr' && collectElements(element, child => child.textContent === `${student.lastName}, ${student.firstName}`).length > 0)[0];
  const beforeAnnualCell = beforeAnnualRow.querySelectorAll('td.gradesheet-summary-year')[0];
  assert.match(collectElements(before, element => element.textContent === 'Jahresgesamtnote (H1 + H2)').map(element => element.textContent).join(' '), /Jahresgesamtnote/);
  assert.equal(beforeAnnualCell.textContent, '3.00');

  h2.scores[student.id] = modules.DomainModel.createScoreEntry({ valueRaw: '3' });
  const after = document.createElement('main');
  render(after);
  const afterAnnualRow = collectElements(after, element => element.tagName === 'tr' && collectElements(element, child => child.textContent === `${student.lastName}, ${student.firstName}`).length > 0)[0];
  const afterAnnualCell = afterAnnualRow.querySelectorAll('td.gradesheet-summary-year')[0];
  assert.equal(afterAnnualCell.textContent, '2.00');
});

test('N1: a September-to-December assessment without term stays in its school-term live average', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const student = ctx.students[0];
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Datierte H1-Leistung',
    date: '2025-10-15',
    term: null
  });
  setScore(modules, assessment, student.id, '4');
  const realResolveAssessmentTerm = modules.GradingLogic.resolveAssessmentTermFromDateValue;
  const liveResolveCalls = [];
  modules.GradingLogic.resolveAssessmentTermFromDateValue = (date, course, settings) => {
    liveResolveCalls.push({ date: date.toISOString().slice(0, 10), course, settings });
    return realResolveAssessmentTerm(date, course, settings);
  };
  Object.assign(modules.sandbox, {
    state: ctx.state,
    currentCourseId: ctx.course.id,
    deriveTermFromDateValue: (date, course) =>
      realResolveAssessmentTerm(date, course, ctx.state.settings)
  });
  modules.Storage.saveState = async () => {};
  const container = document.createElement('main');
  render(container);

  assert.equal(assessment.term, null, 'Regression braucht eine Leistung ohne gespeichertes term');
  const termRow = collectElements(container, element =>
    element.tagName === 'tr' && element.dataset.term === '2025-H1'
  )[0];
  assert.ok(termRow, 'die zentrale Schuljahreslogik muss Oktober 2025 dem H1 2025/26 zuordnen');
  const averages = termRow.querySelectorAll('td.gradesheet-avg');
  assert.equal(averages.at(-1).textContent, '4.00');

  const input = termRow.querySelectorAll('.gradesheet-input')[0];
  assert.ok(input, 'die datierte Leistung muss im H1 editierbar sein');
  input.value = '2';
  await input.dispatch('change');

  assert.equal(averages.at(-1).textContent, '2.00');
  assert.ok(liveResolveCalls.some(call =>
    call.date === '2025-10-15' &&
    call.course === ctx.course &&
    call.settings === ctx.state.settings
  ), 'die zentrale Termauflösung muss die Leistung mit Kurseinstellungen auswerten');
});

async function openStoredTrendGradesheet(rawOnly = false) {
  const modules = loadModules();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const studentId = ctx.students[0].id;
  for (const [index, raw] of ['4', '2'].entries()) {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `Trend ${index}`,
      date: `2025-03-${10 + index}`,
      term: '2025-H2'
    });
    assessment.scores[studentId] = {
      status: modules.DomainModel.SCORE_STATUS.VALID,
      valueRaw: raw,
      valueNumeric: rawOnly ? null : Number(raw)
    };
  }
  const app = await loadDashboardUi({
    state: ctx.state,
    dateImpl: fixedDateClass('2026-03-15')
  });
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', ctx.course.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const row = app.root.querySelectorAll('tr').find(item =>
    item.dataset.student === studentId && item.dataset.term === 'all');
  assert.ok(row, 'combined trend row is visible');
  return { app, ctx, row, studentId, trendCell: row.querySelectorAll('td').at(-1) };
}

test('T01: loaded raw-only valid grades 4 and 2 show improvement with average 3.00', async () => {
  const fixture = await openStoredTrendGradesheet(true);
  assert.match(fixture.row.textContent, /3\.00/);
  assert.equal(fixture.trendCell.textContent, '↗️');
  assert.match(fixture.trendCell.title, /Verbesserung/);
  const stored = await fixture.app.Storage.loadCurrentSessionState();
  assert.equal(stored.assessments[0].scores[fixture.studentId].valueRaw, '4');
  assert.equal(stored.assessments[1].scores[fixture.studentId].valueRaw, '2');
});

test('T02: a saved 4/2 to 4/5 input reverses the visible trend and persists grade 5', async () => {
  const fixture = await openStoredTrendGradesheet();
  assert.equal(fixture.trendCell.textContent, '↗️');
  const input = fixture.row.querySelectorAll('.gradesheet-input')[1];
  input.value = '5';
  await input.dispatch('change');
  assert.match(fixture.row.textContent, /4\.50/);
  assert.equal(fixture.trendCell.textContent, '↘️');
  assert.match(fixture.trendCell.title, /Verschlechterung/);
  assert.equal(fixture.trendCell.style.color, '#c62828');
  assert.equal(fixture.trendCell.classList.contains('text-muted'), false);
  const stored = await fixture.app.Storage.loadCurrentSessionState();
  assert.equal(stored.assessments[1].scores[fixture.studentId].valueRaw, '5');
});

function renderTrendGradeFixture({ firstTerm = '2025-H2' } = {}) {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  const studentId = ctx.students[0].id;
  const assessments = ['4', '2'].map((raw, index) => {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `Trend ${index}`,
      date: `2025-03-${10 + index}`,
      term: index === 0 ? firstTerm : '2025-H2'
    });
    setScore(modules, assessment, studentId, raw);
    assessment.scores[studentId].valueNumeric = Number(raw);
    return assessment;
  });
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  document.body.appendChild(container);
  render(container);
  const row = collectElements(container, item => item.tagName === 'tr' &&
    item.dataset.student === studentId && item.dataset.term === 'all')[0];
  assert.ok(row);
  return { modules, document, container, row, ctx, assessments, studentId,
    trendCell: row.querySelectorAll('td').at(-1) };
}

test('T03: a saved H1 edit reverses the trend in the existing H2 combined row', async () => {
  const fixture = renderTrendGradeFixture({ firstTerm: '2025-H1' });
  assert.equal(fixture.trendCell.textContent, '↗️');
  const h1Row = collectElements(fixture.container, item => item.tagName === 'tr' &&
    item.dataset.student === fixture.studentId && item.dataset.term === '2025-H1')[0];
  assert.ok(h1Row);
  const input = h1Row.querySelectorAll('.gradesheet-input')[0];
  input.value = '1';
  await input.dispatch('change');
  assert.equal(confirmedAssessment(fixture.modules, fixture.assessments[0].id)
    .scores[fixture.studentId].valueRaw, '1');
  assert.equal(fixture.trendCell.textContent, '↘️');
  assert.match(fixture.trendCell.title, /Verschlechterung/);
});

test('T04: valid raw-only Sek-II zero participates in point trend and visible term average', () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  configureQ1Q2Course(modules, ctx.course);
  const studentId = ctx.students[0].id;
  const assessments = ['0', '5'].map((raw, index) => {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `Punkte ${index}`,
      date: '2026-03-10',
      term: '2025-H2'
    });
    assessment.scores[studentId] = {
      status: modules.DomainModel.SCORE_STATUS.VALID,
      valueRaw: raw,
      valueNumeric: null
    };
    return assessment;
  });
  Object.assign(modules.sandbox, {
    state: ctx.state,
    currentCourseId: ctx.course.id,
    course: ctx.course,
    mainAssessments: assessments
  });
  vm.runInContext(`${extractFunction(readSourceLines(), 'computeTrend')}\n` +
    'globalThis.__computeTrend = computeTrend;', modules.sandbox);
  assert.equal(modules.sandbox.__computeTrend(studentId), 'up',
    'equal-date order retains 0 then 5, with larger points improving');
  Object.assign(assessments[0].scores[studentId], { valueRaw: '5', valueNumeric: null });
  Object.assign(assessments[1].scores[studentId], { valueRaw: '0', valueNumeric: null });
  assert.equal(modules.sandbox.__computeTrend(studentId), 'down');
  Object.assign(assessments[0].scores[studentId], { valueRaw: '0', valueNumeric: null });
  assert.equal(modules.sandbox.__computeTrend(studentId), 'stable',
    'a zero difference stays below the existing 0.3 threshold');
  Object.assign(assessments[1].scores[studentId], { valueRaw: '5', valueNumeric: null });

  const container = document.createElement('main');
  render(container);
  const row = collectElements(container, item => item.tagName === 'tr' &&
    item.dataset.student === studentId && item.dataset.term === '2025-H2')[0];
  assert.ok(row, 'Sek-II term row is visible');
  assert.equal(row.querySelectorAll('.gradesheet-input')[0].value, '0');
  const averages = row.querySelectorAll('td.gradesheet-avg').map(cell => cell.textContent);
  assert.ok(averages.includes('2.50'), `the visible term average includes zero: ${JSON.stringify(averages)}`);
});

test('T04: a visible grade trend stays stable below the unchanged 0.3 threshold', async () => {
  const { modules, document, render } = loadGradesheetRenderer();
  const ctx = buildCourseState(modules, { studentCount: 1 });
  ctx.state.settings.gradeMapping['4-'] = 4.2;
  const studentId = ctx.students[0].id;
  for (const raw of ['4', '4-']) {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      date: '2025-03-10', term: '2025-H2'
    });
    setScore(modules, assessment, studentId, raw);
  }
  modules.Storage.saveState = async () => {};
  Object.assign(modules.sandbox, { state: ctx.state, currentCourseId: ctx.course.id });
  const container = document.createElement('main');
  render(container);
  const row = collectElements(container, item => item.tagName === 'tr' &&
    item.dataset.student === studentId && item.dataset.term === 'all')[0];
  const trend = row.querySelectorAll('td').at(-1);
  assert.equal(trend.textContent, '↔️');
  assert.equal(trend.title, 'Stabil: keine signifikante Änderung');
  assert.equal(trend.style.color, '#757575');
  const input = row.querySelectorAll('.gradesheet-input')[1];
  input.value = '5';
  await input.dispatch('change');
  assert.equal(trend.textContent, '↘️');
  assert.match(trend.title, /Verschlechterung/);
});

for (const scenario of [
  { label: 'cleared', change(input) { input.value = ''; return input.dispatch('change'); }, status: 'valid' },
  { label: 'missing', change(_input, select) { select.value = 'missing'; return select.dispatch('change'); }, status: 'missing' },
  { label: 'excused', change(_input, select) { select.value = 'excused'; return select.dispatch('change'); }, status: 'excused' }
]) {
  test(`T05: ${scenario.label} score leaves one valid grade and removes the visible trend`, async () => {
    const fixture = renderTrendGradeFixture();
    assert.equal(fixture.trendCell.textContent, '↗️');
    const input = fixture.row.querySelectorAll('.gradesheet-input')[1];
    const select = input.closest('td').querySelectorAll('.gradesheet-status')[0];
    await scenario.change(input, select);
    const score = confirmedAssessment(fixture.modules, fixture.assessments[1].id)
      .scores[fixture.studentId];
    assert.equal(score.status, scenario.status);
    if (scenario.label === 'cleared') assert.equal(score.valueRaw, null);
    assert.equal(fixture.trendCell.textContent, '–');
    assert.equal(fixture.trendCell.title, 'Zu wenig Daten für Trendanalyse');
    assert.equal(fixture.trendCell.style.color, '');
    assert.equal(fixture.trendCell.classList.contains('text-muted'), true);
    if (scenario.label === 'cleared') {
      input.value = '5';
      await input.dispatch('change');
      assert.equal(fixture.trendCell.textContent, '↘️');
      assert.match(fixture.trendCell.title, /Verschlechterung/);
      assert.equal(fixture.trendCell.style.color, '#c62828');
      assert.equal(fixture.trendCell.classList.contains('text-muted'), false);
    }
  });
}

test('T06: failed and pending saves keep the confirmed trend, then a retry updates it', async () => {
  const fixture = renderTrendGradeFixture();
  const input = fixture.row.querySelectorAll('.gradesheet-input')[1];
  const first = deferred();
  let saveCalls = 0;
  fixture.modules.Storage.saveState = () => ++saveCalls === 1 ? first.promise : Promise.resolve();
  input.value = '5';
  const changing = input.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.trendCell.textContent, '↗️', 'pending candidate must not be shown');
  first.reject(new Error('synthetic persistence failure'));
  await changing;
  assert.equal(confirmedAssessment(fixture.modules, fixture.assessments[1].id)
    .scores[fixture.studentId].valueRaw, '2');
  assert.equal(fixture.trendCell.textContent, '↗️');
  assert.match(fixture.trendCell.title, /Verbesserung/);
  input.value = '5';
  await input.dispatch('change');
  assert.equal(saveCalls, 2);
  assert.equal(confirmedAssessment(fixture.modules, fixture.assessments[1].id)
    .scores[fixture.studentId].valueRaw, '5');
  assert.equal(fixture.trendCell.textContent, '↘️');
  assert.match(fixture.trendCell.title, /Verschlechterung/);
});
