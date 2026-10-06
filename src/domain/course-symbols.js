// Stable IDs are the only symbol data stored in a course or backup.
export const COURSE_SYMBOLS = Object.freeze([
  { id: 'course', label: 'Kurs · Allgemein', path: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16M8 14h3M8 17h7' },
  { id: 'leaf', label: 'Blatt · Biologie', path: 'M20 4c-8 0-14 4-14 11 0 3 2 5 5 5 7 0 9-8 9-16zM5 21c3-5 7-8 12-11' },
  { id: 'globe', label: 'Globus · Geografie', path: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18' },
  { id: 'book', label: 'Buch · Sprachen', path: 'M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1v14' },
  { id: 'math', label: 'Rechenzeichen · Mathematik', path: 'M5 5h14M7 6l5 6-5 6h12' },
  { id: 'atom', label: 'Atom · Physik', path: 'M21 12c0 2-4 4-9 4s-9-2-9-4 4-4 9-4 9 2 9 4M16 4c2 1 2 6-1 10s-6 7-8 6-2-6 1-10 6-7 8-6M8 4c2-1 5 2 8 6s3 9 1 10-5-2-8-6-3-9-1-10M12 12h.01' },
  { id: 'flask', label: 'Kolben · Chemie', path: 'M9 3h6M10 3v7l-6 9c-1 1 0 2 1 2h14c1 0 2-1 1-2l-6-9V3M7 15h10' },
  { id: 'music', label: 'Note · Musik', path: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 4-6 4-6 1s6-4 6-1M20 16c0 4-6 4-6 1s6-4 6-1' },
  { id: 'sport', label: 'Ball · Sport', path: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3v18M6 5c7 5 7 9 0 14M18 5c-7 5-7 9 0 14' },
  { id: 'art', label: 'Palette · Kunst', path: 'M12 3a9 9 0 1 0 0 18h1c2 0 3-2 1-3-2-2 0-3 2-3h2c5 0 4-12-6-12M7 8h.01M12 6h.01M17 8h.01M6 13h.01' },
  { id: 'code', label: 'Code · Informatik', path: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' },
  { id: 'history', label: 'Säulen · Geschichte', path: 'M3 8l9-5 9 5H3M5 11v7M10 11v7M14 11v7M19 11v7M3 21h18' },
  { id: 'scales', label: 'Waage · Politik / Ethik', path: 'M12 3v18M7 21h10M4 6h16M6 6l-4 8h8L6 6M18 6l-4 8h8l-4-8M2 14c1 4 7 4 8 0M14 14c1 4 7 4 8 0' }
].map(symbol => Object.freeze(symbol)));

export function normalizeCourseSymbol(value) {
  return typeof value === 'string' && COURSE_SYMBOLS.some(symbol => symbol.id === value) ? value : null;
}

export function resolveCourseSymbol(course = {}) {
  const chosen = normalizeCourseSymbol(course.symbolId);
  const subject = String(course.subject || '').trim().toLocaleLowerCase('de');
  const suggestions = [
    [/^(biologie|bio|naturwissenschaften|nawi)\b/, 'leaf'],
    [/^(geografie|geographie|erdkunde|geo)\b/, 'globe'],
    [/^(mathematik|mathe)\b/, 'math'], [/^physik\b/, 'atom'], [/^chemie\b/, 'flask'],
    [/^musik\b/, 'music'], [/^sport\b/, 'sport'], [/^(kunst|bildende kunst)\b/, 'art'],
    [/^(informatik|it)\b/, 'code'], [/^geschichte\b/, 'history'],
    [/^(politik|politische bildung|ethik|philosophie|religion|sozialkunde)\b/, 'scales'],
    [/^(deutsch|englisch|französisch|franzoesisch|spanisch|latein|griechisch|italienisch|russisch|sprachen)\b/, 'book']
  ];
  const id = chosen || (suggestions.find(([pattern]) => pattern.test(subject)) || [null, 'course'])[1];
  return COURSE_SYMBOLS.find(symbol => symbol.id === id);
}
