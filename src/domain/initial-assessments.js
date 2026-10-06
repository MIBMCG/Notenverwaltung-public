export function createInitialAssessmentsForCourse(DomainModel, state, course) {
  if (!course) return;
  const categories = state.settings.categories || [];
  if (!Array.isArray(categories) || categories.length === 0) return;

  const oralCategory = categories.find(category => category.name === 'Mündlich') || categories[0];
  const writtenCategory = categories.find(category => category.name === 'Schriftlich') || categories[1] || categories[0];
  if (!oralCategory || !writtenCategory) return;

  DomainModel.addAssessmentToState(state, DomainModel.createAssessment({
    courseId: course.id, categoryId: oralCategory.id, title: 'M1', weight: 1
  }));
  DomainModel.addAssessmentToState(state, DomainModel.createAssessment({
    courseId: course.id, categoryId: writtenCategory.id, title: 'S1', weight: 1
  }));
}
