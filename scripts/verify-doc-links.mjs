import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMarkdown } from './doc-markdown-ast.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DOCS = Object.freeze([
  'README.md', 'START-HIER.md', 'DOKUMENTATION.md', 'CHANGELOG.md',
  'ASSET_NOTICES.md', 'SECURITY.md', 'docs/KURZANLEITUNG.md', 'docs/ABNAHME.md',
  'docs/BEFUNDE.md', 'docs/CONTRIBUTING.md', 'docs/PRUEFBEISPIELE.md',
  'docs/quality/PUBLICATION.md', 'docs/quality/release-checklist.md',
  'docs/releases/1.3.0.md', 'docs/releases/1.4.0.md',
  'docs/releases/1.5.0.md', 'docs/releases/1.5.1.md', 'docs/releases/1.6.0.md',
  'docs/ui/concepts/README.md'
]);

export function scanMarkdownLinks(markdown) { return parseMarkdown(markdown).links; }
export function markdownLinks(markdown) { return scanMarkdownLinks(markdown).map(link => link.destination); }
export function documentAnchors(markdown) { return parseMarkdown(markdown).anchors; }
function decodeLink(value) {
  try { return decodeURIComponent(value); }
  catch { throw new Error(`Ungültig kodierter Dokumentlink: ${value}`); }
}

async function exactFile(rootDir, relative) {
  const parts = relative.split('/');
  let current = rootDir;
  for (const segment of parts) {
    if (!segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes(':')) {
      throw new Error(`Dokumentpfad verlässt die Repo-Grenze: ${relative}`);
    }
    const names = await readdir(current);
    if (!names.includes(segment)) throw new Error(`Dokumentlink fehlt oder Groß-/Kleinschreibung weicht ab: ${relative}`);
    current = path.join(current, segment);
  }
  const [realRoot, realTarget] = await Promise.all([realpath(rootDir), realpath(current)]);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`)) throw new Error(`Dokumentlink verlässt die Repo-Grenze: ${relative}`);
  if (!(await stat(realTarget)).isFile()) throw new Error(`Dokumentlink ist keine Datei: ${relative}`);
  return realTarget;
}

export async function verifyDocLinks({ rootDir = defaultRoot, files = DEFAULT_DOCS } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Mindestens ein Dokument ist nötig.');
  const externalLinks = new Set();
  let localLinks = 0;
  for (const file of files) {
    if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\') ||
        file.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Unsicherer Dokumentpfad: ${file}`);
    }
    const sourcePath = await exactFile(rootDir, file);
    const source = await readFile(sourcePath, 'utf8');
    for (const destination of markdownLinks(source)) {
      if (/^https?:\/\//i.test(destination)) { externalLinks.add(destination); continue; }
      if (/^mailto:/i.test(destination)) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith('//')) {
        throw new Error(`Nicht unterstütztes Linkschema in ${file}: ${destination}`);
      }
      const [rawPath, rawFragment = ''] = destination.split('#', 2);
      const decoded = decodeLink(rawPath);
      const fragment = decodeLink(rawFragment);
      if (decoded.includes('\\') || decoded.includes('?') || decoded.startsWith('/') || /^[a-z]:/i.test(decoded)) {
        throw new Error(`Dokumentlink verlässt die Repo-Grenze: ${destination}`);
      }
      const target = decoded ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded)) : file;
      if (target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)) {
        throw new Error(`Dokumentlink verlässt die Repo-Grenze: ${destination}`);
      }
      const targetPath = await exactFile(rootDir, target);
      if (fragment) {
        const targetMarkdown = await readFile(targetPath, 'utf8');
        if (!documentAnchors(targetMarkdown).has(fragment)) throw new Error(`Dokumentanker fehlt: ${target}#${fragment}`);
      }
      localLinks += 1;
    }
  }
  return { checkedFiles: files.length, localLinks, externalLinks: Array.from(externalLinks).sort() };
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  const args = process.argv.slice(2);
  let rootDir = defaultRoot;
  const files = [];
  let invalid = false;
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--root' && args[index + 1]) rootDir = args[index + 1];
    else if (args[index] === '--file' && args[index + 1]) files.push(args[index + 1]);
    else invalid = true;
  }
  if (invalid || !path.isAbsolute(rootDir)) {
    console.error('Aufruf: node scripts/verify-doc-links.mjs [--root <absoluter-Ordner>] [--file <repo-relativer-Pfad> ...]');
    process.exitCode = 1;
  } else {
    verifyDocLinks({ rootDir, files: files.length ? files : DEFAULT_DOCS })
      .then(result => console.log(`${result.checkedFiles} Dokumente, ${result.localLinks} lokale Links geprüft; ${result.externalLinks.length} externe Links ungeprüft.`))
      .catch(error => { console.error(`Linkprüfung fehlgeschlagen: ${error.message}`); process.exitCode = 1; });
  }
}
