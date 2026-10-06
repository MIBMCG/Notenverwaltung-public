'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const requiredSources = [
  'src/document.html',
  'src/styles/legacy.css',
  'src/legacy/early-errors.js',
  'src/legacy/application.js',
  'src/transfer/csv-format.js',
  'src/transfer/csv-import-rules.js',
  'src/infrastructure/encryption.js',
  'src/infrastructure/storage.js',
  'src/domain/state.js',
  'src/domain/assessments.js',
  'src/domain/courses.js',
  'src/domain/students.js',
  'src/domain/migrations.js',
  'src/domain/domain-model.js',
  'src/ui/course-cards.css',
  'src/ui/course-cards.js',
  'src/ui/dashboard-data.js',
  'src/ui/dashboard-transition.js',
  'src/ui/persistence-boundary.js',
  'src/entry.js',
  'scripts/build.mjs'
];

async function loadBuildModule() {
  return import(pathToFileURL(path.join(root, 'scripts', 'build.mjs')).href);
}

test('Wave 1 source layout exists and the template owns every placeholder once', () => {
  for (const relativePath of requiredSources) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
  const template = fs.readFileSync(path.join(root, 'src', 'document.html'), 'utf8');
  for (const token of ['/*__NV_STYLES__*/', '/*__NV_EARLY_ERRORS__*/', '/*__NV_APPLICATION__*/']) {
    assert.equal(template.split(token).length - 1, 1, token);
  }
});

test('two in-memory builds are byte-identical and preserve execution order', async () => {
  const { buildArtifact } = await loadBuildModule();
  const first = await buildArtifact();
  const second = await buildArtifact();
  assert.equal(first, second);
  assert.equal(first.includes('\r'), false, 'generated HTML must use LF only');
  for (const token of ['/*__NV_STYLES__*/', '/*__NV_EARLY_ERRORS__*/', '/*__NV_APPLICATION__*/']) {
    assert.equal(first.includes(token), false, `generated HTML must not contain ${token}`);
  }

  const styleIndex = first.indexOf('<style>');
  const earlyIndex = first.indexOf('window.__firstError = null');
  const headEndIndex = first.indexOf('</head>');
  const appRootIndex = first.indexOf('<div id="app" class="app-root"></div>');
  const applicationIndex = first.indexOf('APP_RELEASE = Object.freeze');
  assert.ok(styleIndex >= 0 && styleIndex < earlyIndex);
  assert.ok(earlyIndex < headEndIndex && headEndIndex < appRootIndex);
  assert.ok(appRootIndex < applicationIndex);
  assert.match(first, /DomainModel/);
  assert.match(first, /Storage/);
  assert.match(first, /GradingLogic/);
  assert.match(first, /UiShell/);
});

test('artifact verification accepts equality, rejects drift, and never rewrites the candidate', async () => {
  const os = require('node:os');
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = fs;
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'noten-wave1-'));
  const artifactPath = path.join(temporaryDirectory, 'Notenverwaltung.html');
  try {
    const { buildArtifact } = await loadBuildModule();
    const { verifyArtifact } = await import(pathToFileURL(path.join(root, 'scripts', 'verify-artifact.mjs')).href);
    const expected = await buildArtifact();
    writeFileSync(artifactPath, expected, 'utf8');
    assert.equal(await verifyArtifact({ rootDir: root, artifactPath }), true);

    const drifted = `${expected}\n<!-- drift -->\n`;
    writeFileSync(artifactPath, drifted, 'utf8');
    await assert.rejects(
      verifyArtifact({ rootDir: root, artifactPath }),
      /nicht aktuell.*npm run build/i
    );
    assert.equal(readFileSync(artifactPath, 'utf8'), drifted);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('placeholder replacement rejects missing and duplicate build slots', async () => {
  const { replaceExactlyOnce } = await loadBuildModule();
  assert.throws(() => replaceExactlyOnce('kein Platzhalter', 'TOKEN', 'x'), /0-mal/);
  assert.throws(() => replaceExactlyOnce('TOKEN TOKEN', 'TOKEN', 'x'), /2-mal/);
  assert.equal(replaceExactlyOnce('a TOKEN b', 'TOKEN', 'x'), 'a x b');
});

test('placeholder replacement embeds dollar replacement sequences literally', async () => {
  const { replaceExactlyOnce } = await loadBuildModule();
  const replacement = "$&|$$|$`|$'";
  const actual = replaceExactlyOnce('left TOKEN right', 'TOKEN', replacement);
  const expected = 'left $&|$$|$`|$\' right';
  assert.equal(actual, expected);
});

test('a source failure preserves the last valid artifact and removes temporary output', async () => {
  const os = require('node:os');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'noten-wave1-failure-'));
  const outputPath = path.join(temporaryDirectory, 'Notenverwaltung.html');
  try {
    fs.writeFileSync(outputPath, 'last-valid-artifact', 'utf8');
    const { writeArtifact } = await loadBuildModule();
    await assert.rejects(writeArtifact({ rootDir: temporaryDirectory, outputPath }), /ENOENT/);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'last-valid-artifact');
    assert.equal(fs.existsSync(`${outputPath}.tmp`), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
