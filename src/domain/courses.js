import {
  SCHEMA_MODES,
  UPPERSEC_COURSE_TYPES,
  QUALIFICATION_YEARS,
  RECOMMENDED_WEIGHT_TEMPLATE_IDS,
  generateId,
  findById
} from './state.js';
import { isCanonicalTerm, listAssessmentsForCourse } from './assessments.js';
import { normalizeCourseSymbol } from './course-symbols.js';

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

export function resolveUpperSecWrittenCategoryId(settings) {
  const snapshottedRole = settings && settings.categoryRoles && settings.categoryRoles.upperSecWrittenCategoryId;
  if (snapshottedRole) return snapshottedRole;
  const templates = Array.isArray(settings && settings.weightTemplates)
    ? settings.weightTemplates
    : [];
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
  return candidates.length === 1 ? candidates[0] : null;
}

export function createArchiveSnapshot(state, course, now) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  const settings = (state && state.settings) || {};
  const templates = settings.weightTemplates || [];
  const hasCourseTermCutoffs = !!(course && course.termCutoffs && typeof course.termCutoffs === "object");
  const selectedTemplate = course && course.weightTemplateId
    ? templates.find(t => t.id === course.weightTemplateId) || null
    : null;
  const upperSecWrittenCategoryId = resolveUpperSecWrittenCategoryId(settings);
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

export function archiveCourse(state, courseId, reason = "manual", metadata = {}, now) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  const course = findCourseById(state, courseId);
  if (!course || course.archivedAt) return false;
  if (!course.schoolYearStartYear) {
    const level = course.schemaMode === SCHEMA_MODES.UPPERSEC ? 'seckII' : 'seckI';
    const inferredYear = Number(state.settings?.halfYearSettings?.[level]?.schoolYearStartYear);
    course.schoolYearStartYear = Number.isInteger(inferredYear) ? inferredYear : null;
  }
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
  course.archiveHistory = normalizeArchiveHistory(course.archiveHistory, course.schemaMode);
  course.archiveHistory.push({
    archivedAt: course.archivedAt,
    schemaMode: course.schemaMode,
    archiveReason: course.archiveReason || null,
    archiveRetentionUntil: normalizeArchiveRetentionUntil(course.archiveRetentionUntil),
    archiveNote: normalizeArchiveNote(course.archiveNote),
    snapshot: JSON.parse(JSON.stringify(course.archiveSnapshot))
  });
  course.archivedAt = null;
  course.archiveReason = null;
  course.archiveRetentionUntil = null;
  course.archiveNote = null;
  course.archiveSnapshot = null;
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
