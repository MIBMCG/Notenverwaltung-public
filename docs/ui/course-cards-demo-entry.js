import { mountCourseCards } from '../../src/ui/course-cards.js';

const sharedCourse = Object.freeze({
  id: 'bio-demo-10a',
  name: 'Biologie',
  subject: 'Biologie',
  classLabel: '10a',
  studentCount: 24,
  termLabel: '26/27 H1'
});

const longNameCourse = Object.freeze({
  ...sharedCourse,
  id: 'bio-demo-langer-name',
  name: 'Biologie: Genregulation, Proteinbiosynthese und nachhaltige Landwirtschaft im Wandel'
});

const families = Object.freeze([
  ['modern', 'Modern ruhig'],
  ['classic', 'Klassisch'],
  ['aurora', 'Aurora']
]);

function appendText(document, parent, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function createExample(document, root, { title, description, role, status }) {
  const section = document.createElement('section');
  section.setAttribute('class', 'nv-course-demo__example');
  appendText(document, section, 'h2', title);
  appendText(document, section, 'p', description);
  appendText(document, section, 'p', `Rolle: ${role}. Status: ${status}.`);
  const host = document.createElement('div');
  host.setAttribute('class', 'nv-course-demo__host');
  section.appendChild(host);
  root.appendChild(section);
  return host;
}

function startDemo() {
  const document = globalThis.document;
  const root = document.getElementById('course-cards-demo');
  if (!root) return;

  appendText(document, root, 'h1', 'Kurskarten: Offline-Demo');
  appendText(document, root, 'p', 'Fiktive Vorschau ohne Speicherzugriff, Netzwerkzugriff oder echte Schuldaten.');

  const appearanceLabel = document.createElement('label');
  appearanceLabel.setAttribute('for', 'course-cards-demo-appearance');
  appearanceLabel.textContent = 'Erscheinung';
  root.appendChild(appearanceLabel);
  const appearance = document.createElement('select');
  appearance.setAttribute('id', 'course-cards-demo-appearance');
  appearance.setAttribute('data-role', 'appearance');
  for (const [value, label] of [['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'System']]) {
    const option = document.createElement('option');
    option.setAttribute('value', value);
    option.textContent = label;
    appearance.appendChild(option);
  }
  appearance.value = 'system';
  root.appendChild(appearance);

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('data-role', 'status');
  status.textContent = 'Status: Demo bereit. Keine echten Daten.';
  root.appendChild(status);

  const mounts = [];
  for (const [family, title] of families) {
    const host = createExample(document, root, {
      title,
      description: 'Gleicher fiktiver Kurs für den Vergleich der Designfamilien.',
      role: 'Kurskarten-Vorschau',
      status: 'aktiver fiktiver Kurs'
    });
    mounts.push({ host, idPrefix: `demo-${family}`, courses: [sharedCourse], family });
  }
  mounts.push({
    host: createExample(document, root, {
      title: 'Testbeispiel: leerer Bestand',
      description: 'Getrennter Fall ohne fiktive Kurskarte.',
      role: 'Leerzustand',
      status: 'keine Kurse'
    }),
    idPrefix: 'demo-empty',
    courses: [],
    family: 'modern'
  });
  mounts.push({
    host: createExample(document, root, {
      title: 'Testbeispiel: langer Kursname',
      description: 'Getrennter Fall für umbrechenden, fiktiven Kursnamen.',
      role: 'Kurskarten-Vorschau',
      status: 'langer fiktiver Kursname'
    }),
    idPrefix: 'demo-long-name',
    courses: [longNameCourse],
    family: 'modern'
  });

  let mounted = [];
  const remount = () => {
    mounted.forEach(instance => instance.dispose());
    mounted = mounts.map(({ host, idPrefix, courses, family }) => mountCourseCards({
      host,
      idPrefix,
      courses,
      family,
      appearance: appearance.value,
      onOpenCourse: id => {
        status.textContent = `Vorschau: Notentabelle für ${id}. Keine echten Daten.`;
      }
    }));
  };

  appearance.addEventListener('change', remount);
  remount();
}

startDemo();
