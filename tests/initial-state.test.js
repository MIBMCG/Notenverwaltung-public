'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { openStorageSession } = require('./harness/storage-session');
const { readSourceLines, extractFunction } = require('./harness/extract.js');

function loadInitialState(globals) {
  return loadEsmGraph('src/domain/initial-state.js', { globals }).exports;
}

function assertInitialDates(state, expectedStartYear) {
  const expected = {
    schoolYearStartYear: expectedStartYear,
    schoolYearStartMonth: 8,
    schoolYearStartDay: 1,
    h1EndYear: expectedStartYear + 1,
    h1EndMonth: 1,
    h1EndDay: 31,
    h2StartYear: expectedStartYear + 1,
    h2StartMonth: 2,
    h2StartDay: 1
  };
  assert.deepEqual(JSON.parse(JSON.stringify(state.settings.halfYearSettings.seckI)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(state.settings.halfYearSettings.seckII)), expected);
}

function fixedDate(year, monthIndex, day) {
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [year, monthIndex, day, 12, 0, 0]));
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configuredDateSnapshot(state) {
  return clone({
    halfYearSettings: state.settings.halfYearSettings,
    termCutoffs: state.settings.termCutoffs
  });
}

const HISTORIC_DATE_SNAPSHOT = {
  halfYearSettings: {
    seckI: {
      schoolYearStartYear: 2025, schoolYearStartMonth: 9, schoolYearStartDay: 8,
      h1EndYear: 2026, h1EndMonth: 1, h1EndDay: 30,
      h2StartYear: 2026, h2StartMonth: 2, h2StartDay: 9
    },
    seckII: {
      schoolYearStartYear: 2025, schoolYearStartMonth: 9, schoolYearStartDay: 8,
      h1EndYear: 2026, h1EndMonth: 1, h1EndDay: 30,
      h2StartYear: 2026, h2StartMonth: 2, h2StartDay: 9
    }
  },
  termCutoffs: {
    schoolYearStartMonth: 9, h1EndMonth: 1, h1EndDay: 30, h2StartMonth: 2, h2StartDay: 9
  }
};

const CUSTOM_DATE_SNAPSHOT = {
  halfYearSettings: {
    seckI: {
      schoolYearStartYear: 2024, schoolYearStartMonth: 9, schoolYearStartDay: 3,
      h1EndYear: 2025, h1EndMonth: 1, h1EndDay: 28,
      h2StartYear: 2025, h2StartMonth: 2, h2StartDay: 5
    },
    seckII: {
      schoolYearStartYear: 2024, schoolYearStartMonth: 8, schoolYearStartDay: 15,
      h1EndYear: 2025, h1EndMonth: 1, h1EndDay: 31,
      h2StartYear: 2025, h2StartMonth: 2, h2StartDay: 12
    }
  },
  termCutoffs: {
    schoolYearStartMonth: 8, h1EndMonth: 1, h1EndDay: 31, h2StartMonth: 2, h2StartDay: 12
  }
};

function setDateSnapshot(state, snapshot) {
  state.settings.halfYearSettings = clone(snapshot.halfYearSettings);
  state.settings.termCutoffs = clone(snapshot.termCutoffs);
}

async function assertStoredDateRoundTrip(mode, state, expected, password) {
  const storage = localStorageStub();
  const writer = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  if (mode === 'plaintext') {
    storage.setItem('notenverwaltung_v1_state', JSON.stringify(state));
  } else {
    await writer.Storage.enableEncryption(password, state);
  }

  const reader = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  const loaded = await reader.Storage.loadState();
  assert.deepEqual(configuredDateSnapshot(loaded), expected, `${mode} dates changed during load`);

  if (mode === 'plaintext') await reader.Storage.enableEncryption(password, loaded);
  await reader.Storage.saveState(loaded);
  const reloader = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  const reloaded = await reloader.Storage.loadState();
  assert.deepEqual(configuredDateSnapshot(reloaded), expected, `${mode} dates changed during save/reload`);
}

function loadHalfYearDateHelper(modules) {
  const lines = readSourceLines();
  const source = `${extractFunction(lines, 'parseHalfYearDateValue')}\n` +
    `${extractFunction(lines, 'validateHalfYearDateRange')}\n` +
    `${extractFunction(lines, 'applyHalfYearDateInputs')}\n` +
    'globalThis.__initialStateHelpers = { applyHalfYearDateInputs };';
  vm.runInContext(source, modules.sandbox, { filename: 'initial-state-half-year-settings.js' });
  return modules.sandbox.__initialStateHelpers.applyHalfYearDateInputs;
}

// Break caught: the first state starts with historical September/February dates
// instead of dates for the current school year.
test('new initial states derive editable August, January and February dates from the reference date', () => {
  const { createInitialState } = loadInitialState();
  const cases = [
    ['2026-07-31T12:00:00', 2025],
    ['2026-08-01T12:00:00', 2026],
    ['2026-09-15T12:00:00', 2026],
    ['2027-01-15T12:00:00', 2026],
    ['2027-02-01T12:00:00', 2026]
  ];

  for (const [iso, expectedStartYear] of cases) {
    const referenceDate = new Date(iso);
    const before = referenceDate.getTime();
    const state = createInitialState(referenceDate);
    assertInitialDates(state, expectedStartYear);
    assert.equal(referenceDate.getTime(), before, `reference date changed for ${iso}`);
  }
});

// Break caught: sharing one date object between education levels or later fresh states.
test('initial state dates are independent while retaining legacy defaults and version one', () => {
  const { createInitialState } = loadInitialState();
  const first = createInitialState(new Date('2026-09-15T12:00:00'));
  const second = createInitialState(new Date('2026-09-15T12:00:00'));

  first.settings.halfYearSettings.seckI.h2StartDay = 7;

  assert.equal(first.settings.halfYearSettings.seckII.h2StartDay, 1);
  assert.equal(second.settings.halfYearSettings.seckI.h2StartDay, 1);
  assert.equal(first.version, 1);
  assert.equal(first.settings.categories.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(first.settings.termCutoffs)), {
    schoolYearStartMonth: 8,
    h1EndMonth: 1,
    h1EndDay: 31,
    h2StartMonth: 2,
    h2StartDay: 1
  });
});

// Break caught: silently selecting an ambient year for a missing or invalid reference date.
test('initial state requires a valid supplied date and never reads an ambient clock', () => {
  const ForbiddenDate = class {
    constructor() {
      throw new Error('ambient clock was read');
    }
  };
  const { createInitialState } = loadInitialState({ Date: ForbiddenDate });
  const validReference = {
    getTime() { return 1; },
    getFullYear() { return 2026; },
    getMonth() { return 8; }
  };

  assert.doesNotThrow(() => createInitialState(validReference));
  for (const invalid of [null, undefined, new Date('invalid'), {}, { getTime() { return 1; } }]) {
    assert.throws(() => createInitialState(invalid), error => error && error.name === 'TypeError');
  }
});

// Break caught: a first start still receives historic default cutoffs or writes a state before encryption is configured.
test('fresh Storage load uses initial dates without writing state, password or encryption flags', async () => {
  const storage = localStorageStub();
  const modules = await openStorageSession({ storage, dateImpl: fixedDate(2026, 8, 15) });

  const state = await modules.Storage.loadState();

  assertInitialDates(state, 2026);
  assert.deepEqual(storage._keys(), []);
  assert.equal(modules.Storage.hasSessionPassword(), false);
});

// Break caught: resetting an unlocked encrypted session recreates the historic factory state.
test('Storage reset uses initial dates while preserving encrypted reset preconditions', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';
  const modules = await openStorageSession({ storage, password, dateImpl: fixedDate(2027, 0, 15) });
  await modules.Storage.enableEncryption(password, modules.DomainModel.createEmptyState());

  const reset = await modules.Storage.resetState();

  assertInitialDates(reset, 2026);
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), '1');
  assert.ok(storage.getItem('notenverwaltung_v1_state_enc'));
});

// Break caught: cancelling encrypted authentication writes a replacement over an existing saved state.
test('cancelled encrypted authentication returns initial dates without overwriting the saved payload', async () => {
  const storage = localStorageStub();
  const password = 'Synthetisches-Testpasswort-2026';
  const writer = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  const saved = writer.DomainModel.createEmptyState();
  saved.settings.halfYearSettings.seckI.h2StartDay = 17;
  await writer.Storage.enableEncryption(password, saved);
  const payloadBefore = storage.getItem('notenverwaltung_v1_state_enc');
  const saltBefore = storage.getItem('notenverwaltung_v1_salt');

  const reader = await openStorageSession({ storage, password: null, dateImpl: fixedDate(2026, 8, 15) });
  const fresh = await reader.Storage.loadState();

  assertInitialDates(fresh, 2026);
  assert.equal(reader.Storage.hasSessionPassword(), false);
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payloadBefore);
  assert.equal(storage.getItem('notenverwaltung_v1_salt'), saltBefore);
});

// Break caught: migration/load treats the exact historic September-8/January-30/February-9 dates as replaceable defaults.
test('existing exact historical dates survive plaintext and encrypted load/save/reload unchanged', async () => {
  const password = 'Synthetisches-Testpasswort-2026';
  for (const mode of ['plaintext', 'encrypted']) {
    const factory = loadModules({ dateImpl: fixedDate(2026, 8, 15) });
    const state = factory.DomainModel.createEmptyState();
    assert.deepEqual(configuredDateSnapshot(state), HISTORIC_DATE_SNAPSHOT);
    await assertStoredDateRoundTrip(mode, state, HISTORIC_DATE_SNAPSHOT, password);
  }
});

// Break caught: load/save normalizes one education level's custom dates to an old or new global default.
test('existing customized dates survive plaintext and encrypted load/save/reload unchanged', async () => {
  const password = 'Synthetisches-Testpasswort-2026';
  for (const mode of ['plaintext', 'encrypted']) {
    const factory = loadModules({ dateImpl: fixedDate(2026, 8, 15) });
    const state = factory.DomainModel.createEmptyState();
    setDateSnapshot(state, CUSTOM_DATE_SNAPSHOT);
    assert.deepEqual(configuredDateSnapshot(state), CUSTOM_DATE_SNAPSHOT);
    await assertStoredDateRoundTrip(mode, state, CUSTOM_DATE_SNAPSHOT, password);
  }
});

// Break caught: normalizing a stored state replaces course and archive cutoff snapshots.
test('stored archive snapshots and course-specific cutoffs remain unchanged after load', async () => {
  const storage = localStorageStub();
  const writer = await openStorageSession({ storage, dateImpl: fixedDate(2026, 8, 15) });
  const state = writer.DomainModel.createEmptyState();
  const course = writer.DomainModel.createCourse({ id: 'archive-cutoff-course', name: 'Archivkurs' });
  course.archivedAt = '2026-07-01T12:00:00.000Z';
  course.termCutoffs = { h1EndMonth: 12, h1EndDay: 20, h2StartMonth: 1, h2StartDay: 10 };
  course.archiveSnapshot = writer.DomainModel.createArchiveSnapshot(state, course);
  course.archiveSnapshot.termCutoffSource = 'course';
  course.archiveSnapshot.termCutoffs = { h1EndMonth: 12, h1EndDay: 20, h2StartMonth: 1, h2StartDay: 10 };
  state.courses.push(course);
  const expected = clone(course.termCutoffs);
  storage.setItem('notenverwaltung_v1_state', JSON.stringify(state));

  const reader = await openStorageSession({ storage, dateImpl: fixedDate(2026, 8, 15) });
  const restored = await reader.Storage.loadState();

  assert.deepEqual(clone(restored.courses[0].termCutoffs), expected);
  assert.equal(restored.courses[0].archiveSnapshot.termCutoffSource, 'course');
  assert.deepEqual(clone(restored.courses[0].archiveSnapshot.termCutoffs), expected);
});

// Break caught: initialized dates cannot be edited through the real half-year helper or do not survive storage.
test('initialized dates accept custom UI edits for both levels and persist them', async () => {
  const password = 'Synthetisches-Testpasswort-2026';
  const storage = localStorageStub();
  const modules = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  const InitialReferenceDate = fixedDate(2026, 8, 15);
  const state = modules.createInitialState(new InitialReferenceDate());
  const applyHalfYearDateInputs = loadHalfYearDateHelper(modules);
  const result = applyHalfYearDateInputs(state, [
    {
      level: 'seckI', label: 'Sek I', schoolYearStartValue: '2026-08-04',
      h1EndValue: '2027-01-29', h2StartValue: '2027-02-08'
    },
    {
      level: 'seckII', label: 'Sek II', schoolYearStartValue: '2026-08-05',
      h1EndValue: '2027-01-28', h2StartValue: '2027-02-09'
    }
  ]);
  const expected = configuredDateSnapshot(state);

  assert.equal(result.ok, true);
  await modules.Storage.enableEncryption(password, state);
  const reader = await openStorageSession({ storage, password, dateImpl: fixedDate(2026, 8, 15) });
  const restored = await reader.Storage.loadState();
  assert.deepEqual(configuredDateSnapshot(restored), expected);
});

// Break caught: result and assessment term resolution continue to use historic September/February boundaries for a new state.
test('initial dates drive assessment and result term boundaries while custom dates still override them', () => {
  const { createInitialState } = loadInitialState();
  const terms = loadEsmGraph('src/domain/terms.js').exports;
  const state = createInitialState(new Date('2026-09-15T12:00:00'));
  const course = { id: 'course-initial-terms', schemaMode: 'grades' };

  assert.equal(terms.resolveAssessmentTermFromDateValue(new Date('2026-08-01T12:00:00'), course, state.settings), '2026-H1');
  assert.equal(terms.resolveAssessmentTermFromDateValue(new Date('2027-01-31T12:00:00'), course, state.settings), '2026-H1');
  assert.equal(terms.resolveAssessmentTermFromDateValue(new Date('2027-02-01T12:00:00'), course, state.settings), '2026-H2');
  assert.equal(terms.resolveGradingResultScope(course, state, null, () => new Date('2027-02-01T12:00:00')).currentTerm, '2026-H2');

  state.settings.halfYearSettings.seckI.h2StartMonth = 3;
  state.settings.halfYearSettings.seckI.h2StartDay = 3;
  assert.equal(terms.resolveAssessmentTermFromDateValue(new Date('2027-02-15T12:00:00'), course, state.settings), '2026-H1');
  assert.equal(terms.resolveAssessmentTermFromDateValue(new Date('2027-03-03T12:00:00'), course, state.settings), '2026-H2');
});

// Break caught: optional export/encryption callers fall back to the historical factory instead of the initial-state helper.
test('optional encrypted export and setup states use initial dates', async () => {
  const password = 'Synthetisches-Testpasswort-2026';
  const storage = localStorageStub();
  const modules = await openStorageSession({ storage, password, dateImpl: fixedDate(2027, 1, 15) });

  const exported = await modules.Storage.exportStateEncrypted(password);
  assertInitialDates(await modules.Storage.importStateEncryptedFromText(exported, password), 2026);
  await modules.Storage.enableEncryption(password);

  const reader = await openStorageSession({ storage, password, dateImpl: fixedDate(2027, 1, 15) });
  assertInitialDates(await reader.Storage.loadState(), 2026);
});
