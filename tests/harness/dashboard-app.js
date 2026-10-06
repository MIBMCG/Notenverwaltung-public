'use strict';

const vm = require('node:vm');
const { loadModules, localStorageStub } = require('./load');
const { createLockManagerStub } = require('./shared-session');
const { readSourceLines, extractModule } = require('./extract');
const { bundleEsmGraph } = require('./load-esm-graph');
const { createStartElement, createStartDocument } = require('./start-dom');

function installDashboardModules(sandbox) {
  vm.runInContext(bundleEsmGraph('src/ui/dashboard-data.js', { globalName: '__dashboard_data_exports' }), sandbox, { filename: 'src/ui/dashboard-data.js.bundle.js' });
  sandbox.buildDashboardCards = sandbox.__dashboard_data_exports.buildDashboardCards;
  vm.runInContext(bundleEsmGraph('src/ui/course-cards.js', { globalName: '__course_cards_exports' }), sandbox, { filename: 'src/ui/course-cards.js.bundle.js' });
  sandbox.mountCourseCards = sandbox.__course_cards_exports.mountCourseCards;
  vm.runInContext(bundleEsmGraph('src/ui/state-commit.js', { globalName: '__state_commit_exports' }), sandbox, { filename: 'src/ui/state-commit.js.bundle.js' });
  sandbox.createStateCommitter = sandbox.__state_commit_exports.createStateCommitter;
}

async function loadDashboardUi({ state, locked = false, encrypted = true, useExistingStorage = false, dateImpl = Date, storage: suppliedStorage = null, lockManager = undefined, cryptoImpl = crypto, promptPassword = null, mediaQueryList = null, reducedMotionMediaQueryList = null } = {}) {
  const password = 'Synthetisches-Testpasswort-2026';
  const storage = suppliedStorage || localStorageStub();
  const modules = loadModules({ storage, password, dateImpl, lockManager, cryptoImpl });
  if (modules.sessionReady) await modules.sessionReady;
  const initialState = state || modules.DomainModel.createEmptyState();
  if (encrypted && !useExistingStorage) {
    await modules.sessionCoordinator.acquire();
    await modules.Storage.enableEncryption(password, initialState);
  }
  if (promptPassword) modules.sandbox.window.promptPassword = promptPassword;
  if (locked) {
    await modules.Storage.lockSession();
    modules.sandbox.window.promptPassword = async () => null;
  }
  const dom = createStartDocument();
  modules.sandbox.document = dom.document;
  modules.sandbox.APP_RELEASE = { version: 'synthetischer-test', dateLabel: '06.09.2026' };
  modules.sandbox.window.location = { hostname: 'example.test', search: '' };
  if (mediaQueryList || reducedMotionMediaQueryList) {
    modules.sandbox.window.matchMedia = query => String(query).includes('prefers-reduced-motion')
      ? (reducedMotionMediaQueryList || { matches: false, addEventListener() {} })
      : (mediaQueryList || { matches: false, addEventListener() {} });
  }
  installDashboardModules(modules.sandbox);
  const lines = readSourceLines();
  vm.runInContext(extractModule(lines, 'UiShell') + '\nglobalThis.__dashboardUiShell = UiShell;', modules.sandbox, { filename: 'Notenverwaltung.dashboard-ui.js' });
  return { ...dom, sessionCoordinator: modules.sessionCoordinator, lockManager: modules.lockManager, UiShell: modules.sandbox.__dashboardUiShell, Storage: modules.Storage, DomainModel: modules.DomainModel, password, sandbox: modules.sandbox, storage, logs: modules.logs };
}

async function loadGeneratedDashboardUi({ artifact, state, storage: suppliedStorage = null,
  lockManager = createLockManagerStub(), useExistingStorage = false, encrypted = true,
  password = 'Synthetisches-Testpasswort-2026', promptPassword = null } = {}) {
  const storage = suppliedStorage || localStorageStub();
  const modules = loadModules({ storage, password, lockManager });
  if (encrypted && !useExistingStorage) {
    await modules.sessionCoordinator.acquire();
    await modules.Storage.enableEncryption(password, state || modules.DomainModel.createEmptyState());
    await modules.Storage.lockSession();
  }
  const dom = createStartDocument();
  modules.sandbox.document = dom.document;
  modules.sandbox.window.location = { hostname: 'example.test', search: '' };
  const downloads = [];
  const blobUrls = new Map();
  let nextBlobUrl = 0;
  modules.sandbox.Blob = Blob;
  modules.sandbox.URL = {
    createObjectURL(blob) {
      const url = 'blob:synthetic-generated-artifact-' + (++nextBlobUrl);
      blobUrls.set(url, blob);
      return url;
    },
    revokeObjectURL(url) { blobUrls.delete(url); }
  };
  const originalCreateElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tagName => {
    const element = originalCreateElement(tagName);
    if (String(tagName).toLowerCase() === 'a') {
      element.click = () => {
        const item = {
          blob: blobUrls.get(element.getAttribute('href') || element.href),
          filename: element.getAttribute('download') || element.download
        };
        downloads.push(item);
      };
    }
    return element;
  };
  const scripts = [...String(artifact).matchAll(/<script>\s*([\s\S]*?)\s*<\/script>/g)].map(match => match[1]);
  if (scripts.length !== 2) throw new Error('Das gebaute Dokument enthält nicht die erwarteten Skripte.');
  vm.runInContext(scripts[0], modules.sandbox, { filename: 'Notenverwaltung.early-errors.js' });
  // Expose actual product objects only in this instrumented test bundle.
  const product = scripts[1].replace('var Storage = createStorage({ DomainModel, createInitialState, sessionCoordinator });',
    'var Storage = createStorage({ DomainModel, createInitialState, sessionCoordinator }); globalThis.__generatedSession = { Storage, sessionCoordinator };');
  vm.runInContext(product, modules.sandbox, { filename: 'Notenverwaltung.generated.js' });
  modules.sandbox.window.promptPassword = promptPassword || (async () => password);
  return {
    ...dom, storage, lockManager, downloads, logs: modules.logs,
    ...modules.sandbox.__generatedSession,
    sandbox: modules.sandbox,
    async start() {
      const listeners = dom.documentListeners.get('DOMContentLoaded') || [];
      if (listeners.length !== 1) throw new Error('Das gebaute Dokument registriert nicht genau einen Start-Handler.');
      await listeners[0]();
    }
  };
}

function findByText(root, text) { return root._find(element => element.textContent === text); }
function findByAttribute(root, name, value) { return root._find(element => element.getAttribute && element.getAttribute(name) === value); }

module.exports = { createStartElement, createStartDocument, loadDashboardUi, loadGeneratedDashboardUi, findByText, findByAttribute };
