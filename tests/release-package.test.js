'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { zipSync, unzipSync } = require('fflate');

const repoRoot = path.resolve(__dirname, '..');
const VERSION = '1.6.0';
const NAMES = [
  'ABNAHME.md', 'ASSET_NOTICES.md', 'KURZANLEITUNG.md', 'LICENSE',
  'Notenverwaltung.html', 'RELEASE-NOTES.md', 'SHA256SUMS.txt',
  'START-LESEN.txt', 'THIRD_PARTY_NOTICES.txt', 'placeholder-logo.svg'
];
const fullLicense = fs.readFileSync(path.join(__dirname, 'fixtures/release-license.txt'), 'utf8').replace(/\r\n?/g, '\n');

function put(root, relative, content) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

async function fixture(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-release-tool-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const rootDir = path.join(sandbox, 'source');
  const outputDir = path.join(sandbox, 'out');
  fs.mkdirSync(rootDir);
  fs.mkdirSync(outputDir);
  put(rootDir, 'src/document.html', '<!doctype html>\n<html><head><style>/*__NV_STYLES__*/</style><script>/*__NV_EARLY_ERRORS__*/</script></head><body><script>/*__NV_APPLICATION__*/</script></body></html>\n');
  put(rootDir, 'src/styles/legacy.css', 'body { color: black; }\n');
  put(rootDir, 'src/ui/course-cards.css', '.card { color: blue; }\n');
  put(rootDir, 'src/legacy/early-errors.js', 'window.firstError = null;\n');
  put(rootDir, 'src/entry.js', "import './legacy/application.js';\n");
  put(rootDir, 'src/legacy/application.js', `const APP_RELEASE = Object.freeze({ version: "${VERSION}" });\nwindow.APP_RELEASE = APP_RELEASE;\n`);
  const { buildArtifact } = await import(pathToFileURL(path.join(repoRoot, 'scripts/build.mjs')).href);
  put(rootDir, 'Notenverwaltung.html', await buildArtifact({ rootDir }));
  put(rootDir, 'placeholder-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  put(rootDir, 'LICENSE', fullLicense);
  put(rootDir, 'ASSET_NOTICES.md', '# Neutrales Platzhalterlogo\nEigene Grafik.\n');
  put(rootDir, 'docs/KURZANLEITUNG.md', '# Anleitung\n[Abnahme](ABNAHME.md#beleg) [Logo](../placeholder-logo.svg)\n');
  put(rootDir, 'docs/ABNAHME.md', `# Abnahme – Version ${VERSION}\n## Beleg\nSynthetischer Beleg.\n`);
  put(rootDir, `docs/releases/${VERSION}.md`, `# Version ${VERSION}\nSynthetische Release-Notiz.\n`);
  put(rootDir, 'docs/releases/THIRD_PARTY_NOTICES.txt', fs.readFileSync(path.join(repoRoot, 'docs/releases/THIRD_PARTY_NOTICES.txt')));
  put(rootDir, 'private-backup.enc.json', 'SYNTHETISCH-NICHT-VERPACKEN');
  put(rootDir, 'Logo.png', 'SYNTHETISCH-NICHT-VERPACKEN');
  put(rootDir, '.git/config', 'SYNTHETISCH-NICHT-VERPACKEN');
  return { rootDir, outputDir };
}

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function zipPath(outputDir) { return path.join(outputDir, `Notenverwaltung-${VERSION}.zip`); }
function sidecar(zipFile) { return `${zipFile}.sha256`; }
function rehash(zipFile) {
  fs.writeFileSync(sidecar(zipFile), `${sha(fs.readFileSync(zipFile))}  ${path.basename(zipFile)}\n`);
}
function changeZip(zipFile, bytes) {
  fs.writeFileSync(zipFile, bytes);
  rehash(zipFile);
}
async function builtFixture(t) {
  const paths = await fixture(t);
  const api = await modules();
  await api.buildRelease({ ...paths, version: VERSION });
  return { ...paths, ...api, zipFile: zipPath(paths.outputDir) };
}
function storedZip(entries) {
  return Buffer.from(zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1), os: 0, attrs: 0 }));
}
async function modules() {
  const build = await import(pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href);
  const verify = await import(pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href);
  return { ...build, ...verify };
}

test('builds the exact ten-file package deterministically without changing source bytes', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const sourceBefore = fs.readFileSync(path.join(rootDir, 'Notenverwaltung.html'));
  const guideBefore = fs.readFileSync(path.join(rootDir, 'docs/KURZANLEITUNG.md'));
  const { buildRelease, verifyRelease } = await modules();
  await buildRelease({ rootDir, version: VERSION, outputDir });
  const zipFile = zipPath(outputDir);
  const firstZip = fs.readFileSync(zipFile);
  const firstSidecar = fs.readFileSync(sidecar(zipFile));
  const entries = unzipSync(firstZip);
  assert.deepEqual(Object.keys(entries).sort(), NAMES);
  assert.equal(Buffer.from(entries['SHA256SUMS.txt']).toString('utf8').trimEnd().split('\n').length, 9);
  assert.match(Buffer.from(entries['KURZANLEITUNG.md']).toString('utf8'), /\]\(placeholder-logo\.svg\)/);
  assert.equal(firstZip.includes(Buffer.from('SYNTHETISCH-NICHT-VERPACKEN')), false);
  assert.equal(await verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), true);
  await buildRelease({ rootDir, version: VERSION, outputDir });
  assert.deepEqual(fs.readFileSync(zipFile), firstZip);
  assert.deepEqual(fs.readFileSync(sidecar(zipFile)), firstSidecar);
  assert.deepEqual(fs.readFileSync(path.join(rootDir, 'Notenverwaltung.html')), sourceBefore);
  assert.deepEqual(fs.readFileSync(path.join(rootDir, 'docs/KURZANLEITUNG.md')), guideBefore);
});

test('packages an SVG source with CRLF as canonical LF without changing the source', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const sourcePath = path.join(rootDir, 'placeholder-logo.svg');
  const crlfSource = fs.readFileSync(sourcePath, 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(sourcePath, crlfSource);
  const { buildRelease, verifyRelease } = await modules();
  await buildRelease({ rootDir, outputDir, version: VERSION });
  const packaged = unzipSync(fs.readFileSync(zipPath(outputDir)));
  assert.equal(Buffer.from(packaged['placeholder-logo.svg']).toString('utf8'), crlfSource.replace(/\r\n/g, '\n'));
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), crlfSource);
  assert.equal(await verifyRelease({ rootDir, zipPath: zipPath(outputDir), version: VERSION }), true);
});

test('identical source trees differing only in SVG LF versus CRLF build byte-identical ZIPs', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const secondOutput = path.join(path.dirname(outputDir), 'crlf-output');
  fs.mkdirSync(secondOutput);
  const svgPath = path.join(rootDir, 'placeholder-logo.svg');
  const lfSource = fs.readFileSync(svgPath, 'utf8');
  const { buildRelease } = await modules();
  await buildRelease({ rootDir, outputDir, version: VERSION });
  const lfZip = fs.readFileSync(zipPath(outputDir));
  fs.writeFileSync(svgPath, lfSource.replace(/\n/g, '\r\n'));
  await buildRelease({ rootDir, outputDir: secondOutput, version: VERSION });
  assert.deepEqual(fs.readFileSync(zipPath(secondOutput)), lfZip);
  assert.deepEqual(fs.readFileSync(sidecar(zipPath(secondOutput))), fs.readFileSync(sidecar(zipPath(outputDir))));
});

test('refuses a synthetic source root without final LICENSE', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease } = await modules();
  fs.rmSync(path.join(rootDir, 'LICENSE'));
  await assert.rejects(buildRelease({ rootDir, version: VERSION, outputDir }), /LICENSE/i);
});

test('checks outer and inner hashes independently, then rejects changed content even with valid new hashes', async t => {
  const { rootDir, zipFile, verifyRelease } = await builtFixture(t);
  const original = fs.readFileSync(zipFile);
  fs.writeFileSync(sidecar(zipFile), `0${fs.readFileSync(sidecar(zipFile), 'utf8').slice(1)}`);
  await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /äußere.*SHA256/i);

  const files = unzipSync(original);
  files['SHA256SUMS.txt'] = Buffer.from('0'.repeat(64) + '  LICENSE\n');
  changeZip(zipFile, storedZip(files));
  await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /innere.*SHA256/i);

  const originalFiles = unzipSync(original);
  originalFiles.LICENSE = Buffer.from(fullLicense.replace('Marco Civico', 'Erfundener Name'));
  const names = NAMES.filter(name => name !== 'SHA256SUMS.txt');
  originalFiles['SHA256SUMS.txt'] = Buffer.from(names.map(name => `${sha(originalFiles[name])}  ${name}\n`).join(''));
  changeZip(zipFile, storedZip(originalFiles));
  await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /Paketinhalt LICENSE/i);
});

test('rejects corrupt ZIP CRC despite a matching outer sidecar', async t => {
  const { rootDir, zipFile, verifyRelease } = await builtFixture(t);
  const damaged = fs.readFileSync(zipFile);
  const name = Buffer.from('LICENSE');
  const at = damaged.indexOf(name);
  assert.ok(at > 0);
  const dataStart = at + name.length;
  damaged[dataStart + 20] ^= 1;
  changeZip(zipFile, damaged);
  await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /ZIP-CRC.*LICENSE/i);
});

test('rejects duplicate, unsafe and extra ZIP names with a valid sidecar', async t => {
  const { rootDir, zipFile, verifyRelease } = await builtFixture(t);
  const original = fs.readFileSync(zipFile);
  for (const [oldName, replacement, error] of [
    ['RELEASE-NOTES.md', 'ASSET_NOTICES.md', /doppelter ZIP-Eintrag/i],
    ['ASSET_NOTICES.md', '../escape'.padEnd(16, 'x'), /unsicherer ZIP-Pfad/i]
  ]) {
    const originalName = Buffer.from(oldName);
    assert.equal(Buffer.byteLength(replacement), originalName.length);
    const changed = Buffer.from(original);
    let start = 0;
    const positions = [];
    while ((start = changed.indexOf(originalName, start)) >= 0) {
      positions.push(start);
      start += originalName.length;
    }
    assert.equal(positions.length, 3, 'local header, inner manifest and central header');
    for (const position of [positions[0], positions[2]]) changed.write(replacement, position, 'ascii');
    changeZip(zipFile, changed);
    await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), error);
  }
  for (const forbidden of ['private-backup.enc.json', 'Logo.png']) {
    const entries = unzipSync(original);
    entries[forbidden] = Buffer.from('SYNTHETISCH-NICHT-VERPACKEN');
    changeZip(zipFile, storedZip(entries));
    await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /Eintragszahl|ZIP-Pfad/i);
  }
});

test('rejects hidden bytes, comments, mismatched local size and central offset', async t => {
  const { rootDir, zipFile, verifyRelease } = await builtFixture(t);
  const original = fs.readFileSync(zipFile);
  const end = original.length - 22;
  const centralStart = original.readUInt32LE(end + 16);
  const variants = [];
  variants.push([Buffer.concat([original, Buffer.from('hidden')]), /ZIP-Ende/i]);
  const comment = Buffer.concat([original, Buffer.from('x')]);
  comment.writeUInt16LE(1, end + 20);
  variants.push([comment, /ZIP-Ende/i]);
  const wrongLocal = Buffer.from(original);
  wrongLocal.writeUInt32LE(wrongLocal.readUInt32LE(18) + 1, 18);
  variants.push([wrongLocal, /Lokalheader/i]);
  const wrongCentral = Buffer.from(original);
  wrongCentral.writeUInt32LE(centralStart - 1, end + 16);
  variants.push([wrongCentral, /Zentralverzeichnis|versteckt/i]);
  const unsupportedMethod = Buffer.from(original);
  unsupportedMethod.writeUInt16LE(8, 8);
  unsupportedMethod.writeUInt16LE(8, centralStart + 10);
  variants.push([unsupportedMethod, /nicht unterstützte Struktur/i]);
  const descriptorFlag = Buffer.from(original);
  descriptorFlag.writeUInt16LE(8, 6);
  descriptorFlag.writeUInt16LE(8, centralStart + 8);
  variants.push([descriptorFlag, /nicht unterstützte Struktur/i]);
  const hiddenLocal = Buffer.concat([original.subarray(0, centralStart), Buffer.from([1, 2, 3]), original.subarray(centralStart)]);
  hiddenLocal.writeUInt32LE(centralStart + 3, hiddenLocal.length - 22 + 16);
  variants.push([hiddenLocal, /versteckte|unreferenzierte/i]);
  for (const [bytes, error] of variants) {
    changeZip(zipFile, bytes);
    await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), error);
  }
});

test('rejects incomplete rights, wrong release version and drifted HTML before writing an output', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease } = await modules();
  const license = path.join(rootDir, 'LICENSE');
  fs.writeFileSync(license, fullLicense.replace(/THE SOFTWARE IS PROVIDED[\s\S]*/, ''));
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /MIT-LICENSE/i);
  fs.writeFileSync(license, fullLicense);
  const noticesPath = path.join(rootDir, 'docs/releases/THIRD_PARTY_NOTICES.txt');
  const notices = fs.readFileSync(noticesPath, 'utf8');
  fs.writeFileSync(noticesPath, notices.replace('Copyright (c) 2026 Arjun Barrett', ''));
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Drittanbieterhinweis/i);
  fs.writeFileSync(noticesPath, notices.replace('The above copyright notice and this permission notice shall be included in all', 'The notice was removed'));
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Drittanbieterhinweis/i);
  fs.writeFileSync(noticesPath, notices);
  fs.writeFileSync(path.join(rootDir, `docs/releases/${VERSION}.md`), '# Version 1.5.1\n');
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Release-Notiz.*1\.6\.0/i);
  fs.writeFileSync(path.join(rootDir, `docs/releases/${VERSION}.md`), `# Version ${VERSION}\n`);
  fs.appendFileSync(path.join(rootDir, 'Notenverwaltung.html'), '<!-- drift -->\n');
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /buildidentisch|weicht bytegenau/i);
  assert.deepEqual(fs.readdirSync(outputDir), []);
});

test('explicit UTC timestamp yields identical ZIP bytes in different time zones and rejects odd seconds', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease } = await modules();
  const otherOutput = path.join(path.dirname(outputDir), 'other-output');
  fs.mkdirSync(otherOutput);
  const importUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const script = `import {buildRelease} from ${JSON.stringify(importUrl)}; await buildRelease({rootDir:process.argv[1],version:${JSON.stringify(VERSION)},outputDir:process.argv[2],timestamp:'2026-09-23T12:34:56Z'});`;
  for (const [zone, target] of [['UTC', outputDir], ['America/New_York', otherOutput]]) {
    execFileSync(process.execPath, ['--input-type=module', '-e', script, rootDir, target], {
      env: { ...process.env, TZ: zone }
    });
  }
  assert.deepEqual(fs.readFileSync(zipPath(outputDir)), fs.readFileSync(zipPath(otherOutput)));
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION, timestamp: '2026-09-23T12:34:57Z' }), /ungerade Sekunden/i);
  for (const bad of [
    '1979-12-31T23:59:58Z', '2100-01-01T00:00:00Z',
    '2026-02-30T00:00:00Z', '2026-09-23T12:34:56.000Z',
    '2026-09-23T14:34:56+02:00'
  ]) {
    await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION, timestamp: bad }), /ZIP-Zeitstempel/i, bad);
  }
});

test('refuses a flat guide whose local anchor is absent from the packaged document', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease } = await modules();
  fs.writeFileSync(path.join(rootDir, 'docs/KURZANLEITUNG.md'), '# Anleitung\n[Abnahme](ABNAHME.md#fehlender-beleg)\n');
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Anker|fehlender-beleg/i);
});

test('refuses private relative links in any packaged Markdown document', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease } = await modules();
  fs.appendFileSync(path.join(rootDir, 'docs/ABNAHME.md'), '[Interner Bericht](superpowers/private-review.md)\n');
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Paketdatei|Paketlink|außerhalb/i);
});

test('builder and verifier explicitly reject active reference and HTML links in package documents', async t => {
  const { rootDir, outputDir, zipFile, buildRelease, verifyRelease } = await builtFixture(t);
  const guidePath = path.join(rootDir, 'docs/KURZANLEITUNG.md');
  const abnahmePath = path.join(rootDir, 'docs/ABNAHME.md');
  const originalGuide = fs.readFileSync(guidePath, 'utf8');
  const originalAbnahme = fs.readFileSync(abnahmePath, 'utf8');
  for (const [target, addition, expected] of [
    [guidePath, '\n![Logo][bild]\n\n[bild]: ../placeholder-logo.svg\n', /Referenzlink/i],
    [guidePath, '\n![Logo]\n\n[Logo]:\n  ../placeholder-logo.svg\n', /Referenzlink/i],
    [abnahmePath, '\n[Intern][plan]\n\n[plan]: superpowers/private-review.md\n', /Referenzlink/i],
    [abnahmePath, '\n[plan]\n\n[plan]:\n  superpowers/private-review.md\n', /Referenzlink/i],
    [abnahmePath, '\n<a href="superpowers/private-review.md">Intern</a>\n', /HTML-Link/i],
    [abnahmePath, '\n<area href="superpowers/private-review.md" alt="Intern">\n', /HTML-Link/i],
    [abnahmePath, '\n<!-- before --><a href="superpowers/private-review.md">Intern</a><!-- after -->\n', /HTML-Link/i],
    [abnahmePath, '\n<!-- before --!><a href="superpowers/private-review.md">Intern</a><!-- after -->\n', /HTML-Link/i],
    [abnahmePath, '\n<!--><a href="superpowers/private-review.md">Intern</a><!-- after -->\n', /HTML-Link/i],
    [abnahmePath, '\n``` aa ```\n[Intern](superpowers/private-review.md)\n', /Paketdatei|Paketlink|außerhalb/i],
    [abnahmePath, '\n\\`[Intern](superpowers/private-review.md)\\`\n', /Paketdatei|Paketlink|außerhalb/i],
    [abnahmePath, '\n- [Intern](superpowers/private-review.md)\n', /Paketdatei|Paketlink|außerhalb/i],
    [abnahmePath, '\nAbsatz mit [Intern](superpowers/private-review.md).\n', /Paketdatei|Paketlink|außerhalb/i]
  ]) {
    fs.writeFileSync(guidePath, originalGuide);
    fs.writeFileSync(abnahmePath, originalAbnahme);
    fs.appendFileSync(target, addition);
    await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), expected);
    await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), expected);
  }
});

test('rewrites only parsed guide destinations including escaped spelling and matching label text', async t => {
  const { rootDir, outputDir } = await fixture(t);
  const { buildRelease, verifyRelease } = await modules();
  const guide = '# Anleitung\n[../placeholder-logo.svg](../placeholder-logo.svg) [Logo](../placeholder-logo\\.svg)\n';
  put(rootDir, 'docs/KURZANLEITUNG.md', guide);
  await buildRelease({ rootDir, outputDir, version: VERSION });
  const zipFile = zipPath(outputDir);
  const packaged = Buffer.from(unzipSync(fs.readFileSync(zipFile))['KURZANLEITUNG.md']).toString('utf8');
  assert.equal(packaged, '# Anleitung\n[../placeholder-logo.svg](placeholder-logo.svg) [Logo](placeholder-logo.svg)\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'docs/KURZANLEITUNG.md'), 'utf8'), guide);
  assert.equal(await verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), true);
  put(rootDir, 'docs/KURZANLEITUNG.md', '# Anleitung\n[![Logo](../placeholder-logo.svg)](ABNAHME.md)\n');
  await assert.rejects(buildRelease({ rootDir, outputDir, version: VERSION }), /Markdown-Linkform/i);
  await assert.rejects(verifyRelease({ rootDir, zipPath: zipFile, version: VERSION }), /Markdown-Linkform/i);
});
