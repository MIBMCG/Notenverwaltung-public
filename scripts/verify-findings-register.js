'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGISTER_PATH = path.join(ROOT, 'docs', 'quality', 'current-findings.json');
const STATUSES = new Set(['closed', 'partial', 'confirmed-open', 'manual-boundary']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const TARGET_WAVES = new Set([
  'wave-0b-remediation',
  'wave-1-build-equivalence',
  'wave-2-formatting',
  'wave-3-domain',
  'wave-4-infrastructure',
  'wave-5-ui-foundation',
  'wave-6-shell',
  'wave-7-views-themes',
  'wave-8-release-hardening',
  'release-matrix'
]);
const REQUIRED_SOURCE_PATHS = [
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

function range(prefix, start, end, width = 0) {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = String(start + index).padStart(width, '0');
    return `${prefix}${value}`;
  });
}

function expectedFindingIds() {
  return [
    ...range('K', 1, 5),
    ...range('H', 1, 14),
    ...range('M', 1, 33),
    ...range('L', 1, 20, 2),
    ...range('N', 1, 6)
  ];
}

function requireString(value, field, id) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${id}.${field} must be a non-empty string`);
}

function resolveSafeRelativeFile(relativePath, field, rootDir, requiredRoot = null) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)) {
    throw new Error(`${field} must be a safe repo-relative path`);
  }
  const parts = relativePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${field} must be a safe repo-relative path`);
  if (requiredRoot && parts[0] !== requiredRoot) throw new Error(`${field} must be below ${requiredRoot}/`);
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, ...parts);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) throw new Error(`${field} must be a safe repo-relative path`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`${field} must name an existing file`);
  return resolved;
}

function readCanonicalText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
}

function sha256Text(filePath) {
  return crypto.createHash('sha256').update(readCanonicalText(filePath), 'utf8').digest('hex');
}

function listFilesBelow(directoryPath, relativePrefix) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) return [];
  const paths = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const relativePath = `${relativePrefix}/${entry.name}`;
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) paths.push(...listFilesBelow(absolutePath, relativePath));
    else if (entry.isFile()) paths.push(relativePath);
  }
  return paths;
}

function requireSamePaths(actualPaths, expectedPaths, message) {
  const actual = [...actualPaths].sort();
  const expected = [...expectedPaths].sort();
  const missing = expected.filter(relativePath => !actual.includes(relativePath));
  const unexpected = actual.filter(relativePath => !expected.includes(relativePath));
  if (missing.length || unexpected.length) {
    throw new Error(`${message}; missing=${missing}; unexpected=${unexpected}`);
  }
}

function validateSourceSnapshot(sourceSnapshot, rootDir) {
  if (!sourceSnapshot || typeof sourceSnapshot !== 'object' || Array.isArray(sourceSnapshot)) {
    throw new Error('sourceSnapshot must be an object');
  }
  if (sourceSnapshot.algorithm !== 'sha256') throw new Error('sourceSnapshot.algorithm must be sha256');
  const files = sourceSnapshot.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('sourceSnapshot.files must be an object');
  requireSamePaths(Object.keys(files), REQUIRED_SOURCE_PATHS, 'source snapshot path mismatch');

  for (const relativePath of REQUIRED_SOURCE_PATHS) {
    const hash = files[relativePath];
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`source snapshot hash for ${relativePath} must be 64 lowercase hexadecimal characters`);
    }
    const sourcePath = resolveSafeRelativeFile(relativePath, `source snapshot ${relativePath}`, rootDir);
    if (sha256Text(sourcePath) !== hash) throw new Error(`source snapshot hash mismatch for ${relativePath}`);
  }

  const discoveredSourcePaths = listFilesBelow(path.join(rootDir, 'src'), 'src');
  requireSamePaths(discoveredSourcePaths, REQUIRED_SOURCE_PATHS.filter(relativePath => relativePath.startsWith('src/')),
    'production source set changed; update the required source paths and baseline');
}

function validateFindingEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('finding must be an object');
  requireString(entry.id, 'id', 'finding');
  requireString(entry.sourceLabel, 'sourceLabel', entry.id);
  requireString(entry.summary, 'summary', entry.id);
  if (!SEVERITIES.has(entry.severity)) throw new Error(`${entry.id}.severity is invalid`);
  if (!STATUSES.has(entry.status)) throw new Error(`${entry.id}.status is invalid`);
  const evidence = entry.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error(`${entry.id}.evidence is invalid`);
  for (const field of ['commits', 'tests', 'codeAnchors']) {
    if (!Array.isArray(evidence[field]) || evidence[field].some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error(`${entry.id}.evidence.${field} is invalid`);
    }
  }
  const reviewReferences = evidence.reviewReferences || [];
  if (!Array.isArray(reviewReferences) || reviewReferences.some(reference =>
    !reference || typeof reference !== 'object' || Array.isArray(reference) ||
    typeof reference.path !== 'string' || !reference.path.trim() ||
    typeof reference.text !== 'string' || !reference.text.trim())) {
    throw new Error(`${entry.id}.evidence.reviewReferences is invalid`);
  }
  const hasEvidence = evidence.tests.length + evidence.codeAnchors.length + reviewReferences.length > 0;
  if (!hasEvidence) throw new Error(`${entry.id} has no evidence`);
  if (entry.status === 'closed' && evidence.tests.length === 0) {
    throw new Error(`${entry.id} closed finding lacks current test evidence`);
  }
  if (entry.targetWave !== null && !TARGET_WAVES.has(entry.targetWave)) {
    throw new Error(`${entry.id}.targetWave is invalid`);
  }
  if (entry.status === 'closed' && entry.targetWave !== null) {
    throw new Error(`${entry.id} closed finding must have targetWave null`);
  }
  if ((entry.status === 'partial' || entry.status === 'confirmed-open') && !TARGET_WAVES.has(entry.targetWave)) {
    throw new Error(`${entry.id}.targetWave is required for ${entry.status}`);
  }
  if (entry.status === 'manual-boundary' && entry.targetWave !== 'release-matrix') {
    throw new Error(`${entry.id}.targetWave must be release-matrix`);
  }
  if (entry.status === 'manual-boundary' && (typeof entry.notes !== 'string' || !entry.notes.trim())) {
    throw new Error(`${entry.id} manual-boundary finding requires a concrete procedure in notes`);
  }
  if (typeof entry.notes !== 'string') throw new Error(`${entry.id}.notes must be a string`);
  return true;
}

function validateHistoricalProvenance(historicalProvenance) {
  if (historicalProvenance === undefined) return;
  if (!historicalProvenance || typeof historicalProvenance !== 'object' || Array.isArray(historicalProvenance)) {
    throw new Error('historicalProvenance must be an object when present');
  }
  for (const [field, value] of Object.entries(historicalProvenance)) requireString(value, field, 'historicalProvenance');
}

function validateFindingsRegister(register, options = {}) {
  if (!register || register.schemaVersion !== 2) throw new Error('schemaVersion must be 2');
  const rootDir = path.resolve(options.rootDir || ROOT);
  validateHistoricalProvenance(register.historicalProvenance);
  validateSourceSnapshot(register.sourceSnapshot, rootDir);
  if (!Array.isArray(register.findings)) throw new Error('findings must be an array');
  if (!register.anchorReferences || typeof register.anchorReferences !== 'object' || Array.isArray(register.anchorReferences)) {
    throw new Error('anchorReferences must be an object');
  }
  const expected = expectedFindingIds();
  const actual = register.findings.map(entry => entry.id);
  if (new Set(actual).size !== actual.length) throw new Error('finding IDs must be unique');
  const missing = expected.filter(id => !actual.includes(id));
  const unexpected = actual.filter(id => !expected.includes(id));
  if (missing.length || unexpected.length) throw new Error(`finding ID mismatch; missing=${missing}; unexpected=${unexpected}`);
  const productionSource = REQUIRED_SOURCE_PATHS.map(relativePath =>
    readCanonicalText(resolveSafeRelativeFile(relativePath, 'production source', rootDir))).join('\n');
  const usedAnchorReferences = new Set();
  for (const entry of register.findings) {
    validateFindingEntry(entry);
    for (const testPath of entry.evidence.tests) {
      if (!/^tests\/[A-Za-z0-9._/-]+\.js$/.test(testPath)) {
        throw new Error(`${entry.id}.evidence test must be a safe JavaScript path below tests/`);
      }
      resolveSafeRelativeFile(testPath, `${entry.id}.evidence test`, rootDir, 'tests');
    }
    for (const anchor of entry.evidence.codeAnchors) {
      if (productionSource.includes(anchor)) continue;
      const reference = register.anchorReferences[anchor];
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
          typeof reference.path !== 'string' || typeof reference.text !== 'string' || !reference.text.trim()) {
        throw new Error(`${entry.id}.code anchor not found and has no valid anchor reference: ${anchor}`);
      }
      if (productionSource.includes(reference.text)) {
        usedAnchorReferences.add(anchor);
        continue;
      }
      const referencePath = resolveSafeRelativeFile(reference.path, `${entry.id}.anchor reference`, rootDir);
      if (!readCanonicalText(referencePath).includes(reference.text)) {
        throw new Error(`${entry.id}.anchor reference not found: ${reference.text}`);
      }
      usedAnchorReferences.add(anchor);
    }
    for (const reference of entry.evidence.reviewReferences || []) {
      const referencePath = resolveSafeRelativeFile(reference.path, `${entry.id}.review reference`, rootDir);
      if (!readCanonicalText(referencePath).includes(reference.text)) {
        throw new Error(`${entry.id}.review reference not found: ${reference.text}`);
      }
    }
  }
  const unusedAnchorReferences = Object.keys(register.anchorReferences).filter(anchor => !usedAnchorReferences.has(anchor));
  if (unusedAnchorReferences.length) throw new Error(`unused anchorReferences: ${unusedAnchorReferences.join(', ')}`);
  return true;
}

if (require.main === module) {
  const register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
  validateFindingsRegister(register);
  process.stdout.write(`Validated ${register.findings.length} findings against ${Object.keys(register.sourceSnapshot.files).length} source hashes\n`);
}

module.exports = { expectedFindingIds, validateFindingEntry, validateFindingsRegister };
