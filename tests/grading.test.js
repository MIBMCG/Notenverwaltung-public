'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

const modules = loadModules();
const { DomainModel, GradingLogic } = modules;
const mapping = DomainModel.createDefaultGradeMapping();

// Exact values from createDefaultGradeMapping. Asserting the value, not just
// the type: `typeof NaN === 'number'`, so a type check would pass on a broken
// parser and would never catch a wrong mapping entry.
const EXPECTED_GRADE_VALUES = {
  '1+': 0.7, '1': 1.0, '1-': 1.3,
  '2+': 1.7, '2': 2.0, '2-': 2.3,
  '3+': 2.7, '3': 3.0, '3-': 3.3,
  '4+': 3.7, '4': 4.0, '4-': 4.3,
  '5+': 4.7, '5': 5.0, '5-': 5.3,
  '6': 6.0
};

test('parseGradeLabel maps every standard Sek-I label to its exact value', () => {
  assert.equal(
    Object.keys(EXPECTED_GRADE_VALUES).length,
    DomainModel.STANDARD_GRADE_LABELS.length,
    'Erwartungstabelle deckt nicht alle Standardlabels ab'
  );
  for (const label of DomainModel.STANDARD_GRADE_LABELS) {
    assert.equal(
      GradingLogic.parseGradeLabel(label, mapping),
      EXPECTED_GRADE_VALUES[label],
      `falscher Wert fuer ${label}`
    );
  }
});

test('parseGradeLabel rejects malformed Sek-I input', () => {
  for (const bad of ['', '6+', '6-', '3abc', '2,5', '2.5', '03', '+3', '1e1', '0x0F', '15.0', null, undefined]) {
    assert.equal(GradingLogic.parseGradeLabel(bad, mapping), null, `faelschlich akzeptiert: ${String(bad)}`);
  }
});

test('parseGradeLabel trims surrounding whitespace', () => {
  assert.equal(GradingLogic.parseGradeLabel(' 3 ', mapping), GradingLogic.parseGradeLabel('3', mapping));
});

// Break caught: JavaScript coercion must not turn damaged persisted mapping
// values into real grades or allow negative grade values into calculations.
test('parseGradeLabel accepts only finite non-negative numeric mapping values', () => {
  for (const badValue of [null, '', '2.0', [], {}, -0.1, NaN, Infinity]) {
    assert.equal(
      GradingLogic.parseGradeLabel('Eigen', { Eigen: badValue }),
      null,
      `ungueltiger Mapping-Wert wurde akzeptiert: ${String(badValue)}`
    );
  }

  for (const validValue of [0, 1.25, 9]) {
    assert.equal(
      GradingLogic.parseGradeLabel('Eigen', { Eigen: validValue }),
      validValue,
      `gueltiger Mapping-Wert wurde abgelehnt: ${validValue}`
    );
  }
});

// Break caught: the settings form must not turn blank, partial or negative
// input into a persisted grade value, while retaining decimal-comma support.
test('parseGradeMappingInput accepts only complete finite non-negative input', () => {
  assert.equal(typeof GradingLogic.parseGradeMappingInput, 'function');

  for (const badValue of ['', '   ', '2abc', '-0.1', 'Infinity', null, undefined]) {
    assert.equal(
      GradingLogic.parseGradeMappingInput(badValue),
      null,
      `ungueltige Formulareingabe wurde akzeptiert: ${String(badValue)}`
    );
  }

  for (const [rawValue, expected] of [['0', 0], ['1.25', 1.25], ['2,5', 2.5], ['9', 9]]) {
    assert.equal(
      GradingLogic.parseGradeMappingInput(rawValue),
      expected,
      `gueltige Formulareingabe wurde abgelehnt: ${rawValue}`
    );
  }
});

// Break caught: a later calculation path must not reintroduce coercion after
// the mapping parser has rejected damaged persisted values.
test('computeCategoryAverage excludes damaged mapping values and keeps valid custom numbers', () => {
  const ctx = buildCourseState(modules);
  const assessment = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'Benutzerdefinierte Note'
  });
  setScore(modules, assessment, ctx.students[0].id, 'Eigen');

  for (const badValue of [null, '', '2.0', [], {}, -0.1, NaN, Infinity]) {
    ctx.state.settings.gradeMapping.Eigen = badValue;
    assert.equal(
      GradingLogic.computeCategoryAverage(
        [assessment], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
      ),
      null,
      `beschaedigter Mapping-Wert floss in die Berechnung ein: ${String(badValue)}`
    );
  }

  for (const validValue of [0, 1.25, 9]) {
    ctx.state.settings.gradeMapping.Eigen = validValue;
    assert.equal(
      GradingLogic.computeCategoryAverage(
        [assessment], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
      ),
      validValue,
      `gueltiger benutzerdefinierter Wert ging verloren: ${validValue}`
    );
  }
});

test('parseUpperSecPoints accepts whole points 0 to 15 only', () => {
  for (let points = 0; points <= 15; points++) {
    assert.equal(GradingLogic.parseUpperSecPoints(String(points)), points);
  }
  for (const bad of ['-1', '16', '7.5', '', '+3', '1e1', 'Infinity', '15.0']) {
    assert.equal(GradingLogic.parseUpperSecPoints(bad), null, `faelschlich akzeptiert: ${bad}`);
  }
});

// Builds one assessment carrying a single score with the given status and
// returns the resulting category average.
function averageForStatus(status) {
  const ctx = buildCourseState(modules);
  const { state, course, students, categoryIds } = ctx;
  const asm = DomainModel.createAssessment({
    courseId: course.id, categoryId: categoryIds.written, title: 'S1', term: null, date: null, weight: 1
  });
  asm.scores[students[0].id] = DomainModel.createScoreEntry({ valueRaw: '1', status });
  DomainModel.addAssessmentToState(state, asm);
  return GradingLogic.computeCategoryAverage(
    [asm], course, students[0].id, categoryIds.written, state.settings
  );
}

// Positive control. Without it, the null assertions below could be passing
// because the assessment never reached the calculation at all.
test('a valid score is counted, so the status tests isolate status alone', () => {
  assert.equal(averageForStatus(modules.DomainModel.SCORE_STATUS.VALID), 1);
});

test('missing and excused scores contribute nothing', () => {
  for (const status of [DomainModel.SCORE_STATUS.MISSING, DomainModel.SCORE_STATUS.EXCUSED]) {
    assert.equal(averageForStatus(status), null, `Status ${status} wurde nicht ignoriert`);
  }
});

// Weighted mean across the three default categories, using the default
// Sek-I template. Grades 1 / 4 / 4 across written / oral / other.
function buildThreeCategoryCourse() {
  const ctx = buildCourseState(modules);
  const written = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1' });
  const oral = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.oral, title: 'M1' });
  const other = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.other, title: 'O1' });
  setScore(modules, written, ctx.students[0].id, '1');
  setScore(modules, oral, ctx.students[0].id, '4');
  setScore(modules, other, ctx.students[0].id, '4');
  ctx.course.weightTemplateId = ctx.state.settings.weightTemplates[0].id;
  return ctx;
}

test('computeOverallGrade combines categories by their template weights', () => {
  const ctx = buildThreeCategoryCourse();
  const overall = GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state);
  // Schriftlich 1,0 (50 %) + Muendlich 4,0 (40 %) + Sonstiges 4,0 (10 %)
  // = (1*50 + 4*40 + 4*10) / 100 = 2,5. Der exakte Wert ist berechenbar, also
  // wird er auch geprueft — ein ungewichtetes Mittel (3,0) muss durchfallen.
  assert.equal(overall, 2.5);
});

test('K2/M31: an archived Sek-I H2 course uses both school-year terms', () => {
  const ctx = buildCourseState(modules);
  const older = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Historisch H1', term: '2020-H1'
  });
  const latest = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Historisch H2', term: '2020-H2'
  });
  setScore(modules, older, ctx.students[0].id, '4');
  setScore(modules, latest, ctx.students[0].id, '2');
  DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});

  assert.equal(
    GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state),
    3,
    'der Archivkurs muss H1 und H2 seines Schuljahres gemeinsam auswerten'
  );
});

test('K2/M31: a legacy include flag does not change the automatic Sek-I H2 scope', () => {
  const ctx = buildCourseState(modules);
  ctx.course.includePrevTermGrades = true;
  const older = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Historisch H1', term: '2020-H1'
  });
  const latest = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Historisch H2', term: '2020-H2'
  });
  setScore(modules, older, ctx.students[0].id, '4');
  setScore(modules, latest, ctx.students[0].id, '2');
  DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});

  assert.equal(
    GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state),
    3,
    'bei aktiviertem Vorhalbjahr muessen H1 und H2 des Archivjahres zaehlen'
  );
});

test('M1: a deactivated category must not contribute to the overall grade', () => {
  const ctx = buildThreeCategoryCourse();
  const withAll = GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state);
  const other = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.other);
  other.active = false;
  const withoutOther = GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state);
  assert.notEqual(withoutOther, withAll);
  // Ohne "Sonstiges" bleiben Schriftlich 1,0 (50 %) und Muendlich 4,0 (40 %):
  // (1*50 + 4*40) / 90 = 2,3333... Nur Ungleichheit zu pruefen wuerde auch
  // eine falsche Korrektur durchgehen lassen.
  assert.ok(
    Math.abs(withoutOther - 210 / 90) < 1e-9,
    `erwartet 2,3333, erhalten ${withoutOther}`
  );
});

test('M2: createAssessment must preserve a weight of 0', () => {
  const ctx = buildCourseState(modules);
  const zero = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S2', weight: 0 });
  assert.equal(zero.weight, 0, 'createAssessment macht aus Gewicht 0 eine 1');
});

test('M2: missing or blank assessment weights keep the default of 1', () => {
  const ctx = buildCourseState(modules);
  for (const [index, weight] of [null, '', 'ungueltig'].entries()) {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written,
      title: `S${index + 1}`,
      weight
    });
    assert.equal(assessment.weight, 1, `ungueltiges Gewicht ${JSON.stringify(weight)} wurde nicht normalisiert`);
  }
});

test('M2: an assessment weight of 0 must not be treated as 1', () => {
  const ctx = buildCourseState(modules);
  const good = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1', weight: 1 });
  const ignored = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S2' });
  ignored.weight = 0; // umgeht createAssessment bewusst, siehe Test darueber
  assert.equal(ignored.weight, 0);
  setScore(modules, good, ctx.students[0].id, '1');
  setScore(modules, ignored, ctx.students[0].id, '5');
  const average = GradingLogic.computeCategoryAverage(
    [good, ignored], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );
  assert.equal(average, 1, 'die Leistung mit Gewicht 0 darf nicht einfliessen');
});

test('M2: a negative assessment weight must not produce a negative average', () => {
  const ctx = buildCourseState(modules);
  const good = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1', weight: 2 });
  const bad = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S2', weight: -1 });
  setScore(modules, good, ctx.students[0].id, '1');
  setScore(modules, bad, ctx.students[0].id, '5');
  const average = GradingLogic.computeCategoryAverage(
    [good, bad], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );
  // Ein negatives Gewicht wird wie Gewicht 0 behandelt (ausschliessen bzw.
  // klemmen); dann bleibt (1*2) / 2 = 1. Diese Zusicherung legt die
  // Korrekturmethode fuer Phase 1 bewusst fest — `>= 1` waere nach oben
  // offen und wuerde etwa Math.abs (2,33) ebenfalls akzeptieren.
  assert.equal(average, 1, `erwartet 1, erhalten ${average}`);
});

test('M2: a zero-weight assessment is ignored inside a subcategory', () => {
  const ctx = buildCourseState(modules);
  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [{ id: 'subcat_exam', name: 'Klausuren', weightPercent: 100 }];
  const counted = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_exam', title: 'S1', weight: 1
  });
  const ignored = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_exam', title: 'S2', weight: 0
  });
  setScore(modules, counted, ctx.students[0].id, '1');
  setScore(modules, ignored, ctx.students[0].id, '5');

  const average = GradingLogic.computeCategoryAverage(
    [counted, ignored], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );

  assert.equal(average, 1, 'Gewicht 0 wurde in der Unterkategorie mitgerechnet');
});

test('H2: a subcategory with weight 0 must not null out its category', () => {
  const ctx = buildCourseState(modules);
  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [{ id: 'subcat_test', name: 'Klausuren', weightPercent: 0 }];
  const asm = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'S1', subcategoryId: 'subcat_test'
  });
  setScore(modules, asm, ctx.students[0].id, '1');
  const average = GradingLogic.computeCategoryAverage(
    [asm], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );
  assert.equal(average, 1);
});

test('H3: assessments without a subcategory must keep counting', () => {
  const ctx = buildCourseState(modules);
  const asm = addAssessment(modules, ctx, { categoryId: ctx.categoryIds.written, title: 'S1' });
  setScore(modules, asm, ctx.students[0].id, '1');
  const before = GradingLogic.computeCategoryAverage(
    [asm], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );
  assert.equal(before, 1);

  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [{ id: 'subcat_neu', name: 'Klausuren', weightPercent: 100 }];
  const after = GradingLogic.computeCategoryAverage(
    [asm], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );
  assert.equal(after, before, 'vorhandene Leistung verschwindet nach Anlegen einer Unterkategorie');
});

test('H2: a used zero-weight subcategory keeps the whole category in flat fallback', () => {
  const ctx = buildCourseState(modules);
  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [
    { id: 'subcat_exam', name: 'Klausuren', weightPercent: 60 },
    { id: 'subcat_other', name: 'Sonstige Leistung', weightPercent: 0 }
  ];
  const exam = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_exam', title: 'Klausur', weight: 1
  });
  const other = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_other', title: 'Praesentation', weight: 1
  });
  setScore(modules, exam, ctx.students[0].id, '1');
  setScore(modules, other, ctx.students[0].id, '5');

  const average = GradingLogic.computeCategoryAverage(
    [exam, other], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );

  assert.equal(average, 3, 'die Leistung der Nullgewicht-Gruppe darf nicht verschwinden');
});

test('H3: an assessment with a deleted subcategory keeps the category in flat fallback', () => {
  const ctx = buildCourseState(modules);
  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [{ id: 'subcat_existing', name: 'Vorhanden', weightPercent: 100 }];
  const assigned = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_existing', title: 'Zugeordnet', weight: 1
  });
  const orphaned = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_deleted', title: 'Verwaist', weight: 1
  });
  setScore(modules, assigned, ctx.students[0].id, '1');
  setScore(modules, orphaned, ctx.students[0].id, '5');

  const average = GradingLogic.computeCategoryAverage(
    [assigned, orphaned], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );

  assert.equal(average, 3, 'eine geloeschte Unterkategorie darf die alte Leistung nicht verstecken');
});

test('valid subcategory assignments still use hierarchical weights', () => {
  const ctx = buildCourseState(modules);
  const written = ctx.state.settings.categories.find(c => c.id === ctx.categoryIds.written);
  written.subcategories = [
    { id: 'subcat_exam', name: 'Klausuren', weightPercent: 75 },
    { id: 'subcat_other', name: 'Sonstige Leistung', weightPercent: 25 }
  ];
  const exam = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_exam', title: 'Klausur', weight: 1
  });
  const other = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, subcategoryId: 'subcat_other', title: 'Praesentation', weight: 1
  });
  setScore(modules, exam, ctx.students[0].id, '1');
  setScore(modules, other, ctx.students[0].id, '5');

  const average = GradingLogic.computeCategoryAverage(
    [exam, other], ctx.course, ctx.students[0].id, ctx.categoryIds.written, ctx.state.settings
  );

  assert.equal(average, 2, '75 Prozent von 1 plus 25 Prozent von 5 ergeben 2');
});

function buildMixedQ4BasicCourse() {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 2 });
  ctx.course.upperSecContext = {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  DomainModel.setWrittenExamSubjectQ4(ctx.state, ctx.course.id, ctx.students[0].id, true);

  const written = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q4-Klausur', term: '2026-H2'
  });
  const oral = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term: '2026-H2'
  });
  const other = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.other, title: 'Weitere Leistung', term: '2026-H2'
  });
  for (const student of ctx.students) {
    setScore(modules, written, student.id, '15');
    setScore(modules, oral, student.id, '9');
    setScore(modules, other, student.id, '9');
  }
  return { ...ctx, assessments: [written, oral, other], written };
}

function buildAdvancedWarningCase(scoreEntries) {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  const term = '2026-H1';
  ctx.course.upperSecContext = {
    courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED,
    qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
  ctx.course.weightTemplateId = DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  const assessments = scoreEntries.map((entry, index) => {
    const assessment = addAssessment(modules, ctx, {
      categoryId: ctx.categoryIds.written, title: `Klausur ${index + 1}`, term
    });
    assessment.scores[ctx.students[0].id] = DomainModel.createScoreEntry(entry);
    return assessment;
  });
  const general = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.oral, title: 'Allgemeiner Teil', term
  });
  setScore(modules, general, ctx.students[0].id, '10');
  assessments.push(general);
  return { ...ctx, assessments, term };
}

test('M31 final review: an LK with every written assessment missed emits only a manual warning', () => {
  const ctx = buildAdvancedWarningCase([
    { status: DomainModel.SCORE_STATUS.MISSING },
    { status: DomainModel.SCORE_STATUS.MISSING }
  ]);
  const calculatedBefore = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.state.settings, ctx.term
  );
  const warning = GradingLogic.resolveUpperSecAssessmentWarning(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.term, ctx.state.settings
  );
  assert.equal(warning.code, 'lk-written-manual-decision');
  assert.equal(warning.requiresManualDecision, true);
  assert.match(warning.message, /manuell|fachlich/i);
  assert.equal(
    GradingLogic.computeWeightedOverallForAssessments(
      ctx.assessments, ctx.course, ctx.students[0].id, ctx.state.settings, ctx.term
    ),
    calculatedBefore,
    'the warning helper must not decide or mutate the calculated result'
  );
});

test('M31 final review: an LK with all valid written scores at zero emits the manual warning', () => {
  const ctx = buildAdvancedWarningCase([
    { valueRaw: '0', valueNumeric: 0, status: DomainModel.SCORE_STATUS.VALID },
    { valueRaw: '0', valueNumeric: 0, status: DomainModel.SCORE_STATUS.VALID }
  ]);
  const warning = GradingLogic.resolveUpperSecAssessmentWarning(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.term, ctx.state.settings
  );
  assert.equal(warning && warning.code, 'lk-written-manual-decision');
});

test('M31 final re-review: an LK mixture of missed and valid zero written scores emits the manual warning', () => {
  const ctx = buildAdvancedWarningCase([
    { status: DomainModel.SCORE_STATUS.MISSING },
    { valueRaw: '0', valueNumeric: 0, status: DomainModel.SCORE_STATUS.VALID }
  ]);
  const warning = GradingLogic.resolveUpperSecAssessmentWarning(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.term, ctx.state.settings
  );
  assert.equal(warning && warning.code, 'lk-written-manual-decision');
});

test('M31 final review: one nonzero LK written score suppresses the manual warning', () => {
  const ctx = buildAdvancedWarningCase([
    { valueRaw: '0', valueNumeric: 0, status: DomainModel.SCORE_STATUS.VALID },
    { valueRaw: '1', valueNumeric: 1, status: DomainModel.SCORE_STATUS.VALID }
  ]);
  assert.equal(
    GradingLogic.resolveUpperSecAssessmentWarning(
      ctx.assessments, ctx.course, ctx.students[0].id, ctx.term, ctx.state.settings
    ),
    null
  );
});

test('M31 final review: unparsed valid entries are not mistaken for zero-point scores', () => {
  const ctx = buildAdvancedWarningCase([
    { valueRaw: '', valueNumeric: null, status: DomainModel.SCORE_STATUS.VALID },
    { valueRaw: '', valueNumeric: null, status: DomainModel.SCORE_STATUS.VALID }
  ]);
  assert.equal(
    GradingLogic.resolveUpperSecAssessmentWarning(
      ctx.assessments, ctx.course, ctx.students[0].id, ctx.term, ctx.state.settings
    ),
    null
  );
});

test('M31: one mixed Q4 basic course resolves person-specific effective weights', () => {
  const ctx = buildMixedQ4BasicCourse();
  const marked = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.state.settings, '2026-H2'
  );
  const unmarked = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[1].id, ctx.state.settings, '2026-H2'
  );
  assert.ok(Math.abs(marked - 11) < 0.001, `markierte Person: ${marked}`);
  assert.equal(unmarked, 9, 'ohne 3. Pruefungsfach darf die Klausur nicht zaehlen');
  assert.equal(ctx.written.scores[ctx.students[1].id].valueRaw, '15', 'der Altwert darf nicht geloescht werden');
});

test('M31: the Q4 flag has no effect in Q3', () => {
  const ctx = buildMixedQ4BasicCourse();
  const q3 = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[1].id, ctx.state.settings, '2026-H1'
  );
  assert.ok(Math.abs(q3 - 11) < 0.001, `Q3 muss die Klausur fuer alle einbeziehen: ${q3}`);
});

test('M31: a deliberate course-wide weighting deviation remains effective for a marked Q4 student', () => {
  const ctx = buildMixedQ4BasicCourse();
  ctx.course.weightTemplateId = DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS;
  ctx.course.upperSecContext.weightingDeviationReason = 'Paedagogischer Spielraum';
  const result = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[0].id, ctx.state.settings, '2026-H2'
  );
  assert.equal(result, 12);
  const recommendation = GradingLogic.resolveUpperSecGradingContext(
    ctx.course, ctx.students[0].id, '2026-H2', ctx.state.settings
  );
  assert.equal(recommendation.isWeightingDeviation, true);
});

test('M31: unsafe category roles do not trigger automatic Q4 reweighting', () => {
  const ctx = buildMixedQ4BasicCourse();
  ctx.state.settings.weightTemplates = ctx.state.settings.weightTemplates.filter(template =>
    template.id !== DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM &&
    template.id !== DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
  );
  ctx.course.weightTemplateId = null;
  const recommendation = GradingLogic.resolveUpperSecGradingContext(
    ctx.course, ctx.students[1].id, '2026-H2', ctx.state.settings
  );
  assert.equal(recommendation.status, 'not-applicable');
  assert.equal(recommendation.recommendedWrittenPercent, null);
  const result = GradingLogic.computeWeightedOverallForAssessments(
    ctx.assessments, ctx.course, ctx.students[1].id, ctx.state.settings, '2026-H2'
  );
  assert.equal(result, 11, 'ohne sichere Rollen bleibt die bestehende Gleichverteilung aktiv');
});

test('M31 final review: a stable one-exam template ID with 80/20 is not a safe recommendation', () => {
  const ctx = buildMixedQ4BasicCourse();
  const oneExam = ctx.state.settings.weightTemplates.find(template =>
    template.id === DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
  );
  oneExam.items[0].weightPercent = 80;
  oneExam.items[1].weightPercent = 20;
  if (oneExam.items[2]) oneExam.items[2].weightPercent = 0;

  const result = GradingLogic.resolveUpperSecGradingContext(
    ctx.course, ctx.students[0].id, '2026-H2', ctx.state.settings
  );
  assert.notEqual(result.status, 'recommendation');
  assert.equal(result.recommendedWeightTemplateId, null);
  assert.match(result.message, /nicht automatisch anwendbar/i);
});

test('M31 final re-review: ambiguous written-role percentages yield no safe recommendation', () => {
  const ctx = buildMixedQ4BasicCourse();
  const [firstCategory, secondCategory, thirdCategory] = ctx.state.settings.categories;
  ctx.state.settings.weightTemplates = [
    {
      id: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
      name: 'Mehrdeutig 1/3',
      items: [
        { categoryId: firstCategory.id, weightPercent: 33.33 },
        { categoryId: secondCategory.id, weightPercent: 33.33 },
        { categoryId: thirdCategory.id, weightPercent: 33.34 }
      ]
    },
    {
      id: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
      name: 'Mehrdeutig 1/2',
      items: [
        { categoryId: firstCategory.id, weightPercent: 50 },
        { categoryId: secondCategory.id, weightPercent: 50 },
        { categoryId: thirdCategory.id, weightPercent: 0 }
      ]
    }
  ];

  const result = GradingLogic.resolveUpperSecGradingContext(
    ctx.course, ctx.students[0].id, '2026-H2', ctx.state.settings
  );

  assert.notEqual(result.status, 'recommendation');
  assert.equal(result.recommendedWeightTemplateId, null);
});

test('M31: archived Sek II keeps H1 and H2 strictly separate despite a legacy include flag', () => {
  const ctx = buildCourseState(modules, { schemaMode: 'uppersec', studentCount: 1 });
  ctx.course.upperSecContext = {
    courseType: 'basic', qualificationYear: 'q1-q2', weightingDeviationReason: null
  };
  ctx.course.includePrevTermGrades = true;
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q1', term: '2026-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Q2', term: '2026-H2'
  });
  setScore(modules, h1, ctx.students[0].id, '15');
  setScore(modules, h2, ctx.students[0].id, '9');
  DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  assert.equal(GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state), 9);
});

test('M31: archived Sek-I H2 combines all individual H1 and H2 assessments automatically', () => {
  const ctx = buildCourseState(modules, { schemaMode: 'grades', studentCount: 1 });
  ctx.course.includePrevTermGrades = false;
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1', term: '2026-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2', term: '2026-H2'
  });
  setScore(modules, h1, ctx.students[0].id, '1');
  setScore(modules, h2, ctx.students[0].id, '5');
  DomainModel.archiveCourse(ctx.state, ctx.course.id, 'manual', {});
  assert.equal(GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state), 3);
});

test('M31 task-7: browser diagnostics preserve complete payloads, excluded items and order', () => {
  const ctx = buildCourseState(modules, { schemaMode: 'grades', studentCount: 1 });
  const h1 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1', term: '2026-H1'
  });
  const h2 = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H2', term: '2026-H2'
  });
  const old = addAssessment(modules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'Alt', term: '2025-H2'
  });
  setScore(modules, h1, ctx.students[0].id, '1');
  setScore(modules, h2, ctx.students[0].id, '5');
  setScore(modules, old, ctx.students[0].id, '6');
  modules.sandbox.window.DEBUG_PREVTERM = true;

  const result = GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2026-H2');

  const entries = modules.logs.filter(log => log.level === 'debug');
  assert.deepEqual(entries.map(entry => entry.args[0]), [
    '[DEBUG computeOverallGrade]',
    '[DEBUG computeOverallGrade]',
    '[DEBUG computeOverallGrade]',
    '[DEBUG computeOverallGrade result]'
  ]);
  assert.deepEqual(entries.slice(0, 3).map(entry => Object.keys(entry.args[1])), [
    ['courseId', 'courseName', 'includedTerms', 'assessmentId', 'inferredTerm', 'currentTerm', 'previousTerm', 'included'],
    ['courseId', 'courseName', 'includedTerms', 'assessmentId', 'inferredTerm', 'currentTerm', 'previousTerm', 'included'],
    ['courseId', 'courseName', 'includedTerms', 'assessmentId', 'inferredTerm', 'currentTerm', 'previousTerm', 'included']
  ]);
  assert.deepEqual(entries.slice(0, 3).map(entry => ({
    courseId: entry.args[1].courseId,
    courseName: entry.args[1].courseName,
    includedTerms: Array.from(entry.args[1].includedTerms),
    assessmentId: entry.args[1].assessmentId,
    inferredTerm: entry.args[1].inferredTerm,
    currentTerm: entry.args[1].currentTerm,
    previousTerm: entry.args[1].previousTerm,
    included: entry.args[1].included
  })), [
    {
      courseId: ctx.course.id, courseName: ctx.course.name,
      includedTerms: ['2026-H2', '2026-H1'], assessmentId: h1.id,
      inferredTerm: '2026-H1', currentTerm: '2026-H2', previousTerm: '2026-H1', included: true
    },
    {
      courseId: ctx.course.id, courseName: ctx.course.name,
      includedTerms: ['2026-H2', '2026-H1'], assessmentId: h2.id,
      inferredTerm: '2026-H2', currentTerm: '2026-H2', previousTerm: '2026-H1', included: true
    },
    {
      courseId: ctx.course.id, courseName: ctx.course.name,
      includedTerms: ['2026-H2', '2026-H1'], assessmentId: old.id,
      inferredTerm: '2025-H2', currentTerm: '2026-H2', previousTerm: '2026-H1', included: false
    }
  ]);
  assert.deepEqual(Object.keys(entries[3].args[1]), ['courseId', 'courseName', 'result']);
  assert.deepEqual(JSON.parse(JSON.stringify(entries[3].args[1])), {
    courseId: ctx.course.id,
    courseName: ctx.course.name,
    result
  });
});

test('M31 task-7: browser diagnostic failures cannot change grade results', () => {
  const localModules = loadModules();
  const ctx = buildCourseState(localModules, { schemaMode: 'grades', studentCount: 1 });
  const assessment = addAssessment(localModules, ctx, {
    categoryId: ctx.categoryIds.written, title: 'H1', term: '2026-H1'
  });
  setScore(localModules, assessment, ctx.students[0].id, '2');
  localModules.sandbox.window.DEBUG_PREVTERM = true;
  localModules.sandbox.console.debug = () => { throw new Error('synthetic logger failure'); };

  assert.equal(
    localModules.GradingLogic.computeOverallGrade(ctx.course, ctx.students[0].id, ctx.state, '2026-H1'),
    2
  );
});

test('LOW: a regular course name cannot enable previous-term debug logging', () => {
  const localModules = loadModules();
  const ctx = buildCourseState(localModules, { schemaMode: 'grades', studentCount: 1 });
  ctx.course.name = 'Oberstufe Test';
  const assessment = addAssessment(localModules, ctx, {
    categoryId: ctx.categoryIds.written,
    title: 'H1',
    term: '2026-H1'
  });
  setScore(localModules, assessment, ctx.students[0].id, '2');

  localModules.GradingLogic.computeOverallGrade(
    ctx.course,
    ctx.students[0].id,
    ctx.state,
    '2026-H1'
  );

  assert.deepEqual(
    localModules.logs.filter(entry => entry.level === 'debug'),
    [],
    'nur der ausdrückliche DEBUG_PREVTERM-Schalter darf Debugausgaben aktivieren'
  );
});
