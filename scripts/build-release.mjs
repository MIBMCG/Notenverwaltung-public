import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import {
  archiveDate, expectedPackage, hashLine, MAX_ZIP_BYTES, PACKAGE_NAMES, zipName
} from './release-common.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildRelease({ rootDir = defaultRoot, version, outputDir, timestamp } = {}) {
  if (!path.isAbsolute(outputDir || '')) throw new Error('Ausgabeordner muss ein absoluter Pfad sein.');
  const date = archiveDate(timestamp);
  const files = await expectedPackage(rootDir, version);
  const entries = {};
  for (const name of PACKAGE_NAMES) {
    entries[name] = [new Uint8Array(files.get(name)), { level: 0, mtime: date, os: 0, attrs: 0 }];
  }
  const zipped = Buffer.from(zipSync(entries, { level: 0, mtime: date, os: 0, attrs: 0 }));
  if (zipped.length > MAX_ZIP_BYTES) throw new Error('Release-ZIP überschreitet die Größenobergrenze.');
  const name = zipName(version);
  const temporary = await mkdtemp(path.join(outputDir, '.nv-release-'));
  const zipPath = path.join(outputDir, name);
  const checksumPath = `${zipPath}.sha256`;
  try {
    const tempZip = path.join(temporary, name);
    const tempChecksum = `${tempZip}.sha256`;
    await writeFile(tempZip, zipped);
    await writeFile(tempChecksum, hashLine(zipped, name), 'utf8');
    await rename(tempZip, zipPath);
    await rename(tempChecksum, checksumPath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { zipPath, checksumPath };
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--version' || args[2] !== '--out') {
    console.error('Aufruf: node scripts/build-release.mjs --version x.y.z --out <absoluter-Ausgabeordner>');
    process.exitCode = 1;
  } else {
    buildRelease({ version: args[1], outputDir: args[3] })
      .then(({ zipPath }) => console.log(`Paket erzeugt: ${zipPath}`))
      .catch(error => { console.error(`Paketbau fehlgeschlagen: ${error.message}`); process.exitCode = 1; });
  }
}
