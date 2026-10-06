'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText } = require('./harness/dashboard-app');

test('die Seitenleiste lädt das austauschbare lokale Schullogo und zeigt es nach erfolgreichem Laden', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  const brand = app.root.querySelector('.sidebar-brand');
  const logo = brand.querySelector('img');
  assert.ok(logo, 'das Schullogo muss eingebunden sein');
  assert.equal(logo.getAttribute('src'), 'Logo.png');
  assert.equal(logo.getAttribute('alt'), 'Schullogo');
  await logo.dispatch('load');
  assert.equal(logo.hidden, false);
  assert.equal(brand.querySelector('.sidebar-monogram').hidden, true);
});

test('ein fehlendes Schullogo fällt auf ein neutrales Kürzel zurück und lässt die Navigation bedienbar', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  const brand = app.root.querySelector('.sidebar-brand');
  const logo = brand.querySelector('img');
  assert.ok(logo, 'ein Ladefehler muss am echten Bild behandelt werden');
  await logo.dispatch('error');
  await logo.dispatch('error');
  assert.equal(logo.hidden, true);
  const fallback = brand.querySelector('.sidebar-monogram');
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.textContent, 'NV');
  await findByText(app.root, 'Kurse').dispatch('click');
  assert.equal(app.root.querySelector('h2').textContent, 'Kurse');
});
