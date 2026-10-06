'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');

function buildUpperSec() {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const student = modules.DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ada' });
  const course = modules.DomainModel.createCourse({
    name: 'Synthetische Oberstufe', subject: 'Testfach', classLabel: 'QX',
    schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  modules.DomainModel.addStudentToState(state, student);
  modules.DomainModel.addCourseToState(state, course);
  modules.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  return { modules, state, student, course };
}

test('M32: new and legacy courses always expose termResults', () => {
  const { modules, course } = buildUpperSec();
  assert.deepEqual(JSON.parse(JSON.stringify(course.termResults)), []);
  delete course.termResults;
  const migrated = modules.DomainModel.ensureStateShape({
    ...modules.DomainModel.createEmptyState(), courses: [course]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.courses[0].termResults)), []);
});

test('M32: JSON normalization preserves a valid finalized result', () => {
  const { modules, state, student, course } = buildUpperSec();
  modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 12);

  const restored = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.courses[0].termResults)), [
    { studentId: student.id, term: '2025-H1', points: 12 }
  ]);
});

test('M32: a term result can be set, replaced and explicitly cleared', () => {
  const { modules, state, student, course } = buildUpperSec();
  assert.equal(modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 0), 0);
  assert.equal(modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 15), 15);
  assert.equal(course.termResults.length, 1);
  assert.equal(modules.DomainModel.getTermResult(course, student.id, '2025-H1'), 15);
  assert.equal(modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', null), null);
  assert.equal(course.termResults.length, 0);
});

test('M32: invalid points, terms, students, Sek-I and archives are rejected', () => {
  const { modules, state, student, course } = buildUpperSec();
  for (const value of [-1, 16, 11.5, NaN, '11']) {
    assert.throws(() => modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', value));
  }
  assert.throws(() => modules.DomainModel.setTermResult(state, course.id, student.id, 'Q1', 11));
  assert.throws(() => modules.DomainModel.setTermResult(state, course.id, 'stu_unknown', '2025-H1', 11));
  const notEnrolled = modules.DomainModel.createStudent({ lastName: 'Nicht', firstName: 'Eingeschrieben' });
  modules.DomainModel.addStudentToState(state, notEnrolled);
  assert.throws(() => modules.DomainModel.setTermResult(state, course.id, notEnrolled.id, '2025-H1', 11));
  const sekI = modules.DomainModel.createCourse({ name: 'Sek I', schemaMode: modules.DomainModel.SCHEMA_MODES.GRADES });
  modules.DomainModel.addCourseToState(state, sekI);
  assert.throws(() => modules.DomainModel.setTermResult(state, sekI.id, student.id, '2025-H1', 11));
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  assert.throws(() => modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 11));
});

test('M32: normalization keeps the first valid unique result and drops malformed data', () => {
  const { modules, state, student, course } = buildUpperSec();
  course.termResults = [
    { studentId: student.id, term: '2025-H1', points: 11 },
    { studentId: student.id, term: '2025-H1', points: 12 },
    { studentId: student.id, term: 'Q1', points: 13 },
    { studentId: 'stu_unknown', term: '2025-H2', points: 10 }
  ];
  const migrated = modules.DomainModel.ensureStateShape(state);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.courses[0].termResults)), [
    { studentId: student.id, term: '2025-H1', points: 11 }
  ]);
});

test('M32: active person deletion removes embedded term results', () => {
  const { modules, state, student, course } = buildUpperSec();
  modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 11);
  assert.equal(modules.DomainModel.removeStudentFromState(state, student.id), true);
  assert.deepEqual(JSON.parse(JSON.stringify(course.termResults)), []);
});

test('Low student deletion: an empty student ID leaves state unchanged and reports no result', () => {
  const { modules, state } = buildUpperSec();
  state.students.push({ id: '', firstName: 'Unvollständig', lastName: 'Datensatz' });
  const before = JSON.stringify(state);

  const result = modules.DomainModel.removeStudentFromState(state, '');

  assert.equal(result, undefined);
  assert.equal(JSON.stringify(state), before);
});

test('M32 review: unenrolling keeps an existing finalized result across normalization', () => {
  const { modules, state, student, course } = buildUpperSec();
  modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 11);
  course.enrollments = course.enrollments.filter(enrollment => enrollment.studentId !== student.id);

  const restored = modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state)));

  assert.deepEqual(JSON.parse(JSON.stringify(restored.courses[0].termResults)), [
    { studentId: student.id, term: '2025-H1', points: 11 }
  ]);
  assert.throws(() => modules.DomainModel.setTermResult(
    restored, restored.courses[0].id, student.id, '2025-H2', 12
  ), /eingeschrieben/);
});

test('M32: archived persons referenced only by a term result remain discoverable', () => {
  const { modules, state, student, course } = buildUpperSec();
  modules.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 11);
  course.enrollments = [];
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  assert.equal(modules.DomainModel.listReferencedStudentIdsForCourse(state, course.id).has(student.id), true);
  assert.equal(modules.DomainModel.removeStudentFromState(state, student.id), false);
});

test('M17 review: a student referenced by restored archive history cannot be deleted', () => {
  const { modules, state, student, course } = buildUpperSec();
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  modules.DomainModel.restoreCourse(state, course.id);
  course.enrollments = [];

  assert.equal(modules.DomainModel.listReferencedStudentIdsForCourse(state, course.id).has(student.id), true);
  assert.equal(modules.DomainModel.removeStudentFromState(state, student.id), false);
  assert.ok(modules.DomainModel.findStudentById(state, student.id));
});

test('M17 review: archive history does not block deleting a later active-only student', () => {
  const { modules, state, course } = buildUpperSec();
  modules.DomainModel.archiveCourse(state, course.id, 'manual', {});
  modules.DomainModel.restoreCourse(state, course.id);
  const laterStudent = modules.DomainModel.createStudent({ firstName: 'Neu', lastName: 'Aktiv' });
  modules.DomainModel.addStudentToState(state, laterStudent);
  modules.DomainModel.enrollStudentInCourse(state, course.id, laterStudent.id);

  assert.equal(modules.DomainModel.removeStudentFromState(state, laterStudent.id), true);
  assert.equal(modules.DomainModel.findStudentById(state, laterStudent.id), null);
});
