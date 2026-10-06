'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { importEsmSource } = require('./harness/import-esm-source');
const { createCardFixture } = require('./harness/course-card-document');

const course = Object.freeze({
  id: 'c1',
  name: 'Biologie',
  subject: 'Biologie',
  classLabel: '10a',
  studentCount: 24,
  termLabel: '26/27 H1'
});

async function mountWith(fixture, options = {}, transformSource) {
  const { mountCourseCards } = await importEsmSource('src/ui/course-cards.js', transformSource);
  return mountCourseCards({
    host: fixture.host,
    idPrefix: 'test',
    courses: [course],
    family: 'modern',
    motion: 'calm',
    onOpenCourse: () => {},
    schedule: fixture.schedule,
    cancel: fixture.cancel,
    ...options
  });
}

test('Kurskarten-CSS kapselt jeden Nachfahren unter der Komponentenwurzel', () => {
  const stylesheet = fs.readFileSync('src/ui/course-cards.css', 'utf8');
  const descendantSelectors = stylesheet.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.includes('.nv-course-cards__') && /(?:,|\{)$/.test(line));

  assert.ok(descendantSelectors.length > 0);
  descendantSelectors.forEach(selector => {
    assert.match(selector, /^\.nv-course-cards(?:\s|\[|\.|:|$)/);
  });
});

function declarationsForSelector(stylesheet, targetSelector) {
  const declarations = {};
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectors = match[1].split(',').map(selector => selector.trim());
    if (!selectors.includes(targetSelector)) continue;
    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property) declarations[property] = value;
    }
  }

  return declarations;
}

function blockRangesFor(stylesheet, marker) {
  const ranges = [];
  let searchFrom = 0;
  while (true) {
    const start = stylesheet.indexOf(marker, searchFrom);
    if (start < 0) return ranges;
    const open = stylesheet.indexOf('{', start + marker.length);
    let depth = 0;
    let end = open;
    for (; end < stylesheet.length; end += 1) {
      if (stylesheet[end] === '{') depth += 1;
      else if (stylesheet[end] === '}' && --depth === 0) break;
    }
    ranges.push({ start, end });
    searchFrom = end + 1;
  }
}

test('Aurora Deutlich beginnt und beendet die Drehung sanft statt vorzuschnellen', () => {
  const stylesheet = fs.readFileSync('src/ui/course-cards.css', 'utf8');
  const base = declarationsForSelector(stylesheet, '.nv-course-cards .nv-course-cards__rotor');
  const vivid = declarationsForSelector(stylesheet,
    '.nv-course-cards[data-family="aurora"][data-motion="vivid"] .nv-course-cards__rotor');
  const transition = vivid.transition || base.transition;
  const curve = transition.match(/transform\s+(\d+)ms\s+cubic-bezier\(([^)]+)\)/);
  assert.ok(curve, 'Drehung verwendet eine explizite Transform-Zeitkurve');
  const duration = Number(curve[1]);
  const [x1, y1, x2, y2] = curve[2].split(',').map(Number);
  function progress(time) {
    const bezier = (t, p1, p2) => 3 * (1-t)**2 * t * p1 + 3 * (1-t) * t*t * p2 + t**3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const t = (lo + hi) / 2;
      if (bezier(t, x1, x2) < time) lo = t; else hi = t;
    }
    return bezier((lo + hi) / 2, y1, y2);
  }
  assert.ok(duration >= 600 && duration <= 800, 'spuerbarer Flip bleibt unter 800 ms');
  assert.ok(progress(.125) < .08, 'nach einem Achtel der Zeit noch unter 8 % Drehung');
  assert.ok(progress(.5) > .4 && progress(.5) < .6, 'Seitenwechsel liegt in der Mitte');
  assert.ok(progress(.875) > .92, 'Ende gleitet in die Ruhelage');
  assert.equal(y1, 0, 'Startgeschwindigkeit ist null');
  assert.equal(y2, 1, 'Endgeschwindigkeit ist null');
});

function effectiveCalmFaceTransition(stylesheet, reducedMotion) {
  const candidates = [];
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const reducedRanges = blockRangesFor(withoutComments, '@media (prefers-reduced-motion: reduce)');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const insideReducedMotion = reducedRanges.some(range => match.index > range.start && match.index < range.end);
    if (insideReducedMotion && !reducedMotion) continue;
    const selectors = match[1].split(',').map(selector => selector.trim());
    for (const selector of selectors) {
      const matchesCalmFace = selector === '.nv-course-cards .nv-course-cards__face' ||
        (selector.includes('[data-motion="calm"]') && selector.endsWith(' .nv-course-cards__face'));
      if (!matchesCalmFace) continue;
      const declarations = declarationsForSelector(`${selector}{${match[2]}}`, selector);
      if (!declarations.transition) continue;
      const important = /!important$/.test(declarations.transition);
      const specificity = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
      candidates.push({ value: declarations.transition, important, specificity, order: match.index });
    }
  }

  candidates.sort((left, right) =>
    Number(left.important) - Number(right.important) ||
    left.specificity - right.specificity ||
    left.order - right.order
  );
  return candidates.at(-1)?.value || null;
}

test('Aurora Dezent richtet beide Kartenflaechen aus und behaelt die Opacity-Transition', () => {
  const stylesheet = fs.readFileSync('src/ui/course-cards.css', 'utf8');
  const calmFace = declarationsForSelector(
    stylesheet,
    '.nv-course-cards[data-motion="calm"] .nv-course-cards__face'
  );

  assert.equal(calmFace.transform, 'none!important');
  assert.equal(calmFace.transition, 'opacity 300ms ease!important');
  assert.equal(effectiveCalmFaceTransition(stylesheet, false), 'opacity 300ms ease!important',
    'ohne Systemreduktion muss Calm seine sichtbare Opacity-Transition behalten');
});

test('Systemreduktion ueberstimmt die spaetere Calm-Opacity-Transition der Kartenflaechen', () => {
  const stylesheet = fs.readFileSync('src/ui/course-cards.css', 'utf8');

  assert.equal(effectiveCalmFaceTransition(stylesheet, true), 'none!important');
});

function collectElements(element, tagName, found = []) {
  if (element.tagName === tagName) found.push(element);
  element.children.forEach(child => collectElements(child, tagName, found));
  return found;
}

for (const family of ['modern', 'classic', 'aurora']) {
  test(`${family}: Info, Schliessen, Escape und Kurs-ID`, async () => {
    const { mountCourseCards } = await importEsmSource('src/ui/course-cards.js');
    const f = createCardFixture();
    const opened = [];
    const mounted = mountCourseCards({host:f.host, idPrefix:family,
      courses:[course], family, onOpenCourse:id => opened.push(id),
      schedule:f.schedule, cancel:f.cancel});
    const info = f.find('info');
    const openButton = f.find('open');
    assert.equal(info.textContent, 'Info');
    f.dispatch(info, 'click');
    assert.equal(info.textContent, '×');
    assert.equal(info.getAttribute('aria-expanded'), 'true');
    assert.equal(info.getAttribute('aria-label'), 'Kursinfo schließen');
    f.dispatch(f.find('open'), 'click');
    assert.deepEqual(opened, ['c1']);
    f.dispatch(info, 'click');
    assert.equal(info.textContent, 'Info');
    f.dispatch(info, 'click');
    f.dispatch(f.find('card'), 'keydown', {key:'Escape'});
    assert.equal(info.getAttribute('aria-expanded'), 'false');
    mounted.dispose(); mounted.dispose();
    f.dispatch(openButton, 'click');
    assert.deepEqual(opened, ['c1']);
  });
}

test('Karten verwenden semantische Flaechen und einen unveraenderlichen Footer', async () => {
  const f = createCardFixture();
  await mountWith(f);
  const card = f.find('card');
  const info = f.find('info');
  const open = f.find('open');
  assert.equal(card.tagName, 'ARTICLE');
  assert.equal(collectElements(card, 'H3').length, 1);
  assert.equal(f.find('front').getAttribute('aria-hidden'), 'false');
  assert.equal(f.find('back').getAttribute('aria-hidden'), 'true');
  assert.equal(info.getAttribute('type'), 'button');
  assert.equal(open.getAttribute('type'), 'button');
  assert.equal(collectElements(card, 'FOOTER').length, 1);
  assert.equal(open.textContent, 'Noten öffnen');
});

test('optionales Kursbearbeiten bleibt im Dashboard aus und ruft im Kursmenü die echte Kurs-ID auf', async () => {
  const dashboard = createCardFixture();
  await mountWith(dashboard);
  assert.equal(dashboard.find('edit'), null, 'ohne Callback darf die Dashboardkarte keine Verwaltungsaktion zeigen');

  const administration = createCardFixture();
  const edited = [];
  const mounted = await mountWith(administration, { onEditCourse: id => edited.push(id) });
  const edit = administration.find('edit');
  assert.ok(edit, 'mit Callback fehlt Kurs bearbeiten');
  assert.equal(edit.textContent, 'Kurs bearbeiten');
  administration.dispatch(edit, 'click');
  assert.deepEqual(edited, ['c1']);

  mounted.dispose();
  administration.dispatch(edit, 'click');
  assert.deepEqual(edited, ['c1'], 'dispose muss auch den optionalen Callback abmelden');
});

test('Kartenfront trennt Kurs, Klasse, Halbjahr und reale Schülerzahl wie das Referenzlayout', async () => {
  const f = createCardFixture();
  await mountWith(f);
  const front = f.find('front');
  const heading = collectElements(front, 'H3')[0];
  const paragraphs = collectElements(front, 'P');
  const metadata = collectElements(front, 'DIV').find(element => element.getAttribute('data-role') === 'metadata');

  assert.equal(heading.textContent, 'Biologie');
  assert.equal(paragraphs[0].textContent, '10a');
  assert.match(metadata.textContent, /26\/27 H1/);
  assert.match(metadata.textContent, /24 Schüler/);
  const icon = collectElements(front, 'SVG')[0];
  assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg', 'die Kurskarte nutzt ein echtes lokales SVG-Liniensymbol');
  assert.match(f.find('back').textContent, /KURSINFORMATION/);
});

for (const [family, pointerType, expectedOpen] of [
  ['modern', 'mouse', true],
  ['aurora', 'mouse', true],
  ['classic', 'mouse', false],
  ['modern', 'touch', false],
  ['aurora', 'pen', false]
]) {
  test(`${family}: ${pointerType}-Hover oeffnet ${expectedOpen ? 'nach' : 'nicht nach'} Timerablauf`, async () => {
    const f = createCardFixture();
    await mountWith(f, { family });
    f.dispatch(f.find('card'), 'pointerenter', { pointerType });
    f.flushTimers();
    assert.equal(f.find('info').getAttribute('aria-expanded'), String(expectedOpen));
  });
}

test('modern: Mouse-Hover bleibt bis zum exakt 220ms-Timer geschlossen', async () => {
  const f = createCardFixture();
  await mountWith(f);
  f.dispatch(f.find('card'), 'pointerenter', { pointerType: 'mouse' });
  assert.deepEqual(f.scheduledDelays, [220]);
  assert.equal(f.find('info').getAttribute('aria-expanded'), 'false');
  f.flushTimers();
  assert.equal(f.find('info').getAttribute('aria-expanded'), 'true');
});

test('live von Classic zu Aurora gewechselte Karten aktivieren den Mouse-Hover ohne Neuaufbau', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, { family: 'classic' });
  const card = f.find('card');

  mounted.updateAppearance({ family: 'aurora' });
  assert.equal(f.find('card'), card, 'der Familienwechsel muss dieselbe Karte weiterverwenden');
  f.dispatch(card, 'pointerenter', { pointerType: 'mouse' });
  assert.equal(f.pendingTimers, 1);
  f.flushTimers();
  assert.equal(f.find('info').getAttribute('aria-expanded'), 'true');
});

test('live zu Classic gewechselte Karten verwerfen ausstehenden und offenen Mouse-Hover', async () => {
  const pending = createCardFixture();
  const pendingMount = await mountWith(pending, { family: 'aurora' });
  pending.dispatch(pending.find('card'), 'pointerenter', { pointerType: 'mouse' });
  assert.equal(pending.pendingTimers, 1);

  pendingMount.updateAppearance({ family: 'classic' });
  assert.equal(pending.pendingTimers, 0, 'Classic muss den noch ausstehenden Aurora-Hover abbrechen');
  pending.flushTimers();
  assert.equal(pending.find('info').getAttribute('aria-expanded'), 'false');

  const open = createCardFixture();
  const openMount = await mountWith(open, { family: 'aurora' });
  open.dispatch(open.find('card'), 'pointerenter', { pointerType: 'mouse' });
  open.flushTimers();
  assert.equal(open.find('info').getAttribute('aria-expanded'), 'true');
  openMount.updateAppearance({ family: 'classic' });
  assert.equal(open.find('info').getAttribute('aria-expanded'), 'false', 'Classic muss eine nur per Hover geöffnete Rückseite schließen');
});

test('Bewegung aus verwirft ausstehenden Hover, verhindert späte Effekte und erhält angeheftete Info', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, { family: 'aurora', motion: 'vivid' });
  const card = f.find('card');
  const info = f.find('info');
  f.dispatch(card, 'pointerenter', { pointerType: 'mouse' });
  assert.equal(f.pendingTimers, 1);

  mounted.updateAppearance({ motion: 'off' });
  assert.equal(f.pendingTimers, 0);
  f.flushTimers();
  assert.equal(info.getAttribute('aria-expanded'), 'false');
  assert.equal(f.host.children[0].getAttribute('data-motion'), 'off');

  f.dispatch(info, 'click');
  mounted.updateAppearance({ motion: 'vivid' });
  mounted.updateAppearance({ motion: 'off' });
  assert.equal(info.getAttribute('aria-expanded'), 'true', 'funktionale Info bleibt auch ohne Bewegung sichtbar');
});

test('Modern Calm und Vivid unterscheiden den Hover-Zeitpunkt ohne DOM-Neuaufbau', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, { family: 'modern', motion: 'calm' });
  const card = f.find('card');
  f.dispatch(card, 'pointerenter', { pointerType: 'mouse' });
  assert.deepEqual(f.scheduledDelays, [220]);
  f.dispatch(card, 'pointerleave');

  mounted.updateAppearance({ motion: 'vivid' });
  assert.equal(f.find('card'), card);
  f.dispatch(card, 'pointerenter', { pointerType: 'mouse' });
  assert.deepEqual(f.scheduledDelays, [140]);
});

test('Effektvorschau öffnet unangeheftete Karten endlich und Bewegung aus bricht sie sofort ab', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, { family: 'aurora', motion: 'vivid' });
  const info = f.find('info');

  assert.equal(mounted.previewMotion(), true);
  assert.equal(info.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.scheduledDelays, [2200]);
  mounted.updateAppearance({ motion: 'off' });
  assert.equal(f.pendingTimers, 0);
  assert.equal(info.getAttribute('aria-expanded'), 'false');
  assert.equal(mounted.previewMotion(), false);
});

test('eine angeheftete Kursinfo bleibt beim live Wechsel zu Classic offen', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, { family: 'aurora' });
  f.dispatch(f.find('info'), 'click');

  mounted.updateAppearance({ family: 'classic' });

  assert.equal(f.find('info').getAttribute('aria-expanded'), 'true');
  assert.equal(f.find('info').textContent, '×');
});

test('der 220ms-Hover-Vertrag erkennt einen In-Memory-221ms-Mutanten', async () => {
  const f = createCardFixture();
  await mountWith(f, {}, source => source.replace("currentMotion === 'vivid' ? 140 : 220", "currentMotion === 'vivid' ? 140 : 221"));
  f.dispatch(f.find('card'), 'pointerenter', { pointerType: 'mouse' });
  assert.deepEqual(f.scheduledDelays, [221]);
});

for (const action of ['leave', 'escape']) {
  test(`${action} vor Hover-Timer verhindert ein spaetes Oeffnen`, async () => {
    const f = createCardFixture();
    await mountWith(f);
    const card = f.find('card');
    f.dispatch(card, 'pointerenter', { pointerType: 'mouse' });
    assert.equal(f.pendingTimers, 1);
    if (action === 'leave') f.dispatch(card, 'pointerleave');
    else f.dispatch(card, 'keydown', { key: 'Escape' });
    assert.equal(f.pendingTimers, 0);
    f.flushTimers();
    assert.equal(f.find('info').getAttribute('aria-expanded'), 'false');
  });
}

test('Angeheftete Info ueberlebt pointerleave', async () => {
  const f = createCardFixture();
  await mountWith(f);
  f.dispatch(f.find('info'), 'click');
  f.dispatch(f.find('card'), 'pointerleave');
  assert.equal(f.find('info').getAttribute('aria-expanded'), 'true');
  assert.equal(f.find('info').textContent, '×');
});

test('zwei Karten behalten ihren Infozustand unabhaengig', async () => {
  const f = createCardFixture();
  await mountWith(f, { courses: [course, { ...course, id: 'c2', name: 'Chemie' }] });
  f.dispatch(f.find('info', 0), 'click');
  assert.equal(f.find('info', 0).getAttribute('aria-expanded'), 'true');
  assert.equal(f.find('info', 1).getAttribute('aria-expanded'), 'false');
});

test('dispose vor Hover-Timer entfernt nur die eigene Wurzel und erhaelt fremde Host-Kinder', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f);
  const sibling = f.document.createElement('aside');
  f.host.appendChild(sibling);
  f.dispatch(f.find('card'), 'pointerenter', { pointerType: 'mouse' });
  assert.equal(f.pendingTimers, 1);
  mounted.dispose();
  assert.equal(f.pendingTimers, 0);
  assert.deepEqual(f.host.children, [sibling]);
  assert.equal(sibling.parentNode, f.host);
  f.flushTimers();
  assert.deepEqual(f.host.children, [sibling]);
});

test('dispose-Nachweis erkennt einen In-Memory-Mutanten mit breitem Host-Cleanup', async () => {
  const f = createCardFixture();
  const mounted = await mountWith(f, {}, source => source.replace(
    'if (root.parentNode === host) host.removeChild(root);',
    'while (host.children.length) host.removeChild(host.children[0]);'
  ));
  const sibling = f.document.createElement('aside');
  f.host.appendChild(sibling);
  mounted.dispose();
  assert.equal(sibling.parentNode, null);
});

test('leerem Bestand und Archivfilter bleibt nur der aktive Kurs', async () => {
  const empty = createCardFixture();
  await mountWith(empty, { courses: [] });
  assert.equal(empty.find('card'), null);
  const f = createCardFixture();
  await mountWith(f, { courses: [course, { ...course, id: 'archiv', archivedAt: '2026-08-01' }] });
  assert.equal(f.find('card', 0).getAttribute('data-course-id'), 'c1');
  assert.equal(f.find('card', 1), null);
});

test('Kursname wird ausschliesslich als Text gerendert und Eingabeobjekte bleiben unveraendert', async () => {
  const f = createCardFixture();
  const unsafe = Object.freeze({ ...course, id: 'unsafe', name: '<img src=x onerror=alert(1)>' });
  const courses = Object.freeze([unsafe]);
  await mountWith(f, { courses, idPrefix: 'safe' });
  assert.equal(collectElements(f.host, 'H3')[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(collectElements(f.host, 'P')[0].textContent, '10a');
  assert.deepEqual(courses, [unsafe]);
});

for (const [label, options] of [
  ['fehlendem Host', { host: null }],
  ['fehlendem Callback', { onOpenCourse: null }],
  ['ungueltigem optionalen Bearbeiten-Callback', { onEditCourse: true }],
  ['unbekannter Familie', { family: 'future' }],
  ['unbekannter Darstellung', { appearance: 'sepia' }],
  ['unbekannter Bewegung', { motion: 'springy' }],
  ['leerem ID-Praefix', { idPrefix: '' }],
  ['fehlender Kurs-ID', { courses: [{ ...course, id: '' }] }],
  ['doppelter Kurs-ID', { courses: [course, { ...course }] }],
  ['negativer Schuelerzahl', { courses: [{ ...course, studentCount: -1 }] }],
  ['nicht-ganzzahliger Schuelerzahl', { courses: [{ ...course, studentCount: 2.5 }] }]
]) {
  test(`ungueltige Optionen (${label}) werfen ohne Teil-DOM`, async () => {
    const f = createCardFixture();
    await assert.rejects(
      mountWith(f, options),
      TypeError
    );
    assert.equal(f.host.children.length, 0);
  });
}
