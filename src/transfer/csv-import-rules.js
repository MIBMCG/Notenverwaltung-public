import { SCHEMA_MODES, UPPERSEC_COURSE_TYPES, QUALIFICATION_YEARS } from '../domain/state.js';

export function parseCsvTransferContextFields(fields) {
  const values = Array.isArray(fields) ? fields.map(value => String(value || '').trim()) : [];
  const contextProvided = values.some(Boolean);
  const schemaText = values[0] || '';
  const courseTypeText = values[1] || '';
  const qualificationYearText = values[2] || '';
  const writtenExamText = values[3] || '';
  const issues = [];
  const schemaModes = { 'Sek I': SCHEMA_MODES.GRADES, 'Sek II': SCHEMA_MODES.UPPERSEC };
  const courseTypes = {
    'GK': UPPERSEC_COURSE_TYPES.BASIC,
    'LK': UPPERSEC_COURSE_TYPES.ADVANCED,
    'Sonstiger Kurs': UPPERSEC_COURSE_TYPES.OTHER
  };
  const qualificationYears = {
    'Q1/Q2': QUALIFICATION_YEARS.Q1_Q2,
    'Q3/Q4': QUALIFICATION_YEARS.Q3_Q4
  };
  let schemaMode = SCHEMA_MODES.GRADES;
  if (schemaText) {
    if (!schemaModes[schemaText]) issues.push('Unbekanntes Schema; erlaubt sind Sek I oder Sek II.');
    else schemaMode = schemaModes[schemaText];
  }
  let upperSecContext = null;
  let writtenExamSubjectQ4 = false;
  let writtenExamSubjectQ4Specified = false;
  if (schemaMode === SCHEMA_MODES.UPPERSEC) {
    const legacyContextlessCourse = !courseTypeText && !qualificationYearText && !writtenExamText;
    if (!legacyContextlessCourse) {
      if (!courseTypes[courseTypeText]) issues.push('Für Sek II ist eine gültige Kursart (GK, LK oder Sonstiger Kurs) erforderlich.');
      if (!qualificationYears[qualificationYearText]) issues.push('Für Sek II ist ein gültiger Qualifikationsabschnitt (Q1/Q2 oder Q3/Q4) erforderlich.');
      upperSecContext = {
        courseType: courseTypes[courseTypeText] || null,
        qualificationYear: qualificationYears[qualificationYearText] || null,
        weightingDeviationReason: null
      };
      if (writtenExamText && writtenExamText !== 'Ja' && writtenExamText !== 'Nein') {
        issues.push('Das 3. Pruefungsfach schriftlich muss Ja oder Nein sein.');
      }
      const supportsWrittenExamSubjectQ4 = upperSecContext.courseType === UPPERSEC_COURSE_TYPES.BASIC &&
        upperSecContext.qualificationYear === QUALIFICATION_YEARS.Q3_Q4;
      if (writtenExamText === 'Ja') {
        if (!supportsWrittenExamSubjectQ4) {
          issues.push('Das 3. Pruefungsfach schriftlich ist nur bei einem GK in Q3/Q4 zulässig.');
        } else {
          writtenExamSubjectQ4 = true;
          writtenExamSubjectQ4Specified = true;
        }
      } else if (writtenExamText === 'Nein' && supportsWrittenExamSubjectQ4) {
        writtenExamSubjectQ4Specified = true;
      }
    }
  } else if (courseTypeText || qualificationYearText || writtenExamText) {
    issues.push('Kursart, Qualifikationsabschnitt oder Pruefungsfach dürfen nur für Sek II gesetzt werden.');
  }
  return {
    contextProvided,
    schemaMode,
    upperSecContext,
    writtenExamSubjectQ4,
    writtenExamSubjectQ4Specified,
    issues
  };
}

export function validateCsvCourseContextConsistency(contextByCourseKey, courseKey, parsedContext) {
  const issues = [];
  if (!contextByCourseKey || !courseKey || !parsedContext || parsedContext.contextProvided === false ||
      (parsedContext.issues || []).length > 0) return issues;
  const comparable = {
    schemaMode: parsedContext.schemaMode,
    courseType: parsedContext.upperSecContext ? parsedContext.upperSecContext.courseType : null,
    qualificationYear: parsedContext.upperSecContext ? parsedContext.upperSecContext.qualificationYear : null
  };
  const previous = contextByCourseKey.get(courseKey);
  if (!previous) contextByCourseKey.set(courseKey, comparable);
  else if (JSON.stringify(previous) !== JSON.stringify(comparable)) {
    issues.push('Der Kurskontext weicht von der ersten vollständigen Zeile dieses Kurses ab.');
  }
  return issues;
}

export function csvCourseContextMatches(course, parsedContext) {
  if (course && parsedContext && parsedContext.contextProvided === false) return true;
  if (!course || !parsedContext || course.schemaMode !== parsedContext.schemaMode) return false;
  if (course.schemaMode !== SCHEMA_MODES.UPPERSEC) return true;
  const local = course.upperSecContext || {};
  const incoming = parsedContext.upperSecContext || {};
  return local.courseType === incoming.courseType && local.qualificationYear === incoming.qualificationYear;
}

export function validateCsvStudentIdentity(student, values) {
  if (!student || !values) return ['Die zugeordnete Person ist nicht verfügbar.'];
  const identityFields = [
    { key: 'lastName', label: 'Nachname', normalize: value => String(value || '').trim().toLowerCase() },
    { key: 'firstName', label: 'Vorname', normalize: value => String(value || '').trim().toLowerCase() },
    { key: 'birthDate', label: 'Geburtsdatum', normalize: value => String(value || '').trim() }
  ];
  const conflicts = [];
  for (const field of identityFields) {
    const existing = field.normalize(student[field.key]);
    const incoming = field.normalize(values[field.key]);
    if (existing && incoming && existing !== incoming) conflicts.push(field.label);
  }
  return conflicts;
}

export function findCompatibleCsvStudent(students, values) {
  const matches = (students || []).filter(function (student) {
    return validateCsvStudentIdentity(student, values).length === 0;
  });
  if (matches.length === 1) return { studentId: matches[0].id, ambiguous: false };
  return { studentId: null, ambiguous: matches.length > 1 };
}
