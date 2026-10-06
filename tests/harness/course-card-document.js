'use strict';

function createClassList() {
  const tokens = new Set();
  return {
    add(...names) {
      names.forEach(name => tokens.add(name));
    },
    remove(...names) {
      names.forEach(name => tokens.delete(name));
    },
    contains(name) {
      return tokens.has(name);
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !tokens.has(name) : Boolean(force);
      if (shouldAdd) tokens.add(name);
      else tokens.delete(name);
      return shouldAdd;
    },
    toString() {
      return [...tokens].join(' ');
    }
  };
}

function createCardFixture() {
  const timers = new Map();
  let nextTimerId = 1;

  function createElement(tagName, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    const attributes = new Map();
    const listeners = new Map();
    let ownText = '';
    const element = {
      tagName: String(tagName).toUpperCase(),
      namespaceURI,
      ownerDocument: document,
      children: [],
      parentNode: null,
      classList: createClassList(),
      __listeners: listeners,
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index < 0) throw new Error('Kind ist nicht angehaengt.');
        this.children.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      setAttribute(name, value) {
        attributes.set(String(name), String(value));
      },
      getAttribute(name) {
        const value = attributes.get(String(name));
        return value === undefined ? null : value;
      },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      }
    };
    Object.defineProperty(element, 'textContent', {
      get() {
        return ownText + this.children.map(child => child.textContent).join('');
      },
      set(value) {
        ownText = String(value);
        this.children.splice(0).forEach(child => { child.parentNode = null; });
      }
    });
    return element;
  }

  const document = { createElement, createElementNS(namespaceURI, tagName) { return createElement(tagName, namespaceURI); } };
  document.body = createElement('body');
  const host = createElement('div');

  function walk(element, callback) {
    callback(element);
    element.children.forEach(child => walk(child, callback));
  }

  function find(role, cardIndex = 0) {
    const matches = [];
    walk(host, element => {
      if (element.getAttribute('data-role') === role) matches.push(element);
    });
    return matches[cardIndex] ?? null;
  }

  function dispatch(element, type, details = {}) {
    const event = { type, target: element, currentTarget: element, ...details };
    const listeners = element.__listeners?.get(type);
    if (listeners) [...listeners].forEach(listener => listener.call(element, event));
  }

  function schedule(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  }

  function cancel(id) {
    timers.delete(id);
  }

  function flushTimers() {
    while (timers.size > 0) {
      const ready = [...timers.entries()];
      timers.clear();
      ready.forEach(([, timer]) => timer.callback());
    }
  }

  return {
    host,
    document,
    find,
    dispatch,
    schedule,
    cancel,
    flushTimers,
    get pendingTimers() {
      return timers.size;
    },
    get scheduledDelays() {
      return [...timers.values()].map(timer => timer.delay);
    }
  };
}

function createDemoFixture() {
  const fixture = createCardFixture();
  const root = fixture.document.createElement('main');
  root.setAttribute('id', 'course-cards-demo');
  fixture.document.body.appendChild(root);
  fixture.document.getElementById = id => {
    let found = null;
    (function walk(element) {
      if (element.getAttribute('id') === id) found = element;
      if (!found) element.children.forEach(walk);
    }(fixture.document.body));
    return found;
  };

  function find(role, index = 0) {
    const matches = [];
    (function walk(element) {
      if (element.getAttribute('data-role') === role) matches.push(element);
      element.children.forEach(walk);
    }(fixture.document.body));
    return matches[index] ?? null;
  }

  function findAll(predicate) {
    const matches = [];
    (function walk(element) {
      if (predicate(element)) matches.push(element);
      element.children.forEach(walk);
    }(fixture.document.body));
    return matches;
  }

  return {
    document: fixture.document,
    root,
    find,
    findAll,
    dispatch: fixture.dispatch
  };
}

module.exports = { createCardFixture, createDemoFixture };
