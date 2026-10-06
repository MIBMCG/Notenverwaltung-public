import {
  parseSemicolonCsv,
  validateCsvTransferHeader,
  normalizeCsvDate,
  decodeCsvTransferFields
} from './csv-format.js';
import {
  parseCsvTransferContextFields,
  validateCsvCourseContextConsistency,
  csvCourseContextMatches,
  validateCsvStudentIdentity,
  findCompatibleCsvStudent
} from './csv-import-rules.js';
import { createInitialAssessmentsForCourse } from '../domain/initial-assessments.js';

function updateStudentCreatedInCurrentCsv(candidate, createdStudentIds, studentId, values) {
  if (!createdStudentIds || !createdStudentIds.has(studentId)) return null;
  const student = (candidate.students || []).find(item => item.id === studentId);
  if (!student) return null;
  if (!student.lastName && values.lastName) student.lastName = values.lastName;
  if (!student.firstName && values.firstName) student.firstName = values.firstName;
  if (!student.birthDate && values.birthDate) student.birthDate = values.birthDate;
  if (!student.homeClass && values.homeClass) student.homeClass = values.homeClass;
  return student;
}

export function createCsvImportOrchestrator({ DomainModel }) {
  function prepareCsvImport(csvText, baseState, { excludeStartLines = [] } = {}) {
    if (typeof csvText !== 'string') return { errorMessage: 'CSV-Inhalt ist ungültig.' };

    const rows = parseSemicolonCsv(csvText.replace(/^\uFEFF/, ''));
    if (rows.length <= 1) return { errorMessage: 'Die CSV-Datei enthält keine Datenzeilen.' };

    const actualHeader = rows[0].fields.map(value => String(value || '').trim());
    let transferHeader;
    try {
      transferHeader = validateCsvTransferHeader(actualHeader);
    } catch (error) {
      return { errorMessage: 'CSV-Import abgebrochen: ' + error.message };
    }

    const excludedLines = new Set(excludeStartLines);
    const skippedStartLines = [];
    const dataLines = rows.slice(1).filter(row => {
      if (!excludedLines.has(row.line)) return true;
      skippedStartLines.push(row.line);
      return false;
    });
    const appliedStartLines = dataLines.map(row => row.line);
    const errors = [];
    const decodedRows = new Map();
    const rowDecodeErrors = new Map();
    let legacyFormulaProtectionHint = false;
    for (const row of dataLines) {
      const rawFields = Array.isArray(row.fields) ? row.fields : [];
      if (rawFields.length !== transferHeader.columnCount) {
        // Preserve the legacy row path, but never let malformed 14-column rows
        // contribute identity data before their fatal shape error is collected.
        decodedRows.set(row, transferHeader.columnCount === 14 ? null : rawFields);
        continue;
      }
      try {
        const fields = decodeCsvTransferFields(rawFields, transferHeader.columnCount);
        decodedRows.set(row, fields);
        if (transferHeader.columnCount !== 14 && fields.some(value => /^'[\t ]*[=+\-@]/.test(String(value ?? '')))) {
          legacyFormulaProtectionHint = true;
        }
      } catch (error) {
        decodedRows.set(row, null);
        rowDecodeErrors.set(row, error);
      }
    }

    const importCandidate = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(baseState)));
    const norm = value => (value || '').trim();
    const normLower = value => norm(value).toLowerCase();

    const csvStudentIdentities = new Map();
    for (const row of dataLines) {
      const parts = decodedRows.get(row);
      if (!Array.isArray(parts)) continue;
      const csvStudentKey = norm(parts[4]);
      if (!csvStudentKey) continue;
      const incoming = {
        lastName: norm(parts[5]),
        firstName: norm(parts[6]),
        birthDate: normalizeCsvDate(norm(parts[7])) || '',
        displayLastName: transferHeader.columnCount === 14 ? String(parts[5] ?? '') : norm(parts[5]),
        displayFirstName: transferHeader.columnCount === 14 ? String(parts[6] ?? '') : norm(parts[6])
      };
      const consolidated = csvStudentIdentities.get(csvStudentKey) || {
        lastName: '', firstName: '', birthDate: '', displayLastName: '', displayFirstName: ''
      };
      for (const key of ['lastName', 'firstName', 'birthDate']) {
        if (!consolidated[key] && incoming[key]) consolidated[key] = incoming[key];
      }
      for (const key of ['lastName', 'firstName']) {
        const displayKey = key === 'lastName' ? 'displayLastName' : 'displayFirstName';
        if (!consolidated[displayKey] && incoming[key]) consolidated[displayKey] = incoming[displayKey];
      }
      csvStudentIdentities.set(csvStudentKey, consolidated);
    }

    const studentIndex = new Map();
    for (const student of importCandidate.students) {
      const key = normLower(student.lastName) + '|' + normLower(student.firstName) + '|' + norm(student.birthDate);
      if (!studentIndex.has(key)) studentIndex.set(key, student.id);
      else if (studentIndex.get(key) !== student.id) studentIndex.set(key, null);
    }

    const explicitCourseIndex = new Map();
    const registerUniqueCourseKey = (index, key, courseId) => {
      if (!index.has(key)) index.set(key, courseId);
      else if (index.get(key) !== courseId) index.set(key, null);
    };
    for (const course of DomainModel.listActiveCourses(importCandidate)) {
      registerUniqueCourseKey(explicitCourseIndex, 'id:' + normLower(String(course.id)), course.id);
      if (course.importKey) {
        const idKey = 'id:' + normLower(String(course.importKey));
        registerUniqueCourseKey(explicitCourseIndex, idKey, course.id);
      }
    }

    const csvStudentMap = new Map();
    let createdCourses = 0;
    let createdStudents = 0;
    let createdEnrollments = 0;
    const createdStudentIds = new Set();
    const createdEnrollmentKeys = new Set();
    const csvCourseContexts = new Map();
    const csvEnrollmentWrittenFlags = new Map();
    const seenStudentSKey = new Map();

    for (const row of dataLines) {
      const lineNum = row.line;
      const rawParts = Array.isArray(row.fields) ? row.fields : [];
      const errorsBeforeRow = errors.length;
      if (rawParts.length !== transferHeader.columnCount) {
        errors.push({ line: lineNum, issues: ['Die Spaltenanzahl passt nicht zur Kopfzeile; erwartet werden ' + transferHeader.columnCount + ' Spalten.'], fatal: true });
        if (transferHeader.columnCount === 14) continue;
      }
      if (rowDecodeErrors.has(row)) {
        errors.push({ line: lineNum, issues: [rowDecodeErrors.get(row).message], fatal: true });
        continue;
      }
      const parts = decodedRows.get(row);
      if (!Array.isArray(parts) || parts.every(part => norm(part) === '')) continue;

      const csvCourseKey = norm(parts[0]);
      const courseName = transferHeader.columnCount === 14 ? String(parts[1] ?? '') : norm(parts[1]);
      const normalizedCourseName = norm(courseName);
      const subject = norm(parts[2]);
      const classLabel = norm(parts[3]);
      const csvStudentKey = norm(parts[4]);
      const lastName = transferHeader.columnCount === 14 ? String(parts[5] ?? '') : norm(parts[5]);
      const firstName = transferHeader.columnCount === 14 ? String(parts[6] ?? '') : norm(parts[6]);
      const normalizedLastName = norm(lastName);
      const normalizedFirstName = norm(firstName);
      const birthDateRaw = norm(parts[7]);
      const birthDate = normalizeCsvDate(birthDateRaw);
      const homeClass = transferHeader.columnCount >= 13 ? norm(parts[12]) : classLabel;
      const csvContext = parseCsvTransferContextFields(parts.slice(8, 12));
      const csvContextKey = csvCourseKey ? 'id:' + normLower(csvCourseKey) : normLower(courseName) + '|' + normLower(subject);
      const contextIssues = csvContext.issues.concat(
        validateCsvCourseContextConsistency(csvCourseContexts, csvContextKey, csvContext)
      );
      if (contextIssues.length > 0) {
        errors.push({ line: lineNum, issues: contextIssues.map(issue => 'Ungültiger CSV-Kurskontext: ' + issue), fatal: true });
      }
      if (birthDateRaw && !(typeof birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthDate))) {
        errors.push({ line: lineNum, issues: ['Ungültiges Geburtsdatum; erwartet wird YYYY-MM-DD oder DD.MM.YYYY.'], fatal: true });
      }
      if (!normalizedCourseName && !normalizedLastName && !normalizedFirstName) continue;
      if (rawParts.length !== transferHeader.columnCount || contextIssues.length > 0) continue;

      let courseId = null;
      if (csvCourseKey) {
        const idKey = 'id:' + normLower(csvCourseKey);
        if (explicitCourseIndex.has(idKey)) {
          courseId = explicitCourseIndex.get(idKey);
          if (!courseId) {
            errors.push({ line: lineNum, issues: ['Die explizite KursID ist mehreren vorhandenen Kursen zugeordnet.'], fatal: true });
            continue;
          }
        }
      }
      const schemaExplicit = transferHeader.columnCount >= 9 && !!norm(rawParts[8]);
      if (csvCourseKey && courseId) {
        const resolvedCourse = importCandidate.courses.find(item => item.id === courseId);
        if (subject && normLower(resolvedCourse && resolvedCourse.subject) !== normLower(subject)) {
          errors.push({ line: lineNum, issues: ['Ungültige CSV-Kursidentität: Die Fachangabe widerspricht der expliziten KursID.'], fatal: true });
          continue;
        }
        if (schemaExplicit && resolvedCourse && resolvedCourse.schemaMode !== csvContext.schemaMode) {
          errors.push({ line: lineNum, issues: ['Ungültige CSV-Kursidentität: Das Schema widerspricht der expliziten KursID.'], fatal: true });
          continue;
        }
      }

      if (!csvCourseKey && normalizedCourseName) {
        let candidates = DomainModel.listActiveCourses(importCandidate).filter(course =>
          normLower(course.name) === normLower(courseName) && normLower(course.subject) === normLower(subject)
        );
        if (schemaExplicit) {
          candidates = candidates.filter(course => course.schemaMode === csvContext.schemaMode);
        }
        if (csvContext.contextProvided) {
          candidates = candidates.filter(course => csvCourseContextMatches(course, csvContext));
        }
        if (classLabel) {
          const sameClass = candidates.filter(course => normLower(course.classLabel) === normLower(classLabel));
          if (sameClass.length > 0) candidates = sameClass;
        }
        if (candidates.length === 1) {
          courseId = candidates[0].id;
        } else if (candidates.length > 1) {
          errors.push({ line: lineNum, issues: ['Ungültige CSV-Kursidentität: Mehrere passende Kurse für den ID-freien Namensabgleich.'], fatal: true });
          continue;
        }
      }

      if (!courseId && normalizedCourseName) {
        const course = DomainModel.createCourse({
          name: courseName,
          subject,
          classLabel,
          schemaMode: csvContext.schemaMode,
          weightTemplateId: null,
          upperSecContext: csvContext.upperSecContext,
          importKey: csvCourseKey || null
        });
        DomainModel.addCourseToState(importCandidate, course);
        createInitialAssessmentsForCourse(DomainModel, importCandidate, course);
        courseId = course.id;
        if (csvCourseKey) {
          registerUniqueCourseKey(explicitCourseIndex, 'id:' + normLower(csvCourseKey), courseId);
        }
        createdCourses++;
      }

      if (courseId) {
        const resolvedCourse = importCandidate.courses.find(item => item.id === courseId);
        if (!csvCourseContextMatches(resolvedCourse, csvContext)) {
          errors.push({ line: lineNum, issues: ['Ungültiger CSV-Kurskontext: Der Kurskontext widerspricht dem bereits vorhandenen Kurs.'], fatal: true });
          continue;
        }
      }

      let studentId = null;
      let pendingCreatedStudentUpdate = null;
      if (csvStudentKey && csvStudentMap.has(csvStudentKey)) {
        studentId = csvStudentMap.get(csvStudentKey);
        if (!lastName || !firstName) errors.push({ line: lineNum, issues: ['Vorname oder Nachname fehlt.'] });
        pendingCreatedStudentUpdate = { lastName, firstName, birthDate: birthDate || '', homeClass };
        const mappedStudent = importCandidate.students.find(item => item.id === studentId);
        const identityConflicts = validateCsvStudentIdentity(mappedStudent, pendingCreatedStudentUpdate);
        if (identityConflicts.length > 0) {
          errors.push({
            line: lineNum,
            issues: ['Ungültige CSV-Schüleridentität: Dieselbe SchuelerID enthält widersprüchliche Identitätsfelder (' + identityConflicts.join(', ') + ').'],
            fatal: true
          });
          continue;
        }
      } else if (normalizedLastName || normalizedFirstName) {
        if (!normalizedLastName || !normalizedFirstName) errors.push({ line: lineNum, issues: ['Vorname oder Nachname fehlt.'] });
        const consolidatedIdentity = csvStudentKey ? (csvStudentIdentities.get(csvStudentKey) || {}) : {};
        const matchingLastName = consolidatedIdentity.lastName || lastName;
        const matchingFirstName = consolidatedIdentity.firstName || firstName;
        const matchingBirthDate = consolidatedIdentity.birthDate || birthDate || '';
        const studentKey = normLower(matchingLastName) + '|' + normLower(matchingFirstName) + '|' + matchingBirthDate;
        if (studentIndex.has(studentKey)) {
          studentId = studentIndex.get(studentKey);
          if (!studentId) {
            errors.push({ line: lineNum, issues: ['Ungültige CSV-Schüleridentität: Die SchuelerID passt zu mehreren vorhandenen Personen.'], fatal: true });
            continue;
          }
        } else if (csvStudentKey) {
          const compatible = findCompatibleCsvStudent(importCandidate.students, {
            lastName: matchingLastName, firstName: matchingFirstName, birthDate: matchingBirthDate
          });
          if (compatible.ambiguous) {
            errors.push({ line: lineNum, issues: ['Ungültige CSV-Schüleridentität: Die SchuelerID passt zu mehreren vorhandenen Personen.'], fatal: true });
            continue;
          }
          studentId = compatible.studentId;
        } else if (seenStudentSKey.has(studentKey)) {
          studentId = seenStudentSKey.get(studentKey);
          errors.push({ line: lineNum, issues: ['Duplikat in der CSV; die Zeile wird mit dem ersten Eintrag zusammengeführt.'] });
        }
        const rowIssues = errors.slice(errorsBeforeRow).filter(entry => entry.line === lineNum);
        const mayCreateFromConsolidatedIdentity = csvStudentKey && consolidatedIdentity.lastName && consolidatedIdentity.firstName &&
          rowIssues.length > 0 && rowIssues.every(entry => entry.fatal !== true &&
            (entry.issues || []).every(issue => issue === 'Vorname oder Nachname fehlt.'));
        if (!studentId && (rowIssues.length === 0 || mayCreateFromConsolidatedIdentity)) {
          const student = DomainModel.createStudent({
            lastName: transferHeader.columnCount === 14
              ? (consolidatedIdentity.displayLastName || lastName)
              : matchingLastName,
            firstName: transferHeader.columnCount === 14
              ? (consolidatedIdentity.displayFirstName || firstName)
              : matchingFirstName,
            birthDate: matchingBirthDate || null,
            homeClass
          });
          DomainModel.addStudentToState(importCandidate, student);
          studentId = student.id;
          studentIndex.set(studentKey, studentId);
          seenStudentSKey.set(studentKey, studentId);
          if (csvStudentKey) csvStudentMap.set(csvStudentKey, studentId);
          createdStudents++;
          createdStudentIds.add(studentId);
        }
        if (csvStudentKey && studentId) csvStudentMap.set(csvStudentKey, studentId);
      }

      if (courseId && studentId) {
        const enrollmentKey = JSON.stringify([courseId, studentId]);
        let writtenFlagConflict = false;
        if (csvContext.writtenExamSubjectQ4Specified) {
          if (csvEnrollmentWrittenFlags.has(enrollmentKey) && csvEnrollmentWrittenFlags.get(enrollmentKey) !== csvContext.writtenExamSubjectQ4) {
            errors.push({ line: lineNum, issues: ['Ungültiger CSV-Kurskontext: Widersprüchliche Angaben zum 3. Pruefungsfach für dieselbe Einschreibung.'], fatal: true });
            writtenFlagConflict = true;
          } else if (!csvEnrollmentWrittenFlags.has(enrollmentKey)) {
            csvEnrollmentWrittenFlags.set(enrollmentKey, csvContext.writtenExamSubjectQ4);
          }
        }
        const enrollmentCreated = DomainModel.enrollStudentInCourse(importCandidate, courseId, studentId, null);
        if (csvContext.writtenExamSubjectQ4Specified && !writtenFlagConflict) {
          DomainModel.setWrittenExamSubjectQ4(importCandidate, courseId, studentId, csvContext.writtenExamSubjectQ4);
        }
        if (enrollmentCreated) {
          createdEnrollments++;
          createdEnrollmentKeys.add(enrollmentKey);
          if (homeClass) {
            const course = importCandidate.courses.find(item => item.id === courseId);
            const enrollment = course && (course.enrollments || []).find(item => item.studentId === studentId);
            if (enrollment) enrollment.homeClassAtEnrollment = homeClass;
          }
        }
      } else if (studentId && !courseId) {
        errors.push({ line: lineNum, issues: ['Kein Kurs ermittelt oder angegeben; die Person wurde nicht eingeschrieben.'] });
      }

      if (pendingCreatedStudentUpdate && errors.length === errorsBeforeRow) {
        const studentBeforeUpdate = importCandidate.students.find(item => item.id === studentId);
        const previousStudentKey = studentBeforeUpdate
          ? normLower(studentBeforeUpdate.lastName) + '|' + normLower(studentBeforeUpdate.firstName) + '|' + norm(studentBeforeUpdate.birthDate)
          : null;
        const updatedStudent = updateStudentCreatedInCurrentCsv(importCandidate, createdStudentIds, studentId, pendingCreatedStudentUpdate);
        if (updatedStudent) {
          const updatedStudentKey = normLower(updatedStudent.lastName) + '|' + normLower(updatedStudent.firstName) + '|' + norm(updatedStudent.birthDate);
          if (previousStudentKey && previousStudentKey !== updatedStudentKey && studentIndex.get(previousStudentKey) === studentId) studentIndex.delete(previousStudentKey);
          studentIndex.set(updatedStudentKey, studentId);
          seenStudentSKey.set(updatedStudentKey, studentId);
          if (courseId && updatedStudent.homeClass && createdEnrollmentKeys.has(JSON.stringify([courseId, studentId]))) {
            const course = importCandidate.courses.find(item => item.id === courseId);
            const enrollment = course && (course.enrollments || []).find(item => item.studentId === studentId);
            if (enrollment) enrollment.homeClassAtEnrollment = updatedStudent.homeClass;
          }
        }
      }

    }

    return {
      importCandidate,
      transferHeader,
      errors,
      createdCourses,
      createdStudents,
      createdEnrollments,
      legacyFormulaProtectionHint,
      skippedStartLines,
      appliedStartLines
    };
  }

  return { prepareCsvImport };
}
