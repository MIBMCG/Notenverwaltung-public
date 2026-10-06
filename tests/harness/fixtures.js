'use strict';

// Builds a synthetic course with enrolled synthetic students.
// No real personal data is used anywhere in this file.
function buildCourseState(modules, { schemaMode = 'grades', studentCount = 2 } = {}) {
  const { DomainModel } = modules;
  const state = DomainModel.createEmptyState();

  const byName = name => (state.settings.categories.find(c => c.name === name) || {}).id;
  const categoryIds = {
    oral: byName('Mündlich'),
    written: byName('Schriftlich'),
    other: byName('Sonstiges')
  };

  const course = DomainModel.createCourse({
    name: 'Synthetischer Kurs',
    subject: 'Testfach',
    classLabel: 'T1',
    schemaMode: schemaMode === 'uppersec'
      ? DomainModel.SCHEMA_MODES.UPPERSEC
      : DomainModel.SCHEMA_MODES.GRADES
  });
  DomainModel.addCourseToState(state, course);

  const students = [];
  for (let index = 0; index < studentCount; index++) {
    const student = DomainModel.createStudent({
      lastName: `Testperson${index + 1}`,
      firstName: `Vorname${index + 1}`,
      birthDate: '2010-01-01',
      homeClass: 'T1'
    });
    DomainModel.addStudentToState(state, student);
    DomainModel.enrollStudentInCourse(state, course.id, student.id);
    students.push(student);
  }

  return { state, course, students, categoryIds };
}

function addAssessment(modules, ctx, options) {
  const { DomainModel } = modules;
  const assessmentInput = {
    courseId: ctx.course.id,
    categoryId: options.categoryId,
    subcategoryId: options.subcategoryId || null,
    title: options.title || 'Synthetische Leistung',
    date: options.date === undefined ? null : options.date,
    // Deliberately null: see the fixture rule in Global Constraints.
    term: options.term === undefined ? null : options.term,
    maxPoints: null,
    weight: options.weight === undefined ? 1 : options.weight,
    visible: options.visible === undefined ? true : options.visible
  };
  if (options.termAssignment !== undefined) assessmentInput.termAssignment = options.termAssignment;
  const assessment = DomainModel.createAssessment(assessmentInput);
  DomainModel.addAssessmentToState(ctx.state, assessment);
  return assessment;
}

function setScore(modules, assessment, studentId, raw, status) {
  const { DomainModel } = modules;
  assessment.scores[studentId] = DomainModel.createScoreEntry({
    valueRaw: raw,
    status: status || DomainModel.SCORE_STATUS.VALID
  });
}

module.exports = { buildCourseState, addAssessment, setScore };
