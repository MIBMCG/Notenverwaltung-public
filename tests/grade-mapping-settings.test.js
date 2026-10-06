'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

function loadGradeMappingBinding() {
  const modules = loadModules();
  let source;
  try {
    source = `${extractFunction(readSourceLines(), 'bindGradeMappingInput')}\n` +
      'globalThis.__bindGradeMappingInput = bindGradeMappingInput;';
  } catch (error) {
    return { modules, bindGradeMappingInput: null, loadError: error };
  }
  vm.runInContext(source, modules.sandbox, { filename: 'grade-mapping-settings.js' });
  return {
    modules,
    bindGradeMappingInput: modules.sandbox.__bindGradeMappingInput,
    loadError: null
  };
}

function createInput() {
  let value = '';
  const input = {
    type: '', step: '', min: '', style: {}, listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    async dispatch(type) {
      const listener = this.listeners.get(type);
      if (listener) await listener.call(this, {});
    }
  };
  Object.defineProperty(input, 'value', {
    get() { return value; },
    set(nextValue) { value = String(nextValue); }
  });
  return input;
}

function createCommitHarness(modules, initialState, persistState = async () => {}) {
  let confirmedState = initialState;
  let queue = Promise.resolve();
  const { createStateCommitter } = loadEsmGraph('src/ui/state-commit.js').exports;
  const committer = createStateCommitter({
    readState: () => confirmedState,
    persistState,
    publishState(candidate) {
      confirmedState = candidate;
      modules.sandbox.state = candidate;
    },
    enqueue(operation) {
      const pending = queue.then(operation, operation);
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
    readEpoch: () => 0
  });
  const readState = () => confirmedState;
  const commitStateChange = (change, options = {}) => {
    void options;
    return committer.commit(change);
  };
  modules.sandbox.state = confirmedState;
  modules.sandbox.readState = readState;
  modules.sandbox.commitStateChange = commitStateChange;
  return { readState, commitStateChange };
}

test('grade-mapping binding shows only valid stored numbers and exposes a zero minimum', () => {
  const { modules, bindGradeMappingInput, loadError } = loadGradeMappingBinding();
  assert.equal(typeof bindGradeMappingInput, 'function', loadError && loadError.message);
  const state = modules.DomainModel.createEmptyState();
  state.settings.gradeMapping.Eigen = null;
  const input = createInput();
  const commitHarness = createCommitHarness(modules, state);

  bindGradeMappingInput({
    input,
    readState: commitHarness.readState,
    label: 'Eigen',
    commitStateChange: commitHarness.commitStateChange,
    showAlert() {}
  });

  assert.equal(input.type, 'number');
  assert.equal(input.step, '0.1');
  assert.equal(input.min, '0');
  assert.equal(input.value, '');
});

test('grade-mapping binding rejects invalid changes without state writes and restores the previous value', async () => {
  const { modules, bindGradeMappingInput, loadError } = loadGradeMappingBinding();
  assert.equal(typeof bindGradeMappingInput, 'function', loadError && loadError.message);
  const state = modules.DomainModel.createEmptyState();
  state.settings.gradeMapping.Eigen = 2;
  const input = createInput();
  const writes = [];
  const alerts = [];
  const commitHarness = createCommitHarness(modules, state, async () => { writes.push('persisted'); });
  bindGradeMappingInput({
    input,
    readState: commitHarness.readState,
    label: 'Eigen',
    commitStateChange: commitHarness.commitStateChange,
    showAlert(message) { alerts.push(message); }
  });

  for (const badValue of ['', '2abc', '-0.1', 'Infinity']) {
    input.value = badValue;
    await input.dispatch('change');
    assert.equal(commitHarness.readState().settings.gradeMapping.Eigen, 2);
    assert.equal(input.value, '2');
  }
  assert.equal(writes.length, 0);
  assert.equal(alerts.length, 4);
  assert.match(alerts[0], /Wert ab 0/);
});

test('grade-mapping binding persists decimal point, decimal comma, zero and custom values', async () => {
  const { modules, bindGradeMappingInput, loadError } = loadGradeMappingBinding();
  assert.equal(typeof bindGradeMappingInput, 'function', loadError && loadError.message);
  const state = modules.DomainModel.createEmptyState();
  state.settings.gradeMapping.Eigen = 1;
  const input = createInput();
  const writes = [];
  const commitHarness = createCommitHarness(modules, state, async candidate => {
    writes.push(candidate.settings.gradeMapping.Eigen);
  });
  bindGradeMappingInput({
    input,
    readState: commitHarness.readState,
    label: 'Eigen',
    commitStateChange: commitHarness.commitStateChange,
    showAlert() { assert.fail('gueltige Eingabe darf keinen Alarm ausloesen'); }
  });

  for (const [rawValue, expected] of [['1.25', 1.25], ['2,5', 2.5], ['0', 0], ['9', 9]]) {
    input.value = rawValue;
    await input.dispatch('change');
    assert.equal(commitHarness.readState().settings.gradeMapping.Eigen, expected);
  }
  assert.deepEqual(writes, [1.25, 2.5, 0, 9]);
});
