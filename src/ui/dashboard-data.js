function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value);
}

export function buildDashboardCards({ state, domain, grading, now = new Date() }) {
  const existingStudentIds = new Set(
    (Array.isArray(state && state.students) ? state.students : [])
      .filter(student => student && student.id !== undefined && student.id !== null)
      .map(student => student.id)
  );

  return domain.listActiveCourses(state).map(course => {
    const settings = grading.getSettingsForCourse(course, state);
    const term = grading.resolveAssessmentTermFromDateValue(now, course, settings);
    const termLabel = term == null
      ? 'Zeitraum nicht verfügbar'
      : normalizeText(grading.formatCourseTermLabel(term, course, settings));
    const studentCount = new Set(
      course.enrollments
        .map(enrollment => enrollment && enrollment.studentId)
        .filter(studentId => existingStudentIds.has(studentId))
    ).size;

    return {
      id: course.id,
      name: normalizeText(course.name),
      subject: normalizeText(course.subject),
      ...(course.symbolId ? { symbolId: course.symbolId } : {}),
      classLabel: normalizeText(course.classLabel),
      studentCount,
      termLabel
    };
  });
}
