'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

function loadImportMerge(modules) {
  const graph = loadEsmGraph('src/transfer/import-merge.js');
  return graph.exports.createImportMerge({
    ensureStateShape: modules.DomainModel.ensureStateShape,
    createEmptyState: modules.DomainModel.createEmptyState,
    generateId: modules.DomainModel.generateId
  }).mergeImportedStateIntoCurrent;
}

test('module merge preserves both inputs and makes a repeated identical import idempotent', () => {
  const modules = loadModules();
  const base = modules.DomainModel.createEmptyState();
  const incoming = buildCourseState(modules);
  addAssessment(modules, incoming, { categoryId: incoming.categoryIds.oral, title: 'Importierte Leistung' });
  const beforeBase = JSON.stringify(base);
  const beforeIncoming = JSON.stringify(incoming.state);
  const mergeImportedStateIntoCurrent = loadImportMerge(modules);

  const first = mergeImportedStateIntoCurrent(base, incoming.state);

  assert.equal(JSON.stringify(base), beforeBase);
  assert.equal(JSON.stringify(incoming.state), beforeIncoming);
  const second = mergeImportedStateIntoCurrent(first.state, incoming.state);
  assert.equal(second.summary.studentsAdded, 0);
  assert.equal(second.summary.coursesAdded, 0);
  assert.equal(second.summary.assessmentsAdded, 0);
});

test('R03: distinct stable ids preserve same-name people, same-description courses and same-title assessments', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const base = DomainModel.createEmptyState();
  const incoming = DomainModel.createEmptyState();
  const categoryId = incoming.settings.categories[0].id;
  for (const suffix of ['one', 'two']) {
    const student = DomainModel.createStudent({
      id: `student_${suffix}`,
      lastName: 'Gleichname',
      firstName: 'Mia',
      birthDate: null
    });
    const course = DomainModel.createCourse({
      id: `course_${suffix}`,
      name: 'Gleicher Kurs',
      subject: 'Biologie',
      classLabel: 'T1'
    });
    const assessment = DomainModel.createAssessment({
      id: `assessment_${suffix}`,
      courseId: course.id,
      categoryId,
      title: 'Gleiche Leistung',
      date: '2026-03-12'
    });
    DomainModel.addStudentToState(incoming, student);
    DomainModel.addCourseToState(incoming, course);
    DomainModel.enrollStudentInCourse(incoming, course.id, student.id);
    setScore(modules, assessment, student.id, suffix === 'one' ? '1' : '5');
    DomainModel.addAssessmentToState(incoming, assessment);
  }
  const beforeBase = JSON.stringify(base);
  const beforeIncoming = JSON.stringify(incoming);
  const merge = loadImportMerge(modules);

  const first = merge(base, incoming);

  assert.deepEqual(Array.from(first.state.students, item => item.id).sort(), ['student_one', 'student_two']);
  assert.deepEqual(Array.from(first.state.courses, item => item.id).sort(), ['course_one', 'course_two']);
  assert.deepEqual(Array.from(first.state.assessments, item => item.id).sort(), ['assessment_one', 'assessment_two']);
  assert.equal(first.state.assessments.find(item => item.id === 'assessment_one').scores.student_one.valueRaw, '1');
  assert.equal(first.state.assessments.find(item => item.id === 'assessment_two').scores.student_two.valueRaw, '5');
  assert.equal(JSON.stringify(base), beforeBase);
  assert.equal(JSON.stringify(incoming), beforeIncoming);

  const second = merge(first.state, incoming);
  assert.deepEqual({
    studentsAdded: second.summary.studentsAdded,
    coursesAdded: second.summary.coursesAdded,
    assessmentsAdded: second.summary.assessmentsAdded
  }, { studentsAdded: 0, coursesAdded: 0, assessmentsAdded: 0 });
  assert.deepEqual(second.state, first.state);
});

test('merge identity preflight rejects duplicate ids before normalization', () => {
  const modules = loadModules();
  const incoming = modules.DomainModel.createEmptyState();
  incoming.students.push(
    { id: 'student_duplicate', lastName: 'Eins', firstName: 'A' },
    { id: 'student_duplicate', lastName: 'Zwei', firstName: 'B' }
  );
  let normalizationCalls = 0;
  const merge = loadEsmGraph('src/transfer/import-merge.js').exports.createImportMerge({
    ensureStateShape(value) {
      normalizationCalls++;
      return modules.DomainModel.ensureStateShape(value);
    },
    createEmptyState: modules.DomainModel.createEmptyState,
    generateId: modules.DomainModel.generateId
  }).mergeImportedStateIntoCurrent;

  assert.throws(() => merge(modules.DomainModel.createEmptyState(), incoming), /Schüler: Doppelte ID/);
  assert.equal(normalizationCalls, 0);
});

test('merge preflight rejects contradictory and ambiguous course identity claims atomically', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const base = DomainModel.createEmptyState();
  const first = DomainModel.createCourse({ id: 'course_first', name: 'Erster Kurs', subject: 'Biologie', classLabel: 'T1' });
  const second = DomainModel.createCourse({ id: 'course_second', name: 'Zweiter Kurs', subject: 'Chemie', classLabel: 'T1' });
  first.importKey = 'external-first';
  second.importKey = 'external-second';
  DomainModel.addCourseToState(base, first);
  DomainModel.addCourseToState(base, second);
  const merge = loadImportMerge(modules);

  const contradictory = DomainModel.createEmptyState();
  contradictory.courses.push({ ...JSON.parse(JSON.stringify(first)), importKey: second.importKey });
  const beforeContradictory = JSON.stringify(contradictory);
  assert.throws(() => merge(base, contradictory), /Kursidentität.*widersprüchlich/i);
  assert.equal(JSON.stringify(contradictory), beforeContradictory);

  const ambiguous = DomainModel.createEmptyState();
  ambiguous.courses.push(
    { ...JSON.parse(JSON.stringify(first)), importKey: null },
    { ...JSON.parse(JSON.stringify(first)), id: 'course_incoming_alias', importKey: first.importKey }
  );
  assert.throws(() => merge(base, ambiguous), /mehrere eingehende Kurse.*denselben Zielkurs/i);
});

test('merge preflight rejects course structure and assessment course collisions', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const local = buildCourseState(modules, { studentCount: 1 });
  local.course.schoolYearStartYear = 2025;
  const merge = loadImportMerge(modules);

  const changedStructure = JSON.parse(JSON.stringify(local.state));
  changedStructure.courses[0].schoolYearStartYear = 2026;
  assert.throws(() => merge(local.state, changedStructure), /strukturellen Kurskontext/i);

  const otherCourse = DomainModel.createCourse({ id: 'course_other', name: 'Anderer Kurs', subject: 'Chemie', classLabel: 'T1' });
  DomainModel.addCourseToState(local.state, otherCourse);
  const localAssessment = addAssessment(modules, local, { id: 'assessment_shared', categoryId: local.categoryIds.oral, title: 'Lokal' });
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments = [{ ...JSON.parse(JSON.stringify(localAssessment)), courseId: otherCourse.id }];
  assert.throws(() => merge(local.state, incoming), /Leistungs-ID.*anderen Kurs/i);
});

test('same assessment id keeps local metadata and counts one metadata conflict separately from scores', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, {
    id: 'assessment_stable',
    categoryId: local.categoryIds.oral,
    title: 'Lokaler Titel',
    date: '2026-02-01'
  });
  setScore(modules, assessment, local.students[0].id, '1');
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.students[0].lastName = 'Geänderter Personenname';
  incoming.courses[0].name = 'Geänderter Kursname';
  incoming.assessments[0].title = 'Importierter Titel';
  incoming.assessments[0].date = '2026-02-03';
  incoming.assessments[0].weight = 3;
  incoming.assessments[0].scores[local.students[0].id].valueRaw = '5';

  const merged = loadImportMerge(modules)(local.state, incoming);

  assert.equal(merged.state.students.length, 1);
  assert.equal(merged.state.students[0].lastName, local.students[0].lastName);
  assert.equal(merged.state.courses.length, 1);
  assert.equal(merged.state.courses[0].name, local.course.name);
  assert.equal(merged.state.assessments.length, 1);
  assert.equal(merged.state.assessments[0].title, 'Lokaler Titel');
  assert.equal(merged.state.assessments[0].date, '2026-02-01');
  assert.equal(merged.state.assessments[0].scores[local.students[0].id].valueRaw, '1');
  assert.equal(merged.summary.assessmentMetadataConflicts, 1);
  assert.equal(merged.summary.scoreConflicts, 1);
});

test('D4: merge transports term provenance and keeps local provenance on one metadata conflict', () => {
  const modules = loadModules();
  const local = buildCourseState(modules, { studentCount: 1 });
  const localAssessment = addAssessment(modules, local, {
    id: 'assessment_d4_local', categoryId: local.categoryIds.oral,
    title: 'D4', date: '2026-02-05', term: '2025-H2', termAssignment: 'manual'
  });
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments[0].term = '2025-H1';
  incoming.assessments[0].termAssignment = 'auto';

  const merge = loadImportMerge(modules);
  const conflict = merge(local.state, incoming);
  assert.equal(conflict.summary.assessmentMetadataConflicts, 1);
  assert.equal(conflict.state.assessments[0].term, '2025-H2');
  assert.equal(conflict.state.assessments[0].termAssignment, 'manual');
  assert.equal(localAssessment.termAssignment, 'manual');

  const newIncoming = buildCourseState(modules, { studentCount: 1 });
  const added = addAssessment(modules, newIncoming, {
    id: 'assessment_d4_added', categoryId: newIncoming.categoryIds.oral,
    title: 'Auto', date: '2026-02-05', term: '2025-H1', termAssignment: 'auto'
  });
  const first = merge(modules.DomainModel.createEmptyState(), newIncoming.state);
  assert.equal(first.state.assessments[0].term, added.term);
  assert.equal(first.state.assessments[0].termAssignment, 'auto');
  const second = merge(first.state, newIncoming.state);
  assert.equal(second.summary.assessmentsAdded, 0);
  assert.deepEqual(second.state, first.state);
});

test('a unique contextual course import key maps different ids while another school year stays separate', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const base = DomainModel.createEmptyState();
  const localCourse = DomainModel.createCourse({
    id: 'course_local', name: 'Lokaler Name', subject: 'Biologie', classLabel: 'T1', schoolYearStartYear: 2025
  });
  localCourse.importKey = 'external-course-key';
  DomainModel.addCourseToState(base, localCourse);
  const sameContext = DomainModel.createEmptyState();
  const alias = DomainModel.createCourse({
    id: 'course_foreign', name: 'Geänderter Importname', subject: 'Biologie', classLabel: 'T1', schoolYearStartYear: 2025
  });
  alias.importKey = localCourse.importKey;
  DomainModel.addCourseToState(sameContext, alias);
  const merge = loadImportMerge(modules);

  const mapped = merge(base, sameContext);
  assert.equal(mapped.state.courses.length, 1);
  assert.equal(mapped.state.courses[0].id, 'course_local');
  assert.equal(mapped.state.courses[0].name, 'Lokaler Name');

  const differentYear = DomainModel.createEmptyState();
  const later = DomainModel.createCourse({
    id: 'course_later', name: 'Lokaler Name', subject: 'Biologie', classLabel: 'T1', schoolYearStartYear: 2026
  });
  later.importKey = localCourse.importKey;
  DomainModel.addCourseToState(differentYear, later);
  const separated = merge(base, differentYear);
  assert.deepEqual(Array.from(separated.state.courses, course => course.id).sort(), ['course_later', 'course_local']);
});

test('D2 preserves metadata on existing local archives while carrying metadata onto new imported archives', () => {
  const modules = loadModules();
  const { DomainModel } = modules;
  const local = buildCourseState(modules, { studentCount: 1 });
  DomainModel.archiveCourse(local.state, local.course.id, 'manual', {});
  DomainModel.ensureStateShape(local.state);
  const archivedLocalCourseBefore = JSON.parse(JSON.stringify(local.course));
  const incoming = JSON.parse(JSON.stringify(local.state));
  const incomingLocalArchive = incoming.courses.find(course => course.id === local.course.id);
  const predecessor = DomainModel.createCourse({
    id: 'course_archive_predecessor', name: 'Vorgänger', subject: 'Biologie', classLabel: 'T0'
  });
  incoming.courses.push(predecessor);
  incomingLocalArchive.importKey = 'incoming-archive-key';
  incomingLocalArchive.carriedForwardFromCourseId = predecessor.id;

  const incomingArchive = DomainModel.createCourse({
    id: 'course_new_imported_archive', name: 'Neues Archiv', subject: 'Biologie', classLabel: 'T1'
  });
  DomainModel.addCourseToState(incoming, incomingArchive);
  DomainModel.archiveCourse(incoming, incomingArchive.id, 'manual', {});
  const newArchive = incoming.courses.find(course => course.id === incomingArchive.id);
  newArchive.importKey = 'new-archive-key';
  newArchive.carriedForwardFromCourseId = predecessor.id;
  const localBefore = JSON.stringify(local.state);
  const incomingBefore = JSON.stringify(incoming);
  const merge = loadImportMerge(modules);

  const first = merge(local.state, incoming);

  const archivedResult = first.state.courses.find(course => course.id === local.course.id);
  assert.deepEqual(JSON.parse(JSON.stringify(archivedResult)), archivedLocalCourseBefore);
  assert.equal(first.summary.archiveConflicts, 2, 'each discarded archive metadata addition is reported');
  assert.equal(first.summary.assessmentMetadataConflicts, 0, 'archive metadata is not counted as active-assessment metadata');
  const importedArchiveResult = first.state.courses.find(course => course.id === incomingArchive.id);
  assert.equal(importedArchiveResult.importKey, 'new-archive-key');
  assert.equal(importedArchiveResult.carriedForwardFromCourseId, predecessor.id);

  const repeated = merge(first.state, incoming);
  assert.deepEqual(repeated.state, first.state, 'repeating the merge does not alter either archive');
  assert.equal(repeated.summary.coursesAdded, 0);
  assert.equal(JSON.stringify(local.state), localBefore);
  assert.equal(JSON.stringify(incoming), incomingBefore);

  const identicalArchive = merge(local.state, JSON.parse(JSON.stringify(local.state)));
  assert.equal(identicalArchive.summary.archiveConflicts, 0, 'unchanged archive metadata remains conflict-free');
});
