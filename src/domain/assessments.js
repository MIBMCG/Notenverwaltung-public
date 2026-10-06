import { SCHEMA_MODES, SCORE_STATUS, generateId, findById } from './state.js';

export function createCategory({ id = null, name, active = true, subcategories = [] }) {
  return {
    id: id || generateId("cat"),
    name: name ?? "",
    active: !!active,
    subcategories: Array.isArray(subcategories) ? subcategories : []
  };
}

export function getDefaultSubcategoryWeight(category) {
  const subcategories = category && Array.isArray(category.subcategories)
    ? category.subcategories
    : [];
  return subcategories.length === 0 ? 100 : 0;
}

export function createWeightTemplate({ id = null, name, items }) {
  return {
    id: id || generateId("wt"),
    name: name ?? "",
    items: Array.isArray(items) ? items.map(item => ({
      categoryId: item.categoryId,
      weightPercent: Number(item.weightPercent) || 0
    })) : []
  };
}

export function createScoreEntry({
  valueRaw = null,
  status = SCORE_STATUS.VALID,
  valueNumeric = null
} = {}) {
  return { valueRaw, status, valueNumeric };
}

export function createAssessment({
  id = null,
  courseId,
  categoryId,
  subcategoryId = null,
  title,
  date = null,
  term = null,
  termAssignment,
  maxPoints = null,
  weight = 1,
  visible = true
}) {
  const parsedWeight = weight === null || (typeof weight === "string" && weight.trim() === "")
    ? NaN
    : Number(weight);
  const assessment = {
    id: id || generateId("asm"),
    courseId,
    categoryId,
    subcategoryId: subcategoryId || null,
    title: title ?? "",
    date,
    term: term || null,
    maxPoints: maxPoints !== undefined && maxPoints !== null ? Number(maxPoints) : null,
    weight: Number.isFinite(parsedWeight) ? parsedWeight : 1,
    visible: visible !== false,
    scores: {}
  };
  if (termAssignment === 'auto' || termAssignment === 'manual') {
    assessment.termAssignment = termAssignment;
  }
  return assessment;
}

export function isCanonicalTerm(term) {
  return /^\d{4}-H[12]$/.test(String(term || ''));
}

export function normalizeAssessmentTerm(term) {
  if (term === undefined || term === null || String(term).trim() === '') return null;
  const normalized = String(term).trim().toUpperCase();
  return isCanonicalTerm(normalized) ? normalized : null;
}

export function getTermResult(course, studentId, term) {
  const item = ((course && course.termResults) || []).find(result =>
    result.studentId === studentId && result.term === term
  );
  return item && Number.isInteger(item.points) ? item.points : null;
}

export function setTermResult(state, courseId, studentId, term, pointsOrNull) {
  const course = findById(state.courses, courseId);
  if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC || course.archivedAt) {
    throw new Error('Festsetzungen sind nur in aktiven Sek-II-Kursen erlaubt.');
  }
  if (!findById(state.students, studentId)) throw new Error('Unbekannte Person.');
  if (!(course.enrollments || []).some(enrollment => enrollment.studentId === studentId)) {
    throw new Error('Die Person ist nicht in diesem Kurs eingeschrieben.');
  }
  if (!isCanonicalTerm(term)) throw new Error('Ungueltiges Halbjahr.');
  if (pointsOrNull !== null && (!Number.isInteger(pointsOrNull) || pointsOrNull < 0 || pointsOrNull > 15)) {
    throw new Error('Die festgesetzte Punktzahl muss ganzzahlig zwischen 0 und 15 liegen.');
  }
  if (!Array.isArray(course.termResults)) course.termResults = [];
  const index = course.termResults.findIndex(result => result.studentId === studentId && result.term === term);
  if (pointsOrNull === null) {
    if (index >= 0) course.termResults.splice(index, 1);
    return null;
  }
  const next = { studentId, term, points: pointsOrNull };
  if (index >= 0) course.termResults[index] = next;
  else course.termResults.push(next);
  return pointsOrNull;
}

export function findAssessmentById(state, assessmentId) {
  return findById(state.assessments, assessmentId);
}

export function listAssessmentsForCourse(state, courseId) {
  return state.assessments.filter(a => a.courseId === courseId);
}

export function addAssessmentToState(state, assessment) {
  state.assessments.push(assessment);
}
