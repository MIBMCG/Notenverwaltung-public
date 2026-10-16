'use strict';
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));
const button = (app, text) => app.document.body._findAll(node => node.tagName === 'BUTTON' && node.textContent === text).at(-1);
const field = (app, label) => app.document.body._find(node => node.getAttribute('aria-label') === label);
async function waitFor(app, predicate, description) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const found = predicate(); if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Recovery UI not reached: ' + description);
}
async function click(app, text) { const node = await waitFor(app, () => button(app, text), text); await node.dispatch('click'); await tick(); }
async function confirmCode(app) {
  const code = await waitFor(app, () => app.document.body._find(node => node.dataset.recoveryCode === 'true'), 'code view');
  const savedCode = code.textContent;
  await click(app, 'Code gesichert – weiter');
  assert.ok(!app.document.body.textContent.includes(savedCode), 'code view is absent during reentry');
  field(app, 'Wiederherstellungscode vollständig eingeben').value = savedCode;
  await click(app, 'Code bestätigen und speichern');
  await click(app, 'Fertig');
  return savedCode;
}
async function completeSetup(app, trigger, password = app.password) {
  const pending = trigger.dispatch('click');
  await waitFor(app, () => field(app, 'Neues Passwort'), 'new password');
  field(app, 'Neues Passwort').value = password;
  field(app, 'Neues Passwort wiederholen').value = password;
  await click(app, 'Weiter');
  const code = await confirmCode(app); await pending; return code;
}
module.exports = { button, field, waitFor, click, confirmCode, completeSetup, tick };
