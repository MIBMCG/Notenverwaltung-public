'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { installFormattingGlobals } = require('./harness/install-formatting.js');

const modulePath = path.join(__dirname, '..', 'src', 'infrastructure', 'downloads.js');

test('Wave 4.1: download module loads without touching browser APIs', () => {
  assert.ok(fs.existsSync(modulePath), 'download infrastructure module missing');
  const sandbox = {};
  vm.createContext(sandbox);
  const source = fs.readFileSync(modulePath, 'utf8').replace(/^export\s+/gm, '');
  vm.runInContext(source + '\nglobalThis.download = downloadBlobFile;', sandbox);
  assert.equal(typeof sandbox.download, 'function');
});

function createDocumentStub({ anchorClickError = null } = {}) {
  const created = [];
  const body = {
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
  };

  function createElement(tagName) {
    const element = {
      tagName: String(tagName).toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      _listeners: new Map(),
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      addEventListener(type, listener) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(listener);
      },
      setAttribute(name, value) { this[name] = String(value); },
      click() {
        this.clicked = true;
        if (this.tagName === 'A' && anchorClickError) throw anchorClickError;
        return Promise.all(
          Array.from(this._listeners.get('click') || [], listener => listener.call(this, { target: this }))
        );
      },
      remove() {
        this.removed = true;
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
          this.parentNode = null;
        }
      }
    };
    created.push(element);
    return element;
  }

  return { document: { body, createElement, createElementNS(namespaceURI, tagName) { const element = createElement(tagName); element.namespaceURI = namespaceURI; return element; } }, created };
}

function loadDownloadHelper({ anchorClickError = null } = {}) {
  const { document, created } = createDocumentStub({ anchorClickError });
  const createdBlobs = [];
  const revokedUrls = [];
  const sandbox = {
    Blob,
    document,
    URL: {
      createObjectURL(blob) {
        createdBlobs.push(blob);
        return 'blob:m18-backup';
      },
      revokeObjectURL(url) { revokedUrls.push(url); }
    }
  };
  vm.createContext(sandbox);
  installDownloads(sandbox);
  return { downloadBlobFile: sandbox.downloadBlobFile, created, createdBlobs, revokedUrls };
}

function installDownloads(sandbox) {
  const source = fs.readFileSync(modulePath, 'utf8').replace(/^export\s+/gm, '');
  vm.runInContext(source + '\nglobalThis.downloadBlobFile = downloadBlobFile;', sandbox,
    { filename: 'src/infrastructure/downloads.js' });
}

function installHeaderNavigationDependencies(sandbox) {
  sandbox.navigationMenuOpen = false;
  sandbox.navigationMenuElement = null;
  sandbox.navigationMenuToggle = null;
  sandbox.setNavigationMenuOpen = open => {
    sandbox.navigationMenuOpen = !!open;
    if (sandbox.navigationMenuToggle) {
      sandbox.navigationMenuToggle.setAttribute('aria-expanded', sandbox.navigationMenuOpen ? 'true' : 'false');
      sandbox.navigationMenuToggle.textContent = sandbox.navigationMenuOpen ? 'Navigation schließen' : 'Navigation öffnen';
    }
  };
}

function findElement(element, predicate) {
  if (!element) return null;
  if (predicate(element)) return element;
  for (const child of element.children || []) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test('M18: the real backup download helper uses a Blob URL and always releases it', async () => {
  const harness = loadDownloadHelper();
  const result = harness.downloadBlobFile('encrypted-payload', 'application/json;charset=utf-8', 'backup.enc.json');

  assert.equal(result, undefined);
  assert.equal(harness.createdBlobs.length, 1);
  assert.equal(harness.createdBlobs[0].type, 'application/json;charset=utf-8');
  assert.equal(await harness.createdBlobs[0].text(), 'encrypted-payload');
  const anchor = harness.created.find(element => element.tagName === 'A');
  assert.ok(anchor);
  assert.equal(anchor.href, 'blob:m18-backup');
  assert.equal(anchor.download, 'backup.enc.json');
  assert.equal(anchor.clicked, true);
  assert.equal(anchor.removed, true);
  assert.deepEqual(harness.revokedUrls, ['blob:m18-backup']);
});

test('M18: the backup download helper cleans up when the browser rejects the click', () => {
  const harness = loadDownloadHelper({ anchorClickError: new Error('download blocked') });
  assert.throws(
    () => harness.downloadBlobFile('encrypted-payload', 'application/json;charset=utf-8', 'backup.enc.json'),
    /download blocked/
  );
  const anchor = harness.created.find(element => element.tagName === 'A');
  assert.equal(anchor.removed, true);
  assert.deepEqual(harness.revokedUrls, ['blob:m18-backup']);
});

async function assertHeaderBackupDownload(lines, { installDownloadHelper = false, extractDownloadHelper = false, filename }) {
  const { document, created } = createDocumentStub();
  const alerts = [];
  const createdBlobs = [];
  const revokedUrls = [];
  const state = { courses: [], students: [{ id: 'synthetic-student' }] };
  const sandbox = {
    Blob,
    document,
    URL: {
      createObjectURL(blob) { createdBlobs.push(blob); return 'blob:m18-header-backup'; },
      revokeObjectURL(url) { revokedUrls.push(url); }
    },
    APP_RELEASE: { version: '1.2.0', dateLabel: '30.08.2026' },
    DomainModel: { listActiveCourses: () => [] },
    backupInProgress: false,
    startManualLock() {},
    uiStateEpoch: 0,
    dashboardIsAllowed: () => true,
    sessionCoordinator: { getStatus: () => 'held' },
    persistenceBoundary: { capture: async () => ({ ok: true, snapshot: state }) },
    Storage: {
      hasSessionPassword: () => true,
      encryptForBackup: async json => {
        assert.equal(json, JSON.stringify(state, null, 2));
        return 'encrypted-header-payload';
      },
      lockSession() {},
      resetState: async () => state
    },
    state,
    currentTheme: 'light',
    currentCourseId: null,
    setCurrentCourse() {},
    toggleTheme() {},
    render() {},
    window: {
      alert(message) { alerts.push(message); },
      confirm: () => false,
      promptPassword: async () => null
    },
    Date
  };
  vm.createContext(sandbox);
  installFormattingGlobals(sandbox);
  installHeaderNavigationDependencies(sandbox);
  if (installDownloadHelper) installDownloads(sandbox);
  const source = [
    ...(extractDownloadHelper ? [extractFunction(lines, 'downloadBlobFile')] : []),
    extractFunction(lines, 'createUiIcon'),
    extractFunction(lines, 'renderHeader'),
    'globalThis.__renderHeader = renderHeader;'
  ].join('\n\n');
  vm.runInContext(source, sandbox, { filename });

  const container = document.createElement('main');
  sandbox.__renderHeader(container);
  const navigationToggle = findElement(container, element => element.textContent === 'Navigation öffnen');
  assert.ok(navigationToggle);
  assert.equal(navigationToggle['aria-controls'], 'main-navigation');
  assert.equal(navigationToggle['aria-expanded'], 'false');
  const backupButton = findElement(container, element => element.className === 'header-action header-action-primary');
  assert.ok(backupButton);
  await backupButton.click();

  assert.equal(createdBlobs.length, 1);
  assert.equal(createdBlobs[0].type, 'text/json;charset=utf-8');
  assert.equal(await createdBlobs[0].text(), 'encrypted-header-payload');
  const anchor = created.find(element => element.tagName === 'A');
  assert.match(anchor.download, /^notenverwaltung_backup_.*\.enc\.json$/);
  assert.equal(anchor.href, 'blob:m18-header-backup');
  assert.equal(anchor.removed, true);
  assert.deepEqual(revokedUrls, ['blob:m18-header-backup']);
  assert.deepEqual(alerts, ['Backup-Download gestartet. Bitte Datei im Downloadordner prüfen.']);
}

test('M18: clicking the real header backup button downloads the encrypted payload through the Blob helper', async () => {
  await assertHeaderBackupDownload(readSourceLines(), {
    installDownloadHelper: true,
    filename: 'renderHeader.backup.js'
  });
});

test('Wave 4.1: the bundled header backup button uses the extracted download helper', async () => {
  const artifactPath = path.join(__dirname, '..', 'Notenverwaltung.html');
  const artifactLines = fs.readFileSync(artifactPath, 'utf8').split(/\r?\n/);
  await assertHeaderBackupDownload(artifactLines, {
    extractDownloadHelper: true,
    filename: 'Notenverwaltung.html'
  });
});
