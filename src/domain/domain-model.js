import * as state from './state.js';
import * as assessments from './assessments.js';
import * as courses from './courses.js';
import * as students from './students.js';
import * as migrations from './migrations.js';

// Keep the consumer namespace stable while term services stay explicit.
export function createDomainModel({ now, termServices } = {}) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  return {
    SCHEMA_MODES: state.SCHEMA_MODES,
    UPPERSEC_COURSE_TYPES: state.UPPERSEC_COURSE_TYPES,
    QUALIFICATION_YEARS: state.QUALIFICATION_YEARS,
    SCORE_STATUS: state.SCORE_STATUS,
    STANDARD_GRADE_LABELS: state.STANDARD_GRADE_LABELS,
    RECOMMENDED_WEIGHT_TEMPLATE_IDS: state.RECOMMENDED_WEIGHT_TEMPLATE_IDS,
    generateId: state.generateId,
    createEmptyState: state.createEmptyState,
    normalizeSchoolProfile: state.normalizeSchoolProfile,
    createDefaultGradeMapping: state.createDefaultGradeMapping,
    createStudent: students.createStudent,
    createEnrollment: courses.createEnrollment,
    createCourse: courses.createCourse,
    createCategory: assessments.createCategory,
    getDefaultSubcategoryWeight: assessments.getDefaultSubcategoryWeight,
    createWeightTemplate: assessments.createWeightTemplate,
    createScoreEntry: assessments.createScoreEntry,
    createAssessment: assessments.createAssessment,
    findStudentById: students.findStudentById,
    findCourseById: courses.findCourseById,
    findAssessmentById: assessments.findAssessmentById,
    getTermResult: assessments.getTermResult,
    setTermResult: assessments.setTermResult,
    listAssessmentsForCourse: assessments.listAssessmentsForCourse,
    listEnrollmentsForCourse: courses.listEnrollmentsForCourse,
    findEnrollment: courses.findEnrollment,
    enrollStudentInCourse: courses.enrollStudentInCourse,
    setWrittenExamSubjectQ4: courses.setWrittenExamSubjectQ4,
    resolveQualificationPhase: courses.resolveQualificationPhase,
    listActiveCourses: courses.listActiveCourses,
    listArchivedCourses: courses.listArchivedCourses,
    studentHasArchivedCourseReference: courses.studentHasArchivedCourseReference,
    listReferencedStudentIdsForCourse: courses.listReferencedStudentIdsForCourse,
    listStudentReportCourses: courses.listStudentReportCourses,
    resolveUpperSecWrittenCategoryId: courses.resolveUpperSecWrittenCategoryId,
    createArchiveSnapshot(stateValue, course) {
      return courses.createArchiveSnapshot(stateValue, course, now);
    },
    normalizeArchiveRetentionUntil: courses.normalizeArchiveRetentionUntil,
    normalizeArchiveNote: courses.normalizeArchiveNote,
    normalizeUpperSecContext: courses.normalizeUpperSecContext,
    planCourseSuccessor: courses.planCourseSuccessor,
    createSuccessorCourseCandidate: courses.createSuccessorCourseCandidate,
    archiveCourse(stateValue, courseId, reason = 'manual', metadata = {}) {
      return courses.archiveCourse(stateValue, courseId, reason, metadata, now);
    },
    restoreCourse: courses.restoreCourse,
    addStudentToState: students.addStudentToState,
    addCourseToState: courses.addCourseToState,
    addAssessmentToState: assessments.addAssessmentToState,
    removeStudentFromState: students.removeStudentFromState,
    removeCourseFromState: courses.removeCourseFromState,
    ensureStateShape(raw) {
      return migrations.ensureStateShape(raw, now, termServices);
    }
  };
}
