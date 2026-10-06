export function getSettingsForCourse(course, state) {
  const globalSettings = (state && state.settings) || {};
  const snapshot = course && course.archivedAt && course.archiveSnapshot && typeof course.archiveSnapshot === 'object'
    ? course.archiveSnapshot
    : null;
  if (!snapshot) return globalSettings;
  return {
    ...globalSettings,
    gradeMapping: snapshot.gradeMapping || {},
    categories: Array.isArray(snapshot.categories) ? snapshot.categories : [],
    weightTemplates: snapshot.weightTemplate ? [snapshot.weightTemplate] : [],
    categoryRoles: snapshot.categoryRoles || {},
    halfYearNames: snapshot.halfYearNames || {},
    halfYearSettings: snapshot.halfYearSettings || {},
    termCutoffs: snapshot.termCutoffs || null
  };
}
