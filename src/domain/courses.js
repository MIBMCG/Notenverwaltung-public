import {
  SCHEMA_MODES,
  UPPERSEC_COURSE_TYPES,
  QUALIFICATION_YEARS,
  RECOMMENDED_WEIGHT_TEMPLATE_IDS,
  isKnownWrittenCategory,
  generateId,
  findById
} from './state.js';
import { isCanonicalTerm, listAssessmentsForCourse } from './assessments.js';
import { normalizeCourseSymbol } from './course-symbols.js';
import { normalizeCourseCardHue } from './course-colors.js';

function normalizeWeightingDeviationReason(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1e3) : null;
}

export function normalizeUpperSecContext(schemaMode, value) {
  if (schemaMode !== SCHEMA_MODES.UPPERSEC) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const courseTypes = new Set(Object.values(UPPERSEC_COURSE_TYPES));
  const qualificationYears = new Set(Object.values(QUALIFICATION_YEARS));
  return {
    courseType: courseTypes.has(value.courseType) ? value.courseType : null,
    qualificationYear: qualificationYears.has(value.qualificationYear) ? value.qualificationYear : null,
    weightingDeviationReason: normalizeWeightingDeviationReason(value.weightingDeviationReason)
  };
}

export function createEnrollment({
  studentId,
  subgroup = null,
  homeClassAtEnrollment = null,
  writtenExamSubjectQ4 = false
}) {
  return {
    studentId,
    subgroup,
    homeClassAtEnrollment: homeClassAtEnrollment || null,
    writtenExamSubjectQ4: writtenExamSubjectQ4 === true
  };
}

export function createCourse({
  id = null,
  name,
  subject,
  symbolId = null,
  cardHue = null,
  classLabel,
  schemaMode = SCHEMA_MODES.GRADES,
  weightTemplateId = null,
  includePrevTermGrades = false,
  termCutoffs = null,
  showAttendance = true,
  archivedAt = null,
  archiveReason = null,
  archiveRetentionUntil = null,
  archiveNote = null,
  schoolYearStartYear = null,
  carriedForwardFromCourseId = null,
  archiveSnapshot = null,
  archiveHistory = [],
  importKey = null,
  termResults = [],
  upperSecContext = null
}) {
  return {
    id: id || generateId('course'),
    name: name ?? '',
    subject: subject ?? '',
    ...(normalizeCourseSymbol(symbolId) ? { symbolId: normalizeCourseSymbol(symbolId) } : {}),
    ...(normalizeCourseCardHue(cardHue) !== null ? { cardHue: normalizeCourseCardHue(cardHue) } : {}),
    classLabel: classLabel ?? '',
    schemaMode,
    weightTemplateId,
    includePrevTermGrades: !!includePrevTermGrades,
    termCutoffs,
    showAttendance: showAttendance === false ? false : true,
    archivedAt: archivedAt || null,
    archiveReason: archiveReason || null,
    archiveRetentionUntil: normalizeArchiveRetentionUntil(archiveRetentionUntil),
    archiveNote: normalizeArchiveNote(archiveNote),
    schoolYearStartYear: Number.isInteger(Number(schoolYearStartYear)) ? Number(schoolYearStartYear) : null,
    carriedForwardFromCourseId: carriedForwardFromCourseId || null,
    archiveSnapshot: archiveSnapshot && typeof archiveSnapshot === 'object' ? archiveSnapshot : null,
    archiveHistory: normalizeArchiveHistory(archiveHistory, schemaMode),
    importKey: importKey || null,
    termResults: Array.isArray(termResults) ? termResults.map(item => ({ ...item })) : [],
    upperSecContext: normalizeUpperSecContext(schemaMode, upperSecContext),
    enrollments: []
  };
}

export function findCourseById(state, courseId) {
  return findById(state.courses, courseId);
}

export function listEnrollmentsForCourse(state, courseId) {
  const course = findCourseById(state, courseId);
  return course ? course.enrollments : [];
}

export function findEnrollment(stateOrCourse, courseIdOrStudentId, maybeStudentId) {
  const hasStateShape = stateOrCourse && Array.isArray(stateOrCourse.courses);
  const course = hasStateShape ? findCourseById(stateOrCourse, courseIdOrStudentId) : stateOrCourse;
  const studentId = hasStateShape ? maybeStudentId : courseIdOrStudentId;
  return (course && course.enrollments || []).find(
    enrollment => enrollment && enrollment.studentId === studentId
  ) || null;
}

export function setWrittenExamSubjectQ4(state, courseId, studentId, value) {
  const course = findCourseById(state, courseId);
  if (!course || course.archivedAt) {
    throw new Error('Die Kennzeichnung ist nur in einem aktiven Kurs erlaubt.');
  }
  const context = course.upperSecContext;
  if (course.schemaMode !== SCHEMA_MODES.UPPERSEC || !context || context.courseType !== UPPERSEC_COURSE_TYPES.BASIC || context.qualificationYear !== QUALIFICATION_YEARS.Q3_Q4) {
    throw new Error('Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.');
  }
  if (value !== true && value !== false) {
    throw new Error('Die Kennzeichnung muss Ja oder Nein sein.');
  }
  const enrollment = findEnrollment(course, studentId);
  if (!enrollment) throw new Error('Die Person ist nicht in diesem Kurs eingeschrieben.');
  enrollment.writtenExamSubjectQ4 = value;
  return value;
}

export function resolveQualificationPhase(course, term) {
  if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC || !isCanonicalTerm(term)) return null;
  const context = course.upperSecContext;
  if (!context) return null;
  const half = String(term).endsWith('-H1') ? 1 : 2;
  if (context.qualificationYear === QUALIFICATION_YEARS.Q1_Q2) return half === 1 ? 'Q1' : 'Q2';
  if (context.qualificationYear === QUALIFICATION_YEARS.Q3_Q4) return half === 1 ? 'Q3' : 'Q4';
  return null;
}

export function enrollStudentInCourse(state, courseId, studentId, subgroup = null, homeClassAtEnrollment = null) {
  const course = findCourseById(state, courseId);
  if (!course) return false;
  const already = course.enrollments.some(e => e.studentId === studentId);
  if (!already) {
    const student = findById(state.students, studentId);
    course.enrollments.push(createEnrollment({
      studentId,
      subgroup,
      homeClassAtEnrollment: homeClassAtEnrollment || student && student.homeClass || null
    }));
    return true;
  }
  return false;
}

export function listActiveCourses(state) {
  return (state && Array.isArray(state.courses) ? state.courses : []).filter(c => c && !c.archivedAt);
}

export function listArchivedCourses(state) {
  return (state && Array.isArray(state.courses) ? state.courses : []).filter(c => c && !!c.archivedAt);
}

export function studentHasArchivedCourseReference(state, studentId) {
  if (!state || !studentId) return false;
  return (Array.isArray(state.courses) ? state.courses : []).some(course => {
    if (!course) return false;
    if (course.archivedAt && listReferencedStudentIdsForCourse(state, course.id).has(studentId)) return true;
    return (course.archiveHistory || []).some(historyEntry =>
      ((historyEntry && historyEntry.snapshot && historyEntry.snapshot.enrollments) || [])
        .some(enrollment => enrollment && enrollment.studentId === studentId)
    );
  });
}

export function listReferencedStudentIdsForCourse(state, courseId) {
  const ids = new Set();
  const course = findCourseById(state, courseId);
  for (const enrollment of (course && course.enrollments) || []) if (enrollment && enrollment.studentId) ids.add(enrollment.studentId);
  for (const result of (course && course.termResults) || []) if (result && result.studentId) ids.add(result.studentId);
  const snapshots = [];
  if (course && course.archiveSnapshot && typeof course.archiveSnapshot === 'object') snapshots.push(course.archiveSnapshot);
  for (const historyEntry of (course && course.archiveHistory) || []) {
    if (historyEntry && historyEntry.snapshot && typeof historyEntry.snapshot === 'object') snapshots.push(historyEntry.snapshot);
  }
  for (const snapshot of snapshots) {
    for (const enrollment of snapshot.enrollments || []) {
      if (enrollment && enrollment.studentId) ids.add(enrollment.studentId);
    }
  }
  for (const assessment of listAssessmentsForCourse(state, courseId)) {
    for (const studentId of Object.keys((assessment && assessment.scores) || {})) ids.add(studentId);
  }
  return ids;
}

export function listStudentReportCourses(state, studentId, activeCourseFilterId = null) {
  const activeCourses = listActiveCourses(state).filter(course =>
    (course.enrollments || []).some(enrollment => enrollment && enrollment.studentId === studentId)
  );
  if (activeCourseFilterId) {
    return activeCourses.filter(course => course.id === activeCourseFilterId);
  }
  const archivedCourses = listArchivedCourses(state).filter(course =>
    listReferencedStudentIdsForCourse(state, course.id).has(studentId)
  );
  return activeCourses.concat(archivedCourses);
}

export function resolveUpperSecWrittenCategoryId(settings, course = null) {
  const categories = Array.isArray(settings && settings.categories) ? settings.categories : [];
  const roles = (course && course.archivedAt && course.archiveSnapshot
    ? course.archiveSnapshot.categoryRoles
    : course && course.categoryRoles) || (settings && settings.categoryRoles);
  if (roles && Object.prototype.hasOwnProperty.call(roles, 'upperSecWrittenCategoryId')) {
    return categories.some(category => category.id === roles.upperSecWrittenCategoryId)
      ? roles.upperSecWrittenCategoryId : null;
  }
  // Bei Altbeständen vor der ersten Speicherung der Rolle nur eindeutige Zuordnungen übernehmen.
  const named = categories.filter(isKnownWrittenCategory);
  const templates = Array.isArray(settings && settings.weightTemplates)
    ? settings.weightTemplates
    : [];
  // Die historische 67/33-Vorlage speicherte mündlich und schriftlich in dieser Reihenfolge.
  const legacyRoles = new Set(named.map(category => category.id));
  const categoryIds = new Set(categories.map(category => category.id));
  for (const template of templates) {
    if (!template || !(template.name === 'Standard Sek I (67/33)' ||
        String(template.name || '').startsWith('Altbestand Sek I (67/33)'))) continue;
    const [oral, written] = Array.isArray(template.items) ? template.items : [];
    if (oral && written && oral.categoryId !== written.categoryId &&
        categoryIds.has(oral.categoryId) && categoryIds.has(written.categoryId)) legacyRoles.add(written.categoryId);
  }
  if (legacyRoles.size) return legacyRoles.size === 1 ? legacyRoles.values().next().value : null;
  const oneExam = templates.find(template =>
    template && template.id === RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  const twoExams = templates.find(template =>
    template && template.id === RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
  );
  if (!oneExam || !twoExams || !Array.isArray(oneExam.items) || !Array.isArray(twoExams.items)) return null;
  const candidates = Array.from(new Set(oneExam.items
    .filter(item => item && item.categoryId && Math.abs(Number(item.weightPercent) - 33.33) < 0.001)
    .filter(item => twoExams.items.some(twoExamItem =>
      twoExamItem && twoExamItem.categoryId === item.categoryId &&
      Math.abs(Number(twoExamItem.weightPercent) - 50) < 0.001
    ))
    .map(item => item.categoryId)));
  return candidates.length === 1 && categories.some(category => category.id === candidates[0])
    ? candidates[0] : null;
}

export function createArchiveSnapshot(state, course, now) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  const settings = (state && state.settings) || {};
  const templates = settings.weightTemplates || [];
  const hasCourseTermCutoffs = !!(course && course.termCutoffs && typeof course.termCutoffs === "object");
  const selectedTemplate = course && course.weightTemplateId
    ? templates.find(t => t.id === course.weightTemplateId) || null
    : null;
  const upperSecWrittenCategoryId = resolveUpperSecWrittenCategoryId(settings, course);
  return JSON.parse(JSON.stringify({
    createdAt: now().toISOString(),
    schemaMode: course && course.schemaMode,
    gradeMapping: settings.gradeMapping || {},
    categories: settings.categories || [],
    weightTemplate: selectedTemplate,
    halfYearNames: settings.halfYearNames || {},
    halfYearSettings: settings.halfYearSettings || {},
    termCutoffs: hasCourseTermCutoffs ? course.termCutoffs : null,
    termCutoffSource: hasCourseTermCutoffs ? "course" : "schema",
    upperSecContext: (course && course.upperSecContext) || null,
    enrollments: (course && course.enrollments) || [],
    categoryRoles: { upperSecWrittenCategoryId }
  }));
}

export function planCourseSuccessor(course, targetYear) {
  const normalizedTargetYear = Number(targetYear);
  if (!Number.isInteger(normalizedTargetYear) || normalizedTargetYear < 2000 || normalizedTargetYear > 2200) {
    throw new Error("Das Zieljahr ist ungültig.");
  }
  if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC) {
    return {
      action: "continue",
      targetYear: normalizedTargetYear,
      targetQualificationYear: null,
      requiresWeightingConfirmation: false,
      label: "wird fortgeführt"
    };
  }
  const context = course.upperSecContext;
  if (!context || !context.courseType || !context.qualificationYear) {
    return {
      action: "review",
      targetYear: normalizedTargetYear,
      targetQualificationYear: null,
      requiresWeightingConfirmation: false,
      label: "Kontext prüfen"
    };
  }
  if (context.qualificationYear === QUALIFICATION_YEARS.Q3_Q4) {
    return {
      action: "end",
      targetYear: normalizedTargetYear,
      targetQualificationYear: null,
      requiresWeightingConfirmation: false,
      label: "endet"
    };
  }
  if (context.qualificationYear === QUALIFICATION_YEARS.Q1_Q2) {
    return {
      action: "continue",
      targetYear: normalizedTargetYear,
      targetQualificationYear: QUALIFICATION_YEARS.Q3_Q4,
      requiresWeightingConfirmation: true,
      label: "wird als Q3/Q4 fortgeführt"
    };
  }
  return {
    action: "review",
    targetYear: normalizedTargetYear,
    targetQualificationYear: null,
    requiresWeightingConfirmation: false,
    label: "Kontext prüfen"
  };
}

export function createSuccessorCourseCandidate(oldCourse, targetYear, successorPlan = null) {
  const plan = successorPlan || planCourseSuccessor(oldCourse, targetYear);
  if (plan.targetYear !== Number(targetYear)) throw new Error("Der Nachfolgeplan passt nicht zum Zieljahr.");
  if (!oldCourse || plan.action !== "continue") return null;
  const successorContext = oldCourse.schemaMode === SCHEMA_MODES.UPPERSEC
    ? {
        courseType: oldCourse.upperSecContext.courseType,
        qualificationYear: plan.targetQualificationYear,
        weightingDeviationReason: null
      }
    : null;
  const successor = createCourse({
    name: oldCourse.name,
    subject: oldCourse.subject,
    symbolId: oldCourse.symbolId,
    cardHue: oldCourse.cardHue,
    classLabel: oldCourse.classLabel,
    schemaMode: oldCourse.schemaMode,
    weightTemplateId: oldCourse.schemaMode === SCHEMA_MODES.UPPERSEC
      ? (typeof plan.targetWeightTemplateId === "string" ? plan.targetWeightTemplateId : null)
      : oldCourse.weightTemplateId,
    includePrevTermGrades: oldCourse.includePrevTermGrades,
    termCutoffs: oldCourse.termCutoffs ? JSON.parse(JSON.stringify(oldCourse.termCutoffs)) : null,
    showAttendance: oldCourse.showAttendance,
    schoolYearStartYear: plan.targetYear,
    carriedForwardFromCourseId: oldCourse.id,
    importKey: null,
    upperSecContext: successorContext
  });
  if (oldCourse.categoryRoles) successor.categoryRoles = { ...oldCourse.categoryRoles };
  successor.enrollments = (oldCourse.enrollments || []).map(enrollment => createEnrollment({
    studentId: enrollment.studentId,
    subgroup: enrollment.subgroup || null,
    homeClassAtEnrollment: enrollment.homeClassAtEnrollment || null,
    writtenExamSubjectQ4: false
  }));
  return successor;
}

export function normalizeArchiveRetentionUntil(value) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

export function normalizeArchiveNote(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1e3) : null;
}

export function normalizeArchiveHistory(value, fallbackSchemaMode = null) {
  if (!Array.isArray(value)) return [];
  return value.filter(function(entry) {
    return entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.archivedAt === 'string' && entry.archivedAt && entry.snapshot && typeof entry.snapshot === 'object' && !Array.isArray(entry.snapshot);
  }).map(function(entry) {
    return {
      archivedAt: entry.archivedAt,
      schemaMode: Object.values(SCHEMA_MODES).includes(entry.schemaMode) ? entry.schemaMode : Object.values(SCHEMA_MODES).includes(entry.snapshot.schemaMode) ? entry.snapshot.schemaMode : Object.values(SCHEMA_MODES).includes(fallbackSchemaMode) ? fallbackSchemaMode : null,
      archiveReason: entry.archiveReason || null,
      archiveRetentionUntil: normalizeArchiveRetentionUntil(entry.archiveRetentionUntil),
      archiveNote: normalizeArchiveNote(entry.archiveNote),
      snapshot: JSON.parse(JSON.stringify(entry.snapshot))
    };
  });
}

export function effectiveCourseYear(state, course) {
  const level = course.schemaMode === SCHEMA_MODES.UPPERSEC ? 'seckII' : 'seckI';
  const frozenYear = course.archivedAt && course.archiveSnapshot?.halfYearSettings?.[level]?.schoolYearStartYear;
  for (const value of [course.schoolYearStartYear, frozenYear, state.settings?.halfYearSettings?.[level]?.schoolYearStartYear]) {
    const year = Number(value);
    if (Number.isInteger(year) && year > 0) return year;
  }
  return null;
}

export function courseYearScope(state, course) {
  return [course.schemaMode || '', effectiveCourseYear(state, course)].join('|');
}

export function courseImportScope(state, course) {
  return courseYearScope(state, course) + '|' + !!course.archivedAt;
}

function assertCourseIdentityAvailable(state, course, archived) {
  if (!course.importKey) return;
  const key = course.importKey.trim().toLowerCase();
  const year = effectiveCourseYear(state, course);
  const conflict = state.courses.find(other => other.id !== course.id && !!other.archivedAt === archived &&
    other.schemaMode === course.schemaMode && effectiveCourseYear(state, other) === year &&
    other.importKey?.trim().toLowerCase() === key);
  if (conflict) {
    throw new Error('Die Kurskennung „' + course.importKey + '“ ist für dieses Schuljahr ' +
      (archived ? 'im Archiv' : 'im aktiven Bestand') + ' bereits an „' + conflict.name + '“ vergeben.');
  }
}

export function archiveCourse(state, courseId, reason = "manual", metadata = {}, now) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  const course = findCourseById(state, courseId);
  if (!course || course.archivedAt) return false;
  assertCourseIdentityAvailable(state, course, true);
  if (!course.schoolYearStartYear) course.schoolYearStartYear = effectiveCourseYear(state, course);
  course.archiveSnapshot = createArchiveSnapshot(state, course, now);
  course.archivedAt = now().toISOString();
  course.archiveReason = reason || "manual";
  course.archiveRetentionUntil = normalizeArchiveRetentionUntil(metadata && metadata.archiveRetentionUntil);
  course.archiveNote = normalizeArchiveNote(metadata && metadata.archiveNote);
  if (state.lastGradesheetCourseId === courseId) state.lastGradesheetCourseId = null;
  return true;
}

export function restoreCourse(state, courseId) {
  const course = findCourseById(state, courseId);
  if (!course || !course.archivedAt) return false;
  assertCourseIdentityAvailable(state, course, false);
  const references = course.archiveRestoreReferences;
  const categoryReference = id => references?.categories?.find(entry => entry.id === id);
  const restoredAssessments = [];
  for (const assessment of listAssessmentsForCourse(state, courseId)) {
    if (!assessment.categoryId && !assessment.subcategoryId) continue;
    const reference = categoryReference(assessment.categoryId);
    const category = state.settings.categories.find(item => item.id === (reference?.targetId || assessment.categoryId));
    if (!category) {
      const archivedCategory = course.archiveSnapshot?.categories?.find(item => item.id === assessment.categoryId);
      throw new Error('Die Hauptkategorie „' + (archivedCategory?.name || assessment.categoryId) +
        '“ fehlt in den aktuellen Einstellungen. Der Kurs bleibt archiviert.');
    }
    const mappedSubId = reference?.subcategories?.find(entry => entry.id === assessment.subcategoryId)?.targetId || assessment.subcategoryId;
    const subcategoryId = mappedSubId && !category.subcategories?.some(item => item.id === mappedSubId) ? null : mappedSubId;
    restoredAssessments.push({ assessment, categoryId: category.id, subcategoryId });
  }
  if (course.schemaMode === SCHEMA_MODES.UPPERSEC) {
    const snapshot = course.archiveSnapshot;
    const frozenRole = resolveUpperSecWrittenCategoryId(snapshot, course);
    const targetRole = categoryReference(frozenRole)?.targetId || frozenRole;
    const activeRole = state.settings.categories.some(category => category.id === targetRole) ? targetRole : null;
    if (course.categoryRoles || activeRole !== resolveUpperSecWrittenCategoryId(state.settings)) {
      course.categoryRoles = { upperSecWrittenCategoryId: activeRole };
    }
  }
  course.archiveHistory = normalizeArchiveHistory(course.archiveHistory, course.schemaMode);
  course.archiveHistory.push({
    archivedAt: course.archivedAt,
    schemaMode: course.schemaMode,
    archiveReason: course.archiveReason || null,
    archiveRetentionUntil: normalizeArchiveRetentionUntil(course.archiveRetentionUntil),
    archiveNote: normalizeArchiveNote(course.archiveNote),
    snapshot: JSON.parse(JSON.stringify(course.archiveSnapshot))
  });
  if (!course.schoolYearStartYear) course.schoolYearStartYear = effectiveCourseYear(state, course);
  course.archivedAt = null;
  course.archiveReason = null;
  course.archiveRetentionUntil = null;
  course.archiveNote = null;
  course.archiveSnapshot = null;
  for (const { assessment, categoryId, subcategoryId } of restoredAssessments) {
    assessment.categoryId = categoryId;
    assessment.subcategoryId = subcategoryId;
  }
  if (references?.weightTemplateId) course.weightTemplateId = references.weightTemplateId;
  delete course.archiveRestoreReferences;
  if (course.weightTemplateId && !state.settings.weightTemplates.some(template => template.id === course.weightTemplateId)) {
    course.weightTemplateId = null;
  }
  return true;
}

export function addCourseToState(state, course) {
  state.courses.push(course);
}

export function removeCourseFromState(state, courseId) {
  if (!courseId) return;
  if (state.lastGradesheetCourseId === courseId) state.lastGradesheetCourseId = null;
  // Kurs entfernen
  state.courses = state.courses.filter(c => c.id !== courseId);
  // Alle zugehörigen Leistungen entfernen
  state.assessments = state.assessments.filter(a => a.courseId !== courseId);
}
