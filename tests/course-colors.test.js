'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load');
const { loadEsmGraph } = require('./harness/load-esm-graph');

test('hue normalization accepts inclusive numeric boundaries without coercion', () => {
  const { normalizeCourseCardHue } = loadEsmGraph('src/domain/course-colors.js').exports;
  for (const hue of [0, 145, 359]) assert.equal(normalizeCourseCardHue(hue), hue);
  for (const invalid of [undefined, null, '', '145', true, false, -1, 360, 1.5, NaN, Infinity, {}, []]) {
    assert.equal(normalizeCourseCardHue(invalid), null);
  }
});

test('subject aliases select the same automatic hue independently of the course symbol', () => {
  const { resolveCourseCardHue } = loadEsmGraph('src/domain/course-colors.js').exports;
  const groups = [
    [145, ['Biologie', ' bio ', 'NaWi', 'Naturwissenschaften']],
    [215, ['Mathematik', ' MATHE ']],
    [35, ['Deutsch']], [195, ['Englisch']],
    [275, ['Französisch', 'FRANZOESISCH', 'Franzosisch']],
    [175, ['Chemie']], [240, ['Physik']], [25, ['Geschichte']],
    [95, ['Geografie', 'Geographie', 'Erdkunde']], [15, ['Sport']],
    [315, ['Musik']], [285, ['Kunst']], [205, ['Informatik']],
    [55, ['Politik', 'Ethik', 'Religion', 'Philosophie']],
  ];
  for (const [hue, aliases] of groups) {
    for (const subject of aliases) assert.equal(resolveCourseCardHue({ subject, symbolId: 'music' }), hue, subject);
  }
  const languageHues = ['Latein', 'Spanisch', 'Italienisch', 'Russisch'].map(subject => resolveCourseCardHue({ subject }));
  assert.equal(new Set(languageHues).size, 4);
});

test('valid overrides win, invalid overrides fall back and unknown subjects remain deterministic', () => {
  const { resolveCourseCardHue } = loadEsmGraph('src/domain/course-colors.js').exports;
  assert.equal(typeof resolveCourseCardHue, 'function');
  assert.equal(resolveCourseCardHue({ subject: 'Biologie', cardHue: 0 }), 0);
  assert.equal(resolveCourseCardHue({ subject: 'Biologie', cardHue: 359 }), 359);
  assert.equal(resolveCourseCardHue({ subject: 'Biologie', cardHue: '0' }), 145);
  assert.equal(resolveCourseCardHue(), 210);
  assert.equal(resolveCourseCardHue({ subject: '   ' }), 210);
  const unknown = resolveCourseCardHue({ subject: '  Zukunft   und Technik  ' });
  assert.ok(Number.isInteger(unknown) && unknown >= 0 && unknown <= 359);
  assert.equal(resolveCourseCardHue({ subject: 'ZUKUNFT UND TECHNIK' }), unknown);
  assert.equal(loadEsmGraph('src/domain/course-colors.js').exports.resolveCourseCardHue({ subject: 'Zukunft und Technik' }), unknown);
  assert.notEqual(resolveCourseCardHue({ subject: 'Astronomie' }), unknown);
});

test('course hue overrides survive normalization, succession and dashboard projection including zero', () => {
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const { buildDashboardCards } = loadEsmGraph('src/ui/dashboard-data.js').exports;
  const state = domain.createEmptyState();
  state.courses.push(domain.createCourse({ id: 'red-course', subject: 'Biologie', cardHue: 0 }));
  assert.equal(state.courses[0].cardHue, 0);
  const restored = domain.ensureStateShape(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.courses[0].cardHue, 0);
  assert.equal(domain.createSuccessorCourseCandidate(restored.courses[0], 2027).cardHue, 0);
  assert.equal(buildDashboardCards({ state: restored, domain, grading })[0].cardHue, 0);
});

test('automatic courses retain no persisted override while malformed imported overrides are removed', () => {
  const { DomainModel: domain } = loadModules();
  const state = domain.createEmptyState();
  state.courses.push(domain.createCourse({ id: 'automatic', subject: 'Deutsch' }));
  for (const [index, cardHue] of ['145', -1, 360, 1.5, true, {}, [], null].entries()) {
    state.courses.push({ ...domain.createCourse({ id: `invalid-${index}` }), cardHue });
  }
  const restored = domain.ensureStateShape(JSON.parse(JSON.stringify(state)));
  for (const course of restored.courses) assert.equal(Object.hasOwn(course, 'cardHue'), false);
  assert.equal(Object.hasOwn(domain.createSuccessorCourseCandidate(restored.courses[0], 2027), 'cardHue'), false);
});

test('backup merge keeps local explicit and automatic choices and preserves a new course override', () => {
  const { DomainModel: domain, ImportMerge } = loadModules();
  const local = domain.createEmptyState();
  local.courses.push(domain.createCourse({ id: 'explicit', cardHue: 0 }));
  local.courses.push(domain.createCourse({ id: 'automatic' }));
  const incoming = JSON.parse(JSON.stringify(local));
  incoming.courses[0].cardHue = 100;
  incoming.courses[1].cardHue = 200;
  incoming.courses.push(domain.createCourse({ id: 'new', cardHue: 359 }));
  const { state } = ImportMerge.mergeImportedStateIntoCurrent(local, incoming);
  assert.equal(state.courses.find(course => course.id === 'explicit').cardHue, 0);
  assert.equal(Object.hasOwn(state.courses.find(course => course.id === 'automatic'), 'cardHue'), false);
  assert.equal(state.courses.find(course => course.id === 'new').cardHue, 359);
});

test('encrypted backup roundtrip preserves explicit zero and automatic mode', async () => {
  const { DomainModel: domain, Storage } = loadModules();
  const state = domain.createEmptyState();
  state.courses.push(domain.createCourse({ id: 'explicit', cardHue: 0 }));
  state.courses.push(domain.createCourse({ id: 'automatic', subject: 'Biologie' }));
  const password = 'Synthetisches-Testpasswort-2026';
  const backup = await Storage.exportStateEncrypted(password, state);
  const restored = domain.ensureStateShape(await Storage.importStateEncryptedFromText(backup, password));
  assert.equal(restored.courses[0].cardHue, 0);
  assert.equal(Object.hasOwn(restored.courses[1], 'cardHue'), false);
});
