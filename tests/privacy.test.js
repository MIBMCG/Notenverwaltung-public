'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { loadDashboardUi, findByAttribute, findByText } = require('./harness/dashboard-app.js');

function loadUiHelper(name, sandbox) {
  const lines = readSourceLines();
  const dependencies = name === 'runWhenDebugModeEnabled'
    ? `${extractFunction(lines, 'removeDebugModeArtifacts')}\n`
    : '';
  const source = dependencies + `${extractFunction(lines, name)}\n` +
    `globalThis.__uiHelper = ${name};`;
  vm.runInContext(source, sandbox, { filename: `${name}.js` });
  return sandbox.__uiHelper;
}

function createElement(tagName) {
  const attributes = new Map();
  const classNames = new Set();
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    parentNode: null,
    removed: false,
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = [];
      children.forEach(child => this.appendChild(child));
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() {
      this.removed = true;
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    focus() {},
    addEventListener() {},
    classList: {
      add(...names) { names.forEach(name => classNames.add(name)); },
      remove(...names) { names.forEach(name => classNames.delete(name)); },
      contains(name) { return classNames.has(name); },
      toggle(name, force) {
        const next = force === undefined ? !classNames.has(name) : !!force;
        if (next) classNames.add(name);
        else classNames.delete(name);
        return next;
      }
    },
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
      if (name === 'id') this.id = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; }
  };
  Object.defineProperty(element, 'firstChild', {
    get() { return this.children[0] || null; }
  });
  Object.defineProperty(element, 'className', {
    get() { return [...classNames].join(' '); },
    set(value) {
      classNames.clear();
      String(value).split(/\s+/).filter(Boolean).forEach(name => classNames.add(name));
      attributes.set('class', String(value));
    }
  });
  return element;
}

test('H7: init applies the stored session timeout to Storage', () => {
  const modules = loadModules();
  const applyStoredSessionTimeout = loadUiHelper('applyStoredSessionTimeout', modules.sandbox);
  const state = { settings: { sessionTimeoutMinutes: 7 } };

  applyStoredSessionTimeout(state);

  assert.equal(modules.Storage.getSessionTimeoutMinutes(), 7);
});

test('H7: only positive whole stored minutes replace the safe default', () => {
  for (const invalidValue of [0, -1, 0.5, 1.9, true, '7', null]) {
    const modules = loadModules();
    const applyStoredSessionTimeout = loadUiHelper('applyStoredSessionTimeout', modules.sandbox);

    assert.equal(applyStoredSessionTimeout({ settings: { sessionTimeoutMinutes: invalidValue } }), false);
    assert.equal(
      modules.Storage.getSessionTimeoutMinutes(),
      15,
      `ungueltiger Wert ${JSON.stringify(invalidValue)} darf den Standard nicht ersetzen`
    );
  }
});

test('H8/H9: debug-only work runs only when __debugMode is exactly 1', () => {
  const storage = localStorageStub();
  const modules = loadModules({ storage });
  const runWhenDebugModeEnabled = loadUiHelper('runWhenDebugModeEnabled', modules.sandbox);
  let executions = 0;

  assert.equal(runWhenDebugModeEnabled(() => { executions += 1; }), false);
  storage.setItem('__debugMode', 'true');
  assert.equal(runWhenDebugModeEnabled(() => { executions += 1; }), false);
  storage.setItem('__debugMode', '1');
  assert.equal(runWhenDebugModeEnabled(() => { executions += 1; }), true);

  assert.equal(executions, 1);
});

test('H8/H9: disabling debug removes exported hooks and visible state blocks', () => {
  const storage = localStorageStub();
  storage.setItem('__debugMode', '1');
  const modules = loadModules({ storage });
  const debugBlocks = [
    { removed: false, remove() { this.removed = true; } },
    { removed: false, remove() { this.removed = true; } }
  ];
  modules.sandbox.document = {
    querySelectorAll(selector) {
      assert.equal(selector, '.debug-block');
      return debugBlocks.filter(block => !block.removed);
    }
  };
  const source = [
    extractFunction(readSourceLines(), 'removeDebugModeArtifacts'),
    extractFunction(readSourceLines(), 'runWhenDebugModeEnabled'),
    extractFunction(readSourceLines(), 'installDebugWindowHook'),
    'globalThis.__installDebugWindowHook = installDebugWindowHook;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'debug-window-hooks.js' });
  let executions = 0;

  assert.equal(
    modules.sandbox.__installDebugWindowHook('runPrevTermIntegrationTest', () => { executions += 1; }),
    true
  );
  assert.equal(typeof modules.sandbox.window.runPrevTermIntegrationTest, 'function');

  storage.removeItem('__debugMode');
  assert.equal(modules.sandbox.window.runPrevTermIntegrationTest(), undefined);

  assert.equal(executions, 0, 'ein bereits exportierter Hook darf nach dem Abschalten nichts mehr schreiben');
  assert.equal(modules.sandbox.window.runPrevTermIntegrationTest, undefined);
  assert.deepEqual(debugBlocks.map(block => block.removed), [true, true]);
});

test('H9: a write hook is not exported outside exact debug mode', () => {
  const modules = loadModules();
  modules.sandbox.document = { querySelectorAll() { return []; } };
  const source = [
    extractFunction(readSourceLines(), 'removeDebugModeArtifacts'),
    extractFunction(readSourceLines(), 'runWhenDebugModeEnabled'),
    extractFunction(readSourceLines(), 'installDebugWindowHook'),
    'globalThis.__installDebugWindowHook = installDebugWindowHook;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'debug-window-hooks-disabled.js' });

  assert.equal(modules.sandbox.__installDebugWindowHook('runPrevTermIntegrationTest', () => {}), false);
  assert.equal(modules.sandbox.window.runPrevTermIntegrationTest, undefined);
});

test('LOW: normal state normalization and loading emit no informational console output', async () => {
  const modules = loadModules();

  modules.DomainModel.ensureStateShape({
    settings: {
      halfYearSettings: {
        seckI: { schoolYearStartYear: 2025 },
        seckII: { schoolYearStartYear: 2025 }
      }
    }
  });
  await modules.sessionReady;
  await modules.Storage.loadState();

  assert.deepEqual(
    modules.logs.filter(entry => ['log', 'info', 'debug'].includes(entry.level)),
    [],
    'reguläre Produktionspfade dürfen keine internen Zustandsdaten protokollieren'
  );
});

test('LOW: saving an object without settings reaches the storage policy instead of a debug dereference', async () => {
  const modules = loadModules();
  await modules.sessionReady;

  await assert.rejects(
    async () => modules.Storage.saveState({}),
    /Verschlüsselte Speicherung ist nicht eingerichtet/
  );
});

test('H8/H9: same-document debug disable removes artifacts without invoking a hook', () => {
  const storage = localStorageStub();
  const modules = loadModules({ storage });
  let lifecycleTick = null;
  modules.sandbox.setInterval = callback => {
    lifecycleTick = callback;
    return 1;
  };
  const debugBlock = { present: false, removed: false, remove() { this.removed = true; } };
  modules.sandbox.document = {
    querySelectorAll(selector) {
      assert.equal(selector, '.debug-block');
      return debugBlock.present && !debugBlock.removed ? [debugBlock] : [];
    }
  };
  const source = [
    extractFunction(readSourceLines(), 'removeDebugModeArtifacts'),
    extractFunction(readSourceLines(), 'runWhenDebugModeEnabled'),
    extractFunction(readSourceLines(), 'installDebugWindowHook'),
    extractFunction(readSourceLines(), 'installDebugModeLifecycleGuard'),
    'globalThis.__installDebugWindowHook = installDebugWindowHook;',
    'globalThis.__installDebugModeLifecycleGuard = installDebugModeLifecycleGuard;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'debug-mode-same-document-lifecycle.js' });
  modules.sandbox.__installDebugModeLifecycleGuard();
  assert.equal(typeof lifecycleTick, 'function');

  lifecycleTick();
  assert.equal(modules.sandbox.window.runPrevTermIntegrationTest, undefined);

  storage.setItem('__debugMode', '1');
  modules.sandbox.__installDebugWindowHook('runPrevTermIntegrationTest', () => {});
  debugBlock.present = true;
  lifecycleTick();
  assert.equal(typeof modules.sandbox.window.runPrevTermIntegrationTest, 'function');

  storage.removeItem('__debugMode');
  lifecycleTick();

  assert.equal(modules.sandbox.window.runPrevTermIntegrationTest, undefined);
  assert.equal(debugBlock.removed, true);
});

test('H8: the real statistics renderer removes an existing state block after debug is disabled', () => {
  const storage = localStorageStub();
  const modules = loadModules({ storage });
  const elements = [];
  const trackedElement = tagName => {
    const element = createElement(tagName);
    elements.push(element);
    return element;
  };
  modules.sandbox.document = {
    body: { classList: { contains() { return false; } } },
    createElement: trackedElement,
    querySelectorAll(selector) {
      assert.equal(selector, '.debug-block');
      return elements.filter(element => !element.removed && element.className === 'debug-block');
    }
  };
  modules.sandbox.state = { students: [], courses: [], assessments: [], settings: {} };
  modules.sandbox.currentCourseId = null;
  const source = [
    extractFunction(readSourceLines(), 'removeDebugModeArtifacts'),
    extractFunction(readSourceLines(), 'runWhenDebugModeEnabled'),
    extractFunction(readSourceLines(), 'renderStatsSection'),
    'globalThis.__renderStatsSection = renderStatsSection;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'statistics-debug-lifecycle.js' });

  modules.sandbox.__renderStatsSection(trackedElement('main'));
  assert.equal(modules.sandbox.document.querySelectorAll('.debug-block').length, 0);

  storage.setItem('__debugMode', '1');
  modules.sandbox.__renderStatsSection(trackedElement('main'));
  assert.equal(modules.sandbox.document.querySelectorAll('.debug-block').length, 1);

  storage.removeItem('__debugMode');
  modules.sandbox.__renderStatsSection(trackedElement('main'));
  assert.equal(modules.sandbox.document.querySelectorAll('.debug-block').length, 0);
});

test('H13: entering the lock view removes every session-sensitive overlay', () => {
  const modules = loadModules();
  const overlays = [
    { removed: false, remove() { this.removed = true; } },
    { removed: false, remove() { this.removed = true; } },
    { removed: false, remove() { this.removed = true; } }
  ];
  modules.sandbox.document = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-session-sensitive-overlay="true"]');
      return overlays;
    }
  };
  const removeSessionSensitiveOverlays = loadUiHelper('removeSessionSensitiveOverlays', modules.sandbox);

  removeSessionSensitiveOverlays();

  assert.deepEqual(overlays.map(overlay => overlay.removed), [true, true, true]);
});

test('H13: lock cleanup closes stateful overlays through their own cleanup path', () => {
  const modules = loadModules();
  const overlay = {
    closed: false,
    removed: false,
    __closeForSessionLock() { this.closed = true; },
    remove() { this.removed = true; }
  };
  modules.sandbox.document = { querySelectorAll() { return [overlay]; } };
  const removeSessionSensitiveOverlays = loadUiHelper('removeSessionSensitiveOverlays', modules.sandbox);

  removeSessionSensitiveOverlays();

  assert.equal(overlay.closed, true);
  assert.equal(overlay.removed, false, 'der dialogspezifische Cleanup-Pfad soll selbst entfernen');
});

test('H13: locking resolves the real archive dialog and removes its key listener', async () => {
  const modules = loadModules();
  const body = createElement('body');
  const keydownListeners = new Set();
  modules.sandbox.document = {
    body,
    createElement,
    addEventListener(type, listener) {
      if (type === 'keydown') keydownListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'keydown') keydownListeners.delete(listener);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-session-sensitive-overlay="true"]');
      return body.children.filter(element => element.dataset.sessionSensitiveOverlay === 'true');
    }
  };
  const source = [
    extractFunction(readSourceLines(), 'requestArchiveMetadata'),
    extractFunction(readSourceLines(), 'removeSessionSensitiveOverlays'),
    'globalThis.__requestArchiveMetadata = requestArchiveMetadata;',
    'globalThis.__removeSessionSensitiveOverlays = removeSessionSensitiveOverlays;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'archive-dialog-lock-cleanup.js' });

  const resultPromise = modules.sandbox.__requestArchiveMetadata();
  assert.equal(body.children.length, 1);
  assert.equal(keydownListeners.size, 1);

  modules.sandbox.__removeSessionSensitiveOverlays();

  assert.equal(await resultPromise, null);
  assert.equal(keydownListeners.size, 0);
  assert.equal(body.children.length, 0);
});

test('H13: the real render lock branch cleans overlays before showing the lock view', () => {
  const lines = readSourceLines();
  const root = createElement('div');
  const oldContent = createElement('main');
  root.appendChild(oldContent);
  const lockSteps = [];
  const overlay = {
    closed: false,
    __closeForSessionLock() { this.closed = true; lockSteps.push('overlay-closed'); }
  };
  const dashboardTransition = loadModules().sandbox.createDashboardTransition({
    isAllowed: () => true,
    onReady() {},
    onFailure: assert.fail
  });
  const sandbox = {
    root,
    sessionCoordinator: loadModules({ lockManager: null }).sessionCoordinator,
    state: { settings: { halfYearSettings: {} } },
    APP_RELEASE: { version: 'test' },
    schoolLogoReadId: 0,
    Storage: {
      isEncrypted() { return true; },
      hasSessionPassword() { return false; }
    },
    document: {
      createElement,
      createElementNS(namespaceURI, tagName) { return createElement(tagName); },
      querySelectorAll() { return [overlay]; }
    },
    dashboardTransition,
    persistenceBoundary: { invalidate() {} },
    pendingLockNotice: false,
    LOST_INPUT_NOTICE: 'synthetic neutral notice',
    dashboardMount: null,
    stopAppearanceEffects() { lockSteps.push('effects-stopped'); },
    // This isolated lock-branch extract has no gradesheet DOM to unregister.
    clearActiveGradesheetEditors() {},
    console: { log() {} }
  };
  vm.createContext(sandbox);
  const source = [
    extractFunction(lines, 'removeSessionSensitiveOverlays'),
    extractFunction(lines, 'disposeDashboard'),
    extractFunction(lines, 'createUiIcon'),
    extractFunction(lines, 'render'),
    'globalThis.__render = render;'
  ].join('\n\n');
  vm.runInContext(source, sandbox, { filename: 'render-lock.js' });

  sandbox.__render();

  assert.deepEqual(lockSteps, ['effects-stopped', 'overlay-closed'],
    'die Sperre muss laufende Darstellungseffekte vor dem Schließen sensibler Overlays stoppen');
  assert.equal(overlay.closed, true);
  assert.equal(root.children.length, 1);
  const lockSurface = root.children[0];
  const heading = lockSurface.children[0].children.find(element => element.tagName === 'H1');
  assert.equal(lockSurface.tagName, 'SECTION');
  assert.equal(lockSurface.className, 'lock-screen');
  assert.equal(lockSurface.getAttribute('aria-labelledby'), heading.id);
  assert.equal(heading.textContent, 'Anwendung gesperrt');
  assert.equal(oldContent.parentNode, null, 'vorheriger App-Inhalt muss vor der Sperransicht entfernt sein');
});

test('resume metadata remains encrypted at rest and disappears immediately from the locked DOM', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({
    id: 'private-resume-course-id',
    name: 'Vertraulicher Testkurs',
    subject: 'Biologie',
    classLabel: 'Q-Test'
  });
  probe.DomainModel.addCourseToState(state, course);
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', course.id);
  await card._find(element => element.textContent === 'Noten öffnen').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  const plaintextStorage = app.storage._keys().map(key => `${key}:${app.storage.getItem(key)}`).join('\n');
  assert.equal(plaintextStorage.includes(course.id), false);
  assert.equal(plaintextStorage.includes(course.name), false);
  assert.equal(app.storage.getItem('notenverwaltung_v1_state'), null);

  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(app.root.textContent.includes(course.id), false);
  assert.equal(app.root.textContent.includes(course.name), false);
  assert.equal(findByText(app.root, 'Fortsetzen'), null);
  assert.equal(findByAttribute(app.root, 'data-course-id', course.id), null);
});
