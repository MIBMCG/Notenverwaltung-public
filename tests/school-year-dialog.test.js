'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

function createCommitHarness(modules, initialState, persistState = async () => {}) {
  let confirmedState = initialState;
  const lines = readSourceLines();
  vm.runInContext(
    `${extractFunction(lines, 'createSerializedTransactionQueue')}\n` +
      'globalThis.__createSchoolYearQueue = createSerializedTransactionQueue;',
    modules.sandbox,
    { filename: 'school-year-queue.js' }
  );
  const enqueue = modules.sandbox.__createSchoolYearQueue();
  const { createStateCommitter } = loadEsmGraph('src/ui/state-commit.js').exports;
  const committer = createStateCommitter({
    readState: () => confirmedState,
    persistState,
    publishState(candidate) {
      confirmedState = candidate;
      modules.sandbox.state = candidate;
    },
    enqueue,
    readEpoch: () => 0
  });
  const commitStateChange = (change, options = {}) => {
    void options;
    return committer.commit(change);
  };
  return { commitStateChange, readState: () => confirmedState };
}

function createDocumentStub() {
  const documentListeners = new Map();
  let document;

  class Element {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.value = '';
      this.textContent = '';
      this.type = '';
      this.disabled = false;
      this.hidden = false;
      this.checked = false;
      this.isConnected = false;
    }

    appendChild(child) {
      child.parentNode = this;
      child.isConnected = this.isConnected;
      this.children.push(child);
      return child;
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }

    addEventListener(type, listener) {
      const current = this.listeners.get(type) || [];
      current.push(listener);
      this.listeners.set(type, current);
    }

    async dispatch(type, init = {}) {
      const event = createEvent({ type, target: this, ...init });
      for (const listener of this.listeners.get(type) || []) await listener.call(this, event);
      return event;
    }

    focus() { document.activeElement = this; }

    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
      this.isConnected = false;
    }

    querySelectorAll() {
      const matches = [];
      const visit = element => {
        for (const child of element.children) {
          const interactive = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(child.tagName)
            || child.getAttribute('tabindex') !== null;
          if (interactive && !child.disabled && !child.hidden && child.getAttribute('tabindex') !== '-1') {
            matches.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return matches;
    }
  }

  function createEvent(init) {
    return {
      shiftKey: false,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init
    };
  }

  const body = new Element('body');
  body.isConnected = true;
  document = {
    body,
    activeElement: null,
    createElement(tagName) { return new Element(tagName); },
    getElementById(id) {
      let match = null;
      const visit = element => {
        for (const child of element.children) {
          if (child.id === id) {
            match = child;
            return;
          }
          visit(child);
          if (match) return;
        }
      };
      visit(body);
      return match;
    },
    createTextNode(text) {
      const node = new Element('#text');
      node.textContent = String(text);
      return node;
    },
    addEventListener(type, listener) {
      const current = documentListeners.get(type) || [];
      current.push(listener);
      documentListeners.set(type, current);
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter(item => item !== listener));
    },
    async dispatch(type, init = {}) {
      const event = createEvent({ type, target: document, ...init });
      for (const listener of [...(documentListeners.get(type) || [])]) await listener.call(document, event);
      return event;
    }
  };
  return document;
}

function openAssistant({
  persistState = async () => {},
  prepareState = () => {},
  courses = [{
    id: 'course-8a',
    name: 'Biologie 8a',
    classLabel: '8a',
    schoolYearStartYear: 2025
  }]
} = {}) {
  const modules = loadModules();
  const document = createDocumentStub();
  const state = modules.DomainModel.createEmptyState();
  state.courses.push(...courses.map(course => modules.DomainModel.createCourse(course)));
  prepareState(state, modules);
  const commitHarness = createCommitHarness(modules, state, candidate => persistState(candidate, document));
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();

  Object.assign(modules.sandbox, {
    document,
    state,
    currentCourseId: null,
    commitStateChange: commitHarness.commitStateChange,
    render() {},
    decorateSuccessorPlanWithWeighting: (_course, plan) => plan
  });
  const source = `${extractFunction(readSourceLines(), 'isStateCommitAborted')}\n` +
    `${extractFunction(readSourceLines(), 'requireActiveCourse')}\n` +
    `${extractFunction(readSourceLines(), 'promoteHomeClass')}\n` +
    `${extractFunction(readSourceLines(), 'replaceStandaloneClassLabel')}\n` +
    `${extractFunction(readSourceLines(), 'requestArchiveMetadata')}\n` +
    `${extractFunction(readSourceLines(), 'openSchoolYearAssistant')}\n` +
    'globalThis.__openSchoolYearAssistant = openSchoolYearAssistant;';
  vm.runInContext(source, modules.sandbox, { filename: 'school-year-dialog.js' });
  modules.sandbox.__openSchoolYearAssistant(trigger);

  const overlay = document.body.children[1];
  const dialog = overlay.children[0];
  return { document, trigger, overlay, dialog, modules, state };
}

test('Low class rename: the school-year assistant replaces only standalone class labels', () => {
  const { dialog } = openAssistant({
    courses: [
      { id: 'course-suffix', name: 'Biologie 5a', classLabel: '5a', schoolYearStartYear: 2025 },
      { id: 'course-prefix', name: '5a Biologie', classLabel: '5a', schoolYearStartYear: 2025 },
      { id: 'course-room', name: 'Deutsch Raum 15a', classLabel: '5a', schoolYearStartYear: 2025 }
    ]
  });
  const courseRows = dialog.children[3].children[1].children;
  const suggestedNames = courseRows.map(row => row.children[3].children[0].value);

  assert.deepEqual(suggestedNames, [
    'Biologie 6a',
    '6a Biologie',
    'Deutsch Raum 15a'
  ]);
});

test('M29: the school-year assistant exposes modal dialog semantics and focuses its first field', () => {
  const { document, dialog } = openAssistant();
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const title = dialog.children[0];
  assert.ok(title.getAttribute('id'));
  assert.equal(dialog.getAttribute('aria-labelledby'), title.getAttribute('id'));
  assert.equal(document.activeElement.tagName, 'INPUT');
  assert.equal(document.activeElement.type, 'number');
});

test('M29: Escape closes the assistant and restores focus to its trigger', async () => {
  const { document, trigger, overlay } = openAssistant();
  const event = await document.dispatch('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(overlay.isConnected, false);
  assert.equal(document.activeElement, trigger);
});

test('M29: clicking the backdrop closes the assistant and restores focus', async () => {
  const { document, trigger, overlay } = openAssistant();
  await overlay.dispatch('click', { target: overlay });
  assert.equal(overlay.isConnected, false);
  assert.equal(document.activeElement, trigger);
});

test('M29: Tab and Shift+Tab keep keyboard focus inside the assistant', async () => {
  const { document, dialog } = openAssistant();
  const focusable = dialog.querySelectorAll();
  const first = focusable[0];
  const last = focusable.at(-1);

  last.focus();
  const forward = await document.dispatch('keydown', { key: 'Tab' });
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, first);

  first.focus();
  const backward = await document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(backward.defaultPrevented, true);
  assert.equal(document.activeElement, last);
});

test('M29: the session lock can dismiss the assistant through its dialog lifecycle', () => {
  const { document, trigger, overlay } = openAssistant();
  assert.equal(typeof overlay.__closeForSessionLock, 'function');
  overlay.__closeForSessionLock();
  assert.equal(overlay.isConnected, false);
  assert.equal(document.activeElement, trigger);
});

test('M29 review: Escape closes only the archive-metadata child dialog and restores the assistant lifecycle', async () => {
  const { document, trigger, overlay, dialog } = openAssistant();
  const apply = dialog.querySelectorAll().at(-1);
  const applyPromise = apply.dispatch('click');

  assert.equal(document.body.children.length, 3, 'the metadata child dialog must open above the assistant');
  const metadataOverlay = document.body.children[2];
  const childEscape = await document.dispatch('keydown', { key: 'Escape' });
  await applyPromise;

  assert.equal(childEscape.defaultPrevented, false);
  assert.equal(metadataOverlay.isConnected, false, 'Escape must close the child dialog');
  assert.equal(overlay.isConnected, true, 'the parent assistant must preserve its entered values');
  assert.equal(document.activeElement, apply, 'focus must return to the action that opened the child dialog');

  await document.dispatch('keydown', { key: 'Escape' });
  assert.equal(overlay.isConnected, false, 'the restored parent listener must still close the assistant');
  assert.equal(document.activeElement, trigger);
});

test('M29 review: a completed school-year change focuses the replacement trigger after rerender', async () => {
  let replacementTrigger;
  const { document, trigger, overlay, dialog, modules } = openAssistant({
    persistState: async (_candidate, currentDocument) => {
      trigger.remove();
      replacementTrigger = currentDocument.createElement('button');
      replacementTrigger.id = 'school-year-assistant-trigger';
      currentDocument.body.appendChild(replacementTrigger);
    }
  });
  modules.sandbox.window.confirm = () => true;

  const apply = dialog.querySelectorAll().at(-1);
  const applyPromise = apply.dispatch('click');
  const metadataOverlay = document.body.children[2];
  const metadataConfirm = metadataOverlay.children[0].querySelectorAll().at(-1);
  await metadataConfirm.dispatch('click');
  await applyPromise;

  assert.equal(overlay.isConnected, false);
  assert.equal(document.activeElement, replacementTrigger);
});

test('R07/R11: school-year rollover freezes predecessor term assignments without copying them to the successor', async () => {
  let savedCandidate = null;
  const { document, dialog, modules } = openAssistant({
    prepareState(state, domainModules) {
      const categoryId = state.settings.categories[0].id;
      for (const assessment of [
        domainModules.DomainModel.createAssessment({
          id: 'rollover-manual', courseId: 'course-8a', categoryId,
          title: 'Manuell', date: '2026-03-15', term: '2025-H1', termAssignment: 'manual'
        }),
        domainModules.DomainModel.createAssessment({
          id: 'rollover-auto', courseId: 'course-8a', categoryId,
          title: 'Automatisch', date: '2026-03-15', term: '2025-H2', termAssignment: 'auto'
        })
      ]) domainModules.DomainModel.addAssessmentToState(state, assessment);
    },
    persistState: async candidate => { savedCandidate = candidate; }
  });
  modules.sandbox.window.confirm = () => true;

  const apply = dialog.querySelectorAll().at(-1);
  const applyPromise = apply.dispatch('click');
  const metadataOverlay = document.body.children[2];
  const metadataConfirm = metadataOverlay.children[0].querySelectorAll().at(-1);
  await metadataConfirm.dispatch('click');
  await applyPromise;

  assert.ok(savedCandidate);
  const predecessor = savedCandidate.courses.find(course => course.id === 'course-8a');
  const successor = savedCandidate.courses.find(course => course.carriedForwardFromCourseId === 'course-8a');
  assert.ok(predecessor.archivedAt);
  assert.ok(successor);
  assert.deepEqual(
    JSON.parse(JSON.stringify(savedCandidate.assessments.filter(assessment => assessment.courseId === predecessor.id)
      .map(assessment => [assessment.id, assessment.term, assessment.termAssignment]))),
    [
      ['rollover-manual', '2025-H1', 'manual'],
      ['rollover-auto', '2025-H2', 'auto']
    ]
  );
  assert.equal(savedCandidate.assessments.some(assessment => assessment.courseId === successor.id), false);
});
