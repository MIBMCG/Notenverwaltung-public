// Copies an explicit, reviewed file list from a stable local checkout. It is not
// a sandbox against another process changing paths while this function runs.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 5000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const REPARSE_POINT = 1024;
const WINDOWS_ATTRIBUTES_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())',
  '$results = @()',
  'for ($i = 0; $i -lt $request.paths.Count; $i++) {',
  '  $value = [int][System.IO.File]::GetAttributes([string]$request.paths[$i])',
  '  $results += [ordered]@{ index = $i; value = $value }',
  '}',
  '[Console]::Out.Write((ConvertTo-Json -InputObject @{ attributes = $results } -Compress -Depth 4))'
].join('\n');

function fail(message) { throw new Error(message); }

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeComponent(part, field) {
  if (!part || part === '.' || part === '..' || part.normalize('NFC') !== part ||
      /[\\:\x00-\x1f\x7f<>"|*?\[\]{}]/u.test(part) || /[. ]$/u.test(part) ||
      /^(?:con|prn|aux|nul|clock\$|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/iu.test(part) ||
      part.toLowerCase() === '.git') {
    fail(`${field}: unsafe path component`);
  }
}

function safeRelative(name, field) {
  if (typeof name !== 'string' || !name || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
    fail(`${field}: unsafe path`);
  }
  for (const part of name.split('/')) safeComponent(part, field);
  return name;
}

function validateManifest(raw) {
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail('manifest: invalid JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      Object.keys(manifest).length !== 1 || !Array.isArray(manifest.files) ||
      manifest.files.length === 0 || manifest.files.length > MAX_FILES) {
    fail('manifest: expected a nonempty {files:[...]} with at most 5000 paths');
  }
  const seen = new Set();
  const files = [];
  for (const value of manifest.files) {
    const name = safeRelative(value, 'manifest');
    const canonical = name.normalize('NFC').toLowerCase();
    if (seen.has(canonical)) fail('manifest: duplicate or case/Unicode collision');
    seen.add(canonical);
    files.push(name);
  }
  for (const name of seen) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) {
      if (seen.has(parts.slice(0, index).join('/'))) fail('manifest: file/directory path collision');
    }
  }
  return files.sort();
}

function absoluteInput(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail(`${field}: absolute path required`);
  if (path.normalize(value) !== value || path.resolve(value) !== value) {
    fail(`${field}: canonical absolute path required; aliases are rejected`);
  }
  if (process.platform === 'win32' && value.startsWith('\\\\')) fail(`${field}: local drive path required`);
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) safeComponent(part, field);
  return resolved;
}

function inspectPath(absolute, { mayBeMissing = false, gitBoundary = false } = {}) {
  const volumeRoot = path.parse(absolute).root;
  let current = volumeRoot;
  let missing = false;
  const existing = [];
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('path root is a link or non-directory');
  existing.push(current);
  const components = absolute.slice(volumeRoot.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index++) {
    const part = components[index];
    safeComponent(part, 'path');
    if (gitBoundary && part.toLowerCase() === '.git') fail('output: Git metadata path');
    if (!missing) {
      const names = fs.readdirSync(current);
      if (!names.includes(part)) {
        if (!mayBeMissing) fail(`source: exact component missing: ${part}`);
        missing = true;
      }
    }
    current = path.join(current, part);
    if (!missing) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) fail(`path link rejected: ${current}`);
      if (index < components.length - 1 && !stat.isDirectory()) fail('path parent is not a directory');
      existing.push(current);
    }
  }
  return { existing, missing, stat: missing ? null : fs.lstatSync(absolute) };
}

function queryWindowsAttributes(paths) {
  if (process.platform !== 'win32') return;
  const unique = [...new Set(paths)];
  if (unique.length === 0) return;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_ATTRIBUTES_SCRIPT], {
    input: JSON.stringify({ paths: unique }), encoding: 'utf8', windowsHide: true,
    timeout: 30000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) fail(`Windows attribute probe failed: ${result.error?.message || result.stderr || result.status}`);
  let parsed;
  try { parsed = JSON.parse(result.stdout.replace(/^\uFEFF/u, '').trim()); } catch { fail('Windows attribute probe returned invalid JSON'); }
  if (!parsed || !Array.isArray(parsed.attributes) || parsed.attributes.length !== unique.length) {
    fail('Windows attribute probe returned incomplete results');
  }
  parsed.attributes.forEach((item, index) => {
    if (!item || item.index !== index || !Number.isSafeInteger(item.value) || item.value < 0) {
      fail('Windows attribute probe returned invalid or mismatched numbers');
    }
    if ((item.value & REPARSE_POINT) !== 0) fail(`Windows reparse point rejected: ${unique[index]}`);
  });
}

function inspectSourceFile(file, label) {
  const checked = inspectPath(file);
  if (!checked.stat.isFile()) fail(`${label}: regular source file required`);
  if (checked.stat.nlink !== 1) fail(`${label}: hardlinked source file rejected`);
  if (checked.stat.size > MAX_FILE_BYTES) fail(`${label}: file exceeds 100 MiB`);
  return checked;
}

function gitAncestor(directory) {
  const names = fs.readdirSync(directory);
  if (names.some(name => name.toLowerCase() === '.git')) fail('output: Git metadata in destination ancestor');
  if (names.includes('HEAD') && names.includes('objects') && names.includes('refs')) {
    fail('output: bare Git repository ancestor');
  }
}

function ensureDirectory(directory, checked) {
  const root = path.parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    const next = path.join(current, part);
    if (!fs.readdirSync(current).includes(part)) fs.mkdirSync(next);
    const item = inspectPath(next, { gitBoundary: true });
    if (!item.stat.isDirectory()) fail('output: directory required');
    gitAncestor(next);
    for (const component of item.existing) checked.add(component);
    current = next;
  }
}

function copyUnnamedBytes(source, target, expectedStat) {
  const sourceFd = fs.openSync(source, 'r');
  let bytes;
  try {
    const now = fs.fstatSync(sourceFd);
    if (!now.isFile() || now.nlink !== 1 || now.size !== expectedStat.size ||
        now.dev !== expectedStat.dev || now.ino !== expectedStat.ino) fail('source changed during snapshot preparation');
    bytes = fs.readFileSync(sourceFd);
    if (bytes.length !== now.size) fail('source changed while reading');
  } finally { fs.closeSync(sourceFd); }
  const outputFd = fs.openSync(target, 'wx');
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(outputFd, bytes, offset, bytes.length - offset);
    const written = fs.fstatSync(outputFd);
    if (!written.isFile() || written.nlink !== 1 || written.size !== bytes.length) fail('output write incomplete');
  } finally { fs.closeSync(outputFd); }
  const copied = fs.readFileSync(target);
  if (!copied.equals(bytes)) fail('output byte verification failed');
  return createHash('sha256').update(copied).digest('hex');
}

/**
 * Build a byte-exact snapshot from an explicit JSON {files:["relative/path", ...]}.
 * Source, destination and their parents must be stable, trusted local paths.
 * An I/O failure can leave a partial destination; it never returns success.
 */
export function preparePublicSnapshot({ sourceRoot, outputDir, manifestPath }) {
  if (process.platform !== 'win32' && process.platform !== 'linux') fail('unsupported platform');
  const source = absoluteInput(sourceRoot, 'sourceRoot');
  const output = absoluteInput(outputDir, 'outputDir');
  if (inside(source, output)) fail('output must be outside source');
  if (typeof manifestPath !== 'string' || !manifestPath) fail('manifestPath required');
  const manifest = path.isAbsolute(manifestPath) ? absoluteInput(manifestPath, 'manifestPath') :
    path.join(source, ...safeRelative(manifestPath, 'manifestPath').split('/'));
  if (!inside(source, manifest)) fail('manifest must stay inside source');

  const sourcePath = inspectPath(source);
  if (!sourcePath.stat.isDirectory()) fail('source root must be a directory');
  const manifestPathInfo = inspectSourceFile(manifest, 'manifest');
  queryWindowsAttributes([...sourcePath.existing, ...manifestPathInfo.existing]);
  if (manifestPathInfo.stat.size > MAX_MANIFEST_BYTES) fail('manifest exceeds 2 MiB');
  const files = validateManifest(fs.readFileSync(manifest, 'utf8'));
  const selected = [];
  let totalBytes = 0;
  const sourceComponents = [];
  const realSource = fs.realpathSync.native(source);
  for (const name of files) {
    const file = path.join(source, ...name.split('/'));
    if (!inside(source, file)) fail('source path escaped root');
    const info = inspectSourceFile(file, `source ${name}`);
    if (!inside(realSource, fs.realpathSync.native(file))) fail('source path resolved outside root');
    totalBytes += info.stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) fail('selected files exceed 1 GiB');
    sourceComponents.push(...info.existing);
    selected.push({ name, file, stat: info.stat });
  }
  queryWindowsAttributes(sourceComponents);

  const destinationInfo = inspectPath(output, { mayBeMissing: true, gitBoundary: true });
  queryWindowsAttributes(destinationInfo.existing);
  for (const component of destinationInfo.existing) {
    if (fs.lstatSync(component).isDirectory()) gitAncestor(component);
  }
  if (!destinationInfo.missing) {
    if (!destinationInfo.stat.isDirectory()) fail('output must be an empty directory');
    if (fs.readdirSync(output).length !== 0) fail('output must be empty');
  }
  const existingParent = destinationInfo.existing.at(-1);
  const futureOutput = path.join(fs.realpathSync.native(existingParent), path.relative(existingParent, output));
  if (inside(realSource, futureOutput)) fail('resolved output must be outside source');

  let started = false;
  try {
    started = true;
    const outputDirectories = new Set();
    ensureDirectory(output, outputDirectories);
    for (const { name } of selected) {
      ensureDirectory(path.dirname(path.join(output, ...name.split('/'))), outputDirectories);
    }
    queryWindowsAttributes([...outputDirectories]);
    const result = [];
    const outputComponents = [];
    for (const { name, file, stat } of selected) {
      const target = path.join(output, ...name.split('/'));
      const sha256 = copyUnnamedBytes(file, target, stat);
      const info = inspectPath(target, { gitBoundary: true });
      if (!info.stat.isFile() || info.stat.nlink !== 1) fail('output target is not a single-link regular file');
      outputComponents.push(...info.existing);
      result.push({ path: name, sha256 });
    }
    queryWindowsAttributes(outputComponents);
    return { outputDir: output, files: result };
  } catch (error) {
    if (started) throw new Error(`Snapshot incomplete; partial output may remain: ${error.message}`, { cause: error });
    throw error;
  }
}
