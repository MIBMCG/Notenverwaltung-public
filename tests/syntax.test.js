'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSourceLines, extractModule } = require('./harness/extract.js');
const { bundleEsmGraph } = require('./harness/load-esm-graph.js');

test('the remaining extracted module and the Storage graph parse as valid JavaScript', () => {
  const lines = readSourceLines();
  for (const name of ['UiShell']) {
    assert.doesNotThrow(
      () => new vm.Script(extractModule(lines, name), { filename: `${name}.js` }),
      `Syntaxfehler in ${name}`
    );
  }
  assert.doesNotThrow(() => bundleEsmGraph('src/domain/domain-model.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/domain/grading-logic.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/infrastructure/storage.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/transfer/csv-format.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/transfer/csv-import-rules.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/transfer/csv-import-orchestrator.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/transfer/import-validation.js'));
  assert.doesNotThrow(() => bundleEsmGraph('src/domain/initial-assessments.js'));
});
