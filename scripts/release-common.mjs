import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildArtifact } from './build.mjs';
import { documentAnchors, markdownLinks, scanMarkdownLinks } from './verify-doc-links.mjs';

export const PACKAGE_NAMES = Object.freeze([
  'ABNAHME.md', 'ASSET_NOTICES.md', 'KURZANLEITUNG.md', 'LICENSE',
  'Notenverwaltung.html', 'RELEASE-NOTES.md', 'SHA256SUMS.txt',
  'START-LESEN.txt', 'THIRD_PARTY_NOTICES.txt', 'placeholder-logo.svg'
]);
export const CONTENT_NAMES = Object.freeze(PACKAGE_NAMES.filter(name => name !== 'SHA256SUMS.txt'));
export const DEFAULT_TIMESTAMP = '1980-01-01T00:00:00Z';
export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

const MIT_LICENSE = `MIT License

Copyright (c) 2026 Marco Civico

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const sources = Object.freeze({
  'ABNAHME.md': 'docs/ABNAHME.md',
  'ASSET_NOTICES.md': 'ASSET_NOTICES.md',
  'KURZANLEITUNG.md': 'docs/KURZANLEITUNG.md',
  LICENSE: 'LICENSE',
  'Notenverwaltung.html': 'Notenverwaltung.html',
  'THIRD_PARTY_NOTICES.txt': 'docs/releases/THIRD_PARTY_NOTICES.txt',
  'placeholder-logo.svg': 'placeholder-logo.svg'
});

export function assertVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Version muss eine Produktversion im Format x.y.z sein.');
  }
  return version;
}

export function zipName(version) { return `Notenverwaltung-${assertVersion(version)}.zip`; }
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function hashLine(bytes, name) { return `${sha256(bytes)}  ${name}\n`; }
export function lf(value) { return value.replace(/\r\n?/g, '\n'); }
export function textBytes(value) { return Buffer.from(lf(value), 'utf8'); }

export function archiveDate(timestamp = DEFAULT_TIMESTAMP) {
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) {
    throw new Error('ZIP-Zeitstempel muss UTC-ISO ohne Millisekunden sein.');
  }
  const utc = new Date(timestamp);
  if (!Number.isFinite(utc.valueOf()) || utc.toISOString().replace('.000Z', 'Z') !== timestamp) {
    throw new Error('ZIP-Zeitstempel ist ungültig.');
  }
  const [year, month, day, hour, minute, second] = [
    utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(),
    utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds()
  ];
  if (year < 1980 || year > 2099 || second % 2) {
    throw new Error('ZIP-Zeitstempel liegt außerhalb 1980–2099 oder hat ungerade Sekunden.');
  }
  // fflate writes DOS calendar fields with local Date getters. Reconstruct
  // the UTC calendar as local fields so the ZIP bytes do not depend on TZ.
  const local = new Date(year, month, day, hour, minute, second);
  if (local.getFullYear() !== year || local.getMonth() !== month || local.getDate() !== day ||
      local.getHours() !== hour || local.getMinutes() !== minute || local.getSeconds() !== second) {
    throw new Error('ZIP-Zeitstempel ist in der lokalen Zeitzone nicht darstellbar.');
  }
  return local;
}

function checkNotices(value) {
  for (const [component, copyright] of [
    ['write-excel-file 4.1.1', 'Copyright (c) 2018 gitlab.com/catamphetamine'],
    ['fflate 0.8.3', 'Copyright (c) 2026 Arjun Barrett']
  ]) {
    const fullText = MIT_LICENSE.replace('Copyright (c) 2026 Marco Civico', copyright);
    if (!value.includes(`${component}\n\n${fullText.trimEnd()}`)) {
      throw new Error(`Drittanbieterhinweis fehlt oder ist unvollständig: ${component}`);
    }
  }
}

function rewriteGuide(markdown) {
  const sourceToPackage = new Map([
    ['docs/ABNAHME.md', 'ABNAHME.md'],
    ['Notenverwaltung.html', 'Notenverwaltung.html'],
    ['placeholder-logo.svg', 'placeholder-logo.svg'],
    ['ASSET_NOTICES.md', 'ASSET_NOTICES.md'],
    ['LICENSE', 'LICENSE']
  ]);
  let rewritten = markdown;
  for (const { destination, start, end } of scanMarkdownLinks(markdown).sort((a, b) => b.start - a.start)) {
    if (/^(?:https?:|mailto:|#)/i.test(destination)) continue;
    const [linkPath, fragment] = destination.split('#', 2);
    const decoded = decodeURIComponent(linkPath);
    if (!decoded || decoded.includes('\\') || decoded.includes('?') || path.posix.isAbsolute(decoded)) {
      throw new Error(`Unsicherer Paketlink: ${destination}`);
    }
    const normalized = path.posix.normalize(path.posix.join('docs', decoded));
    const mapped = sourceToPackage.get(normalized);
    if (!mapped) throw new Error(`Kurzanleitung verweist außerhalb des Pakets: ${destination}`);
    const replacement = `${mapped}${fragment === undefined ? '' : `#${fragment}`}`;
    rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(end)}`;
  }
  return rewritten;
}

function checkPackageLinks(files) {
  for (const sourceName of files.keys()) {
    if (!sourceName.endsWith('.md')) continue;
    for (const destination of markdownLinks(files.get(sourceName).toString('utf8'))) {
      if (/^(?:https?:\/\/|mailto:)/i.test(destination)) continue;
      const [rawName, rawFragment = ''] = destination.split('#', 2);
      let name, fragment;
      try { name = decodeURIComponent(rawName || sourceName); fragment = decodeURIComponent(rawFragment); }
      catch { throw new Error(`Ungültiger Paketlink in ${sourceName}: ${destination}`); }
      if (!files.has(name)) throw new Error(`Paketdatei ${sourceName} verweist auf fehlenden Inhalt: ${destination}`);
      if (fragment && !documentAnchors(files.get(name).toString('utf8')).has(fragment)) {
        throw new Error(`Paket-Anker fehlt in ${sourceName}: ${destination}`);
      }
    }
  }
}

export async function expectedPackage(rootDir, version) {
  assertVersion(version);
  const appSource = await readFile(path.join(rootDir, 'src', 'legacy', 'application.js'), 'utf8');
  const found = /\bAPP_RELEASE\s*=\s*Object\.freeze\(\{\s*version:\s*["']([^"']+)["']/.exec(appSource);
  if (!found || found[1] !== version) throw new Error(`Produktversion ${version} fehlt in APP_RELEASE.version.`);
  const expectedHtml = Buffer.from(await buildArtifact({ rootDir }), 'utf8');
  const actualHtml = await readFile(path.join(rootDir, 'Notenverwaltung.html'));
  if (!actualHtml.equals(expectedHtml)) throw new Error('Notenverwaltung.html weicht bytegenau vom Build ab.');

  const files = new Map();
  for (const [name, relative] of Object.entries(sources)) {
    let bytes;
    try { bytes = await readFile(path.join(rootDir, ...relative.split('/'))); }
    catch (error) { throw new Error(`Paketpflichtdatei fehlt: ${relative}`, { cause: error }); }
    files.set(name, name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.svg') || name === 'LICENSE'
      ? textBytes(bytes.toString('utf8')) : bytes);
  }
  if (!files.get('Notenverwaltung.html').equals(expectedHtml)) throw new Error('Programm-HTML ist nicht buildidentisch.');
  if (files.get('LICENSE').toString('utf8') !== MIT_LICENSE) throw new Error('Finale vollständige MIT-LICENSE fehlt oder weicht ab.');
  checkNotices(files.get('THIRD_PARTY_NOTICES.txt').toString('utf8'));
  const releasePath = path.join(rootDir, 'docs', 'releases', `${version}.md`);
  let releaseNotes;
  try { releaseNotes = lf(await readFile(releasePath, 'utf8')); }
  catch (error) { throw new Error(`Release-Notiz fehlt: docs/releases/${version}.md`, { cause: error }); }
  if (!new RegExp(`^# [^\\n]*\\b${version.replaceAll('.', '\\.')}\\b`, 'm').test(releaseNotes)) {
    throw new Error(`Release-Notiz nennt Produktversion ${version} nicht im Titel.`);
  }
  files.set('RELEASE-NOTES.md', textBytes(releaseNotes));
  if (!files.get('ABNAHME.md').toString('utf8').match(new RegExp(`^# [^\\n]*\\b${version.replaceAll('.', '\\.')}\\b`, 'm'))) {
    throw new Error(`Abnahmeübersicht nennt Version ${version} nicht im Titel.`);
  }
  files.set('KURZANLEITUNG.md', textBytes(rewriteGuide(files.get('KURZANLEITUNG.md').toString('utf8'))));
  files.set('START-LESEN.txt', textBytes(
    `Notenverwaltung ${version}\n\n` +
    'Notenverwaltung.html und placeholder-logo.svg im selben Ordner belassen.\n' +
    'Notenverwaltung.html im unterstützten Dateibrowser öffnen.\n' +
    'Die Kurzanleitung steht in KURZANLEITUNG.md; Prüfgrenzen in ABNAHME.md.\n' +
    'Browserdaten liegen nicht in der HTML-Datei. Verschlüsselte Backups getrennt aufbewahren.\n'
  ));
  checkPackageLinks(files);
  for (const name of CONTENT_NAMES) {
    const value = files.get(name);
    if (!value || !value.length || value.length > MAX_ENTRY_BYTES) throw new Error(`Paketinhalt ${name} fehlt oder ist zu groß.`);
  }
  const inner = CONTENT_NAMES.map(name => hashLine(files.get(name), name)).join('');
  files.set('SHA256SUMS.txt', Buffer.from(inner, 'utf8'));
  return files;
}
