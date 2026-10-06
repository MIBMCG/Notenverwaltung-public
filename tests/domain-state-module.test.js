'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seededRandom } = require('./harness/load.js');
const { loadLegacyDomain: loadModules } = require('./harness/load-legacy-domain.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const serializable = value => JSON.parse(JSON.stringify(value));

function loadState(seed = 7) {
  const math = Object.assign(Object.create(Math), { random: seededRandom(seed) });
  return loadEsmGraph('src/domain/state.js', { globals: { Math: math } }).exports;
}

test('Wave 3.1 state module preserves constants and default state', () => {
  const legacy = loadModules({ seed: 7 }).DomainModel;
  const state = loadState(7);
  for (const name of [
    'SCHEMA_MODES', 'UPPERSEC_COURSE_TYPES', 'QUALIFICATION_YEARS',
    'SCORE_STATUS', 'STANDARD_GRADE_LABELS', 'RECOMMENDED_WEIGHT_TEMPLATE_IDS'
  ]) assert.deepEqual(serializable(state[name]), serializable(legacy[name]), name);
  assert.deepEqual(serializable(state.createDefaultGradeMapping()), serializable(legacy.createDefaultGradeMapping()));
  const modernDefault = serializable(state.createEmptyState());
  const legacyDefault = serializable(legacy.createEmptyState());
  assert.equal(modernDefault.lastGradesheetCourseId, null,
    'ein frischer Zustand darf noch keinen Notenkurs als besucht markieren');
  delete modernDefault.lastGradesheetCourseId;
  // School branding is independently covered by school-branding.test.js.
  delete modernDefault.settings.schoolProfile;
  assert.deepEqual(modernDefault, legacyDefault);
});

test('Wave 3.1 state IDs keep the deterministic legacy contract', () => {
  const legacy = loadModules({ seed: 19 }).DomainModel;
  const state = loadState(19);
  assert.equal(state.generateId('course'), legacy.generateId('course'));
});

test('Wave 3.1 findById preserves lookup and invalid-collection behavior', () => {
  const state = loadState();
  const item = { id: 'a' };
  assert.equal(state.findById([item], 'a'), item);
  assert.equal(state.findById([item], 'missing'), null);
  assert.throws(() => state.findById(null, 'a'), error => error && error.name === 'TypeError');
});
