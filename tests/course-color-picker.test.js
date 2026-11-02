'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph');
const { createStartDocument } = require('./harness/start-dom');

function setup(course = {}, onChange) {
  const { createCourseColorPicker } = loadEsmGraph('src/ui/course-color-picker.js').exports;
  const { document } = createStartDocument();
  const picker = createCourseColorPicker({ document, id: 'color', course: { subject: 'Biologie', ...course }, onChange });
  return { ...picker, document, preview: picker.root.querySelector('.course-color-picker__preview') };
}

test('dragging updates the existing preview without saving or replacing the focused range', async () => {
  const saves = [];
  const picker = setup({}, value => saves.push(value));
  picker.input.focus();
  picker.input.value = '280';
  await picker.input.dispatch('input');
  assert.equal(picker.preview.getAttribute('data-course-hue'), '280');
  assert.equal(picker.preview.getAttribute('style'), '--nv-course-hue: 280');
  assert.equal(picker.document.activeElement, picker.input);
  assert.equal(picker.root.querySelector('input'), picker.input);
  assert.deepEqual(saves, []);
});

test('committing the red endpoint saves numeric zero and reset restores the latest subject color', async () => {
  const saves = [];
  const picker = setup({}, async value => saves.push(value));
  picker.input.value = '0';
  await picker.input.dispatch('change');
  assert.deepEqual(saves, [0]);
  assert.equal(picker.getValue(), 0);
  assert.equal(picker.resetButton.disabled, false);
  picker.updateSubject('Chemie');
  assert.equal(picker.preview.getAttribute('data-course-hue'), '0');
  await picker.resetButton.dispatch('click');
  assert.deepEqual(saves, [0, null]);
  assert.equal(picker.getValue(), null);
  assert.equal(picker.preview.getAttribute('data-course-hue'), '175');
  assert.equal(picker.resetButton.disabled, true);
});

test('automatic colors follow subject edits while explicit choices stay fixed', () => {
  const picker = setup();
  assert.equal(picker.preview.getAttribute('data-course-hue'), '145');
  picker.updateSubject('Mathematik');
  assert.equal(picker.preview.getAttribute('data-course-hue'), '215');
  picker.setValue(32);
  picker.updateSubject('Chemie');
  assert.equal(picker.preview.getAttribute('data-course-hue'), '32');
  picker.setValue(null);
  assert.equal(picker.preview.getAttribute('data-course-hue'), '175');
});

test('rollback restores confirmed color and invalid overrides safely use automatic color', async () => {
  const picker = setup({ cardHue: 42 });
  picker.input.value = '180';
  await picker.input.dispatch('input');
  picker.setValue(42, 'Mathematik');
  assert.equal(picker.input.value, '42');
  assert.equal(picker.getValue(), 42);
  picker.setValue('<script>');
  assert.equal(picker.getValue(), null);
  assert.equal(picker.preview.getAttribute('data-course-hue'), '215');
  picker.input.value = 'not-a-hue';
  await picker.input.dispatch('change');
  assert.equal(picker.getValue(), null);
  assert.equal(picker.input.value, '215');
});

test('pending persistence prevents overlapping saves and unlocks after rollback on rejection', async () => {
  let rejectSave;
  let saves = 0;
  const picker = setup({ cardHue: 42 }, () => {
    saves++;
    return new Promise((_resolve, reject) => { rejectSave = reject; });
  });
  picker.input.value = '99';
  const pending = picker.input.dispatch('change');
  assert.equal(picker.input.disabled, true);
  assert.equal(picker.resetButton.disabled, true);
  await picker.resetButton.dispatch('click');
  assert.equal(saves, 1);
  picker.setValue(42);
  rejectSave(new Error('save failed'));
  await assert.rejects(pending, /save failed/);
  assert.equal(picker.input.disabled, false);
  assert.equal(picker.resetButton.disabled, false);
  assert.equal(picker.getValue(), 42);
});

test('range has connected German labels and course names remain literal preview text', () => {
  const name = '<img src=x onerror=alert(1)>';
  const picker = setup({ name });
  assert.equal(picker.input.type, 'range');
  assert.equal(picker.input.min, '0');
  assert.equal(picker.input.max, '359');
  assert.equal(picker.input.step, '1');
  const label = picker.root.querySelector('label');
  assert.equal(label.getAttribute('for'), 'color');
  assert.match(label.textContent, /Kachelfarbe/);
  const descriptionIds = picker.input.getAttribute('aria-describedby').split(/\s+/);
  assert.ok(descriptionIds.every(id => picker.root._findById(id)));
  assert.match(picker.input.getAttribute('aria-valuetext'), /\S/);
  assert.ok(picker.preview.textContent.includes(name));
  assert.equal(picker.preview.querySelector('img'), null);
  assert.equal(picker.resetButton.type, 'button');
});

test('saving restores connected range focus after native disabled-control blur', async () => {
  let finish;
  const picker = setup({}, () => new Promise(resolve => { finish = resolve; }));
  picker.document.body.appendChild(picker.root);
  picker.input.focus();
  picker.input.value = '42';
  const saving = picker.input.dispatch('change');
  picker.document.activeElement = picker.document.body;
  finish();
  await saving;
  assert.equal(picker.document.activeElement, picker.input);
});

test('saving respects focus moved elsewhere and never refocuses a detached picker', async () => {
  let finish;
  const picker = setup({}, () => new Promise(resolve => { finish = resolve; }));
  picker.document.body.appendChild(picker.root);
  const other = picker.document.createElement('button');
  picker.document.body.appendChild(other);
  picker.input.focus();
  picker.input.value = '42';
  const saving = picker.input.dispatch('change');
  other.focus();
  finish();
  await saving;
  assert.equal(picker.document.activeElement, other);
  picker.input.focus();
  const detachedSaving = picker.input.dispatch('change');
  picker.root.remove();
  picker.document.activeElement = picker.document.body;
  finish();
  await detachedSaving;
  assert.equal(picker.document.activeElement, picker.document.body);
});

test('reset moves focus to the range when its completed action disables the reset button', async () => {
  let finish;
  const picker = setup({ cardHue: 42 }, () => new Promise(resolve => { finish = resolve; }));
  picker.document.body.appendChild(picker.root);
  picker.resetButton.focus();
  const saving = picker.resetButton.dispatch('click');
  picker.document.activeElement = picker.document.body;
  finish();
  await saving;
  assert.equal(picker.resetButton.disabled, true);
  assert.equal(picker.document.activeElement, picker.input);
});
