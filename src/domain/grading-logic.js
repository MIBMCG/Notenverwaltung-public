import { getSettingsForCourse } from './course-settings.js';
import * as terms from './terms.js';
import * as grading from './grading.js';

export function createGradingLogic({ now, diagnostics } = {}) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  return {
    parseGradeLabel: grading.parseGradeLabel,
    parseGradeMappingInput: grading.parseGradeMappingInput,
    parseUpperSecPoints: grading.parseUpperSecPoints,
    isValidRawForCourse: grading.isValidRawForCourse,
    getNumericScoreForEntry: grading.getNumericScoreForEntry,
    getUpperSecGradeLabel: grading.getUpperSecGradeLabel,
    validatePercentageThresholds: grading.validatePercentageThresholds,
    getSettingsForCourse,
    resolveSchoolYearBoundaries: terms.resolveSchoolYearBoundaries,
    resolveAssessmentTermFromDateValue: terms.resolveAssessmentTermFromDateValue,
    resolveUpperSecGradingContext: grading.resolveUpperSecGradingContext,
    resolveUpperSecAssessmentWarning: grading.resolveUpperSecAssessmentWarning,
    resolveEffectiveCategoryWeights: grading.resolveEffectiveCategoryWeights,
    resolveAssessmentTermsForResult: terms.resolveAssessmentTermsForResult,
    isSchoolYearResultTerm: terms.isSchoolYearResultTerm,
    formatCourseTermLabel: terms.formatCourseTermLabel,
    resolveGradingResultScope(course, state, selectedTerm = null) {
      return terms.resolveGradingResultScope(course, state, selectedTerm, now);
    },
    computeCategoryAverage: grading.computeCategoryAverage,
    computeWeightedOverallForAssessments: grading.computeWeightedOverallForAssessments,
    computeOverallGrade(course, studentId, state, selectedTerm = null) {
      return grading.computeOverallGrade(course, studentId, state, selectedTerm, now, diagnostics);
    },
    computeCourseStatistics(course, state) {
      return grading.computeCourseStatistics(course, state, now, diagnostics);
    }
  };
}
