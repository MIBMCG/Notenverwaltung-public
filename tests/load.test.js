'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { openStorageSession } = require('./harness/storage-session');
const { readSourceLines, extractModule } = require('./harness/extract.js');
const { bundleEsmGraph } = require('./harness/load-esm-graph.js');
const { createStartElement, createStartDocument } = require('./harness/start-dom.js');

function startupEntrySource(lines) {
  const uiStart = lines.indexOf('    const UiShell = (function () {');
  assert.notEqual(uiStart, -1, 'UiShell-Modulanfang fehlt');
  const uiEnd = lines.indexOf('    })();', uiStart);
  const listenerStart = lines.indexOf('    document.addEventListener("DOMContentLoaded", async function () {', uiEnd);
  const fallbackListenerStart = lines.indexOf('    document.addEventListener("DOMContentLoaded", function () {', uiEnd);
  const actualListenerStart = listenerStart === -1 ? fallbackListenerStart : listenerStart;
  assert.notEqual(actualListenerStart, -1, 'DOMContentLoaded-Startpunkt fehlt');
  const listenerEnd = lines.indexOf('    });', actualListenerStart);
  assert.notEqual(listenerEnd, -1, 'DOMContentLoaded-Startpunkt ist unvollstaendig');
  return lines.slice(uiEnd + 1, listenerEnd + 1).join('\n');
}

function loadStartEntryPoint(init) {
  const lines = readSourceLines();
  const { document, root, documentListeners } = createStartDocument();
  const logs = [];
  const sandbox = {
    document,
    UiShell: { init },
    APP_RELEASE: { version: 'synthetischer-test' },
    console: { error(...args) { logs.push(args); } }
  };
  vm.createContext(sandbox);
  vm.runInContext(startupEntrySource(lines), sandbox, {
    filename: 'Notenverwaltung.start.js'
  });
  return { root, documentListeners, logs };
}

async function loadRealUiApplication({ includeAppRoot = true, includeStartup = false } = {}) {
  const password = 'Synthetisches-Testpasswort-2026';
  const storage = localStorageStub();
  const modules = await openStorageSession({ storage, password: null });
  await modules.Storage.enableEncryption(password, modules.DomainModel.createEmptyState());
  modules.Storage.lockSession();

  const dom = createStartDocument({ includeAppRoot });
  const windowListeners = new Map();
  const addWindowListener = modules.sandbox.window.addEventListener.bind(modules.sandbox.window);
  modules.sandbox.window.addEventListener = (type, listener) => {
    addWindowListener(type, listener);
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  };
  modules.sandbox.window.removeEventListener = (type, listener) => {
    const listeners = windowListeners.get(type) || [];
    windowListeners.set(type, listeners.filter(candidate => candidate !== listener));
  };
  modules.sandbox.window.location = { hostname: 'example.test', search: '' };
  modules.sandbox.APP_RELEASE = { version: 'synthetischer-test', date: '2026-08-29' };
  modules.sandbox.document = dom.document;
  vm.runInContext(bundleEsmGraph('src/ui/state-commit.js', { globalName: '__state_commit_exports' }), modules.sandbox, { filename: 'src/ui/state-commit.js.bundle.js' });
  modules.sandbox.createStateCommitter = modules.sandbox.__state_commit_exports.createStateCommitter;
  const lines = readSourceLines();
  vm.runInContext(
    extractModule(lines, 'UiShell') + '\nglobalThis.__realUiShell = UiShell;',
    modules.sandbox,
    { filename: 'Notenverwaltung.UiShell.js' }
  );
  if (includeStartup) {
    vm.runInContext(startupEntrySource(lines), modules.sandbox, {
      filename: 'Notenverwaltung.start.real.js'
    });
  }
  return {
    ...dom,
    UiShell: modules.sandbox.__realUiShell,
    Storage: modules.Storage,
    sessionCoordinator: modules.sessionCoordinator,
    logs: modules.logs,
    sandbox: modules.sandbox,
    windowListeners,
    dispatchWindow(type, event = {}) {
      for (const listener of [...(windowListeners.get(type) || [])]) listener(event);
    }
  };
}

async function flushStartRetry() {
  await new Promise(resolve => setImmediate(resolve));
}

test('loadModules returns the three logic modules', () => {
  const m = loadModules();
  assert.equal(typeof m.DomainModel.createEmptyState, 'function');
  assert.equal(typeof m.Storage.saveState, 'function');
  assert.equal(typeof m.GradingLogic.computeOverallGrade, 'function');
});

test('the same seed and call sequence produce the same generated ids', () => {
  const first = loadModules({ seed: 1 }).DomainModel.createStudent({ lastName: 'A', firstName: 'B' }).id;
  const second = loadModules({ seed: 1 }).DomainModel.createStudent({ lastName: 'A', firstName: 'B' }).id;
  assert.equal(first, second);
});

test('a different seed produces different generated ids', () => {
  const a = loadModules({ seed: 1 }).DomainModel.createStudent({ lastName: 'A', firstName: 'B' }).id;
  const b = loadModules({ seed: 99 }).DomainModel.createStudent({ lastName: 'A', firstName: 'B' }).id;
  assert.notEqual(a, b);
});

test('console errors from invalid stored content remain captured for diagnosis', async () => {
  const storage = localStorageStub();
  storage.setItem('notenverwaltung_v1_state', '{invalid');
  const m = await openStorageSession({ storage });

  await assert.rejects(() => m.Storage.loadState(), /Originaldaten wurden nicht verändert/);

  assert.ok(Array.isArray(m.logs));
  assert.ok(m.logs.some(entry => entry.level === 'error'), 'kein Fehlerdiagnose-Eintrag erfasst');
});

test('LOW: the real UI starts without informational production logs', async () => {
  const app = await loadRealUiApplication();
  app.sandbox.window.promptPassword = async () => 'Synthetisches-Testpasswort-2026';
  await app.sessionCoordinator.acquire();
  await app.Storage.loadState();

  await app.UiShell.init('app');

  assert.deepEqual(
    app.logs.filter(entry => ['log', 'info', 'debug'].includes(entry.level)),
    [],
    'normaler UI-Start darf keine internen Zustandsdaten protokollieren'
  );
});

test('sandboxes can share one localStorage stub', async () => {
  const shared = localStorageStub();
  shared.setItem('probe', 'wert');
  const m = await openStorageSession({ storage: shared });
  assert.equal(m.storage.getItem('probe'), 'wert');
});

test('encryption survives a round-trip through a fresh sandbox', async () => {
  const shared = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';

  const first = await openStorageSession({ storage: shared, password });
  const state = first.DomainModel.createEmptyState();
  state.courses.push(first.DomainModel.createCourse({
    name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1'
  }));
  await first.Storage.enableEncryption(password, state);

  const second = await openStorageSession({ storage: shared, password });
  const restored = await second.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('a wrong password yields an empty state instead of garbage', async () => {
  const shared = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';

  const first = await openStorageSession({ storage: shared, password });
  const state = first.DomainModel.createEmptyState();
  state.courses.push(first.DomainModel.createCourse({
    name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1'
  }));
  await first.Storage.enableEncryption(password, state);

  const wrong = await openStorageSession({ storage: shared, password: 'Falsches-Passwort' });
  let authenticationRetries = 0;
  wrong.sandbox.window.confirm = () => {
    authenticationRetries += 1;
    return false;
  };
  const result = await wrong.Storage.loadState();
  assert.equal(result.courses.length, 0);
  assert.equal(wrong.Storage.hasSessionPassword(), false);
  assert.equal(authenticationRetries, 1, 'falsches Passwort verliess den Authentifizierungszweig');
});

test('a rejected application start renders a neutral local retry view without exposing error details', async () => {
  const privateErrorDetail = 'Synthetischer Personenname aus einem internen Fehler';
  const start = loadStartEntryPoint(async () => {
    const error = new Error(privateErrorDetail);
    error.code = 'STATE_CONTENT_INVALID';
    throw error;
  });
  const domReadyListeners = start.documentListeners.get('DOMContentLoaded') || [];
  assert.equal(domReadyListeners.length, 1);

  await assert.doesNotReject(() => domReadyListeners[0]());

  assert.notEqual(start.root.textContent.trim(), '', 'Startfehler hinterliess eine leere Seite');
  assert.doesNotMatch(start.root.textContent, new RegExp(privateErrorDetail));
  assert.match(start.root.textContent, /gespeicherten Originaldaten wurden nicht verändert/);
  const retryButton = start.root._find('button');
  assert.ok(retryButton, 'lokale Retry-Aktion fehlt');
  assert.equal(retryButton._listeners('click').length, 1, 'Retry-Listener wurde mehrfach registriert');
});

test('the real encrypted startup shows archive repair guidance as text', async () => {
  const password = 'Synthetisches-Testpasswort-2026';
  const unsafeCourseId = 'archive-<img src=x onerror=synthetic-test>';
  const app = await loadRealUiApplication({ includeStartup: true });
  await app.sessionCoordinator.acquire();
  await app.Storage.enableEncryption(password, {
    courses: [{
      id: unsafeCourseId,
      archivedAt: '2026-09-21T00:00:00.000Z',
      archiveSnapshot: null
    }],
    assessments: []
  });
  app.Storage.lockSession();
  app.sandbox.window.promptPassword = async () => password;
  const domReadyListeners = app.documentListeners.get('DOMContentLoaded') || [];

  await assert.doesNotReject(() => domReadyListeners[0]());

  assert.ok(app.root.textContent.includes(unsafeCourseId), 'betroffene Kurs-ID fehlt');
  assert.match(app.root.textContent, /intaktes Backup/);
  assert.match(app.root.textContent, /Originalbestand.*Reparatur/);
  assert.equal(app.root._find('img'), null, 'Kurs-ID wurde als HTML interpretiert');
});

test('the local retry action reuses the guarded start path without duplicating listeners', async () => {
  let attempts = 0;
  let root;
  const start = loadStartEntryPoint(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('Synthetischer Startfehler');
    root.textContent = 'Anwendung gestartet';
  });
  root = start.root;
  const domReadyListeners = start.documentListeners.get('DOMContentLoaded') || [];

  await domReadyListeners[0]();
  const retryButton = root._find('button');
  assert.ok(retryButton);
  assert.equal(retryButton._listeners('click').length, 1);
  retryButton._listeners('click')[0]();
  await flushStartRetry();

  const secondRetryButton = root._find('button');
  assert.ok(secondRetryButton, 'zweiter Fehler verlor die Retry-Aktion');
  assert.notEqual(secondRetryButton, retryButton, 'Fehleransicht wurde nicht ersetzt');
  assert.equal(secondRetryButton._listeners('click').length, 1);
  secondRetryButton._listeners('click')[0]();
  await flushStartRetry();

  assert.equal(root.textContent, 'Anwendung gestartet');
  assert.equal(attempts, 3);
  assert.equal((start.documentListeners.get('DOMContentLoaded') || []).length, 1);
});

test('a missing app root becomes a visible retry view through the real UiShell start path', async () => {
  const app = await loadRealUiApplication({ includeAppRoot: false, includeStartup: true });
  const domReadyListeners = app.documentListeners.get('DOMContentLoaded') || [];
  assert.equal(domReadyListeners.length, 1);

  await assert.doesNotReject(() => domReadyListeners[0]());

  const fallbackRoot = app.document.getElementById('app');
  assert.ok(fallbackRoot, 'fehlender App-Root erhielt keinen sicheren lokalen Fallback');
  assert.notEqual(fallbackRoot.textContent.trim(), '', 'fehlender App-Root blieb visuell leer');
  assert.ok(fallbackRoot._find('button'), 'Fallback enthaelt keine Retry-Aktion');
});

test('failed and retried real UiShell init keeps one stable listener and no failed render closure', async () => {
  const app = await loadRealUiApplication();

  app.sandbox.window.promptPassword = async () => 'Synthetisches-Testpasswort-2026';
  await app.UiShell.init('app');
  const createElement = app.document.createElement.bind(app.document);
  let blockedCreateAttempts = 0;
  app.document.createElement = () => {
    blockedCreateAttempts += 1;
    throw new Error('Synthetischer Renderfehler');
  };
  await assert.rejects(() => app.UiShell.init('app'), /Synthetischer Renderfehler/);

  const attemptsAfterFailedInit = blockedCreateAttempts;
  app.dispatchWindow('sessionCleared');
  assert.equal(blockedCreateAttempts, attemptsAfterFailedInit,
    'sessionCleared rief die render-Closure eines fehlgeschlagenen init erneut auf');

  app.document.createElement = createElement;
  await app.UiShell.init('app');

  assert.equal((app.windowListeners.get('sessionCleared') || []).length, 1,
    'wiederholtes init registrierte alte render-Closures weiter');
  const buttonsBeforeEvent = app.document._created('button');
  app.Storage.lockSession();
  assert.equal(app.document._created('button') - buttonsBeforeEvent, 2,
    'sessionCleared loeste mehr als einen Sperransicht-Render aus');
});

test('M16: the real reset control requires two confirmations before resetState runs', async () => {
  const app = await loadRealUiApplication();
  app.sandbox.window.promptPassword = async () => 'Synthetisches-Testpasswort-2026';
  await app.sessionCoordinator.acquire();
  await app.Storage.loadState();
  let resetCalls = 0;
  app.Storage.resetState = async () => {
    resetCalls += 1;
    return app.sandbox.DomainModel.createEmptyState();
  };
  const confirmations = [true, false];
  const messages = [];
  app.sandbox.window.confirm = message => {
    messages.push(String(message));
    return confirmations.shift();
  };
  await app.UiShell.init('app');
  const resetButton = (function find(element) {
    if (element.tagName === 'BUTTON' && /Alles zurücksetzen/.test(element.textContent)) return element;
    for (const child of element.children || []) {
      const match = find(child);
      if (match) return match;
    }
    return null;
  })(app.root);
  assert.ok(resetButton, 'der reale Reset-Button muss gerendert sein');

  await resetButton._listeners('click')[0]();

  assert.equal(messages.length, 2, 'nach der ersten Zustimmung muss eine zweite Sicherheitsabfrage folgen');
  assert.equal(resetCalls, 0, 'Abbruch der zweiten Sicherheitsabfrage muss alle Daten erhalten');
  assert.match(messages[1], /endgültig|unwiderruflich|letzte/i);

  confirmations.push(true, true);
  await resetButton._listeners('click')[0]();
  assert.equal(resetCalls, 1, 'erst zwei Zustimmungen dürfen den Reset ausführen');
});
