'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load');
const { createLockManagerStub, deferred } = require('./harness/shared-session');
const { createReleaseFixtures } = require('./fixtures/release-readiness');

test('a held lock rejects ifAvailable, then can be acquired after release', async () => {
  const hold = deferred();
  const locks = createLockManagerStub();
  let firstEntered = false;
  const first = locks.request('test-editor', { ifAvailable: true }, async lock => {
    assert.ok(lock);
    assert.equal(lock.name, 'test-editor');
    firstEntered = true;
    await hold.promise;
  });
  await Promise.resolve();
  assert.equal(firstEntered, true);
  await locks.request('test-editor', { ifAvailable: true }, lock => assert.equal(lock, null));
  hold.resolve();
  await first;
  await locks.request('test-editor', { ifAvailable: true }, lock => assert.ok(lock));
});

test('independent lock names can be acquired concurrently', async () => {
  const hold = deferred();
  const locks = createLockManagerStub();
  const first = locks.request('editor-a', {}, async lock => {
    assert.ok(lock);
    await hold.promise;
  });
  await Promise.resolve();
  await locks.request('editor-b', { ifAvailable: true }, lock => assert.ok(lock));
  hold.resolve();
  await first;
});

test('queued request waits for a held lock and receives it after release', async () => {
  const hold = deferred();
  const locks = createLockManagerStub();
  const events = [];
  const first = locks.request('editor', {}, async () => { events.push('first'); await hold.promise; });
  await Promise.resolve();
  const second = locks.request('editor', {}, lock => { assert.ok(lock); events.push('second'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first']);
  hold.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'second']);
});

test('rejected lock callback releases the name for another request', async () => {
  const locks = createLockManagerStub();
  await assert.rejects(locks.request('editor', {}, () => { throw new Error('synthetic failure'); }), /synthetic failure/);
  await locks.request('editor', { ifAvailable: true }, lock => assert.ok(lock));
});

test('normal release fixture has independent sparse controls and fixed totals', () => {
  const { DomainModel } = loadModules();
  const { normal, expected } = createReleaseFixtures(DomainModel, { seed: 23 });
  assert.equal(normal.state.settings.schoolProfile.name, 'Synthetische Testschule');
  assert.equal(normal.state.courses.length, 3);
  assert.equal(normal.state.students.length, 39);
  assert.deepEqual(Array.from(normal.state.courses, course => course.enrollments.length), [24, 16, 1]);
  assert.equal(normal.state.assessments.length, 11);
  assert.equal(normal.state.assessments.filter(item => item.courseId === normal.courses.sekI.id).length, 6);
  assert.equal(normal.state.assessments.filter(item => item.courseId === normal.courses.q4.id).length, 4);
  const writtenId = normal.state.settings.categories.find(item => item.name === 'Schriftlich').id;
  const sekiWritten = normal.state.assessments.filter(item => item.courseId === 'release-normal-seki').slice(0, 2);
  assert.deepEqual(Array.from(sekiWritten, item => item.categoryId), [writtenId, writtenId]);
  assert.deepEqual(Array.from(sekiWritten, item => item.weight), [1, 1]);
  assert.equal(normal.assessments.archived.term, '2025-H1');
  assert.equal(normal.assessments.archived.termAssignment, 'manual');
  assert.equal(normal.courses.archived.archiveNote, 'Synthetischer Archivvermerk');
  const rawScores = studentId => Array.from(sekiWritten, item => item.scores[studentId]?.valueRaw);
  assert.deepEqual(rawScores('release-normal-person-1'), ['4', '2']);
  assert.deepEqual(rawScores('release-normal-person-2'), ['4', '2']);
  const s1Mean = rawScores('release-normal-person-1').map(Number).reduce((sum, value) => sum + value, 0) / 2;
  assert.equal(s1Mean, expected.normal.s1.averageBefore);
  assert.deepEqual(Array.from(sekiWritten, item => item.scores['release-normal-person-2'].valueNumeric), [null, null]);
  assert.equal(sekiWritten[0].scores['release-normal-person-3'].valueRaw, '4');
  assert.equal(Object.hasOwn(sekiWritten[1].scores, 'release-normal-person-3'), false);
  const q4Assessment = normal.state.assessments.find(item => item.courseId === 'release-normal-q4');
  assert.equal(q4Assessment.scores['release-normal-person-1'].valueRaw, '0');
  assert.equal(q4Assessment.scores['release-normal-person-1'].status, DomainModel.SCORE_STATUS.VALID);
  const fixed = normal.state.courses.find(item => item.id === 'release-normal-q4').termResults;
  assert.equal(fixed.find(item => item.studentId === 'release-normal-person-1' && item.term === '2026-H2').points, 0);
  const q4Enrollments = normal.state.courses.find(item => item.id === 'release-normal-q4').enrollments;
  assert.equal(q4Enrollments.find(item => item.studentId === 'release-normal-person-25').writtenExamSubjectQ4, false);
  assert.equal(q4Enrollments.find(item => item.studentId === 'release-normal-person-26').writtenExamSubjectQ4, true);
  assert.equal(expected.normal.s1.averageBefore, 3);
  assert.equal(expected.normal.s1.averageAfterChangingSecondTo5, 4.5);
  assert.equal(expected.normal.q4ExpectedWrittenExams.false, 0);
  assert.equal(expected.normal.q4ExpectedWrittenExams.true, 1);
});

test('large release fixture has 224 distinct people and exactly 1075 missing scores', () => {
  const { DomainModel } = loadModules();
  const { extended, expected } = createReleaseFixtures(DomainModel, { seed: 23 });
  assert.equal(extended.state.courses.length, 8);
  assert.equal(extended.state.students.length, 224);
  assert.equal(extended.state.assessments.length, 96);
  assert.equal(extended.state.courses.reduce((sum, course) => sum + course.enrollments.length, 0), 224);
  const filled = extended.state.assessments.reduce((sum, item) => sum + Object.keys(item.scores).length, 0);
  assert.equal(filled, 1613);
  assert.equal(2688 - filled, 1075);
  assert.deepEqual(expected.extended.totals, { people: 224, courses: 8, enrollments: 224, assessments: 96, possibleCells: 2688, emptyCells: 1075, validCells: 1613 });
  const firstStudentId = 'release-extended-person-1';
  const controlValues = [0, 1].map(index => extended.state.assessments[index].scores[firstStudentId]?.valueRaw);
  assert.deepEqual(controlValues, ['4', '2']);
  assert.deepEqual(controlValues, expected.extended.firstCourseFirstStudentTwoScores.values);
  assert.equal((Number(controlValues[0]) + Number(controlValues[1])) / 2, expected.extended.firstCourseFirstStudentTwoScores.unweightedMean);
  assert.equal(expected.extended.firstCourseFirstStudentTwoScores.unweightedMean, 3);
  assert.deepEqual(Array.from([0, 1], index => extended.state.assessments[index].scores[firstStudentId].valueNumeric), [null, null]);
  const sameAgain = createReleaseFixtures(DomainModel, { seed: 23 }).extended;
  assert.deepEqual(extended.state.assessments.map(item => item.scores), sameAgain.state.assessments.map(item => item.scores));
});
