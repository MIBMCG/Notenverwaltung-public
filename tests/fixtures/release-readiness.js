'use strict';

// Fixed synthetic data for the release matrix. IDs, dates, cell counts and
// control oracles are declared here without calling grading calculations.
function createReleaseFixtures(DomainModel, { seed = 23 } = {}) {
  function categories(state) {
    const byName = name => state.settings.categories.find(item => item.name === name).id;
    const project = DomainModel.createCategory({ id: 'release-category-project', name: 'Projekt' });
    state.settings.categories.push(project);
    return [byName('Schriftlich'), byName('Mündlich'), byName('Sonstiges'), project.id];
  }
  function person(state, id, serial, homeClass) {
    const student = DomainModel.createStudent({
      id,
      lastName: `Testperson ${String(serial).padStart(3, '0')}`,
      firstName: `Vorname ${String(serial).padStart(3, '0')}`,
      homeClass
    });
    DomainModel.addStudentToState(state, student);
    return student;
  }
  function course(state, id, name, schemaMode, extra = {}) {
    const created = DomainModel.createCourse({
      id, name, subject: 'Synthetisches Testfach', classLabel: 'T1', schemaMode,
      schoolYearStartYear: 2026, ...extra
    });
    DomainModel.addCourseToState(state, created);
    return created;
  }
  function assessment(state, courseId, categoryId, index, term = '2026-H2') {
    const created = DomainModel.createAssessment({
      id: `release-assessment-${courseId}-${index + 1}`,
      courseId, categoryId, title: `Synthetische Leistung ${index + 1}`,
      date: `2027-03-${String(1 + index).padStart(2, '0')}`,
      term, termAssignment: 'manual', weight: 1
    });
    DomainModel.addAssessmentToState(state, created);
    return created;
  }
  function score(assessmentValue, studentId, raw) {
    assessmentValue.scores[studentId] = DomainModel.createScoreEntry({
      valueRaw: String(raw), status: DomainModel.SCORE_STATUS.VALID, valueNumeric: null
    });
  }

  const normalState = DomainModel.createEmptyState();
  normalState.settings.schoolProfile = DomainModel.normalizeSchoolProfile({ name: 'Synthetische Testschule', logoMode: 'none' });
  const normalCats = categories(normalState);
  const sekI = course(normalState, 'release-normal-seki', 'Sek I T1', DomainModel.SCHEMA_MODES.GRADES);
  const q4 = course(normalState, 'release-normal-q4', 'Q4 Grundkurs T1', DomainModel.SCHEMA_MODES.UPPERSEC, {
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4
    }
  });
  const archived = course(normalState, 'release-normal-archive', 'Archiv T1', DomainModel.SCHEMA_MODES.GRADES);
  const sekIPeople = Array.from({ length: 24 }, (_, index) => {
    const item = person(normalState, `release-normal-person-${index + 1}`, index + 1, 'T1');
    DomainModel.enrollStudentInCourse(normalState, sekI.id, item.id);
    return item;
  });
  const q4People = [sekIPeople[0]];
  DomainModel.enrollStudentInCourse(normalState, q4.id, sekIPeople[0].id);
  for (let index = 1; index < 16; index++) {
    const item = person(normalState, `release-normal-person-${24 + index}`, 24 + index, 'Q4');
    DomainModel.enrollStudentInCourse(normalState, q4.id, item.id);
    q4People.push(item);
  }
  DomainModel.enrollStudentInCourse(normalState, archived.id, sekIPeople[0].id);
  const sekIAssessments = Array.from({ length: 6 }, (_, index) =>
    assessment(normalState, sekI.id, index < 2 ? normalCats[0] : normalCats[index % normalCats.length], index));
  const q4Assessments = Array.from({ length: 4 }, (_, index) =>
    assessment(normalState, q4.id, normalCats[index], index));
  const archiveAssessment = DomainModel.createAssessment({
    id: 'release-assessment-archive-manual-h1', courseId: archived.id,
    categoryId: normalCats[0], title: 'Synthetische Archivleistung',
    date: '2026-01-15', term: '2025-H1', termAssignment: 'manual', weight: 1
  });
  DomainModel.addAssessmentToState(normalState, archiveAssessment);
  for (const index of [0, 1]) {
    score(sekIAssessments[index], sekIPeople[0].id, index === 0 ? '4' : '2');
    score(sekIAssessments[index], sekIPeople[1].id, index === 0 ? '4' : '2');
  }
  score(sekIAssessments[0], sekIPeople[2].id, '4');
  score(q4Assessments[0], q4People[0].id, '0');
  score(archiveAssessment, sekIPeople[0].id, '3');
  DomainModel.archiveCourse(normalState, archived.id, 'manual', {
    archiveRetentionUntil: '2037-07-31', archiveNote: 'Synthetischer Archivvermerk'
  });
  archived.archivedAt = '2027-03-01T12:00:00.000Z';
  DomainModel.setTermResult(normalState, q4.id, q4People[0].id, '2026-H2', 0);
  DomainModel.setWrittenExamSubjectQ4(normalState, q4.id, q4People[2].id, true);
  const normal = {
    state: normalState,
    courses: { sekI, q4, archived },
    students: { sekI: sekIPeople, q4: q4People },
    assessments: { sekI: sekIAssessments, q4: q4Assessments, archived: archiveAssessment },
    controls: {
      s1: { studentId: sekIPeople[0].id, scores: ['4', '2'] },
      s2: {
        studentId: sekIPeople[1].id, scores: ['4', '2'],
        numericCaches: sekIAssessments.slice(0, 2).map(item => item.scores[sekIPeople[1].id].valueNumeric)
      },
      s3: {
        studentId: sekIPeople[2].id, initiallySet: '4', clearTargetAssessmentId: sekIAssessments[0].id,
        hasUntouchedNeighbor: Object.hasOwn(sekIAssessments[1].scores, sekIPeople[2].id)
      },
      q1: { studentId: q4People[0].id, score: '0', fixedPoints: 0 },
      q2: { studentId: q4People[1].id, writtenExamSubjectQ4: false },
      q3: { studentId: q4People[2].id, writtenExamSubjectQ4: true }
    }
  };

  const extendedState = DomainModel.createEmptyState();
  extendedState.settings.schoolProfile = DomainModel.normalizeSchoolProfile({ name: 'Synthetische Testschule', logoMode: 'none' });
  const extendedCats = categories(extendedState);
  const extendedCourses = [];
  const extendedAssessments = [];
  const extendedStudents = [];
  for (let courseIndex = 0; courseIndex < 8; courseIndex++) {
    const isUpperSec = courseIndex >= 4;
    const item = course(extendedState, `release-extended-course-${courseIndex + 1}`,
      `Testkurs ${courseIndex + 1}`,
      isUpperSec ? DomainModel.SCHEMA_MODES.UPPERSEC : DomainModel.SCHEMA_MODES.GRADES,
      isUpperSec ? { upperSecContext: { courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
        qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4 } } : {});
    extendedCourses.push(item);
    for (let personIndex = 0; personIndex < 28; personIndex++) {
      const serial = courseIndex * 28 + personIndex + 1;
      const student = person(extendedState, `release-extended-person-${serial}`, serial, `T${courseIndex + 1}`);
      DomainModel.enrollStudentInCourse(extendedState, item.id, student.id);
      extendedStudents.push(student);
    }
    for (let assessmentIndex = 0; assessmentIndex < 12; assessmentIndex++) {
      extendedAssessments.push(assessment(extendedState, item.id,
        extendedCats[assessmentIndex % extendedCats.length], assessmentIndex));
    }
  }
  let randomState = seed >>> 0;
  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }
  // Keep two hand-checked control cells populated; shuffle all other cell
  // positions and leave exactly 1075 absent as true sparse entries.
  const positions = Array.from({ length: 2688 }, (_, index) => index)
    .filter(index => index !== 0 && index !== 28);
  for (let index = positions.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [positions[index], positions[swap]] = [positions[swap], positions[index]];
  }
  const empty = new Set(positions.slice(0, 1075));
  for (let index = 0; index < 2688; index++) {
    if (empty.has(index)) continue;
    const courseIndex = Math.floor(index / 336);
    const assessmentIndex = Math.floor(index % 336 / 28);
    const personIndex = index % 28;
    const item = extendedAssessments[courseIndex * 12 + assessmentIndex];
    const student = extendedStudents[courseIndex * 28 + personIndex];
    const raw = index === 0 ? '4' : index === 28 ? '2'
      : String(courseIndex < 4 ? 1 + Math.floor(random() * 6) : Math.floor(random() * 16));
    score(item, student.id, raw);
  }
  return {
    normal,
    extended: { state: extendedState, courses: extendedCourses, students: extendedStudents, assessments: extendedAssessments },
    expected: {
      testDate: '2027-03-15T12:00:00',
      normal: {
        s1: { averageBefore: 3, trendBefore: 'Verbesserung', averageAfterChangingSecondTo5: 4.5, trendAfter: 'Verschlechterung' },
        s2: { average: 3, trend: 'Verbesserung' },
        q4ExpectedWrittenExams: { false: 0, true: 1 },
        q1FixedPoints: 0
      },
      extended: {
        totals: { people: 224, courses: 8, enrollments: 224, assessments: 96,
          possibleCells: 2688, emptyCells: 1075, validCells: 1613 },
        firstCourseFirstStudentTwoScores: { values: ['4', '2'], unweightedMean: 3 }
      }
    }
  };
}

module.exports = { createReleaseFixtures };
