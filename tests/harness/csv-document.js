'use strict';

function createCsvDocumentStub() {
  function createElement(tagName) {
    return {
      tagName: String(tagName || '').toUpperCase(),
      style: {},
      children: [],
      disabled: false,
      textContent: '',
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter(item => item !== child); },
      _listeners: new Map(),
      addEventListener(type, listener) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(listener);
      },
      async click() {
        if (this.disabled) return;
        for (const listener of this._listeners.get('click') || []) await listener({ target: this });
      }
    };
  }
  const body = createElement('body');
  function findById(element, id) {
    if (!element) return null;
    if (element.id === id) return element;
    for (const child of element.children || []) {
      const match = findById(child, id);
      if (match) return match;
    }
    return null;
  }
  return { body, createElement, getElementById(id) { return findById(body, id); } };
}

function collectCsvElementText(element) {
  if (!element) return '';
  return [element.textContent || '', ...(element.children || []).map(collectCsvElementText)]
    .filter(Boolean)
    .join('\n');
}

module.exports = { createCsvDocumentStub, collectCsvElementText };
