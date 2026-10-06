import { COURSE_SYMBOLS, normalizeCourseSymbol, resolveCourseSymbol } from '../domain/course-symbols.js';

export function appendCourseSymbol(document, parent, course) {
  const symbol = resolveCourseSymbol(course);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-course-symbol', symbol.id);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', symbol.path);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  parent.appendChild(svg);
}

export function createCourseSymbolPicker({ document, id, course, onChange }) {
  const root = document.createElement('div');
  root.className = 'courses-editor-field course-symbol-picker';
  const label = document.createElement('label');
  label.className = 'courses-editor-label';
  label.textContent = 'Kurssymbol';
  label.setAttribute('for', id);
  const select = document.createElement('select');
  select.id = id;
  for (const option of [{ id: 'auto', label: 'Automatisch nach Fach' }, ...COURSE_SYMBOLS]) {
    const item = document.createElement('option');
    item.value = option.id;
    item.textContent = option.label;
    select.appendChild(item);
  }
  select.value = normalizeCourseSymbol(course.symbolId) || 'auto';
  const preview = document.createElement('div');
  preview.className = 'course-symbol-picker__preview';
  preview.setAttribute('aria-live', 'polite');
  let previewSubject = course.subject;
  function updatePreview(subject = previewSubject) {
    previewSubject = subject;
    preview.textContent = '';
    const candidate = { subject, symbolId: select.value };
    appendCourseSymbol(document, preview, candidate);
    const description = document.createElement('span');
    description.textContent = resolveCourseSymbol(candidate).label;
    preview.appendChild(description);
  }
  select.addEventListener('change', async () => {
    updatePreview();
    if (onChange) await onChange(normalizeCourseSymbol(select.value));
  });
  root.appendChild(label);
  root.appendChild(select);
  root.appendChild(preview);
  updatePreview();
  return { root, select, updatePreview };
}
