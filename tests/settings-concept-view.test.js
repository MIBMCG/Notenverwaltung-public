'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { loadModules } = require('./harness/load');

async function settleRender() {
  await new Promise(resolve => setImmediate(resolve));
}

async function waitForRender(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await settleRender();
  }
  assert.fail(message);
}

async function settingsApp(options = {}) {
  const app = await loadDashboardUi(options);
  await app.UiShell.init('app');
  if (findByText(app.root, 'Verschlüsselung jetzt einrichten')) return app;
  await findByText(app.root, 'Einstellungen').dispatch('click');
  await settleRender();
  return app;
}

function areaTab(app, area) {
  return findByAttribute(app.root, 'data-settings-area', area);
}

function areaPanel(app, area) {
  return findByAttribute(app.root, 'data-settings-panel', area);
}

function stageTab(app, stage) {
  return findByAttribute(app.root, 'data-settings-stage', stage);
}

function stagePanel(app, stage) {
  return findByAttribute(app.root, 'data-settings-stage-panel', stage);
}

test('die echten Einstellungen gliedern alle vorhandenen Inhalte in fünf zugängliche Bereiche', async () => {
  const app = await settingsApp();
  const navigation = app.root._find(element => element.getAttribute &&
    element.getAttribute('aria-label') === 'Einstellungsbereiche');
  assert.ok(navigation, 'die Bereichsnavigation muss im echten Renderer vorhanden sein');
  const tabs = navigation._findAll(element => element.getAttribute &&
    element.getAttribute('data-settings-area'));

  assert.equal(tabs.length, 5);
  assert.deepEqual(tabs.map(tab => tab.textContent), [
    'Schuljahr & Zeiträume', 'Bewertung', 'Sicherheit', 'Schule und Logo', 'Über die Anwendung'
  ]);
  assert.equal(navigation.getAttribute('role'), 'tablist');
  assert.equal(areaTab(app, 'periods').getAttribute('aria-selected'), 'true');
  assert.equal(areaPanel(app, 'periods').hidden, false);
  assert.equal(areaPanel(app, 'grading').hidden, true);
  assert.equal(areaPanel(app, 'security').hidden, true);
  assert.equal(areaPanel(app, 'about').hidden, true);

  await areaTab(app, 'grading').dispatch('click');
  assert.equal(areaPanel(app, 'periods').hidden, true);
  assert.equal(areaPanel(app, 'grading').hidden, false);
  assert.match(areaPanel(app, 'grading').textContent, /Kategorien \(Bewertungsbereiche\)/);
  assert.match(areaPanel(app, 'grading').textContent, /Gewichtungsvorlagen/);
  assert.match(areaPanel(app, 'grading').textContent, /Grade-Mapping/);

  await areaTab(app, 'security').dispatch('click');
  assert.match(areaPanel(app, 'security').textContent, /Sitzungspasswort-Timeout/);
  assert.match(areaPanel(app, 'security').textContent, /Verschlüsselung:/);

  await areaTab(app, 'about').dispatch('click');
  assert.match(areaPanel(app, 'about').textContent, /Programmversion/);
  assert.match(areaPanel(app, 'about').textContent, /fachliche und rechtliche Verantwortung/);
});

test('R07/R22: Zeitraumänderungen behalten manuelle Zuordnungen und berechnen nur aktive automatische Leistungen neu', async () => {
  const seed = loadModules();
  const state = seed.DomainModel.createEmptyState();
  for (const stage of ['seckI', 'seckII']) {
    Object.assign(state.settings.halfYearSettings[stage], {
      schoolYearStartYear: 2026,
      schoolYearStartMonth: 9,
      schoolYearStartDay: 1,
      h1EndYear: 2027,
      h1EndMonth: 2,
      h1EndDay: 28,
      h2StartYear: 2027,
      h2StartMonth: 2,
      h2StartDay: 1
    });
  }
  const categoryId = state.settings.categories[0].id;
  const activeCourse = seed.DomainModel.createCourse({
    id: 'term-recalc-active', name: 'Biologie', subject: 'Biologie', classLabel: '10a'
  });
  seed.DomainModel.addCourseToState(state, activeCourse);
  for (const [id, termAssignment] of [['manual-assessment', 'manual'], ['auto-assessment', 'auto']]) {
    seed.DomainModel.addAssessmentToState(state, seed.DomainModel.createAssessment({
      id,
      courseId: activeCourse.id,
      categoryId,
      title: id,
      date: '2027-02-05',
      term: '2026-H2',
      termAssignment
    }));
  }
  const archivedCourse = seed.DomainModel.createCourse({
    id: 'term-recalc-archived', name: 'Archivkurs', subject: 'Biologie', classLabel: '9a'
  });
  seed.DomainModel.addCourseToState(state, archivedCourse);
  seed.DomainModel.addAssessmentToState(state, seed.DomainModel.createAssessment({
    id: 'archived-auto-assessment',
    courseId: archivedCourse.id,
    categoryId,
    title: 'Archivleistung',
    date: '2027-02-05',
    term: '2026-H2',
    termAssignment: 'auto'
  }));
  seed.DomainModel.archiveCourse(state, archivedCourse.id, 'manual', {});

  const app = await settingsApp({ state });
  assert.match(areaPanel(app, 'periods').textContent, /H2-Start.*Vorrang/i);
  assert.match(areaPanel(app, 'periods').textContent, /Lücke.*H1.*Überlappung.*H2/i);
  for (const stage of ['seckI', 'seckII']) {
    findByAttribute(app.root, 'id', `settings-${stage}-school-year-start`).value = '2026-09-01';
    findByAttribute(app.root, 'id', `settings-${stage}-h1-end`).value = '2027-03-31';
    findByAttribute(app.root, 'id', `settings-${stage}-h2-start`).value = '2027-03-01';
  }
  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');

  let stored = await app.Storage.loadState();
  assert.deepEqual(
    JSON.parse(JSON.stringify(stored.assessments.filter(assessment => assessment.courseId === activeCourse.id)
      .map(assessment => [assessment.id, assessment.term, assessment.termAssignment]))),
    [
      ['manual-assessment', '2026-H2', 'manual'],
      ['auto-assessment', '2026-H1', 'auto']
    ]
  );
  assert.equal(stored.assessments.find(assessment => assessment.id === 'archived-auto-assessment').term, '2026-H2');
  assert.equal(stored.assessments.find(assessment => assessment.id === 'archived-auto-assessment').termAssignment, 'auto');

  await app.Storage.lockSession();
  const restarted = await settingsApp({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  stored = await restarted.Storage.loadState();
  assert.deepEqual(
    JSON.parse(JSON.stringify(stored.assessments.filter(assessment => assessment.courseId === activeCourse.id)
      .map(assessment => [assessment.id, assessment.term, assessment.termAssignment]))),
    [
      ['manual-assessment', '2026-H2', 'manual'],
      ['auto-assessment', '2026-H1', 'auto']
    ]
  );
  assert.equal(stored.assessments.find(assessment => assessment.id === 'archived-auto-assessment').term, '2026-H2');
});

test('Pfeiltasten, Pos1 und Ende wechseln Einstellungsbereiche mit erkennbarem Fokus', async () => {
  const app = await settingsApp();
  const periods = areaTab(app, 'periods');
  assert.ok(periods, 'der erste Bereich muss als Tastaturziel vorliegen');

  await periods.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'settings-area-grading-tab');
  assert.equal(areaTab(app, 'grading').getAttribute('aria-selected'), 'true');
  assert.equal(areaPanel(app, 'grading').hidden, false);

  await areaTab(app, 'grading').dispatch('keydown', { key: 'End' });
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'settings-area-about-tab');
  assert.equal(areaPanel(app, 'about').hidden, false);

  await areaTab(app, 'about').dispatch('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'settings-area-periods-tab');
  assert.equal(areaPanel(app, 'periods').hidden, false);
});

test('Sek-I- und Sek-II-Untertabs bewahren ungespeicherte Zeitraumentwürfe beim Tastaturwechsel', async () => {
  const app = await settingsApp();
  const sekIStart = findByAttribute(app.root, 'id', 'settings-seckI-school-year-start');
  assert.ok(sekIStart, 'das Sek-I-Schuljahresfeld muss im Renderer vorliegen');
  sekIStart.value = '2026-08-19';
  await sekIStart.dispatch('input');

  await stageTab(app, 'seckI').dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'settings-stage-seckII-tab');
  assert.equal(stagePanel(app, 'seckI').hidden, true);
  assert.equal(stagePanel(app, 'seckII').hidden, false);

  await stageTab(app, 'seckII').dispatch('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'settings-stage-seckI-tab');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-school-year-start').value, '2026-08-19');
});

test('automatisches Speichern in Bewertung behält Bereich, Stufe und ungespeicherte Zeitraumentwürfe', async () => {
  const app = await settingsApp();
  const sekIStart = findByAttribute(app.root, 'id', 'settings-seckI-school-year-start');
  assert.ok(sekIStart, 'das Sek-I-Schuljahresfeld muss im Renderer vorliegen');
  sekIStart.value = '2026-08-19';
  await sekIStart.dispatch('input');
  await stageTab(app, 'seckII').dispatch('click');
  const sekIIName = findByAttribute(app.root, 'id', 'settings-seckII-h1-name');
  sekIIName.value = 'Q1 Entwurf';
  await sekIIName.dispatch('input');

  await areaTab(app, 'grading').dispatch('click');
  const templateName = findByAttribute(app.root, 'id', 'settings-template-name-0');
  assert.ok(templateName, 'mindestens eine vorhandene Gewichtungsvorlage muss bearbeitbar bleiben');
  templateName.value = 'Automatisch gespeichert';
  await templateName.dispatch('change');
  await waitForRender(
    () => areaTab(app, 'grading') && areaTab(app, 'grading').getAttribute('aria-selected') === 'true',
    'Bewertung wurde nach dem automatischen Speichern nicht wiederhergestellt'
  );

  await areaTab(app, 'periods').dispatch('click');
  assert.equal(stagePanel(app, 'seckII').hidden, false, 'die zuvor gewählte Stufe muss erhalten bleiben');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-school-year-start').value, '2026-08-19');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckII-h1-name').value, 'Q1 Entwurf');
});

test('D3: ungültige Vorlagengewichte verlangen sichtbar Korrektur und werden nicht gespeichert', async () => {
  const seedModules = loadModules();
  const state = seedModules.DomainModel.createEmptyState();
  state.settings.weightTemplates[0].items[0].weightPercent = 150;
  state.settings.weightTemplates[0].items[1].weightPercent = -50;
  state.settings.weightTemplates[0].items[2].weightPercent = 0;
  const app = await settingsApp({ state });
  await areaTab(app, 'grading').dispatch('click');

  assert.match(areaPanel(app, 'grading').textContent, /Korrektur erforderlich.*0 bis 100/);
  assert.ok(app.root._find(element => (
    element.textContent === 'Korrektur erforderlich: Gewichte müssen endliche Zahlen von 0 bis 100 sein.'
  )), 'eine rechnerische Summe 100 darf ungültige Einzelwerte nicht als gültig tarnen');

  const alerts = [];
  app.sandbox.window.alert = message => { alerts.push(String(message)); };
  let firstWeight = findByAttribute(app.root, 'id', 'settings-template-0-category-0');
  for (const invalidValue of ['101', '', 'Infinity']) {
    firstWeight.value = invalidValue;
    await firstWeight.dispatch('change');
  }
  assert.deepEqual(alerts, Array(3).fill('Gewichte müssen endliche Zahlen zwischen 0 und 100 sein.'));
  assert.equal((await app.Storage.loadState()).settings.weightTemplates[0].items[0].weightPercent, 150);

  firstWeight = findByAttribute(app.root, 'id', 'settings-template-0-category-0');
  firstWeight.value = '50';
  await firstWeight.dispatch('change');
  await waitForRender(
    () => findByAttribute(app.root, 'id', 'settings-template-0-category-0') !== firstWeight,
    'gültige Gewichtskorrektur muss den Bewertungsbereich neu rendern'
  );
  const secondWeight = findByAttribute(app.root, 'id', 'settings-template-0-category-1');
  secondWeight.value = '50';
  await secondWeight.dispatch('change');
  await waitForRender(
    () => !/Korrektur erforderlich/.test(areaPanel(app, 'grading').textContent),
    'nach gültigen Einzelwerten muss wieder die Summenprüfung sichtbar sein'
  );
  assert.match(areaPanel(app, 'grading').textContent, /Summe: 100/);
});

test('Korrekturen nach abgewiesenem Zeitraum-Speichern überleben den echten Bewertungs-Re-Render', async () => {
  const app = await settingsApp();
  const originalPeriods = (await app.Storage.loadState()).settings.halfYearSettings;
  const sekIStart = findByAttribute(app.root, 'id', 'settings-seckI-school-year-start');
  const validSekIStart = sekIStart.value;
  sekIStart.value = '';
  await sekIStart.dispatch('input');

  const alerts = [];
  app.sandbox.window.alert = message => { alerts.push(message); };
  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Bitte alle Datumsfelder in Sek I ausfüllen\./);
  assert.equal(JSON.stringify((await app.Storage.loadState()).settings.halfYearSettings), JSON.stringify(originalPeriods));

  sekIStart.value = validSekIStart;
  await sekIStart.dispatch('input');
  const sekIName = findByAttribute(app.root, 'id', 'settings-seckI-h1-name');
  sekIName.value = 'H1 korrigierter Entwurf';
  await sekIName.dispatch('input');

  const sekIIStart = findByAttribute(app.root, 'id', 'settings-seckII-school-year-start');
  const correctedSekIIStart = sekIIStart.value.replace(/-\d\d$/, '-09');
  sekIIStart.value = correctedSekIIStart;
  await sekIIStart.dispatch('input');
  const sekIIName = findByAttribute(app.root, 'id', 'settings-seckII-h1-name');
  sekIIName.value = 'Q1 korrigierter Entwurf';
  await sekIIName.dispatch('input');

  await areaTab(app, 'grading').dispatch('click');
  const templateNameBeforeSave = findByAttribute(app.root, 'id', 'settings-template-name-0');
  assert.ok(templateNameBeforeSave, 'mindestens eine Gewichtungsvorlage muss den Re-Render auslösen können');
  templateNameBeforeSave.value = 'Re-Render nach Korrektur';
  await templateNameBeforeSave.dispatch('change');
  await waitForRender(
    () => {
      const templateNameAfterSave = findByAttribute(app.root, 'id', 'settings-template-name-0');
      return Boolean(templateNameAfterSave && templateNameAfterSave !== templateNameBeforeSave);
    },
    'das Bewertungs-Autosave muss den Vorlagennamen-Knoten tatsächlich ersetzen'
  );

  await areaTab(app, 'periods').dispatch('click');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-school-year-start').value, validSekIStart);
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h1-name').value, 'H1 korrigierter Entwurf');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckII-school-year-start').value, correctedSekIIStart);
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckII-h1-name').value, 'Q1 korrigierter Entwurf');
  assert.equal(JSON.stringify((await app.Storage.loadState()).settings.halfYearSettings), JSON.stringify(originalPeriods),
    'Bewertungs-Autosave darf den ungespeicherten Zeitraumentwurf nicht übernehmen');
  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
  await app.Storage.lockSession();
  const restarted = await settingsApp({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  assert.equal(findByAttribute(restarted.root, 'id', 'settings-seckI-school-year-start').value, validSekIStart);
  assert.equal(findByAttribute(restarted.root, 'id', 'settings-seckII-school-year-start').value, correctedSekIIStart);
  assert.equal(findByAttribute(restarted.root, 'id', 'settings-seckI-h1-name').value, 'H1 korrigierter Entwurf');
  assert.equal(findByAttribute(restarted.root, 'id', 'settings-seckII-h1-name').value, 'Q1 korrigierter Entwurf');
});

test('die eine Zeitraumaktion benennt und speichert ihren Umfang für beide Stufen korrekt', async () => {
  const app = await settingsApp();
  const values = {
    'settings-seckI-school-year-start': '2026-08-01',
    'settings-seckI-h1-end': '2027-01-31',
    'settings-seckI-h2-start': '2027-02-01',
    'settings-seckI-h1-name': 'H1 Test',
    'settings-seckI-h2-name': 'H2 Test',
    'settings-seckII-school-year-start': '2026-08-01',
    'settings-seckII-h1-end': '2027-01-31',
    'settings-seckII-h2-start': '2027-02-01',
    'settings-seckII-h1-name': 'Q1 Test',
    'settings-seckII-h2-name': 'Q2 Test'
  };
  for (const [id, value] of Object.entries(values)) {
    const input = findByAttribute(app.root, 'id', id);
    assert.ok(input, `${id} muss vor dem gemeinsamen Speichern vorliegen`);
    input.value = value;
    await input.dispatch('input');
  }

  const saveButton = findByText(app.root, 'Zeiträume für Sek I und Sek II speichern');
  assert.ok(saveButton);
  assert.match(areaPanel(app, 'periods').textContent, /speichert beide Stufen gemeinsam/i);
  await saveButton.dispatch('click');
  const stored = await app.Storage.loadState();

  assert.equal(stored.settings.halfYearSettings.seckI.schoolYearStartYear, 2026);
  assert.equal(stored.settings.halfYearSettings.seckII.h2StartDay, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.settings.halfYearNames)), {
    seckI: { h1: 'H1 Test', h2: 'H2 Test' },
    seckII: { h1: 'Q1 Test', h2: 'Q2 Test' }
  });
});

test('bestehende Standardnamen erscheinen nach bewusst leer gespeichertem Entwurf wieder im Formular', async () => {
  const app = await settingsApp();
  const sekIName = findByAttribute(app.root, 'id', 'settings-seckI-h1-name');
  sekIName.value = '';
  await sekIName.dispatch('input');

  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');

  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h1-name').value, 'H1');
  const stored = await app.Storage.loadState();
  assert.equal(stored.settings.halfYearNames.seckI.h1, 'H1');
});

test('zentrale Einstellungsfelder sind sichtbar und eindeutig beschriftet', async () => {
  const app = await settingsApp();
  assert.ok(stagePanel(app, 'seckI'), 'das Sek-I-Formular muss im Renderer vorliegen');
  const labelled = [
    ['Schuljahr beginnt', 'settings-seckI-school-year-start'],
    ['Erster Zeitraum endet', 'settings-seckI-h1-end'],
    ['Zweiter Zeitraum beginnt', 'settings-seckI-h2-start'],
    ['Erster Zeitraum', 'settings-seckI-h1-name'],
    ['Zweiter Zeitraum', 'settings-seckI-h2-name']
  ];
  for (const [text, id] of labelled) {
    const label = stagePanel(app, 'seckI')._find(element => element.tagName === 'LABEL' && element.textContent === text);
    assert.ok(label, `${text} muss sichtbar sein`);
    assert.equal(label.getAttribute('for'), id);
    assert.ok(findByAttribute(stagePanel(app, 'seckI'), 'id', id));
  }

  await areaTab(app, 'security').dispatch('click');
  const timeoutLabel = areaPanel(app, 'security')._find(element => element.tagName === 'LABEL' &&
    element.textContent === 'Timeout (Minuten)');
  assert.equal(timeoutLabel.getAttribute('for'), 'settings-session-timeout');
  assert.ok(findByAttribute(areaPanel(app, 'security'), 'id', 'settings-session-timeout'));
});

test('die verpflichtende Verschlüsselungseinrichtung bleibt vor allen Bereichen sichtbar', async () => {
  const app = await settingsApp({ encrypted: false });

  assert.ok(findByText(app.root, 'Erforderliche Einrichtung: Verschlüsselung'));
  assert.ok(findByText(app.root, 'Verschlüsselung jetzt einrichten'));
  assert.ok(areaTab(app, 'periods'), 'die Bereichsnavigation muss trotz Pflicht-Hinweis erreichbar bleiben');
  assert.equal(areaTab(app, 'periods').getAttribute('aria-selected'), 'true');
  await areaTab(app, 'about').dispatch('click');
  assert.ok(findByText(app.root, 'Erforderliche Einrichtung: Verschlüsselung'));
  assert.equal(areaPanel(app, 'about').hidden, false);
});

test('erfolgreiches vollständiges Zurücksetzen verwirft nur den alten Zeitraum- und Navigationsentwurf', async () => {
  const app = await settingsApp();
  const oldDraft = '2030-08-19';
  const sekIStart = findByAttribute(app.root, 'id', 'settings-seckI-school-year-start');
  sekIStart.value = oldDraft;
  await sekIStart.dispatch('input');
  await stageTab(app, 'seckII').dispatch('click');
  await areaTab(app, 'grading').dispatch('click');

  const confirmations = [];
  app.sandbox.window.confirm = message => {
    confirmations.push(message);
    return true;
  };
  await findByText(app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');

  const stored = await app.Storage.loadState();
  const storedSekI = stored.settings.halfYearSettings.seckI;
  const storedStart = [
    storedSekI.schoolYearStartYear,
    String(storedSekI.schoolYearStartMonth).padStart(2, '0'),
    String(storedSekI.schoolYearStartDay).padStart(2, '0')
  ].join('-');
  assert.equal(confirmations.length, 2, 'der Test muss beide bestehenden Sicherheitsabfragen bestätigen');
  assert.notEqual(storedStart, oldDraft, 'der gespeicherte Reset-Zustand muss tatsächlich frisch sein');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-school-year-start').value, storedStart,
    'das sichtbare Feld muss aus dem frisch gespeicherten Reset-Zustand stammen');
  assert.equal(areaTab(app, 'periods').getAttribute('aria-selected'), 'true');
  assert.equal(stageTab(app, 'seckI').getAttribute('aria-selected'), 'true');
});

test('abgebrochenes und fehlgeschlagenes Zurücksetzen bewahren Zeitraum- und Navigationsentwurf', async () => {
  for (const mode of ['abbruch', 'fehler']) {
    const app = await settingsApp();
    const oldDraft = mode === 'abbruch' ? '2031-08-20' : '2032-08-21';
    const sekIStart = findByAttribute(app.root, 'id', 'settings-seckI-school-year-start');
    sekIStart.value = oldDraft;
    await sekIStart.dispatch('input');
    await stageTab(app, 'seckII').dispatch('click');
    await areaTab(app, 'about').dispatch('click');
    const storedBefore = JSON.stringify(await app.Storage.loadState());
    const alerts = [];
    app.sandbox.window.alert = message => { alerts.push(message); };

    if (mode === 'abbruch') {
      const answers = [true, false];
      app.sandbox.window.confirm = () => answers.shift();
    } else {
      app.sandbox.window.confirm = () => true;
      app.Storage.resetState = async () => { throw new Error('synthetischer Resetfehler'); };
    }
    await findByText(app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');

    assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-school-year-start').value, oldDraft,
      `${mode}: der nicht erfolgreiche Reset darf den Entwurf nicht verwerfen`);
    assert.equal(areaTab(app, 'about').getAttribute('aria-selected'), 'true');
    assert.equal(stageTab(app, 'seckII').getAttribute('aria-selected'), 'true');
    assert.equal(JSON.stringify(await app.Storage.loadState()), storedBefore);
    assert.equal(alerts.length, mode === 'fehler' ? 1 : 0);
  }
});
