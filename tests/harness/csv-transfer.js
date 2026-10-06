'use strict';

const vm = require('node:vm');
const { readSourceLines, extractFunction } = require('./extract.js');
const { bundleEsmGraph } = require('./load-esm-graph.js');
const { createCsvDocumentStub } = require('./csv-document.js');

const CSV_NAMES = new Set(['csvCell', 'encodeCsvTransferRow', 'decodeCsvTransferFields',
  'parseSemicolonCsv', 'validateCsvTransferHeader',
  'normalizeCsvDate', 'formatCsvImportIssuesText', 'formatCsvImportIssuesCsv']);
const CSV_PROTECTION_NAMES = new Set(['encodeCsvTransferRow', 'decodeCsvTransferFields']);
const CSV_RULE_NAMES = new Set(['parseCsvTransferContextFields', 'validateCsvCourseContextConsistency',
  'csvCourseContextMatches', 'validateCsvStudentIdentity', 'findCompatibleCsvStudent']);

function installCsvArtifactDependencies(modules, htmlLines) {
  const importValidationSource = [
    extractFunction(htmlLines, 'validateImportedState'),
    'globalThis.__artifact_import_validation_exports = { validateImportedState };'
  ].join('\n\n');
  vm.runInContext(importValidationSource, modules.sandbox, { filename: 'import-validation-from-artifact.js' });
  const protectionStart = htmlLines.findIndex(line => /^  var CSV_TRANSFER_FIELDS = \[/.test(line));
  const parserStart = htmlLines.findIndex(line => /^  function parseSemicolonCsv\(text\)/.test(line));
  if (protectionStart < 0 || parserStart <= protectionStart) {
    throw new Error('Artefaktblock für CSV-Schutz nicht gefunden.');
  }
  const protectionSource = htmlLines.slice(protectionStart, parserStart).join('\n');
  const formatSource = protectionSource + '\n\n' +
    [...CSV_NAMES].filter(name => !CSV_PROTECTION_NAMES.has(name))
      .map(name => extractFunction(htmlLines, name)).join('\n\n')
    + '\nglobalThis.__csv_format_exports = { ' + [...CSV_NAMES].join(', ') + ' };';
  vm.runInContext(formatSource, modules.sandbox, { filename: 'csv-format-from-artifact.js' });
  Object.assign(modules.sandbox, modules.sandbox.__csv_format_exports);

  const constantNames = ['SCHEMA_MODES', 'UPPERSEC_COURSE_TYPES', 'QUALIFICATION_YEARS'];
  const constants = constantNames.map(name => {
    const marker = `  var ${name} = {`;
    const start = htmlLines.indexOf(marker);
    const end = htmlLines.indexOf('  };', start + 1);
    if (start < 0 || end <= start) throw new Error(`Artefaktkonstante nicht gefunden: ${name}`);
    return htmlLines.slice(start, end + 1).join('\n');
  }).join('\n');
  const rulesSource = constants + '\n' + [...CSV_RULE_NAMES].map(name => extractFunction(htmlLines, name)).join('\n')
    + '\nglobalThis.__csv_import_rules_exports = { ' + [...CSV_RULE_NAMES].join(', ') + ' };';
  vm.runInContext(rulesSource, modules.sandbox, { filename: 'csv-rules-from-artifact.js' });
  Object.assign(modules.sandbox, modules.sandbox.__csv_import_rules_exports);

  const orchestratorSource = [
    extractFunction(htmlLines, 'createInitialAssessmentsForCourse'),
    extractFunction(htmlLines, 'updateStudentCreatedInCurrentCsv'),
    extractFunction(htmlLines, 'createCsvImportOrchestrator'),
    'globalThis.__csv_import_orchestrator_exports = { createCsvImportOrchestrator };'
  ].join('\n\n');
  vm.runInContext(orchestratorSource, modules.sandbox, { filename: 'csv-import-orchestrator-from-artifact.js' });
}

function loadCsvImportOrchestrator(modules, htmlLines) {
  if (!modules.sandbox.__csvImportOrchestrator) {
    if (htmlLines) {
      installCsvArtifactDependencies(modules, htmlLines);
    } else {
      vm.runInContext(
        bundleEsmGraph('src/transfer/csv-import-orchestrator.js', {
          globalName: '__csv_import_orchestrator_exports'
        }),
        modules.sandbox,
        { filename: 'src/transfer/csv-import-orchestrator.js.bundle.js' }
      );
    }
    modules.sandbox.__csvImportOrchestrator =
      modules.sandbox.__csv_import_orchestrator_exports.createCsvImportOrchestrator({
        DomainModel: modules.DomainModel
      });
  }
  return modules.sandbox.__csvImportOrchestrator;
}

function loadCsvStateCommitter(modules, htmlLines) {
  if (!modules.sandbox.__csv_state_commit_exports) {
    if (htmlLines) {
      const stateCommitStart = htmlLines.indexOf('  // src/ui/state-commit.js');
      const nextModuleStart = htmlLines.findIndex((line, index) =>
        index > stateCommitStart && /^  \/\/ src\//.test(line)
      );
      if (stateCommitStart < 0 || nextModuleStart <= stateCommitStart) {
        throw new Error('Artefaktblock für Zustands-Commits nicht gefunden.');
      }
      const stateCommitSource = htmlLines.slice(stateCommitStart + 1, nextModuleStart).join('\n')
        + '\nglobalThis.__csv_state_commit_exports = { createStateCommitter };';
      vm.runInContext(stateCommitSource, modules.sandbox, { filename: 'state-commit-from-artifact.js' });
    } else {
      vm.runInContext(
        bundleEsmGraph('src/ui/state-commit.js', { globalName: '__csv_state_commit_exports' }),
        modules.sandbox,
        { filename: 'src/ui/state-commit.js.bundle.js' }
      );
    }
  }
  return modules.sandbox.__csv_state_commit_exports.createStateCommitter;
}

function loadCsvHelper(modules, name, dependencies = []) {
  if (CSV_NAMES.has(name)) return modules.sandbox.__csv_format_exports[name];
  if (CSV_RULE_NAMES.has(name)) return modules.sandbox.__csv_import_rules_exports[name];
  const lines = readSourceLines();
  const source = dependencies.map(dependency => extractFunction(lines, dependency)).join('\n\n')
    + '\n\n' + extractFunction(lines, name)
    + `\nglobalThis.__csvHelper = ${name};`;
  vm.runInContext(source, modules.sandbox, { filename: `${name}.js` });
  return modules.sandbox.__csvHelper;
}

function loadCsvImporter(modules, initialState, htmlLines) {
  modules.sandbox.__initialCsvState = initialState;
  if (!modules.sandbox.document) modules.sandbox.document = createCsvDocumentStub();
  loadCsvImportOrchestrator(modules, htmlLines);
  loadCsvStateCommitter(modules, htmlLines);
  const lines = htmlLines || readSourceLines();
  const source = [
    extractFunction(lines, 'isFatalCsvImportIssue'),
    htmlLines
      ? 'var validateImportedState = globalThis.__artifact_import_validation_exports.validateImportedState;'
      : 'var validateImportedState = globalThis.__import_validation_exports.validateImportedState;',
    'const CsvImportOrchestrator = globalThis.__csvImportOrchestrator;',
    'const csvCreateStateCommitter = globalThis.__csv_state_commit_exports.createStateCommitter;',
    'let state = globalThis.__initialCsvState;',
    'let uiStateEpoch = 0;',
    extractFunction(lines, 'createSerializedTransactionQueue'),
    'const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();',
    'const stateCommitter = csvCreateStateCommitter({',
    '  readState: function () { return state; },',
    '  persistState: function (candidate) { return Storage.saveState(candidate); },',
    '  publishState: function (candidate) { state = candidate; },',
    '  enqueue: enqueueStatePersistenceTransaction,',
    '  readEpoch: function () { return uiStateEpoch; }',
    '});',
    'function commitStateChange(change, options = {}) {',
    '  return stateCommitter.commit(change).then(function (candidate) {',
    '    if (options.render !== false) render();',
    '    return candidate;',
    '  });',
    '}',
    extractFunction(lines, 'isStateCommitAborted'),
    extractFunction(lines, 'createStateCommitAbortedError'),
    extractFunction(lines, 'overwriteStateObject')
  ].join('\n\n')
    + '\nlet currentCourseId = null;'
    + '\nfunction render() {}'
    + '\n' + extractFunction(lines, 'importCsvText')
    + '\nglobalThis.__importCsvText = importCsvText;'
    + '\nglobalThis.__getCsvState = () => state;'
    + '\nglobalThis.__invalidateCsvStateEpoch = () => ++uiStateEpoch;'
    + '\nglobalThis.__commitOtherCsvStateChange = change => commitStateChange(change, { render: false });';
  vm.runInContext(source, modules.sandbox, { filename: 'importCsvText.js' });
  return {
    importCsvText: modules.sandbox.__importCsvText,
    getState: modules.sandbox.__getCsvState,
    invalidateStateEpoch: modules.sandbox.__invalidateCsvStateEpoch,
    commitOtherChange: modules.sandbox.__commitOtherCsvStateChange
  };
}

function loadCsvExporter(modules, initialState, lines = readSourceLines()) {
  modules.sandbox.__initialCsvState = initialState;
  const source = [
    extractFunction(lines, 'formatCsvTransferContextFields'),
    extractFunction(lines, 'buildTransferRows'),
    'let state = globalThis.__initialCsvState;',
    'function downloadTextFile(content, mimeType, filename) { globalThis.__csvDownload = { content, mimeType, filename }; }',
    extractFunction(lines, 'exportTransferCsv'),
    'globalThis.__exportTransferCsv = exportTransferCsv;'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'exportTransferCsv.js' });
  return courses => {
    modules.sandbox.__exportTransferCsv(courses);
    return modules.sandbox.__csvDownload;
  };
}

module.exports = { loadCsvHelper, loadCsvImporter, loadCsvExporter };
