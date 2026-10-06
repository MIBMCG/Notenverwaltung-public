import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONTENT_NAMES, expectedPackage, hashLine, MAX_ENTRY_BYTES, MAX_ZIP_BYTES, PACKAGE_NAMES, zipName
} from './release-common.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

// This verifier accepts only the builder's ten-entry, root-level STORED ZIP
// format. Rejecting DEFLATE, descriptors, ZIP64 and comments keeps the parser
// small and prevents decompression bombs; the current HTML is about 1.33 MiB.

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function requireRange(bytes, offset, length, limit = bytes.length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
      offset + length > limit) throw new Error('ZIP-Struktur überschreitet Dateigrenzen.');
}

export function inspectReleaseZip(bytes) {
  const zip = Buffer.from(bytes);
  if (zip.length < 22 || zip.length > MAX_ZIP_BYTES) throw new Error('ZIP-Größe ist ungültig.');
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== END || zip.readUInt16LE(end + 20) !== 0) {
    throw new Error('ZIP-Ende enthält Kommentar, angehängte Bytes oder fehlt.');
  }
  if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0 ||
      zip.readUInt16LE(end + 8) !== PACKAGE_NAMES.length ||
      zip.readUInt16LE(end + 10) !== PACKAGE_NAMES.length) {
    throw new Error('ZIP-Datenträger oder Eintragszahl ist ungültig.');
  }
  const centralLength = zip.readUInt32LE(end + 12);
  const centralStart = zip.readUInt32LE(end + 16);
  if (centralStart + centralLength !== end) throw new Error('ZIP-Zentralverzeichnis hat versteckte oder fehlende Bytes.');
  let cursor = centralStart;
  let localEnd = 0;
  let dosTime = null;
  const entries = new Map();
  for (let index = 0; index < PACKAGE_NAMES.length; index += 1) {
    requireRange(zip, cursor, 46, end);
    if (zip.readUInt32LE(cursor) !== CENTRAL) throw new Error('ZIP-Zentralverzeichnis ist beschädigt.');
    const madeBy = zip.readUInt16LE(cursor + 4);
    const needed = zip.readUInt16LE(cursor + 6);
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const thisTime = zip.readUInt32LE(cursor + 12);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressed = zip.readUInt32LE(cursor + 20);
    const uncompressed = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extra = zip.readUInt16LE(cursor + 30);
    const comment = zip.readUInt16LE(cursor + 32);
    const disk = zip.readUInt16LE(cursor + 34);
    const internal = zip.readUInt16LE(cursor + 36);
    const external = zip.readUInt32LE(cursor + 38);
    const offset = zip.readUInt32LE(cursor + 42);
    requireRange(zip, cursor + 46, nameLength + extra + comment, end);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new Error(`Unsicherer ZIP-Pfad: ${name}`);
    if (entries.has(name)) throw new Error(`Doppelter ZIP-Eintrag: ${name}`);
    if (name !== PACKAGE_NAMES[index]) throw new Error(`ZIP-Eintrag außerhalb der Whitelist oder Reihenfolge: ${name}`);
    if (madeBy !== 20 || needed !== 20 || flags !== 0 || method !== 0 || extra !== 0 ||
        comment !== 0 || disk !== 0 || internal !== 0 || external !== 0 ||
        compressed !== uncompressed || uncompressed > MAX_ENTRY_BYTES || offset !== localEnd) {
      throw new Error(`ZIP-Eintrag ${name} hat nicht unterstützte Struktur, Größe oder Position.`);
    }
    if (dosTime !== null && thisTime !== dosTime) throw new Error('ZIP-Einträge haben verschiedene Zeitstempel.');
    dosTime = thisTime;
    requireRange(zip, offset, 30, centralStart);
    if (zip.readUInt32LE(offset) !== LOCAL || zip.readUInt16LE(offset + 4) !== needed ||
        zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method ||
        zip.readUInt32LE(offset + 10) !== thisTime || zip.readUInt32LE(offset + 14) !== crc ||
        zip.readUInt32LE(offset + 18) !== compressed || zip.readUInt32LE(offset + 22) !== uncompressed ||
        zip.readUInt16LE(offset + 26) !== nameLength || zip.readUInt16LE(offset + 28) !== 0) {
      throw new Error(`ZIP-Lokalheader für ${name} widerspricht dem Zentralverzeichnis.`);
    }
    requireRange(zip, offset + 30, nameLength + compressed, centralStart);
    if (zip.toString('utf8', offset + 30, offset + 30 + nameLength) !== name) {
      throw new Error(`ZIP-Lokalpfad für ${name} widerspricht dem Zentralverzeichnis.`);
    }
    const content = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + compressed);
    if (crc32(content) !== crc) throw new Error(`ZIP-CRC für ${name} ist falsch.`);
    entries.set(name, content);
    localEnd = offset + 30 + nameLength + compressed;
    cursor += 46 + nameLength;
  }
  if (cursor !== end || localEnd !== centralStart) throw new Error('ZIP enthält versteckte oder unreferenzierte Bytes.');
  return entries;
}

export async function verifyRelease({ rootDir = defaultRoot, zipPath, version } = {}) {
  if (!path.isAbsolute(zipPath || '') || path.basename(zipPath) !== zipName(version)) {
    throw new Error('ZIP-Pfad muss absolut sein und zur Version passen.');
  }
  const zip = await readFile(zipPath);
  const outer = await readFile(`${zipPath}.sha256`, 'utf8');
  if (outer !== hashLine(zip, path.basename(zipPath))) throw new Error('Äußere ZIP-SHA256-Prüfsumme ist falsch.');
  const entries = inspectReleaseZip(zip);
  const inner = CONTENT_NAMES.map(name => hashLine(entries.get(name), name)).join('');
  if (entries.get('SHA256SUMS.txt').toString('utf8') !== inner) {
    throw new Error('Innere SHA256SUMS.txt ist falsch oder unvollständig.');
  }
  const expected = await expectedPackage(rootDir, version);
  for (const name of PACKAGE_NAMES) {
    if (!entries.get(name).equals(expected.get(name))) throw new Error(`Paketinhalt ${name} weicht von der Quelle ab.`);
  }
  return true;
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--zip' || args[2] !== '--version') {
    console.error('Aufruf: node scripts/verify-release.mjs --zip <absolute-ZIP-Datei> --version x.y.z');
    process.exitCode = 1;
  } else {
    verifyRelease({ zipPath: args[1], version: args[3] })
      .then(() => console.log('Release-Paket und Prüfsummen stimmen mit den Quellen überein.'))
      .catch(error => { console.error(`Paketprüfung fehlgeschlagen: ${error.message}`); process.exitCode = 1; });
  }
}
