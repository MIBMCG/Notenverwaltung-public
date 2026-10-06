'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { readSourceLines } = require('./harness/extract.js');

const root = path.resolve(__dirname, '..');

function createDocument() {
  let document;

  class Element {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.type = '';
      this.value = '';
      this.textContent = '';
      this.autocomplete = '';
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index !== -1) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, init = {}) {
      const event = { type, target: this, ...init };
      for (const listener of this.listeners.get(type) || []) listener.call(this, event);
      return event;
    }

    focus() { document.activeElement = this; }
  }

  const body = new Element('body');
  document = {
    body,
    activeElement: null,
    createElement(tagName) { return new Element(tagName); }
  };
  return document;
}

function promptPasswordSource() {
  const source = readSourceLines().join('\n');
  const start = source.indexOf('window.promptPassword = function');
  const end = source.indexOf('// Debug-Toast-Funktion entfernt', start);
  assert.notEqual(start, -1, 'promptPassword source is missing');
  assert.notEqual(end, -1, 'promptPassword source end marker is missing');
  return source.slice(start, end);
}

function loadPrompt() {
  const document = createDocument();
  const listeners = new Map();
  const alerts = [];
  const window = {
    alert(message) { alerts.push(message); },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(entry => entry !== listener));
    }
  };
  const sandbox = { window, document, console: { error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(promptPasswordSource(), sandbox, { filename: 'promptPassword.js' });
  return {
    document,
    window: sandbox.window,
    alerts,
    dispatchKey(key) {
      for (const listener of [...(listeners.get('keydown') || [])]) listener({ key });
    },
    listenerCount() { return (listeners.get('keydown') || []).length; }
  };
}

function openPrompt(env, opts) {
  const result = env.window.promptPassword(opts);
  const overlay = env.document.body.children.at(-1);
  const dialog = overlay.children[0];
  const inputs = dialog.children.filter(child => child.tagName === 'INPUT');
  const buttons = dialog.children.at(-1).children;
  return { result, overlay, dialog, inputs, cancel: buttons[0], submit: buttons[1] };
}

function parseViewportTags(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(match => Object.fromEntries([...match[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value])))
    .filter(attributes => attributes.name === 'viewport');
}

test('L20: shipped document enables standard mobile viewport scaling without disabling zoom', () => {
  const html = fs.readFileSync(path.join(root, 'Notenverwaltung.html'), 'utf8');
  const viewportTags = parseViewportTags(html);

  assert.equal(viewportTags.length, 1);
  const directives = Object.fromEntries(viewportTags[0].content.split(',').map(part => {
    const [key, value] = part.trim().split('=');
    return [key.trim().toLowerCase(), value];
  }));
  assert.equal(directives.width, 'device-width');
  assert.equal(directives['initial-scale'], '1');
  assert.equal(Object.hasOwn(directives, 'user-scalable'), false, 'user-scalable must not restrict browser zoom');
  assert.equal(Object.hasOwn(directives, 'maximum-scale'), false, 'maximum-scale must not cap browser zoom');
});

test('L20: existing-password prompt fits a narrow viewport and submits with the current-password hint', async () => {
  const env = loadPrompt();
  const prompt = openPrompt(env, { message: 'Bestehendes Passwort eingeben' });
  const [input] = prompt.inputs;

  assert.equal(prompt.dialog.style.width, 'min(320px, calc(100vw - 2rem))');
  assert.equal(prompt.dialog.style.maxWidth, 'calc(100vw - 2rem)');
  assert.equal(prompt.dialog.style.boxSizing, 'border-box');
  assert.equal(prompt.dialog.style.maxHeight, 'calc(100vh - 2rem)');
  assert.equal(prompt.dialog.style.overflowY, 'auto');
  assert.equal(prompt.dialog.style.minWidth, undefined);
  assert.equal(input.type, 'password');
  assert.equal(input.autocomplete, 'current-password');
  assert.equal(env.document.activeElement, input);

  input.value = 'bestehendes-passwort';
  env.dispatchKey('Enter');
  assert.equal(await prompt.result, 'bestehendes-passwort');
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.listenerCount(), 0);
});

test('L20: new-password prompt hints both fields and keeps confirmation validation', async () => {
  const env = loadPrompt();
  const prompt = openPrompt(env, { confirm: true });
  const [input, confirmation] = prompt.inputs;

  assert.equal(input.autocomplete, 'new-password');
  assert.equal(confirmation.autocomplete, 'new-password');
  assert.equal(confirmation.type, 'password');

  input.value = 'neues-passwort';
  confirmation.value = 'anderes-passwort';
  prompt.submit.dispatch('click');
  assert.deepEqual(env.alerts, ['Passwörter stimmen nicht überein.']);
  assert.equal(env.document.body.children.length, 1);

  confirmation.value = 'neues-passwort';
  prompt.submit.dispatch('click');
  assert.equal(await prompt.result, 'neues-passwort');
  assert.equal(env.document.body.children.length, 0);
});

test('L20: Escape cancels the password prompt and cleans up its keyboard listener', async () => {
  const env = loadPrompt();
  const prompt = openPrompt(env, { confirm: false });

  env.dispatchKey('Escape');
  assert.equal(await prompt.result, null);
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.listenerCount(), 0);
});

test('L20: clicking cancel discards entered passwords and removes the dialog and keyboard listener', async () => {
  const env = loadPrompt();
  const prompt = openPrompt(env, { confirm: true });
  prompt.inputs[0].value = 'nicht-uebernehmen';
  prompt.inputs[1].value = 'abweichende-bestaetigung';

  prompt.cancel.dispatch('click');
  assert.equal(env.document.body.children.length, 0);
  assert.equal(env.listenerCount(), 0);
  assert.deepEqual(env.alerts, []);
  assert.equal(await prompt.result, null);
});
