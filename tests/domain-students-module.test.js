'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seededRandom } = require('./harness/load.js');
const { loadLegacyDomain: loadModules } = require('./harness/load-legacy-domain.js');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const serializable = value => JSON.parse(JSON.stringify(value));

function loadStudents(seed = 23) {
  const math = Object.assign(Object.create(Math), { random: seededRandom(seed) });
  return loadEsmGraph('src/domain/students.js', { globals: { Math: math } }).exports;
}

function removableState() {
  return {
    students: [
      { id: 'remove', lastName: 'Entfernen', retainedStudentField: { keep: true } },
      { id: 'keep', lastName: 'Bleibt', retainedStudentField: { keep: true } }
    ],
    courses: [{
      id: 'active',
      archivedAt: null,
      enrollments: [
        { studentId: 'remove', retainedEnrollmentField: 'remove' },
        { studentId: 'keep', retainedEnrollmentField: 'keep' }
      ],
      termResults: [
        { studentId: 'remove', points: 12, retainedResultField: 'remove' },
        { studentId: 'keep', points: 11, retainedResultField: 'keep' }
      ],
      archiveHistory: [],
      retainedCourseField: { keep: true }
    }],
    assessments: [{
      id: 'assessment',
      courseId: 'active',
      scores: {
        remove: { valueRaw: '12' },
        keep: { valueRaw: '11', retainedScoreField: true }
      },
      retainedAssessmentField: { keep: true }
    }]
  };
}

test('student creation, lookup, and insertion preserve legacy behavior', () => {
  const legacy = loadModules({ seed: 23 }).DomainModel;
  const students = loadStudents(23);
  const inputs = [
    { id: 'fixed', lastName: 'Muster', firstName: 'Mara', birthDate: '2009-04-12', homeClass: '10a' },
    { lastName: '', firstName: '', birthDate: '', homeClass: '' },
    { lastName: 'Zufall', firstName: 'Id' }
  ];
  for (const input of inputs) {
    assert.deepEqual(serializable(students.createStudent(input)), serializable(legacy.createStudent(input)));
  }
  const state = { students: [{ id: 'present', lastName: 'Vorhanden' }] };
  assert.deepEqual(serializable(students.findStudentById(state, 'present')), serializable(legacy.findStudentById(state, 'present')));
  assert.equal(students.findStudentById(state, 'missing'), null);
  const legacyState = serializable(state);
  const added = { id: 'added', lastName: 'Hinzu', unknown: { retained: true } };
  students.addStudentToState(state, added);
  legacy.addStudentToState(legacyState, serializable(added));
  assert.equal(state.students[1], added);
  assert.deepEqual(serializable(state), serializable(legacyState));
});

test('student removal cleans active references without rebuilding retained records', () => {
  const legacy = loadModules().DomainModel;
  const students = loadStudents();
  const expected = removableState();
  const actual = removableState();
  assert.equal(students.removeStudentFromState(actual, 'remove'), legacy.removeStudentFromState(expected, 'remove'));
  assert.deepEqual(serializable(actual), serializable(expected));
  assert.deepEqual(serializable(actual), {
    students: [{ id: 'keep', lastName: 'Bleibt', retainedStudentField: { keep: true } }],
    courses: [{
      id: 'active', archivedAt: null,
      enrollments: [{ studentId: 'keep', retainedEnrollmentField: 'keep' }],
      termResults: [{ studentId: 'keep', points: 11, retainedResultField: 'keep' }],
      archiveHistory: [], retainedCourseField: { keep: true }
    }],
    assessments: [{
      id: 'assessment', courseId: 'active',
      scores: { keep: { valueRaw: '11', retainedScoreField: true } },
      retainedAssessmentField: { keep: true }
    }]
  });
});

test('student removal ignores an empty ID', () => {
  const students = loadStudents();
  const state = removableState();
  const before = serializable(state);
  assert.equal(students.removeStudentFromState(state, ''), undefined);
  assert.deepEqual(serializable(state), before);
});

test('student removal refuses current archive and archive-history references', () => {
  const legacy = loadModules().DomainModel;
  const students = loadStudents();
  const currentArchive = removableState();
  currentArchive.courses.push({
    id: 'archived', archivedAt: '2026-07-31T00:00:00.000Z',
    enrollments: [{ studentId: 'remove' }], termResults: [], archiveHistory: []
  });
  const historyArchive = removableState();
  historyArchive.courses.push({
    id: 'restored', archivedAt: null, enrollments: [], termResults: [],
    archiveHistory: [{ snapshot: { enrollments: [{ studentId: 'remove' }] } }]
  });
  for (const state of [currentArchive, historyArchive]) {
    const expected = serializable(state);
    assert.equal(students.removeStudentFromState(state, 'remove'), legacy.removeStudentFromState(expected, 'remove'));
    assert.equal(students.findStudentById(state, 'remove').lastName, 'Entfernen');
    assert.deepEqual(serializable(state), expected);
  }
});

test('unrelated archive history does not retain a later active-only student', () => {
  const legacy = loadModules().DomainModel;
  const students = loadStudents();
  const actual = removableState();
  actual.students.push({ id: 'later', lastName: 'Später', unknown: true });
  actual.courses.push({
    id: 'restored', archivedAt: null, enrollments: [], termResults: [],
    archiveHistory: [{ snapshot: { enrollments: [{ studentId: 'historic' }] } }]
  });
  const expected = serializable(actual);
  assert.equal(students.removeStudentFromState(actual, 'later'), legacy.removeStudentFromState(expected, 'later'));
  assert.equal(students.findStudentById(actual, 'later'), null);
  assert.deepEqual(serializable(actual), expected);
});
