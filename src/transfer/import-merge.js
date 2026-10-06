import { validateMergeIdentityPreflight } from './import-validation.js';

export function createImportMerge({ ensureStateShape, createEmptyState, generateId }) {
  function mergeImportedStateIntoCurrent(base, incoming) {
    const clone = value => JSON.parse(JSON.stringify(value));
    const rawBase = clone(base || createEmptyState());
    const rawIncoming = clone(incoming);
    const identityPreflight = validateMergeIdentityPreflight(rawBase, rawIncoming);
    const result = ensureStateShape(rawBase);
    incoming = ensureStateShape(rawIncoming);
    const norm = value => String(value || '').trim().toLowerCase();
    const canonicalize = value => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
      );
    };
    const semanticEqual = (left, right) =>
      JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
    const scoreSemantics = score => ({
      valueRaw: score && score.valueRaw,
      status: score && score.status,
      valueNumeric: score && score.valueNumeric
    });
    const assessmentMetadata = assessment => Object.fromEntries(
      Object.entries(assessment || {}).filter(([key]) => !['id', 'courseId', 'scores'].includes(key))
    );
    const summary = {
      studentsAdded: 0,
      coursesAdded: 0,
      assessmentsAdded: 0,
      assessmentMetadataConflicts: 0,
      scoreConflicts: 0,
      termResultConflicts: 0,
      archiveConflicts: 0,
      upperSecContextConflicts: 0,
      writtenExamSubjectConflicts: 0
    };

    const categoryIdMap = new Map();
    const subcategoryIdMap = new Map();
    const resultCategories = result.settings.categories || (result.settings.categories = []);
    for (const category of incoming.settings.categories || []) {
      let target = resultCategories.find(c => c.id === category.id) || resultCategories.find(c => norm(c.name) === norm(category.name));
      if (!target) {
        target = clone(category);
        if (!target.id || resultCategories.some(c => c.id === target.id)) target.id = generateId('cat');
        target.subcategories = [];
        resultCategories.push(target);
      }
      categoryIdMap.set(category.id, target.id);
      target.subcategories = Array.isArray(target.subcategories) ? target.subcategories : [];
      for (const sub of category.subcategories || []) {
        let targetSub = target.subcategories.find(s => s.id === sub.id) || target.subcategories.find(s => norm(s.name) === norm(sub.name));
        if (!targetSub) {
          targetSub = clone(sub);
          if (!targetSub.id || target.subcategories.some(s => s.id === targetSub.id)) targetSub.id = generateId('subcat');
          target.subcategories.push(targetSub);
        }
        subcategoryIdMap.set(category.id + '|' + sub.id, targetSub.id);
      }
    }

    const weightTemplateIdMap = new Map();
    const resultTemplates = result.settings.weightTemplates || (result.settings.weightTemplates = []);
    for (const template of incoming.settings.weightTemplates || []) {
      let target = resultTemplates.find(t => t.id === template.id) || resultTemplates.find(t => norm(t.name) === norm(template.name));
      if (!target) {
        target = clone(template);
        if (!target.id || resultTemplates.some(t => t.id === target.id)) target.id = generateId('wt');
        target.items = (template.items || []).map(item => ({
          categoryId: categoryIdMap.get(item.categoryId) || item.categoryId,
          weightPercent: Number(item.weightPercent) || 0
        }));
        resultTemplates.push(target);
      }
      weightTemplateIdMap.set(template.id, target.id);
    }
    result.settings.gradeMapping = { ...(incoming.settings.gradeMapping || {}), ...(result.settings.gradeMapping || {}) };

    const studentIdMap = new Map();
    const studentsAddedByThisMerge = new Set();
    const studentsById = new Map((result.students || []).map(s => [s.id, s]));
    for (const student of incoming.students || []) {
      let target = studentsById.get(student.id);
      if (!target) {
        target = clone(student);
        result.students.push(target); studentsById.set(target.id, target); summary.studentsAdded++;
        studentsAddedByThisMerge.add(target.id);
      } else if (!target.homeClass && student.homeClass) target.homeClass = student.homeClass;
      studentIdMap.set(student.id, target.id);
    }

    const remapSnapshotEnrollments = snapshot => {
      const mappedSnapshot = clone(snapshot);
      if (!mappedSnapshot || !Array.isArray(mappedSnapshot.enrollments)) return mappedSnapshot;
      const mappedByStudentId = new Map();
      for (const enrollment of mappedSnapshot.enrollments) {
        const mappedEnrollment = {
          ...enrollment,
          studentId: studentIdMap.get(enrollment.studentId) || enrollment.studentId
        };
        const previous = mappedByStudentId.get(mappedEnrollment.studentId);
        if (previous) {
          if (!!previous.writtenExamSubjectQ4 !== !!mappedEnrollment.writtenExamSubjectQ4) {
            summary.writtenExamSubjectConflicts++;
          }
          continue;
        }
        mappedByStudentId.set(mappedEnrollment.studentId, mappedEnrollment);
      }
      mappedSnapshot.enrollments = Array.from(mappedByStudentId.values());
      return mappedSnapshot;
    };
    const remapArchiveHistory = history => (Array.isArray(history) ? history : []).map(entry => ({
      ...clone(entry),
      snapshot: remapSnapshotEnrollments(entry.snapshot)
    }));

    const courseIdMap = new Map();
    const coursesAddedByThisMerge = new Set();
    const coursesById = new Map((result.courses || []).map(c => [c.id, c]));
    const isExistingLocalArchive = course =>
      !!(course && course.archivedAt && !coursesAddedByThisMerge.has(course.id));
    const courseMergeScope = c => [
      c.schemaMode || '',
      Number.isInteger(Number(c.schoolYearStartYear)) ? String(Number(c.schoolYearStartYear)) : '',
      !!c.archivedAt
    ].join('|');
    const coursesByImportKey = new Map((result.courses || []).filter(c => c.importKey).map(c => [norm(c.importKey) + '|' + courseMergeScope(c), c]));
    for (const course of incoming.courses || []) {
      const plannedTargetId = identityPreflight.courseTargetIds.get(course.id);
      let target = coursesById.get(plannedTargetId) || null;
      if (!target) {
        target = clone(course);
        target.carriedForwardFromCourseId = null;
        target.enrollments = [];
        target.termResults = [];
        target.weightTemplateId = course.archivedAt
          ? (course.weightTemplateId || null)
          : (weightTemplateIdMap.get(course.weightTemplateId) || course.weightTemplateId || null);
        result.courses.push(target); coursesById.set(target.id, target); coursesAddedByThisMerge.add(target.id); summary.coursesAdded++;
      } else if (JSON.stringify(target.upperSecContext || null) !== JSON.stringify(course.upperSecContext || null)) {
        summary.upperSecContextConflicts++;
      }
      const incomingImportKey = course.importKey
        ? norm(course.importKey) + '|' + courseMergeScope(target)
        : '';
      const importKeyOwner = incomingImportKey ? coursesByImportKey.get(incomingImportKey) : null;
      if (isExistingLocalArchive(target)) {
        if (course.importKey && norm(course.importKey) !== norm(target.importKey || '')) {
          summary.archiveConflicts++;
        }
      } else if (!target.importKey && course.importKey && (!importKeyOwner || importKeyOwner === target)) {
        target.importKey = course.importKey;
        coursesByImportKey.set(incomingImportKey, target);
      }
      courseIdMap.set(course.id, target.id);
      target.enrollments = Array.isArray(target.enrollments) ? target.enrollments : [];
      if (target.archivedAt && !coursesAddedByThisMerge.has(target.id)) {
        for (const enrollment of course.enrollments || []) {
          const mappedEnrollment = { ...enrollment, studentId: studentIdMap.get(enrollment.studentId) || enrollment.studentId };
          const localEnrollment = target.enrollments.find(item => item.studentId === mappedEnrollment.studentId);
          const sameEnrollment = localEnrollment && Object.keys({ ...localEnrollment, ...mappedEnrollment }).every(key =>
            JSON.stringify(localEnrollment[key]) === JSON.stringify(mappedEnrollment[key])
          );
          if (!sameEnrollment) summary.archiveConflicts++;
        }
        continue;
      }
      const incomingHistory = remapArchiveHistory(course.archiveHistory);
      if (coursesAddedByThisMerge.has(target.id)) {
        target.archiveHistory = incomingHistory;
      } else {
        target.archiveHistory = Array.isArray(target.archiveHistory) ? target.archiveHistory : [];
        const existingHistory = new Set(target.archiveHistory.map(entry => JSON.stringify(entry)));
        for (const historyEntry of incomingHistory) {
          const key = JSON.stringify(historyEntry);
          if (existingHistory.has(key)) continue;
          target.archiveHistory.push(historyEntry);
          existingHistory.add(key);
        }
      }
      const enrolledIds = new Set(target.enrollments.map(e => e.studentId));
      for (const enrollment of course.enrollments || []) {
        const mappedStudentId = studentIdMap.get(enrollment.studentId);
        if (!mappedStudentId) continue;
        if (enrolledIds.has(mappedStudentId)) {
          const localEnrollment = target.enrollments.find(item => item.studentId === mappedStudentId);
          if (!!localEnrollment.writtenExamSubjectQ4 !== !!enrollment.writtenExamSubjectQ4) {
            summary.writtenExamSubjectConflicts++;
          }
          continue;
        }
        target.enrollments.push({ ...clone(enrollment), studentId: mappedStudentId });
        enrolledIds.add(mappedStudentId);
      }
      if (coursesAddedByThisMerge.has(target.id) && target.archiveSnapshot &&
          Array.isArray(target.archiveSnapshot.enrollments)) {
        target.archiveSnapshot = remapSnapshotEnrollments(target.archiveSnapshot);
      }
    }

    const studentReferenceState = new Map();
    const noteStudentReference = (studentId, accepted) => {
      if (!studentIdMap.has(studentId)) return;
      const status = studentReferenceState.get(studentId) || { hasReference: false, hasAcceptedReference: false };
      status.hasReference = true;
      if (accepted) status.hasAcceptedReference = true;
      studentReferenceState.set(studentId, status);
    };
    const noteEnrollmentReferences = (enrollments, accepted) => {
      for (const enrollment of enrollments || []) noteStudentReference(enrollment.studentId, accepted);
    };
    for (const incomingCourse of incoming.courses || []) {
      const targetCourse = coursesById.get(courseIdMap.get(incomingCourse.id));
      const skippedExistingArchive = targetCourse && targetCourse.archivedAt && !coursesAddedByThisMerge.has(targetCourse.id);
      const accepted = !skippedExistingArchive;
      noteEnrollmentReferences(incomingCourse.enrollments, accepted);
      for (const termResult of incomingCourse.termResults || []) noteStudentReference(termResult.studentId, accepted);
      noteEnrollmentReferences(incomingCourse.archiveSnapshot?.enrollments, accepted);
      for (const historyEntry of incomingCourse.archiveHistory || []) {
        noteEnrollmentReferences(historyEntry.snapshot?.enrollments, accepted);
      }
    }

    for (const incomingCourse of incoming.courses || []) {
      const targetCourse = coursesById.get(courseIdMap.get(incomingCourse.id));
      if (!targetCourse || !incomingCourse.carriedForwardFromCourseId) continue;
      const mappedPredecessorId = courseIdMap.get(incomingCourse.carriedForwardFromCourseId);
      if (!mappedPredecessorId) continue;
      if (isExistingLocalArchive(targetCourse)) {
        if (mappedPredecessorId !== targetCourse.carriedForwardFromCourseId) summary.archiveConflicts++;
        continue;
      }
      if (targetCourse.carriedForwardFromCourseId) continue;
      if (mappedPredecessorId && mappedPredecessorId !== targetCourse.id) {
        targetCourse.carriedForwardFromCourseId = mappedPredecessorId;
      }
    }

    const targetKey = result => `${result.studentId}|${result.term}`;
    for (const incomingCourse of incoming.courses || []) {
      const targetCourse = coursesById.get(courseIdMap.get(incomingCourse.id));
      if (!targetCourse) continue;
      const isNewArchive = !!targetCourse.archivedAt && coursesAddedByThisMerge.has(targetCourse.id);
      const isExistingArchive = !!targetCourse.archivedAt && !isNewArchive;
      targetCourse.termResults = Array.isArray(targetCourse.termResults) ? targetCourse.termResults : [];
      const existing = new Set(targetCourse.termResults.map(targetKey));
      for (const result of incomingCourse.termResults || []) {
        const mappedStudentId = studentIdMap.get(result.studentId);
        if (!mappedStudentId) continue;
        const mapped = { studentId: mappedStudentId, term: result.term, points: result.points };
        if (existing.has(targetKey(mapped))) {
          const local = targetCourse.termResults.find(item => targetKey(item) === targetKey(mapped));
          if (local.points !== mapped.points) summary.termResultConflicts++;
          continue;
        }
        if (isExistingArchive) {
          summary.archiveConflicts++;
          continue;
        }
        targetCourse.termResults.push(mapped);
        existing.add(targetKey(mapped));
      }
    }

    const assessmentsById = new Map((result.assessments || []).map(a => [a.id, a]));
    for (const assessment of incoming.assessments || []) {
      const mappedCourseId = courseIdMap.get(assessment.courseId);
      const mappedCourse = coursesById.get(mappedCourseId);
      const isNewImportedArchive = mappedCourse && mappedCourse.archivedAt && coursesAddedByThisMerge.has(mappedCourse.id);
      const skippedExistingArchive = mappedCourse && mappedCourse.archivedAt && !isNewImportedArchive;
      for (const studentId of Object.keys(assessment.scores || {})) noteStudentReference(studentId, !skippedExistingArchive);
      if (!mappedCourseId) continue;
      if (mappedCourse && mappedCourse.archivedAt && !isNewImportedArchive) {
        // Bestehende Archive bleiben unveraendert. Die Zusammenfassung meldet
        // jedoch nur tatsaechlich verworfene Unterschiede und neue Inhalte.
        const archivedProbe = {
          ...assessment,
          courseId: mappedCourseId,
          categoryId: assessment.categoryId,
          subcategoryId: assessment.subcategoryId || null
        };
        const sameId = assessmentsById.get(assessment.id);
        const archivedTarget = sameId && sameId.courseId === mappedCourseId ? sameId : null;
        if (!archivedTarget) {
          summary.archiveConflicts += 1 + Object.entries(assessment.scores || {})
            .filter(([studentId]) => studentIdMap.has(studentId)).length;
          continue;
        }
        if (!semanticEqual(assessmentMetadata(archivedTarget), assessmentMetadata(archivedProbe))) {
          summary.archiveConflicts++;
        }
        for (const [oldStudentId, score] of Object.entries(assessment.scores || {})) {
          const mappedStudentId = studentIdMap.get(oldStudentId);
          if (!mappedStudentId) continue;
          const localScore = archivedTarget.scores && archivedTarget.scores[mappedStudentId];
          if (!localScore || !semanticEqual(scoreSemantics(localScore), scoreSemantics(score))) {
            summary.archiveConflicts++;
          }
        }
        continue;
      }
      // Neue Archive behalten die Kategorie-IDs ihres historischen Snapshots;
      // aktive Kurse werden weiterhin auf die aktuellen Settings remappt.
      const mappedCategoryId = isNewImportedArchive ? assessment.categoryId : (categoryIdMap.get(assessment.categoryId) || assessment.categoryId);
      const mappedSubcategoryId = isNewImportedArchive
        ? (assessment.subcategoryId || null)
        : (assessment.subcategoryId ? (subcategoryIdMap.get(assessment.categoryId + '|' + assessment.subcategoryId) || assessment.subcategoryId) : null);
      const probe = { ...assessment, courseId: mappedCourseId, categoryId: mappedCategoryId, subcategoryId: mappedSubcategoryId };
      let target = assessmentsById.get(assessment.id);
      if (!target) {
        target = clone(probe);
        target.scores = {};
        result.assessments.push(target); assessmentsById.set(target.id, target); summary.assessmentsAdded++;
      } else if (!semanticEqual(assessmentMetadata(target), assessmentMetadata(probe))) {
        summary.assessmentMetadataConflicts++;
      }
      target.scores = target.scores || {};
      for (const [oldStudentId, score] of Object.entries(assessment.scores || {})) {
        const mappedStudentId = studentIdMap.get(oldStudentId);
        if (!mappedStudentId) continue;
        if (target.scores[mappedStudentId]) {
          if (!semanticEqual(scoreSemantics(target.scores[mappedStudentId]), scoreSemantics(score))) {
            summary.scoreConflicts++;
          }
          continue;
        }
        target.scores[mappedStudentId] = clone(score);
      }
    }
    const retainedAddedStudentIds = new Set();
    for (const student of incoming.students || []) {
      const mappedStudentId = studentIdMap.get(student.id);
      if (!studentsAddedByThisMerge.has(mappedStudentId)) continue;
      const status = studentReferenceState.get(student.id);
      if (!status || status.hasAcceptedReference) retainedAddedStudentIds.add(mappedStudentId);
    }
    let skippedOnlyStudents = 0;
    result.students = result.students.filter(student => {
      const remove = studentsAddedByThisMerge.has(student.id) && !retainedAddedStudentIds.has(student.id);
      if (remove) skippedOnlyStudents++;
      return !remove;
    });
    summary.studentsAdded -= skippedOnlyStudents;
    return { state: ensureStateShape(result), summary };
  }

  return { mergeImportedStateIntoCurrent };
}
