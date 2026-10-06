import {
  SCHEMA_MODES,
  UPPERSEC_COURSE_TYPES,
  SCORE_STATUS,
  RECOMMENDED_WEIGHT_TEMPLATE_IDS,
  STANDARD_GRADE_LABELS,
  createDefaultGradeMapping
} from './state.js';
import {
  resolveQualificationPhase,
  findEnrollment,
  resolveUpperSecWrittenCategoryId,
  listEnrollmentsForCourse
} from './courses.js';
import { resolveGradingResultScope } from './terms.js';
import { parseDecimalInput } from '../formatting/numbers.js';

const UPPERSEC_POINTS_TO_GRADE = Object.freeze({
  15: '1+', 14: '1', 13: '1-',
  12: '2+', 11: '2', 10: '2-',
  9: '3+', 8: '3', 7: '3-',
  6: '4+', 5: '4', 4: '4-',
  3: '5+', 2: '5', 1: '5-', 0: '6'
});

export function parseGradeLabel(label, mapping) {
  if (label === null || label === undefined) return null;
  const trimmed = String(label).trim();
  if (!trimmed) return null;

  if (trimmed === '6+' || trimmed === '6-') return null;

  if (mapping && Object.prototype.hasOwnProperty.call(mapping, trimmed)) {
    const value = mapping[trimmed];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null;
  }

  if (!STANDARD_GRADE_LABELS.includes(trimmed)) return null;
  const standardMapping = createDefaultGradeMapping();
  return standardMapping[trimmed];
}

export function parseGradeMappingInput(rawValue) {
  const value = parseDecimalInput(rawValue);
  return value !== null && value >= 0 ? value : null;
}

export function parseUpperSecPoints(label) {
  if (label === null || label === undefined) return null;
  const trimmed = String(label).trim();
  if (!trimmed) return null;

  if (!/^\d+$/.test(trimmed)) return null;
  const val = parseInt(trimmed, 10);
  if (!Number.isFinite(val)) return null;
  if (val < 0 || val > 15) return null;
  return val;
}

export function isValidRawForCourse(raw, course, settings) {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).trim();
  if (!s) return false;

  if (!course || course.schemaMode === SCHEMA_MODES.GRADES) {
    const mapping = settings && settings.gradeMapping;
    return parseGradeLabel(s, mapping) !== null;
  }

  if (course.schemaMode === SCHEMA_MODES.UPPERSEC) {
    if (!/^\d+$/.test(s)) return false;
    const n = Number(s);
    if (!Number.isFinite(n)) return false;
    return n >= 0 && n <= 15;
  }

  return false;
}

export function getNumericScoreForEntry(scoreEntry, course, settings) {
  if (!scoreEntry) return null;
  if (scoreEntry.status !== SCORE_STATUS.VALID) return null;

  if (course.schemaMode === SCHEMA_MODES.GRADES) {
    const mapping = settings.gradeMapping || {};
    return parseGradeLabel(scoreEntry.valueRaw, mapping);
  }

  if (course.schemaMode === SCHEMA_MODES.UPPERSEC) {
    if (typeof scoreEntry.valueNumeric === 'number') {
      if (Number.isInteger(scoreEntry.valueNumeric) && scoreEntry.valueNumeric >= 0 && scoreEntry.valueNumeric <= 15) {
        return scoreEntry.valueNumeric;
      }
    }
    return parseUpperSecPoints(scoreEntry.valueRaw);
  }

  return null;
}

export function getUpperSecGradeLabel(points) {
  return Number.isInteger(points) && Object.prototype.hasOwnProperty.call(UPPERSEC_POINTS_TO_GRADE, points)
    ? UPPERSEC_POINTS_TO_GRADE[points]
    : null;
}

export function validatePercentageThresholds(scale, thresholds, fallbackLabel) {
  let previous = null;
  let previousLabel = null;
  for (const item of scale || []) {
    if (!item || item.label === fallbackLabel) continue;
    const rawValue = thresholds && thresholds[item.label];
    const value = Number(rawValue);
    if (rawValue === null || rawValue === undefined || rawValue === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      return {
        ok: false,
        message: `Die Prozentgrenze für ${item.label} muss eine Zahl zwischen 0 und 100 sein.`
      };
    }
    if (previous !== null && value >= previous) {
      return {
        ok: false,
        message: `Die Prozentgrenze für ${item.label} muss kleiner als die Grenze für ${previousLabel} sein; doppelte oder nicht monotone Grenzen sind nicht zulässig.`
      };
    }
    previous = value;
    previousLabel = item.label;
  }
  if (fallbackLabel !== null && fallbackLabel !== undefined) {
    const fallbackRaw = thresholds && thresholds[fallbackLabel];
    const fallbackValue = Number(fallbackRaw);
    if (fallbackRaw === null || fallbackRaw === undefined || fallbackRaw === '' || !Number.isFinite(fallbackValue) || fallbackValue < 0 || fallbackValue > 100) {
      return {
        ok: false,
        message: `Die Prozentgrenze für ${fallbackLabel} muss eine Zahl zwischen 0 und 100 sein.`
      };
    }
    if (previous !== null && fallbackValue >= previous) {
      return {
        ok: false,
        message: `Die Prozentgrenze für ${fallbackLabel} muss kleiner als die Grenze für ${previousLabel} sein; doppelte oder nicht monotone Grenzen sind nicht zulässig.`
      };
    }
  }
  return { ok: true, message: '' };
}

export function computeCategoryAverage(assessments, course, studentId, categoryId, settings) {
  const category = (settings.categories || []).find(c => c.id === categoryId);
  const categoryAssessments = assessments.filter(a => a.categoryId === categoryId);

  function computeFlatAverage() {
    let sum = 0;
    let weightSum = 0;

    for (const assessment of categoryAssessments) {
      const scoreEntry = assessment.scores ? assessment.scores[studentId] : undefined;
      const numeric = getNumericScoreForEntry(scoreEntry, course, settings);
      if (numeric === null) continue;

      const weight = Number(assessment.weight);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      sum += numeric * weight;
      weightSum += weight;
    }

    if (weightSum === 0) return null;
    return sum / weightSum;
  }

  const hasSubcategories = category && Array.isArray(category.subcategories) && category.subcategories.length > 0;

  if (hasSubcategories) {
    const subcategoryById = new Map(category.subcategories.map(subcategory => [subcategory.id, subcategory]));
    const allAssessmentsAssigned = categoryAssessments.every(assessment => subcategoryById.has(assessment.subcategoryId));
    const usedSubcategoryIds = new Set(categoryAssessments.map(assessment => assessment.subcategoryId));
    const allUsedWeightsValid = Array.from(usedSubcategoryIds).every(subcategoryId => {
      const subcategory = subcategoryById.get(subcategoryId);
      const weight = Number(subcategory && subcategory.weightPercent);
      return Number.isFinite(weight) && weight > 0;
    });

    if (!allAssessmentsAssigned || !allUsedWeightsValid) {
      return computeFlatAverage();
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const subcategory of category.subcategories) {
      const subcategoryAssessments = assessments.filter(assessment =>
        assessment.categoryId === categoryId && assessment.subcategoryId === subcategory.id
      );

      if (subcategoryAssessments.length === 0) continue;

      let subcategorySum = 0;
      let subcategoryWeightSum = 0;

      for (const assessment of subcategoryAssessments) {
        const scoreEntry = assessment.scores ? assessment.scores[studentId] : undefined;
        const numeric = getNumericScoreForEntry(scoreEntry, course, settings);
        if (numeric === null) continue;

        const weight = Number(assessment.weight);
        if (!Number.isFinite(weight) || weight <= 0) continue;
        subcategorySum += numeric * weight;
        subcategoryWeightSum += weight;
      }

      if (subcategoryWeightSum === 0) continue;

      const subcategoryAverage = subcategorySum / subcategoryWeightSum;
      const subcategoryWeight = Number(subcategory.weightPercent);

      weightedSum += subcategoryAverage * subcategoryWeight;
      totalWeight += subcategoryWeight;
    }

    if (totalWeight === 0) return null;
    return weightedSum / totalWeight;
  }

  return computeFlatAverage();
}

function resolveSafeUpperSecTemplate(settings, templateId, expectedWrittenPercent) {
  const writtenCategoryId = resolveUpperSecWrittenCategoryId(settings);
  if (!writtenCategoryId) return null;
  const templates = Array.isArray(settings && settings.weightTemplates)
    ? settings.weightTemplates
    : [];
  const template = templates.find(item => item && item.id === templateId) || null;
  if (!template || !Array.isArray(template.items) || template.items.length < 2) return null;
  const activeCategoryIds = new Set(
    (Array.isArray(settings && settings.categories) ? settings.categories : [])
      .filter(category => category && category.active !== false)
      .map(category => category.id)
  );
  const seenCategoryIds = new Set();
  let writtenPercent = null;
  let generalPercent = 0;
  for (const item of template.items) {
    const categoryId = item && item.categoryId;
    const percent = Number(item && item.weightPercent);
    if (!categoryId || seenCategoryIds.has(categoryId) ||
        !activeCategoryIds.has(categoryId) || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null;
    }
    seenCategoryIds.add(categoryId);
    if (categoryId === writtenCategoryId) writtenPercent = percent;
    else generalPercent += percent;
  }
  const tolerance = 0.01;
  return writtenPercent !== null &&
    Math.abs(writtenPercent - expectedWrittenPercent) <= tolerance &&
    Math.abs(generalPercent - (100 - expectedWrittenPercent)) <= tolerance
    ? template
    : null;
}

function categoryWeightProfilesMatch(activeWeights, recommendedItems) {
  if (!Array.isArray(activeWeights) || !Array.isArray(recommendedItems)) return false;
  const normalize = items => {
    const weights = new Map();
    let total = 0;
    for (const item of items) {
      const categoryId = item && item.categoryId;
      const weight = Number(item && item.weightPercent);
      if (!categoryId || !Number.isFinite(weight) || weight < 0 || weight > 100 || weights.has(categoryId)) return null;
      weights.set(categoryId, weight);
      total += weight;
    }
    if (total <= 0) return null;
    for (const [categoryId, weight] of weights) weights.set(categoryId, weight / total);
    return weights;
  };
  const active = normalize(activeWeights);
  const recommended = normalize(recommendedItems);
  if (!active || !recommended || active.size !== recommended.size) return false;
  const tolerance = 0.0001;
  for (const [categoryId, recommendedShare] of recommended) {
    if (!active.has(categoryId) || Math.abs(active.get(categoryId) - recommendedShare) > tolerance) return false;
  }
  return true;
}

export function resolveUpperSecGradingContext(course, studentId, term, settings) {
  const qualificationPhase = resolveQualificationPhase(course, term);
  const context = course && course.upperSecContext;
  if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC ||
      !context || !qualificationPhase || !context.courseType) {
    return {
      qualificationPhase,
      expectedExamCount: null,
      recommendedWrittenPercent: null,
      recommendedWeightTemplateId: null,
      status: 'needs-review',
      message: 'Sek-II-Kursart und Qualifikationsabschnitt muessen geprueft werden.',
      isWeightingDeviation: false
    };
  }

  if (context.courseType === UPPERSEC_COURSE_TYPES.OTHER) {
    return {
      qualificationPhase,
      expectedExamCount: null,
      recommendedWrittenPercent: null,
      recommendedWeightTemplateId: null,
      status: 'no-recommendation',
      message: 'Fuer diesen individuellen Kurs wird keine automatische Gewichtung empfohlen.',
      isWeightingDeviation: false
    };
  }

  let expectedExamCount = null;
  if (qualificationPhase === 'Q4') {
    if (context.courseType === UPPERSEC_COURSE_TYPES.ADVANCED) {
      expectedExamCount = 1;
    } else {
      if (!studentId) {
        return {
          qualificationPhase,
          expectedExamCount: null,
          recommendedWrittenPercent: null,
          recommendedWeightTemplateId: null,
          status: 'person-specific',
          message: 'Q4-Grundkurs: Die Klausurentscheidung ist personenspezifisch und wird in der Personenliste gepflegt.',
          isWeightingDeviation: false
        };
      }
      const enrollment = findEnrollment(course, studentId);
      expectedExamCount = enrollment && enrollment.writtenExamSubjectQ4 === true ? 1 : 0;
    }
  } else if (context.courseType === UPPERSEC_COURSE_TYPES.ADVANCED) {
    expectedExamCount = 2;
  } else if (context.courseType === UPPERSEC_COURSE_TYPES.BASIC) {
    expectedExamCount = 1;
  }

  if (expectedExamCount === 0) {
    const writtenCategoryId = resolveUpperSecWrittenCategoryId(settings);
    if (!writtenCategoryId) {
      return {
        qualificationPhase,
        expectedExamCount: 0,
        recommendedWrittenPercent: null,
        recommendedWeightTemplateId: null,
        status: 'not-applicable',
        message: 'Die Klausurkategorie kann nicht sicher erkannt werden; die bestehende Gewichtung bleibt unveraendert.',
        isWeightingDeviation: false
      };
    }
    return {
      qualificationPhase,
      expectedExamCount: 0,
      recommendedWrittenPercent: 0,
      recommendedWeightTemplateId: null,
      status: 'general-only',
      message: 'Q4: keine Klausur vorgesehen; bewertet wird nur der allgemeine Teil.',
      isWeightingDeviation: false
    };
  }

  const recommendedWrittenPercent = expectedExamCount === 2 ? 50 : 33.33;
  const candidateTemplateId = expectedExamCount === 2
    ? RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
    : RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
  const recommendedTemplate = resolveSafeUpperSecTemplate(
    settings,
    candidateTemplateId,
    recommendedWrittenPercent
  );
  const recommendedWeightTemplateId = recommendedTemplate ? candidateTemplateId : null;
  const status = recommendedTemplate ? 'recommendation' : 'not-applicable';
  return {
    qualificationPhase,
    expectedExamCount,
    recommendedWrittenPercent,
    recommendedWeightTemplateId,
    status,
    message: recommendedTemplate
      ? `Empfehlung: Klausurteil ${expectedExamCount === 2 ? '1/2' : '1/3'}.`
      : 'Empfehlung nicht automatisch anwendbar: Kategorienrollen und Vorlagengewichte entsprechen keinem sicheren Berliner Profil.',
    isWeightingDeviation: !!(
      recommendedTemplate && !categoryWeightProfilesMatch(
        resolveActiveCategoryWeights(course, settings),
        recommendedTemplate.items
      )
    )
  };
}

export function resolveUpperSecAssessmentWarning(assessments, course, studentId, term, settings) {
  const gradingContext = resolveUpperSecGradingContext(course, studentId, term, settings);
  const context = course && course.upperSecContext;
  if (!context || context.courseType !== UPPERSEC_COURSE_TYPES.ADVANCED ||
      !['Q1', 'Q2', 'Q3'].includes(gradingContext.qualificationPhase)) {
    return null;
  }
  const writtenCategoryId = resolveUpperSecWrittenCategoryId(settings);
  if (!writtenCategoryId) return null;
  const writtenAssessments = (Array.isArray(assessments) ? assessments : []).filter(assessment =>
    assessment && assessment.categoryId === writtenCategoryId
  );
  if (writtenAssessments.length === 0) return null;
  const entries = writtenAssessments.map(assessment =>
    assessment.scores && assessment.scores[studentId]
  );
  const allMissedOrValidZero = entries.every(entry => entry && (
    entry.status === SCORE_STATUS.MISSING ||
    (entry.status === SCORE_STATUS.VALID &&
      typeof entry.valueNumeric === 'number' && entry.valueNumeric === 0)
  ));
  if (!allMissedOrValidZero) return null;
  return {
    code: 'lk-written-manual-decision',
    requiresManualDecision: true,
    message: 'Alle Klausuren wurden versäumt oder mit 0 Punkten bewertet. Eine manuelle fachliche Entscheidung ist erforderlich; Rechenwert und Festsetzung bleiben unverändert.'
  };
}

function resolveActiveCategoryWeights(course, settings) {
  const activeCategories = Array.isArray(settings && settings.categories)
    ? settings.categories.filter(category => category && category.active !== false)
    : [];
  const activeCategoryIds = new Set(activeCategories.map(category => category.id));
  const templates = Array.isArray(settings && settings.weightTemplates)
    ? settings.weightTemplates
    : [];
  const template = course && course.weightTemplateId
    ? templates.find(item => item.id === course.weightTemplateId) || null
    : null;

  if (template && Array.isArray(template.items) && template.items.length > 0) {
    return template.items
      .filter(item => activeCategoryIds.has(item.categoryId))
      .map(item => ({
        categoryId: item.categoryId,
        weightPercent: Number(item.weightPercent)
      }));
  }

  if (activeCategories.length === 0) return [];
  const equalWeight = 1 / activeCategories.length;
  return activeCategories.map(category => ({
    categoryId: category.id,
    weightPercent: equalWeight
  }));
}

export function resolveEffectiveCategoryWeights(course, studentId, term, settings) {
  const activeWeights = resolveActiveCategoryWeights(course, settings);
  if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC || !term) {
    return activeWeights;
  }
  const context = resolveUpperSecGradingContext(course, studentId, term, settings);
  if (context.status !== 'general-only') return activeWeights;
  const writtenCategoryId = resolveUpperSecWrittenCategoryId(settings);
  if (!writtenCategoryId) return activeWeights;
  return activeWeights.filter(weight => weight.categoryId !== writtenCategoryId);
}

export function computeWeightedOverallForAssessments(assessments, course, studentId, settings, term = null) {
  if (!Array.isArray(assessments) || assessments.length === 0) return null;
  const weights = resolveEffectiveCategoryWeights(course, studentId, term, settings);
  if (weights.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const weight of weights) {
    const categoryAssessments = assessments.filter(assessment => assessment.categoryId === weight.categoryId);
    const categoryAverage = computeCategoryAverage(
      categoryAssessments,
      course,
      studentId,
      weight.categoryId,
      settings
    );
    if (categoryAverage === null) continue;
    const weightFactor = Number(weight.weightPercent);
    if (!Number.isFinite(weightFactor) || weightFactor <= 0) continue;
    weightedSum += categoryAverage * weightFactor;
    totalWeight += weightFactor;
  }

  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

export function computeOverallGrade(course, studentId, state, selectedTerm, now, diagnostics) {
  const scope = resolveGradingResultScope(course, state, selectedTerm, now);
  for (const assessment of scope.allAssessments) {
    try { diagnostics?.assessment?.(scope, course, assessment); } catch (e) {}
  }
  const result = computeWeightedOverallForAssessments(scope.assessments, course, studentId, scope.settings, scope.currentTerm);
  try { diagnostics?.result?.(course, result); } catch (e) {}
  return result;
}

function computeMedian(valuesSortedAsc) {
  const n = valuesSortedAsc.length;
  if (n === 0) return null;
  if (n % 2 === 1) {
    return valuesSortedAsc[(n - 1) / 2];
  }
  const a = valuesSortedAsc[n / 2 - 1];
  const b = valuesSortedAsc[n / 2];
  return (a + b) / 2;
}

function buildDistribution(values, course) {
  let buckets;

  if (course.schemaMode === SCHEMA_MODES.GRADES) {
    buckets = [
      { label: 'bis 1,9', min: -Infinity, max: 1.95 },
      { label: '2,0–2,9', min: 1.95, max: 2.95 },
      { label: '3,0–3,9', min: 2.95, max: 3.95 },
      { label: '4,0–4,9', min: 3.95, max: 4.95 },
      { label: '5,0–5,9', min: 4.95, max: 5.95 },
      { label: 'ab 6,0', min: 5.95, max: Infinity }
    ];
  } else {
    buckets = [
      { label: '0–4', min: 0, max: 4.5 },
      { label: '5–9', min: 4.5, max: 9.5 },
      { label: '10–12', min: 9.5, max: 12.5 },
      { label: '13–15', min: 12.5, max: Infinity }
    ];
  }

  buckets.forEach(bucket => { bucket.count = 0; });

  for (const value of values) {
    for (const bucket of buckets) {
      if (value >= bucket.min && value < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  return buckets.map(bucket => ({ label: bucket.label, count: bucket.count }));
}

export function computeCourseStatistics(course, state, now, diagnostics) {
  const enrollments = listEnrollmentsForCourse(state, course.id) || [];
  const values = [];

  for (const enrollment of enrollments) {
    const overall = computeOverallGrade(course, enrollment.studentId, state, null, now, diagnostics);
    if (overall !== null && Number.isFinite(overall)) {
      values.push(overall);
    }
  }

  if (values.length === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      distribution: []
    };
  }

  values.sort((a, b) => a - b);

  const count = values.length;
  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  const mean = sum / count;
  const median = computeMedian(values);
  const distribution = buildDistribution(values, course);

  return {
    count,
    mean,
    median,
    distribution,
    values
  };
}
