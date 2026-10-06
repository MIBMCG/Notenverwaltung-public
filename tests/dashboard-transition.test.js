'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('wechselt erst nach abgeschlossenem Schreiben', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  let release;
  let opened = 0;
  const saved = new Promise(resolve => { release = resolve; });
  const gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => { opened++; },
    onFailure: () => assert.fail('unerwarteter Fehler')
  });
  gate.register({ finish: () => saved, focus: () => {} });
  const result = gate.request();
  assert.equal(opened, 0);
  release(true);
  assert.equal(await result, true);
  assert.equal(opened, 1);
});

test('schliesst mehrere Editoren ohne Navigation ab und meldet das aktuelle Register', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const calls = [];
  let opened = 0;
  const gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => { opened++; },
    onFailure: assert.fail
  });
  const first = { finish: async () => { calls.push('first'); return true; }, isClean: () => true, focus: () => {} };
  const second = { finish: async () => { calls.push('second'); return true; }, isClean: () => true, focus: () => {} };
  const unregister = gate.register(first);
  gate.register(second);

  assert.deepEqual(gate.listEditors(), [first, second]);
  assert.equal(await gate.finishActiveEditors(), true);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(opened, 0);
  unregister();
  assert.deepEqual(gate.listEditors(), [second]);
});

test('fokussiert den Editor und beendet den Wechsel bei einem offenen Entwurf', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  let focused = 0;
  let opened = 0;
  const gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => { opened++; },
    onFailure: () => assert.fail('unerwarteter Fehler')
  });
  gate.register({ finish: async () => false, focus: () => { focused++; } });

  assert.equal(await gate.request(), false);
  assert.equal(focused, 1);
  assert.equal(opened, 0);
});

test('meldet einen Speicherfehler und fokussiert nur den noch gültigen Editor', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const failures = [];
  let focused = 0;
  const gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => assert.fail('darf nicht navigieren'),
    onFailure: error => failures.push(error.message)
  });
  gate.register({ finish: async () => { throw new Error('verschlüsseltes Speichern fehlgeschlagen'); }, focus: () => { focused++; } });

  assert.equal(await gate.request(), false);
  assert.deepEqual(failures, ['verschlüsseltes Speichern fehlgeschlagen']);
  assert.equal(focused, 1);
});

test('teilt einen laufenden Wechsel bei zweifachem Klick', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const save = deferred();
  let finishes = 0;
  let opened = 0;
  const gate = createDashboardTransition({ isAllowed: () => true, onReady: () => { opened++; }, onFailure: assert.fail });
  gate.register({ finish: () => { finishes++; return save.promise; }, focus: () => {} });

  const first = gate.request();
  const second = gate.request();
  assert.strictEqual(second, first);
  assert.equal(finishes, 1);
  save.resolve(true);
  assert.equal(await first, true);
  assert.equal(opened, 1);
});

test('bricht bei einer Sperre während des Schreibens ohne Navigation ab', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const save = deferred();
  let allowed = true;
  let opened = 0;
  const gate = createDashboardTransition({ isAllowed: () => allowed, onReady: () => { opened++; }, onFailure: assert.fail });
  gate.register({ finish: () => save.promise, focus: () => assert.fail('bei Sperre nicht fokussieren') });

  const result = gate.request();
  allowed = false;
  save.resolve(true);
  assert.equal(await result, false);
  assert.equal(opened, 0);
});

test('ignoriert vor dem Wechsel entfernte Editoren', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  let finishes = 0;
  let opened = 0;
  const gate = createDashboardTransition({ isAllowed: () => true, onReady: () => { opened++; }, onFailure: assert.fail });
  const unregister = gate.register({ finish: async () => { finishes++; return true; }, focus: () => {} });
  unregister();

  assert.equal(await gate.request(), true);
  assert.equal(finishes, 0);
  assert.equal(opened, 1);
});

test('eine Invalidierung laesst einen neuen Wechsel gewinnen und der alte Abschluss raeumt ihn nicht ab', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const firstSave = deferred();
  let phase = 'old';
  let opened = 0;
  const gate = createDashboardTransition({ isAllowed: () => true, onReady: () => { opened++; }, onFailure: assert.fail });
  gate.register({ finish: () => phase === 'old' ? firstSave.promise : Promise.resolve(true), focus: () => {} });

  const oldRequest = gate.request();
  gate.invalidate();
  phase = 'new';
  assert.equal(await gate.request(), true);
  firstSave.resolve(true);
  assert.equal(await oldRequest, false);
  assert.equal(await gate.request(), true);
  assert.equal(opened, 2);
});

test('eine erfolgreiche Navigation bleibt erfolgreich, wenn onReady die Sitzung invalidiert', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  let gate;
  let opened = 0;
  gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => { opened++; gate.invalidate(); },
    onFailure: assert.fail
  });

  assert.equal(await gate.request(), true);
  assert.equal(opened, 1);
});

test('prüft nach einem asynchronen Editor alle Editoren erneut vor der finalen Navigation', async () => {
  const { createDashboardTransition } = await importEsmSource('src/ui/dashboard-transition.js');
  const laterSave = deferred();
  const firstResave = deferred();
  let firstDirty = false;
  let firstFinishes = 0;
  let laterFinishes = 0;
  let opened = 0;
  const gate = createDashboardTransition({
    isAllowed: () => true,
    onReady: () => { opened += 1; },
    onFailure: assert.fail
  });
  gate.register({
    finish() {
      firstFinishes += 1;
      if (!firstDirty) return true;
      return firstResave.promise.then(() => { firstDirty = false; return true; });
    },
    isClean: () => !firstDirty,
    focus: () => {}
  });
  gate.register({
    finish() {
      laterFinishes += 1;
      return laterFinishes === 1 ? laterSave.promise : true;
    },
    isClean: () => true,
    focus: () => {}
  });

  const result = gate.request();
  firstDirty = true;
  laterSave.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 0, 'eine Änderung am bereits geprüften Editor darf nicht verworfen werden');
  assert.equal(firstFinishes, 2, 'der erste Editor muss nach dem späteren await erneut abgeschlossen werden');
  firstResave.resolve();
  assert.equal(await result, true);
  assert.equal(opened, 1);
});
