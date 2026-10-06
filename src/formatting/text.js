export function compareText(left, right, { locale = 'de' } = {}) {
  return String(left ?? '').localeCompare(String(right ?? ''), locale);
}
