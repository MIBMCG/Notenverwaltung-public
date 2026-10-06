'use strict';
const vm = require('node:vm');
const { createLockManagerStub } = require('./shared-session');
const { readSourceLines, extractFunction } = require('./extract.js');
const { installFormattingGlobals } = require('./install-formatting.js');
const { bundleEsmGraph } = require('./load-esm-graph.js');

// Deterministic PRNG (linear congruential) so generateId() is reproducible.
function seededRandom(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function localStorageStub() {
  const store = new Map();
  return {
    getItem(key) { const k = String(key); return store.has(k) ? store.get(k) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); },
    clear() { store.clear(); },
    _keys() { return [...store.keys()]; }
  };
}

function loadModules({
  seed = 1,
  password = null,
  storage = null,
  lockManager = undefined,
  cryptoImpl = crypto,
  dateImpl = Date,
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
  storageSourceTransform = source => source
} = {}) {
  const lines = readSourceLines();
  const logs = [];
  const capture = level => (...args) => { logs.push({ level, args }); };

  // `window` only needs to be an event target with a few extra properties.
  const windowStub = new EventTarget();
  windowStub.promptPassword = async () => password;
  windowStub.alert = () => {};
  windowStub.confirm = () => false;

  const localStorageObject = storage || localStorageStub();

  const sandbox = {
    Date: dateImpl,
    navigator: { locks: lockManager === undefined ? createLockManagerStub() : lockManager },
    localStorage: localStorageObject,
    window: windowStub,
    crypto: cryptoImpl,
    // Node 20 WebCrypto requires ArrayBuffers created by the host realm.
    Uint8Array, TextEncoder, TextDecoder, btoa, atob, Event,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    console: {
      log: capture('log'),
      info: capture('info'),
      warn: capture('warn'),
      error: capture('error'),
      debug: capture('debug')
    },
    Math: Object.assign(Object.create(Math), { random: seededRandom(seed) })
  };
  vm.createContext(sandbox);
  installFormattingGlobals(sandbox);
  vm.runInContext(
    bundleEsmGraph('src/ui/dashboard-transition.js', { globalName: '__dashboard_transition_exports' }),
    sandbox,
    { filename: 'src/ui/dashboard-transition.js.bundle.js' }
  );
  sandbox.createDashboardTransition = sandbox.__dashboard_transition_exports.createDashboardTransition;
  vm.runInContext(
    bundleEsmGraph('src/ui/persistence-boundary.js', { globalName: '__persistence_boundary_exports' }),
    sandbox,
    { filename: 'src/ui/persistence-boundary.js.bundle.js' }
  );
  sandbox.createPersistenceBoundary = sandbox.__persistence_boundary_exports.createPersistenceBoundary;
  vm.runInContext(
    bundleEsmGraph('src/ui/dashboard-data.js', { globalName: '__dashboard_data_exports' }),
    sandbox,
    { filename: 'src/ui/dashboard-data.js.bundle.js' }
  );
  sandbox.buildDashboardCards = sandbox.__dashboard_data_exports.buildDashboardCards;
  vm.runInContext(
    bundleEsmGraph('src/ui/course-cards.js', { globalName: '__course_cards_exports' }),
    sandbox,
    { filename: 'src/ui/course-cards.js.bundle.js' }
  );
  sandbox.mountCourseCards = sandbox.__course_cards_exports.mountCourseCards;
  vm.runInContext(bundleEsmGraph('src/ui/course-symbol-picker.js', { globalName: '__course_symbol_exports' }), sandbox);
  sandbox.createCourseSymbolPicker = sandbox.__course_symbol_exports.createCourseSymbolPicker;
  vm.runInContext(
    bundleEsmGraph('src/transfer/csv-format.js', { globalName: '__csv_format_exports' }),
    sandbox,
    { filename: 'src/transfer/csv-format.js.bundle.js' }
  );
  Object.assign(sandbox, sandbox.__csv_format_exports);
  vm.runInContext(
    bundleEsmGraph('src/transfer/csv-decoding.js', { globalName: '__csv_decoding_exports' }),
    sandbox,
    { filename: 'src/transfer/csv-decoding.js.bundle.js' }
  );
  Object.assign(sandbox, sandbox.__csv_decoding_exports);
  vm.runInContext(
    bundleEsmGraph('src/transfer/csv-import-rules.js', { globalName: '__csv_import_rules_exports' }),
    sandbox,
    { filename: 'src/transfer/csv-import-rules.js.bundle.js' }
  );
  Object.assign(sandbox, sandbox.__csv_import_rules_exports);
  vm.runInContext(
    bundleEsmGraph('src/transfer/import-validation.js', { globalName: '__import_validation_exports' }),
    sandbox,
    { filename: 'src/transfer/import-validation.js.bundle.js' }
  );
  Object.assign(sandbox, sandbox.__import_validation_exports);
  vm.runInContext(
    bundleEsmGraph('src/transfer/import-merge.js', { globalName: '__import_merge_exports' }),
    sandbox,
    { filename: 'src/transfer/import-merge.js.bundle.js' }
  );
  Object.assign(sandbox, sandbox.__import_merge_exports);
  vm.runInContext(
    bundleEsmGraph('src/domain/domain-model.js', { globalName: '__domain_exports' }),
    sandbox,
    { filename: 'src/domain/domain-model.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/initial-state.js', { globalName: '__initial_state_exports' }),
    sandbox,
    { filename: 'src/domain/initial-state.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/grading-logic.js', { globalName: '__grading_exports' }),
    sandbox,
    { filename: 'src/domain/grading-logic.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/course-settings.js', { globalName: '__course_settings_exports' }),
    sandbox,
    { filename: 'src/domain/course-settings.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/terms.js', { globalName: '__terms_exports' }),
    sandbox,
    { filename: 'src/domain/terms.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/infrastructure/storage.js', {
      globalName: '__storage_exports',
      entrySourceTransform: storageSourceTransform
    }),
    sandbox,
    { filename: 'src/infrastructure/storage.js.bundle.js' }
  );

  vm.runInContext(bundleEsmGraph('src/infrastructure/session-coordinator.js', { globalName: '__session_exports' }), sandbox);

  const applicationSource = lines.join('\n');
  const exitGuardStart = applicationSource.indexOf('    let observeUnsavedBeforeExit = null;');
  const exitGuardEnd = applicationSource.indexOf('    const sessionCoordinator = createSessionCoordinator({', exitGuardStart);
  const earlyExitGuard = exitGuardStart >= 0 && exitGuardEnd > exitGuardStart
    ? applicationSource.slice(exitGuardStart, exitGuardEnd)
    : '';

  // All modules must share one script: top-level `const` in a vm script does
  // not attach to the context, so they are exported explicitly at the end.
  const source = `const createInitialState = globalThis.__initial_state_exports.createInitialState;
  const DomainModel = globalThis.__domain_exports.createDomainModel({
    now: () => new Date(),
    termServices: {
      getSettingsForCourse: globalThis.__course_settings_exports.getSettingsForCourse,
      resolveAssessmentTermFromDateValue: globalThis.__terms_exports.resolveAssessmentTermFromDateValue
    }
  });
  ${earlyExitGuard}
  const sessionCoordinator = globalThis.__session_exports.createSessionCoordinator({
    lockManager: navigator.locks, resourceName: 'notenverwaltung-v1-editor', onLost: () => Storage.lockSession()
  });
  const Storage = globalThis.__storage_exports.createStorage({ DomainModel, createInitialState, sessionCoordinator });\n\n` + extractFunction(lines, 'createGradingDiagnostics') + `

  const GradingLogic = globalThis.__grading_exports.createGradingLogic({
    now: () => new Date(),
    diagnostics: createGradingDiagnostics()
  });
  const ImportMerge = globalThis.__import_merge_exports.createImportMerge({
    ensureStateShape: DomainModel.ensureStateShape,
    createEmptyState: DomainModel.createEmptyState,
    generateId: DomainModel.generateId
  });\n\nglobalThis.__module_exports = { sessionCoordinator, DomainModel, createInitialState, Storage, GradingLogic, ImportMerge };`;
  vm.runInContext(source, sandbox, { filename: 'Notenverwaltung.modules.js' });

  const sessionReady = lockManager === undefined ? sandbox.__module_exports.sessionCoordinator.acquire() : null;
  return {
    sessionReady,
    lockManager: sandbox.navigator.locks,
    ...sandbox.__module_exports,
    importValidation: sandbox.__import_validation_exports,
    sandbox,
    logs,
    storage: localStorageObject
  };
}

module.exports = { loadModules, localStorageStub, seededRandom };
