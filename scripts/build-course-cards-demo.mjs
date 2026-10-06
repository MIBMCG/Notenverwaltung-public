import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizeLf = value => value.replace(/\r\n?/g, '\n');

const demoShellStyles = `
body { margin: 0; background: #eef3f4; color: #172e36; font: 16px/1.5 system-ui, sans-serif; }
.nv-course-demo { max-width: 1120px; margin: 0 auto; padding: 24px; }
.nv-course-demo__example { margin: 28px 0; }
.nv-course-demo select { min-height: 44px; margin-inline-start: 8px; }
.nv-course-demo [role="status"] { min-height: 1.5em; font-weight: 600; }
@media (max-width: 480px) { .nv-course-demo { padding: 16px; } }
`;

export async function buildCourseCardsDemo({ rootDir = defaultRoot, plugins = [] } = {}) {
  const styles = normalizeLf(await readFile(path.join(rootDir, 'src', 'ui', 'course-cards.css'), 'utf8'));
  const result = await esbuild.build({
    entryPoints: [path.join(rootDir, 'docs', 'ui', 'course-cards-demo-entry.js')],
    absWorkingDir: rootDir,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    sourcemap: false,
    logLevel: 'silent',
    plugins
  });
  if (result.outputFiles.length !== 1) {
    throw new Error(`esbuild lieferte ${result.outputFiles.length} Ausgabedateien statt genau einer.`);
  }
  const bundle = normalizeLf(result.outputFiles[0].text);
  return normalizeLf(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kurskarten: Offline-Demo</title>
<style>${demoShellStyles}\n${styles}</style>
</head>
<body>
<main id="course-cards-demo" class="nv-course-demo"></main>
<script>${bundle}</script>
</body>
</html>
`);
}

export async function writeCourseCardsDemo({ rootDir = defaultRoot, outputPath = path.join(rootDir, 'docs', 'ui', 'course-cards-demo.html') } = {}) {
  const html = await buildCourseCardsDemo({ rootDir });
  await writeFile(outputPath, html, 'utf8');
  return html;
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  writeCourseCardsDemo()
    .then(() => console.log('Kurskarten-Demo wurde reproduzierbar erzeugt.'))
    .catch(error => {
      console.error(`Build fehlgeschlagen: ${error.message}`);
      process.exitCode = 1;
    });
}
