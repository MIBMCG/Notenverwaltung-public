// FROZEN TEST-ONLY historical parity oracle. Do not edit or ship in production.
// Source: 4cc0ae1ca26251496e50d90f986d7ce9b65c3ef5:src/legacy/application.js (DomainModel IIFE, LF-normalized).
// SHA-256 of IIFE including trailing LF: 2af9577cfac981bd4a29121ac31934613c9c6d93cc8b9bc7e7efa2babd0f99fa
    const DomainModel = (function () {
      const SCHEMA_MODES = {
        GRADES: "grades",
        UPPERSEC: "uppersec"
      };

      const UPPERSEC_COURSE_TYPES = {
        BASIC: "basic",
        ADVANCED: "advanced",
        OTHER: "other"
      };

      const QUALIFICATION_YEARS = {
        Q1_Q2: "q1-q2",
        Q3_Q4: "q3-q4"
      };

      const SCORE_STATUS = {
        VALID: "valid",
        MISSING: "missing",
        EXCUSED: "excused"
      };

      const STANDARD_GRADE_LABELS = [
        "1+", "1", "1-", "2+", "2", "2-", "3+", "3", "3-",
        "4+", "4", "4-", "5+", "5", "5-", "6"
      ];

      const RECOMMENDED_WEIGHT_TEMPLATE_IDS = {
        SEKI_EXAMPLE: "wt_berlin_seki_50_50_example",
        SEKII_ONE_EXAM: "wt_berlin_sekii_one_exam",
        SEKII_TWO_EXAMS: "wt_berlin_sekii_two_exams"
      };

      function generateId(prefix) {
        return prefix + "_" + Math.random().toString(36).slice(2, 10);
      }

      function createDefaultGradeMapping() {
        return {
          "1+": 0.7,
          "1": 1.0,
          "1-": 1.3,
          "2+": 1.7,
          "2": 2.0,
          "2-": 2.3,
          "3+": 2.7,
          "3": 3.0,
          "3-": 3.3,
          "4+": 3.7,
          "4": 4.0,
          "4-": 4.3,
          "5+": 4.7,
          "5": 5.0,
          "5-": 5.3,
          "6": 6.0
        };
      }

      function createDefaultCategories() {
        return [
          { id: generateId("cat"), name: "Mündlich",   active: true },
          { id: generateId("cat"), name: "Schriftlich", active: true },
          { id: generateId("cat"), name: "Sonstiges",  active: true }
        ];
      }

      function normalizeCategoryName(value) {
        return String(value || "")
          .trim()
          .toLocaleLowerCase("de")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
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

      function createDefaultWeightTemplates(categories, existingTemplates = []) {
        const categoryIds = new Set(categories.map(category => category.id));
        const catByName = new Map(
          categories.map(category => [normalizeCategoryName(category.name), category.id])
        );

        function findByAliases(aliases) {
          for (const alias of aliases) {
            const id = catByName.get(alias);
            if (id && categoryIds.has(id)) return id;
          }
          return null;
        }

        let oralId = findByAliases([
          "mundlich", "muendlich", "mundliche leistungen", "muendliche leistungen",
          "mitarbeit", "sonstige mitarbeit"
        ]);
        let writtenId = findByAliases([
          "schriftlich", "schriftliche leistungen", "klassenarbeit", "klassenarbeiten",
          "klausur", "klausuren"
        ]);
        const otherId = findByAliases([
          "sonstiges", "sonstige", "sonstige leistungen", "weitere leistungen"
        ]);

        if (!oralId || !writtenId) {
          for (const legacyTemplate of existingTemplates) {
            if (!legacyTemplate || !Array.isArray(legacyTemplate.items)) continue;
            const name = String(legacyTemplate.name || "");
            if (name !== "Standard Sek I (67/33)" && !name.startsWith("Altbestand Sek I (67/33)")) continue;
            if (legacyTemplate.items.length < 2) continue;

            const legacyOralId = legacyTemplate.items[0] && legacyTemplate.items[0].categoryId;
            const legacyWrittenId = legacyTemplate.items[1] && legacyTemplate.items[1].categoryId;
            const pairIsUsable = categoryIds.has(legacyOralId)
              && categoryIds.has(legacyWrittenId)
              && legacyOralId !== legacyWrittenId;
            const pairMatchesResolvedRoles = (!oralId || oralId === legacyOralId)
              && (!writtenId || writtenId === legacyWrittenId);
            if (!pairIsUsable || !pairMatchesResolvedRoles) continue;

            if (!oralId) oralId = legacyOralId;
            if (!writtenId) writtenId = legacyWrittenId;
            break;
          }
        }

        if (oralId === writtenId) return [];
        if (!oralId || !writtenId) return [];

        function remainingItems(writtenPercent, oralPercent, otherPercent) {
          const items = [
            { categoryId: writtenId, weightPercent: writtenPercent },
            { categoryId: oralId, weightPercent: otherId ? oralPercent : 100 - writtenPercent }
          ];
          if (otherId) items.push({ categoryId: otherId, weightPercent: otherPercent });
          return items;
        }

        return [
          {
            id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKI_EXAMPLE,
            name: "Berlin Sek I mit Klassenarbeiten – Beispiel 50/50 (anpassbar)",
            items: remainingItems(50, 40, 10)
          },
          {
            id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
            name: "Berlin Oberstufe – eine Klausur 1/3 zu 2/3 (anpassbar)",
            items: remainingItems(33.33, 56.67, 10)
          },
          {
            id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
            name: "Berlin Oberstufe – zwei Klausuren 1/2 zu 1/2 (anpassbar)",
            items: remainingItems(50, 40, 10)
          }
        ];
      }

      function createDefaultSettings() {
        const categories = createDefaultCategories();
        const weightTemplates = createDefaultWeightTemplates(categories);

        return {
          gradeMapping: createDefaultGradeMapping(),
          categories: categories,
          weightTemplates: weightTemplates,
          // Zentrale Halbjahrs-Einstellungen für Sek I und Sek II
          halfYearSettings: {
            seckI: {
              // Schuljahr 25/26: 08.09.2025 - 08.07.2026
              schoolYearStartYear: 2025,
              schoolYearStartMonth: 9,    // September
              schoolYearStartDay: 8,      // 8. September
              h1EndYear: 2026,
              h1EndMonth: 1,              // Januar
              h1EndDay: 30,               // 30. Januar
              h2StartYear: 2026,
              h2StartMonth: 2,            // Februar
              h2StartDay: 9               // 9. Februar
            },
            seckII: {
              // Oberstufe: Normalerweise gleich wie Sek I
              schoolYearStartYear: 2025,
              schoolYearStartMonth: 9,
              schoolYearStartDay: 8,
              h1EndYear: 2026,
              h1EndMonth: 1,
              h1EndDay: 30,
              h2StartYear: 2026,
              h2StartMonth: 2,
              h2StartDay: 9
            }
          },
          halfYearNames: {
            seckI: {
              h1: 'H1',
              h2: 'H2'
            },
            seckII: {
              h1: 'Q1',
              h2: 'Q2'
            }
          },
          // Legacy: Fallback für alte Daten
          termCutoffs: {
            schoolYearStartMonth: 9,
            h1EndMonth: 1,
            h1EndDay: 30,
            h2StartMonth: 2,
            h2StartDay: 9
          }
        };
      }

      /* BUGFIX 1: Korrigierte Signatur von createStudent und Destrukturierung */
      function createStudent({ id = null, lastName, firstName, birthDate = null, homeClass = "" }) {
        return {
          id: id || generateId("stu"),
          lastName: lastName || "",
          firstName: firstName || "",
          birthDate: birthDate || null,
          // Stammklasse des Schülers (z. B. "9a").
          homeClass: homeClass || ""
        };
      }

      function normalizeWeightingDeviationReason(value) {
        const text = String(value || "").trim();
        return text ? text.slice(0, 1000) : null;
      }

      function normalizeUpperSecContext(schemaMode, value) {
        if (schemaMode !== SCHEMA_MODES.UPPERSEC) return null;
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const courseTypes = new Set(Object.values(UPPERSEC_COURSE_TYPES));
        const qualificationYears = new Set(Object.values(QUALIFICATION_YEARS));
        return {
          courseType: courseTypes.has(value.courseType) ? value.courseType : null,
          qualificationYear: qualificationYears.has(value.qualificationYear) ? value.qualificationYear : null,
          weightingDeviationReason: normalizeWeightingDeviationReason(value.weightingDeviationReason)
        };
      }

      function createEnrollment({
        studentId,
        subgroup = null,
        homeClassAtEnrollment = null,
        writtenExamSubjectQ4 = false
      }) {
        return {
          studentId: studentId,
          subgroup: subgroup,
          homeClassAtEnrollment: homeClassAtEnrollment || null,
          writtenExamSubjectQ4: writtenExamSubjectQ4 === true
        };
      }

      function createCourse({
        id = null,
        name,
        subject,
        classLabel,
        schemaMode = SCHEMA_MODES.GRADES,
        weightTemplateId = null,
        includePrevTermGrades = false,
        termCutoffs = null,
        showAttendance = true,
        archivedAt = null,
        archiveReason = null,
        archiveRetentionUntil = null,
        archiveNote = null,
        schoolYearStartYear = null,
        carriedForwardFromCourseId = null,
        archiveSnapshot = null,
        archiveHistory = [],
        importKey = null,
        termResults = [],
        upperSecContext = null
      }) {
        return {
          id: id || generateId("course"),
          name: name ?? "",
          subject: subject ?? "",
          classLabel: classLabel ?? "",
          schemaMode,
          weightTemplateId,
          includePrevTermGrades: !!includePrevTermGrades,
          termCutoffs: termCutoffs,
          showAttendance: showAttendance === false ? false : true,
          archivedAt: archivedAt || null,
          archiveReason: archiveReason || null,
          archiveRetentionUntil: normalizeArchiveRetentionUntil(archiveRetentionUntil),
          archiveNote: normalizeArchiveNote(archiveNote),
          schoolYearStartYear: Number.isInteger(Number(schoolYearStartYear)) ? Number(schoolYearStartYear) : null,
          carriedForwardFromCourseId: carriedForwardFromCourseId || null,
          archiveSnapshot: archiveSnapshot && typeof archiveSnapshot === "object" ? archiveSnapshot : null,
          archiveHistory: normalizeArchiveHistory(archiveHistory, schemaMode),
          importKey: importKey || null,
          termResults: Array.isArray(termResults) ? termResults.map(item => ({ ...item })) : [],
          upperSecContext: normalizeUpperSecContext(schemaMode, upperSecContext),
          enrollments: []
        };
      }

      function createCategory({ id = null, name, active = true, subcategories = [] }) {
        return {
          id: id || generateId("cat"),
          name: name ?? "",
          active: !!active,
          // Unterkategorien mit Gewichtung
          // z.B. [{ id: "...", name: "Klassenarbeiten", weightPercent: 60 }, { id: "...", name: "Vokabeltests", weightPercent: 40 }]
          subcategories: Array.isArray(subcategories) ? subcategories : []
        };
      }

      function getDefaultSubcategoryWeight(category) {
        const subcategories = category && Array.isArray(category.subcategories)
          ? category.subcategories
          : [];
        return subcategories.length === 0 ? 100 : 0;
      }

      function createWeightTemplate({ id = null, name, items }) {
        return {
          id: id || generateId("wt"),
          name: name ?? "",
          items: Array.isArray(items) ? items.map(item => ({
            categoryId: item.categoryId,
            weightPercent: Number(item.weightPercent) || 0
          })) : []
        };
      }

      function createScoreEntry({
        valueRaw = null,
        status = SCORE_STATUS.VALID,
        valueNumeric = null
      } = {}) {
        return {
          valueRaw,
          status,
          valueNumeric
        };
      }

      function createAssessment({
        id = null,
        courseId,
        categoryId,
        subcategoryId = null,
        title,
        date = null,
        term = null,
        maxPoints = null,
        weight = 1,
        visible = true
      }) {
        const parsedWeight = weight === null || (typeof weight === "string" && weight.trim() === "")
          ? NaN
          : Number(weight);
        return {
          id: id || generateId("asm"),
          courseId,
          categoryId,
          subcategoryId: subcategoryId || null,  // Optional: Unterkategorie
          title: title ?? "",
          date: date,
          term: term || null,
          maxPoints: maxPoints !== undefined && maxPoints !== null
            ? Number(maxPoints)
            : null,
          weight: Number.isFinite(parsedWeight) ? parsedWeight : 1,
          visible: visible !== false,
          scores: {}
        };
      }

      function createEmptyState() {
        const settings = createDefaultSettings();
        return {
          version: 1,
          students: [],
          courses: [],
          assessments: [],
          settings: settings
        };
      }

      function findStudentById(state, studentId) {
        return state.students.find(s => s.id === studentId) || null;
      }

      function findCourseById(state, courseId) {
        return state.courses.find(c => c.id === courseId) || null;
      }

      function isCanonicalTerm(term) {
        return /^\d{4}-H[12]$/.test(String(term || ''));
      }

      function getTermResult(course, studentId, term) {
        const item = ((course && course.termResults) || []).find(result =>
          result.studentId === studentId && result.term === term
        );
        return item && Number.isInteger(item.points) ? item.points : null;
      }

      function setTermResult(state, courseId, studentId, term, pointsOrNull) {
        const course = findCourseById(state, courseId);
        if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC || course.archivedAt) {
          throw new Error('Festsetzungen sind nur in aktiven Sek-II-Kursen erlaubt.');
        }
        if (!findStudentById(state, studentId)) throw new Error('Unbekannte Person.');
        if (!(course.enrollments || []).some(enrollment => enrollment.studentId === studentId)) {
          throw new Error('Die Person ist nicht in diesem Kurs eingeschrieben.');
        }
        if (!isCanonicalTerm(term)) throw new Error('Ungueltiges Halbjahr.');
        if (pointsOrNull !== null && (!Number.isInteger(pointsOrNull) || pointsOrNull < 0 || pointsOrNull > 15)) {
          throw new Error('Die festgesetzte Punktzahl muss ganzzahlig zwischen 0 und 15 liegen.');
        }
        if (!Array.isArray(course.termResults)) course.termResults = [];
        const index = course.termResults.findIndex(result => result.studentId === studentId && result.term === term);
        if (pointsOrNull === null) {
          if (index >= 0) course.termResults.splice(index, 1);
          return null;
        }
        const next = { studentId, term, points: pointsOrNull };
        if (index >= 0) course.termResults[index] = next;
        else course.termResults.push(next);
        return pointsOrNull;
      }

      function findAssessmentById(state, assessmentId) {
        return state.assessments.find(a => a.id === assessmentId) || null;
      }

      function listAssessmentsForCourse(state, courseId) {
        return state.assessments.filter(a => a.courseId === courseId);
      }

      function listEnrollmentsForCourse(state, courseId) {
        const course = findCourseById(state, courseId);
        return course ? course.enrollments : [];
      }

      function findEnrollment(stateOrCourse, courseIdOrStudentId, maybeStudentId) {
        const hasStateShape = stateOrCourse && Array.isArray(stateOrCourse.courses);
        const course = hasStateShape
          ? findCourseById(stateOrCourse, courseIdOrStudentId)
          : stateOrCourse;
        const studentId = hasStateShape ? maybeStudentId : courseIdOrStudentId;
        return ((course && course.enrollments) || []).find(enrollment =>
          enrollment && enrollment.studentId === studentId
        ) || null;
      }

      function setWrittenExamSubjectQ4(state, courseId, studentId, value) {
        const course = findCourseById(state, courseId);
        if (!course || course.archivedAt) {
          throw new Error("Die Kennzeichnung ist nur in einem aktiven Kurs erlaubt.");
        }
        const context = course.upperSecContext;
        if (course.schemaMode !== SCHEMA_MODES.UPPERSEC || !context ||
          context.courseType !== UPPERSEC_COURSE_TYPES.BASIC ||
          context.qualificationYear !== QUALIFICATION_YEARS.Q3_Q4) {
          throw new Error("Die Kennzeichnung ist nur in einem Grundkurs Q3/Q4 erlaubt.");
        }
        if (value !== true && value !== false) {
          throw new Error("Die Kennzeichnung muss Ja oder Nein sein.");
        }
        const enrollment = findEnrollment(course, studentId);
        if (!enrollment) throw new Error("Die Person ist nicht in diesem Kurs eingeschrieben.");
        enrollment.writtenExamSubjectQ4 = value;
        return value;
      }

      function resolveQualificationPhase(course, term) {
        if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC || !isCanonicalTerm(term)) return null;
        const context = course.upperSecContext;
        if (!context) return null;
        const half = String(term).endsWith("-H1") ? 1 : 2;
        if (context.qualificationYear === QUALIFICATION_YEARS.Q1_Q2) return half === 1 ? "Q1" : "Q2";
        if (context.qualificationYear === QUALIFICATION_YEARS.Q3_Q4) return half === 1 ? "Q3" : "Q4";
        return null;
      }

      function enrollStudentInCourse(state, courseId, studentId, subgroup = null, homeClassAtEnrollment = null) {
        const course = findCourseById(state, courseId);
        if (!course) return false;

        const already = course.enrollments.some(e => e.studentId === studentId);
        if (!already) {
          const student = findStudentById(state, studentId);
          course.enrollments.push(createEnrollment({
            studentId,
            subgroup,
            homeClassAtEnrollment: homeClassAtEnrollment || (student && student.homeClass) || null
          }));
          return true;
        }
        return false;
      }

      function listActiveCourses(state) {
        return (state && Array.isArray(state.courses) ? state.courses : []).filter(c => c && !c.archivedAt);
      }

      function listArchivedCourses(state) {
        return (state && Array.isArray(state.courses) ? state.courses : []).filter(c => c && !!c.archivedAt);
      }

      function studentHasArchivedCourseReference(state, studentId) {
        if (!state || !studentId) return false;
        return (Array.isArray(state.courses) ? state.courses : []).some(course => {
          if (!course) return false;
          if (course.archivedAt && listReferencedStudentIdsForCourse(state, course.id).has(studentId)) return true;
          return (course.archiveHistory || []).some(historyEntry =>
            ((historyEntry && historyEntry.snapshot && historyEntry.snapshot.enrollments) || [])
              .some(enrollment => enrollment && enrollment.studentId === studentId)
          );
        });
      }

      function listReferencedStudentIdsForCourse(state, courseId) {
        const ids = new Set();
        const course = findCourseById(state, courseId);
        for (const enrollment of (course && course.enrollments) || []) if (enrollment && enrollment.studentId) ids.add(enrollment.studentId);
        for (const result of (course && course.termResults) || []) if (result && result.studentId) ids.add(result.studentId);
        const snapshots = [];
        if (course && course.archiveSnapshot && typeof course.archiveSnapshot === 'object') snapshots.push(course.archiveSnapshot);
        for (const historyEntry of (course && course.archiveHistory) || []) {
          if (historyEntry && historyEntry.snapshot && typeof historyEntry.snapshot === 'object') snapshots.push(historyEntry.snapshot);
        }
        for (const snapshot of snapshots) {
          for (const enrollment of snapshot.enrollments || []) {
            if (enrollment && enrollment.studentId) ids.add(enrollment.studentId);
          }
        }
        for (const assessment of listAssessmentsForCourse(state, courseId)) {
          for (const studentId of Object.keys((assessment && assessment.scores) || {})) ids.add(studentId);
        }
        return ids;
      }

      function listStudentReportCourses(state, studentId, activeCourseFilterId = null) {
        const activeCourses = listActiveCourses(state).filter(course =>
          (course.enrollments || []).some(enrollment => enrollment && enrollment.studentId === studentId)
        );
        if (activeCourseFilterId) {
          return activeCourses.filter(course => course.id === activeCourseFilterId);
        }
        const archivedCourses = listArchivedCourses(state).filter(course =>
          listReferencedStudentIdsForCourse(state, course.id).has(studentId)
        );
        return activeCourses.concat(archivedCourses);
      }

      function resolveUpperSecWrittenCategoryId(settings) {
        const snapshottedRole = settings && settings.categoryRoles && settings.categoryRoles.upperSecWrittenCategoryId;
        if (snapshottedRole) return snapshottedRole;
        const templates = Array.isArray(settings && settings.weightTemplates)
          ? settings.weightTemplates
          : [];
        const oneExam = templates.find(template =>
          template && template.id === RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM
        );
        const twoExams = templates.find(template =>
          template && template.id === RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
        );
        if (!oneExam || !twoExams || !Array.isArray(oneExam.items) || !Array.isArray(twoExams.items)) return null;
        const candidates = Array.from(new Set(oneExam.items
          .filter(item => item && item.categoryId && Math.abs(Number(item.weightPercent) - 33.33) < 0.001)
          .filter(item => twoExams.items.some(twoExamItem =>
            twoExamItem && twoExamItem.categoryId === item.categoryId &&
            Math.abs(Number(twoExamItem.weightPercent) - 50) < 0.001
          ))
          .map(item => item.categoryId)));
        return candidates.length === 1 ? candidates[0] : null;
      }

      function createArchiveSnapshot(state, course) {
        const settings = (state && state.settings) || {};
        const templates = settings.weightTemplates || [];
        const hasCourseTermCutoffs = !!(course && course.termCutoffs && typeof course.termCutoffs === "object");
        const selectedTemplate = course && course.weightTemplateId
          ? templates.find(t => t.id === course.weightTemplateId) || null
          : null;
        const upperSecWrittenCategoryId = resolveUpperSecWrittenCategoryId(settings);
        return JSON.parse(JSON.stringify({
          createdAt: new Date().toISOString(),
          schemaMode: course && course.schemaMode,
          gradeMapping: settings.gradeMapping || {},
          categories: settings.categories || [],
          weightTemplate: selectedTemplate,
          halfYearNames: settings.halfYearNames || {},
          halfYearSettings: settings.halfYearSettings || {},
          termCutoffs: hasCourseTermCutoffs ? course.termCutoffs : null,
          termCutoffSource: hasCourseTermCutoffs ? "course" : "schema",
          upperSecContext: (course && course.upperSecContext) || null,
          enrollments: (course && course.enrollments) || [],
          categoryRoles: { upperSecWrittenCategoryId }
        }));
      }

      function planCourseSuccessor(course, targetYear) {
        const normalizedTargetYear = Number(targetYear);
        if (!Number.isInteger(normalizedTargetYear) || normalizedTargetYear < 2000 || normalizedTargetYear > 2200) {
          throw new Error("Das Zieljahr ist ungültig.");
        }
        if (!course || course.schemaMode !== SCHEMA_MODES.UPPERSEC) {
          return {
            action: "continue",
            targetYear: normalizedTargetYear,
            targetQualificationYear: null,
            requiresWeightingConfirmation: false,
            label: "wird fortgeführt"
          };
        }
        const context = course.upperSecContext;
        if (!context || !context.courseType || !context.qualificationYear) {
          return {
            action: "review",
            targetYear: normalizedTargetYear,
            targetQualificationYear: null,
            requiresWeightingConfirmation: false,
            label: "Kontext prüfen"
          };
        }
        if (context.qualificationYear === QUALIFICATION_YEARS.Q3_Q4) {
          return {
            action: "end",
            targetYear: normalizedTargetYear,
            targetQualificationYear: null,
            requiresWeightingConfirmation: false,
            label: "endet"
          };
        }
        if (context.qualificationYear === QUALIFICATION_YEARS.Q1_Q2) {
          return {
            action: "continue",
            targetYear: normalizedTargetYear,
            targetQualificationYear: QUALIFICATION_YEARS.Q3_Q4,
            requiresWeightingConfirmation: true,
            label: "wird als Q3/Q4 fortgeführt"
          };
        }
        return {
          action: "review",
          targetYear: normalizedTargetYear,
          targetQualificationYear: null,
          requiresWeightingConfirmation: false,
          label: "Kontext prüfen"
        };
      }

      function createSuccessorCourseCandidate(oldCourse, targetYear, successorPlan = null) {
        const plan = successorPlan || planCourseSuccessor(oldCourse, targetYear);
        if (plan.targetYear !== Number(targetYear)) throw new Error("Der Nachfolgeplan passt nicht zum Zieljahr.");
        if (!oldCourse || plan.action !== "continue") return null;
        const successorContext = oldCourse.schemaMode === SCHEMA_MODES.UPPERSEC
          ? {
              courseType: oldCourse.upperSecContext.courseType,
              qualificationYear: plan.targetQualificationYear,
              weightingDeviationReason: null
            }
          : null;
        const successor = createCourse({
          name: oldCourse.name,
          subject: oldCourse.subject,
          classLabel: oldCourse.classLabel,
          schemaMode: oldCourse.schemaMode,
          weightTemplateId: oldCourse.schemaMode === SCHEMA_MODES.UPPERSEC
            ? (typeof plan.targetWeightTemplateId === "string" ? plan.targetWeightTemplateId : null)
            : oldCourse.weightTemplateId,
          includePrevTermGrades: oldCourse.includePrevTermGrades,
          termCutoffs: oldCourse.termCutoffs ? JSON.parse(JSON.stringify(oldCourse.termCutoffs)) : null,
          showAttendance: oldCourse.showAttendance,
          schoolYearStartYear: plan.targetYear,
          carriedForwardFromCourseId: oldCourse.id,
          importKey: null,
          upperSecContext: successorContext
        });
        successor.enrollments = (oldCourse.enrollments || []).map(enrollment => createEnrollment({
          studentId: enrollment.studentId,
          subgroup: enrollment.subgroup || null,
          homeClassAtEnrollment: enrollment.homeClassAtEnrollment || null,
          writtenExamSubjectQ4: false
        }));
        return successor;
      }

      function normalizeArchiveRetentionUntil(value) {
        const text = String(value || "").trim();
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
          ? text
          : null;
      }

      function normalizeArchiveNote(value) {
        const text = String(value || "").trim();
        return text ? text.slice(0, 1000) : null;
      }

      function normalizeArchiveHistory(value, fallbackSchemaMode = null) {
        if (!Array.isArray(value)) return [];
        return value.filter(function (entry) {
          return entry && typeof entry === 'object' && !Array.isArray(entry) &&
            typeof entry.archivedAt === 'string' && entry.archivedAt &&
            entry.snapshot && typeof entry.snapshot === 'object' && !Array.isArray(entry.snapshot);
        }).map(function (entry) {
          return {
            archivedAt: entry.archivedAt,
            schemaMode: Object.values(SCHEMA_MODES).includes(entry.schemaMode)
              ? entry.schemaMode
              : (Object.values(SCHEMA_MODES).includes(entry.snapshot.schemaMode)
                  ? entry.snapshot.schemaMode
                  : (Object.values(SCHEMA_MODES).includes(fallbackSchemaMode) ? fallbackSchemaMode : null)),
            archiveReason: entry.archiveReason || null,
            archiveRetentionUntil: normalizeArchiveRetentionUntil(entry.archiveRetentionUntil),
            archiveNote: normalizeArchiveNote(entry.archiveNote),
            snapshot: JSON.parse(JSON.stringify(entry.snapshot))
          };
        });
      }

      function archiveCourse(state, courseId, reason = "manual", metadata = {}) {
        const course = findCourseById(state, courseId);
        if (!course || course.archivedAt) return false;
        if (!course.schoolYearStartYear) {
          const level = course.schemaMode === SCHEMA_MODES.UPPERSEC ? 'seckII' : 'seckI';
          const inferredYear = Number(state.settings?.halfYearSettings?.[level]?.schoolYearStartYear);
          course.schoolYearStartYear = Number.isInteger(inferredYear) ? inferredYear : null;
        }
        course.archiveSnapshot = createArchiveSnapshot(state, course);
        course.archivedAt = new Date().toISOString();
        course.archiveReason = reason || "manual";
        course.archiveRetentionUntil = normalizeArchiveRetentionUntil(metadata && metadata.archiveRetentionUntil);
        course.archiveNote = normalizeArchiveNote(metadata && metadata.archiveNote);
        return true;
      }

      function restoreCourse(state, courseId) {
        const course = findCourseById(state, courseId);
        if (!course || !course.archivedAt) return false;
        course.archiveHistory = normalizeArchiveHistory(course.archiveHistory, course.schemaMode);
        course.archiveHistory.push({
          archivedAt: course.archivedAt,
          schemaMode: course.schemaMode,
          archiveReason: course.archiveReason || null,
          archiveRetentionUntil: normalizeArchiveRetentionUntil(course.archiveRetentionUntil),
          archiveNote: normalizeArchiveNote(course.archiveNote),
          snapshot: JSON.parse(JSON.stringify(course.archiveSnapshot))
        });
        course.archivedAt = null;
        course.archiveReason = null;
        course.archiveRetentionUntil = null;
        course.archiveNote = null;
        course.archiveSnapshot = null;
        return true;
      }

      function addStudentToState(state, student) {
        state.students.push(student);
      }

      function addCourseToState(state, course) {
        state.courses.push(course);
      }

      function addAssessmentToState(state, assessment) {
        state.assessments.push(assessment);
      }

      function removeCourseFromState(state, courseId) {
        if (!courseId) return;
        // Kurs entfernen
        state.courses = state.courses.filter(c => c.id !== courseId);
        // Alle zugehörigen Leistungen entfernen
        state.assessments = state.assessments.filter(a => a.courseId !== courseId);
      }

      function removeStudentFromState(state, studentId) {
        if (!studentId) return;
        if (studentHasArchivedCourseReference(state, studentId)) return false;
        // Schüler aus globaler Liste entfernen
        state.students = state.students.filter(s => s.id !== studentId);

        // Schüler aus allen Kursen ausbuchen
        for (const c of state.courses) {
          if (Array.isArray(c.enrollments)) {
            c.enrollments = c.enrollments.filter(e => e.studentId !== studentId);
          }
          if (Array.isArray(c.termResults)) {
            c.termResults = c.termResults.filter(result => result.studentId !== studentId);
          }
        }

        // Schüler aus allen Leistungs-Einträgen entfernen
        for (const asm of state.assessments) {
          if (asm.scores && Object.prototype.hasOwnProperty.call(asm.scores, studentId)) {
            delete asm.scores[studentId];
          }
        }
        return true;
      }


      function isRecord(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
      }

      function ensureStateShape(raw) {
        // 1. Grundcheck: Ist das überhaupt ein Objekt?
        if (!isRecord(raw)) {
          return createEmptyState();
        }

        // 2. Sammlungen und Einstellungen einzeln normalisieren, damit ein
        //    beschädigter Teil keine weiterhin gültigen Daten verwirft.
        raw.students = Array.isArray(raw.students) ? raw.students.filter(isRecord) : [];
        raw.courses = Array.isArray(raw.courses) ? raw.courses.filter(isRecord) : [];
        raw.assessments = Array.isArray(raw.assessments) ? raw.assessments.filter(isRecord) : [];
        raw.settings = isRecord(raw.settings) ? raw.settings : createDefaultSettings();
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
                id: DomainModel.generateId("stu"),
                lastName: "",
                firstName: "",
                birthDate: null,
                homeClass: ""
              };
            }

            stu.id = stu.id || DomainModel.generateId("stu");
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
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1; // 1-12

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
            // term-Feld: falls fehlend, zuerst schuljahrbewusst aus dem Datum ableiten.
            if (asm.term === undefined || asm.term === null) {
              const date = asm.date ? new Date(asm.date) : null;
              const course = courseById.get(asm.courseId) || null;
              const courseSettings = course
                ? GradingLogic.getSettingsForCourse(course, raw)
                : raw.settings;
              asm.term = date && !isNaN(date.getTime())
                ? GradingLogic.resolveAssessmentTermFromDateValue(date, course, courseSettings)
                : null;
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

          const now = new Date();
          const fallbackTermByCourse = new Map();
          function getFallbackTermForCourse(course) {
            const cacheKey = course && course.id ? course.id : '__unknown_course__';
            if (!fallbackTermByCourse.has(cacheKey)) {
              const settings = course
                ? GradingLogic.getSettingsForCourse(course, raw)
                : raw.settings;
              fallbackTermByCourse.set(
                cacheKey,
                GradingLogic.resolveAssessmentTermFromDateValue(now, course, settings)
              );
            }
            return fallbackTermByCourse.get(cacheKey);
          }

          for (const asm of raw.assessments) {
            if (asm && (asm.term === null || asm.term === undefined)) {
              const courseTerm = courseTermMap.get(asm.courseId);
              const course = courseById.get(asm.courseId) || null;
              asm.term = courseTerm || getFallbackTermForCourse(course);
            }
          }
        }

        // 6b. Kurse: includePrevTermGrades booleanisieren und enrollments sicherstellen
        if (Array.isArray(raw.courses)) {
          raw.courses = raw.courses.map(function (c) {
            if (!c || typeof c !== 'object') return c;
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


      return {
        SCHEMA_MODES,
        UPPERSEC_COURSE_TYPES,
        QUALIFICATION_YEARS,
        SCORE_STATUS,
        STANDARD_GRADE_LABELS,
        RECOMMENDED_WEIGHT_TEMPLATE_IDS,
        generateId,

        createEmptyState,
        createDefaultGradeMapping,
        createStudent,
        createEnrollment,
        createCourse,
        createCategory,
        getDefaultSubcategoryWeight,
        createWeightTemplate,
        createScoreEntry,
        createAssessment,

        findStudentById,
        findCourseById,
        findAssessmentById,
        getTermResult,
        setTermResult,
        listAssessmentsForCourse,
        listEnrollmentsForCourse,
        findEnrollment,

        enrollStudentInCourse,
        setWrittenExamSubjectQ4,
        resolveQualificationPhase,
        listActiveCourses,
        listArchivedCourses,
        studentHasArchivedCourseReference,
        listReferencedStudentIdsForCourse,
        listStudentReportCourses,
        resolveUpperSecWrittenCategoryId,
        createArchiveSnapshot,
        normalizeArchiveRetentionUntil,
        normalizeArchiveNote,
        normalizeUpperSecContext,
        planCourseSuccessor,
        createSuccessorCourseCandidate,
        archiveCourse,
        restoreCourse,
        addStudentToState,
        addCourseToState,
        addAssessmentToState,
        removeStudentFromState,
        removeCourseFromState,

        ensureStateShape
      };
    })();
