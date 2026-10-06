    const GradingLogic = (function () {

      const UPPERSEC_POINTS_TO_GRADE = Object.freeze({
        15: "1+", 14: "1", 13: "1-",
        12: "2+", 11: "2", 10: "2-",
        9: "3+", 8: "3", 7: "3-",
        6: "4+", 5: "4", 4: "4-",
        3: "5+", 2: "5", 1: "5-", 0: "6"
      });

      // Parsen einer Notenbezeichnung. Zulässig sind ausschließlich ein exakter
      // Mapping-Schlüssel oder ein exaktes Standardlabel; Teilstrings und freie
      // Dezimalnoten sind keine gültigen Eingaben.
      function parseGradeLabel(label, mapping) {
        if (label === null || label === undefined) return null;
        const trimmed = String(label).trim();
        if (!trimmed) return null;

        // Diese Labels gehören ausdrücklich nicht zur sechsstufigen Standardskala.
        if (trimmed === "6+" || trimmed === "6-") return null;

        if (mapping && Object.prototype.hasOwnProperty.call(mapping, trimmed)) {
          const value = mapping[trimmed];
          return typeof value === "number" && Number.isFinite(value) && value >= 0
            ? value
            : null;
        }

        if (!DomainModel.STANDARD_GRADE_LABELS.includes(trimmed)) return null;
        const standardMapping = DomainModel.createDefaultGradeMapping();
        return standardMapping[trimmed];
      }

      // Validiert einen Wert aus der Grade-Mapping-Einstellungsmaske ohne die
      // großzügigen Teilstring- und Leerwert-Konvertierungen von parseFloat/Number.
      function parseGradeMappingInput(rawValue) {
        const value = parseDecimalInput(rawValue);
        return value !== null && value >= 0 ? value : null;
      }

      // Parsen von Oberstufen-Punkten (0–15). Nur ganze Zahlen sind erlaubt.
      // Liefert eine ganze Zahl oder `null`, wenn der Wert ungültig ist.
      function parseUpperSecPoints(label) {
        if (label === null || label === undefined) return null;
        const trimmed = String(label).trim();
        if (!trimmed) return null;

        // Nur Ziffern (ganze Zahlen) akzeptieren
        if (!/^\d+$/.test(trimmed)) return null;
        const val = parseInt(trimmed, 10);
        if (!Number.isFinite(val)) return null;
        if (val < 0 || val > 15) return null;
        return val;
      }

      // Prüft, ob ein roher Eingabewert für ein gegebenes Kurs-Schema gültig ist.
      // - Für GRADES: gilt, wenn parseGradeLabel einen numerischen Wert zurückgibt.
      // - Für UPPERSEC: nur ganze Zahlen 0–15 sind erlaubt (keine Dezimalstellen).
      function isValidRawForCourse(raw, course, settings) {
        if (raw === null || raw === undefined) return false;
        const s = String(raw).trim();
        if (!s) return false;

        // GRADES: akzeptiere entweder genau einen Eintrag aus dem Grade-Mapping
        // (wenn vorhanden) oder eines der Standard-Labels 1+,1,1-,...5-,6
        if (!course || course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
          const mapping = settings && settings.gradeMapping;
          return parseGradeLabel(s, mapping) !== null;
        }

        if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
          // Nur ganze Zahlen 0..15 zulassen (keine Dezimaltrennzeichen)
          if (!/^\d+$/.test(s)) return false;
          const n = Number(s);
          if (!Number.isFinite(n)) return false;
          return n >= 0 && n <= 15;
        }

        return false;
      }

      // Liefert den numerischen Wert eines Score-Eintrags abhängig vom Kurs-Schema:
      // - Bei `GRADES` wird `valueRaw` über `parseGradeLabel` bzw. das Mapping ausgewertet.
      // - Bei `UPPERSEC` wird `valueNumeric` bevorzugt, sonst `valueRaw` über `parseUpperSecPoints`.
      // Gibt `null` zurück, wenn kein gültiger numerischer Wert vorliegt oder der Eintrag excused/missing ist.
      function getNumericScoreForEntry(scoreEntry, course, settings) {
        if (!scoreEntry) return null;
        if (scoreEntry.status !== DomainModel.SCORE_STATUS.VALID) {
          return null;
        }

        if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
          const mapping = settings.gradeMapping || {};
          return parseGradeLabel(scoreEntry.valueRaw, mapping);
        }

        if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
          if (typeof scoreEntry.valueNumeric === "number") {
            if (Number.isInteger(scoreEntry.valueNumeric) && scoreEntry.valueNumeric >= 0 && scoreEntry.valueNumeric <= 15) {
              return scoreEntry.valueNumeric;
            }
          }
          return parseUpperSecPoints(scoreEntry.valueRaw);
        }

        return null;
      }

      function getUpperSecGradeLabel(points) {
        return Number.isInteger(points) && Object.prototype.hasOwnProperty.call(UPPERSEC_POINTS_TO_GRADE, points)
          ? UPPERSEC_POINTS_TO_GRADE[points]
          : null;
      }

      // Erwartet die Skala in pädagogischer Reihenfolge (beste bis schwächste
      // Stufe). Grenzen müssen im Bereich 0..100 liegen und streng abnehmen.
      function validatePercentageThresholds(scale, thresholds, fallbackLabel) {
        let previous = null;
        let previousLabel = null;
        for (const item of scale || []) {
          if (!item || item.label === fallbackLabel) continue;
          const rawValue = thresholds && thresholds[item.label];
          const value = Number(rawValue);
          if (rawValue === null || rawValue === undefined || rawValue === "" || !Number.isFinite(value) || value < 0 || value > 100) {
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
          if (fallbackRaw === null || fallbackRaw === undefined || fallbackRaw === "" || !Number.isFinite(fallbackValue) || fallbackValue < 0 || fallbackValue > 100) {
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
        return { ok: true, message: "" };
      }

      function computeCategoryAverage(assessments, course, studentId, categoryId, settings) {
        const category = (settings.categories || []).find(c => c.id === categoryId);
        const categoryAssessments = assessments.filter(a => a.categoryId === categoryId);

        function computeFlatAverage() {
          let sum = 0;
          let weightSum = 0;

          for (const asm of categoryAssessments) {
            const scoreEntry = asm.scores ? asm.scores[studentId] : undefined;
            const numeric = getNumericScoreForEntry(scoreEntry, course, settings);
            if (numeric === null) continue;

            const weight = Number(asm.weight);
            if (!Number.isFinite(weight) || weight <= 0) continue;
            sum += numeric * weight;
            weightSum += weight;
          }

          if (weightSum === 0) return null;
          return sum / weightSum;
        }

        // Prüfe ob diese Kategorie Unterkategorien hat
        const hasSubcategories = category && Array.isArray(category.subcategories) && category.subcategories.length > 0;

        if (hasSubcategories) {
          const subcategoryById = new Map(category.subcategories.map(subcat => [subcat.id, subcat]));
          const allAssessmentsAssigned = categoryAssessments.every(asm => subcategoryById.has(asm.subcategoryId));
          const usedSubcategoryIds = new Set(categoryAssessments.map(asm => asm.subcategoryId));
          const allUsedWeightsValid = Array.from(usedSubcategoryIds).every(subcategoryId => {
            const subcategory = subcategoryById.get(subcategoryId);
            const weight = Number(subcategory && subcategory.weightPercent);
            return Number.isFinite(weight) && weight > 0;
          });

          // Während eine Unterkategorie-Konfiguration noch unvollständig ist,
          // bleibt die bisherige flache Berechnung aktiv. So ändern neue oder
          // gelöschte Zuordnungen bestehende Zeugniswerte nicht unbemerkt.
          if (!allAssessmentsAssigned || !allUsedWeightsValid) {
            return computeFlatAverage();
          }

          // Hierarchische Gewichtung: erst Unterkategorien, dann deren Mittelwerte mit Gewichtung kombinieren
          let weightedSum = 0;
          let totalWeight = 0;

          for (const subcat of category.subcategories) {
            // Sammle alle Leistungen dieser Unterkategorie
            const subcatAssessments = assessments.filter(a =>
              a.categoryId === categoryId && a.subcategoryId === subcat.id
            );

            if (subcatAssessments.length === 0) continue;

            // Berechne Durchschnitt der Unterkategorie (ohne Gewichtung auf dieser Ebene)
            let subcatSum = 0;
            let subcatWeightSum = 0;

            for (const asm of subcatAssessments) {
              const scoreEntry = asm.scores ? asm.scores[studentId] : undefined;
              const numeric = getNumericScoreForEntry(scoreEntry, course, settings);
              if (numeric === null) continue;

              const weight = Number(asm.weight);
              if (!Number.isFinite(weight) || weight <= 0) continue;
              subcatSum += numeric * weight;
              subcatWeightSum += weight;
            }

            if (subcatWeightSum === 0) continue;

            const subcatAvg = subcatSum / subcatWeightSum;
            const subcatWeight = Number(subcat.weightPercent);

            weightedSum += subcatAvg * subcatWeight;
            totalWeight += subcatWeight;
          }

          if (totalWeight === 0) return null;
          return weightedSum / totalWeight;
        }

        // Keine Unterkategorien: normale Berechnung. Eine vorhandene
        // subcategoryId wird dabei wie bisher ignoriert.
        return computeFlatAverage();
      }

      // Archivierte Kurse werden ausschließlich mit den beim Archivieren
      // festgehaltenen Bewertungsgrundlagen ausgewertet. Aktive Kurse verwenden
      // weiterhin unverändert die aktuellen globalen Einstellungen.
      function getSettingsForCourse(course, state) {
        const globalSettings = (state && state.settings) || {};
        const snapshot = course && course.archivedAt && course.archiveSnapshot && typeof course.archiveSnapshot === "object"
          ? course.archiveSnapshot
          : null;
        if (!snapshot) return globalSettings;
        return {
          ...globalSettings,
          gradeMapping: snapshot.gradeMapping || {},
          categories: Array.isArray(snapshot.categories) ? snapshot.categories : [],
          weightTemplates: snapshot.weightTemplate ? [snapshot.weightTemplate] : [],
          categoryRoles: snapshot.categoryRoles || {},
          halfYearNames: snapshot.halfYearNames || {},
          halfYearSettings: snapshot.halfYearSettings || {},
          termCutoffs: snapshot.termCutoffs || null
        };
      }

      function resolveAssessmentTermFromDateValue(date, course, settings) {
        if (!date || typeof date.getTime !== "function" || isNaN(date.getTime())) return null;
        const schemaMode = (course && course.schemaMode) || DomainModel.SCHEMA_MODES.GRADES;
        const level = schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC ? "seckII" : "seckI";
        const defaults = {
          schoolYearStartMonth: 9, schoolYearStartDay: 8,
          h1EndMonth: 1, h1EndDay: 30, h2StartMonth: 2, h2StartDay: 9
        };
        const globalHalfYearSettings = settings && settings.halfYearSettings
          ? (settings.halfYearSettings[level] || settings.halfYearSettings.seckI)
          : null;
        const snapshotTermCutoffSource = course && course.archivedAt && course.archiveSnapshot &&
          typeof course.archiveSnapshot === "object"
          ? course.archiveSnapshot.termCutoffSource
          : null;
        const snapshotTermCutoffs = course && course.archivedAt && course.archiveSnapshot &&
          typeof course.archiveSnapshot === "object" && course.archiveSnapshot.termCutoffs &&
          typeof course.archiveSnapshot.termCutoffs === "object" &&
          (snapshotTermCutoffSource === "course" ||
            (snapshotTermCutoffSource == null && course && course.termCutoffs && typeof course.termCutoffs === "object"))
          ? course.archiveSnapshot.termCutoffs
          : null;
        const courseTermCutoffs = course && course.termCutoffs && typeof course.termCutoffs === "object"
          ? course.termCutoffs
          : null;
        const specificTermCutoffs = snapshotTermCutoffs || courseTermCutoffs;
        const halfYearSettings = {
          ...defaults,
          ...(globalHalfYearSettings || (settings && settings.termCutoffs) || {})
        };
        if (specificTermCutoffs) {
          ["h1EndMonth", "h1EndDay", "h2StartMonth", "h2StartDay"].forEach(function (key) {
            const value = Number(specificTermCutoffs[key]);
            if (Number.isFinite(value) && value > 0) halfYearSettings[key] = value;
          });
        }
        const schoolYearStartMonth = halfYearSettings.schoolYearStartMonth || 9;
        const schoolYearStartDay = halfYearSettings.schoolYearStartDay || 8;
        let schoolYear = date.getFullYear();
        if (date.getMonth() + 1 < schoolYearStartMonth ||
            (date.getMonth() + 1 === schoolYearStartMonth && date.getDate() < schoolYearStartDay)) {
          schoolYear--;
        }
        const h2Start = new Date(
          schoolYear + 1,
          (halfYearSettings.h2StartMonth || 2) - 1,
          halfYearSettings.h2StartDay || 9
        );
        const h1End = new Date(
          schoolYear + 1,
          (halfYearSettings.h1EndMonth || 1) - 1,
          halfYearSettings.h1EndDay || 30,
          23, 59, 59
        );
        if (date >= h2Start) return `${schoolYear}-H2`;
        if (date <= h1End) return `${schoolYear}-H1`;
        return `${schoolYear}-H1`;
      }

      function resolveUpperSecWrittenCategoryId(settings) {
        return DomainModel.resolveUpperSecWrittenCategoryId(settings);
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
              !activeCategoryIds.has(categoryId) || !Number.isFinite(percent) || percent < 0) {
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
            if (!categoryId || !Number.isFinite(weight) || weight < 0 || weights.has(categoryId)) return null;
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

      function resolveUpperSecGradingContext(course, studentId, term, settings) {
        const qualificationPhase = DomainModel.resolveQualificationPhase(course, term);
        const context = course && course.upperSecContext;
        if (!course || course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC ||
          !context || !qualificationPhase || !context.courseType) {
          return {
            qualificationPhase: qualificationPhase,
            expectedExamCount: null,
            recommendedWrittenPercent: null,
            recommendedWeightTemplateId: null,
            status: "needs-review",
            message: "Sek-II-Kursart und Qualifikationsabschnitt muessen geprueft werden.",
            isWeightingDeviation: false
          };
        }

        if (context.courseType === DomainModel.UPPERSEC_COURSE_TYPES.OTHER) {
          return {
            qualificationPhase,
            expectedExamCount: null,
            recommendedWrittenPercent: null,
            recommendedWeightTemplateId: null,
            status: "no-recommendation",
            message: "Fuer diesen individuellen Kurs wird keine automatische Gewichtung empfohlen.",
            isWeightingDeviation: false
          };
        }

        let expectedExamCount = null;
        if (qualificationPhase === "Q4") {
          if (context.courseType === DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED) {
            expectedExamCount = 1;
          } else {
            if (!studentId) {
              return {
                qualificationPhase,
                expectedExamCount: null,
                recommendedWrittenPercent: null,
                recommendedWeightTemplateId: null,
                status: "person-specific",
                message: "Q4-Grundkurs: Die Klausurentscheidung ist personenspezifisch und wird in der Personenliste gepflegt.",
                isWeightingDeviation: false
              };
            }
            const enrollment = DomainModel.findEnrollment(course, studentId);
            expectedExamCount = enrollment && enrollment.writtenExamSubjectQ4 === true ? 1 : 0;
          }
        } else if (context.courseType === DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED) {
          expectedExamCount = 2;
        } else if (context.courseType === DomainModel.UPPERSEC_COURSE_TYPES.BASIC) {
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
              status: "not-applicable",
              message: "Die Klausurkategorie kann nicht sicher erkannt werden; die bestehende Gewichtung bleibt unveraendert.",
              isWeightingDeviation: false
            };
          }
          return {
            qualificationPhase,
            expectedExamCount: 0,
            recommendedWrittenPercent: 0,
            recommendedWeightTemplateId: null,
            status: "general-only",
            message: "Q4: keine Klausur vorgesehen; bewertet wird nur der allgemeine Teil.",
            isWeightingDeviation: false
          };
        }

        const recommendedWrittenPercent = expectedExamCount === 2 ? 50 : 33.33;
        const candidateTemplateId = expectedExamCount === 2
          ? DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS
          : DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM;
        const recommendedTemplate = resolveSafeUpperSecTemplate(
          settings,
          candidateTemplateId,
          recommendedWrittenPercent
        );
        const recommendedWeightTemplateId = recommendedTemplate ? candidateTemplateId : null;
        const status = recommendedTemplate ? "recommendation" : "not-applicable";
        return {
          qualificationPhase,
          expectedExamCount,
          recommendedWrittenPercent,
          recommendedWeightTemplateId,
          status,
          message: recommendedTemplate
            ? `Empfehlung: Klausurteil ${expectedExamCount === 2 ? "1/2" : "1/3"}.`
            : "Empfehlung nicht automatisch anwendbar: Kategorienrollen und Vorlagengewichte entsprechen keinem sicheren Berliner Profil.",
          isWeightingDeviation: !!(
            recommendedTemplate && !categoryWeightProfilesMatch(
              resolveActiveCategoryWeights(course, settings),
              recommendedTemplate.items
            )
          )
        };
      }

      function resolveUpperSecAssessmentWarning(assessments, course, studentId, term, settings) {
        const gradingContext = resolveUpperSecGradingContext(course, studentId, term, settings);
        const context = course && course.upperSecContext;
        if (!context || context.courseType !== DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED ||
            !["Q1", "Q2", "Q3"].includes(gradingContext.qualificationPhase)) {
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
          entry.status === DomainModel.SCORE_STATUS.MISSING ||
          (entry.status === DomainModel.SCORE_STATUS.VALID &&
            typeof entry.valueNumeric === "number" && entry.valueNumeric === 0)
        ));
        if (!allMissedOrValidZero) return null;
        return {
          code: "lk-written-manual-decision",
          requiresManualDecision: true,
          message: "Alle Klausuren wurden versäumt oder mit 0 Punkten bewertet. Eine manuelle fachliche Entscheidung ist erforderlich; Rechenwert und Festsetzung bleiben unverändert."
        };
      }

      function resolveActiveCategoryWeights(course, settings) {
        const activeCategories = Array.isArray(settings && settings.categories)
          ? settings.categories.filter(category => category.active)
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
              weightPercent: Number(item.weightPercent) || 0
            }));
        }

        if (activeCategories.length === 0) return [];
        const equalWeight = 1 / activeCategories.length;
        return activeCategories.map(category => ({
          categoryId: category.id,
          weightPercent: equalWeight
        }));
      }

      function resolveEffectiveCategoryWeights(course, studentId, term, settings) {
        const activeWeights = resolveActiveCategoryWeights(course, settings);
        if (!course || course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC || !term) {
          return activeWeights;
        }
        const context = resolveUpperSecGradingContext(course, studentId, term, settings);
        if (context.status !== "general-only") return activeWeights;
        const writtenCategoryId = resolveUpperSecWrittenCategoryId(settings);
        if (!writtenCategoryId) return activeWeights;
        return activeWeights.filter(weight => weight.categoryId !== writtenCategoryId);
      }

      function resolveAssessmentTermsForResult(course, selectedTerm) {
        const match = /^(\d{4})-H([12])$/.exec(String(selectedTerm || ""));
        if (!match) return [];
        if (course && course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
          return [selectedTerm];
        }
        if (match[2] === "2") {
          return [selectedTerm, `${match[1]}-H1`];
        }
        return [selectedTerm];
      }

      function isSchoolYearResultTerm(course, selectedTerm) {
        return !!course && course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC &&
          resolveAssessmentTermsForResult(course, selectedTerm).length > 1;
      }

      function formatCourseTermLabel(term, course, settings, options = {}) {
        const match = /^(\d{4})-H([12])$/.exec(String(term || ""));
        if (!match) return term || "";
        const startYear = Number(match[1]);
        const level = course && course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC ? "seckII" : "seckI";
        const snapshot = course && course.archivedAt && course.archiveSnapshot &&
          typeof course.archiveSnapshot === "object" ? course.archiveSnapshot : null;
        const contextCourse = snapshot && snapshot.upperSecContext
          ? { ...course, upperSecContext: snapshot.upperSecContext }
          : course;
        const qualificationPhase = level === "seckII"
          ? DomainModel.resolveQualificationPhase(contextCourse, term)
          : null;
        const halfKey = match[2] === "1" ? "h1" : "h2";
        const configuredNames = settings && settings.halfYearNames && settings.halfYearNames[level];
        const fallback = level === "seckII"
          ? (halfKey === "h1" ? "Q1" : "Q2")
          : (halfKey === "h1" ? "H1" : "H2");
        const termName = qualificationPhase ||
          (configuredNames && configuredNames[halfKey]) || fallback;
        const startLabel = options.fullStartYear ? String(startYear) : String(startYear).slice(-2);
        return startLabel + "/" + String(startYear + 1).slice(-2) + " " + termName;
      }

      function computeWeightedOverallForAssessments(assessments, course, studentId, settings, term = null) {
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
          const weightFactor = Number(weight.weightPercent) || 0;
          weightedSum += categoryAverage * weightFactor;
          totalWeight += weightFactor;
        }

        return totalWeight === 0 ? null : weightedSum / totalWeight;
      }

      function resolveGradingResultScope(course, state, selectedTerm = null) {
        const allAssessments = DomainModel.listAssessmentsForCourse(state, course.id) || [];
        const settings = getSettingsForCourse(course, state);

        function inferTerm(a) {
          if (!a) return null;
          if (a.term) return a.term;
          if (a.date) {
            const d = new Date(a.date);
            if (!isNaN(d)) return resolveAssessmentTermFromDateValue(d, course, settings);
          }
          return null;
        }

        function parseTermNum(t) {
          if (!t) return null;
          const m = /^(\d{4})-H([12])$/.exec(t);
          if (!m) return null;
          return parseInt(m[1],10)*10 + parseInt(m[2],10);
        }

        // Archivierte Kurse werden relativ zu ihrem letzten gespeicherten
        // Halbjahr ausgewertet. Das heutige Datum darf historische Leistungen
        // nicht aus der Gesamtnote herausfiltern.
        let currentTerm = /^\d{4}-H[12]$/.test(String(selectedTerm || "")) ? selectedTerm : null;
        if (!currentTerm && course && course.archivedAt) {
          const found = allAssessments.map(a => inferTerm(a)).filter(Boolean);
          let bestNum = -Infinity;
          for (const term of found) {
            const termNum = parseTermNum(term);
            if (termNum !== null && termNum > bestNum) {
              bestNum = termNum;
              currentTerm = term;
            }
          }
        }

        // Aktive Kurse verwenden weiterhin das heutige schuljahrbewusste
        // Halbjahr. Für unvollständige Altarchive bleibt dies der Fallback.
        if (!currentTerm) {
          const now = new Date();
          // Nutze halfYearSettings des Kurses für korrekte Schuljahr-Berechnung
          const schemaMode = (course && course.schemaMode) || 'grades';
          let hys = null;
          if (settings.halfYearSettings) {
            if (schemaMode === 'uppersec' || schemaMode === 'UPPERSEC') {
              hys = settings.halfYearSettings.seckII || settings.halfYearSettings.seckI;
            } else {
              hys = settings.halfYearSettings.seckI;
            }
          }
          if (!hys) hys = settings.termCutoffs || {};
          const syMonth = hys.schoolYearStartMonth || 9;
          const syDay = hys.schoolYearStartDay || 8;
          let schoolYear = now.getFullYear();
          if (now.getMonth() + 1 < syMonth || (now.getMonth() + 1 === syMonth && now.getDate() < syDay)) {
            schoolYear--;
          }
          const h2StartYear = schoolYear + 1;
          const h2StartForYear = new Date(h2StartYear, (hys.h2StartMonth || 2) - 1, hys.h2StartDay || 9);
          const h1EndForYear = new Date(schoolYear + 1, (hys.h1EndMonth || 1) - 1, hys.h1EndDay || 30, 23, 59, 59);
          if (now >= h2StartForYear) {
            currentTerm = `${schoolYear}-H2`;
          } else if (now <= h1EndForYear) {
            currentTerm = `${schoolYear}-H1`;
          } else {
            currentTerm = `${schoolYear}-H1`;
          }
        }
        // Fallback: falls keine Einstellungen → aus vorhandenen Leistungen ableiten
        if (!currentTerm) {
          const found = allAssessments.map(a => inferTerm(a)).filter(Boolean);
          if (found.length > 0) {
            let best = null; let bestNum = -Infinity;
            for (const t of found) { const n = parseTermNum(t); if (n !== null && n > bestNum) { bestNum = n; best = t; } }
            currentTerm = best;
          }
        }
        const includedTerms = new Set(resolveAssessmentTermsForResult(course, currentTerm));
        const previousTerm = Array.from(includedTerms).find(term => term !== currentTerm) || null;

        // Sek II wird je Kurshalbjahr getrennt berechnet. Sek I verwendet in
        // H2 alle Einzelbewertungen des laufenden Schuljahres (H1 und H2).
        const assessmentTerms = new Map();
        const assessments = allAssessments.filter(a => {
          const at = inferTerm(a) || currentTerm;
          assessmentTerms.set(a, at);
          return includedTerms.has(at);
        });

        return {
          allAssessments,
          assessments,
          assessmentTerms,
          currentTerm,
          includedTerms,
          previousTerm,
          settings
        };
      }

      function computeOverallGrade(course, studentId, state, selectedTerm = null) {
        const scope = resolveGradingResultScope(course, state, selectedTerm);
        const { allAssessments, assessments, assessmentTerms, currentTerm, includedTerms, previousTerm, settings } = scope;

        // Optionales Debug-Logging, welche Leistungen einbezogen werden
        for (const a of allAssessments) {
          try {
            if (window.DEBUG_PREVTERM) {
              const at = assessmentTerms.get(a) || currentTerm;
              console.debug('[DEBUG computeOverallGrade]', {
                courseId: course && course.id,
                courseName: course && course.name,
                includedTerms: Array.from(includedTerms),
                assessmentId: a && a.id,
                inferredTerm: at,
                currentTerm,
                previousTerm,
                included: includedTerms.has(at)
              });
            }
          } catch (e) {
            // ignore logging errors
          }
        }

        const result = computeWeightedOverallForAssessments(assessments, course, studentId, settings, currentTerm);

        // Debug: Ausgabe der Zwischenergebnisse
        try {
          if (window.DEBUG_PREVTERM) {
            console.debug('[DEBUG computeOverallGrade result]', {
              courseId: course && course.id,
              courseName: course && course.name,
              result
            });
          }
        } catch (e) {}

        return result;
      }

      function computeMedian(valuesSortedAsc) {
        const n = valuesSortedAsc.length;
        if (n === 0) return null;
        if (n % 2 === 1) {
          return valuesSortedAsc[(n - 1) / 2];
        } else {
          const a = valuesSortedAsc[n / 2 - 1];
          const b = valuesSortedAsc[n / 2];
          return (a + b) / 2;
        }
      }

      function buildDistribution(values, course) {
        let buckets;

        if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
          buckets = [
            { label: "bis 1,9", min: -Infinity, max: 1.95 },
            { label: "2,0–2,9", min: 1.95, max: 2.95 },
            { label: "3,0–3,9", min: 2.95, max: 3.95 },
            { label: "4,0–4,9", min: 3.95, max: 4.95 },
            { label: "5,0–5,9", min: 4.95, max: 5.95 },
            { label: "ab 6,0",  min: 5.95, max: Infinity }
          ];
        } else {
          buckets = [
            { label: "0–4",   min: 0.0,  max: 4.5 },
            { label: "5–9",   min: 4.5,  max: 9.5 },
            { label: "10–12", min: 9.5,  max: 12.5 },
            { label: "13–15", min: 12.5, max: Infinity }
          ];
        }

        buckets.forEach(b => b.count = 0);

        for (const v of values) {
          for (const b of buckets) {
            if (v >= b.min && v < b.max) {
              b.count++;
              break;
            }
          }
        }

        return buckets.map(b => ({ label: b.label, count: b.count }));
      }

      function computeCourseStatistics(course, state) {
        const enrollments = DomainModel.listEnrollmentsForCourse(state, course.id) || [];
        const values = [];

        for (const enr of enrollments) {
          const overall = computeOverallGrade(course, enr.studentId, state);
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
        const sum = values.reduce((acc, v) => acc + v, 0);
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

      return {
        parseGradeLabel,
        parseGradeMappingInput,
        parseUpperSecPoints,
        isValidRawForCourse,
        getNumericScoreForEntry,
        getUpperSecGradeLabel,
        validatePercentageThresholds,
        getSettingsForCourse,
        resolveAssessmentTermFromDateValue,
        resolveUpperSecGradingContext,
        resolveUpperSecAssessmentWarning,
        resolveEffectiveCategoryWeights,
        resolveAssessmentTermsForResult,
        isSchoolYearResultTerm,
        formatCourseTermLabel,
        resolveGradingResultScope,
        computeCategoryAverage,
        computeWeightedOverallForAssessments,
        computeOverallGrade,
        computeCourseStatistics
      };
    })();
