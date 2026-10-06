import { SCHEMA_MODES } from './state.js';
import { getSettingsForCourse } from './course-settings.js';
import { listAssessmentsForCourse } from './assessments.js';
import { resolveQualificationPhase } from './courses.js';

export function resolveSchoolYearBoundaries(date, course, settings) {
  if (!date || typeof date.getTime !== 'function' || isNaN(date.getTime())) return null;
  const schemaMode = (course && course.schemaMode) || SCHEMA_MODES.GRADES;
  const level = schemaMode === SCHEMA_MODES.UPPERSEC ? 'seckII' : 'seckI';
  const defaults = {
    schoolYearStartYear: 2000,
    schoolYearStartMonth: 9, schoolYearStartDay: 8,
    h1EndYear: 2001, h1EndMonth: 1, h1EndDay: 30,
    h2StartYear: 2001, h2StartMonth: 2, h2StartDay: 9
  };
  const globalHalfYearSettings = settings && settings.halfYearSettings
    ? (settings.halfYearSettings[level] || settings.halfYearSettings.seckI)
    : null;
  const snapshotTermCutoffSource = course && course.archivedAt && course.archiveSnapshot &&
    typeof course.archiveSnapshot === 'object'
    ? course.archiveSnapshot.termCutoffSource
    : null;
  const snapshotTermCutoffs = course && course.archivedAt && course.archiveSnapshot &&
    typeof course.archiveSnapshot === 'object' && course.archiveSnapshot.termCutoffs &&
    typeof course.archiveSnapshot.termCutoffs === 'object' &&
    (snapshotTermCutoffSource === 'course' ||
      (snapshotTermCutoffSource == null && course && course.termCutoffs && typeof course.termCutoffs === 'object'))
    ? course.archiveSnapshot.termCutoffs
    : null;
  const courseTermCutoffs = course && course.termCutoffs && typeof course.termCutoffs === 'object'
    ? course.termCutoffs
    : null;
  const specificTermCutoffs = snapshotTermCutoffs || courseTermCutoffs;
  const suppliedHalfYearSettings = globalHalfYearSettings || (settings && settings.termCutoffs) || {};
  const halfYearSettings = {
    ...defaults,
    ...suppliedHalfYearSettings
  };
  const overridden = new Set();
  if (specificTermCutoffs) {
    ['h1EndMonth', 'h1EndDay', 'h2StartMonth', 'h2StartDay'].forEach(function (key) {
      const value = Number(specificTermCutoffs[key]);
      if (Number.isFinite(value) && value > 0) {
        halfYearSettings[key] = value;
        overridden.add(key.startsWith('h1') ? 'h1End' : 'h2Start');
      }
    });
  }
  const schoolYearStartMonth = halfYearSettings.schoolYearStartMonth || 9;
  const schoolYearStartDay = halfYearSettings.schoolYearStartDay || 8;
  let schoolYearStartYear = date.getFullYear();
  if (date.getMonth() + 1 < schoolYearStartMonth ||
      (date.getMonth() + 1 === schoolYearStartMonth && date.getDate() < schoolYearStartDay)) {
    schoolYearStartYear--;
  }

  function hasSuppliedYear(key) {
    if (!Object.prototype.hasOwnProperty.call(suppliedHalfYearSettings, key)) return false;
    const value = suppliedHalfYearSettings[key];
    return value !== null && value !== '' && Number.isFinite(Number(value));
  }
  const configuredStartYear = Number(suppliedHalfYearSettings.schoolYearStartYear);
  function resolveBoundaryYear(prefix, fallbackOffset) {
    const month = Number(halfYearSettings[prefix + 'Month']);
    const day = Number(halfYearSettings[prefix + 'Day']);
    if (overridden.has(prefix)) {
      const belongsToStartYear = month > schoolYearStartMonth ||
        (month === schoolYearStartMonth && day >= schoolYearStartDay);
      return schoolYearStartYear + (belongsToStartYear ? 0 : 1);
    }
    const boundaryYearKey = prefix + 'Year';
    const configuredBoundaryYear = Number(suppliedHalfYearSettings[boundaryYearKey]);
    const offset = hasSuppliedYear('schoolYearStartYear') && hasSuppliedYear(boundaryYearKey) &&
      Number.isFinite(configuredStartYear) && Number.isFinite(configuredBoundaryYear)
      ? configuredBoundaryYear - configuredStartYear
      : fallbackOffset;
    return schoolYearStartYear + offset;
  }

  const schoolYearStart = new Date(schoolYearStartYear, schoolYearStartMonth - 1, schoolYearStartDay);
  const h1End = new Date(
    resolveBoundaryYear('h1End', 1),
    (Number(halfYearSettings.h1EndMonth) || 1) - 1,
    Number(halfYearSettings.h1EndDay) || 30,
    23, 59, 59
  );
  const h2Start = new Date(
    resolveBoundaryYear('h2Start', 1),
    (Number(halfYearSettings.h2StartMonth) || 2) - 1,
    Number(halfYearSettings.h2StartDay) || 9
  );
  return { schoolYearStartYear, schoolYearStart, h1End, h2Start };
}

export function parseAssessmentDateValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const date = new Date(0);
      date.setFullYear(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      return date;
    }
    const date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function resolveAssessmentTermFromDateValue(date, course, settings) {
  const boundaries = resolveSchoolYearBoundaries(date, course, settings);
  if (!boundaries) return null;
  return `${boundaries.schoolYearStartYear}-${date >= boundaries.h2Start ? 'H2' : 'H1'}`;
}

export function resolveAssessmentTermsForResult(course, selectedTerm) {
  const match = /^(\d{4})-H([12])$/.exec(String(selectedTerm || ''));
  if (!match) return [];
  if (course && course.schemaMode === SCHEMA_MODES.UPPERSEC) {
    return [selectedTerm];
  }
  if (match[2] === '2') {
    return [selectedTerm, `${match[1]}-H1`];
  }
  return [selectedTerm];
}

export function isSchoolYearResultTerm(course, selectedTerm) {
  return !!course && course.schemaMode !== SCHEMA_MODES.UPPERSEC &&
    resolveAssessmentTermsForResult(course, selectedTerm).length > 1;
}

export function formatCourseTermLabel(term, course, settings, options = {}) {
  const match = /^(\d{4})-H([12])$/.exec(String(term || ''));
  if (!match) return term || '';
  const startYear = Number(match[1]);
  const level = course && course.schemaMode === SCHEMA_MODES.UPPERSEC ? 'seckII' : 'seckI';
  const snapshot = course && course.archivedAt && course.archiveSnapshot &&
    typeof course.archiveSnapshot === 'object' ? course.archiveSnapshot : null;
  const contextCourse = snapshot && snapshot.upperSecContext
    ? { ...course, upperSecContext: snapshot.upperSecContext }
    : course;
  const qualificationPhase = level === 'seckII'
    ? resolveQualificationPhase(contextCourse, term)
    : null;
  const halfKey = match[2] === '1' ? 'h1' : 'h2';
  const configuredNames = settings && settings.halfYearNames && settings.halfYearNames[level];
  const fallback = level === 'seckII'
    ? (halfKey === 'h1' ? 'Q1' : 'Q2')
    : (halfKey === 'h1' ? 'H1' : 'H2');
  const termName = qualificationPhase ||
    (configuredNames && configuredNames[halfKey]) || fallback;
  const startLabel = options.fullStartYear ? String(startYear) : String(startYear).slice(-2);
  return startLabel + '/' + String(startYear + 1).slice(-2) + ' ' + termName;
}

export function resolveGradingResultScope(course, state, selectedTerm, now) {
  const allAssessments = listAssessmentsForCourse(state, course.id) || [];
  const settings = getSettingsForCourse(course, state);

  function inferTerm(a) {
    if (!a) return null;
    if (a.term) return a.term;
    if (a.date) {
      const d = parseAssessmentDateValue(a.date);
      if (d) return resolveAssessmentTermFromDateValue(d, course, settings);
    }
    return null;
  }

  function parseTermNum(t) {
    if (!t) return null;
    const m = /^(\d{4})-H([12])$/.exec(t);
    if (!m) return null;
    return parseInt(m[1], 10) * 10 + parseInt(m[2], 10);
  }

  // Archivierte Kurse werden relativ zu ihrem letzten gespeicherten
  // Halbjahr ausgewertet. Das heutige Datum darf historische Leistungen
  // nicht aus der Gesamtnote herausfiltern.
  let currentTerm = /^\d{4}-H[12]$/.test(String(selectedTerm || '')) ? selectedTerm : null;
  if (!currentTerm && course && course.archivedAt) {
    const found = allAssessments.map(a => inferTerm(a)).filter(Boolean);
    let bestNum = -Infinity;
    for (const term of found) {
      const termNum = parseTermNum(term);
      if (termNum !== null && termNum > bestNum) {
        bestNum = termNum;
        currentTerm = term;
      }
    }
  }

  // Aktive Kurse verwenden weiterhin das heutige schuljahrbewusste
  // Halbjahr. Für unvollständige Altarchive bleibt dies der Fallback.
  if (!currentTerm) {
    const currentDate = now();
    const boundaries = resolveSchoolYearBoundaries(currentDate, course, settings);
    if (boundaries) {
      currentTerm = `${boundaries.schoolYearStartYear}-${currentDate >= boundaries.h2Start ? 'H2' : 'H1'}`;
    }
  }
  // Fallback: falls keine Einstellungen → aus vorhandenen Leistungen ableiten
  if (!currentTerm) {
    const found = allAssessments.map(a => inferTerm(a)).filter(Boolean);
    if (found.length > 0) {
      let best = null;
      let bestNum = -Infinity;
      for (const t of found) {
        const n = parseTermNum(t);
        if (n !== null && n > bestNum) {
          bestNum = n;
          best = t;
        }
      }
      currentTerm = best;
    }
  }
  const includedTerms = new Set(resolveAssessmentTermsForResult(course, currentTerm));
  const previousTerm = Array.from(includedTerms).find(term => term !== currentTerm) || null;

  // Sek II wird je Kurshalbjahr getrennt berechnet. Sek I verwendet in
  // H2 alle Einzelbewertungen des laufenden Schuljahres (H1 und H2).
  const assessmentTerms = new Map();
  const assessments = allAssessments.filter(a => {
    const at = inferTerm(a) || currentTerm;
    assessmentTerms.set(a, at);
    return includedTerms.has(at);
  });

  return {
    allAssessments,
    assessments,
    assessmentTerms,
    currentTerm,
    includedTerms,
    previousTerm,
    settings
  };
}
