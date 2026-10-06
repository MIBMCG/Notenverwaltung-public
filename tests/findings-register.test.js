'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const validatorPath = path.join(root, 'scripts', 'verify-findings-register.js');
const registerPath = path.join(root, 'docs', 'quality', 'current-findings.json');

function readRegister() {
  return JSON.parse(fs.readFileSync(registerPath, 'utf8'));
}

function cloneRegister() {
  return JSON.parse(JSON.stringify(readRegister()));
}

function copyFixtureFile(fixtureRoot, relativePath) {
  const source = path.join(root, ...relativePath.split('/'));
  const destination = path.join(fixtureRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function createHistorylessFixture(register = cloneRegister()) {
  const fixtureRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'findings-register-'));
  const referencedPaths = new Set([
    ...Object.keys(register.sourceSnapshot.files),
    ...register.findings.flatMap(entry => entry.evidence.tests),
    ...Object.values(register.anchorReferences).map(reference => reference.path),
    ...register.findings.flatMap(entry => (entry.evidence.reviewReferences || []).map(reference => reference.path))
  ]);
  for (const relativePath of referencedPaths) copyFixtureFile(fixtureRoot, relativePath);
  return fixtureRoot;
}

test('the current findings register contains and validates all 78 stable findings', () => {
  assert.ok(fs.existsSync(validatorPath), 'findings validator is missing');
  assert.ok(fs.existsSync(registerPath), 'current findings register is missing');
  const { expectedFindingIds, validateFindingsRegister } = require(validatorPath);
  const register = readRegister();
  assert.equal(register.schemaVersion, 2);
  assert.equal(expectedFindingIds().length, 78);
  assert.equal(register.findings.length, 78);
  assert.doesNotThrow(() => validateFindingsRegister(register));
});

test('an open finding without a target wave is rejected', () => {
  assert.ok(fs.existsSync(validatorPath), 'findings validator is missing');
  const { validateFindingEntry } = require(validatorPath);
  assert.throws(() => validateFindingEntry({
    id: 'M19',
    sourceLabel: 'M19',
    severity: 'medium',
    status: 'confirmed-open',
    summary: 'Speichervorgaenge koennen sich ueberholen.',
    evidence: { commits: [], tests: ['tests/storage.test.js'], codeAnchors: ['Storage.saveState'] },
    targetWave: null,
    notes: ''
  }), /targetWave/);
});

test('the placeholder severity new is rejected', () => {
  assert.ok(fs.existsSync(validatorPath), 'findings validator is missing');
  const { validateFindingEntry } = require(validatorPath);
  assert.throws(() => validateFindingEntry({
    id: 'N1',
    sourceLabel: 'N1',
    severity: 'new',
    status: 'closed',
    summary: 'Eine Kalenderjahr-Termkopie wurde entfernt.',
    evidence: { commits: ['1fe69d4'], tests: ['tests/gradesheet.test.js'], codeAnchors: ['deriveTermFromDateValue'] },
    targetWave: null,
    notes: ''
  }), /severity/);
});

test('missing and duplicate stable IDs are rejected', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const missing = cloneRegister();
  missing.findings.pop();
  assert.throws(() => validateFindingsRegister(missing), /finding ID mismatch/);

  const duplicate = cloneRegister();
  duplicate.findings[1].id = duplicate.findings[0].id;
  assert.throws(() => validateFindingsRegister(duplicate), /unique/);
});

test('historical commit IDs and Git metadata are not needed in a historyless source copy', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const register = cloneRegister();
  delete register.historicalProvenance;
  for (const finding of register.findings) finding.evidence.commits = [];
  register.findings[0].evidence.reviewReferences = [{
    path: 'tests/fixtures/findings-review-reference.md',
    text: 'Synthetischer Prüfbeleg mit exakt diesem Ankertext.'
  }];
  const fixtureRoot = createHistorylessFixture(register);
  assert.equal(fs.existsSync(path.join(fixtureRoot, '.git')), false);
  assert.doesNotThrow(() => validateFindingsRegister(register, { rootDir: fixtureRoot }));
});

test('source snapshot paths and hashes are complete and strict', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const expectedPaths = [
    'Notenverwaltung.html',
    'src/document.html',
    'src/domain/assessments.js',
    'src/domain/course-settings.js',
    'src/domain/course-symbols.js',
    'src/domain/courses.js',
    'src/domain/domain-model.js',
    'src/domain/grading-logic.js',
    'src/domain/grading.js',
    'src/domain/initial-assessments.js',
    'src/domain/initial-state.js',
    'src/domain/migrations.js',
    'src/domain/state.js',
    'src/domain/students.js',
    'src/domain/terms.js',
    'src/entry.js',
    'src/formatting/date-time.js',
    'src/formatting/numbers.js',
    'src/formatting/text.js',
    'src/infrastructure/downloads.js',
    'src/infrastructure/encryption.js',
    'src/infrastructure/session-coordinator.js',
    'src/infrastructure/storage.js',
    'src/legacy/application.js',
    'src/legacy/early-errors.js',
    'src/styles/legacy.css',
    'src/transfer/csv-decoding.js',
    'src/transfer/csv-format.js',
    'src/transfer/csv-import-orchestrator.js',
    'src/transfer/csv-import-rules.js',
    'src/transfer/excel-export.js',
    'src/transfer/import-merge.js',
    'src/transfer/import-validation.js',
    'src/ui/course-cards.css',
    'src/ui/course-cards.js',
    'src/ui/course-symbol-picker.js',
    'src/ui/dashboard-data.js',
    'src/ui/dashboard-transition.js',
    'src/ui/persistence-boundary.js',
    'src/ui/state-commit.js'
  ];
  const register = cloneRegister();
  assert.equal(register.sourceSnapshot.algorithm, 'sha256');
  assert.deepEqual(Object.keys(register.sourceSnapshot.files).sort(), expectedPaths.sort());
  assert.ok(Object.values(register.sourceSnapshot.files).every(hash => /^[0-9a-f]{64}$/.test(hash)));

  const missing = cloneRegister();
  delete missing.sourceSnapshot.files['src/entry.js'];
  assert.throws(() => validateFindingsRegister(missing), /source snapshot path mismatch/);

  const unsafe = cloneRegister();
  unsafe.sourceSnapshot.files['../package.json'] = '0'.repeat(64);
  assert.throws(() => validateFindingsRegister(unsafe), /source snapshot path mismatch|safe repo-relative path/);

  const malformed = cloneRegister();
  malformed.sourceSnapshot.files['src/entry.js'] = 'deadbeef';
  assert.throws(() => validateFindingsRegister(malformed), /source snapshot hash.*64/);
});

test('source snapshot detects missing and changed production files without Git', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const register = cloneRegister();
  const missingRoot = createHistorylessFixture(register);
  fs.rmSync(path.join(missingRoot, 'src', 'entry.js'));
  assert.throws(() => validateFindingsRegister(register, { rootDir: missingRoot }), /source snapshot.*existing file/);

  const changedRoot = createHistorylessFixture(register);
  fs.appendFileSync(path.join(changedRoot, 'src', 'entry.js'), '\n// changed\n');
  assert.throws(() => validateFindingsRegister(register, { rootDir: changedRoot }), /source snapshot hash mismatch.*src\/entry\.js/);

  const lineEndingRoot = createHistorylessFixture(register);
  const entryPath = path.join(lineEndingRoot, 'src', 'entry.js');
  const lfSource = fs.readFileSync(entryPath, 'utf8').replace(/\r\n?/g, '\n');
  fs.writeFileSync(entryPath, lfSource.replace(/\n/g, '\r\n'));
  assert.doesNotThrow(() => validateFindingsRegister(register, { rootDir: lineEndingRoot }));

  const extraSourceRoot = createHistorylessFixture(register);
  fs.writeFileSync(path.join(extraSourceRoot, 'src', 'new-production.js'), 'export const value = 1;\n');
  assert.throws(() => validateFindingsRegister(register, { rootDir: extraSourceRoot }), /production source set changed/);
});

test('test evidence must be a safe existing file below tests', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const missing = cloneRegister();
  missing.findings[0].evidence.tests = ['tests/does-not-exist.test.js'];
  assert.throws(() => validateFindingsRegister(missing), /evidence test.*file/);

  const traversal = cloneRegister();
  traversal.findings[0].evidence.tests = ['tests/../package.json'];
  assert.throws(() => validateFindingsRegister(traversal), /evidence test.*safe/);

  const closedWithoutTest = cloneRegister();
  closedWithoutTest.findings[0].evidence.tests = [];
  assert.throws(() => validateFindingsRegister(closedWithoutTest), /closed finding lacks current test evidence/);
});

test('partial findings require current test, code, or review evidence beyond commit history', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const findingId = 'K1';
  const historicalAnchor = 'DomainModel.recalcAssessmentTermsForState';
  const reviewReference = {
    path: 'tests/fixtures/findings-review-reference.md',
    text: 'Synthetischer Prüfbeleg mit exakt diesem Ankertext.'
  };
  function partialRegister(evidence) {
    const register = cloneRegister();
    const finding = register.findings.find(entry => entry.id === findingId);
    finding.status = 'partial';
    finding.targetWave = 'wave-1-build-equivalence';
    finding.evidence = { commits: [], tests: [], codeAnchors: [], reviewReferences: [], ...evidence };
    // K1 is the sole user of this historical anchor, which these cases replace.
    delete register.anchorReferences[historicalAnchor];
    return register;
  }

  const commitOnly = partialRegister({ commits: ['864390e'] });
  assert.throws(() => validateFindingsRegister(commitOnly), /K1 has no evidence/);

  const currentEvidence = [
    { tests: ['tests/terms.test.js'] },
    { codeAnchors: ['deriveTermFromDateValue'] },
    { reviewReferences: [reviewReference] }
  ];
  for (const additionalEvidence of currentEvidence) {
    const register = partialRegister(additionalEvidence);
    assert.doesNotThrow(() => validateFindingsRegister(register), `expected current evidence to validate: ${Object.keys(additionalEvidence)[0]}`);
  }
});

test('code anchors or explicit review references must exist in tracked sources', () => {
  const { validateFindingsRegister } = require(validatorPath);
  const missingAnchor = cloneRegister();
  missingAnchor.findings[0].evidence.codeAnchors = ['definitelyMissingProductionAnchor'];
  assert.throws(() => validateFindingsRegister(missingAnchor), /code anchor.*not found/);

  const missingReference = cloneRegister();
  missingReference.findings[0].evidence.codeAnchors = [];
  missingReference.findings[0].evidence.reviewReferences = [{
    path: 'tests/fixtures/findings-review-reference.md',
    text: 'definitely missing review statement'
  }];
  assert.throws(() => validateFindingsRegister(missingReference), /review reference.*not found/);

  const missingFile = cloneRegister();
  missingFile.findings[0].evidence.codeAnchors = [];
  missingFile.findings[0].evidence.reviewReferences = [{
    path: 'tests/fixtures/missing-synthetic-review.md',
    text: 'Synthetischer Prüfbeleg mit exakt diesem Ankertext.'
  }];
  assert.throws(() => validateFindingsRegister(missingFile), /review reference.*file/);

  const traversal = cloneRegister();
  traversal.findings[0].evidence.codeAnchors = [];
  traversal.findings[0].evidence.reviewReferences = [{
    path: 'tests/../package.json',
    text: 'Synthetischer Prüfbeleg mit exakt diesem Ankertext.'
  }];
  assert.throws(() => validateFindingsRegister(traversal), /review reference.*safe/);
});

test('status and target-wave combinations are fully constrained', () => {
  const { validateFindingEntry } = require(validatorPath);
  const base = {
    id: 'N6', sourceLabel: 'N6', severity: 'low', status: 'confirmed-open',
    summary: 'Strukturelle Duplikation.',
    evidence: { commits: [], tests: ['tests/reporting.test.js'], codeAnchors: ['printWhenAssetsReady'], reviewReferences: [] },
    targetWave: 'wave-5-ui-foundation', notes: 'Offen.'
  };
  assert.throws(() => validateFindingEntry({ ...base, targetWave: 'wave-later' }), /targetWave/);
  assert.throws(() => validateFindingEntry({ ...base, status: 'closed' }), /closed.*targetWave/);
  assert.throws(() => validateFindingEntry({ ...base, status: 'manual-boundary' }), /release-matrix/);
  assert.doesNotThrow(() => validateFindingEntry({ ...base, status: 'manual-boundary', targetWave: 'release-matrix' }));
  assert.throws(() => validateFindingEntry({ ...base, status: 'manual-boundary', targetWave: 'release-matrix', notes: '' }), /procedure/);
});

test('package.json wires check:findings to the committed validator', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['check:findings'], 'node scripts/verify-findings-register.js');
});
