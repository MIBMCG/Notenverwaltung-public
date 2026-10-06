'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function check(rootDir, files) {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'verify-doc-links.mjs')).href);
  return mod.verifyDocLinks({ rootDir, files });
}

test('checks only named documents, decoded relative paths and heading fragments', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'Anleitung.md'), '# Anleitung\n[Beleg](ABNAHME.md#prüfung-von-daten) [Start](../START%20LESEN.txt) [Extern](https://example.org/path)\n');
  fs.writeFileSync(path.join(root, 'docs', 'ABNAHME.md'), '# Prüfung von Daten\n');
  fs.writeFileSync(path.join(root, 'START LESEN.txt'), 'synthetisch\n');
  fs.writeFileSync(path.join(root, 'private.md'), '[Fehler](fehlt.md)\n');
  const result = await check(root, ['docs/Anleitung.md']);
  assert.equal(result.localLinks, 2);
  assert.deepEqual(result.externalLinks, ['https://example.org/path']);
  assert.equal(result.checkedFiles, 1);
});

test('rejects missing, wrong-case, escaping and absent-fragment links', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'ABNAHME.md'), '# Beleg\n');
  for (const [destination, expected] of [
    ['fehlt.md', /fehlt/i],
    ['abnahme.md', /Groß|Klein|fehlt/i],
    ['ABNAHME.md#unbekannt', /Anker|unbekannt/i],
    ['../../außerhalb.md', /außerhalb|Grenze|Pfad/i],
    ['%2e%2e/%2e%2e/außerhalb.md', /außerhalb|Grenze|Pfad/i]
  ]) {
    fs.writeFileSync(path.join(root, 'docs', 'Anleitung.md'), `[Ziel](${destination})\n`);
    await assert.rejects(check(root, ['docs/Anleitung.md']), expected, destination);
  }
});

test('rejects active reference, shortcut, collapsed and raw HTML links explicitly', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-active-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'Anleitung.md'), '# Anleitung\n');
  for (const [markdown, expected] of [
    ['[Intern][bericht]\n\n[bericht]: private/plan.md\n', /Referenzlink/i],
    ['[bericht][]\n\n[bericht]: private/plan.md\n', /Referenzlink/i],
    ['[bericht]\n\n[bericht]: private/plan.md\n', /Referenzlink/i],
    ['[bericht]\n\n[bericht]:\n  private/plan.md\n', /Referenzlink/i],
    ['[Intern][bericht]\n\n[bericht]:\n  private/plan.md\n', /Referenzlink/i],
    ['<a href="private/plan.md">Intern</a>\n', /HTML-Link/i],
    ['<img src="private/logo.svg">\n', /HTML-Link/i],
    ['<area href="private/plan.md" alt="Intern">\n', /HTML-Link/i]
  ]) {
    fs.writeFileSync(path.join(root, 'Anleitung.md'), markdown);
    await assert.rejects(check(root, ['Anleitung.md']), expected, markdown);
  }
});

test('checks active links after pseudo fences and escaped backticks', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-escapes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const markdown of [
    '``` aa ```\n[Intern](private/plan.md)\n',
    '\\`[Intern](private/plan.md)\\`\n',
    '- Eintrag mit [Intern](private/plan.md)\n',
    '  - Tieferer Eintrag mit [Intern](private/plan.md)\n',
    'Absatz mit [Intern](private/plan.md) und Text.\n'
  ]) {
    fs.writeFileSync(path.join(root, 'Anleitung.md'), markdown);
    await assert.rejects(check(root, ['Anleitung.md']), /private|fehlt/i, markdown);
  }
});

test('uses parsed heading text, entity destinations and only real HTML anchors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-ast-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'A&B.md'), '# Ziel\n');
  const source = path.join(root, 'Anleitung.md');
  fs.writeFileSync(source, '# Ein `Code` Beispiel\n<a name="echter-anker"></a>\n<!-- <a id="falsch"></a> -->\n[Code](#ein-code-beispiel) [Echt](#echter-anker) [Datei](A&amp;B.md)\n');
  assert.equal((await check(root, ['Anleitung.md'])).localLinks, 3);
  fs.appendFileSync(source, '[Falsch](#falsch)\n');
  await assert.rejects(check(root, ['Anleitung.md']), /Anker.*falsch/i);
  fs.writeFileSync(source, '<div onclick="evil()">Text</div>\n');
  await assert.rejects(check(root, ['Anleitung.md']), /HTML/i);
  fs.writeFileSync(source, '<https://example.org>\n');
  await assert.rejects(check(root, ['Anleitung.md']), /Markdown-Linkform/i);
});

test('accepts only one well-formed inert HTML comment per raw node', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-comment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Anleitung.md');
  for (const comment of [
    '<!---->', '<!-- normaler Kommentar -->',
    '<!-- mehrzeilig\n<a id="nur-beispiel" href="private/plan.md">Beispiel</a>\n-->'
  ]) {
    fs.writeFileSync(source, `# Dokument\n\n${comment}\n[Echt](#dokument)\n`);
    assert.equal((await check(root, ['Anleitung.md'])).localLinks, 1);
  }
  fs.appendFileSync(source, '[Falsch](#nur-beispiel)\n');
  await assert.rejects(check(root, ['Anleitung.md']), /Anker.*nur-beispiel/i);
  for (const raw of [
    '<!-- before --><a href="superpowers/private-review.md">Intern</a><!-- after -->',
    '<!-- before --!><a href="superpowers/private-review.md">Intern</a><!-- after -->',
    '<!--><a href="superpowers/private-review.md">Intern</a><!-- after -->',
    '<!---><a href="superpowers/private-review.md">Intern</a><!-- after -->',
    '<!-- before <!-- <a href="superpowers/private-review.md">Intern</a> -->',
    '<!-- before <!---->'
  ]) {
    fs.writeFileSync(source, `# Dokument\n\n${raw}\n`);
    await assert.rejects(check(root, ['Anleitung.md']), /HTML/i, raw);
  }
});

test('ignores fenced and inline code examples when collecting links and anchors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-links-code-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'Anleitung.md'), [
    '# Dokument',
    '```html',
    '# Nur Code',
    '<a id="nur-code" href="private/plan.md">Beispiel</a>',
    '[Intern][ref]',
    '[ref]: private/plan.md',
    '```',
    '`<a id="inline-code" href="private/plan.md">Beispiel</a>`',
    '[Echter Sprung](#dokument)'
  ].join('\n'));
  const result = await check(root, ['Anleitung.md']);
  assert.equal(result.localLinks, 1);
  fs.appendFileSync(path.join(root, 'Anleitung.md'), '\n\n    [Codebeispiel](private/plan.md)\n');
  assert.equal((await check(root, ['Anleitung.md'])).localLinks, 1);
  fs.appendFileSync(path.join(root, 'Anleitung.md'), '\n[Falscher Sprung](#nur-code)\n');
  await assert.rejects(check(root, ['Anleitung.md']), /Anker.*nur-code/i);
  fs.writeFileSync(path.join(root, 'Anleitung.md'), '# Dokument\n<a id="echter-anker"></a>\n[Echt](#echter-anker)\n');
  assert.equal((await check(root, ['Anleitung.md'])).localLinks, 1);
  fs.writeFileSync(path.join(root, 'Anleitung.md'), '`[Aktiver Link](private/plan.md)``\n');
  await assert.rejects(check(root, ['Anleitung.md']), /private|fehlt/i);
  fs.writeFileSync(path.join(root, 'Anleitung.md'), '# Dokument\n\n    <a id="nur-code"></a>\n\n[Sprung](#nur-code)\n');
  await assert.rejects(check(root, ['Anleitung.md']), /Anker.*nur-code/i);
});
