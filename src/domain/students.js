import { generateId, findById } from './state.js';
import { studentHasArchivedCourseReference } from './courses.js';

export function createStudent({ id = null, lastName, firstName, birthDate = null, homeClass = '' }) {
  return {
    id: id || generateId('stu'),
    lastName: lastName || '',
    firstName: firstName || '',
    birthDate: birthDate || null,
    // Stammklasse des Schülers (z. B. "9a").
    homeClass: homeClass || ''
  };
}

export function findStudentById(state, studentId) {
  return findById(state.students, studentId);
}

export function addStudentToState(state, student) {
  state.students.push(student);
}

export function removeStudentFromState(state, studentId) {
  if (!studentId) return;
  if (studentHasArchivedCourseReference(state, studentId)) return false;
  // Schüler aus globaler Liste entfernen
  state.students = state.students.filter(s => s.id !== studentId);

  // Schüler aus allen Kursen ausbuchen
  for (const c of state.courses) {
    if (Array.isArray(c.enrollments)) {
      c.enrollments = c.enrollments.filter(e => e.studentId !== studentId);
    }
    if (Array.isArray(c.termResults)) {
      c.termResults = c.termResults.filter(result => result.studentId !== studentId);
    }
  }

  // Schüler aus allen Leistungs-Einträgen entfernen
  for (const asm of state.assessments) {
    if (asm.scores && Object.prototype.hasOwnProperty.call(asm.scores, studentId)) {
      delete asm.scores[studentId];
    }
  }
  return true;
}
