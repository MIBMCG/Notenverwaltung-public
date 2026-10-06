'use strict';

// Lightweight DOM fixture for extracted UiShell and generated-artifact tests.
// dispatch() deliberately awaits listener promises; browser dispatchEvent() does not.
function createStartElement(tagName, ownerDocument = null, namespaceURI = 'http://www.w3.org/1999/xhtml') {
  let ownText = '';
  const listeners = new Map();
  const attributes = new Map();
  const classNames = new Set();
  const element = {
    tagName: String(tagName).toUpperCase(), ownerDocument, namespaceURI, style: {}, children: [], parentNode: null,
    disabled: false, readOnly: false, value: '', type: '', dataset: {},
    classList: {
      add(...names) { names.forEach(name => classNames.add(name)); },
      remove(...names) { names.forEach(name => classNames.delete(name)); },
      contains(name) { return classNames.has(name); },
      toggle(name, force) { const next = force === undefined ? !classNames.has(name) : !!force; if (next) classNames.add(name); else classNames.delete(name); return next; }
    },
    setAttribute(name, value) { attributes.set(String(name), String(value)); if (name === 'id') this.id = String(value); if (name === 'class') this.className = String(value); },
    removeAttribute(name) { attributes.delete(String(name)); },
    getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; },
    remove(index) { if (typeof index === 'number') { if (this.children[index]) this.removeChild(this.children[index]); return; } if (this.parentNode) this.parentNode.removeChild(this); },
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentNode = null; });
      ownText = '';
      this.children = [];
      children.forEach(child => this.appendChild(child));
    },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener)); },
    dispatch(type, event = {}) { return Promise.all((listeners.get(type) || []).map(listener => listener.call(this, { target: this, currentTarget: this, preventDefault() {}, ...event }))); },
    focus() { if (ownerDocument) ownerDocument.activeElement = this; },
    closest(selector) { for (let candidate = this, tag = String(selector).toUpperCase(); candidate; candidate = candidate.parentNode) if (candidate.tagName === tag) return candidate; return null; },
    _listeners(type) { return listeners.get(type) || []; },
    _find(query) {
      const matches = typeof query === 'function' ? query : candidate => candidate.tagName === String(query).toUpperCase();
      if (matches(this)) return this;
      for (const child of this.children) { const found = child._find && child._find(matches); if (found) return found; }
      return null;
    },
    _findAll(predicate, found = []) { if (predicate(this)) found.push(this); this.children.forEach(child => child._findAll && child._findAll(predicate, found)); return found; },
    _findById(id) { return this._find(candidate => candidate.id === id); },
    querySelectorAll(selector) {
      const selectors = String(selector).split(',').map(value => value.trim()).filter(Boolean);
      const matches = candidate => selectors.some(value => {
        const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value);
        if (attribute) {
          const name = attribute[1];
          const expected = attribute[2];
          let actual = candidate.getAttribute ? candidate.getAttribute(name) : null;
          if (actual === null && name.startsWith('data-') && candidate.dataset) {
            const datasetName = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
            if (Object.prototype.hasOwnProperty.call(candidate.dataset, datasetName)) {
              actual = String(candidate.dataset[datasetName]);
            }
          }
          return expected === undefined ? actual !== null : actual === expected;
        }
        const [tag, className] = value.split('.');
        return (!tag || candidate.tagName === tag.toUpperCase()) && (!className || candidate.classList.contains(className));
      });
      return this.children.flatMap(child => child._findAll ? child._findAll(matches) : []);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  Object.defineProperty(element, 'id', { get() { return attributes.get('id') || ''; }, set(value) { attributes.set('id', String(value)); } });
  Object.defineProperty(element, 'className', { get() { return [...classNames].join(' '); }, set(value) { classNames.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classNames.add(name)); attributes.set('class', String(value)); } });
  Object.defineProperty(element, 'textContent', { get() { return ownText + this.children.map(child => child.textContent || '').join(''); }, set(value) { ownText = String(value); this.children = []; } });
  Object.defineProperty(element, 'firstChild', { get() { return this.children[0] || null; } });
  Object.defineProperty(element, 'options', { get() { return this.children; } });
  return element;
}

function createStartDocument({ includeAppRoot = true } = {}) {
  const documentListeners = new Map();
  const createdCounts = new Map();
  const body = createStartElement('body');
  const document = {
    title: '', activeElement: null, body,
    createElement(tagName) { const key = String(tagName).toLowerCase(); createdCounts.set(key, (createdCounts.get(key) || 0) + 1); return createStartElement(tagName, document); },
    createElementNS(namespaceURI, tagName) { const key = String(tagName).toLowerCase(); createdCounts.set(key, (createdCounts.get(key) || 0) + 1); return createStartElement(tagName, document, namespaceURI); },
    createTextNode(text) { const node = createStartElement('#text', document); node.textContent = text; return node; },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
    querySelector(selector) { return body.querySelector(selector); },
    addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(listener); },
    removeEventListener(type, listener) { documentListeners.set(type, (documentListeners.get(type) || []).filter(candidate => candidate !== listener)); },
    getElementById(id) { return body._findById(id); },
    _created(tagName) { return createdCounts.get(String(tagName).toLowerCase()) || 0; }
  };
  body.ownerDocument = document;
  const root = includeAppRoot ? document.createElement('div') : null;
  if (root) { root.id = 'app'; root.className = 'app-root'; body.appendChild(root); }
  return { document, root, documentListeners };
}

module.exports = { createStartElement, createStartDocument };
