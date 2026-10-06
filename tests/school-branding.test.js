'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load');
const { loadDashboardUi, findByText } = require('./harness/dashboard-app');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwTpv5HwAENAIyWy0K4AAAAABJRU5ErkJggg==';
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settingsApp(state) {
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await findByText(app.root, 'Einstellungen').dispatch('click');
  return app;
}

test('fresh school profile is neutral; migration adds a generic name only when the profile is missing', () => {
  const { DomainModel: domain } = loadModules();
  const fresh = domain.createEmptyState();
  assert.ok(fresh.settings.schoolProfile, 'fresh state includes a school profile');
  assert.deepEqual(plain(fresh.settings.schoolProfile), { name: '', logoMode: 'auto', logoDataUrl: '' });
  delete fresh.settings.schoolProfile;
  const migrated = domain.ensureStateShape(fresh);
  assert.deepEqual(plain(migrated.settings.schoolProfile), { name: 'Meine Schule', logoMode: 'auto', logoDataUrl: '' });

  for (const profile of [
    { name: '', logoMode: 'auto', logoDataUrl: '' },
    { name: 'Eigene Schule', logoMode: 'custom', logoDataUrl: PNG },
    { name: '', logoMode: 'none', logoDataUrl: '' }
  ]) {
    const existing = domain.createEmptyState();
    existing.settings.schoolProfile = profile;
    assert.deepEqual(plain(domain.ensureStateShape(existing).settings.schoolProfile), profile);
  }
});

test('school name saves across sidebar, about, browser title, reload and encrypted backup', async () => {
  const app = await settingsApp();
  const input = app.document.getElementById('settings-school-name');
  assert.ok(input, 'editable school name exists');
  input.value = 'Testschule & <Campus>';
  await input.dispatch('input');
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.match(app.root.querySelector('.sidebar-brand').textContent, /Testschule & <Campus>/);
  assert.match(app.document.getElementById('settings-area-about-panel').textContent, /Testschule & <Campus>/);
  assert.match(app.document.title, /Testschule & <Campus>/);
  assert.doesNotMatch(app.root.textContent, /Hildegard|Wegscheider|\bHWG\b/);
  const persisted = await app.Storage.loadState();
  assert.equal(persisted.settings.schoolProfile.name, 'Testschule & <Campus>');
  const backup = await app.Storage.exportStateEncrypted(app.password, persisted);
  const restored = await app.Storage.importStateEncryptedFromText(backup, app.password);
  assert.equal(restored.settings.schoolProfile.name, 'Testschule & <Campus>');
  const reloaded = await loadDashboardUi({ state: restored });
  await reloaded.UiShell.init('app');
  assert.match(reloaded.root.querySelector('.sidebar-brand').textContent, /Testschule & <Campus>/);
});

test('automatic logo tries Logo.png then the bundled neutral placeholder in shell and settings', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  const logo = app.root.querySelector('.sidebar-logo');
  assert.equal(logo.getAttribute('src'), 'Logo.png');
  await logo.dispatch('error');
  assert.equal(logo.getAttribute('src'), 'placeholder-logo.svg');
  await logo.dispatch('error');
  assert.equal(logo.hidden, true);
  assert.doesNotMatch(app.root.querySelector('.sidebar-monogram').textContent, /HWG/);

  const settings = await settingsApp();
  const preview = settings.document.getElementById('settings-school-preview').querySelector('img');
  assert.equal(preview.getAttribute('src'), 'Logo.png');
  await preview.dispatch('error');
  assert.equal(preview.getAttribute('src'), 'placeholder-logo.svg');
  assert.match(settings.root.textContent, /zuerst Logo\.png und danach placeholder-logo\.svg/);
});

test('custom PNG survives encryption and overrides files; removing logo explicitly disables fallback', async () => {
  const { DomainModel } = loadModules();
  const state = DomainModel.createEmptyState();
  state.settings.schoolProfile = { name: 'Testschule', logoMode: 'custom', logoDataUrl: PNG };
  const app = await settingsApp(state);
  assert.equal(app.root.querySelector('.sidebar-logo').getAttribute('src'), PNG);
  const restored = await app.Storage.loadState();
  assert.equal(restored.settings.schoolProfile.logoDataUrl, PNG);
  const backup = await app.Storage.exportStateEncrypted(app.password, restored);
  assert.equal((await app.Storage.importStateEncryptedFromText(backup, app.password)).settings.schoolProfile.logoDataUrl, PNG);
  await findByText(app.root, 'Logo entfernen').dispatch('click');
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoMode, 'none');
  assert.equal(app.root.querySelector('.sidebar-logo'), null);
});

test('saving an unchanged profile keeps the form usable for the next edit', async () => {
  const app = await settingsApp();
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal(app.document.getElementById('settings-school-save').disabled, false);
  assert.equal(app.document.getElementById('settings-school-name').disabled, false);
});

test('PNG selection accepts an arbitrary filename, previews and persists its content', async () => {
  const app = await settingsApp();
  app.sandbox.FileReader = class {
    readAsDataURL() { this.result = PNG; this.onload(); }
  };
  app.sandbox.Image = class {
    set src(value) { this.naturalWidth = 1; this.naturalHeight = 1; this.onload(); }
  };
  const input = app.document.getElementById('settings-school-logo');
  assert.ok(input);
  input.files = [{ name: 'Mein Schullogo beliebig.png', type: 'image/png', size: 68 }];
  await input.dispatch('change');
  const preview = app.document.getElementById('settings-school-preview').querySelector('img');
  assert.equal(preview.getAttribute('src'), PNG);
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoDataUrl, PNG);
});

test('invalid or oversized file keeps previous logo; cancelling the chooser keeps the draft', async () => {
  const app = await settingsApp();
  app.sandbox.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
      this.onload();
    }
  };
  app.sandbox.Image = class { set src(value) { this.onerror(); } };
  const input = app.document.getElementById('settings-school-logo');
  assert.ok(input);
  for (const file of [{ type: 'image/png', size: 262145 }, { type: 'image/svg+xml', size: 200 }]) {
    input.files = [file];
    await input.dispatch('change');
    assert.match(app.document.getElementById('settings-school-status').textContent, /PNG/);
    assert.equal(app.document.getElementById('settings-school-save').disabled, false);
  }
  await findByText(app.root, 'Logo entfernen').dispatch('click');
  input.files = [];
  await input.dispatch('change');
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoMode, 'none');
});

test('a stale image read cannot undo a later explicit logo removal', async () => {
  const app = await settingsApp();
  let reader;
  app.sandbox.FileReader = class { readAsDataURL() { reader = this; } };
  app.sandbox.Image = class { set src(value) { this.naturalWidth = 1; this.naturalHeight = 1; this.onload(); } };
  const input = app.document.getElementById('settings-school-logo');
  assert.ok(input);
  input.files = [{ type: 'image/png', size: 68 }];
  const reading = input.dispatch('change');
  assert.equal(app.document.getElementById('settings-school-save').disabled, true);
  await findByText(app.root, 'Logo entfernen').dispatch('click');
  reader.result = PNG; reader.onload(); await reading;
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoMode, 'none');
});

test('clearing school name hides subtitle and removes school from about and title', async () => {
  const { DomainModel } = loadModules();
  const state = DomainModel.createEmptyState();
  state.settings.schoolProfile = { name: 'Testschule', logoMode: 'none', logoDataUrl: '' };
  const app = await settingsApp(state);
  const input = app.document.getElementById('settings-school-name');
  assert.ok(input);
  input.value = '';
  await input.dispatch('input');
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal(app.root.querySelector('.sidebar-brand').querySelector('small'), null);
  assert.doesNotMatch(app.document.title + app.document.getElementById('settings-area-about-panel').textContent, /Testschule|Hildegard|HWG/);
});

test('failed save retains old branding and editable draft', async () => {
  const app = await settingsApp();
  const input = app.document.getElementById('settings-school-name');
  assert.ok(input);
  input.value = 'Nicht gespeichert';
  await input.dispatch('input');
  app.Storage.saveState = async () => { throw new Error('Speicher voll'); };
  await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.doesNotMatch(app.root.querySelector('.sidebar-brand').textContent, /Nicht gespeichert/);
  assert.equal(app.document.getElementById('settings-school-name').value, 'Nicht gespeichert');
  assert.match(app.document.getElementById('settings-school-status').textContent, /nicht gespeichert/i);
});

test('unsafe imported logo sources are discarded and cannot request Internet content', () => {
  const { DomainModel } = loadModules();
  for (const value of ['https://example.invalid/logo.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,not-an-image']) {
    const state = DomainModel.createEmptyState();
    state.settings.schoolProfile = { name: ' Testschule ', logoMode: 'custom', logoDataUrl: value };
    const result = DomainModel.ensureStateShape(state).settings.schoolProfile;
    assert.equal(result.name, 'Testschule');
    assert.equal(result.logoDataUrl, '');
    assert.equal(result.logoMode, 'none');
  }
});

test('merging another data set preserves the local school profile', () => {
  const { DomainModel, ImportMerge } = loadModules();
  const local = DomainModel.createEmptyState();
  const incoming = DomainModel.createEmptyState();
  local.settings.schoolProfile = { name: 'Lokale Testschule', logoMode: 'custom', logoDataUrl: PNG };
  incoming.settings.schoolProfile = { name: 'Andere Testschule', logoMode: 'none', logoDataUrl: '' };
  const result = ImportMerge.mergeImportedStateIntoCurrent(local, incoming);
  assert.deepEqual(plain(result.state.settings.schoolProfile), plain(local.settings.schoolProfile));
});

test('saving prevents duplicate profile writes and restores the form after success or failure without blocking other settings', async () => {
  for (const fail of [false, true]) {
    const app = await settingsApp();
    const originalSave = app.Storage.saveState.bind(app.Storage);
    const priorName = (await app.Storage.loadState()).settings.schoolProfile.name;
    const input = app.document.getElementById('settings-school-name');
    input.value = 'Synthetische Profilspeicherung';
    await input.dispatch('input');
    let finish;
    let writes = 0;
    app.Storage.saveState = async candidate => {
      writes++;
      await new Promise(resolve => { finish = resolve; });
      if (fail) throw new Error('full');
      return originalSave(candidate);
    };
    const save = findByText(app.root, 'Schule und Logo speichern');
    const saving = save.dispatch('click');
    assert.equal(save.disabled, true, 'the same profile draft cannot be submitted twice');
    assert.equal(Boolean(app.root.inert), false, 'independent settings use the common commit queue');
    await new Promise(resolve => setImmediate(resolve));
    await save.dispatch('click');
    assert.equal(writes, 1);
    finish(); await saving;
    assert.equal(Boolean(app.root.inert), false);
    assert.equal(app.document.getElementById('settings-school-save').disabled, false);
    assert.equal(app.document.getElementById('settings-school-name').value, 'Synthetische Profilspeicherung',
      'the editable draft remains available after a failed save');
    assert.equal((await app.Storage.loadState()).settings.schoolProfile.name,
      fail ? priorName : 'Synthetische Profilspeicherung');
  }
});

test('failed school save overlapping backup keeps the logo picker frozen until capture ends, then permits retry', async () => {
  const app = await settingsApp();
  const file = app.document.getElementById('settings-school-logo');
  const name = app.document.getElementById('settings-school-name');
  const save = app.document.getElementById('settings-school-save');
  const backup = app.root._find(element => element.className === 'header-action header-action-primary');
  const downloads = [];
  app.sandbox.downloadBlobFile = content => downloads.push(content);
  name.value = 'Nicht gespeicherte Schule';
  await name.dispatch('input');

  const saveStarted = deferred();
  const failSave = deferred();
  const flushStarted = deferred();
  const releaseFlush = deferred();
  const originalSave = app.Storage.saveState.bind(app.Storage);
  const originalFlush = app.Storage.flushPendingWrites.bind(app.Storage);
  app.Storage.saveState = async candidate => {
    saveStarted.resolve();
    await failSave.promise;
    return originalSave(candidate);
  };
  app.Storage.flushPendingWrites = async () => {
    flushStarted.resolve();
    await releaseFlush.promise;
    return originalFlush();
  };

  const saving = save.dispatch('click');
  await saveStarted.promise;
  assert.equal(file.disabled, true, 'the pending school save disables its picker');
  const backingUp = backup.dispatch('click');
  failSave.reject(new Error('synthetic quota failure'));
  let disabledWhileCaptureWaited;
  try {
    await Promise.all([saving, flushStarted.promise]);
    disabledWhileCaptureWaited = file.disabled;
    assert.equal(downloads.length, 0);
  } finally {
    releaseFlush.resolve();
  }
  await backingUp;
  assert.equal(app.document.getElementById('settings-school-logo') === file, true);
  assert.equal(file.disabled, false, 'failed save cleanup must leave the picker usable');
  assert.equal(disabledWhileCaptureWaited, true, 'the picker must stay frozen until capture ends');
  assert.equal(name.disabled, false);
  assert.match(app.document.getElementById('settings-school-status').textContent, /nicht gespeichert/i);

  app.Storage.saveState = originalSave;
  app.Storage.flushPendingWrites = originalFlush;
  name.value = 'Korrigierte Schule';
  await name.dispatch('input');
  await save.dispatch('click');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.name, 'Korrigierte Schule');
  await backup.dispatch('click');
  assert.equal(downloads.length, 1);
  const restored = JSON.parse(await app.Storage._decryptPayload(downloads[0], app.password));
  assert.equal(restored.settings.schoolProfile.name, 'Korrigierte Schule');
});

test('failed school save restores current form after an earlier save rerenders it', async () => {
  const app = await settingsApp();
  const queued = [];
  app.Storage.saveState = state => new Promise((resolve, reject) => {
    queued.push({ snapshot: plain(state), resolve, reject });
  });
  const category = app.document.getElementById('settings-category-name-0');
  category.value = 'Umbenannt';
  const categorySaving = category.dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  const name = app.document.getElementById('settings-school-name');
  name.value = 'Neue Schule';
  await name.dispatch('input');
  const saving = findByText(app.root, 'Schule und Logo speichern').dispatch('click');
  assert.equal(queued.length, 1);
  assert.equal(Boolean(app.root.inert), false);
  queued[0].resolve();
  await categorySaving;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queued.length, 2);
  assert.notEqual(app.document.getElementById('settings-school-name'), name);
  assert.equal(queued[1].snapshot.settings.schoolProfile.name, 'Neue Schule');
  assert.equal(queued[1].snapshot.settings.categories[0].name, 'Umbenannt');
  queued[1].reject(new Error('Speicher voll'));
  await saving;
  assert.equal(Boolean(app.root.inert), false);
  assert.equal(app.document.getElementById('settings-school-save').disabled, false);
  assert.equal(app.document.getElementById('settings-school-name').disabled, false);
  assert.equal(app.document.getElementById('settings-school-name').value, 'Neue Schule');
  assert.match(app.document.getElementById('settings-school-status').textContent, /nicht gespeichert/i);
});

test('late file read cannot restore a discarded draft or expose branding on the lock screen', async () => {
  for (const action of ['discard', 'lock']) {
    const app = await settingsApp();
    let reader;
    app.sandbox.FileReader = class { readAsDataURL() { reader = this; } };
    app.sandbox.Image = class { set src(value) { this.naturalWidth = 1; this.naturalHeight = 1; this.onload(); } };
    const input = app.document.getElementById('settings-school-logo');
    input.files = [{ type: 'image/png', size: 68 }];
    const reading = input.dispatch('change');
    if (action === 'lock') app.Storage.lockSession();
    else await findByText(app.root, 'Änderungen verwerfen').dispatch('click');
    reader.result = PNG; reader.onload(); await reading;
    if (action === 'lock') {
      assert.ok(findByText(app.root, 'Anwendung gesperrt'));
      assert.doesNotMatch(app.document.title + app.root.textContent, /Hildegard|HWG/);
      assert.equal(app.root.querySelector('.school-logo-image'), null);
    } else {
      await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
      assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoMode, 'auto');
    }
  }
});

test('undecodable and too-large PNG dimensions leave prior logo choice intact', async () => {
  for (const scenario of ['decode', 'dimensions']) {
    const app = await settingsApp();
    app.sandbox.FileReader = class { readAsDataURL() { this.result = PNG; this.onload(); } };
    app.sandbox.Image = class { set src(value) {
      if (scenario === 'decode') this.onerror();
      else { this.naturalWidth = 5000; this.naturalHeight = 1; this.onload(); }
    } };
    const input = app.document.getElementById('settings-school-logo');
    input.files = [{ type: 'image/png', size: 68 }];
    await input.dispatch('change');
    assert.match(app.document.getElementById('settings-school-status').textContent, /nicht geladen|4096/);
    await findByText(app.root, 'Schule und Logo speichern').dispatch('click');
    assert.equal((await app.Storage.loadState()).settings.schoolProfile.logoMode, 'auto');
  }
});
