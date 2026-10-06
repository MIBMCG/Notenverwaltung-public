import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizeLf = value => value.replace(/\r\n?/g, '\n');

export const TOKENS = Object.freeze({
  styles: '/*__NV_STYLES__*/',
  earlyErrors: '/*__NV_EARLY_ERRORS__*/',
  application: '/*__NV_APPLICATION__*/'
});

export function replaceExactlyOnce(source, token, replacement) {
  const count = source.split(token).length - 1;
  if (count !== 1) {
    throw new Error(`Buildplatzhalter ${token} wurde ${count}-mal statt genau einmal gefunden.`);
  }
  return source.replace(token, () => replacement);
}

export async function buildArtifact({ rootDir = defaultRoot } = {}) {
  const template = normalizeLf(await readFile(path.join(rootDir, 'src', 'document.html'), 'utf8'));
  const styles = normalizeLf(await readFile(path.join(rootDir, 'src', 'styles', 'legacy.css'), 'utf8'));
  const cardStyles = normalizeLf(await readFile(path.join(rootDir, 'src', 'ui', 'course-cards.css'), 'utf8'));
  const combinedStyles = `${styles}\n${cardStyles}`;
  const earlyErrors = normalizeLf(await readFile(path.join(rootDir, 'src', 'legacy', 'early-errors.js'), 'utf8'));
  const result = await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'entry.js')],
    absWorkingDir: rootDir,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'inline',
    minify: false,
    sourcemap: false,
    logLevel: 'silent'
  });
  if (result.outputFiles.length !== 1) {
    throw new Error(`esbuild lieferte ${result.outputFiles.length} Ausgabedateien statt genau einer.`);
  }
  const application = normalizeLf(result.outputFiles[0].text);
  let artifact = replaceExactlyOnce(template, TOKENS.styles, combinedStyles);
  artifact = replaceExactlyOnce(artifact, TOKENS.earlyErrors, earlyErrors);
  artifact = replaceExactlyOnce(artifact, TOKENS.application, application);
  return normalizeLf(artifact);
}

export async function writeArtifact({ rootDir = defaultRoot, outputPath = path.join(rootDir, 'Notenverwaltung.html') } = {}) {
  const temporaryPath = `${outputPath}.tmp`;
  try {
    const artifact = await buildArtifact({ rootDir });
    await writeFile(temporaryPath, artifact, 'utf8');
    await rename(temporaryPath, outputPath);
    return artifact;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  writeArtifact()
    .then(() => console.log('Notenverwaltung.html wurde reproduzierbar erzeugt.'))
    .catch(error => {
      console.error(`Build fehlgeschlagen: ${error.message}`);
      process.exitCode = 1;
    });
}
