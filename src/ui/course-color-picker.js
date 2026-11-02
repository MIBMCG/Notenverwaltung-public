import { normalizeCourseCardHue, resolveCourseCardHue } from '../domain/course-colors.js';

function describeHue(hue) {
  if (hue < 15 || hue >= 345) return 'Rot';
  if (hue < 45) return 'Orange';
  if (hue < 75) return 'Gelb';
  if (hue < 165) return 'Grün';
  if (hue < 195) return 'Türkis';
  if (hue < 255) return 'Blau';
  if (hue < 285) return 'Violett';
  return 'Pink';
}

export function createCourseColorPicker({ document, id, course = {}, onChange }) {
  const root = document.createElement('div');
  root.className = 'courses-editor-field course-color-picker';
  const label = document.createElement('label');
  label.className = 'courses-editor-label';
  label.textContent = 'Kachelfarbe';
  label.setAttribute('for', id);
  const input = document.createElement('input');
  input.id = id;
  input.type = 'range';
  input.min = '0';
  input.max = '359';
  input.step = '1';
  input.className = 'course-color-picker__range';
  const help = document.createElement('p');
  help.id = `${id}-help`;
  help.className = 'course-color-picker__help';
  help.textContent = 'Die Kachelfarbe folgt automatisch dem Fach. Mit dem Regler wählen Sie einen eigenen Farbton.';
  const status = document.createElement('p');
  status.id = `${id}-status`;
  status.className = 'course-color-picker__status';
  status.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', `${help.id} ${status.id}`);
  const preview = document.createElement('div');
  preview.className = 'course-color-picker__preview';
  const title = document.createElement('strong');
  title.textContent = course.name || 'Kursvorschau';
  const sample = document.createElement('span');
  sample.textContent = 'Beispieltext auf Ihrer Kurskachel';
  preview.appendChild(title);
  preview.appendChild(sample);
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'course-color-picker__reset';
  resetButton.textContent = 'Fachfarbe verwenden';
  let subject = course.subject;
  let cardHue = normalizeCourseCardHue(course.cardHue);
  let pending = false;

  function refresh() {
    const hue = resolveCourseCardHue({ subject, cardHue });
    input.value = String(hue);
    input.setAttribute('aria-valuetext', `${describeHue(hue)}, ${hue} Grad`);
    preview.setAttribute('data-course-hue', String(hue));
    preview.setAttribute('style', `--nv-course-hue: ${hue}`);
    status.textContent = cardHue === null ? 'Automatisch nach Fach' : 'Eigener Farbton';
    input.disabled = pending;
    resetButton.disabled = pending || cardHue === null;
  }

  function readRange() {
    cardHue = input.value.trim() === '' ? null : normalizeCourseCardHue(Number(input.value));
    refresh();
  }

  async function save() {
    const focusedControl = document.activeElement === input || document.activeElement === resetButton
      ? document.activeElement : null;
    pending = true;
    refresh();
    try {
      if (onChange) await onChange(cardHue);
    } finally {
      pending = false;
      refresh();
      if (focusedControl && document.getElementById(id) === input
        && (document.activeElement === document.body || document.activeElement === focusedControl)) {
        (focusedControl.disabled ? input : focusedControl).focus();
      }
    }
  }

  input.addEventListener('input', () => {
    if (!pending) readRange();
  });
  input.addEventListener('change', async () => {
    if (pending) return;
    readRange();
    await save();
  });
  resetButton.addEventListener('click', async () => {
    if (pending || cardHue === null) return;
    cardHue = null;
    await save();
  });
  for (const element of [label, input, help, status, preview, resetButton]) root.appendChild(element);
  refresh();
  return {
    root, input, resetButton,
    updateSubject(nextSubject) { subject = nextSubject; refresh(); },
    setValue(value, nextSubject = subject) { cardHue = normalizeCourseCardHue(value); subject = nextSubject; refresh(); },
    getValue() { return cardHue; }
  };
}
