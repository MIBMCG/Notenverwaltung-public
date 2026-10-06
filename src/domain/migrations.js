import {
  SCHEMA_MODES, SCORE_STATUS, STANDARD_GRADE_LABELS,
  createDefaultGradeMapping, createDefaultCategories, createDefaultWeightTemplates,
  createDefaultSettings, createEmptyState, generateId, normalizeSchoolProfile
} from './state.js';
import { isCanonicalTerm, normalizeAssessmentTerm } from './assessments.js';
import { normalizeCourseSymbol } from './course-symbols.js';
import { parseAssessmentDateValue } from './terms.js';
import {
  normalizeArchiveHistory, normalizeArchiveRetentionUntil, normalizeArchiveNote,
  normalizeUpperSecContext
} from './courses.js';

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasUsableId(value) {
  return isRecord(value) && typeof value.id === "string" && value.id.trim() !== "";
}

function collectUniqueById(items) {
  const ids = new Set();
  const ambiguousIds = new Set();
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!hasUsableId(item)) continue;
    const id = item.id;
    if (ids.has(id)) {
      ambiguousIds.add(id);
      continue;
    }
    ids.add(id);
    kept.push(item);
  }
  return { items: kept, ids, ambiguousIds };
}

function isUnambiguousReference(id, collection) {
  return collection.ids.has(id) && !collection.ambiguousIds.has(id);
}

function archiveIntegrityError(course, detail) {
  const courseId = hasUsableId(course) ? course.id : 'unbekannt';
  const error = new Error(
    `Der Archiv-Snapshot für Kurs ${courseId} ist beschädigt (${detail}). ` +
    'Bitte verwenden Sie ein intaktes Backup oder bewahren Sie den Originalbestand für eine Reparatur auf.'
  );
  error.code = 'ARCHIVE_INTEGRITY_INVALID';
  return error;
}

function assessmentTermIntegrityError(assessment, detail) {
  const assessmentId = hasUsableId(assessment) ? assessment.id : 'unbekannt';
  const error = new Error(
    `Die Halbjahreszuordnung der Leistung ${assessmentId} ist beschädigt (${detail}). ` +
    'Bitte bewahren Sie den Originalbestand für eine Reparatur auf.'
  );
  error.code = 'ASSESSMENT_TERM_INTEGRITY_INVALID';
  return error;
}

function assertAssessmentTermIntegrity(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.assessments)) return;
  for (const assessment of raw.assessments) {
    if (!isRecord(assessment)) continue;
    const missingTerm = assessment.term === undefined || assessment.term === null ||
      String(assessment.term).trim() === '';
    if (!missingTerm && !normalizeAssessmentTerm(assessment.term)) {
      throw assessmentTermIntegrityError(assessment, 'das gespeicherte Halbjahr ist unbekannt');
    }
    if (assessment.termAssignment !== undefined && assessment.termAssignment !== null &&
        assessment.termAssignment !== 'auto' && assessment.termAssignment !== 'manual') {
      throw assessmentTermIntegrityError(assessment, 'die Herkunft der Zuordnung ist unbekannt');
    }
  }
}

function assertArchivedAssessmentIntegrity(raw) {
  if (!isRecord(raw)) return;
  const courses = Array.isArray(raw.courses) ? raw.courses : [];
  const assessments = Array.isArray(raw.assessments) ? raw.assessments : [];

  for (const course of courses) {
    if (!isRecord(course)) continue;
    for (const historyEntry of Array.isArray(course.archiveHistory) ? course.archiveHistory : []) {
      const historicalCategories = historyEntry && historyEntry.snapshot && historyEntry.snapshot.categories;
      if (!Array.isArray(historicalCategories)) continue;
      for (const category of historicalCategories) {
        if (!isRecord(category) || typeof category.active !== 'boolean') {
          throw archiveIntegrityError(course, 'der Aktivitätsstatus einer historischen Kategorie ist unvollständig');
        }
      }
    }
    if (typeof course.archivedAt !== 'string' || !course.archivedAt) continue;
    const snapshot = course.archiveSnapshot;
    if (!isRecord(snapshot) || !isRecord(snapshot.gradeMapping) ||
        !Array.isArray(snapshot.categories) || !isRecord(snapshot.halfYearNames) ||
        !isRecord(snapshot.halfYearSettings)) {
      throw archiveIntegrityError(course, 'die eingefrorene Bewertungsstruktur ist unvollständig');
    }

    const categories = new Map();
    for (const category of snapshot.categories) {
      if (!hasUsableId(category) || categories.has(category.id)) {
        throw archiveIntegrityError(course, 'die eingefrorenen Kategorien sind nicht eindeutig');
      }
      if (typeof category.active !== 'boolean') {
        throw archiveIntegrityError(course, 'der Aktivitätsstatus einer eingefrorenen Kategorie ist unvollständig');
      }
      const subcategories = new Map();
      if (category.subcategories !== undefined && !Array.isArray(category.subcategories)) {
        throw archiveIntegrityError(course, 'die eingefrorenen Unterkategorien sind unvollständig');
      }
      for (const subcategory of category.subcategories || []) {
        if (!hasUsableId(subcategory) || subcategories.has(subcategory.id)) {
          throw archiveIntegrityError(course, 'die eingefrorenen Unterkategorien sind nicht eindeutig');
        }
        subcategories.set(subcategory.id, subcategory);
      }
      categories.set(category.id, { category, subcategories });
    }

    if (snapshot.weightTemplate !== undefined && snapshot.weightTemplate !== null) {
      if (!isRecord(snapshot.weightTemplate) || !Array.isArray(snapshot.weightTemplate.items)) {
        throw archiveIntegrityError(course, 'die eingefrorene Gewichtung ist unvollständig');
      }
      for (const item of snapshot.weightTemplate.items) {
        if (!isRecord(item) || !categories.has(item.categoryId)) {
          throw archiveIntegrityError(course, 'die eingefrorene Gewichtung verweist auf eine unbekannte Kategorie');
        }
      }
    }

    for (const assessment of assessments) {
      if (!isRecord(assessment) || assessment.courseId !== course.id) continue;
      const categoryEntry = categories.get(assessment.categoryId);
      if (!categoryEntry) {
        throw archiveIntegrityError(course, 'eine historische Leistung verweist auf eine unbekannte Kategorie');
      }
      if (assessment.subcategoryId && !categoryEntry.subcategories.has(assessment.subcategoryId)) {
        throw archiveIntegrityError(course, 'eine historische Leistung verweist auf eine unbekannte Unterkategorie');
      }
    }
  }
}

function repairCategoryScope(categories) {
  const categoryCollection = collectUniqueById(categories);
  const subcategoryIdsByCategory = new Map();
  for (const category of categoryCollection.items) {
    const subcategories = collectUniqueById(category.subcategories);
    category.subcategories = subcategories.items;
    subcategoryIdsByCategory.set(category.id, subcategories);
  }
  return {
    categories: categoryCollection.items,
    categoryIds: categoryCollection.ids,
    ambiguousCategoryIds: categoryCollection.ambiguousIds,
    subcategoryIdsByCategory
  };
}

function repairSnapshot(snapshot, students) {
  if (!isRecord(snapshot)) return null;
  const categoryScope = repairCategoryScope(snapshot.categories);
  snapshot.categories = categoryScope.categories;
  if (isRecord(snapshot.weightTemplate)) {
    snapshot.weightTemplate.items = (Array.isArray(snapshot.weightTemplate.items)
      ? snapshot.weightTemplate.items : []).filter(item =>
      item && categoryScope.categoryIds.has(item.categoryId) &&
      !categoryScope.ambiguousCategoryIds.has(item.categoryId)
    );
  }
  const enrolled = new Set();
  snapshot.enrollments = (Array.isArray(snapshot.enrollments) ? snapshot.enrollments : []).filter(enrollment => {
    if (!enrollment || !isUnambiguousReference(enrollment.studentId, students) || enrolled.has(enrollment.studentId)) return false;
    enrolled.add(enrollment.studentId);
    return true;
  });
  return { snapshot, categoryScope };
}

function repairStateReferences(state) {
  const students = collectUniqueById(state.students);
  const courses = collectUniqueById(state.courses);
  const assessments = collectUniqueById(state.assessments);
  state.students = students.items;
  state.courses = courses.items;

  const globalCategories = repairCategoryScope(state.settings.categories);
  state.settings.categories = globalCategories.categories;
  const templates = collectUniqueById(state.settings.weightTemplates);
  state.settings.weightTemplates = templates.items;
  for (const template of state.settings.weightTemplates) {
    template.items = (Array.isArray(template.items) ? template.items : []).filter(item =>
      item && globalCategories.categoryIds.has(item.categoryId) &&
      !globalCategories.ambiguousCategoryIds.has(item.categoryId)
    );
  }

  const coursesById = new Map(state.courses.map(course => [course.id, course]));
  const resumeCourseId = typeof state.lastGradesheetCourseId === 'string' &&
    state.lastGradesheetCourseId.trim() !== ''
    ? state.lastGradesheetCourseId
    : null;
  const resumeCourse = resumeCourseId && isUnambiguousReference(resumeCourseId, courses)
    ? coursesById.get(resumeCourseId)
    : null;
  state.lastGradesheetCourseId = resumeCourse && !resumeCourse.archivedAt
    ? resumeCourseId
    : null;
  const archivedCategoryScopes = new Map();

  for (const course of state.courses) {
    const enrolled = new Set();
    course.enrollments = (Array.isArray(course.enrollments) ? course.enrollments : []).filter(enrollment => {
      if (!enrollment || !isUnambiguousReference(enrollment.studentId, students) || enrolled.has(enrollment.studentId)) return false;
      enrolled.add(enrollment.studentId);
      return true;
    });
    course.termResults = (Array.isArray(course.termResults) ? course.termResults : []).filter(result =>
      result && isUnambiguousReference(result.studentId, students)
    );

    const repairedSnapshot = repairSnapshot(course.archiveSnapshot, students);
    if (repairedSnapshot) archivedCategoryScopes.set(course.id, repairedSnapshot.categoryScope);
    for (const historyEntry of Array.isArray(course.archiveHistory) ? course.archiveHistory : []) {
      if (historyEntry) repairSnapshot(historyEntry.snapshot, students);
    }

    if (course.archivedAt) {
      const snapshotTemplate = repairedSnapshot && repairedSnapshot.snapshot.weightTemplate;
      if (!hasUsableId(snapshotTemplate) || course.weightTemplateId !== snapshotTemplate.id) {
        course.weightTemplateId = null;
      }
    } else if (course.weightTemplateId &&
        !isUnambiguousReference(course.weightTemplateId, templates)) {
      course.weightTemplateId = null;
    }
  }

  state.assessments = assessments.items.filter(assessment =>
    assessment && isUnambiguousReference(assessment.courseId, courses) && (() => {
      const course = coursesById.get(assessment.courseId);
      const categoryScope = course && course.archivedAt
        ? archivedCategoryScopes.get(course.id)
        : globalCategories;
      return categoryScope && categoryScope.categoryIds.has(assessment.categoryId) &&
        !categoryScope.ambiguousCategoryIds.has(assessment.categoryId);
    })()
  );
  for (const assessment of state.assessments) {
    const course = coursesById.get(assessment.courseId);
    const categoryScope = course && course.archivedAt
      ? archivedCategoryScopes.get(course.id)
      : globalCategories;
    const subcategories = categoryScope.subcategoryIdsByCategory.get(assessment.categoryId);
    if (assessment.subcategoryId && (!subcategories ||
        !isUnambiguousReference(assessment.subcategoryId, subcategories))) {
      assessment.subcategoryId = null;
    }
    const repairedScores = {};
    for (const [studentId, score] of Object.entries(isRecord(assessment.scores) ? assessment.scores : {})) {
      if (isUnambiguousReference(studentId, students)) repairedScores[studentId] = score;
    }
    assessment.scores = repairedScores;
  }

  const importKeysByScope = new Set();
  const courseScope = course => [
    course.schemaMode || '',
    Number.isInteger(Number(course.schoolYearStartYear)) ? String(Number(course.schoolYearStartYear)) : '',
    !!course.archivedAt
  ].join('|');
  for (const course of state.courses) {
    const predecessorId = typeof course.carriedForwardFromCourseId === 'string'
      ? course.carriedForwardFromCourseId.trim()
      : '';
    course.carriedForwardFromCourseId = predecessorId && predecessorId !== course.id &&
      isUnambiguousReference(predecessorId, courses) ? predecessorId : null;

    const importKey = typeof course.importKey === 'string' ? course.importKey.trim() : '';
    const scopedKey = importKey ? importKey.toLowerCase() + '|' + courseScope(course) : '';
    if (!importKey || importKeysByScope.has(scopedKey)) course.importKey = null;
    else {
      course.importKey = importKey;
      importKeysByScope.add(scopedKey);
    }
  }
  return state;
}

export function ensureStateShape(raw, now, termServices) {
  if (typeof now !== 'function') throw new TypeError('now muss eine Funktion sein.');
  if (!termServices || typeof termServices.getSettingsForCourse !== 'function' ||
      typeof termServices.resolveAssessmentTermFromDateValue !== 'function') {
    throw new TypeError('termServices muss getSettingsForCourse und resolveAssessmentTermFromDateValue bereitstellen.');
  }

  // 1. Grundcheck: Ist das überhaupt ein Objekt?
  if (!isRecord(raw)) {
    return createEmptyState();
  }

  // Archivregeln müssen vor jeder reparierenden Normalisierung geprüft werden.
  // Sonst können beschädigte Snapshots ihre zugehörigen Leistungen still verlieren.
  assertArchivedAssessmentIntegrity(raw);
  assertAssessmentTermIntegrity(raw);

  // 2. Sammlungen und Einstellungen einzeln normalisieren, damit ein
  //    beschädigter Teil keine weiterhin gültigen Daten verwirft.
  raw.students = Array.isArray(raw.students) ? raw.students.filter(isRecord) : [];
  raw.courses = Array.isArray(raw.courses) ? raw.courses.filter(isRecord) : [];
  raw.assessments = Array.isArray(raw.assessments) ? raw.assessments.filter(isRecord) : [];
  raw.settings = isRecord(raw.settings) ? raw.settings : createDefaultSettings();
  raw.settings.schoolProfile = normalizeSchoolProfile(
    Object.prototype.hasOwnProperty.call(raw.settings, 'schoolProfile')
      ? raw.settings.schoolProfile
      : { name: 'Meine Schule', logoMode: 'auto' }
  );
  raw.settings.categories = Array.isArray(raw.settings.categories)
    ? raw.settings.categories.filter(hasUsableId)
    : createDefaultCategories();

  // 3. Versionsfeld sicherstellen
  if (!raw.version) {
    raw.version = 1;
  }

  // 4. Schülerobjekte minimal „auffüllen“:
  //    - homeClass hinzufügen, falls nicht vorhanden
  if (Array.isArray(raw.students)) {
    raw.students = raw.students.map(function (stu) {
      // Falls stu gar kein Objekt ist, defensiv neu aufbauen
      if (!stu || typeof stu !== "object") {
        return {
          id: generateId("stu"),
          lastName: "",
          firstName: "",
          birthDate: null,
          homeClass: ""
        };
      }

      stu.id = stu.id || generateId("stu");
      stu.lastName = stu.lastName || "";
      stu.firstName = stu.firstName || "";
      stu.birthDate = stu.birthDate || null;
      // NEU: Stammklasse, falls noch nicht vorhanden
      stu.homeClass = stu.homeClass || "";
      return stu;
    });
  }

  // 5. Kategorien: subcategories-Array hinzufügen (Standard: leer)
  if (raw.settings && Array.isArray(raw.settings.categories)) {
    raw.settings.categories = raw.settings.categories.map(function (cat) {
      if (cat.active === undefined) cat.active = true;
      cat.subcategories = Array.isArray(cat.subcategories)
        ? cat.subcategories.filter(hasUsableId)
        : []; // Standard: keine Unterkategorien
      return cat;
    });
  }

  // 5a. Fehlende Standardnoten und neue empfohlene Gewichtungsprofile ergänzen.
  // Bestehende Werte, IDs und Kurszuordnungen werden dabei nicht überschrieben.
  if (!isRecord(raw.settings.gradeMapping)) {
    raw.settings.gradeMapping = {};
  }
  const defaultGradeMapping = createDefaultGradeMapping();
  for (const label of STANDARD_GRADE_LABELS) {
    if (!Object.prototype.hasOwnProperty.call(raw.settings.gradeMapping, label)) {
      raw.settings.gradeMapping[label] = defaultGradeMapping[label];
    }
  }

  if (!Array.isArray(raw.settings.weightTemplates)) raw.settings.weightTemplates = [];
  const legacyTemplateBaseName = "Altbestand Sek I (67/33) – Fachkonferenz prüfen";
  const occupiedTemplateNames = new Set(
    raw.settings.weightTemplates
      .filter(template => template && template.name !== "Standard Sek I (67/33)")
      .map(template => template.name)
  );
  let legacyTemplateSuffix = 1;
  for (const template of raw.settings.weightTemplates) {
    if (template && template.name === "Standard Sek I (67/33)") {
      let migratedName = legacyTemplateBaseName;
      while (occupiedTemplateNames.has(migratedName)) {
        legacyTemplateSuffix += 1;
        migratedName = `${legacyTemplateBaseName} (${legacyTemplateSuffix})`;
      }
      template.name = migratedName;
      occupiedTemplateNames.add(migratedName);
    }
  }
  const recommendedTemplates = createDefaultWeightTemplates(
    raw.settings.categories,
    raw.settings.weightTemplates
  );
  for (const recommended of recommendedTemplates) {
    const alreadyPresent = raw.settings.weightTemplates.some(template =>
      template && (template.id === recommended.id || template.name === recommended.name)
    );
    if (!alreadyPresent) raw.settings.weightTemplates.push(recommended);
  }

  // 5b. Halbjahres-Einstellungen (Sek I und Sek II) sicherstellen
  const currentYear = now().getFullYear();
  const currentMonth = now().getMonth() + 1; // 1-12

  // Logik für Schuljahresbeginn:
  // - Januar bis August (1-8): September des VORJAHRES
  // - September bis Dezember (9-12): September des AKTUELLEN Jahres
  const schoolYearStartYear = currentMonth <= 8 ? currentYear - 1 : currentYear;

  if (!isRecord(raw.settings.halfYearSettings)) {
    raw.settings.halfYearSettings = {
      seckI: {
        schoolYearStartYear: schoolYearStartYear,
        schoolYearStartMonth: 9,
        schoolYearStartDay: 8,
        h1EndYear: schoolYearStartYear + 1,
        h1EndMonth: 1,
        h1EndDay: 30,
        h2StartYear: schoolYearStartYear + 1,
        h2StartMonth: 2,
        h2StartDay: 9
      },
      seckII: {
        schoolYearStartYear: schoolYearStartYear,
        schoolYearStartMonth: 9,
        schoolYearStartDay: 8,
        h1EndYear: schoolYearStartYear + 1,
        h1EndMonth: 1,
        h1EndDay: 30,
        h2StartYear: schoolYearStartYear + 1,
        h2StartMonth: 2,
        h2StartDay: 9
      }
    };
  } else {
    // Normalisiere existierende Werte
    for (const level of ['seckI', 'seckII']) {
      if (!isRecord(raw.settings.halfYearSettings[level])) {
        raw.settings.halfYearSettings[level] = {
          schoolYearStartYear: schoolYearStartYear,
          schoolYearStartMonth: 9,
          schoolYearStartDay: 8,
          h1EndYear: schoolYearStartYear + 1,
          h1EndMonth: 1,
          h1EndDay: 30,
          h2StartYear: schoolYearStartYear + 1,
          h2StartMonth: 2,
          h2StartDay: 9
        };
      } else {
        const hys = raw.settings.halfYearSettings[level];
        // Vorsicht: 0 ist gültig für Monate (Januar = 1), nutze !== undefined statt ||
        // Jahr-Felder: Falls nicht vorhanden (alte Backups), intelligente Standardwerte setzen

        // Schuljahr-Start: intelligente Standardwerte basierend auf aktuellem Monat
        if (typeof hys.schoolYearStartYear !== 'number' || isNaN(hys.schoolYearStartYear)) {
          hys.schoolYearStartYear = schoolYearStartYear;
        }
        hys.schoolYearStartMonth = (typeof hys.schoolYearStartMonth === 'number' && !isNaN(hys.schoolYearStartMonth)) ? hys.schoolYearStartMonth : 9;
        hys.schoolYearStartDay = (typeof hys.schoolYearStartDay === 'number' && !isNaN(hys.schoolYearStartDay)) ? hys.schoolYearStartDay : 8;

        // H1 Ende: im Kalenderjahr nach dem Schuljahresbeginn (Januar)
        if (typeof hys.h1EndYear !== 'number' || isNaN(hys.h1EndYear)) {
          hys.h1EndYear = hys.schoolYearStartYear + 1;
        }
        hys.h1EndMonth = (typeof hys.h1EndMonth === 'number' && !isNaN(hys.h1EndMonth)) ? hys.h1EndMonth : 1;
        hys.h1EndDay = (typeof hys.h1EndDay === 'number' && !isNaN(hys.h1EndDay)) ? hys.h1EndDay : 30;

        // H2 Start: im Jahr nach dem Schuljahresbeginn (Februar)
        if (typeof hys.h2StartYear !== 'number' || isNaN(hys.h2StartYear)) {
          hys.h2StartYear = hys.schoolYearStartYear + 1;
        }
        hys.h2StartMonth = (typeof hys.h2StartMonth === 'number' && !isNaN(hys.h2StartMonth)) ? hys.h2StartMonth : 2;
        hys.h2StartDay = (typeof hys.h2StartDay === 'number' && !isNaN(hys.h2StartDay)) ? hys.h2StartDay : 9;
      }
    }
  }
  // 5b. Halbjahres-Namen (Sek I und Sek II) - Benutzerdefinierte Namen für Halbjahre
  if (!isRecord(raw.settings.halfYearNames)) {
    raw.settings.halfYearNames = {
      seckI: { h1: 'H1', h2: 'H2' },
      seckII: { h1: 'Q1', h2: 'Q2' }
    };
  } else {
    for (const level of ['seckI', 'seckII']) {
      if (!isRecord(raw.settings.halfYearNames[level])) {
        raw.settings.halfYearNames[level] = level === 'seckII' ? { h1: 'Q1', h2: 'Q2' } : { h1: 'H1', h2: 'H2' };
      } else {
        if (!raw.settings.halfYearNames[level].h1) {
          raw.settings.halfYearNames[level].h1 = level === 'seckII' ? 'Q1' : 'H1';
        }
        if (!raw.settings.halfYearNames[level].h2) {
          raw.settings.halfYearNames[level].h2 = level === 'seckII' ? 'Q2' : 'H2';
        }
      }
    }
  }

  // 5b. Halbjahrs-Stichtage (Fallback, wird von halfYearSettings überschrieben)
  if (!isRecord(raw.settings.termCutoffs)) {
    raw.settings.termCutoffs = {
      schoolYearStartMonth: 9,
      h1EndMonth: 1,
      h1EndDay: 30,
      h2StartMonth: 2,
      h2StartDay: 9
    };
  } else {
    const tc = raw.settings.termCutoffs;
    tc.schoolYearStartMonth = Number(tc.schoolYearStartMonth) || 9;
    tc.h1EndMonth = Number(tc.h1EndMonth) || 1;
    tc.h1EndDay = Number(tc.h1EndDay) || 30;
    tc.h2StartMonth = Number(tc.h2StartMonth) || 2;
    tc.h2StartDay = Number(tc.h2StartDay) || 9;
  }

  // 6. Leistungen: visible-Feld hinzufügen (Standard: true)
  if (Array.isArray(raw.assessments)) {
    const courseById = new Map((raw.courses || []).map(c => [c.id, c]));

    // Erster Pass: term aus Datum ableiten, bevor undatierte Leistungen
    // auf den neuesten vorhandenen Kurs-Term zurückfallen.
    raw.assessments = raw.assessments.map(function (asm) {
      if (!asm || typeof asm !== "object") return asm;
      if (asm.visible === undefined) {
        asm.visible = true; // Standard: sichtbar
      }
      if (asm.subcategoryId === undefined) {
        asm.subcategoryId = null; // Standard: keine Unterkategorie
      }
      const canonicalTerm = normalizeAssessmentTerm(asm.term);
      // Vorhandene eindeutige Altterme sind konservativ manuell. Nur fehlende
      // Terme werden nach den bisherigen Regeln automatisch abgeleitet.
      if (canonicalTerm) {
        asm.term = canonicalTerm;
        if (asm.termAssignment !== 'auto' && asm.termAssignment !== 'manual') {
          asm.termAssignment = 'manual';
        }
      } else {
        const date = parseAssessmentDateValue(asm.date);
        const course = courseById.get(asm.courseId) || null;
        const courseSettings = course
          ? termServices.getSettingsForCourse(course, raw)
          : raw.settings;
        asm.term = date
          ? termServices.resolveAssessmentTermFromDateValue(date, course, courseSettings)
          : null;
        asm.termAssignment = 'auto';
      }
      const scoreCourse = courseById.get(asm.courseId);
      if (scoreCourse && asm.scores && typeof asm.scores === "object") {
        const isUpperSec = scoreCourse.schemaMode === SCHEMA_MODES.UPPERSEC;
        for (const score of Object.values(asm.scores)) {
          if (!score || typeof score !== "object") continue;
          if (isUpperSec && ![SCORE_STATUS.VALID, SCORE_STATUS.MISSING, SCORE_STATUS.EXCUSED].includes(score.status)) {
            score.status = (score.valueRaw !== null && score.valueRaw !== undefined && String(score.valueRaw).trim() !== "") || typeof score.valueNumeric === "number"
              ? SCORE_STATUS.VALID
              : SCORE_STATUS.MISSING;
          }
          if (score.status !== SCORE_STATUS.VALID) {
            score.valueRaw = null;
            score.valueNumeric = null;
            continue;
          }
          if (!isUpperSec) continue;
          const rawValue = score.valueRaw === null || score.valueRaw === undefined
            ? ""
            : String(score.valueRaw).trim();
          const rawNumber = /^\d+$/.test(rawValue) ? Number(rawValue) : NaN;
          const storedNumber = typeof score.valueNumeric === "number" ? score.valueNumeric : NaN;
          const normalized = Number.isInteger(rawNumber) && rawNumber >= 0 && rawNumber <= 15
            ? rawNumber
            : (Number.isInteger(storedNumber) && storedNumber >= 0 && storedNumber <= 15 ? storedNumber : null);
          if (normalized === null) {
            score.valueRaw = null;
            score.valueNumeric = null;
            score.status = SCORE_STATUS.MISSING;
          } else {
            score.valueRaw = String(normalized);
            score.valueNumeric = normalized;
          }
        }
      }
      return asm;
    });

    // Zweiter Pass: Leistungen ohne term (kein Datum) einem Halbjahr zuordnen
    // Gruppiere nach courseId und finde das neueste Halbjahr pro Kurs
    const courseTermMap = new Map();
    for (const asm of raw.assessments) {
      if (asm && asm.courseId && asm.term) {
        const existing = courseTermMap.get(asm.courseId);
        if (!existing || compareTerms(asm.term, existing) > 0) {
          courseTermMap.set(asm.courseId, asm.term);
        }
      }
    }

    // Hilfsfunktion: Vergleicht zwei Term-Strings (z.B. "2025-H1" vs "2025-H2")
    function compareTerms(t1, t2) {
      const m1 = /^(\d{4})-H([12])$/.exec(t1);
      const m2 = /^(\d{4})-H([12])$/.exec(t2);
      if (!m1 || !m2) return 0;
      const n1 = parseInt(m1[1], 10) * 10 + parseInt(m1[2], 10);
      const n2 = parseInt(m2[1], 10) * 10 + parseInt(m2[2], 10);
      return n1 - n2;
    }

    const currentDate = now();
    const fallbackTermByCourse = new Map();
    function getFallbackTermForCourse(course) {
      const cacheKey = course && course.id ? course.id : '__unknown_course__';
      if (!fallbackTermByCourse.has(cacheKey)) {
        const settings = course
          ? termServices.getSettingsForCourse(course, raw)
          : raw.settings;
        fallbackTermByCourse.set(
          cacheKey,
          termServices.resolveAssessmentTermFromDateValue(currentDate, course, settings)
        );
      }
      return fallbackTermByCourse.get(cacheKey);
    }

    for (const asm of raw.assessments) {
      if (asm && (asm.term === null || asm.term === undefined)) {
        const courseTerm = courseTermMap.get(asm.courseId);
        const course = courseById.get(asm.courseId) || null;
        asm.term = courseTerm || getFallbackTermForCourse(course);
        asm.termAssignment = 'auto';
      }
    }
  }

  // 6b. Kurse: includePrevTermGrades booleanisieren und enrollments sicherstellen
  if (Array.isArray(raw.courses)) {
    raw.courses = raw.courses.map(function (c) {
      if (!c || typeof c !== 'object') return c;
      if (normalizeCourseSymbol(c.symbolId)) c.symbolId = normalizeCourseSymbol(c.symbolId);
      else delete c.symbolId;
      // Standardwert für includePrevTermGrades: bei Oberstufe (UPPERSEC) false, ansonsten (GRADES / Sek I) true
      if (c.includePrevTermGrades === undefined) {
        try {
          if (c.schemaMode === SCHEMA_MODES.UPPERSEC) {
            c.includePrevTermGrades = false;
          } else {
            c.includePrevTermGrades = true;
          }
        } catch (e) {
          c.includePrevTermGrades = false;
        }
      }
      c.includePrevTermGrades = c.schemaMode === SCHEMA_MODES.UPPERSEC
        ? false
        : !!c.includePrevTermGrades;
      // Standard für Anwesenheitsanzeige: true
      if (c.showAttendance === undefined) c.showAttendance = true;
      // optionale halbjahres-Stichtage pro Kurs
      if (c.termCutoffs === undefined) c.termCutoffs = null;
      if (c.termCutoffs && typeof c.termCutoffs === 'object') {
        c.termCutoffs = {
          h1EndMonth: Number(c.termCutoffs.h1EndMonth) || null,
          h1EndDay: Number(c.termCutoffs.h1EndDay) || null,
          h2StartMonth: Number(c.termCutoffs.h2StartMonth) || null,
          h2StartDay: Number(c.termCutoffs.h2StartDay) || null
        };
      }
      c.archivedAt = typeof c.archivedAt === 'string' && c.archivedAt ? c.archivedAt : null;
      c.archiveReason = c.archiveReason || null;
      c.archiveRetentionUntil = normalizeArchiveRetentionUntil(c.archiveRetentionUntil);
      c.archiveNote = normalizeArchiveNote(c.archiveNote);
      c.schoolYearStartYear = Number.isInteger(Number(c.schoolYearStartYear)) ? Number(c.schoolYearStartYear) : null;
      c.carriedForwardFromCourseId = c.carriedForwardFromCourseId || null;
      c.archiveSnapshot = c.archiveSnapshot && typeof c.archiveSnapshot === 'object' ? c.archiveSnapshot : null;
      c.archiveHistory = normalizeArchiveHistory(c.archiveHistory, c.schemaMode);
      c.importKey = c.importKey || null;
      c.upperSecContext = normalizeUpperSecContext(c.schemaMode, c.upperSecContext);
      // Zustand für Ein-/Ausklappen von Vorjahr-/Aktuell-Sektionen (UI-Komfort, gespeichert)
      if (c._prevCollapsed === undefined) c._prevCollapsed = false;
      if (c._currCollapsed === undefined) c._currCollapsed = false;
      if (!Array.isArray(c.enrollments)) c.enrollments = [];
      c.enrollments = c.enrollments
        .filter(e => e && e.studentId)
        .map(e => {
          e.subgroup = e.subgroup || null;
          e.homeClassAtEnrollment = e.homeClassAtEnrollment ||
            ((raw.students || []).find(s => s.id === e.studentId) || {}).homeClass || null;
          e.writtenExamSubjectQ4 = e.writtenExamSubjectQ4 === true;
          return e;
        });
      const knownStudentIds = new Set((raw.students || []).map(student => student.id));
      const seenTermResults = new Set();
      c.termResults = (Array.isArray(c.termResults) ? c.termResults : []).filter(result => {
        if (!result || !knownStudentIds.has(result.studentId) || c.schemaMode !== SCHEMA_MODES.UPPERSEC ||
          !isCanonicalTerm(result.term) || !Number.isInteger(result.points) || result.points < 0 || result.points > 15) return false;
        const key = result.studentId + '\u0000' + result.term;
        if (seenTermResults.has(key)) return false;
        seenTermResults.add(key);
        return true;
      }).map(result => ({ studentId: result.studentId, term: result.term, points: result.points }));
      return c;
    });
  }

  // 7. Den (leicht reparierten) State zurückgeben
  return repairStateReferences(raw);
}
