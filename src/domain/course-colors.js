// Only numeric hue overrides are persisted; absence keeps subject-based colors automatic.
export function normalizeCourseCardHue(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 359
    ? value
    : null;
}

function normalizeSubject(value) {
  return String(value ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

const SUBJECT_HUES = new Map([
  [145, ['biologie', 'bio', 'nawi', 'naturwissenschaften']],
  [215, ['mathematik', 'mathe']],
  [35, ['deutsch']],
  [195, ['englisch']],
  [275, ['französisch', 'franzoesisch']],
  [175, ['chemie']],
  [240, ['physik']],
  [25, ['geschichte']],
  [95, ['geografie', 'geographie', 'erdkunde', 'geo']],
  [15, ['sport']],
  [315, ['musik']],
  [285, ['kunst', 'bildende kunst']],
  [205, ['informatik']],
  [55, ['politik', 'politische bildung', 'sozialkunde', 'ethik', 'religion', 'philosophie', 'wirtschaft', 'wat']],
  [335, ['latein']],
  [5, ['spanisch']],
  [125, ['italienisch']],
  [255, ['russisch']]
].flatMap(([hue, subjects]) => subjects.map(subject => [normalizeSubject(subject), hue])));

export function resolveCourseCardHue(course = {}) {
  const override = normalizeCourseCardHue(course.cardHue);
  if (override !== null) return override;
  const subject = normalizeSubject(course.subject);
  if (!subject) return 210;
  if (SUBJECT_HUES.has(subject)) return SUBJECT_HUES.get(subject);
  // Stable across sessions and devices, independent of IDs, ordering and symbols.
  let hash = 0;
  for (const character of subject) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return hash % 360;
}
