'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createDemoFixture } = require('./harness/course-card-document');

function runDemo(html, fixture) {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, 'Die Demo muss genau ein Inline-Bundle enthalten.');
  vm.runInNewContext(match[1], {
    document: fixture.document,
    setTimeout,
    clearTimeout
  }, { timeout: 1000 });
}

function courseCardRoots(fixture) {
  return fixture.findAll(element => element.getAttribute('class') === 'nv-course-cards');
}

test('Demo ist deterministisch und ohne externe Laufzeitimporte', async () => {
  const { buildCourseCardsDemo } = await import('../scripts/build-course-cards-demo.mjs');
  const html = await buildCourseCardsDemo();

  assert.equal(html, await buildCourseCardsDemo());
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|type="module"/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
});

test('gebautes Bundle nutzt die Kurskarten für jede Designfamilie', async () => {
  const { buildCourseCardsDemo } = await import('../scripts/build-course-cards-demo.mjs');
  const fixture = createDemoFixture();
  runDemo(await buildCourseCardsDemo(), fixture);

  assert.equal(fixture.find('appearance').value, 'system');
  for (let index = 0; index < 3; index += 1) {
    const info = fixture.find('info', index);
    fixture.dispatch(info, 'click');
    assert.equal(info.textContent, '×');
    fixture.dispatch(info, 'click');
    assert.equal(info.textContent, 'Info');
    fixture.dispatch(fixture.find('open', index), 'click');
    assert.equal(fixture.find('status').textContent, 'Vorschau: Notentabelle für bio-demo-10a. Keine echten Daten.');
  }
  assert.equal(fixture.find('card', 3).getAttribute('data-course-id'), 'bio-demo-langer-name');
  assert.equal(fixture.find('card', 4), null);
});

test('Darstellungswechsel entsorgt alte Karten und mountet alle Beispiele neu', async () => {
  const { buildCourseCardsDemo } = await import('../scripts/build-course-cards-demo.mjs');
  const fixture = createDemoFixture();
  runDemo(await buildCourseCardsDemo(), fixture);

  const oldRoots = courseCardRoots(fixture);
  const oldOpenButtons = [0, 1, 2, 3].map(index => fixture.find('open', index));
  assert.equal(oldRoots.length, 5);
  fixture.find('appearance').value = 'dark';
  fixture.dispatch(fixture.find('appearance'), 'change');
  oldOpenButtons.forEach(button => fixture.dispatch(button, 'click'));

  assert.equal(fixture.find('status').textContent, 'Status: Demo bereit. Keine echten Daten.');
  assert.ok(oldRoots.every(root => root.parentNode === null));
  const newRoots = courseCardRoots(fixture);
  assert.equal(newRoots.length, 5);
  assert.ok(newRoots.every(root => root.getAttribute('data-appearance') === 'dark'));
  assert.equal(fixture.find('card', 3).getAttribute('data-course-id'), 'bio-demo-langer-name');
});

test('der Fünf-Host-Remount-Nachweis erkennt eine In-Memory-Teil-Theme-Mutation', async () => {
  const { buildCourseCardsDemo } = await import('../scripts/build-course-cards-demo.mjs');
  const html = await buildCourseCardsDemo({
    plugins: [{
      name: 'demo-appearance-mutation',
      setup(build) {
        build.onLoad({ filter: /course-cards-demo-entry\.js$/ }, args => ({
          contents: fs.readFileSync(args.path, 'utf8').replace(
            'appearance: appearance.value,',
            "appearance: family === 'modern' ? appearance.value : 'system',"
          ),
          loader: 'js'
        }));
      }
    }]
  });
  const fixture = createDemoFixture();
  runDemo(html, fixture);
  fixture.find('appearance').value = 'dark';
  fixture.dispatch(fixture.find('appearance'), 'change');

  assert.notDeepEqual(
    courseCardRoots(fixture).map(root => root.getAttribute('data-appearance')),
    ['dark', 'dark', 'dark', 'dark', 'dark']
  );
});

test('ein Import-Sentinel im Speicher macht den Demo-Verbraucher sichtbar fehlschlagen', async () => {
  const { buildCourseCardsDemo } = await import('../scripts/build-course-cards-demo.mjs');
  const html = await buildCourseCardsDemo({
    plugins: [{
      name: 'course-cards-import-sentinel',
      setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]ui[\\/]course-cards\.js$/ }, () => ({
          contents: 'export function mountCourseCards() { throw new Error("course-cards import sentinel"); }',
          loader: 'js'
        }));
      }
    }]
  });

  assert.throws(
    () => runDemo(html, createDemoFixture()),
    /course-cards import sentinel/
  );
});
