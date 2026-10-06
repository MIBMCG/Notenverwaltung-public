import { appendCourseSymbol } from './course-symbol-picker.js';

const FAMILIES = new Set(['modern', 'classic', 'aurora']);
const APPEARANCES = new Set(['light', 'dark', 'system']);
const COLOR_CHOICES = new Set(['standard', 'blue', 'green', 'petrol', 'violet', 'amber']);
const MOTION_CHOICES = new Set(['off', 'calm', 'vivid']);

function textOrDash(value) {
  return value === undefined || value === null || value === '' ? '–' : String(value);
}

function validateOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Optionen fehlen.');
  const {
    host,
    idPrefix,
    courses,
    onOpenCourse,
    onEditCourse,
    family = 'modern',
    appearance = 'system',
    accent = 'standard',
    background = 'standard',
    motion = 'calm',
    schedule = setTimeout,
    cancel = clearTimeout
  } = options;

  if (!host || !host.ownerDocument || typeof host.ownerDocument.createElement !== 'function' || typeof host.appendChild !== 'function') {
    throw new TypeError('Ein DOM-Host wird benoetigt.');
  }
  if (typeof onOpenCourse !== 'function') throw new TypeError('onOpenCourse muss eine Funktion sein.');
  if (onEditCourse !== undefined && typeof onEditCourse !== 'function') {
    throw new TypeError('onEditCourse muss eine Funktion sein.');
  }
  if (typeof idPrefix !== 'string' || idPrefix.length === 0) throw new TypeError('idPrefix darf nicht leer sein.');
  if (!Array.isArray(courses)) throw new TypeError('courses muss ein Array sein.');
  if (!FAMILIES.has(family)) throw new TypeError('Unbekannte Designfamilie.');
  if (!APPEARANCES.has(appearance)) throw new TypeError('Unbekannte Darstellung.');
  if (!COLOR_CHOICES.has(accent) || !COLOR_CHOICES.has(background)) throw new TypeError('Unbekannte Farbwahl.');
  if (!MOTION_CHOICES.has(motion)) throw new TypeError('Unbekannte Bewegung.');
  if (typeof schedule !== 'function' || typeof cancel !== 'function') throw new TypeError('Timerfunktionen muessen Funktionen sein.');

  const ids = new Set();
  courses.forEach(course => {
    if (!course || typeof course !== 'object' || typeof course.id !== 'string' || course.id.length === 0) {
      throw new TypeError('Jeder Kurs braucht eine ID.');
    }
    if (ids.has(course.id)) throw new TypeError('Kurs-IDs muessen eindeutig sein.');
    ids.add(course.id);
    if (!Number.isInteger(course.studentCount) || course.studentCount < 0) {
      throw new TypeError('studentCount muss eine nicht-negative ganze Zahl sein.');
    }
  });

  return { host, idPrefix, courses, onOpenCourse, onEditCourse, family, appearance, accent, background, motion, schedule, cancel };
}

function appendTextElement(document, parent, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendLineIcon(document, parent, pathData) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  parent.appendChild(svg);
  return svg;
}

function addInfoLine(document, list, label, value) {
  appendTextElement(document, list, 'dt', label);
  appendTextElement(document, list, 'dd', value);
}

export function mountCourseCards(options) {
  const { host, idPrefix, courses, onOpenCourse, onEditCourse, family, appearance, accent, background, motion, schedule, cancel } = validateOptions(options);
  const document = host.ownerDocument;
  const root = document.createElement('section');
  root.setAttribute('class', 'nv-course-cards');
  root.setAttribute('data-family', family);
  root.setAttribute('data-appearance', appearance);
  root.setAttribute('data-accent', accent);
  root.setAttribute('data-background', background);
  root.setAttribute('data-motion', motion);
  root.setAttribute('aria-label', 'Kurse');
  const grid = document.createElement('div');
  grid.setAttribute('class', 'nv-course-cards__grid');
  root.appendChild(grid);

  const cleanups = [];
  const states = [];
  let componentDisposed = false;
  let currentFamily = family;
  let currentMotion = motion;
  const activeCourses = courses.filter(course => course.archivedAt == null);

  function listen(element, type, listener) {
    element.addEventListener(type, listener);
    cleanups.push(() => element.removeEventListener(type, listener));
  }

  function clearTimer(state) {
    if (state.timer !== null) {
      cancel(state.timer);
      state.timer = null;
    }
  }

  activeCourses.forEach((course, index) => {
    const card = document.createElement('article');
    const infoId = `${idPrefix}-course-info-${index}`;
    card.setAttribute('class', 'nv-course-cards__card');
    card.setAttribute('data-role', 'card');
    card.setAttribute('data-course-id', course.id);

    const stage = document.createElement('div');
    stage.setAttribute('class', 'nv-course-cards__stage');
    const rotor = document.createElement('div');
    rotor.setAttribute('class', 'nv-course-cards__rotor');
    const front = document.createElement('div');
    front.setAttribute('class', 'nv-course-cards__face nv-course-cards__front');
    front.setAttribute('data-role', 'front');
    const top = document.createElement('div');
    top.setAttribute('class', 'nv-course-cards__top');
    const symbol = document.createElement('span');
    symbol.setAttribute('class', 'nv-course-cards__symbol');
    symbol.setAttribute('aria-hidden', 'true');
    appendCourseSymbol(document, symbol, course);
    top.appendChild(symbol);
    appendTextElement(document, top, 'span', 'AKTIVER KURS').setAttribute('class', 'nv-course-cards__eyebrow');
    front.appendChild(top);
    const title = document.createElement('div');
    title.setAttribute('class', 'nv-course-cards__title');
    appendTextElement(document, title, 'h3', textOrDash(course.name));
    appendTextElement(document, title, 'p', textOrDash(course.classLabel));
    front.appendChild(title);
    const metadata = document.createElement('div');
    metadata.setAttribute('class', 'nv-course-cards__metadata');
    metadata.setAttribute('data-role', 'metadata');
    appendTextElement(document, metadata, 'span', textOrDash(course.termLabel));
    appendTextElement(document, metadata, 'span', `${course.studentCount} Schüler`);
    front.appendChild(metadata);

    const back = document.createElement('div');
    back.setAttribute('class', 'nv-course-cards__face nv-course-cards__back');
    back.setAttribute('data-role', 'back');
    back.setAttribute('id', infoId);
    const backTop = document.createElement('div');
    backTop.setAttribute('class', 'nv-course-cards__top');
    appendTextElement(document, backTop, 'span', 'KURSINFORMATION').setAttribute('class', 'nv-course-cards__eyebrow');
    const infoSymbol = document.createElement('span');
    infoSymbol.setAttribute('class', 'nv-course-cards__back-symbol');
    appendLineIcon(document, infoSymbol, 'M12 17v-6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z');
    backTop.appendChild(infoSymbol);
    back.appendChild(backTop);
    const details = document.createElement('dl');
    addInfoLine(document, details, 'Fach', textOrDash(course.subject));
    addInfoLine(document, details, 'Klasse', textOrDash(course.classLabel));
    addInfoLine(document, details, 'Schüler', String(course.studentCount));
    addInfoLine(document, details, 'Halbjahr', textOrDash(course.termLabel));
    back.appendChild(details);
    rotor.appendChild(front);
    rotor.appendChild(back);
    stage.appendChild(rotor);

    const footer = document.createElement('footer');
    footer.setAttribute('class', 'nv-course-cards__actions');
    const open = document.createElement('button');
    open.setAttribute('type', 'button');
    open.setAttribute('class', 'nv-course-cards__open');
    open.setAttribute('data-role', 'open');
    open.textContent = 'Noten öffnen';
    const info = document.createElement('button');
    info.setAttribute('type', 'button');
    info.setAttribute('class', 'nv-course-cards__info');
    info.setAttribute('data-role', 'info');
    info.setAttribute('aria-controls', infoId);
    footer.appendChild(open);
    footer.appendChild(info);
    let edit = null;
    if (onEditCourse) {
      edit = document.createElement('button');
      edit.setAttribute('type', 'button');
      edit.setAttribute('class', 'nv-course-cards__edit');
      edit.setAttribute('data-role', 'edit');
      edit.textContent = 'Kurs bearbeiten';
      footer.appendChild(edit);
    }
    card.appendChild(stage);
    card.appendChild(footer);
    grid.appendChild(card);

    const state = { pinned: false, hover: false, dismissed: false, disposed: false, timer: null };
    const render = () => {
      if (state.disposed || componentDisposed) return;
      const openInfo = state.pinned || (state.hover && !state.dismissed);
      card.classList.toggle('is-open', openInfo);
      front.setAttribute('aria-hidden', String(openInfo));
      back.setAttribute('aria-hidden', String(!openInfo));
      info.setAttribute('aria-expanded', String(openInfo));
      info.textContent = state.pinned ? '×' : 'Info';
      info.classList.toggle('is-close', state.pinned);
      info.setAttribute('aria-label', state.pinned
        ? 'Kursinfo schließen'
        : 'Kursinfo anzeigen und offen halten');
    };
    const previewMotion = () => {
      if (state.disposed || componentDisposed || state.pinned || currentFamily === 'classic' || currentMotion === 'off') return false;
      clearTimer(state);
      state.hover = true;
      state.dismissed = false;
      render();
      state.timer = schedule(() => {
        state.timer = null;
        if (state.disposed || componentDisposed || state.pinned) return;
        state.hover = false;
        render();
      }, currentMotion === 'vivid' ? 2200 : 1200);
      return true;
    };
    states.push({ state, render, previewMotion });

    listen(card, 'pointerenter', event => {
      if (state.disposed || componentDisposed || event.pointerType !== 'mouse' || currentFamily === 'classic' || currentMotion === 'off') return;
      clearTimer(state);
      const hoverDelay = currentMotion === 'vivid' ? 140 : 220;
      state.timer = schedule(() => {
        state.timer = null;
        if (state.disposed || componentDisposed) return;
        state.hover = true;
        render();
      }, hoverDelay);
    });
    listen(card, 'pointerleave', () => {
      if (state.disposed || componentDisposed) return;
      clearTimer(state);
      state.hover = false;
      state.dismissed = false;
      render();
    });
    listen(info, 'click', () => {
      if (state.disposed || componentDisposed) return;
      clearTimer(state);
      state.pinned = !state.pinned;
      state.dismissed = !state.pinned;
      render();
    });
    listen(card, 'keydown', event => {
      if (state.disposed || componentDisposed || event.key !== 'Escape') return;
      clearTimer(state);
      state.pinned = false;
      state.dismissed = true;
      render();
    });
    listen(open, 'click', () => {
      if (!state.disposed && !componentDisposed) onOpenCourse(course.id);
    });
    if (edit) {
      listen(edit, 'click', () => {
        if (!state.disposed && !componentDisposed) onEditCourse(course.id);
      });
    }
    render();
  });

  host.appendChild(root);

  return {
    previewMotion() {
      if (componentDisposed) return false;
      return states.map(({ previewMotion }) => previewMotion()).some(Boolean);
    },
    updateAppearance(next) {
      if (componentDisposed || !next || typeof next !== 'object') return;
      if (next.family !== undefined) {
        if (!FAMILIES.has(next.family)) throw new TypeError('Unbekannte Designfamilie.');
        const switchedToClassic = currentFamily !== 'classic' && next.family === 'classic';
        currentFamily = next.family;
        root.setAttribute('data-family', next.family);
        if (switchedToClassic) {
          states.forEach(({ state, render }) => {
            clearTimer(state);
            state.hover = false;
            state.dismissed = false;
            render();
          });
        }
      }
      if (next.motion !== undefined) {
        if (!MOTION_CHOICES.has(next.motion)) throw new TypeError('Unbekannte Bewegung.');
        currentMotion = next.motion;
        root.setAttribute('data-motion', next.motion);
        states.forEach(({ state, render }) => {
          clearTimer(state);
          state.hover = false;
          state.dismissed = false;
          render();
        });
      }
      if (next.appearance !== undefined) {
        if (!APPEARANCES.has(next.appearance)) throw new TypeError('Unbekannte Darstellung.');
        root.setAttribute('data-appearance', next.appearance);
      }
      if (next.accent !== undefined) {
        if (!COLOR_CHOICES.has(next.accent)) throw new TypeError('Unbekannte Farbwahl.');
        root.setAttribute('data-accent', next.accent);
      }
      if (next.background !== undefined) {
        if (!COLOR_CHOICES.has(next.background)) throw new TypeError('Unbekannte Farbwahl.');
        root.setAttribute('data-background', next.background);
      }
    },
    dispose() {
      if (componentDisposed) return;
      componentDisposed = true;
      states.forEach(({ state }) => {
        state.disposed = true;
        clearTimer(state);
      });
      cleanups.splice(0).forEach(cleanup => cleanup());
      if (root.parentNode === host) host.removeChild(root);
    }
  };
}
