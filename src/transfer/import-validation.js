import { SCHEMA_MODES, UPPERSEC_COURSE_TYPES, QUALIFICATION_YEARS } from '../domain/state.js';
import { normalizeAssessmentTerm } from '../domain/assessments.js';

export function validateImportedState(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Die Datei enthält keinen gültigen Datenbestand.');
  if (!Array.isArray(candidate.students) || !Array.isArray(candidate.courses) || !Array.isArray(candidate.assessments) || !candidate.settings || typeof candidate.settings !== 'object') {
    throw new Error('Erforderliche Bereiche students, courses, assessments oder settings fehlen.');
  }
  const requireUniqueIds = (items, label) => {
    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) {
        throw new Error(label + ': Ein Eintrag ohne ID wurde gefunden.');
      }
      if (ids.has(item.id)) throw new Error(label + ': Doppelte ID ' + item.id + '.');
      ids.add(item.id);
    }
    return ids;
  };
  const studentIds = requireUniqueIds(candidate.students, 'Schüler');
  const courseIds = requireUniqueIds(candidate.courses, 'Kurse');
  requireUniqueIds(candidate.assessments, 'Leistungen');
  if (!Array.isArray(candidate.settings.categories) || !Array.isArray(candidate.settings.weightTemplates)) {
    throw new Error('Kategorien oder Gewichtungsvorlagen fehlen.');
  }
  const categoryIds = requireUniqueIds(candidate.settings.categories, 'Kategorien');
  const weightTemplateIds = requireUniqueIds(candidate.settings.weightTemplates, 'Gewichtungsvorlagen');
  for (const category of candidate.settings.categories) {
    if (category.active !== undefined && typeof category.active !== 'boolean') {
      throw new Error('Eine Kategorie besitzt keinen booleschen active-Wert.');
    }
  }
  const categoriesById = new Map(candidate.settings.categories.map(category => [category.id, category]));
  const validateWeightItems = (items, label, allowedCategoryIds) => {
    if (!Array.isArray(items)) throw new Error(label + ': Die Gewichtung ist unvollständig.');
    for (const item of items) {
      if (!item || !allowedCategoryIds.has(item.categoryId)) {
        throw new Error(label + ': Die Gewichtung verweist auf eine unbekannte Kategorie.');
      }
      if (typeof item.weightPercent !== 'number' || !Number.isFinite(item.weightPercent) ||
          item.weightPercent < 0 || item.weightPercent > 100) {
        throw new Error(label + ': Gewichte müssen endliche Zahlen zwischen 0 und 100 sein.');
      }
    }
  };
  const validateArchiveSnapshot = (snapshot, label, referencedTemplateId) => {
    const prefix = label + ': ';
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.gradeMapping || typeof snapshot.gradeMapping !== 'object' || !Array.isArray(snapshot.categories) || !snapshot.halfYearNames || typeof snapshot.halfYearNames !== 'object' || !snapshot.halfYearSettings || typeof snapshot.halfYearSettings !== 'object') {
      throw new Error(prefix + 'Der Bewertungs-Snapshot ist unvollständig.');
    }
    const snapshotCategoryIds = new Set();
    const snapshotSubcategoryIds = new Set();
    for (const category of snapshot.categories) {
      if (!category || !category.id) throw new Error(prefix + 'Eine Kategorie ohne ID wurde gefunden.');
      if (snapshotCategoryIds.has(category.id)) throw new Error(prefix + 'Doppelte Kategorie-ID ' + category.id + '.');
      if (typeof category.active !== 'boolean') {
        throw new Error(prefix + 'Eine Kategorie besitzt keinen booleschen active-Wert.');
      }
      snapshotCategoryIds.add(category.id);
      for (const subcategory of category.subcategories || []) {
        if (!subcategory || !subcategory.id) continue;
        if (snapshotSubcategoryIds.has(subcategory.id)) throw new Error(prefix + 'Eine doppelte Unterkategorie-ID wurde gefunden.');
        snapshotSubcategoryIds.add(subcategory.id);
      }
    }
    for (const enrollment of snapshot.enrollments || []) {
      if (!studentIds.has(enrollment.studentId)) throw new Error(prefix + 'Eine Einschreibung verweist auf einen unbekannten Schüler.');
    }
    const snapshotTemplate = snapshot.weightTemplate;
    if (snapshotTemplate !== undefined && snapshotTemplate !== null) {
      if (typeof snapshotTemplate !== 'object' || Array.isArray(snapshotTemplate) || !snapshotTemplate.id || !Array.isArray(snapshotTemplate.items)) {
        throw new Error(prefix + 'Die eingefrorene Gewichtungsvorlage ist ungueltig.');
      }
      if (referencedTemplateId !== undefined && referencedTemplateId !== snapshotTemplate.id) {
        throw new Error(prefix + 'Die eingefrorene Gewichtungsvorlage passt nicht zur Kursreferenz.');
      }
      validateWeightItems(snapshotTemplate.items, label + ': Die eingefrorene Gewichtungsvorlage', snapshotCategoryIds);
    } else if (referencedTemplateId) {
      throw new Error(prefix + 'Die eingefrorene Gewichtungsvorlage fehlt für die Kursreferenz.');
    }
  };
  for (const template of candidate.settings.weightTemplates) {
    validateWeightItems(template.items, 'Gewichtungsvorlage', categoryIds);
  }
  const courseScope = course => [
    course.schemaMode || '',
    Number.isInteger(Number(course.schoolYearStartYear)) ? String(Number(course.schoolYearStartYear)) : '',
    !!course.archivedAt
  ].join('|');
  const importKeysByScope = new Set();
  for (const course of candidate.courses) {
    if (course.carriedForwardFromCourseId !== undefined && course.carriedForwardFromCourseId !== null) {
      if (typeof course.carriedForwardFromCourseId !== 'string' || !course.carriedForwardFromCourseId.trim()) {
        throw new Error('Ein Vorgaengerkurs enthaelt keine gueltige Kurs-ID.');
      }
      if (course.carriedForwardFromCourseId === course.id) {
        throw new Error('Ein Vorgaengerkurs darf nicht auf den Kurs selbst verweisen.');
      }
      if (!courseIds.has(course.carriedForwardFromCourseId)) {
        throw new Error('Ein Vorgaengerkurs verweist auf einen unbekannten Kurs.');
      }
    }
    if (course.importKey !== undefined && course.importKey !== null) {
      if (typeof course.importKey !== 'string' || !course.importKey.trim() || course.importKey !== course.importKey.trim()) {
        throw new Error('Ein Kurs enthaelt eine ungueltige externe Kurskennung.');
      }
      const scopedImportKey = course.importKey.toLowerCase() + '|' + courseScope(course);
      if (importKeysByScope.has(scopedImportKey)) {
        throw new Error('Kurse enthalten eine doppelte externe Kurskennung im selben Gueltigkeitsbereich.');
      }
      importKeysByScope.add(scopedImportKey);
    }
    const enrolledStudentIds = new Set();
    for (const enrollment of course.enrollments || []) {
      if (!studentIds.has(enrollment.studentId)) throw new Error('Kurszuordnung verweist auf einen unbekannten Schüler.');
      if (enrolledStudentIds.has(enrollment.studentId)) throw new Error('Ein Kurs enthält eine doppelte Einschreibung für dieselbe Schüler-ID.');
      enrolledStudentIds.add(enrollment.studentId);
    }
    if (!course.archivedAt && course.weightTemplateId && !weightTemplateIds.has(course.weightTemplateId)) throw new Error('Ein aktiver Kurs verweist auf eine unbekannte Gewichtungsvorlage.');
    if (course.archivedAt) {
      const snapshot = course.archiveSnapshot;
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.gradeMapping || typeof snapshot.gradeMapping !== 'object' || !Array.isArray(snapshot.categories) || !snapshot.halfYearNames || typeof snapshot.halfYearNames !== 'object' || !snapshot.halfYearSettings || typeof snapshot.halfYearSettings !== 'object') {
        throw new Error('Ein archivierter Kurs besitzt keinen vollständigen Bewertungs-Snapshot.');
      }
      validateArchiveSnapshot(snapshot, 'Archiv-Snapshot', course.weightTemplateId);
    }
    if (course.archiveHistory !== undefined && !Array.isArray(course.archiveHistory)) {
      throw new Error('Archivverlauf: Der Verlauf ist ungueltig.');
    }
    for (const historyEntry of course.archiveHistory || []) {
      if (!historyEntry || typeof historyEntry !== 'object' || typeof historyEntry.archivedAt !== 'string' || !historyEntry.archivedAt.trim() ||
          (historyEntry.schemaMode !== undefined && historyEntry.schemaMode !== null &&
            !Object.values(SCHEMA_MODES).includes(historyEntry.schemaMode)) ||
          !historyEntry.snapshot || typeof historyEntry.snapshot !== 'object') {
        throw new Error('Archivverlauf: Ein ungueltiger Eintrag wurde gefunden.');
      }
      validateArchiveSnapshot(historyEntry.snapshot, 'Archivverlauf');
    }
  }
  for (const assessment of candidate.assessments) {
    const missingTerm = assessment.term === undefined || assessment.term === null ||
      String(assessment.term).trim() === '';
    if (!missingTerm && !normalizeAssessmentTerm(assessment.term)) {
      throw new Error('Eine Leistung besitzt ein unbekanntes Halbjahr.');
    }
    if (assessment.termAssignment !== undefined && assessment.termAssignment !== null &&
        assessment.termAssignment !== 'auto' && assessment.termAssignment !== 'manual') {
      throw new Error('Eine Leistung besitzt eine unbekannte Herkunft der Halbjahres-Zuordnung.');
    }
    if (!courseIds.has(assessment.courseId)) throw new Error('Eine Leistung verweist auf einen unbekannten Kurs.');
    const parentCourse = candidate.courses.find(c => c.id === assessment.courseId);
    const assessmentCategories = parentCourse && parentCourse.archivedAt ? parentCourse.archiveSnapshot.categories : candidate.settings.categories;
    const assessmentCategory = assessmentCategories.find(category => category.id === assessment.categoryId);
    if (assessment.categoryId && !assessmentCategory) throw new Error('Eine Leistung verweist auf eine unbekannte Kategorie.');
    if (assessment.subcategoryId && (!assessmentCategory || !(assessmentCategory.subcategories || []).some(subcategory => subcategory.id === assessment.subcategoryId))) {
      throw new Error('Eine Leistung verweist auf eine unbekannte Unterkategorie.');
    }
    for (const studentId of Object.keys(assessment.scores || {})) if (!studentIds.has(studentId)) throw new Error('Ein Noteneintrag verweist auf einen unbekannten Schüler.');
  }
  return true;
}

export function validateMergeIdentityPreflight(base, incoming) {
  validateImportedState(base);
  validateRawTermResults(base);
  validateRawUpperSecContexts(base);
  validateImportedState(incoming);
  validateRawTermResults(incoming);
  validateRawUpperSecContexts(incoming);

  const norm = value => String(value || '').trim().toLowerCase();
  const structuralCourseScope = course => [
    course.schemaMode || '',
    Number.isInteger(Number(course.schoolYearStartYear)) ? String(Number(course.schoolYearStartYear)) : ''
  ].join('|');
  const importCourseScope = course => [structuralCourseScope(course), !!course.archivedAt].join('|');
  const scopedImportKey = course => course && course.importKey
    ? norm(course.importKey) + '|' + importCourseScope(course)
    : '';

  const baseCoursesById = new Map(base.courses.map(course => [course.id, course]));
  const baseCoursesByImportKey = new Map();
  for (const course of base.courses) {
    const key = scopedImportKey(course);
    if (key) baseCoursesByImportKey.set(key, course);
  }

  const courseTargetIds = new Map();
  const claimedBaseTargets = new Map();
  for (const course of incoming.courses) {
    const idTarget = baseCoursesById.get(course.id) || null;
    if (idTarget && structuralCourseScope(idTarget) !== structuralCourseScope(course)) {
      throw new Error('Die Kurs-ID ' + course.id + ' widerspricht dem strukturellen Kurskontext im vorhandenen Bestand.');
    }
    const key = scopedImportKey(course);
    const importKeyTarget = key ? (baseCoursesByImportKey.get(key) || null) : null;
    if (idTarget && importKeyTarget && idTarget !== importKeyTarget) {
      throw new Error('Die Kursidentität ' + course.id + ' ist zwischen ID und externer Kurskennung widersprüchlich.');
    }
    const target = idTarget || importKeyTarget;
    if (target) {
      const previousClaim = claimedBaseTargets.get(target.id);
      if (previousClaim && previousClaim !== course.id) {
        throw new Error('Mehrere eingehende Kurse beanspruchen denselben Zielkurs ' + target.id + '.');
      }
      claimedBaseTargets.set(target.id, course.id);
    }
    courseTargetIds.set(course.id, target ? target.id : course.id);
  }

  const baseAssessmentsById = new Map(base.assessments.map(assessment => [assessment.id, assessment]));
  for (const assessment of incoming.assessments) {
    const targetCourseId = courseTargetIds.get(assessment.courseId);
    const idTarget = baseAssessmentsById.get(assessment.id);
    if (idTarget && idTarget.courseId !== targetCourseId) {
      throw new Error('Die Leistungs-ID ' + assessment.id + ' verweist im Import auf einen anderen Kurs.');
    }
  }

  for (const course of incoming.courses) {
    if (!course.carriedForwardFromCourseId) continue;
    const targetCourseId = courseTargetIds.get(course.id);
    const targetPredecessorId = courseTargetIds.get(course.carriedForwardFromCourseId);
    if (!targetPredecessorId) {
      throw new Error('Ein Vorgaengerkurs kann beim Merge nicht eindeutig aufgeloest werden.');
    }
    if (targetCourseId === targetPredecessorId) {
      throw new Error('Ein Vorgaengerkurs darf beim Merge nicht auf denselben Zielkurs verweisen.');
    }
  }

  return { courseTargetIds };
}

export function validateRawTermResults(candidate) {
  const studentIds = new Set(((candidate && candidate.students) || []).map(student => student && student.id));
  for (const course of ((candidate && candidate.courses) || [])) {
    if (!course || course.termResults === undefined) continue;
    if (!Array.isArray(course.termResults)) throw new Error('Ein Kurs enthaelt ungueltige Festsetzungen.');
    const seen = new Set();
    for (const result of course.termResults) {
      const key = result && `${result.studentId}|${result.term}`;
      const valid = course.schemaMode === SCHEMA_MODES.UPPERSEC && result &&
        studentIds.has(result.studentId) && /^\d{4}-H[12]$/.test(String(result.term || '')) &&
        Number.isInteger(result.points) && result.points >= 0 && result.points <= 15;
      if (!valid) throw new Error('Ein Kurs enthaelt eine ungueltige Festsetzung.');
      if (seen.has(key)) throw new Error('Ein Kurs enthaelt eine doppelte Festsetzung.');
      seen.add(key);
    }
  }
  return true;
}

export function validateRawUpperSecContexts(candidate) {
  const courseTypes = new Set(Object.values(UPPERSEC_COURSE_TYPES));
  const qualificationYears = new Set(Object.values(QUALIFICATION_YEARS));
  const validateContextAndEnrollments = (source, schemaMode, label, rejectAnyDuplicate) => {
    const prefix = label ? label + ': ' : '';
    const context = source.upperSecContext;
    const isUpperSec = schemaMode === SCHEMA_MODES.UPPERSEC;
    if (!isUpperSec && context !== undefined && context !== null) {
      throw new Error(prefix + 'Ein Sek-I-Kurs enthaelt Sek-II-Kontext.');
    }
    if (isUpperSec && context !== undefined && context !== null) {
      if (typeof context !== 'object' || Array.isArray(context)) {
        throw new Error(prefix + 'Ein Sek-II-Kurs enthaelt einen ungueltigen Kontext.');
      }
      if (context.courseType !== undefined && context.courseType !== null && !courseTypes.has(context.courseType)) {
        throw new Error(prefix + 'Ein Sek-II-Kurs enthaelt eine ungueltige Kursart.');
      }
      if (context.qualificationYear !== undefined && context.qualificationYear !== null && !qualificationYears.has(context.qualificationYear)) {
        throw new Error(prefix + 'Ein Sek-II-Kurs enthaelt einen ungueltigen Qualifikationsabschnitt.');
      }
      if (context.weightingDeviationReason !== undefined && context.weightingDeviationReason !== null &&
          (typeof context.weightingDeviationReason !== 'string' || context.weightingDeviationReason.length > 1000)) {
        throw new Error(prefix + 'Eine paedagogische Begruendung ist zu lang oder ungueltig.');
      }
    }
    if (source.enrollments !== undefined && !Array.isArray(source.enrollments)) {
      throw new Error(prefix + 'Ein Kurs enthaelt ungueltige Einschreibungen.');
    }
    const flagsByStudentId = new Map();
    for (const enrollment of (source.enrollments || [])) {
      if (!enrollment || typeof enrollment !== 'object') continue;
      if (enrollment.writtenExamSubjectQ4 !== undefined && typeof enrollment.writtenExamSubjectQ4 !== 'boolean') {
        throw new Error(prefix + 'Eine Einschreibung enthaelt ein ungueltiges Q4-Pruefungsfach.');
      }
      if (flagsByStudentId.has(enrollment.studentId) &&
          (rejectAnyDuplicate || flagsByStudentId.get(enrollment.studentId) !== enrollment.writtenExamSubjectQ4)) {
        throw new Error(prefix + 'Ein Kurs enthaelt eine ' + (rejectAnyDuplicate ? 'doppelte' : 'widerspruechliche doppelte') + ' Einschreibung.');
      }
      flagsByStudentId.set(enrollment.studentId, enrollment.writtenExamSubjectQ4);
    }
  };
  for (const course of ((candidate && candidate.courses) || [])) {
    if (!course || typeof course !== 'object') continue;
    validateContextAndEnrollments(course, course.schemaMode, '', false);
    const snapshots = [];
    if (course.archivedAt && course.archiveSnapshot && typeof course.archiveSnapshot === 'object') {
      snapshots.push({ snapshot: course.archiveSnapshot, label: 'Archiv-Snapshot' });
    }
    if (Array.isArray(course.archiveHistory)) {
      for (const entry of course.archiveHistory) {
        if (entry && entry.snapshot && typeof entry.snapshot === 'object') {
          snapshots.push({
            snapshot: entry.snapshot,
            schemaMode: entry.schemaMode || entry.snapshot.schemaMode || course.schemaMode,
            label: 'Archivverlauf'
          });
        }
      }
    }
    for (const archived of snapshots) {
      const snapshot = archived.snapshot;
      const label = archived.label;
      validateContextAndEnrollments(snapshot, archived.schemaMode || course.schemaMode, label, true);
      if (snapshot.categoryRoles !== undefined && snapshot.categoryRoles !== null) {
      if (typeof snapshot.categoryRoles !== 'object' || Array.isArray(snapshot.categoryRoles)) {
        throw new Error(label + ': Die Kategorienrollen sind ungueltig.');
      }
      const writtenCategoryId = snapshot.categoryRoles.upperSecWrittenCategoryId;
      if (writtenCategoryId !== undefined && writtenCategoryId !== null) {
        const categoryIds = new Set((Array.isArray(snapshot.categories) ? snapshot.categories : [])
          .filter(category => category && category.id)
          .map(category => category.id));
        if (typeof writtenCategoryId !== 'string' || !categoryIds.has(writtenCategoryId)) {
          throw new Error(label + ': Die Kategorienrolle verweist auf eine unbekannte Klausurkategorie.');
        }
      }
    }
    }
  }
  return true;
}
