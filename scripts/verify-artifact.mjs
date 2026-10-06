import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildArtifact } from './build.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyArtifact({
  rootDir = defaultRoot,
  artifactPath = path.join(rootDir, 'Notenverwaltung.html')
} = {}) {
  const expected = Buffer.from(await buildArtifact({ rootDir }), 'utf8');
  const actual = await readFile(artifactPath);
  if (!actual.equals(expected)) {
    throw new Error('Notenverwaltung.html ist nicht aktuell. Bitte npm run build ausführen und die Änderung committen.');
  }
  return true;
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  verifyArtifact()
    .then(() => console.log('Notenverwaltung.html stimmt bytegenau mit den Quellen überein.'))
    .catch(error => {
      console.error(`Artefaktprüfung fehlgeschlagen: ${error.message}`);
      process.exitCode = 1;
    });
}
