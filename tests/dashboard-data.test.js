'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source');
const { loadModules } = require('./harness/load');

async function loadAdapter() {
  return importEsmSource('src/ui/dashboard-data.js');
}

function assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, now) {
  const before = JSON.stringify(state);
  const cards = buildDashboardCards({ state, domain, grading, now });
  assert.equal(JSON.stringify(state), before);
  return cards;
}

function addStudent(domain, state, id) {
  const student = domain.createStudent({ id, lastName: `Nachname ${id}`, firstName: 'Test' });
  domain.addStudentToState(state, student);
  return student;
}

test('keine Kurse erzeugen keine Karten und verändern den Zustand nicht', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const before = JSON.stringify(state);
  assert.equal(buildDashboardCards({ state, domain, grading, now: new Date(2026, 8, 6) }).length, 0);
  assert.equal(JSON.stringify(state), before);
});

test('archivierte Kurse erzeugen keine Karte', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const active = domain.createCourse({ id: 'active', name: 'Aktiv', subject: 'Biologie', classLabel: '10a' });
  const archived = domain.createCourse({ id: 'archived', name: 'Archiv', subject: 'Chemie', classLabel: '10b' });
  domain.addCourseToState(state, active);
  domain.addCourseToState(state, archived);
  archived.archivedAt = '2026-08-01T00:00:00.000Z';

  const cards = assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, new Date(2026, 8, 6));
  assert.deepEqual(Array.from(cards, card => card.id), ['active']);
});

test('gleichnamige Kurse bleiben durch ihre unveraenderten IDs unterscheidbar', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const first = domain.createCourse({ id: 17, name: 'Biologie', subject: 'Biologie', classLabel: '10a' });
  const second = domain.createCourse({ id: 'course-b', name: 'Biologie', subject: 'Biologie', classLabel: '10b' });
  domain.addCourseToState(state, first);
  domain.addCourseToState(state, second);

  const cards = assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, new Date(2026, 8, 6));
  assert.deepEqual(Array.from(cards, card => card.id), [17, 'course-b']);
  assert.deepEqual(Array.from(cards, card => card.name), ['Biologie', 'Biologie']);
});

test('zaehlt nur eindeutige eingeschriebene vorhandene Schueler', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const course = domain.createCourse({ id: 'counted', name: 'Mathematik', subject: 'Mathematik', classLabel: '9c' });
  domain.addCourseToState(state, course);
  addStudent(domain, state, 'stu-a');
  addStudent(domain, state, 'stu-b');
  course.enrollments = [
    domain.createEnrollment({ studentId: 'stu-a' }),
    domain.createEnrollment({ studentId: 'stu-a' }),
    domain.createEnrollment({ studentId: 'stu-b' }),
    domain.createEnrollment({ studentId: 'stu-missing' })
  ];

  const [card] = assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, new Date(2026, 8, 6));
  assert.equal(card.studentCount, 2);
});

test('Sek-I-Kursstichtage bestimmen das konkrete Halbjahreslabel', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const course = domain.createCourse({
    id: 'seki', name: 'Geschichte', subject: 'Geschichte', classLabel: '9a',
    termCutoffs: { h2StartMonth: 1, h2StartDay: 15 }
  });
  domain.addCourseToState(state, course);

  const now = new Date(2026, 1, 1);
  const [card] = assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, now);
  assert.equal(card.termLabel, '25/26 H2');
  const settings = grading.getSettingsForCourse(course, state);
  assert.equal(grading.resolveAssessmentTermFromDateValue(now, course, settings), '2025-H2');
  assert.equal(grading.formatCourseTermLabel('2025-H2', course, settings), '25/26 H2');
});

test('Sek-II-Kurse verwenden Q1 bis Q4 aus ihrem Kurskontext', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const cases = [
    ['q1', 'q1-q2', new Date(2026, 8, 20), '26/27 Q1'],
    ['q2', 'q1-q2', new Date(2027, 1, 10), '26/27 Q2'],
    ['q3', 'q3-q4', new Date(2026, 8, 20), '26/27 Q3'],
    ['q4', 'q3-q4', new Date(2027, 1, 10), '26/27 Q4']
  ];

  for (const [id, qualificationYear, now, expectedLabel] of cases) {
    const course = domain.createCourse({
      id, name: `Kurs ${id}`, subject: 'Biologie', classLabel: 'Q',
      schemaMode: domain.SCHEMA_MODES.UPPERSEC,
      upperSecContext: { courseType: 'basic', qualificationYear }
    });
    domain.addCourseToState(state, course);
    const [card] = assertCardsLeaveStateUntouched(buildDashboardCards, {
      ...state,
      courses: [course]
    }, domain, grading, now);
    assert.equal(card.termLabel, expectedLabel, id);
  }
});

test('normalisiert Textwerte und zeigt bei fehlendem Zeitraum den neutralen Hinweis', async () => {
  const { buildDashboardCards } = await loadAdapter();
  const { DomainModel: domain, GradingLogic: grading } = loadModules();
  const state = domain.createEmptyState();
  const course = domain.createCourse({ id: 'text', name: 42, subject: null, classLabel: false });
  domain.addCourseToState(state, course);

  const [card] = assertCardsLeaveStateUntouched(buildDashboardCards, state, domain, grading, new Date('invalid'));
  assert.deepEqual(JSON.parse(JSON.stringify(card)), {
    id: 'text', name: '42', subject: '', classLabel: 'false', studentCount: 0,
    termLabel: 'Zeitraum nicht verfügbar'
  });
});
