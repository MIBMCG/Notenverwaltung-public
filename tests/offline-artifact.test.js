'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  listForbiddenRuntimeReferences,
  listImageReferences
} = require('./harness/artifact-contract.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'Notenverwaltung.html'), 'utf8');

test('resource inspector rejects Internet assets and accepts only the local logo choices', () => {
  const unsafe = '<script src="https://example.invalid/app.js"></script><img src="other.png">';
  assert.deepEqual(listForbiddenRuntimeReferences(unsafe), ['https://example.invalid/app.js', 'other.png']);
  assert.deepEqual(listForbiddenRuntimeReferences('<img src="placeholder-logo.svg">'), []);
  assert.deepEqual(listForbiddenRuntimeReferences('<img src="Logo.png">'), []);
});

test('image inspector resolves the local print logo through the neutral shared helper', () => {
  const printTemplate = [
    '<script>function getSchoolLogoPath() { return \'placeholder-logo.svg\'; }</script>',
    '<script>const header = `<img class="print-logo" src="${getSchoolLogoPath()}" alt="">`;</script>'
  ].join('');

  assert.deepEqual(listImageReferences(printTemplate), ['placeholder-logo.svg']);
});

test('generated artifact has no Internet runtime dependency and retains its local print logo', () => {
  assert.deepEqual(listForbiddenRuntimeReferences(html), []);
  assert.deepEqual([...new Set(listImageReferences(html))], ['Logo.png', 'placeholder-logo.svg']);
  for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    assert.equal(new RegExp(`\\b${api}\\s*\\(`).test(html), false, api);
  }
});

test('resource inspector rejects data and blob script sources', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<script src="data:text/javascript,alert(1)"></script>'),
    ['data:text/javascript,alert(1)']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<script src="blob:https://example.invalid/script"></script>'),
    ['blob:https://example.invalid/script']
  );
});

test('resource inspector rejects stylesheet data and fragment references', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<link rel="stylesheet" href="data:text/css,body{}">'),
    ['data:text/css,body{}']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<link rel="stylesheet" href="#embedded-style">'),
    ['#embedded-style']
  );
});

test('resource inspector rejects CSS imports and external URLs', () => {
  const css = '<style>@import "https://cdn.invalid/theme.css"; body{background:url(https://cdn.invalid/bg.png)}</style>';
  assert.deepEqual(listForbiddenRuntimeReferences(css), [
    'https://cdn.invalid/theme.css',
    'https://cdn.invalid/bg.png'
  ]);
});

test('resource inspector rejects every non-logo srcset candidate', () => {
  const srcset = '<img srcset="first.png 1x, https://cdn.invalid/second.png 2x">';
  assert.deepEqual(listForbiddenRuntimeReferences(srcset), [
    'first.png',
    'https://cdn.invalid/second.png'
  ]);
});

test('resource inspector rejects media posters and object data resources', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<video poster="data:image/png;base64,AAAA"></video>'),
    ['data:image/png;base64,AAAA']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<object data="report.pdf"></object>'),
    ['report.pdf']
  );
});

test('resource inspector rejects frame and embed resource attributes', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<iframe src="data:text/html,embedded"></iframe>'),
    ['data:text/html,embedded']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<embed src="blob:https://example.invalid/doc"></embed>'),
    ['blob:https://example.invalid/doc']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<frame src="#local-frame"><source src="media.mp4">'),
    ['#local-frame', 'media.mp4']
  );
});

test('resource inspector ignores ordinary fragments, downloads and embedded non-runtime values', () => {
  const safe = [
    '<a href="#section">section</a>',
    '<a download href="export.csv">download</a>',
    '<div data-value="data:text/plain,not-a-resource"></div>',
    '<span style="background:url(data:image/png;base64,AAAA)"></span>',
    '<img srcset="data:image/png;base64,AAAA">'
  ].join('');
  assert.deepEqual(listForbiddenRuntimeReferences(safe), []);
});

test('resource inspector rejects direct video and audio sources and font preloads', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<video src="movie.mp4"></video><audio src="lesson.mp3"></audio>'),
    ['movie.mp4', 'lesson.mp3']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<link rel="preload" as="font" href="font.woff2">'),
    ['font.woff2']
  );
});

test('resource inspector reads quoted CSS URLs containing parentheses', () => {
  const css = '<style>body{background:url("https://cdn.invalid/assets/bg(2).png")}</style>';
  assert.deepEqual(listForbiddenRuntimeReferences(css), [
    'https://cdn.invalid/assets/bg(2).png'
  ]);
});

test('resource inspector respects greater-than signs inside quoted HTML attributes', () => {
  const markup = '<img alt="1 > 0" src="other.png">';
  assert.deepEqual(listForbiddenRuntimeReferences(markup), ['other.png']);
});

test('resource inspector ignores CSS comments and content strings', () => {
  const css = '<style>/* url(https://cdn.invalid/comment.png) */ .x{content:"url(https://cdn.invalid/content.png)"}</style>';
  assert.deepEqual(listForbiddenRuntimeReferences(css), []);
});

test('resource inspector never parses markup-like strings inside scripts', () => {
  const script = '<script>const template = \'<img src="fake.png">\';</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), []);
});

test('resource inspector covers direct media, source and track resources', () => {
  const markup = '<video src="movie.mp4" poster="poster.jpg"></video><audio src="lesson.mp3"></audio>' +
    '<source src="stream.mp4"><track src="captions.vtt">';
  assert.deepEqual(listForbiddenRuntimeReferences(markup), [
    'movie.mp4',
    'poster.jpg',
    'lesson.mp3',
    'stream.mp4',
    'captions.vtt'
  ]);
});

test('resource inspector preserves duplicate and empty resource attributes', () => {
  assert.deepEqual(
    listForbiddenRuntimeReferences('<script src="https://bad.invalid/earlier.js" src=""></script>'),
    ['https://bad.invalid/earlier.js', '']
  );
  assert.deepEqual(
    listForbiddenRuntimeReferences('<img src="https://bad.invalid/earlier.png" src="placeholder-logo.svg">'),
    ['https://bad.invalid/earlier.png']
  );
});

test('resource inspector treats every link resource and iframe srcdoc as runtime', () => {
  assert.deepEqual(listForbiddenRuntimeReferences(
    '<link rel="modulepreload" href="module.js"><link rel="prefetch" href="prefetch.json">' +
    '<link rel="preload" as="video" href="movie.mp4">'
  ), ['module.js', 'prefetch.json', 'movie.mp4']);
  assert.deepEqual(
    listForbiddenRuntimeReferences('<iframe srcdoc="<p>embedded</p>"></iframe>'),
    ['<p>embedded</p>']
  );
});

test('resource inspector detects CSS imports through comments and image-set candidates', () => {
  const css = '<style>@import/**/url("https://cdn.invalid/theme.css");' +
    '.hero{background-image:image-set("https://cdn.invalid/one.png" 1x, ' +
    'url("https://cdn.invalid/two.png") 2x)}</style>';
  assert.deepEqual(listForbiddenRuntimeReferences(css), [
    'https://cdn.invalid/theme.css',
    'https://cdn.invalid/one.png',
    'https://cdn.invalid/two.png'
  ]);
});

test('resource inspector detects literal dynamic imports in executable scripts', () => {
  const script = '<script>const module = import("https://cdn.invalid/module.js");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), ['https://cdn.invalid/module.js']);
});

test('resource inspector detects executable resource property assignments', () => {
  const script = '<script>/* image.src = "https://cdn.invalid/comment.png"; */' +
    'const svg = "<image href=\\"https://cdn.invalid/markup.svg\\">";' +
    'image.src = "https://cdn.invalid/actual.png";</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), ['https://cdn.invalid/actual.png']);
});

test('resource inspector detects literal resource setAttribute member calls', () => {
  const script = '<script>element.setAttribute("src", "https://cdn.invalid/image.png");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), ['https://cdn.invalid/image.png']);
});

test('resource inspector detects direct and qualified literal fetch calls', () => {
  const script = '<script>fetch("https://cdn.invalid/direct.json");' +
    'window.fetch("https://cdn.invalid/qualified.json");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), [
    'https://cdn.invalid/direct.json',
    'https://cdn.invalid/qualified.json'
  ]);
});

test('resource inspector detects the literal URL argument of open member calls', () => {
  const script = '<script>xhr.open("GET", "https://cdn.invalid/api");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), ['https://cdn.invalid/api']);
});

test('resource inspector detects direct literal Worker and connection constructors', () => {
  const script = '<script>new Worker("worker.js");new SharedWorker("shared.js");' +
    'new WebSocket("wss://cdn.invalid/socket");new EventSource("https://cdn.invalid/events");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), [
    'worker.js',
    'shared.js',
    'wss://cdn.invalid/socket',
    'https://cdn.invalid/events'
  ]);
});

test('resource inspector ignores non-resource member calls', () => {
  const script = '<script>element.setAttribute("title", "https://cdn.invalid/not-a-resource");' +
    'logger.open("not-a-url-argument");window.open("", "_blank");</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), []);
});

test('resource inspector detects no-substitution template literals in imports and assignments', () => {
  const script = '<script>import(`https://cdn.invalid/module.js`);' +
    'image.src = `https://cdn.invalid/image.png`;</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), [
    'https://cdn.invalid/module.js',
    'https://cdn.invalid/image.png'
  ]);
});

test('resource inspector ignores interpolated resource template literals', () => {
  const script = '<script>import(`https://${host}/module.js`);' +
    'image.src = `https://${host}/image.png`;</script>';
  assert.deepEqual(listForbiddenRuntimeReferences(script), []);
});
