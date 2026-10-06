import { createDomainModel } from '../domain/domain-model.js';
import { createGradingLogic } from '../domain/grading-logic.js';
import { createInitialState } from '../domain/initial-state.js';
import { createInitialAssessmentsForCourse } from '../domain/initial-assessments.js';
import { getSettingsForCourse } from '../domain/course-settings.js';
import { parseAssessmentDateValue, resolveAssessmentTermFromDateValue } from '../domain/terms.js';
import {
  parseCalendarDate,
  calendarDateToLocalDate,
  formatCalendarDate,
  formatInstant,
  formatUtcDateStamp,
  formatUtcFileTimestamp
} from '../formatting/date-time.js';
import {
  formatLegacyFixed,
  formatLegacyPercent,
  formatDecimalComma,
  parseDecimalInput
} from '../formatting/numbers.js';
import { compareText } from '../formatting/text.js';
import { downloadBlobFile } from '../infrastructure/downloads.js';
import { createStorage } from '../infrastructure/storage.js';
import { createSessionCoordinator } from '../infrastructure/session-coordinator.js';
import { csvCell, encodeCsvTransferRow, parseSemicolonCsv, validateCsvTransferHeader, normalizeCsvDate,
  formatCsvImportIssuesText, formatCsvImportIssuesCsv } from '../transfer/csv-format.js';
import { decodeCsvBytes, CsvDecodeError } from '../transfer/csv-decoding.js';
import { parseCsvTransferContextFields, validateCsvCourseContextConsistency,
  csvCourseContextMatches, validateCsvStudentIdentity, findCompatibleCsvStudent
} from '../transfer/csv-import-rules.js';
import { createCsvImportOrchestrator } from '../transfer/csv-import-orchestrator.js';
import {
  EXCEL_XLSX_MIME_TYPE,
  createExcelTextCell,
  createExcelNumberCell,
  createUniqueWorksheetNames,
  createExcelWorkbookBlob
} from '../transfer/excel-export.js';
import { validateImportedState, validateRawTermResults, validateRawUpperSecContexts } from '../transfer/import-validation.js';
import { createImportMerge } from '../transfer/import-merge.js';
import { createDashboardTransition } from '../ui/dashboard-transition.js';
import { createPersistenceBoundary } from '../ui/persistence-boundary.js';
import { buildDashboardCards } from '../ui/dashboard-data.js';
import { mountCourseCards } from '../ui/course-cards.js';
import { createCourseSymbolPicker } from '../ui/course-symbol-picker.js';
import { createStateCommitter } from '../ui/state-commit.js';

const DISPLAY_LOCALE = 'de-DE';
const DISPLAY_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

    /* =========================================================
     *  STRUKTURÜBERSICHT
     *  1) UI-Hilfsdialoge (promptText/Password)
     *  2) DomainModel + Storage + GradingLogic
     *  3) UiShell (Rendering, Navigation, PDF)
     *  4) Tests/Autorun-Hooks
     * =======================================================*/

    // Sichtbare Programmversion. Unabhängig von state.version, das nur das Datenformat bezeichnet.
    const APP_RELEASE = Object.freeze({
      version: "1.6.0",
      dateIso: "2026-10-06",
      dateLabel: "06.10.2026"
    });

    // ------------------------------------------------------
    // Abschnitt: UI-Hilfsdialoge
    // ------------------------------------------------------
    /* Kleine Hilfsfunktion: asynchrones Text-Eingabefenster (Ersatz für window.prompt).
     * Verwendung: const res = await window.promptText({ message: 'Text', default: '...', placeholder: '', confirm: false });
     * Liefert den eingegebenen String oder null, wenn abgebrochen wurde.
     */
    window.promptText = function (opts) {
      opts = opts || {};
      const message = opts.message || '';
      const def = typeof opts.default === 'string' ? opts.default : '';

      return new Promise((resolve) => {
        try {
          const overlay = document.createElement('div');
          overlay.dataset.sessionSensitiveOverlay = 'true';
          overlay.__closeForSessionLock = cleanupCancel;
          overlay.style.position = 'fixed';
          overlay.style.left = '0';
          overlay.style.top = '0';
          overlay.style.right = '0';
          overlay.style.bottom = '0';
          overlay.style.background = 'rgba(0,0,0,0.35)';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          // Z-Index erhöht, damit dieses Prompt immer über anderen Overlays (z.B. Timeout-Blocker) liegt
          overlay.style.zIndex = '100100';

          const dialog = document.createElement('div');
          dialog.style.background = 'var(--bg-card, #fff)';
          dialog.style.padding = '0.9rem';
          dialog.style.borderRadius = '8px';
          dialog.style.minWidth = '300px';
          dialog.style.maxWidth = '90%';
          dialog.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)';

          if (message) {
            const msg = document.createElement('div');
            msg.textContent = message;
            msg.style.marginBottom = '0.5rem';
            dialog.appendChild(msg);
          }

          const input = document.createElement('input');
          input.type = 'text';
          input.style.width = '100%';
          input.style.padding = '0.4rem';
          input.style.boxSizing = 'border-box';
          if (def) input.value = def;
          if (opts.placeholder) input.placeholder = opts.placeholder;
          dialog.appendChild(input);

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '0.5rem';
          row.style.justifyContent = 'flex-end';
          row.style.marginTop = '0.6rem';

          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Abbrechen';
          cancelBtn.type = 'button';
          cancelBtn.addEventListener('click', cleanupCancel);

          const okBtn = document.createElement('button');
          okBtn.textContent = 'OK';
          okBtn.type = 'button';
          okBtn.addEventListener('click', onOk);

          row.appendChild(cancelBtn);
          row.appendChild(okBtn);
          dialog.appendChild(row);

          overlay.appendChild(dialog);
          document.body.appendChild(overlay);

          input.focus();

          function cleanup() {
            try { document.body.removeChild(overlay); } catch (e) {}
            window.removeEventListener('keydown', onKey);
          }

          function cleanupCancel() { cleanup(); resolve(null); }

          function onOk() {
            const v = input.value != null ? String(input.value) : '';
            cleanup();
            resolve(v);
          }

          function onKey(ev) {
            if (ev.key === 'Escape') { cleanupCancel(); }
            if (ev.key === 'Enter') { onOk(); }
          }

          window.addEventListener('keydown', onKey);
        } catch (err) {
          // Fallback auf den nativen `prompt`, falls das modale Fenster nicht erstellt werden kann
          try {
            const res = window.prompt(opts.message || '', def || '');
            resolve(res);
          } catch (e) {
            resolve(null);
          }
        }
      });
    };

    /* Kleine Hilfsfunktion: asynchrones Passwort-Eingabefenster.
     * Verwendung: await window.promptPassword({ message: 'Text', confirm: true });
     * Liefert das eingegebene Passwort als String oder null, wenn abgebrochen wurde.
     */
    window.promptPassword = function (opts) {
      opts = opts || {};
      const message = opts.message || 'Passwort eingeben:';
      const confirm = !!opts.confirm;

      return new Promise((resolve) => {
        try {
          const overlay = document.createElement('div');
          overlay.dataset.sessionSensitiveOverlay = 'true';
          overlay.__closeForSessionLock = cleanupCancel;
          overlay.style.position = 'fixed';
          overlay.style.left = '0';
          overlay.style.top = '0';
          overlay.style.right = '0';
          overlay.style.bottom = '0';
          overlay.style.background = 'rgba(0,0,0,0.4)';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          // Z-Index erhöht, damit dieses Passwort-Prompt immer über anderen Overlays (z.B. Timeout-Blocker) liegt
          overlay.style.zIndex = '100100';

          const dialog = document.createElement('div');
          dialog.style.background = 'var(--bg-card, #fff)';
          dialog.style.padding = '1rem';
          dialog.style.borderRadius = '8px';
          dialog.style.width = 'min(320px, calc(100vw - 2rem))';
          dialog.style.maxWidth = 'calc(100vw - 2rem)';
          dialog.style.boxSizing = 'border-box';
          dialog.style.maxHeight = 'calc(100vh - 2rem)';
          dialog.style.overflowY = 'auto';
          dialog.style.boxShadow = '0 6px 24px rgba(0,0,0,0.25)';

          const msg = document.createElement('div');
          msg.textContent = message;
          msg.style.marginBottom = '0.6rem';
          dialog.appendChild(msg);

          const input = document.createElement('input');
          input.type = 'password';
          input.autocomplete = confirm ? 'new-password' : 'current-password';
          input.style.width = '100%';
          input.style.padding = '0.4rem';
          input.style.boxSizing = 'border-box';
          dialog.appendChild(input);

          let input2 = null;
          if (confirm) {
            input2 = document.createElement('input');
            input2.type = 'password';
            input2.autocomplete = 'new-password';
            input2.placeholder = 'Passwort wiederholen';
            input2.style.width = '100%';
            input2.style.marginTop = '0.4rem';
            input2.style.padding = '0.4rem';
            input2.style.boxSizing = 'border-box';
            dialog.appendChild(input2);
          }

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '0.5rem';
          row.style.justifyContent = 'flex-end';
          row.style.marginTop = '0.6rem';

          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Abbrechen';
          cancelBtn.type = 'button';
          cancelBtn.addEventListener('click', cleanupCancel);

          const okBtn = document.createElement('button');
          okBtn.textContent = 'OK';
          okBtn.type = 'button';
          okBtn.addEventListener('click', onOk);

          row.appendChild(cancelBtn);
          row.appendChild(okBtn);
          dialog.appendChild(row);

          overlay.appendChild(dialog);
          document.body.appendChild(overlay);

          input.focus();

          function cleanup() {
            try { document.body.removeChild(overlay); } catch (e) {}
            window.removeEventListener('keydown', onKey);
          }

          function cleanupCancel() { cleanup(); resolve(null); }

          function onOk() {
            const v = input.value || '';
            if (confirm) {
              const v2 = input2 ? (input2.value || '') : '';
              if (v !== v2) {
                try { window.alert('Passwörter stimmen nicht überein.'); } catch (e) {}
                return;
              }
              if (v.length < 1) {
                try { window.alert('Bitte ein Passwort eingeben.'); } catch (e) {}
                return;
              }
            }
            cleanup();
            resolve(v);
          }

          function onKey(ev) {
            if (ev.key === 'Escape') { cleanupCancel(); }
            if (ev.key === 'Enter') { onOk(); }
          }

          window.addEventListener('keydown', onKey);
        } catch (err) {
          // Fallback: kein nativer Prompt (Passwort wäre im Klartext sichtbar)
          console.error('Passwort-Dialog konnte nicht erstellt werden:', err);
          try { window.alert('Passwort-Eingabe nicht möglich. Bitte Seite neu laden.'); } catch(e) {}
          resolve(null);
        }
      });
    };

    // Debug-Toast-Funktion entfernt (Produktivmodus)
    /* =========================================================
     *  Modul: DomainModel
     * =======================================================*/
    const DomainModel = createDomainModel({
      now: () => new Date(),
      termServices: {
        getSettingsForCourse,
        resolveAssessmentTermFromDateValue
      }
    });
    const { mergeImportedStateIntoCurrent } = createImportMerge({
      ensureStateShape: DomainModel.ensureStateShape,
      createEmptyState: DomainModel.createEmptyState,
      generateId: DomainModel.generateId
    });
    const CsvImportOrchestrator = createCsvImportOrchestrator({ DomainModel });


    /* =========================================================
     *  Modul: Storage (mit verpflichtender, session-basierter Verschlüsselung)
    *  Änderungen: Verschlüsselung wird als verpflichtend behandelt (UI zwingt
    *  Benutzer zur Einrichtung). saveState verhindert nun Klartext‑Schreibvorgänge
     *  wenn die Verschlüsselung aktiv ist und kein Sitzungspasswort vorhanden ist.
     *  Zusätzlich: isEncrypted() und changePassword() exposed, Passwort wird
     *  bei bevorstehendem Seitenabbruch aus dem Speicher gelöscht.
     * =======================================================*/
    let observeUnsavedBeforeExit = null;
    let maskBeforeHardBoundary = null;
    try {
      // Installed before Storage's unload listeners so dirty editors are still readable.
      window.addEventListener('beforeunload', function (event) {
        const unsaved = typeof observeUnsavedBeforeExit === 'function' && observeUnsavedBeforeExit();
        if (typeof maskBeforeHardBoundary === 'function') maskBeforeHardBoundary();
        if (unsaved) {
          event.preventDefault();
          event.returnValue = '';
        }
      }, true);
      window.addEventListener('pagehide', function () {
        if (typeof maskBeforeHardBoundary === 'function') maskBeforeHardBoundary();
      }, true);
    } catch (error) {}
    const sessionCoordinator = createSessionCoordinator({
      lockManager: typeof navigator !== 'undefined' ? navigator.locks : null,
      resourceName: 'notenverwaltung-v1-editor',
      onLost: function () {
        if (typeof maskBeforeHardBoundary === 'function') maskBeforeHardBoundary();
        Storage.lockSession();
      }
    });
    const Storage = createStorage({ DomainModel, createInitialState, sessionCoordinator });


    /* =========================================================
     *  Modul: GradingLogic
     *  Berechnet Noten, Durchschnitte, Mediane und Verteilungen
     * =======================================================*/
    function createGradingDiagnostics() {
      return {
        assessment(scope, course, assessment) {
          if (!window.DEBUG_PREVTERM) return;
          const inferredTerm = scope.assessmentTerms.get(assessment) || scope.currentTerm;
          console.debug('[DEBUG computeOverallGrade]', {
            courseId: course && course.id,
            courseName: course && course.name,
            includedTerms: Array.from(scope.includedTerms),
            assessmentId: assessment && assessment.id,
            inferredTerm,
            currentTerm: scope.currentTerm,
            previousTerm: scope.previousTerm,
            included: scope.includedTerms.has(inferredTerm)
          });
        },
        result(course, result) {
          if (!window.DEBUG_PREVTERM) return;
          console.debug('[DEBUG computeOverallGrade result]', {
            courseId: course && course.id,
            courseName: course && course.name,
            result
          });
        }
      };
    }

    const GradingLogic = createGradingLogic({
      now: () => new Date(),
      diagnostics: createGradingDiagnostics()
    });


    /* =========================================================
     *  Modul: UiShell
     *  (Grundlayout, Navigation, Kursauswahl, Dark Mode)
     * =======================================================*/
    const UiShell = (function () {

      function resolveGradeColorBand(schemaMode, numericValue, rawString) {
        if (numericValue === null || numericValue === undefined || !Number.isFinite(Number(numericValue))) {
          return null;
        }
        const value = Number(Number(numericValue).toFixed(10));
        if (schemaMode === 'grades') {
          if (rawString && /[-−]/.test(String(rawString)) && value >= 4) return 'critical';
          if (value >= 4.25) return 'critical';
          if (value <= 1.5) return 'best';
          if (value <= 2.5) return 'good';
          if (value <= 3.5) return 'middle';
          return 'notice';
        }
        if (schemaMode === 'uppersec') {
          if (value <= 4) return 'critical';
          if (value >= 13) return 'best';
          if (value >= 10) return 'good';
          if (value >= 7) return 'middle';
          return 'notice';
        }
        return null;
      }

      let _activeSessionClearedRender = null;
      let _startupEpoch = 0;
      let _hasInitialized = false;
      let _sessionRootId = null;

      const LOST_INPUT_NOTICE = 'Die letzte Eingabe wurde nicht gespeichert. Bitte nach dem Entsperren prüfen und erneut eingeben.';

      function _renderSessionBlock(root, status, rootElementId = _sessionRootId || root.id) {
        document.title = 'Notenverwaltung · Version ' + APP_RELEASE.version;
        while (root.firstChild) root.removeChild(root.firstChild);
        root.hidden = false;
        root.inert = false;
        const section = document.createElement('section');
        section.className = 'lock-screen';
        const card = document.createElement('div');
        card.className = 'lock-card';
        const heading = document.createElement('h1');
        heading.id = 'lock-screen-title';
        heading.textContent = 'Anwendung gesperrt';
        section.setAttribute('aria-labelledby', 'lock-screen-title');
        const message = document.createElement('p');
        message.className = 'lock-card__message';
        message.textContent = status === 'busy'
          ? 'Die Anwendung wird bereits in einem anderen Fenster bearbeitet. Bitte dieses zuerst sperren oder schließen.'
          : status === 'unsupported'
            ? 'Dieser Browser kann die sichere Bearbeitung nicht freigeben. Bitte verwende einen unterstützten aktuellen Desktopbrowser.'
            : 'Zum Weiterarbeiten bitte erneut entsperren. Kurse und Noten bleiben bis dahin ausgeblendet.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'lock-card__primary';
        retry.textContent = status === 'busy' || status === 'unsupported' ? 'Erneut versuchen' : 'Entsperren';
        retry.addEventListener('click', async () => {
          if (retry.disabled) return;
          retry.disabled = true;
          const retryEpoch = _startupEpoch + 1;
          try { await init(rootElementId); }
          catch (error) {
            if (_startupEpoch === retryEpoch + 1) _renderSessionBlock(root, sessionCoordinator.getStatus(), rootElementId);
          }
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'lock-card__secondary';
        cancel.textContent = 'Gesperrt bleiben';
        card.appendChild(heading);
        card.appendChild(message);
        const actions = document.createElement('div');
        actions.className = 'lock-card__actions';
        actions.appendChild(retry);
        actions.appendChild(cancel);
        card.appendChild(actions);
        section.appendChild(card);
        root.appendChild(section);
        try { retry.focus(); } catch (error) {}
      }

      async function init(rootElementId) {
        const root = document.getElementById(rootElementId);
        if (!root) { const error = new Error('Anwendungsbereich nicht gefunden.'); error.code = 'APP_ROOT_MISSING'; throw error; }
        _sessionRootId = rootElementId;
        const attempt = ++_startupEpoch;
        _activeSessionClearedRender = null;
        const result = await sessionCoordinator.acquire();
        if (attempt !== _startupEpoch) return;
        if (result !== 'acquired') { _renderSessionBlock(root, result); return; }
        try {
          await _initOwned(rootElementId, attempt, !_hasInitialized);
          if (attempt === _startupEpoch) _hasInitialized = true;
        } catch (error) {
          if (attempt !== _startupEpoch) return;
          Storage.lockSession();
          if (error && ['SESSION_NOT_OWNER', 'STORAGE_EXTERNAL_CHANGE', 'STORAGE_GENERATION_STALE'].includes(error.code)) return;
          _sessionRootId = null;
          throw error;
        }
      }

      try {
        window.addEventListener('pageshow', event => {
          if (event.persisted && _sessionRootId) {
            init(_sessionRootId).catch(() => {});
          }
        });
      } catch (error) {}
      let _activeColorSchemeCleanup = null;
      let _activeReducedMotionCleanup = null;
      let _activeAuroraInteractionCleanup = null;

      function _handleSessionCleared() {
        _startupEpoch += 1;
        try {
          if (typeof maskBeforeHardBoundary === 'function') maskBeforeHardBoundary();
          if (typeof _activeSessionClearedRender === 'function') {
            _activeSessionClearedRender();
          } else if (_sessionRootId) {
            const root = document.getElementById(_sessionRootId);
            if (root) _renderSessionBlock(root, sessionCoordinator.getStatus());
          }
        } catch (e) {}
      }

      try {
        window.addEventListener('sessionCleared', _handleSessionCleared);
      } catch (e) {}

      function _replaceColorSchemeListener(mediaQueryList, listener) {
        let nextCleanup = null;
        if (mediaQueryList && typeof listener === 'function' && typeof mediaQueryList.addEventListener === 'function') {
          mediaQueryList.addEventListener('change', listener);
          nextCleanup = function () {
            if (typeof mediaQueryList.removeEventListener === 'function') mediaQueryList.removeEventListener('change', listener);
          };
        } else if (mediaQueryList && typeof listener === 'function' && typeof mediaQueryList.addListener === 'function') {
          mediaQueryList.addListener(listener);
          nextCleanup = function () {
            if (typeof mediaQueryList.removeListener === 'function') mediaQueryList.removeListener(listener);
          };
        }
        const previousCleanup = _activeColorSchemeCleanup;
        _activeColorSchemeCleanup = nextCleanup;
        if (previousCleanup) {
          try { previousCleanup(); } catch (e) {}
        }
      }

      function _replaceReducedMotionListener(mediaQueryList, listener) {
        let nextCleanup = null;
        if (mediaQueryList && typeof listener === 'function' && typeof mediaQueryList.addEventListener === 'function') {
          mediaQueryList.addEventListener('change', listener);
          nextCleanup = function () {
            if (typeof mediaQueryList.removeEventListener === 'function') mediaQueryList.removeEventListener('change', listener);
          };
        } else if (mediaQueryList && typeof listener === 'function' && typeof mediaQueryList.addListener === 'function') {
          mediaQueryList.addListener(listener);
          nextCleanup = function () {
            if (typeof mediaQueryList.removeListener === 'function') mediaQueryList.removeListener(listener);
          };
        }
        const previousCleanup = _activeReducedMotionCleanup;
        _activeReducedMotionCleanup = nextCleanup;
        if (previousCleanup) {
          try { previousCleanup(); } catch (e) {}
        }
      }

      function createSerializedTransactionQueue() {
        let tail = Promise.resolve();
        return function enqueue(transaction) {
          const result = tail.then(transaction, transaction);
          tail = result.then(function () {}, function () {});
          return result;
        };
      }

      function createLatestInteractionGuard() {
        let latestInteraction = 0;
        return function beginInteraction() {
          const currentInteraction = ++latestInteraction;
          return function isLatestInteraction() {
            return currentInteraction === latestInteraction;
          };
        };
      }

      const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();

      function parseTermResultInput(raw) {
        const text = String(raw == null ? '' : raw).trim();
        if (text === '') return null;
        if (!/^(?:[0-9]|1[0-5])$/.test(text)) {
          throw new Error('Bitte eine ganze Punktzahl von 0 bis 15 eingeben oder das Feld leeren.');
        }
        return Number(text);
      }

      function parseHalfYearDateValue(value) {
        const parsed = parseCalendarDate(value);
        return parsed ? calendarDateToLocalDate(parsed) : null;
      }

      function validateHalfYearDateRange(label, schoolYearStart, h1End, h2Start) {
        const dates = [schoolYearStart, h1End, h2Start];
        if (dates.some(date => !date || typeof date.getTime !== 'function' || isNaN(date.getTime()))) {
          return { ok: false, message: `Bitte alle Datumsfelder in ${label} ausfüllen.` };
        }
        const nextSchoolYearStart = new Date(
          schoolYearStart.getFullYear() + 1,
          schoolYearStart.getMonth(),
          schoolYearStart.getDate()
        );
        if (h1End < schoolYearStart || h2Start < schoolYearStart ||
            h1End >= nextSchoolYearStart || h2Start >= nextSchoolYearStart) {
          return { ok: false, message: `${label}: H1 Ende und H2 Start müssen im gewählten Schuljahr liegen.` };
        }
        return { ok: true };
      }

      function applyHalfYearDateInputs(state, levels) {
        const nextSettings = {};
        for (const levelInput of levels) {
          const schoolYearStart = parseHalfYearDateValue(levelInput.schoolYearStartValue);
          const h1End = parseHalfYearDateValue(levelInput.h1EndValue);
          const h2Start = parseHalfYearDateValue(levelInput.h2StartValue);
          const validation = validateHalfYearDateRange(levelInput.label, schoolYearStart, h1End, h2Start);
          if (!validation.ok) return validation;
          nextSettings[levelInput.level] = {
            schoolYearStartYear: schoolYearStart.getFullYear(),
            schoolYearStartMonth: schoolYearStart.getMonth() + 1,
            schoolYearStartDay: schoolYearStart.getDate(),
            h1EndYear: h1End.getFullYear(),
            h1EndMonth: h1End.getMonth() + 1,
            h1EndDay: h1End.getDate(),
            h2StartYear: h2Start.getFullYear(),
            h2StartMonth: h2Start.getMonth() + 1,
            h2StartDay: h2Start.getDate()
          };
        }
        state.settings.halfYearSettings = nextSettings;
        return { ok: true };
      }

      function createTermResultInput(initialPoints, archived) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '15';
        input.step = '1';
        input.inputMode = 'numeric';
        input.value = Number.isInteger(initialPoints) ? String(initialPoints) : '';
        input.disabled = !!archived;
        input.setAttribute('aria-label', 'Festgesetzte Punktzahl');
        return input;
      }

      function persistScoreEntryWithRollback(assessmentId, studentId, nextEntryOrFactory, commitStateChange) {
        if (typeof commitStateChange !== 'function') return Promise.reject(new Error('Commitfunktion fehlt.'));
        return commitStateChange(function (candidate) {
          const assessments = Array.isArray(candidate && candidate.assessments) ? candidate.assessments : [];
          const matches = assessments.filter(function (assessment) {
            return assessment && assessment.id === assessmentId;
          });
          if (matches.length !== 1) throw new Error('Die ausgewählte Leistung ist nicht mehr verfügbar.');
          const assessment = matches[0];
          const course = (candidate.courses || []).find(function (item) {
            return item && item.id === assessment.courseId && !item.archivedAt;
          });
          const student = (candidate.students || []).find(function (item) { return item && item.id === studentId; });
          const enrollment = course && (course.enrollments || []).find(function (item) { return item.studentId === studentId; });
          if (!course || !student || !enrollment) throw new Error('Die Noteneingabe ist für diese Zuordnung nicht mehr verfügbar.');
          if (!assessment.scores || typeof assessment.scores !== 'object') assessment.scores = {};
          const currentEntry = Object.prototype.hasOwnProperty.call(assessment.scores, studentId)
            ? { ...assessment.scores[studentId] }
            : null;
          const nextEntry = typeof nextEntryOrFactory === 'function'
            ? nextEntryOrFactory(currentEntry, assessment, candidate)
            : nextEntryOrFactory;
          assessment.scores[studentId] = { ...nextEntry };
        }, { render: false }).then(function (candidate) {
          const assessment = (candidate.assessments || []).find(function (item) { return item && item.id === assessmentId; });
          return assessment && assessment.scores ? assessment.scores[studentId] : null;
        });
      }

      function persistAssessmentDeletionWithRollback(assessmentId, commitStateChange) {
        if (typeof commitStateChange !== 'function') return Promise.reject(new Error('Commitfunktion fehlt.'));
        let deleted = false;
        return commitStateChange(function (candidate) {
          const assessments = Array.isArray(candidate && candidate.assessments) ? candidate.assessments : [];
          const matches = assessments.filter(function (assessment) {
            return assessment && assessment.id === assessmentId;
          });
          if (matches.length === 0) return;
          if (matches.length !== 1) throw new Error('Die ausgewählte Leistung ist nicht eindeutig.');
          const course = (candidate.courses || []).find(function (item) {
            return item && item.id === matches[0].courseId && !item.archivedAt;
          });
          if (!course) throw new Error('Die Leistung gehört nicht mehr zu einem bearbeitbaren Kurs.');
          candidate.assessments = assessments.filter(function (assessment) {
            return !assessment || assessment.id !== assessmentId;
          });
          deleted = true;
        }).then(function () { return deleted; });
      }

      function persistTermResultWithRollback(courseId, studentId, term, nextPoints, commitStateChange) {
        if (typeof commitStateChange !== 'function') return Promise.reject(new Error('Commitfunktion fehlt.'));
        return commitStateChange(function (candidate) {
          const course = (candidate.courses || []).find(function (item) {
            return item && item.id === courseId && !item.archivedAt;
          });
          const student = (candidate.students || []).find(function (item) { return item && item.id === studentId; });
          const enrollment = course && (course.enrollments || []).find(function (item) { return item.studentId === studentId; });
          if (!course || !student || !enrollment) throw new Error('Die Festsetzung ist für diese Zuordnung nicht mehr verfügbar.');
          DomainModel.setTermResult(candidate, courseId, studentId, term, nextPoints);
        }, { render: false }).then(function (candidate) {
          const course = DomainModel.findCourseById(candidate, courseId);
          return course && Array.isArray(course.termResults)
            ? course.termResults.find(function (result) {
              return result && result.studentId === studentId && result.term === term;
            }) || null
            : null;
        });
      }

      function describeUpperSecRecommendation(course, term, settings) {
        if (!course || course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC) {
          return { visible: false };
        }
        const context = course.upperSecContext || {};
        const courseTypeLabels = {
          [DomainModel.UPPERSEC_COURSE_TYPES.BASIC]: 'Grundkurs',
          [DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED]: 'Leistungskurs',
          [DomainModel.UPPERSEC_COURSE_TYPES.OTHER]: 'Sonstiger Kurs'
        };
        const qualificationYearLabels = {
          [DomainModel.QUALIFICATION_YEARS.Q1_Q2]: 'Q1/Q2',
          [DomainModel.QUALIFICATION_YEARS.Q3_Q4]: 'Q3/Q4'
        };
        const gradingContext = GradingLogic.resolveUpperSecGradingContext(course, null, term, settings);
        const templates = Array.isArray(settings && settings.weightTemplates)
          ? settings.weightTemplates
          : [];
        const activeTemplate = course.weightTemplateId
          ? templates.find(template => template && template.id === course.weightTemplateId) || null
          : null;
        const recommendationLabel = gradingContext.status === 'recommendation'
          ? `Empfehlung: ${gradingContext.expectedExamCount} Klausur${gradingContext.expectedExamCount === 1 ? '' : 'en'}, Klausurteil ${gradingContext.expectedExamCount === 1 ? '1/3' : '1/2'}`
          : gradingContext.message;
        const activeWeightingLabel = course.weightTemplateId
          ? `Aktive Gewichtung: ${activeTemplate ? (activeTemplate.name || 'Vorlage') : 'Unbekannte oder entfernte Vorlage'}`
          : 'Aktive Gewichtung: Gleichverteilung';
        const isDeviation = gradingContext.isWeightingDeviation === true;
        const reason = context.weightingDeviationReason;
        return {
          visible: true,
          contextComplete: !!(courseTypeLabels[context.courseType] && qualificationYearLabels[context.qualificationYear]),
          courseTypeLabel: courseTypeLabels[context.courseType] || 'Bitte auswählen',
          qualificationYearLabel: qualificationYearLabels[context.qualificationYear] || 'Bitte auswählen',
          qualificationPhase: gradingContext.qualificationPhase,
          expectedExamCount: gradingContext.expectedExamCount,
          recommendedWeightTemplateId: gradingContext.recommendedWeightTemplateId,
          recommendationAvailable: gradingContext.status === 'recommendation' && !!gradingContext.recommendedWeightTemplateId,
          recommendationLabel,
          activeWeightingLabel,
          isWeightingDeviation: isDeviation,
          deviationLabel: isDeviation
            ? `Abweichung: ${reason || 'ohne Begründung'}`
            : gradingContext.status === 'recommendation'
              ? 'Keine Abweichung von der Empfehlung'
              : 'Keine automatisch anwendbare Empfehlung'
        };
      }

      function applyUpperSecCourseContextChange(candidate, courseId, change) {
        const currentCourse = DomainModel.findCourseById(candidate, courseId);
        if (!currentCourse || currentCourse.archivedAt ||
            currentCourse.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC) {
          throw new Error('Nur ein aktiver Sek-II-Kurs kann bearbeitet werden.');
        }
        const nextContext = DomainModel.normalizeUpperSecContext(
          DomainModel.SCHEMA_MODES.UPPERSEC,
          {
            courseType: change && change.courseType,
            qualificationYear: change && change.qualificationYear,
            weightingDeviationReason: change && Object.prototype.hasOwnProperty.call(change, 'weightingDeviationReason')
              ? change.weightingDeviationReason
              : currentCourse.upperSecContext && currentCourse.upperSecContext.weightingDeviationReason
          }
        );
        if (!nextContext || !nextContext.courseType || !nextContext.qualificationYear) {
          throw new Error('Bitte Kursart und Qualifikationsabschnitt vollständig auswählen.');
        }
        currentCourse.upperSecContext = nextContext;
        currentCourse.includePrevTermGrades = false;
        const presentation = describeUpperSecRecommendation(
          currentCourse,
          change && change.term,
          candidate.settings
        );
        if (change && change.applyRecommendation === true && presentation.recommendedWeightTemplateId) {
          currentCourse.weightTemplateId = presentation.recommendedWeightTemplateId;
        }
        return candidate;
      }

      function applyCourseSchemaContextChange(candidate, courseId, change) {
        const currentCourse = DomainModel.findCourseById(candidate, courseId);
        if (!currentCourse || currentCourse.archivedAt) {
          throw new Error('Nur ein aktiver Kurs kann bearbeitet werden.');
        }
        const nextSchemaMode = change && change.schemaMode;
        if (![DomainModel.SCHEMA_MODES.GRADES, DomainModel.SCHEMA_MODES.UPPERSEC].includes(nextSchemaMode)) {
          throw new Error('Bitte ein gültiges Bewertungsschema auswählen.');
        }
        const nextContext = nextSchemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
          ? DomainModel.normalizeUpperSecContext(nextSchemaMode, change && change.upperSecContext)
          : null;
        if (nextSchemaMode === DomainModel.SCHEMA_MODES.UPPERSEC &&
            (!nextContext || !nextContext.courseType || !nextContext.qualificationYear)) {
          throw new Error('Bitte Kursart und Qualifikationsabschnitt vollständig auswählen.');
        }
        currentCourse.schemaMode = nextSchemaMode;
        currentCourse.upperSecContext = nextContext;
        currentCourse.includePrevTermGrades = nextSchemaMode === DomainModel.SCHEMA_MODES.GRADES;
        return candidate;
      }

      function createUpperSecContextFields(options) {
        if (!options || options.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC) return null;
        const context = options.context || {};
        const referenceDate = options.now ? new Date(options.now) : new Date();
        const contextTerm = options.term || GradingLogic.resolveAssessmentTermFromDateValue(
          referenceDate,
          options.course || { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC },
          options.settings || {}
        );
        const wrapper = document.createElement('div');
        wrapper.dataset.upperSecContextFields = 'true';
        wrapper.style.gridColumn = '1 / -1';
        wrapper.style.display = 'grid';
        wrapper.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1fr)';
        wrapper.style.gap = '0.5rem 1rem';
        wrapper.style.padding = '0.65rem';
        wrapper.style.border = '1px solid var(--border-soft)';
        wrapper.style.borderRadius = '6px';

        function appendSelect(labelText, values, selectedValue) {
          const field = document.createElement('label');
          field.style.fontSize = '0.8rem';
          field.appendChild(document.createTextNode(labelText));
          const select = document.createElement('select');
          select.required = true;
          select.style.display = 'block';
          select.style.width = '100%';
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'Bitte auswählen';
          select.appendChild(empty);
          values.forEach(function (item) {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            select.appendChild(option);
          });
          select.value = selectedValue || '';
          field.appendChild(select);
          wrapper.appendChild(field);
          return select;
        }

        const courseTypeSelect = appendSelect('Kursart *', [
          { value: DomainModel.UPPERSEC_COURSE_TYPES.BASIC, label: 'Grundkurs' },
          { value: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED, label: 'Leistungskurs' },
          { value: DomainModel.UPPERSEC_COURSE_TYPES.OTHER, label: 'Sonstiger Kurs' }
        ], context.courseType);
        const qualificationYearSelect = appendSelect('Qualifikationsabschnitt *', [
          { value: DomainModel.QUALIFICATION_YEARS.Q1_Q2, label: 'Q1/Q2' },
          { value: DomainModel.QUALIFICATION_YEARS.Q3_Q4, label: 'Q3/Q4' }
        ], context.qualificationYear);

        const presentationBox = document.createElement('div');
        presentationBox.style.gridColumn = '1 / -1';
        presentationBox.className = 'info-box';
        const qualificationPhaseText = document.createElement('div');
        const recommendationText = document.createElement('div');
        const activeWeightingText = document.createElement('div');
        const deviationText = document.createElement('div');
        presentationBox.appendChild(qualificationPhaseText);
        presentationBox.appendChild(recommendationText);
        presentationBox.appendChild(activeWeightingText);
        presentationBox.appendChild(deviationText);
        wrapper.appendChild(presentationBox);

        const applyLabel = document.createElement('label');
        applyLabel.style.gridColumn = '1 / -1';
        const applyRecommendationCheckbox = document.createElement('input');
        applyRecommendationCheckbox.type = 'checkbox';
        applyRecommendationCheckbox.checked = false;
        applyLabel.appendChild(applyRecommendationCheckbox);
        applyLabel.appendChild(document.createTextNode(' Empfehlung bei dieser Änderung übernehmen'));
        wrapper.appendChild(applyLabel);

        const reasonLabel = document.createElement('label');
        reasonLabel.style.gridColumn = '1 / -1';
        reasonLabel.appendChild(document.createTextNode('Begründung der Abweichung (optional, maximal 1000 Zeichen)'));
        const reasonInput = document.createElement('textarea');
        reasonInput.rows = 3;
        reasonInput.maxLength = 1000;
        reasonInput.value = context.weightingDeviationReason || '';
        reasonInput.style.display = 'block';
        reasonInput.style.width = '100%';
        reasonLabel.appendChild(reasonInput);
        wrapper.appendChild(reasonLabel);

        function currentPresentation() {
          return describeUpperSecRecommendation({
            schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            upperSecContext: {
              courseType: courseTypeSelect.value || null,
              qualificationYear: qualificationYearSelect.value || null,
              weightingDeviationReason: reasonInput.value || null
            },
            weightTemplateId: typeof options.getWeightTemplateId === 'function'
              ? options.getWeightTemplateId()
              : options.weightTemplateId || null
          }, contextTerm, options.settings || {});
        }
        function refresh() {
          const presentation = currentPresentation();
          qualificationPhaseText.textContent = `Kurshalbjahr: ${presentation.qualificationPhase || 'bitte prüfen'}`;
          recommendationText.textContent = presentation.recommendationLabel;
          activeWeightingText.textContent = presentation.activeWeightingLabel;
          deviationText.textContent = presentation.deviationLabel;
          applyRecommendationCheckbox.disabled = !presentation.recommendationAvailable;
          if (applyRecommendationCheckbox.disabled) applyRecommendationCheckbox.checked = false;
          return presentation;
        }
        function emitChange() {
          refresh();
          if (typeof options.onChange !== 'function') return Promise.resolve();
          return Promise.resolve(options.onChange({
            courseType: courseTypeSelect.value || null,
            qualificationYear: qualificationYearSelect.value || null,
            weightingDeviationReason: reasonInput.value,
            term: contextTerm,
            applyRecommendation: applyRecommendationCheckbox.checked === true
          }));
        }
        [courseTypeSelect, qualificationYearSelect, reasonInput, applyRecommendationCheckbox]
          .forEach(function (element) { element.addEventListener('change', emitChange); });
        refresh();
        return {
          element: wrapper,
          courseTypeSelect,
          qualificationYearSelect,
          reasonInput,
          applyRecommendationCheckbox,
          qualificationPhaseText,
          recommendationText,
          activeWeightingText,
          deviationText,
          refresh
        };
      }

      function bindCourseSchemaContextEditor(options) {
        const readState = options && options.readState;
        const courseId = options && options.courseId;
        const schemaSelect = options && options.schemaSelect;
        const contextHost = options && options.contextHost;
        const commitStateChange = options && options.commitStateChange;
        const liveState = typeof readState === 'function' ? readState() : null;
        const currentCourse = liveState && DomainModel.findCourseById(liveState, courseId);
        if (!currentCourse || !schemaSelect || !contextHost || typeof commitStateChange !== 'function') {
          throw new Error('Schema-Kontext-Editor ist unvollständig konfiguriert.');
        }

        let contextEditor = null;
        let pendingSchemaMode = currentCourse.schemaMode;
        let pendingContext = currentCourse.upperSecContext
          ? JSON.parse(JSON.stringify(currentCourse.upperSecContext))
          : { courseType: null, qualificationYear: null, weightingDeviationReason: null };

        function showError(error) {
          if (typeof options.onError === 'function') options.onError(error);
        }
        function clearContextEditor() {
          contextHost.replaceChildren();
          contextEditor = null;
        }
        function persistContextChange(change) {
          pendingContext = {
            courseType: change.courseType || null,
            qualificationYear: change.qualificationYear || null,
            weightingDeviationReason: change.weightingDeviationReason || null
          };
          const eventContext = {
            ...pendingContext,
            term: change.term || options.term || null,
            applyRecommendation: change.applyRecommendation === true
          };
          if (!eventContext.courseType || !eventContext.qualificationYear) return Promise.resolve(null);
          pendingSchemaMode = DomainModel.SCHEMA_MODES.UPPERSEC;

          const operation = commitStateChange(function (candidate) {
            const candidateCourse = DomainModel.findCourseById(candidate, courseId);
            if (candidateCourse && candidateCourse.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
              return applyUpperSecCourseContextChange(candidate, courseId, eventContext);
            }
            return applyCourseSchemaContextChange(candidate, courseId, {
              schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
              upperSecContext: eventContext
            });
          });
          return operation.catch(function (error) {
            const confirmedState = typeof readState === 'function' ? readState() : null;
            const confirmedCourse = confirmedState && DomainModel.findCourseById(confirmedState, courseId);
            pendingSchemaMode = confirmedCourse ? confirmedCourse.schemaMode : pendingSchemaMode;
            showError(error);
            return null;
          });
        }
        function renderContextEditor() {
          contextEditor = createUpperSecContextFields({
            schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            course: currentCourse,
            context: pendingContext,
            term: options.term,
            settings: (typeof readState === 'function' && readState() || liveState).settings,
            getWeightTemplateId: typeof options.getWeightTemplateId === 'function'
              ? options.getWeightTemplateId
              : function () { return currentCourse.weightTemplateId; },
            onChange: persistContextChange
          });
          contextHost.replaceChildren(contextEditor.element);
          return contextEditor;
        }

        schemaSelect.addEventListener('change', function () {
          if (this.value === DomainModel.SCHEMA_MODES.UPPERSEC) {
            renderContextEditor();
            return Promise.resolve(null);
          }
          clearContextEditor();
          if (pendingSchemaMode === DomainModel.SCHEMA_MODES.GRADES) return Promise.resolve(null);
          pendingSchemaMode = DomainModel.SCHEMA_MODES.GRADES;
          return commitStateChange(function (candidate) {
            return applyCourseSchemaContextChange(candidate, courseId, {
              schemaMode: DomainModel.SCHEMA_MODES.GRADES,
              upperSecContext: null
            });
          }).catch(function (error) {
            pendingSchemaMode = DomainModel.SCHEMA_MODES.UPPERSEC;
            schemaSelect.value = DomainModel.SCHEMA_MODES.UPPERSEC;
            renderContextEditor();
            showError(error);
            return null;
          });
        });

        if (currentCourse.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) renderContextEditor();
        return {
          getContextEditor: function () { return contextEditor; }
        };
      }

      function canManageWrittenExamSubjectQ4(course) {
        return !!(
          course && !course.archivedAt &&
          course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC &&
          course.upperSecContext &&
          course.upperSecContext.courseType === DomainModel.UPPERSEC_COURSE_TYPES.BASIC &&
          course.upperSecContext.qualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4
        );
      }

      function isAssessmentNotScheduledForStudent(course, assessment, studentId, settings) {
        if (!course || !assessment || !studentId || !assessment.term) return false;
        const context = GradingLogic.resolveUpperSecGradingContext(
          course,
          studentId,
          assessment.term,
          settings
        );
        if (context.status !== 'general-only') return false;
        const activeCategoryIds = new Set(
          (Array.isArray(settings && settings.categories) ? settings.categories : [])
            .filter(category => category && category.active)
            .map(category => category.id)
        );
        if (!activeCategoryIds.has(assessment.categoryId)) return false;
        const effectiveCategoryIds = new Set(
          GradingLogic.resolveEffectiveCategoryWeights(
            course,
            studentId,
            assessment.term,
            settings
          ).map(item => item.categoryId)
        );
        return !effectiveCategoryIds.has(assessment.categoryId);
      }

      function formatReportScorePresentation(course, assessment, studentId, settings, audience = 'student') {
        const entry = assessment && assessment.scores ? assessment.scores[studentId] : null;
        if (isAssessmentNotScheduledForStudent(course, assessment, studentId, settings)) {
          const retainedValue = entry && entry.valueRaw != null && entry.valueRaw !== ''
            ? String(entry.valueRaw)
            : '';
          return {
            text: audience === 'internal' && retainedValue
              ? `nicht vorgesehen (Altwert: ${retainedValue})`
              : 'nicht vorgesehen',
            numeric: null,
            status: 'not-scheduled'
          };
        }
        const status = entry ? entry.status : DomainModel.SCORE_STATUS.MISSING;
        let text = audience === 'internal' && !entry ? '' : '–';
        if (audience === 'internal' && status === DomainModel.SCORE_STATUS.MISSING && entry) text = 'fehlt';
        else if (audience === 'internal' && status === DomainModel.SCORE_STATUS.EXCUSED) text = 'entsch.';
        else if (entry && entry.valueRaw != null && entry.valueRaw !== '') text = String(entry.valueRaw);
        let numeric = null;
        try {
          numeric = entry ? GradingLogic.getNumericScoreForEntry(entry, course, settings) : null;
        } catch (e) {}
        return { text, numeric, status };
      }

      function listExistingQ4WrittenScoresForStudent(state, course, studentId, settings) {
        if (!canManageWrittenExamSubjectQ4(course)) return [];
        const comparisonCourse = {
          ...course,
          enrollments: (course.enrollments || []).map(enrollment =>
            enrollment.studentId === studentId
              ? { ...enrollment, writtenExamSubjectQ4: false }
              : enrollment
          )
        };
        return DomainModel.listAssessmentsForCourse(state, course.id).filter(assessment =>
          assessment && assessment.scores && assessment.scores[studentId] &&
          isAssessmentNotScheduledForStudent(
            comparisonCourse,
            assessment,
            studentId,
            settings
          )
        );
      }

      function applyWrittenExamSubjectQ4Change(candidate, courseId, studentId, value) {
        DomainModel.setWrittenExamSubjectQ4(candidate, courseId, studentId, value === true);
        return candidate;
      }

      function findNextGradesheetInput(inputs, currentInput, key) {
        const list = Array.from(inputs || []).filter(function (input) {
          for (let node = input; node; node = node.parentNode) {
            if (node.hidden) return false;
          }
          return true;
        });
        const currentIndex = list.indexOf(currentInput);
        if (currentIndex < 0) return null;
        if (key === 'Tab') return list[currentIndex + 1] || null;
        const row = Number(currentInput.dataset && currentInput.dataset.gradesheetRow);
        const column = Number(currentInput.dataset && currentInput.dataset.gradesheetColumn);
        const term = currentInput.dataset && currentInput.dataset.gradesheetTerm;
        if (!Number.isInteger(row) || !Number.isInteger(column)) return null;
        const sameColumn = list.filter(input =>
          Number(input.dataset && input.dataset.gradesheetColumn) === column &&
          (input.dataset && input.dataset.gradesheetTerm) === term
        );
        if (key === 'Enter' || key === 'ArrowDown') {
          return sameColumn
            .filter(input => Number(input.dataset.gradesheetRow) > row)
            .sort((left, right) => Number(left.dataset.gradesheetRow) - Number(right.dataset.gradesheetRow))[0] || null;
        }
        if (key === 'ArrowUp') {
          return sameColumn
            .filter(input => Number(input.dataset.gradesheetRow) < row)
            .sort((left, right) => Number(right.dataset.gradesheetRow) - Number(left.dataset.gradesheetRow))[0] || null;
        }
        return null;
      }

      function applyStoredSessionTimeout(state) {
        const minutes = state && state.settings && state.settings.sessionTimeoutMinutes;
        if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0) return false;
        Storage.setSessionTimeoutMinutes(minutes);
        return true;
      }

      function removeDebugModeArtifacts() {
        const hookNames = [
          "runPrevTermIntegrationTest",
          "runUpperSecPrevTermTest",
          "runCreatePersistentUpperSecTestCourse"
        ];
        try {
          hookNames.forEach(name => {
            const descriptor = Object.getOwnPropertyDescriptor(window, name);
            if (descriptor && descriptor.configurable) delete window[name];
          });
        } catch (e) {}
        try {
          document.querySelectorAll(".debug-block").forEach(element => element.remove());
        } catch (e) {}
      }

      function runWhenDebugModeEnabled(callback) {
        try {
          if (localStorage.getItem('__debugMode') !== '1') {
            removeDebugModeArtifacts();
            return false;
          }
          if (typeof callback !== 'function') return false;
        } catch (e) {
          removeDebugModeArtifacts();
          return false;
        }
        callback();
        return true;
      }

      function installDebugWindowHook(name, callback) {
        const allowedNames = [
          "runPrevTermIntegrationTest",
          "runUpperSecPrevTermTest",
          "runCreatePersistentUpperSecTestCourse"
        ];
        if (!allowedNames.includes(name) || typeof callback !== "function") return false;
        return runWhenDebugModeEnabled(function () {
          const guardedCallback = Object.freeze(function (...args) {
            let result;
            const executed = runWhenDebugModeEnabled(function () {
              result = callback.apply(this, args);
            });
            return executed ? result : undefined;
          });
          Object.defineProperty(window, name, {
            configurable: true,
            enumerable: true,
            writable: false,
            value: guardedCallback
          });
        });
      }

      function installDebugModeLifecycleGuard() {
        try {
          const syncDebugMode = function () {
            runWhenDebugModeEnabled(function () {});
          };
          window.addEventListener("storage", function (event) {
            if (!event || event.key === "__debugMode" || event.key === null) syncDebugMode();
          });
          window.addEventListener("focus", syncDebugMode);
          setInterval(syncDebugMode, 250);
          return true;
        } catch (e) {
          removeDebugModeArtifacts();
          return false;
        }
      }

      installDebugModeLifecycleGuard();

      function removeSessionSensitiveOverlays() {
        try {
          document.querySelectorAll('[data-session-sensitive-overlay="true"]').forEach(overlay => {
            try {
              if (typeof overlay.__closeForSessionLock === 'function') overlay.__closeForSessionLock();
              else overlay.remove();
            } catch (e) {
              try { overlay.remove(); } catch (removeError) {}
            }
          });
        } catch (e) {}
      }

      function resolveAssessmentTermFromDateValue(date, courseObj, settings) {
        return GradingLogic.resolveAssessmentTermFromDateValue(date, courseObj, settings);
      }

      function resolveGradesheetTermFromDateValue(date, course, state) {
        const settings = GradingLogic.getSettingsForCourse(course, state);
        return GradingLogic.resolveAssessmentTermFromDateValue(date, course, settings);
      }

      function formatGradesheetTermLabel(term, course, state) {
        const settings = GradingLogic.getSettingsForCourse(course, state);
        return GradingLogic.formatCourseTermLabel(term, course, settings);
      }

      function formatTermLabelForCourses(term, courses, state) {
        const labels = new Set();
        const uniqueCourses = new Map();
        for (const course of Array.isArray(courses) ? courses : []) {
          if (course && course.id && !uniqueCourses.has(course.id)) {
            uniqueCourses.set(course.id, course);
          }
        }
        for (const course of uniqueCourses.values()) {
          const settings = GradingLogic.getSettingsForCourse(course, state);
          const label = GradingLogic.formatCourseTermLabel(term, course, settings);
          if (label) labels.add(label);
        }
        if (labels.size === 0) {
          labels.add(GradingLogic.formatCourseTermLabel(term, null, state && state.settings));
        }
        return Array.from(labels).sort(compareText).join(' / ');
      }

      // ========================================================================
      // GLOBALE HILFSFUNKTION: Rechnet alle Leistungs-Termine nach Halbjahrs-Einstellungen neu
      // ========================================================================
      function recalcAssessmentTermsForCurrentState(state, courseId = null) {
        if (!state || !Array.isArray(state.assessments)) return;

        for (const asm of state.assessments) {
          if (!asm || asm.termAssignment !== 'auto') continue;
          if (courseId && asm.courseId !== courseId) continue;

          const course = state.courses.find(c => c.id === asm.courseId);
          if (!course || course.archivedAt) continue;

          const sourceDate = asm.date ? parseHalfYearDateValue(asm.date) : new Date();
          if (!sourceDate) continue;
          const termVal = resolveAssessmentTermFromDateValue(sourceDate, course, state.settings);
          if (termVal && termVal !== asm.term) {
            asm.term = termVal;
          }
        }
      }

      async function _initOwned(rootElementId, attempt, persistStartup) {
        _activeSessionClearedRender = null;
        observeUnsavedBeforeExit = null;
        maskBeforeHardBoundary = null;
        const root = document.getElementById(rootElementId);
        if (!root) {
          console.error("Anwendungsbereich nicht gefunden.");
          const error = new Error('Anwendungsbereich nicht gefunden.');
          error.code = 'APP_ROOT_MISSING';
          throw error;
        }

        let state = await Storage.loadState();
        if (attempt !== _startupEpoch) return;
        sessionCoordinator.assertHeld();
        if (Storage.isEncrypted() && !Storage.hasSessionPassword()) { Storage.lockSession(); return; }
        applyStoredSessionTimeout(state);

        // Rechne alle Leistungs-Termine nach aktuellen Einstellungen neu
        // (wichtig nach dem Laden, falls sich Halbjahrs-Einstellungen geändert haben)
        recalcAssessmentTermsForCurrentState(state);

        ensureInitialDemoData(state);

        // Verschlüsselung ist verpflichtend: falls noch kein verschlüsselter
        // Speicher existiert, wird der Nutzer in die Einstellungen geleitet
        // und es wird NICHT automatisch Klartext gespeichert.
        let encryptionRequired = !Storage.isEncrypted();
        if (persistStartup && Storage.hasSessionPassword()) {
          await Storage.saveState(state);
          if (attempt !== _startupEpoch) return;
          sessionCoordinator.assertHeld();
        }

        // Darstellung ist bewusst ein lokales, von Noten getrenntes Bedienungsdetail.
        const THEME_STORAGE_KEY = "notenverwaltung_theme";
        const APPEARANCE_STORAGE_KEY = "notenverwaltung_appearance";
        const appearanceValues = {
          family: new Set(['classic', 'modern', 'aurora']),
          appearance: new Set(['light', 'dark', 'system']),
          accent: new Set(['standard', 'blue', 'green', 'petrol', 'violet', 'amber']),
          background: new Set(['standard', 'blue', 'green', 'petrol', 'violet', 'amber']),
          motion: new Set(['off', 'calm', 'vivid'])
        };
        const defaultAppearance = { family: 'classic', appearance: 'light', accent: 'standard', background: 'standard', motion: 'vivid' };

        function normalizeAppearance(candidate) {
          const value = candidate && typeof candidate === 'object' ? candidate : {};
          const result = {};
          Object.keys(defaultAppearance).forEach(function (key) {
            result[key] = appearanceValues[key].has(value[key]) ? value[key] : defaultAppearance[key];
          });
          return result;
        }

        function loadAppearance() {
          try {
            const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
            if (stored) return normalizeAppearance(JSON.parse(stored));
            const legacyTheme = localStorage.getItem(THEME_STORAGE_KEY);
            if (legacyTheme === 'dark' || legacyTheme === 'light') {
              const migrated = normalizeAppearance({ appearance: legacyTheme });
              try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(migrated)); } catch (e) {}
              return migrated;
            }
          } catch (e) {}
          return { ...defaultAppearance };
        }

        const systemColorScheme = typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        const systemReducedMotion = typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        let currentAppearance = loadAppearance();
        let currentTheme = 'light';
        let dashboardMount = null;
        let appearanceControlElements = null;
        let appearanceFeedbackElement = null;
        const appearanceTimers = new Set();

        function effectiveMotion() {
          if (currentAppearance.family === 'classic' || currentAppearance.motion === 'off' || (systemReducedMotion && systemReducedMotion.matches)) return 'off';
          return currentAppearance.motion;
        }

        function nodeHasClass(node, className) {
          return !!(node && node.classList && node.classList.contains(className));
        }

        function nodeContains(ancestor, descendant) {
          for (let node = descendant; node; node = node.parentNode) {
            if (node === ancestor) return true;
          }
          return false;
        }

        function isAuroraEffectTarget(node) {
          if (!node || node === root) return false;
          const tagName = String(node.tagName || '').toUpperCase();
          return tagName === 'BUTTON' || tagName === 'SUMMARY' ||
            nodeHasClass(node, 'nv-course-cards__card') || nodeHasClass(node, 'dashboard-resume-card');
        }

        function blocksAuroraEffect(node) {
          if (!node) return false;
          const tagName = String(node.tagName || '').toUpperCase();
          if (['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD'].includes(tagName)) {
            return true;
          }
          const contentEditable = typeof node.getAttribute === 'function'
            ? node.getAttribute('contenteditable')
            : null;
          return node.isContentEditable === true || (contentEditable !== null && contentEditable !== 'false');
        }

        function findAuroraEffectTarget(start) {
          let target = null;
          for (let node = start; node && node !== root; node = node.parentNode) {
            if (blocksAuroraEffect(node)) return null;
            if (!target && isAuroraEffectTarget(node)) target = node;
          }
          return target;
        }

        function isExcludedAuroraEffectTarget(target) {
          if (!target) return true;
          if (target.disabled || target.getAttribute('aria-disabled') === 'true' || nodeHasClass(target, 'danger')) return true;
          return String(target.tagName || '').toUpperCase() === 'SUMMARY' &&
            nodeHasClass(target.parentNode, 'secondary-actions');
        }

        function hasRunningAuroraEffectInRegion(target) {
          const runningEffects = document.querySelectorAll('.aurora-effect-run');
          for (const running of runningEffects) {
            if (running !== target && (nodeContains(running, target) || nodeContains(target, running))) return true;
          }
          return false;
        }

        function auroraInteractionEnabled() {
          if (currentAppearance.family !== 'aurora' || effectiveMotion() === 'off') return false;
          try {
            return !(Storage.isEncrypted && Storage.isEncrypted()) ||
              typeof Storage.hasSessionPassword !== 'function' || Storage.hasSessionPassword();
          } catch (e) {
            return false;
          }
        }

        function scheduleAppearanceEffect(callback, delay) {
          let timer = null;
          timer = setTimeout(function () {
            appearanceTimers.delete(timer);
            callback();
          }, delay);
          appearanceTimers.add(timer);
          return timer;
        }

        function stopAppearanceEffects() {
          appearanceTimers.forEach(function (timer) { clearTimeout(timer); });
          appearanceTimers.clear();
          document.querySelectorAll('.motion-demo, .motion-tile-run, .aurora-effect-run, .aurora-ambient-run').forEach(function (element) {
            element.classList.remove('motion-demo', 'motion-tile-run', 'aurora-effect-run', 'aurora-ambient-run');
          });
        }

        function runAuroraEffect(target) {
          if (!auroraInteractionEnabled() || isExcludedAuroraEffectTarget(target) ||
              nodeHasClass(target, 'aurora-effect-run') || hasRunningAuroraEffectInRegion(target)) return false;
          target.classList.add('aurora-effect-run');
          scheduleAppearanceEffect(function () {
            target.classList.remove('aurora-effect-run');
          }, currentAppearance.motion === 'vivid' ? 1050 : 760);
          return true;
        }

        function handleAuroraPointerOver(event) {
          const target = findAuroraEffectTarget(event && event.target);
          if (target && !nodeContains(target, event.relatedTarget)) runAuroraEffect(target);
        }

        function handleAuroraFocusIn(event) {
          runAuroraEffect(findAuroraEffectTarget(event && event.target));
        }

        function replaceAuroraInteractionListeners() {
          root.addEventListener('pointerover', handleAuroraPointerOver);
          root.addEventListener('focusin', handleAuroraFocusIn);
          const previousCleanup = _activeAuroraInteractionCleanup;
          _activeAuroraInteractionCleanup = function () {
            root.removeEventListener('pointerover', handleAuroraPointerOver);
            root.removeEventListener('focusin', handleAuroraFocusIn);
          };
          if (previousCleanup) {
            try { previousCleanup(); } catch (e) {}
          }
        }

        function resolvedAppearance() {
          return currentAppearance.appearance === 'system'
            ? (systemColorScheme && systemColorScheme.matches ? 'dark' : 'light')
            : currentAppearance.appearance;
        }

        function applyTheme() {
          currentTheme = resolvedAppearance();
          document.body.classList.toggle("theme-dark", currentTheme === "dark");
          document.body.setAttribute('data-design-family', currentAppearance.family);
          document.body.setAttribute('data-appearance', currentAppearance.appearance);
          document.body.setAttribute('data-accent', currentAppearance.accent);
          document.body.setAttribute('data-background', currentAppearance.background);
          document.body.setAttribute('data-motion', currentAppearance.motion);
          document.body.setAttribute('data-effective-motion', effectiveMotion());
          if (dashboardMount && typeof dashboardMount.updateAppearance === 'function') {
            dashboardMount.updateAppearance({
              family: currentAppearance.family,
              appearance: currentTheme,
              accent: currentAppearance.accent,
              background: currentAppearance.background,
              motion: effectiveMotion()
            });
          }
          document.querySelectorAll('.gradesheet-avg').forEach(function (cell) {
            if (cell.style && cell.style.backgroundColor) cell.style.color = '#050505';
          });
          syncAppearanceControls();
        }

        function syncAppearanceControls() {
          if (appearanceControlElements) {
            appearanceControlElements.appearance.value = currentAppearance.appearance;
            appearanceControlElements.motion.value = currentAppearance.motion;
            appearanceControlElements.families.forEach(function (button) {
              button.setAttribute('aria-pressed', String(button.getAttribute('data-family-choice') === currentAppearance.family));
            });
            appearanceControlElements.accents.forEach(function (button) {
              const selected = button.getAttribute('data-accent-choice') === currentAppearance.accent;
              button.setAttribute('aria-checked', String(selected));
              button.setAttribute('tabindex', selected ? '0' : '-1');
            });
            appearanceControlElements.backgrounds.forEach(function (button) {
              const selected = button.getAttribute('data-background-choice') === currentAppearance.background;
              button.setAttribute('aria-checked', String(selected));
              button.setAttribute('tabindex', selected ? '0' : '-1');
            });
            appearanceControlElements.motion.disabled = currentAppearance.family === 'classic';
            appearanceControlElements.preview.disabled = currentAppearance.family === 'classic';
            appearanceControlElements.note.textContent = systemReducedMotion && systemReducedMotion.matches
              ? 'Die Systemeinstellung reduziert Bewegung; Effekte bleiben ausgeschaltet.'
              : currentAppearance.family === 'classic'
                ? 'Klassisch bleibt ruhig. Die gewählte Bewegungsstufe gilt für Modern und Aurora.'
                : currentAppearance.motion === 'off'
                  ? 'Ohne Bewegung: Alle Inhalte und Kursinformationen bleiben erreichbar.'
                  : 'Effekte laufen nur kurz nach einer direkten Interaktion.';
          }
        }

        function storeAppearance() {
          try {
            localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(currentAppearance));
            return true;
          } catch (e) {
            return false;
          }
        }

        function setAppearance(patch, feedback) {
          stopAppearanceEffects();
          currentAppearance = normalizeAppearance({ ...currentAppearance, ...patch });
          applyTheme();
          const stored = storeAppearance();
          const targetFeedback = feedback || appearanceFeedbackElement;
          if (targetFeedback) targetFeedback.textContent = stored
            ? 'Darstellung lokal gespeichert.'
            : 'Darstellung geändert, konnte aber lokal nicht gespeichert werden.';
        }

        function runAppearanceDemo() {
          if (effectiveMotion() === 'off' || !appearanceControlElements) return false;
          const sample = appearanceControlElements.preview;
          if (dashboardMount && typeof dashboardMount.previewMotion === 'function') dashboardMount.previewMotion();
          sample.classList.add('motion-demo');
          if (currentAppearance.family === 'aurora') {
            runAuroraEffect(sample);
            const sidebar = document.querySelector('.app-sidebar');
            if (sidebar && currentAppearance.motion === 'vivid') sidebar.classList.add('aurora-ambient-run');
          }
          scheduleAppearanceEffect(function () {
            sample.classList.remove('motion-demo');
            const sidebar = document.querySelector('.app-sidebar');
            if (sidebar) sidebar.classList.remove('aurora-ambient-run');
          }, currentAppearance.motion === 'vivid' ? 1500 : 850);
          return true;
        }

        const updateSystemAppearance = function () {
          if (currentAppearance.appearance === 'system') applyTheme();
        };
        const updateSystemMotion = function () {
          stopAppearanceEffects();
          applyTheme();
        };

        applyTheme();

        let currentSection = (typeof encryptionRequired !== 'undefined' && encryptionRequired) ? "settings" : "dashboard"; // "dashboard", "courses", "gradesheet", "stats", "settings", "import", "exam"
        let currentCourseId = DomainModel.listActiveCourses(state)[0]?.id || null;
        let gradesheetView = 'entry';
        let courseEditorOpenForId = null;
        let courseEditorActiveTab = 'general';
        let courseEditorTabCourseId = null;
        let settingsActiveArea = 'periods';
        let schoolProfileDraft = null;
        let schoolProfileDraftBase = '';
        let schoolLogoReadId = 0;
        const pendingStatePersistencePromises = new Set();
        const pendingUiPersistencePromises = new Set();
        let captureObservation = null;
        let captureBusy = false;
        let captureUiEpoch = null;
        let captureFrozenControls = [];
        let captureFrozenControlSet = new Set();
        let captureControlObserver = null;
        let captureControlToken = 0;
        let backupInProgress = false;
        let manualLock = null;
        let pendingLockNotice = false;
        let privacyLockOverlay = null;
        let diagnosticSaveFailed = false;
        let uiStateEpoch = 0;
        let settingsActiveStage = 'seckI';
        let settingsPeriodDrafts = null;
        let activeGradesheetEditorUnregisters = [];
        let focusTargetHeading = false;
        let navigationMenuOpen = false;
        let navigationMenuElement = null;
        let navigationMenuToggle = null;
        let pendingGradesheetNavigation = null;
        let lastNavigationFocusTarget = null;

        function setNavigationMenuOpen(open, returnFocus) {
          navigationMenuOpen = !!open;
          if (navigationMenuElement) navigationMenuElement.classList.toggle('is-mobile-open', navigationMenuOpen);
          if (navigationMenuToggle) {
            navigationMenuToggle.setAttribute('aria-expanded', navigationMenuOpen ? 'true' : 'false');
            navigationMenuToggle.textContent = navigationMenuOpen ? 'Navigation schließen' : 'Navigation öffnen';
          }
          if (!navigationMenuOpen && returnFocus && navigationMenuToggle && navigationMenuToggle.isConnected !== false) {
            navigationMenuToggle.focus();
          }
        }

        function closeNavigationMenu() {
          setNavigationMenuOpen(false, false);
        }

        function activeNavigationButton() {
          if (!navigationMenuElement) return null;
          return Array.from(navigationMenuElement.querySelectorAll('button')).find(function (button) {
            return button.getAttribute('aria-current') === 'page';
          }) || null;
        }

        function focusIsInNavigation() {
          const activeElement = document.activeElement;
          return !!(navigationMenuElement && activeElement && typeof activeElement.closest === 'function' &&
            activeElement.closest('nav') === navigationMenuElement);
        }

        function focusWasLostFromNavigation() {
          return document.activeElement === document.body && !!lastNavigationFocusTarget;
        }

        function isMobileNavigationViewport() {
          if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 760px)').matches;
          return typeof window.innerWidth === 'number' && window.innerWidth <= 760;
        }

        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && navigationMenuOpen) {
            event.preventDefault();
            setNavigationMenuOpen(false, true);
          }
        });
        document.addEventListener('focusin', function (event) {
          const target = event.target;
          if (target === navigationMenuToggle || (navigationMenuElement && target && typeof target.closest === 'function' &&
              target.closest('nav') === navigationMenuElement)) {
            lastNavigationFocusTarget = target;
          }
        });
        window.addEventListener('resize', function () {
          if (isMobileNavigationViewport()) {
            if (!navigationMenuOpen && (focusIsInNavigation() || focusWasLostFromNavigation()) && navigationMenuToggle) navigationMenuToggle.focus();
            return;
          }
          const wasToggleFocused = document.activeElement === navigationMenuToggle ||
            (focusWasLostFromNavigation() && lastNavigationFocusTarget === navigationMenuToggle);
          closeNavigationMenu();
          if (wasToggleFocused) {
            const activeButton = activeNavigationButton();
            if (activeButton) activeButton.focus();
          }
        });

        function disposeDashboard() {
          if (dashboardMount) dashboardMount.dispose();
          dashboardMount = null;
        }

        function dashboardIsAllowed() {
          return !encryptionRequired && Storage.hasSessionPassword();
        }

        function resolveActiveCourseById(courseId) {
          if (typeof courseId !== 'string' || courseId.trim() === '') return null;
          const matches = DomainModel.listActiveCourses(state).filter(function (course) {
            return course.id === courseId;
          });
          return matches.length === 1 ? matches[0] : null;
        }

        function requireActiveCourse(candidate, courseId) {
          const matches = DomainModel.listActiveCourses(candidate).filter(function (course) {
            return course && course.id === courseId;
          });
          if (matches.length !== 1) throw new Error('Der ausgewählte aktive Kurs ist nicht mehr verfügbar.');
          return matches[0];
        }

        function requireStudent(candidate, studentId) {
          const matches = (Array.isArray(candidate && candidate.students) ? candidate.students : [])
            .filter(function (student) { return student && student.id === studentId; });
          if (matches.length !== 1) throw new Error('Die ausgewählte Person ist nicht mehr verfügbar.');
          return matches[0];
        }

        function requireAssessment(candidate, assessmentId) {
          const matches = (Array.isArray(candidate && candidate.assessments) ? candidate.assessments : [])
            .filter(function (assessment) { return assessment && assessment.id === assessmentId; });
          if (matches.length !== 1) throw new Error('Die ausgewählte Leistung ist nicht mehr verfügbar.');
          return matches[0];
        }

        let lastGradesheetVisitSave = null;
        let lastRenderedGradesheetCourseId = null;
        function recordGradesheetVisit(courseId) {
          if (!dashboardIsAllowed()) return false;
          const course = resolveActiveCourseById(courseId);
          if (!course) return false;
          lastRenderedGradesheetCourseId = course.id;
          const previousAttempt = lastGradesheetVisitSave;
          const sameCourseAttempt = previousAttempt && previousAttempt.courseId === course.id;
          const pendingSameVisit = sameCourseAttempt && !previousAttempt.settled;
          const pendingDifferentVisit = previousAttempt && !previousAttempt.settled && !sameCourseAttempt;
          const retryFailedVisit = sameCourseAttempt && previousAttempt.settled && previousAttempt.failed;
          if (pendingSameVisit) return false;
          if (state.lastGradesheetCourseId === course.id && !retryFailedVisit && !pendingDifferentVisit) {
            return false;
          }
          const attempt = { courseId: course.id, failed: false, settled: false };
          lastGradesheetVisitSave = attempt;
          function markVisitSaveFailed() {
            if (lastGradesheetVisitSave === attempt) attempt.failed = true;
            try { console.error('Die Fortsetzen-Information konnte nicht gespeichert werden.'); } catch (e) {}
          }
          commitStateChange(function (candidate) {
            const candidateCourse = requireActiveCourse(candidate, course.id);
            candidate.lastGradesheetCourseId = candidateCourse.id;
          }, { render: false }).catch(markVisitSaveFailed).finally(function () {
            attempt.settled = true;
          });
          return true;
        }
        const dashboardTransition = createDashboardTransition({
          isAllowed: function () {
            return dashboardIsAllowed();
          },
          onReady: function () {
            if (!dashboardIsAllowed()) return;
            const navigation = pendingGradesheetNavigation;
            if (navigation && Object.prototype.hasOwnProperty.call(navigation, 'courseId')) {
              currentCourseId = navigation.courseId;
            }
            currentSection = navigation ? navigation.sectionId : 'dashboard';
            gradesheetView = navigation && navigation.sectionId === 'gradesheet' && navigation.gradesheetView === 'year'
              ? 'year'
              : 'entry';
            pendingGradesheetNavigation = null;
            focusTargetHeading = true;
            closeNavigationMenu();
            render();
          },
          onFailure: function (error) {
            try { console.error('Noteneingabe konnte nicht abgeschlossen werden:', error); } catch (e) {}
          }
        });
        function stopMutationDuringCapture(event) {
          if (!captureBusy) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        }

        const captureMutationEvents = ['click', 'change', 'input', 'keydown', 'beforeinput', 'paste', 'cut', 'drop', 'compositionstart'];
        const readOnlyInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

        function freezeCaptureControls() {
          for (const control of root.querySelectorAll('input, textarea, select, [contenteditable]')) {
            if (captureFrozenControlSet.has(control)) continue;
            captureFrozenControlSet.add(control);
            if (control.tagName === 'TEXTAREA' ||
                (control.tagName === 'INPUT' && readOnlyInputTypes.has(String(control.type || 'text').toLowerCase()))) {
              captureFrozenControls.push({ control, property: 'readOnly', previous: !!control.readOnly });
              control.readOnly = true;
            } else if (control.tagName === 'INPUT' || control.tagName === 'SELECT') {
              captureFrozenControls.push({ control, property: 'disabled', previous: !!control.disabled });
              control.disabled = true;
            } else {
              captureFrozenControls.push({ control, property: 'contenteditable', previous: control.getAttribute('contenteditable') });
              control.setAttribute('contenteditable', 'false');
            }
          }
        }

        function restoreCaptureControls(frozen) {
          for (const record of frozen) {
            const { control, property, previous } = record;
            if (property === 'contenteditable') {
              if (previous === null) control.removeAttribute('contenteditable');
              else control.setAttribute('contenteditable', previous);
            } else {
              control[property] = previous;
            }
            if (record.desiredDisabled !== undefined) control.disabled = record.desiredDisabled;
          }
        }

        function setSchoolProfileControlDisabled(control, disabled) {
          const desiredDisabled = !!disabled;
          const frozen = captureBusy && captureFrozenControls.find(record => record.control === control);
          if (frozen) {
            frozen.desiredDisabled = desiredDisabled;
            control.disabled = true;
          } else {
            control.disabled = desiredDisabled;
          }
        }

        function observeForCapture(promise) {
          const observation = captureObservation;
          if (!observation) return;
          const settled = Promise.resolve(promise).then(
            function () {},
            function () { observation.failed = true; }
          );
          observation.pending.add(settled);
        }

        const persistenceBoundary = createPersistenceBoundary({
          listEditors: function () { return dashboardTransition.listEditors(); },
          isCurrent: function () {
            return dashboardIsAllowed() && sessionCoordinator.getStatus() === 'held' &&
              (captureUiEpoch === null || captureUiEpoch === uiStateEpoch);
          },
          drain: async function () {
            const observation = captureObservation;
            await enqueueStatePersistenceTransaction(function () {});
            let flushFailure = null;
            try { await Storage.flushPendingWrites(); } catch (error) { flushFailure = error; }
            if (observation) await Promise.all(Array.from(observation.pending));
            if (flushFailure || (observation && observation.failed) || diagnosticSaveFailed) {
              throw flushFailure || new Error('Ein Speichervorgang ist fehlgeschlagen.');
            }
          },
          readState: function () { return state; },
          setBusy: function (busy) {
            if (busy) {
              const controlToken = ++captureControlToken;
              captureUiEpoch = uiStateEpoch;
              captureObservation = { failed: false, pending: new Set() };
              for (const pending of pendingUiPersistencePromises) observeForCapture(pending);
              for (const pending of pendingStatePersistencePromises) observeForCapture(pending);
              freezeCaptureControls();
              captureBusy = true;
              root.setAttribute('aria-busy', 'true');
              for (const type of captureMutationEvents) {
                root.addEventListener(type, stopMutationDuringCapture, true);
              }
              if (typeof MutationObserver !== 'undefined') {
                captureControlObserver = new MutationObserver(function () {
                  if (captureBusy && captureControlToken === controlToken) freezeCaptureControls();
                });
                captureControlObserver.observe(root, { childList: true, subtree: true });
              }
            } else {
              captureControlToken += 1;
              if (captureControlObserver) captureControlObserver.disconnect();
              captureControlObserver = null;
              const restoreControls = captureUiEpoch === uiStateEpoch &&
                dashboardIsAllowed() && sessionCoordinator.getStatus() === 'held';
              const frozen = captureFrozenControls;
              captureFrozenControls = [];
              captureFrozenControlSet = new Set();
              if (restoreControls) restoreCaptureControls(frozen);
              captureBusy = false;
              captureUiEpoch = null;
              captureObservation = null;
              root.removeAttribute('aria-busy');
              for (const type of captureMutationEvents) {
                root.removeEventListener(type, stopMutationDuringCapture, true);
              }
            }
          }
        });
        function hasUnsavedInput() {
          if (manualLock && !manualLock.ending) return true;
          if (captureBusy || pendingUiPersistencePromises.size || pendingStatePersistencePromises.size || diagnosticSaveFailed) return true;
          try {
            return dashboardTransition.listEditors().some(editor =>
              typeof editor.isClean === 'function' && !editor.isClean());
          } catch (error) { return true; }
        }

        function maskPrivateRoot() {
          root.hidden = true;
          root.inert = true;
          // Dialogs and reports can be direct body children rather than root
          // descendants. Mask them during a manual flush as well.
          for (const node of Array.from(document.body.children)) {
            if (node !== root && node !== privacyLockOverlay && node.tagName !== 'SCRIPT') {
              node.hidden = true;
              node.inert = true;
            }
          }
          document.title = 'Notenverwaltung · Version ' + APP_RELEASE.version;
        }

        function clearPrivateBodyOverlays() {
          for (const node of Array.from(document.body.children)) {
            if (node !== root && node !== privacyLockOverlay && node.tagName !== 'SCRIPT') {
              try {
                if (typeof node.__closeForSessionLock === 'function') node.__closeForSessionLock();
                else document.body.removeChild(node);
              } catch (error) {
                try { document.body.removeChild(node); } catch (removeError) {}
              }
            }
          }
        }

        function removePrivacyLockOverlay() {
          if (privacyLockOverlay && privacyLockOverlay.parentNode) privacyLockOverlay.parentNode.removeChild(privacyLockOverlay);
          privacyLockOverlay = null;
        }

        function finishManualLock(record, lost) {
          if (manualLock !== record || record.ending) return record.release || Promise.resolve();
          record.ending = true;
          if (record.watchdog !== null) clearTimeout(record.watchdog);
          pendingLockNotice = !!lost;
          maskPrivateRoot();
          if (privacyLockOverlay) {
            const focused = privacyLockOverlay.querySelector('button');
            if (focused) try { focused.focus(); } catch (error) {}
          }
          // lockSession clears the generation synchronously; release settles only
          // after the native exclusive request has actually ended.
          record.release = Promise.resolve(Storage.lockSession());
          return record.release;
        }

        function startManualLock() {
          if (manualLock) return manualLock.promise;
          if (sessionCoordinator.getStatus() !== 'held' || !Storage.hasSessionPassword()) return Promise.resolve();
          const overlay = document.createElement('section');
          overlay.className = 'privacy-lock-overlay';
          overlay.setAttribute('role', 'dialog');
          overlay.setAttribute('aria-modal', 'true');
          overlay.setAttribute('aria-labelledby', 'privacy-lock-title');
          const card = document.createElement('div');
          card.className = 'lock-card';
          const title = document.createElement('h1');
          title.id = 'privacy-lock-title';
          title.textContent = 'Sperren läuft – Eingaben werden gespeichert.';
          const discard = document.createElement('button');
          discard.type = 'button';
          discard.className = 'lock-card__secondary';
          discard.textContent = 'Sofort sperren und ungespeicherte Eingaben verwerfen';
          card.appendChild(title);
          card.appendChild(discard);
          overlay.appendChild(card);
          document.body.appendChild(overlay);
          privacyLockOverlay = overlay;
          maskPrivateRoot();
          try { discard.focus(); } catch (error) {}
          const record = { ending: false, watchdog: null, release: null, promise: null };
          manualLock = record;
          discard.addEventListener('click', function () { return finishManualLock(record, true); });
          record.watchdog = setTimeout(function () { finishManualLock(record, true); }, 30000);
          record.promise = Promise.resolve(persistenceBoundary.capture()).then(
            result => finishManualLock(record, !result.ok),
            () => finishManualLock(record, true)
          );
          return record.promise;
        }
        const gradesheetTransition = {
          register: function (editor) {
            const unregister = dashboardTransition.register(editor);
            activeGradesheetEditorUnregisters.push(unregister);
            return function () {
              const index = activeGradesheetEditorUnregisters.indexOf(unregister);
              if (index >= 0) activeGradesheetEditorUnregisters.splice(index, 1);
              unregister();
            };
          }
        };

        function clearActiveGradesheetEditors() {
          for (const unregister of activeGradesheetEditorUnregisters.splice(0)) unregister();
        }

        function invalidateUiStateEpoch() {
          uiStateEpoch += 1;
          persistenceBoundary.invalidate();
          lastGradesheetVisitSave = null;
          lastRenderedGradesheetCourseId = null;
          return uiStateEpoch;
        }

        function persistTrackedState(candidate) {
          const pendingSave = Storage.saveState(candidate);
          pendingStatePersistencePromises.add(pendingSave);
          observeForCapture(pendingSave);
          pendingSave.then(
            function () { pendingStatePersistencePromises.delete(pendingSave); },
            function () { pendingStatePersistencePromises.delete(pendingSave); }
          );
          return pendingSave;
        }

        const stateCommitter = createStateCommitter({
          readState: function () { return state; },
          persistState: persistTrackedState,
          publishState: function (candidate) {
            state = candidate;
          },
          enqueue: enqueueStatePersistenceTransaction,
          readEpoch: function () { return uiStateEpoch; }
        });

        function commitStateChange(change, options = {}) {
          const shouldRender = options.render !== false;
          const editorTabToRestore = shouldRender && currentSection === 'courses' &&
            courseEditorOpenForId === currentCourseId
            ? { courseId: currentCourseId, tab: courseEditorActiveTab }
            : null;
          const pendingCommit = stateCommitter.commit(change).then(function (candidate) {
            if (!shouldRender) return candidate;
            const restoreEditorFocus = editorTabToRestore && currentSection === 'courses' &&
              currentCourseId === editorTabToRestore.courseId &&
              courseEditorOpenForId === editorTabToRestore.courseId;
            const activeEditorTabToRestore = restoreEditorFocus ? courseEditorActiveTab : null;
            render();
            if (restoreEditorFocus) {
              const editor = document.querySelector('.courses-editor');
              const tab = editor && Array.prototype.find.call(editor.querySelectorAll('button'), function (item) {
                return item.getAttribute('data-course-editor-tab') === activeEditorTabToRestore &&
                  item.getAttribute('aria-selected') === 'true';
              });
              if (tab && typeof tab.focus === 'function') tab.focus();
            }
            return candidate;
          });
          pendingUiPersistencePromises.add(pendingCommit);
          observeForCapture(pendingCommit);
          pendingCommit.then(
            function () { pendingUiPersistencePromises.delete(pendingCommit); },
            function () { pendingUiPersistencePromises.delete(pendingCommit); }
          );
          return pendingCommit;
        }

        function isStateCommitAborted(error) {
          return !!error && error.code === 'STATE_COMMIT_ABORTED';
        }

        function createStateCommitAbortedError() {
          const error = new Error('Die Zustandsänderung wurde verworfen, weil sich der aktive Bestand geändert hat.');
          error.name = 'StateCommitAbortedError';
          error.code = 'STATE_COMMIT_ABORTED';
          return error;
        }

        function runExclusiveStateOperation(operation) {
          const operationEpoch = invalidateUiStateEpoch();
          return enqueueStatePersistenceTransaction(async function () {
            if (uiStateEpoch !== operationEpoch) throw createStateCommitAbortedError();
            return operation(operationEpoch);
          });
        }

        async function reconcileExclusiveState(operationEpoch) {
          if (uiStateEpoch !== operationEpoch || !Storage.hasSessionPassword() ||
              typeof Storage.loadCurrentSessionState !== 'function') return false;
          const persisted = await Storage.loadCurrentSessionState();
          if (uiStateEpoch !== operationEpoch || !Storage.hasSessionPassword()) return false;
          state = persisted;
          currentCourseId = DomainModel.listActiveCourses(state)[0]?.id || null;
          render();
          return true;
        }

        function overwriteStateObject(target, source) {
          for (const key of Object.keys(target)) delete target[key];
          Object.assign(target, source);
          return target;
        }

        async function onStateChange(newState) {
          const editorTabToRestore = currentSection === 'courses' &&
            courseEditorOpenForId === currentCourseId
            ? { courseId: currentCourseId, tab: courseEditorActiveTab }
            : null;
          await persistTrackedState(newState);
          state = newState;
          render();
          if (editorTabToRestore && currentSection === 'courses' &&
            currentCourseId === editorTabToRestore.courseId &&
            courseEditorOpenForId === editorTabToRestore.courseId) {
            const editor = document.querySelector('.courses-editor');
            const tab = editor && Array.prototype.find.call(editor.querySelectorAll('button'), function (candidate) {
              return candidate.getAttribute('data-course-editor-tab') === courseEditorActiveTab &&
                candidate.getAttribute('aria-selected') === 'true';
            });
            if (tab && typeof tab.focus === 'function') tab.focus();
          }
        }

        function persistDiagnosticState() {
          const pending = onStateChange(state);
          pending.then(
            function () { diagnosticSaveFailed = false; },
            function (error) {
              diagnosticSaveFailed = true;
              try { console.error('Synthetischer Zustand konnte nicht gespeichert werden:', error); } catch (e) {}
            }
          );
          return pending;
        }

        function setSection(sectionId) {
          if (typeof encryptionRequired !== 'undefined' && encryptionRequired && sectionId !== 'settings') {
            try { window.alert('Verschlüsselung ist erforderlich. Bitte zuerst in den Einstellungen ein Passwort festlegen.'); } catch (e) {}
            currentSection = 'settings';
            render();
            return;
          }
          focusTargetHeading = true;
          if (sectionId !== currentSection) {
            courseEditorActiveTab = 'general';
            courseEditorTabCourseId = null;
          }
          currentSection = sectionId;
          if (sectionId !== 'gradesheet') gradesheetView = 'entry';
          closeNavigationMenu();
          render();
        }

        function requestGradesheetNavigation(sectionId) {
          if (currentSection !== 'gradesheet') {
            setSection(sectionId);
            return;
          }
          const navigation = { sectionId: sectionId };
          pendingGradesheetNavigation = navigation;
          dashboardTransition.request().then(function (completed) {
            if (!completed && pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
          }).catch(function (error) {
            if (pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
            try { console.error('Navigation konnte nicht abgeschlossen werden:', error); } catch (e) {}
          });
        }

        function setCurrentCourse(courseId) {
          const nextCourseId = courseId || null;
          if (nextCourseId === currentCourseId) return Promise.resolve(true);
          if (currentSection !== 'gradesheet') {
            currentCourseId = nextCourseId;
            gradesheetView = 'entry';
            if (currentSection === 'courses') {
              courseEditorOpenForId = null;
              courseEditorActiveTab = 'general';
              courseEditorTabCourseId = null;
            }
            render();
            return Promise.resolve(true);
          }
          const navigation = { sectionId: 'gradesheet', courseId: nextCourseId };
          pendingGradesheetNavigation = navigation;
          return dashboardTransition.request().then(function (completed) {
            if (!completed && pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
            return completed;
          }).catch(function (error) {
            if (pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
            try { console.error('Kurswechsel konnte nicht abgeschlossen werden:', error); } catch (e) {}
            return false;
          });
        }

        function requestGradesheetAnnualView() {
          if (currentSection !== 'gradesheet') return Promise.resolve(false);
          const navigation = { sectionId: 'gradesheet', courseId: currentCourseId, gradesheetView: 'year' };
          pendingGradesheetNavigation = navigation;
          return dashboardTransition.request().then(function (completed) {
            if (!completed && pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
            return completed;
          }).catch(function (error) {
            if (pendingGradesheetNavigation === navigation) pendingGradesheetNavigation = null;
            try { console.error('Jahresansicht konnte nicht geöffnet werden:', error); } catch (e) {}
            return false;
          });
        }

        function ensureInitialDemoData(st) {
          if (st.students.length === 0 && st.courses.length === 0) {
            const s1 = DomainModel.createStudent({
              lastName: "Muster",
              firstName: "Max",
              birthDate: "2010-05-01",
              homeClass: "10c"
            });
            const s2 = DomainModel.createStudent({
              lastName: "Beispiel",
              firstName: "Eva",
              birthDate: "2010-09-15",
              homeClass: "10c"
            });

            DomainModel.addStudentToState(st, s1);
            DomainModel.addStudentToState(st, s2);

            const wtId = st.settings.weightTemplates[0]
              ? st.settings.weightTemplates[0].id
              : null;

            const course = DomainModel.createCourse({
              name: "10c Biologie",
              subject: "Biologie",
              classLabel: "10c",
              schemaMode: DomainModel.SCHEMA_MODES.GRADES,
              weightTemplateId: wtId
            });

            DomainModel.addCourseToState(st, course);
            DomainModel.enrollStudentInCourse(st, course.id, s1.id);
            DomainModel.enrollStudentInCourse(st, course.id, s2.id);

            const catMdl = st.settings.categories.find(c => c.name === "Mündlich") || st.settings.categories[0];
            const catSchr = st.settings.categories.find(c => c.name === "Schriftlich") || st.settings.categories[1] || st.settings.categories[0];

            const asmM1 = DomainModel.createAssessment({
              courseId: course.id,
              categoryId: catMdl.id,
              title: "M1",
              weight: 1
            });
            const asmS1 = DomainModel.createAssessment({
              courseId: course.id,
              categoryId: catSchr.id,
              title: "S1",
              weight: 1
            });

            asmM1.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: "2" });
            asmM1.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: "3" });

            asmS1.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: "1-" });
            asmS1.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: "2" });

            DomainModel.addAssessmentToState(st, asmM1);
            DomainModel.addAssessmentToState(st, asmS1);
          }
        }

        function createUiIcon(name) {
          const paths = {
            overview: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-7h6v7',
            gradesheet: 'M4 4h16v16H4zM8 4v16M4 9h16M4 14h16',
            courses: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
            students: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
            stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
            settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-3v-.79a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.55-1H4v-3h1.05A1.7 1.7 0 0 0 6.6 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4h3v.79a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.55 1H22v3h-1.05a1.7 1.7 0 0 0-1.55 1z',
            transfer: 'M7 7h11l-3-3M18 7l-3 3M17 17H6l3 3M6 17l3-3',
            calculator: 'M5 3h14v18H5zM8 6h8v4H8zM8 14h1M12 14h1M16 14h1M8 18h1M12 18h1M16 18h1',
            palette: 'M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2C18.5 13.5 21 11.7 21 9C21 5.7 17.2 3 12 3zM7.5 10h.01M9.5 6.5h.01M14.5 6.5h.01M17 10h.01',
            download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
            lock: 'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3'
          };
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          svg.setAttribute('class', 'ui-icon');
          svg.setAttribute('width', '18');
          svg.setAttribute('height', '18');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', paths[name] || paths.overview);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', 'currentColor');
          path.setAttribute('stroke-width', '1.8');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(path);
          return svg;
        }

        function renderHeader(container) {
          const header = document.createElement('header');
          header.className = 'app-header';
          const menuToggle = document.createElement('button');
          menuToggle.type = 'button';
          menuToggle.className = 'nav-menu-toggle';
          menuToggle.setAttribute('aria-controls', 'main-navigation');
          menuToggle.addEventListener('click', function () {
            setNavigationMenuOpen(!navigationMenuOpen, false);
          });
          navigationMenuToggle = menuToggle;
          setNavigationMenuOpen(navigationMenuOpen, false);


          const ctrlBox = document.createElement('div');
          ctrlBox.className = 'app-header-controls';
          const activeCoursesForHeader = DomainModel.listActiveCourses(state);
          if (activeCoursesForHeader.length > 0) {
            const courseWrapper = document.createElement("div");
            courseWrapper.className = "course-select-wrapper";
            if (currentSection === 'courses') courseWrapper.classList.add('course-select-wrapper--quiet');

            const label = document.createElement("label");
            label.textContent = "Aktueller Kurs";
            label.setAttribute("for", "current-course-select");

            const select = document.createElement("select");
            select.id = "current-course-select";
            for (const c of activeCoursesForHeader) {
              const opt = document.createElement("option");
              opt.value = c.id;
              opt.textContent = (c.name || "Unbenannter Kurs") + " · " +
                (c.classLabel || "Klasse nicht angegeben");
              if (c.id === currentCourseId) {
                opt.selected = true;
              }
              select.appendChild(opt);
            }
            select.addEventListener("change", function () {
              const courseSelect = this;
              const nextCourseId = courseSelect.value;
              setCurrentCourse(nextCourseId).then(function (completed) {
                if (!completed) courseSelect.value = currentCourseId || '';
              });
            });

            courseWrapper.appendChild(label);
            courseWrapper.appendChild(select);
            ctrlBox.appendChild(courseWrapper);
          } else {
            const noCourse = document.createElement("span");
            noCourse.className = "text-muted";
            noCourse.textContent = "Noch keine Kurse vorhanden.";
            ctrlBox.appendChild(noCourse);
          }

          // Backup-Button (Verschlüsselter Export mit Session-Passwort)
          const backupBtn = document.createElement("button");
          backupBtn.className = 'header-action header-action-primary';
          backupBtn.appendChild(createUiIcon('download'));
          const backupLabel = document.createElement('span');
          backupLabel.textContent = 'Backup';
          backupBtn.appendChild(backupLabel);
          backupBtn.title = "Verschlüsseltes Backup als Datei herunterladen";
          backupBtn.style.fontWeight = "600";
          backupBtn.addEventListener("click", async function() {
            if (backupInProgress) return;
            backupInProgress = true;
            const backupEpoch = uiStateEpoch;
            try {
              const captured = await persistenceBoundary.capture();
              if (!captured.ok) {
                if (captured.reason === 'save-failed') {
                  window.alert('Backup nicht erstellt: Eine Eingabe konnte nicht gespeichert werden. Bitte prüfen und erneut versuchen.');
                }
                return;
              }
              const payload = await Storage.encryptForBackup(JSON.stringify(captured.snapshot, null, 2));
              if (uiStateEpoch !== backupEpoch || !dashboardIsAllowed() ||
                  sessionCoordinator.getStatus() !== 'held') return;

              const timestamp = formatUtcFileTimestamp(new Date());
              downloadBlobFile(
                payload,
                "text/json;charset=utf-8",
                `notenverwaltung_backup_${timestamp}.enc.json`
              );

              window.alert('Backup-Download gestartet. Bitte Datei im Downloadordner prüfen.');
            } catch (err) {
              window.alert('Fehler beim Erstellen des Backups: ' + err.message);
            } finally {
              backupInProgress = false;
            }
          });
          ctrlBox.appendChild(backupBtn);

          const lockBtn = document.createElement("button");
          lockBtn.type = "button";
          lockBtn.className = 'header-action header-lock';
          lockBtn.appendChild(createUiIcon('lock'));
          const lockLabel = document.createElement('span');
          lockLabel.textContent = 'Sperren';
          lockBtn.appendChild(lockLabel);
          lockBtn.setAttribute('aria-label', 'Sperren');
          lockBtn.title = 'Eingaben speichern und Sitzung sperren';
          lockBtn.addEventListener('click', startManualLock);
          ctrlBox.appendChild(lockBtn);

          header.appendChild(menuToggle);
          header.appendChild(ctrlBox);
          container.appendChild(header);
        }

        function renderDesignBar(container) {
          const bar = document.createElement('div');
          bar.className = 'design-bar';
          const title = document.createElement('div');
          title.className = 'design-bar-title';
          title.appendChild(createUiIcon('palette'));
          const titleText = document.createElement('span');
          titleText.textContent = 'Design';
          title.appendChild(titleText);
          bar.appendChild(title);

          const familyGroup = document.createElement('div');
          familyGroup.className = 'design-families';
          familyGroup.setAttribute('role', 'group');
          familyGroup.setAttribute('aria-label', 'Designfamilie');
          const families = [
            ['classic', 'Klassisch'], ['modern', 'Modern ruhig'], ['aurora', 'Aurora']
          ].map(function (entry) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('data-family-choice', entry[0]);
            button.textContent = entry[1];
            button.addEventListener('click', function () { setAppearance({ family: entry[0] }); });
            familyGroup.appendChild(button);
            return button;
          });
          bar.appendChild(familyGroup);

          const modeLabel = document.createElement('label');
          modeLabel.className = 'design-mode';
          modeLabel.textContent = 'Darstellung';
          const mode = document.createElement('select');
          mode.id = 'appearance-mode';
          [['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'System']].forEach(function (entry) {
            const option = document.createElement('option');
            option.value = entry[0]; option.textContent = entry[1]; mode.appendChild(option);
          });
          mode.addEventListener('change', function () { setAppearance({ appearance: mode.value }); });
          modeLabel.appendChild(mode);
          bar.appendChild(modeLabel);

          const options = document.createElement('details');
          options.className = 'design-options';
          const summary = document.createElement('summary');
          summary.textContent = 'Farben & Bewegung';
          options.appendChild(summary);
          const optionsBody = document.createElement('div');
          optionsBody.className = 'design-options-body';
          const colors = [['standard', 'Standard des Designs'], ['blue', 'Blau'], ['green', 'Grün'], ['petrol', 'Petrol'], ['violet', 'Violett'], ['amber', 'Bernstein']];
          function colorFieldset(legendText, attribute, key) {
            const fieldset = document.createElement('fieldset');
            fieldset.className = key === 'accent' ? 'design-accents' : 'design-backgrounds';
            const legend = document.createElement('legend');
            legend.textContent = legendText;
            fieldset.appendChild(legend);
            const choices = document.createElement('div');
            choices.className = 'design-color-options';
            choices.setAttribute('role', 'radiogroup');
            choices.setAttribute('aria-label', legendText);
            const buttons = colors.map(function (entry) {
              const button = document.createElement('button');
              button.type = 'button';
              button.setAttribute('role', 'radio');
              button.setAttribute(attribute, entry[0]);
              button.setAttribute('aria-label', entry[1]);
              const swatch = document.createElement('span');
              swatch.className = 'design-swatch';
              swatch.setAttribute('aria-hidden', 'true');
              const label = document.createElement('span');
              label.textContent = entry[1];
              button.appendChild(swatch); button.appendChild(label);
              button.addEventListener('click', function () { setAppearance({ [key]: entry[0] }); });
              button.addEventListener('keydown', function (event) {
                const handledKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
                if (!handledKeys.includes(event.key)) return;
                event.preventDefault();
                const current = buttons.indexOf(button);
                const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
                const nextButton = buttons[next];
                setAppearance({ [key]: nextButton.getAttribute(attribute) });
                nextButton.focus();
              });
              choices.appendChild(button);
              return button;
            });
            fieldset.appendChild(choices);
            optionsBody.appendChild(fieldset);
            return buttons;
          }
          const accents = colorFieldset('Akzentfarbe', 'data-accent-choice', 'accent');
          const backgrounds = colorFieldset('Hintergrundfarbe', 'data-background-choice', 'background');

          const motionBox = document.createElement('div');
          motionBox.className = 'motion-controls';
          const motionLabel = document.createElement('label');
          motionLabel.textContent = 'Bewegung';
          const motion = document.createElement('select');
          motion.id = 'appearance-motion';
          [['off', 'Ohne Bewegung'], ['calm', 'Dezent'], ['vivid', 'Deutlich']].forEach(function (entry) {
            const option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; motion.appendChild(option);
          });
          motion.addEventListener('change', function () { setAppearance({ motion: motion.value }); if (effectiveMotion() !== 'off') runAppearanceDemo(); });
          motionLabel.appendChild(motion);
          const preview = document.createElement('button');
          preview.type = 'button'; preview.className = 'effects-preview'; preview.textContent = 'Effekte testen';
          const note = document.createElement('span');
          note.className = 'motion-note text-muted'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
          preview.addEventListener('click', function () {
            stopAppearanceEffects();
            if (!runAppearanceDemo()) note.textContent = systemReducedMotion && systemReducedMotion.matches
              ? 'Die Systemeinstellung reduziert Bewegung; Effekte bleiben ausgeschaltet.'
              : 'Ohne Bewegung ist kein Effekt aktiv.';
          });
          motionBox.appendChild(motionLabel); motionBox.appendChild(preview); motionBox.appendChild(note);
          optionsBody.appendChild(motionBox);
          options.appendChild(optionsBody);
          bar.appendChild(options);

          const feedback = document.createElement('span');
          feedback.className = 'appearance-feedback text-muted'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
          bar.appendChild(feedback);
          appearanceFeedbackElement = feedback;

          const secondary = document.createElement('details');
          secondary.className = 'secondary-actions';
          const secondarySummary = document.createElement('summary');
          secondarySummary.textContent = 'Datenbestand zurücksetzen';
          const resetBtn = document.createElement('button');
          resetBtn.type = 'button'; resetBtn.textContent = 'Alles zurücksetzen, Achtung!'; resetBtn.className = 'danger';
          resetBtn.addEventListener('click', async function () {
            const confirmReset = window.confirm('Alle Daten werden unwiderruflich gelöscht. Verschlüsselung und bisheriges Passwort bleiben bestehen. Vorher sollte ein Backup gespeichert werden. Fortfahren?');
            if (!confirmReset) return;
            const confirmFinalReset = window.confirm('Letzte Sicherheitsabfrage: Alle Kurse, Personen und Noten jetzt endgültig und unwiderruflich löschen?');
            if (!confirmFinalReset) return;
            try {
              await runExclusiveStateOperation(async function (resetEpoch) {
                try {
                  const fresh = await Storage.resetState();
                  if (uiStateEpoch !== resetEpoch) throw createStateCommitAbortedError();
                  state = fresh;
                  settingsActiveArea = 'periods';
                  settingsActiveStage = 'seckI';
                  settingsPeriodDrafts = null;
                  currentCourseId = DomainModel.listActiveCourses(state)[0]?.id || null;
                  render();
                } catch (error) {
                  await reconcileExclusiveState(resetEpoch);
                  throw error;
                }
              });
            } catch (err) {
              if (!isStateCommitAborted(err)) window.alert('Zurücksetzen fehlgeschlagen. Der bisherige Datenbestand bleibt erhalten. ' + err.message);
            }
          });
          secondary.appendChild(secondarySummary); secondary.appendChild(resetBtn); bar.appendChild(secondary);

          appearanceControlElements = { families, appearance: mode, accents, backgrounds, motion, preview, note };
          syncAppearanceControls();
          container.appendChild(bar);
        }

        function getSchoolProfile() {
          return DomainModel.normalizeSchoolProfile(state.settings.schoolProfile);
        }

        function getSchoolLogoSources() {
          const profile = getSchoolProfile();
          if (profile.logoMode === 'none') return [];
          if (profile.logoMode === 'custom') return [profile.logoDataUrl];
          return ['Logo.png', 'placeholder-logo.svg'];
        }

        function mountSchoolLogo(container, className, sources, name, fallback) {
          if (!sources.length) return;
          const logo = document.createElement('img');
          logo.className = className;
          logo.setAttribute('alt', name ? 'Logo: ' + name : 'Schullogo');
          logo.hidden = true;
          let sourceIndex = 0;
          logo.addEventListener('load', function () {
            logo.hidden = false;
            if (fallback) fallback.hidden = true;
          });
          logo.addEventListener('error', function () {
            logo.hidden = true;
            if (fallback) fallback.hidden = false;
            sourceIndex += 1;
            if (sourceIndex < sources.length) logo.setAttribute('src', sources[sourceIndex]);
          });
          logo.setAttribute('src', sources[0]);
          container.appendChild(logo);
        }

        function buildPrintHeaderHtml(title) {
          const sources = getSchoolLogoSources();
          const name = getSchoolProfile().name;
          const logo = sources.length ? `<img class="print-logo" src="${escapeHtml(sources[0])}"${sources[1] ? ' data-logo-fallback="' + escapeHtml(sources[1]) + '"' : ''} alt="">` : '';
          const school = name ? `<div class="print-school">${escapeHtml(name)}</div>` : '';
          return `<div class="print-header">${logo}<div>${school}<h1>${escapeHtml(title)}</h1></div></div>`;
        }

        function buildPrintHeaderCss() {
          return `
    .print-header {
      display: flex;
      align-items: center;
      gap: 0.8em;
      margin-bottom: 0.3em;
    }
    .print-header h1 { margin: 0; }
    .print-school { font-size: 0.9em; margin-bottom: 0.25em; overflow-wrap: anywhere; }
    .print-logo {
      width: auto;
      height: 46px;
      object-fit: contain;
      flex: 0 0 auto;
    }`;
        }

        function printWhenAssetsReady(printWin) {
          let printed = false;
          let safetyTimeoutId = null;
          const printNow = () => {
            if (printed || printWin.closed) return;
            printed = true;
            printWin.focus();
            printWin.print();
          };
          const schedulePrint = () => setTimeout(printNow, 50);
          const cancelSafetyTimeout = () => {
            if (safetyTimeoutId === null) return;
            clearTimeout(safetyTimeoutId);
            safetyTimeoutId = null;
          };
          const images = Array.from(printWin.document.images || []);
          const tryFallback = image => {
            const fallback = image.getAttribute && image.getAttribute('data-logo-fallback');
            if (!fallback) return false;
            image.removeAttribute('data-logo-fallback');
            image.setAttribute('src', fallback);
            return true;
          };
          for (const image of images) {
            if (image.complete && image.naturalWidth === 0 && !tryFallback(image)) image.style.display = 'none';
          }
          const pendingImages = new Set(images.filter(image => !image.complete));
          if (pendingImages.size === 0) {
            schedulePrint();
            return;
          }
          const settle = (image, failed) => {
            if (!pendingImages.has(image)) {
              if (!failed) image.style.display = '';
              return;
            }
            if (failed) image.style.display = 'none';
            else image.style.display = '';
            pendingImages.delete(image);
            if (pendingImages.size === 0) {
              cancelSafetyTimeout();
              schedulePrint();
            }
          };
          safetyTimeoutId = setTimeout(() => {
            safetyTimeoutId = null;
            for (const image of pendingImages) image.style.display = 'none';
            pendingImages.clear();
            printNow();
          }, 1500);
          for (const image of pendingImages) {
            image.addEventListener('load', () => settle(image, false), { once: true });
            image.addEventListener('error', () => {
              if (pendingImages.has(image) && tryFallback(image)) return;
              settle(image, true);
            });
            if (image.complete) settle(image, image.naturalWidth === 0);
          }
        }

        function renderNav(container) {
          const brand = document.createElement('div');
          brand.className = 'sidebar-brand';
          const logoWrap = document.createElement('div');
          logoWrap.className = 'sidebar-logo-wrap';
          const monogram = document.createElement('span');
          monogram.className = 'sidebar-monogram'; monogram.textContent = 'NV';
          const schoolName = getSchoolProfile().name;
          mountSchoolLogo(logoWrap, 'sidebar-logo', getSchoolLogoSources(), schoolName, monogram);
          logoWrap.appendChild(monogram);
          const brandText = document.createElement('div');
          const product = document.createElement('strong'); product.textContent = 'Notenverwaltung';
          brandText.appendChild(product);
          if (schoolName) {
            const school = document.createElement('small'); school.textContent = schoolName;
            brandText.appendChild(school);
          }
          brand.appendChild(logoWrap); brand.appendChild(brandText); container.appendChild(brand);

          const nav = document.createElement("nav");
          nav.className = "nav-main";
          nav.id = 'main-navigation';
          nav.setAttribute('aria-label', 'Hauptnavigation');
          navigationMenuElement = nav;
          setNavigationMenuOpen(navigationMenuOpen, false);

          // Gruppen definieren: erste Gruppe (Noten, Kurse, Stammdaten, Statistik),
          // zweite Gruppe (Einstellungen, Import), dritte Gruppe (Rechner)
          const groups = [
            [
              { id: "dashboard", label: "Übersicht", icon: 'overview' },
              { id: "gradesheet", label: "Noten", icon: 'gradesheet' },
              { id: "courses", label: "Kurse", icon: 'courses' },
              { id: "students", label: "Stammdaten", icon: 'students' },
              { id: "stats", label: "Statistik", icon: 'stats' }
            ],
            [
              { id: "settings", label: "Einstellungen", icon: 'settings' },
              { id: "import", label: "Import / Export", icon: 'transfer' }
            ],
            [
              { id: "exam", label: "Klausurnotenrechner", icon: 'calculator' }
            ]
          ];

          // Hilfsfunktion: Button erstellen
          function makeBtn(entry) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.appendChild(createUiIcon(entry.icon));
            const label = document.createElement('span');
            label.textContent = entry.label;
            btn.appendChild(label);
            btn.addEventListener('click', function () {
              requestGradesheetNavigation(entry.id);
            });

            if (entry.id === currentSection) {
              btn.classList.add('active');
              btn.setAttribute('aria-current', 'page');
            }

            return btn;
          }

          // Separator zwischen Gruppen
          function makeSeparator() {
            const sep = document.createElement('div');
            sep.className = 'nav-separator';
            sep.setAttribute('aria-hidden', 'true');
            return sep;
          }

          // Erzeuge die Gruppen und Buttons
          groups.forEach((grp, gi) => {
            const wrap = document.createElement('div');
            wrap.className = 'nav-group';

            grp.forEach(entry => {
              wrap.appendChild(makeBtn(entry));
            });

            nav.appendChild(wrap);
            // Separator nach Gruppe, außer nach der letzten
            if (gi < groups.length - 1) {
              nav.appendChild(makeSeparator());
            }
          });

          container.appendChild(nav);
          const footer = document.createElement('div');
          footer.className = 'sidebar-footer';
          const local = document.createElement('span'); local.textContent = 'Lokale Anwendung';
          const privacy = document.createElement('small'); privacy.textContent = 'Deine Daten. Dein Browser.';
          const release = document.createElement('small'); release.className = 'sidebar-release'; release.textContent = 'Version ' + APP_RELEASE.version + ' · ' + APP_RELEASE.dateLabel;
          footer.appendChild(local); footer.appendChild(privacy); footer.appendChild(release); container.appendChild(footer);
        }

        function renderDashboardSection(container) {
          const section = document.createElement('section');
          section.className = 'section dashboard-overview';
          const eyebrow = document.createElement('div');
          eyebrow.className = 'section-eyebrow'; eyebrow.textContent = 'DEIN ARBEITSBEREICH';
          section.appendChild(eyebrow);
          const headingRow = document.createElement('div');
          headingRow.className = 'section-heading';
          const headingCopy = document.createElement('div');
          const heading = document.createElement('h2');
          heading.textContent = 'Übersicht';
          const subtitle = document.createElement('p');
          subtitle.className = 'section-hint'; subtitle.textContent = 'Aktive Kurse und der direkte Weg zur Noteneingabe.';
          headingCopy.appendChild(heading); headingCopy.appendChild(subtitle); headingRow.appendChild(headingCopy);
          const manage = document.createElement('button');
          manage.type = 'button'; manage.className = 'section-action'; manage.textContent = 'Kurse verwalten';
          manage.addEventListener('click', function () { requestGradesheetNavigation('courses'); });
          headingRow.appendChild(manage); section.appendChild(headingRow);
          const resumeCourseId = lastRenderedGradesheetCourseId || state.lastGradesheetCourseId;
          const resumedCourse = resolveActiveCourseById(resumeCourseId);
          if (resumedCourse) {
            const resumeCard = document.createElement('article');
            resumeCard.className = 'dashboard-resume-card';
            const resumeCopy = document.createElement('div');
            resumeCopy.className = 'dashboard-resume-copy';
            const resumeEyebrow = document.createElement('div');
            resumeEyebrow.className = 'dashboard-resume-eyebrow';
            resumeEyebrow.textContent = 'ZULETZT GEÖFFNET';
            const resumeTitle = document.createElement('h3');
            resumeTitle.className = 'dashboard-resume-title';
            resumeTitle.textContent = (resumedCourse.name || 'Unbenannter Kurs') + ' · ' +
              (resumedCourse.classLabel || 'Klasse nicht angegeben');
            const resumeMeta = document.createElement('p');
            resumeMeta.className = 'dashboard-resume-meta';
            resumeMeta.textContent = 'Noteneingabe';
            resumeCopy.appendChild(resumeEyebrow);
            resumeCopy.appendChild(resumeTitle);
            resumeCopy.appendChild(resumeMeta);
            const resumeButton = document.createElement('button');
            resumeButton.type = 'button';
            resumeButton.className = 'section-action dashboard-resume-action';
            resumeButton.textContent = 'Fortsetzen';
            resumeButton.addEventListener('click', function () {
              if (!dashboardIsAllowed()) return;
              const course = resolveActiveCourseById(resumeCourseId);
              if (!course) {
                currentSection = 'dashboard';
                focusTargetHeading = true;
                render();
                return;
              }
              currentCourseId = course.id;
              currentSection = 'gradesheet';
              gradesheetView = 'entry';
              focusTargetHeading = true;
              render();
            });
            resumeCard.appendChild(resumeCopy);
            resumeCard.appendChild(resumeButton);
            section.appendChild(resumeCard);
          }
          const activeHeading = document.createElement('h3');
          activeHeading.className = 'dashboard-course-heading'; activeHeading.textContent = 'Aktive Kurse';
          section.appendChild(activeHeading);
          const cards = buildDashboardCards({ state, domain: DomainModel, grading: GradingLogic });
          if (cards.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'Noch keine aktiven Kurse vorhanden.';
            section.appendChild(empty);
            const coursesButton = document.createElement('button');
            coursesButton.type = 'button';
            coursesButton.textContent = 'Zur Kursanlage';
            coursesButton.addEventListener('click', function () { setSection('courses'); });
            section.appendChild(coursesButton);
            const importButton = document.createElement('button');
            importButton.type = 'button';
            importButton.textContent = 'Import öffnen';
            importButton.addEventListener('click', function () { setSection('import'); });
            section.appendChild(importButton);
          } else {
            const host = document.createElement('div');
            host.className = 'dashboard-course-host';
            section.appendChild(host);
            dashboardMount = mountCourseCards({
              host,
              idPrefix: 'dashboard-course',
              courses: cards,
              family: currentAppearance.family,
              appearance: currentTheme,
              accent: currentAppearance.accent,
              background: currentAppearance.background,
              motion: effectiveMotion(),
              onOpenCourse: function (courseId) {
                if (!dashboardIsAllowed()) return;
                const course = DomainModel.listActiveCourses(state).find(function (candidate) { return candidate.id === courseId; });
                if (!course) {
                  try { window.alert('Der ausgewählte Kurs ist nicht mehr aktiv. Die Übersicht wurde aktualisiert.'); } catch (e) {}
                  currentSection = 'dashboard';
                  focusTargetHeading = true;
                  render();
                  return;
                }
                currentCourseId = course.id;
                currentSection = 'gradesheet';
                gradesheetView = 'entry';
                focusTargetHeading = true;
                render();
              }
            });
          }
          container.appendChild(section);
        }

        // Panel-Zustand (open/closed) während der UI-Sitzung merken, damit nach
        // Re-renders ein zuvor geöffnetes Panel offen bleibt.
        // Lade ggf. gespeicherten Zustand aus `state.settings.panelOpenState`.
        let panelOpenState = {};
        try {
          const saved = state && state.settings && state.settings.panelOpenState;
          if (saved && typeof saved === 'object') {
            panelOpenState = Object.assign({}, saved);
          } else {
            panelOpenState = {};
          }
        } catch (e) {
          panelOpenState = {};
        }

        // Hilfsfunktion: Erzeugt ein aufklappbares Panel um vorhandene Box-Elemente
        function makePanel(title, contentEl, open = true) {
          const panel = document.createElement('div');
          panel.style.marginBottom = '0.6rem';

          // Berücksichtige gespeicherten Zustand, falls vorhanden
          const isOpen = (typeof panelOpenState[title] !== 'undefined') ? !!panelOpenState[title] : !!open;

          const header = document.createElement('div');
          header.className = 'collapsible-header' + (isOpen ? '' : ' collapsed');
          header.style.padding = '0.45rem 0.6rem';
          header.style.border = '1px solid var(--border-soft)';
          header.style.borderRadius = '6px';
          header.style.background = 'var(--info-bg)';

            // Panel-Icon (kleines SVG) — wählen je nach Titel ein passendes Icon
            const panelIcon = document.createElement('span');
            panelIcon.className = 'panel-icon';
            const iconInner = document.createElement('span');
            iconInner.className = 'icon';
            // Simple mapping: erkenne Schlüsselwörter in Titel
            function panelIconSvgFor(titleText) {
              const t = (titleText || '').toLowerCase();
              if (t.indexOf('sicherheit') !== -1 || t.indexOf('verschlüssel') !== -1) {
                return '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 7V5a4 4 0 018 0v2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="7" width="12" height="7" rx="1" ry="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
              }
              if (t.indexOf('kategorien') !== -1) {
                return '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
              }
              if (t.indexOf('gewicht') !== -1) {
                return '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2v12M2 6h12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
              }
              if (t.indexOf('notenschema') !== -1 || t.indexOf('grade') !== -1) {
                return '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 12h12M4 9l2-4 2 4 2-6 2 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
              }
              // Standard: Zahnrad (Einstellungen)
              return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 2.27 17.9l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.3 3.86A2 2 0 1 1 7.12 1.03l.06.06a1.65 1.65 0 0 0 1.82.33h.06A1.65 1.65 0 0 0 11.5 0H12a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1 1.51v.06a1.65 1.65 0 0 0 .33 1.82l.06.06A2 2 0 1 1 16.1 7.27l-.06-.06a1.65 1.65 0 0 0-1.82-.33H13a2 2 0 0 1 0 4h.09c.5 0 .95.19 1.29.53.34.34.53.79.53 1.29V15z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
            }
            iconInner.innerHTML = panelIconSvgFor(title);
            panelIcon.appendChild(iconInner);

            const titleEl = document.createElement('strong');
            titleEl.textContent = title;
            header.appendChild(panelIcon);
            header.appendChild(titleEl);

          const content = document.createElement('div');
          content.className = 'collapsible-content' + (isOpen ? '' : ' hidden');
          content.style.marginTop = '0.5rem';
          content.appendChild(contentEl);

          header.addEventListener('click', async function () {
            const nowHidden = content.classList.toggle('hidden');
            header.classList.toggle('collapsed');
            const nextOpen = !nowHidden;
            panelOpenState[title] = nextOpen;
            try {
              await commitStateChange(function (candidate) {
                candidate.settings = candidate.settings || {};
                candidate.settings.panelOpenState = Object.assign({}, candidate.settings.panelOpenState || {}, {
                  [title]: nextOpen
                });
              });
            } catch (error) {
              const confirmed = state.settings && state.settings.panelOpenState;
              panelOpenState[title] = confirmed && typeof confirmed[title] !== 'undefined'
                ? !!confirmed[title]
                : !nextOpen;
              content.classList.toggle('hidden', !panelOpenState[title]);
              header.classList.toggle('collapsed', !panelOpenState[title]);
              if (!isStateCommitAborted(error)) console.error('Panelzustand konnte nicht gespeichert werden:', error);
            }
          });

          // Initial speichern (falls noch nicht vorhanden)
          if (typeof panelOpenState[title] === 'undefined') panelOpenState[title] = isOpen;

          panel.appendChild(header);
          panel.appendChild(content);
          return panel;
        }

        function renderCoursesSection(container) {
          let activeCourseEditorTab = typeof courseEditorActiveTab === 'string' ? courseEditorActiveTab : 'general';
          let activeCourseEditorTabCourseId = typeof courseEditorTabCourseId !== 'undefined'
            ? courseEditorTabCourseId
            : null;

          const section = document.createElement("section");
          section.className = "section courses-section";
          const activeCourses = DomainModel.listActiveCourses(state);
          const archivedCourses = DomainModel.listArchivedCourses(state);
          if (courseEditorOpenForId && !activeCourses.some(function (course) { return course.id === courseEditorOpenForId; })) {
            courseEditorOpenForId = null;
          }

          const eyebrow = document.createElement('div');
          eyebrow.className = 'section-eyebrow';
          eyebrow.textContent = 'KURSVERWALTUNG';
          section.appendChild(eyebrow);
          const headingRow = document.createElement('div');
          headingRow.className = 'section-heading';
          const headingCopy = document.createElement('div');
          const h2 = document.createElement("h2");
          h2.textContent = "Kurse";
          const hint = document.createElement("p");
          hint.className = "section-hint";
          hint.textContent = "Unterricht organisieren und Personen gezielt zuordnen.";
          headingCopy.appendChild(h2);
          headingCopy.appendChild(hint);
          headingRow.appendChild(headingCopy);

          function requestArchiveMetadata({
            title = "Archivierung vorbereiten",
            description = "Leistungsdaten und Bewertungsgrundlagen bleiben schreibgeschützt erhalten.",
            confirmLabel = "Übernehmen",
            initialRetentionUntil = null,
            initialNote = null,
            onConfirm = null,
            formatSaveError = error => "Die Archivangaben wurden nicht gespeichert: " + (error.message || "Unbekannter Speicherfehler")
          } = {}) {
            return new Promise(resolve => {
              const overlay = document.createElement("div");
              overlay.dataset.sessionSensitiveOverlay = "true";
              overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:100450";
              const dialog = document.createElement("div");
              dialog.setAttribute("role", "dialog");
              dialog.setAttribute("aria-modal", "true");
              dialog.style.cssText = "background:var(--bg-card,#fff);color:var(--text-main,#111);padding:1rem;border-radius:10px;width:min(560px,96vw);box-shadow:0 12px 42px rgba(0,0,0,.35)";

              const titleId = DomainModel.generateId("archive_metadata_title");
              const heading = document.createElement("h3");
              heading.id = titleId;
              heading.textContent = title;
              heading.style.marginTop = "0";
              dialog.setAttribute("aria-labelledby", titleId);
              dialog.appendChild(heading);

              const info = document.createElement("p");
              info.className = "text-muted";
              info.textContent = description;
              dialog.appendChild(info);

              const retentionId = DomainModel.generateId("archive_retention");
              const retentionLabel = document.createElement("label");
              retentionLabel.htmlFor = retentionId;
              retentionLabel.textContent = "Aufbewahren bis (optional)";
              retentionLabel.style.display = "block";
              const retentionInput = document.createElement("input");
              retentionInput.id = retentionId;
              retentionInput.type = "date";
              retentionInput.value = DomainModel.normalizeArchiveRetentionUntil(initialRetentionUntil) || "";
              retentionInput.style.width = "100%";
              retentionInput.style.margin = "0.25rem 0 0.75rem";
              dialog.appendChild(retentionLabel);
              dialog.appendChild(retentionInput);

              const noteId = DomainModel.generateId("archive_note");
              const noteLabel = document.createElement("label");
              noteLabel.htmlFor = noteId;
              noteLabel.textContent = "Archivnotiz (optional, maximal 1000 Zeichen)";
              noteLabel.style.display = "block";
              const noteInput = document.createElement("textarea");
              noteInput.id = noteId;
              noteInput.rows = 4;
              noteInput.maxLength = 1000;
              noteInput.value = DomainModel.normalizeArchiveNote(initialNote) || "";
              noteInput.style.width = "100%";
              noteInput.style.margin = "0.25rem 0 0.75rem";
              dialog.appendChild(noteLabel);
              dialog.appendChild(noteInput);

              const error = document.createElement("div");
              error.setAttribute("role", "alert");
              error.style.color = "#b91c1c";
              error.style.minHeight = "1.25rem";
              dialog.appendChild(error);

              const actions = document.createElement("div");
              actions.style.cssText = "display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem";
              const cancelButton = document.createElement("button");
              cancelButton.type = "button";
              cancelButton.textContent = "Abbrechen";
              const confirmButton = document.createElement("button");
              confirmButton.type = "button";
              confirmButton.textContent = confirmLabel;
              actions.appendChild(cancelButton);
              actions.appendChild(confirmButton);
              dialog.appendChild(actions);

              let settled = false;
              let pending = false;
              function close(result, force = false) {
                if (settled || (pending && !force)) return;
                settled = true;
                document.removeEventListener("keydown", onKeyDown);
                overlay.remove();
                resolve(result);
              }
              function onKeyDown(event) {
                if (event.key === "Escape") close(null);
              }
              cancelButton.addEventListener("click", () => close(null));
              overlay.addEventListener("click", event => { if (event.target === overlay) close(null); });
              confirmButton.addEventListener("click", async () => {
                if (settled || pending) return;
                const rawRetention = retentionInput.value.trim();
                const archiveRetentionUntil = DomainModel.normalizeArchiveRetentionUntil(rawRetention);
                if (rawRetention && !archiveRetentionUntil) {
                  error.textContent = "Bitte ein gültiges Aufbewahrungsdatum eingeben.";
                  retentionInput.focus();
                  return;
                }
                const metadata = {
                  archiveRetentionUntil,
                  archiveNote: DomainModel.normalizeArchiveNote(noteInput.value)
                };
                if (typeof onConfirm !== "function") {
                  close(metadata);
                  return;
                }
                pending = true;
                retentionInput.disabled = true;
                noteInput.disabled = true;
                confirmButton.disabled = true;
                cancelButton.disabled = true;
                error.textContent = "";
                try {
                  const value = await onConfirm(metadata);
                  if (!settled) close({ metadata, value }, true);
                } catch (saveError) {
                  if (settled) return;
                  if (isStateCommitAborted(saveError)) {
                    close(null, true);
                    return;
                  }
                  pending = false;
                  retentionInput.disabled = false;
                  noteInput.disabled = false;
                  confirmButton.disabled = false;
                  cancelButton.disabled = false;
                  error.textContent = typeof formatSaveError === "function"
                    ? formatSaveError(saveError)
                    : String(formatSaveError || saveError.message || "Unbekannter Speicherfehler");
                  confirmButton.focus();
                }
              });
              document.addEventListener("keydown", onKeyDown);
              overlay.__closeForSessionLock = () => close(null, true);
              overlay.appendChild(dialog);
              document.body.appendChild(overlay);
              retentionInput.focus();
            });
          }

          // Hinweis: Die Verwaltung der Verschlüsselung befindet sich in den Einstellungen.

          // Verschlüsselung ist jetzt verpflichtend und wird in den Einstellungen verwaltet.

          // Warnhinweis zur lokalen Speicherung / Sync
          const notices = document.createElement('details');
          notices.className = 'courses-notices';
          notices.open = false;
          const noticesSummary = document.createElement('summary');
          noticesSummary.textContent = 'Hinweise zu Speicherung und Bewertung';
          notices.appendChild(noticesSummary);
          const storageWarning = document.createElement('div');
          storageWarning.className = 'info-box';
          storageWarning.style.borderColor = '#c62828';
          const warnTitle = document.createElement('strong');
          warnTitle.textContent = 'Wichtig – Datenspeicherung (lokal)';
          storageWarning.appendChild(warnTitle);
          const warnText = document.createElement('div');
          warnText.style.fontSize = '0.85rem';
          warnText.style.marginTop = '0.3rem';
          warnText.textContent = 'Die Anwendung speichert Daten lokal auf dem Rechner / im Browser (localStorage). Wenn dein Browserprofil oder dieser Ordner synchronisiert wird, können die Daten in die Cloud gelangen. Die Verschlüsselung wird in den Einstellungen verwaltet und ist erforderlich, um Daten sicher zu speichern.';
          storageWarning.appendChild(warnText);
          notices.appendChild(storageWarning);

          const info = document.createElement("div");
          info.className = "info-box";
          const infoStrong = document.createElement('strong');
          infoStrong.textContent = 'Hinweis:';
          info.appendChild(infoStrong);
          info.appendChild(document.createTextNode(' Die Auswahl des Bewertungsschemas (Noten 1–6 oder Punkte 0–15) beeinflusst direkt die Noteneingabe und die Berechnung der Rechenmittel. Das Sek-I-Schema bildet das sechsstufige Notensystem ab; das gesonderte ISS-/Gemeinschaftsschul-System mit 0–15 Punkten nach Anlage 5 wird nicht unterstützt. Die gewählte Gewichtungsvorlage legt fest, wie die Kategorien in das Rechenmittel eingehen.'));
          notices.appendChild(info);

          // Button: neuen Kurs anlegen
          const addBtn = document.createElement("button");
          addBtn.type = 'button';
          addBtn.className = 'section-action';
          addBtn.textContent = "Kurs anlegen";
          addBtn.addEventListener("click", function () {
            // Geführter Dialog zum Anlegen eines neuen Kurses
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.background = 'rgba(0,0,0,0.45)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '100100';

            const dialog = document.createElement('div');
            dialog.style.background = 'var(--bg-card, #fff)';
            dialog.style.padding = '1rem';
            dialog.style.borderRadius = '8px';
            dialog.style.minWidth = '360px';
            dialog.style.maxWidth = '90%';
            dialog.style.boxShadow = '0 8px 36px rgba(0,0,0,0.25)';

            const title = document.createElement('div');
            title.style.fontWeight = '600';
            title.style.marginBottom = '0.6rem';
            title.textContent = 'Neuen Kurs anlegen';
            dialog.className = 'new-course-dialog';
            dialog.style.minWidth = '0';
            dialog.style.width = 'min(640px, calc(100vw - 2rem))';
            dialog.style.maxWidth = '100%';
            dialog.style.maxHeight = 'calc(100dvh - 2rem)';
            dialog.style.overflowY = 'auto';
            dialog.style.boxSizing = 'border-box';
            dialog.appendChild(title);

            const form = document.createElement('div');
            form.style.display = 'grid';
            form.style.gridTemplateColumns = '1fr 1fr';
            form.style.gap = '0.5rem 1rem';
            form.className = 'new-course-fields';

            function addField(labelText, el, required) {
              const wrap = document.createElement('div');
              const lbl = document.createElement('div');
              lbl.style.fontSize = '0.8rem';
              lbl.textContent = labelText;
              if (required) {
                const star = document.createElement('span');
                star.textContent = ' *';
                star.style.color = '#c62828';
                lbl.appendChild(star);
              }
              wrap.appendChild(lbl);
              wrap.appendChild(el);
              return wrap;
            }

            // Name
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'z. B. 10c Biologie';
            nameInput.style.width = '100%';
            nameInput.style.boxSizing = 'border-box';
            form.appendChild(addField('Name', nameInput, true));

            // Fach
            const subjInput = document.createElement('input');
            subjInput.type = 'text';
            subjInput.placeholder = 'z. B. Biologie';
            subjInput.style.width = '100%';
            subjInput.style.boxSizing = 'border-box';
            form.appendChild(addField('Fach', subjInput, true));

            const newSymbolPicker = createCourseSymbolPicker({
              document, id: 'new-course-symbol', course: { subject: '' }
            });
            subjInput.addEventListener('input', () => newSymbolPicker.updatePreview(subjInput.value));
            form.appendChild(newSymbolPicker.root);

            // Klasse
            const classInput = document.createElement('input');
            classInput.type = 'text';
            classInput.placeholder = 'z. B. 10c';
            classInput.style.width = '100%';
            classInput.style.boxSizing = 'border-box';
            form.appendChild(addField('Klasse / Kursbezeichnung', classInput, true));

            // Schema
            const schemaSelect = document.createElement('select');
            const optGrades = document.createElement('option');
            optGrades.value = DomainModel.SCHEMA_MODES.GRADES;
            optGrades.textContent = 'Noten (1–6)';
            const optUpper = document.createElement('option');
            optUpper.value = DomainModel.SCHEMA_MODES.UPPERSEC;
            optUpper.textContent = 'Punkte (0–15)';
            schemaSelect.appendChild(optGrades);
            schemaSelect.appendChild(optUpper);
            schemaSelect.style.width = '100%';
            form.appendChild(addField('Schema', schemaSelect, true));

            // Gewichtungsvorlage
            const wtSelect = document.createElement('select');
            wtSelect.style.width = '100%';
            const wtNone = document.createElement('option');
            wtNone.value = '';
            wtNone.textContent = 'Keine / manuell wählen';
            wtSelect.appendChild(wtNone);
            const templates = (state && state.settings && state.settings.weightTemplates) ? state.settings.weightTemplates : [];
            for (const t of templates) {
              const o = document.createElement('option');
              o.value = t.id;
              o.textContent = t.name || '(unnamed)';
              wtSelect.appendChild(o);
            }
            form.appendChild(addField('Gewichtungsvorlage', wtSelect));
            let newUpperSecContext = null;

            // Standardleistungen checkbox (M1/S1)
            const stdWrap = document.createElement('div');
            stdWrap.style.gridColumn = '1 / -1';
            const stdLabel = document.createElement('label');
            const stdCheckbox = document.createElement('input');
            stdCheckbox.type = 'checkbox';
            stdCheckbox.style.marginRight = '0.4rem';
            stdLabel.appendChild(stdCheckbox);
            stdLabel.appendChild(document.createTextNode('Standardleistungen M1 und S1 anlegen'));
            stdWrap.appendChild(stdLabel);
            form.appendChild(stdWrap);

            // Sek-I-Jahreswertung ist fachlich fest: H1 allein, H2 aus H1 + H2.
            const prevWrap = document.createElement('div');
            prevWrap.style.gridColumn = '1 / -1';
            const prevCheckbox = document.createElement('input');
            prevCheckbox.type = 'checkbox';
            prevCheckbox.checked = true;
            const prevInfo = document.createElement('div');
            prevInfo.className = 'section-hint';
            prevInfo.textContent = 'Sek I: H1 wird einzeln ausgewertet; am Ende von H2 zählen automatisch alle Einzelbewertungen aus H1 und H2.';
            prevWrap.appendChild(prevInfo);
            form.appendChild(prevWrap);

            const upperSecContextHost = document.createElement('div');
            upperSecContextHost.style.gridColumn = '1 / -1';
            form.appendChild(upperSecContextHost);

            function getNewCourseContextTerm() {
              return GradingLogic.resolveAssessmentTermFromDateValue(
                new Date(),
                { schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC },
                state.settings
              );
            }

            function refreshNewUpperSecContextFields() {
              upperSecContextHost.replaceChildren();
              const isUpperSec = schemaSelect.value === DomainModel.SCHEMA_MODES.UPPERSEC;
              prevWrap.style.display = isUpperSec ? 'none' : '';
              if (!isUpperSec) {
                newUpperSecContext = null;
                return;
              }
              let editor = null;
              editor = createUpperSecContextFields({
                schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
                context: newUpperSecContext,
                term: getNewCourseContextTerm(),
                settings: state.settings,
                weightTemplateId: wtSelect.value || null,
                getWeightTemplateId: function () { return wtSelect.value || null; },
                onChange: function (change) {
                  newUpperSecContext = DomainModel.normalizeUpperSecContext(
                    DomainModel.SCHEMA_MODES.UPPERSEC,
                    change
                  );
                  const provisionalCourse = DomainModel.createCourse({
                    schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
                    upperSecContext: newUpperSecContext,
                    weightTemplateId: wtSelect.value || null
                  });
                  const presentation = describeUpperSecRecommendation(
                    provisionalCourse,
                    getNewCourseContextTerm(),
                    state.settings
                  );
                  if (!wtSelect.value && presentation.recommendedWeightTemplateId) {
                    wtSelect.value = presentation.recommendedWeightTemplateId;
                    if (editor) editor.refresh();
                  }
                }
              });
              if (editor) upperSecContextHost.appendChild(editor.element);
            }

            // Wenn das Schema gewechselt wird, passe die Standard-Checkbox entsprechend an
            schemaSelect.addEventListener('change', function () {
              try {
                prevCheckbox.checked = (schemaSelect.value === DomainModel.SCHEMA_MODES.GRADES);
                refreshNewUpperSecContextFields();
              } catch (e) { /* ignore */ }
            });
            wtSelect.addEventListener('change', refreshNewUpperSecContextFields);
            refreshNewUpperSecContextFields();

            // Optionale eigene Halbjahres-Stichtage (für Oberstufe oder Sonderfälle)
            const cutoffWrap = document.createElement('div');
            cutoffWrap.style.gridColumn = '1 / -1';
            cutoffWrap.style.marginTop = '0.6rem';
            cutoffWrap.style.padding = '0.5rem';
            cutoffWrap.style.border = '1px dashed var(--border-soft)';
            cutoffWrap.style.borderRadius = '6px';

            const cutoffToggleLabel = document.createElement('label');
            cutoffToggleLabel.style.display = 'flex';
            cutoffToggleLabel.style.alignItems = 'center';
            cutoffToggleLabel.style.gap = '0.45rem';
            cutoffToggleLabel.style.fontWeight = '600';
            const cutoffToggle = document.createElement('input');
            cutoffToggle.type = 'checkbox';
            cutoffToggleLabel.appendChild(cutoffToggle);
            cutoffToggleLabel.appendChild(document.createTextNode('Eigene Halbjahres-Stichtage für diesen Kurs setzen'));
            cutoffWrap.appendChild(cutoffToggleLabel);

            const cutoffHint = document.createElement('div');
            cutoffHint.className = 'text-muted';
            cutoffHint.style.fontSize = '0.82rem';
            cutoffHint.style.marginTop = '0.35rem';
            cutoffHint.textContent = 'Der H2-Start entscheidet über die Zuordnung; das H1-Ende ist informativ. Tage in einer Lücke bleiben H1, bei einer Überlappung hat H2 ab seinem Beginn Vorrang.';
            cutoffWrap.appendChild(cutoffHint);

            const cutoffFields = document.createElement('div');
            cutoffFields.style.display = 'none';
            cutoffFields.style.gap = '0.6rem';
            cutoffFields.style.marginTop = '0.5rem';
            cutoffFields.style.flexWrap = 'wrap';
            cutoffFields.style.alignItems = 'center';

            const h1EndLabel = document.createElement('label');
            h1EndLabel.textContent = 'H1 Ende:';
            const h1EndInput = document.createElement('input');
            h1EndInput.type = 'date';
            h1EndInput.style.width = '10.5rem';
            h1EndLabel.appendChild(h1EndInput);

            const h2StartLabel = document.createElement('label');
            h2StartLabel.textContent = 'H2 Start:';
            const h2StartInput = document.createElement('input');
            h2StartInput.type = 'date';
            h2StartInput.style.width = '10.5rem';
            h2StartLabel.appendChild(h2StartInput);

            cutoffFields.appendChild(h1EndLabel);
            cutoffFields.appendChild(h2StartLabel);
            cutoffWrap.appendChild(cutoffFields);

            cutoffToggle.addEventListener('change', () => {
              cutoffFields.style.display = cutoffToggle.checked ? 'flex' : 'none';
            });

            form.appendChild(cutoffWrap);

            dialog.appendChild(form);

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'flex-end';
            row.style.gap = '0.5rem';
            row.style.marginTop = '0.6rem';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Abbrechen';
            cancelBtn.addEventListener('click', function () { try { document.body.removeChild(overlay); } catch (e) {} });

            const createBtn = document.createElement('button');
            createBtn.type = 'button';
            createBtn.textContent = 'Anlegen';
            createBtn.addEventListener('click', async function () {
              const nameVal = (nameInput.value || '').trim();
              const subjectVal = (subjInput.value || '').trim();
              const classVal = (classInput.value || '').trim();
              const schemaVal = schemaSelect.value || '';
              const wtId = wtSelect.value || null;
              let cutoffConfig = null;
              if (cutoffToggle.checked) {
                if (!h1EndInput.value || !h2StartInput.value) {
                  try { window.alert('Bitte beide Stichtage (H1 Ende und H2 Start) ausfüllen.'); } catch (e) {}
                  return;
                }
                const h1d = parseHalfYearDateValue(h1EndInput.value);
                const h2d = parseHalfYearDateValue(h2StartInput.value);
                if (!h1d || !h2d) {
                  try { window.alert('Bitte gültige Stichtage verwenden.'); } catch (e) {}
                  return;
                }
                cutoffConfig = {
                  h1EndMonth: h1d.getMonth() + 1,
                  h1EndDay: h1d.getDate(),
                  h2StartMonth: h2d.getMonth() + 1,
                  h2StartDay: h2d.getDate()
                };
              }

              // Validierung für Pflichtfelder
              if (!nameVal) {
                try { window.alert('Bitte einen Kursnamen eingeben.'); } catch (e) {}
                try { nameInput.focus(); } catch (e) {}
                return;
              }
              if (!subjectVal) {
                try { window.alert('Bitte ein Fach angeben.'); } catch (e) {}
                try { subjInput.focus(); } catch (e) {}
                return;
              }
              if (!classVal) {
                try { window.alert('Bitte eine Klassen- oder Kursbezeichnung angeben.'); } catch (e) {}
                try { classInput.focus(); } catch (e) {}
                return;
              }
              if (!schemaVal) {
                try { window.alert('Bitte ein Bewertungsschema wählen.'); } catch (e) {}
                try { schemaSelect.focus(); } catch (e) {}
                return;
              }
              if (schemaVal === DomainModel.SCHEMA_MODES.UPPERSEC &&
                  (!newUpperSecContext || !newUpperSecContext.courseType || !newUpperSecContext.qualificationYear)) {
                try { window.alert('Bitte Kursart und Qualifikationsabschnitt vollständig auswählen.'); } catch (e) {}
                return;
              }

              const previousCourseId = currentCourseId;
              const input = {
                name: nameVal,
                subject: subjectVal,
                symbolId: newSymbolPicker.select.value,
                classLabel: classVal,
                schemaMode: schemaVal,
                weightTemplateId: wtId || null,
                includePrevTermGrades: schemaVal === DomainModel.SCHEMA_MODES.GRADES && prevCheckbox.checked,
                upperSecContext: newUpperSecContext ? JSON.parse(JSON.stringify(newUpperSecContext)) : null,
                termCutoffs: cutoffConfig ? Object.assign({}, cutoffConfig) : null,
                createInitialAssessments: stdCheckbox.checked
              };
              let createdCourseId = null;
              createBtn.disabled = true;
              try {
                await commitStateChange(function (candidate) {
                  if (input.weightTemplateId && !(candidate.settings.weightTemplates || []).some(function (template) {
                    return template.id === input.weightTemplateId;
                  })) throw new Error('Die ausgewählte Gewichtungsvorlage ist nicht mehr verfügbar.');
                  const course = DomainModel.createCourse(input);
                  DomainModel.addCourseToState(candidate, course);
                  if (input.createInitialAssessments) {
                    const initialTerm = resolveAssessmentTermFromDateValue(new Date(), course, getSettingsForCourse(course, candidate));
                    createInitialAssessmentsForCourse(DomainModel, candidate, course, initialTerm);
                  }
                  createdCourseId = course.id;
                }, { render: false });
                currentCourseId = createdCourseId;
                try { document.body.removeChild(overlay); } catch (e) {}
                render();
              } catch (error) {
                currentCourseId = previousCourseId;
                if (!isStateCommitAborted(error)) {
                  try { window.alert('Kurs konnte nicht gespeichert werden: ' + error.message); } catch (e) {}
                }
              } finally {
                createBtn.disabled = false;
              }
            });

            row.appendChild(cancelBtn);
            row.appendChild(createBtn);
            dialog.appendChild(row);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            // Fokus auf das erste Feld
            setTimeout(() => { try { nameInput.focus(); } catch (e) {} }, 50);
          });
          const schoolYearBtn = document.createElement("button");
          schoolYearBtn.type = "button";
          schoolYearBtn.textContent = "Schuljahreswechsel";
          schoolYearBtn.id = "school-year-assistant-trigger";
          schoolYearBtn.addEventListener("click", () => openSchoolYearAssistant(schoolYearBtn));

          headingRow.appendChild(addBtn);
          section.appendChild(headingRow);
          const courseActionRow = document.createElement("div");
          courseActionRow.className = 'courses-toolbar';
          const activeCount = document.createElement('span');
          activeCount.className = 'badge courses-active-count';
          activeCount.textContent = activeCourses.length === 1 ? '1 aktiver Kurs' : activeCourses.length + ' aktive Kurse';
          courseActionRow.appendChild(activeCount);
          courseActionRow.appendChild(schoolYearBtn);
          section.appendChild(courseActionRow);

          const activeOverview = document.createElement('div');
          activeOverview.className = 'courses-active-overview';
          section.appendChild(activeOverview);
          if (activeCourses.length === 0) {
            const p = document.createElement("p");
            p.className = "text-muted";
            p.style.marginTop = "0.5rem";
            p.textContent = archivedCourses.length > 0
              ? "Keine aktiven Kurse. Archivierte Kurse findest du weiter unten."
              : "Noch keine Kurse vorhanden. Lege oben einen neuen Kurs an.";
            activeOverview.appendChild(p);
          }

          if (activeCourses.length > 0) {
            const cards = buildDashboardCards({ state, domain: DomainModel, grading: GradingLogic });
            const host = document.createElement('div');
            host.className = 'courses-card-host';
            activeOverview.appendChild(host);
            function resolveActiveCourse(courseId) {
              return DomainModel.listActiveCourses(state).find(function (course) { return course.id === courseId; }) || null;
            }
            function rejectStaleCourse() {
              try { window.alert('Der ausgewählte Kurs ist nicht mehr aktiv. Die Kursübersicht wurde aktualisiert.'); } catch (e) {}
              courseEditorOpenForId = null;
              courseEditorActiveTab = 'general';
              courseEditorTabCourseId = null;
              currentSection = 'courses';
              focusTargetHeading = true;
              render();
            }
            dashboardMount = mountCourseCards({
              host,
              idPrefix: 'courses-course',
              courses: cards,
              family: currentAppearance.family,
              appearance: currentTheme,
              accent: currentAppearance.accent,
              background: currentAppearance.background,
              motion: effectiveMotion(),
              onOpenCourse: function (courseId) {
                if (!dashboardIsAllowed()) return;
                const course = resolveActiveCourse(courseId);
                if (!course) { rejectStaleCourse(); return; }
                currentCourseId = course.id;
                courseEditorOpenForId = null;
                currentSection = 'gradesheet';
                focusTargetHeading = true;
                render();
              },
              onEditCourse: function (courseId) {
                if (!dashboardIsAllowed()) return;
                const course = resolveActiveCourse(courseId);
                if (!course) { rejectStaleCourse(); return; }
                currentCourseId = course.id;
                if (courseEditorOpenForId !== course.id) {
                  courseEditorActiveTab = 'general';
                  courseEditorTabCourseId = null;
                }
                courseEditorOpenForId = course.id;
                currentSection = 'courses';
                focusTargetHeading = false;
                render();
                const editor = document.querySelector('.courses-editor');
                const editorSummary = editor ? editor.querySelector('summary') : null;
                if (editor && typeof editor.scrollIntoView === 'function') editor.scrollIntoView({ block: 'start' });
                if (editorSummary) editorSummary.focus();
              }
            });
          }

          // Detailformular für aktuell ausgewählten Kurs
          const currentCourse = currentCourseId
            ? activeCourses.find(c => c.id === currentCourseId) || null
            : null;

          if (currentCourse) {
            const detailBox = document.createElement("details");
            detailBox.className = "info-box courses-editor";
            detailBox.open = courseEditorOpenForId === currentCourse.id;
            const detailSummary = document.createElement('summary');
            detailSummary.textContent = 'Kurs bearbeiten: ' + (currentCourse.name || '(ohne Name)') +
              (currentCourse.classLabel ? ' · ' + currentCourse.classLabel : '');
            detailBox.appendChild(detailSummary);
            detailBox.addEventListener('toggle', function () {
              courseEditorOpenForId = detailBox.open ? currentCourse.id : null;
            });

            const title = document.createElement("strong");
            title.textContent = "Aktueller Kurs: " +
              (currentCourse.name || "(ohne Name)") +
              (currentCourse.classLabel ? " (" + currentCourse.classLabel + ")" : "");
            title.className = 'courses-editor-identity';
            detailBox.appendChild(title);

            if (activeCourseEditorTabCourseId !== currentCourse.id) {
              activeCourseEditorTab = 'general';
              activeCourseEditorTabCourseId = currentCourse.id;
              if (typeof courseEditorActiveTab !== 'undefined') courseEditorActiveTab = activeCourseEditorTab;
              if (typeof courseEditorTabCourseId !== 'undefined') courseEditorTabCourseId = activeCourseEditorTabCourseId;
            }
            const editorTabs = document.createElement('div');
            editorTabs.className = 'courses-editor-tabs';
            editorTabs.setAttribute('role', 'tablist');
            editorTabs.setAttribute('aria-label', 'Bereiche für die Kursbearbeitung');
            const editorPanels = document.createElement('div');
            editorPanels.className = 'courses-editor-panels';
            const editorTabDefinitions = [
              { id: 'general', label: 'Allgemeines' },
              { id: 'students', label: 'Schülerzuordnung' },
              { id: 'grading', label: 'Bewertung' }
            ];
            const editorTabButtons = new Map();
            const editorTabPanels = new Map();
            for (const definition of editorTabDefinitions) {
              const tab = document.createElement('button');
              tab.type = 'button';
              tab.className = 'courses-editor-tab';
              tab.textContent = definition.label;
              tab.id = 'course-editor-tab-' + definition.id;
              tab.setAttribute('role', 'tab');
              tab.setAttribute('data-course-editor-tab', definition.id);
              tab.setAttribute('aria-controls', 'course-editor-panel-' + definition.id);
              const panel = document.createElement('section');
              panel.className = 'courses-editor-panel';
              panel.id = 'course-editor-panel-' + definition.id;
              panel.setAttribute('role', 'tabpanel');
              panel.setAttribute('data-course-editor-panel', definition.id);
              panel.setAttribute('aria-labelledby', tab.id);
              editorTabs.appendChild(tab);
              editorPanels.appendChild(panel);
              editorTabButtons.set(definition.id, tab);
              editorTabPanels.set(definition.id, panel);
            }
            function activateCourseEditorTab(tabId, focusTab) {
              const nextTab = editorTabButtons.has(tabId) ? tabId : 'general';
              activeCourseEditorTab = nextTab;
              if (typeof courseEditorActiveTab !== 'undefined') courseEditorActiveTab = activeCourseEditorTab;
              for (const definition of editorTabDefinitions) {
                const selected = definition.id === nextTab;
                const tab = editorTabButtons.get(definition.id);
                const panel = editorTabPanels.get(definition.id);
                tab.setAttribute('aria-selected', selected ? 'true' : 'false');
                tab.tabIndex = selected ? 0 : -1;
                panel.hidden = !selected;
              }
              const activeTab = editorTabButtons.get(nextTab);
              if (focusTab && activeTab && typeof activeTab.focus === 'function') activeTab.focus();
            }
            for (let index = 0; index < editorTabDefinitions.length; index += 1) {
              const definition = editorTabDefinitions[index];
              const tab = editorTabButtons.get(definition.id);
              tab.addEventListener('click', function () {
                activateCourseEditorTab(definition.id, true);
              });
              tab.addEventListener('keydown', function (event) {
                let nextIndex = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % editorTabDefinitions.length;
                if (event.key === 'ArrowLeft') nextIndex = (index + editorTabDefinitions.length - 1) % editorTabDefinitions.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = editorTabDefinitions.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                activateCourseEditorTab(editorTabDefinitions[nextIndex].id, true);
              });
            }
            activateCourseEditorTab(activeCourseEditorTab, false);
            detailBox.appendChild(editorTabs);
            detailBox.appendChild(editorPanels);

            const generalPanel = editorTabPanels.get('general');
            const studentsPanel = editorTabPanels.get('students');
            const gradingPanel = editorTabPanels.get('grading');
            const generalHeading = document.createElement('h3');
            generalHeading.textContent = 'Allgemeines & Zeiträume';
            generalPanel.appendChild(generalHeading);
            const generalSaveHint = document.createElement('p');
            generalSaveHint.className = 'courses-editor-save-hint';
            generalSaveHint.textContent = 'Kursname, Fach, Klasse und Kurssymbol werden nach einer Änderung sofort gespeichert. Mit „Stichtage speichern“ sicherst du die Angaben unten im Bereich.';
            generalPanel.appendChild(generalSaveHint);
            const studentsHeading = document.createElement('h3');
            studentsHeading.textContent = 'Schülerzuordnung';
            studentsPanel.appendChild(studentsHeading);
            const gradingHeading = document.createElement('h3');
            gradingHeading.textContent = 'Bewertung';
            gradingPanel.appendChild(gradingHeading);
            const gradingSaveHint = document.createElement('p');
            gradingSaveHint.className = 'courses-editor-save-hint';
            gradingSaveHint.textContent = 'Eine Gewichtung wird nach der Auswahl sofort gespeichert. Für den Wechsel zu Sek II wählst du zuerst Kursart und Qualifikationsabschnitt vollständig aus; erst dann wird der Kontext zusammen mit dem Schema gespeichert.';
            gradingPanel.appendChild(gradingSaveHint);

            const form = document.createElement("div");
            form.className = 'courses-editor-fields';
            async function saveCourseTextInput(input, field, value, fallback, message) {
              const courseId = currentCourse.id;
              try {
                await commitStateChange(function (candidate) {
                  requireActiveCourse(candidate, courseId)[field] = value;
                });
              } catch (error) {
                const confirmed = DomainModel.findCourseById(state, courseId);
                input.value = confirmed ? (confirmed[field] || fallback || '') : '';
                if (!isStateCommitAborted(error)) window.alert(message + ': ' + error.message);
              }
            }

            // Feld: Kursname
            const nameWrapper = document.createElement("div");
            nameWrapper.className = 'courses-editor-field';
            const nameLabel = document.createElement("label");
            nameLabel.className = 'courses-editor-label';
            nameLabel.textContent = "Kursname:";
            const nameInput = document.createElement("input");
            nameInput.id = 'course-editor-name';
            nameInput.type = "text";
            nameLabel.setAttribute('for', nameInput.id);
            nameInput.value = currentCourse.name || "";
            nameInput.style.width = "100%";
            nameInput.style.boxSizing = "border-box";
            nameInput.addEventListener("change", async function () {
              await saveCourseTextInput(this, 'name', this.value.trim() || 'Neuer Kurs', 'Neuer Kurs', 'Der Kursname konnte nicht gespeichert werden');
            });
            nameWrapper.appendChild(nameLabel);
            nameWrapper.appendChild(nameInput);

            // Feld: Fach
            const subjWrapper = document.createElement("div");
            subjWrapper.className = 'courses-editor-field';
            const subjLabel = document.createElement("label");
            subjLabel.className = 'courses-editor-label';
            subjLabel.textContent = "Fach:";
            const subjInput = document.createElement("input");
            subjInput.id = 'course-editor-subject';
            subjInput.type = "text";
            subjLabel.setAttribute('for', subjInput.id);
            subjInput.value = currentCourse.subject || "";
            subjInput.style.width = "100%";
            subjInput.style.boxSizing = "border-box";
            subjInput.addEventListener("change", async function () {
              await saveCourseTextInput(this, 'subject', this.value.trim(), '', 'Das Fach konnte nicht gespeichert werden');
            });
            subjWrapper.appendChild(subjLabel);
            subjWrapper.appendChild(subjInput);

            // Feld: Klasse
            const classWrapper = document.createElement("div");
            classWrapper.className = 'courses-editor-field';
            const classLabel = document.createElement("label");
            classLabel.className = 'courses-editor-label';
            classLabel.textContent = "Klasse / Kursbezeichnung:";
            const classInput = document.createElement("input");
            classInput.id = 'course-editor-class-label';
            classInput.type = "text";
            classLabel.setAttribute('for', classInput.id);
            classInput.value = currentCourse.classLabel || "";
            classInput.style.width = "100%";
            classInput.style.boxSizing = "border-box";
            classInput.addEventListener("change", async function () {
              await saveCourseTextInput(this, 'classLabel', this.value.trim(), '', 'Die Kursbezeichnung konnte nicht gespeichert werden');
            });
            classWrapper.appendChild(classLabel);
            classWrapper.appendChild(classInput);

            // Feld: Schema-Modus
            const schemaWrapper = document.createElement("div");
            schemaWrapper.className = 'courses-editor-field';
            const schemaLabel = document.createElement("label");
            schemaLabel.className = 'courses-editor-label';
            schemaLabel.textContent = "Bewertungsschema:";
            const schemaSelect = document.createElement("select");
            schemaSelect.id = 'course-editor-schema';
            schemaLabel.setAttribute('for', schemaSelect.id);

            const optGrades = document.createElement("option");
            optGrades.value = DomainModel.SCHEMA_MODES.GRADES;
            optGrades.textContent = "Noten (1–6 mit +/–)";
            const optUpper = document.createElement("option");
            optUpper.value = DomainModel.SCHEMA_MODES.UPPERSEC;
            optUpper.textContent = "Punkte (0–15, Sek II)";

            schemaSelect.appendChild(optGrades);
            schemaSelect.appendChild(optUpper);

            schemaSelect.value =
              currentCourse.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                ? DomainModel.SCHEMA_MODES.UPPERSEC
                : DomainModel.SCHEMA_MODES.GRADES;

            schemaWrapper.appendChild(schemaLabel);
            schemaWrapper.appendChild(schemaSelect);

            // Feld: Gewichtungsvorlage
            const wtWrapper = document.createElement("div");
            wtWrapper.className = 'courses-editor-field';
            const wtLabel = document.createElement("label");
            wtLabel.className = 'courses-editor-label';
            wtLabel.textContent = "Gewichtungsvorlage:";
            const wtSelect = document.createElement("select");
            wtSelect.id = 'course-editor-weight-template';
            wtLabel.setAttribute('for', wtSelect.id);

            const optNone = document.createElement("option");
            optNone.value = "";
            optNone.textContent = "Gleichverteilung (alle aktiven Kategorien gleich)";
            wtSelect.appendChild(optNone);

            for (const wt of state.settings.weightTemplates || []) {
              const opt = document.createElement("option");
              opt.value = wt.id;
              opt.textContent = wt.name || "Vorlage";
              wtSelect.appendChild(opt);
            }

            wtSelect.value = currentCourse.weightTemplateId || "";

            wtSelect.addEventListener("change", async function () {
              const courseId = currentCourse.id;
              const templateId = this.value || null;
              try {
                await commitStateChange(function (candidate) {
                  const candidateCourse = requireActiveCourse(candidate, courseId);
                  if (templateId && !(candidate.settings.weightTemplates || []).some(function (item) { return item.id === templateId; })) {
                    throw new Error('Die Gewichtungsvorlage ist nicht mehr verfügbar.');
                  }
                  candidateCourse.weightTemplateId = templateId;
                });
              } catch (error) {
                const confirmed = DomainModel.findCourseById(state, courseId);
                this.value = confirmed ? (confirmed.weightTemplateId || '') : '';
                if (!isStateCommitAborted(error)) {
                  try { window.alert('Gewichtung konnte nicht gespeichert werden: ' + error.message); } catch (e) {}
                }
              }
            });

            wtWrapper.appendChild(wtLabel);
            wtWrapper.appendChild(wtSelect);

            const gradingForm = document.createElement('div');
            gradingForm.className = 'courses-editor-fields';

            // Allgemeine Angaben und Bewertung bleiben in ihren jeweiligen Bereichen.
            form.appendChild(nameWrapper);
            form.appendChild(subjWrapper);
            const symbolPicker = createCourseSymbolPicker({
              document, id: 'course-editor-symbol', course: currentCourse,
              onChange: async function (symbolId) {
                if (!dashboardIsAllowed()) return;
                const courseId = currentCourse.id;
                try {
                  await commitStateChange(function (candidate) {
                    const edited = requireActiveCourse(candidate, courseId);
                    if (symbolId) edited.symbolId = symbolId;
                    else delete edited.symbolId;
                  });
                }
                catch (error) {
                  const confirmed = DomainModel.findCourseById(state, courseId);
                  symbolPicker.select.value = confirmed && confirmed.symbolId
                    ? confirmed.symbolId
                    : 'auto';
                  symbolPicker.updatePreview(subjInput.value);
                  if (!isStateCommitAborted(error)) window.alert('Das Kurssymbol konnte nicht gespeichert werden. Die bisherige Auswahl bleibt erhalten.');
                }
              }
            });
            subjInput.addEventListener('input', () => symbolPicker.updatePreview(subjInput.value));
            form.appendChild(symbolPicker.root);
            form.appendChild(classWrapper);
            gradingForm.appendChild(schemaWrapper);
            gradingForm.appendChild(wtWrapper);
            const contextHost = document.createElement('div');
            contextHost.style.display = 'contents';
            gradingForm.appendChild(contextHost);
            const contextTerm = GradingLogic.resolveAssessmentTermFromDateValue(
              new Date(),
              currentCourse,
              state.settings
            );
            bindCourseSchemaContextEditor({
              readState: function () { return state; },
              courseId: currentCourse.id,
              schemaSelect,
              contextHost,
              term: contextTerm,
              getWeightTemplateId: function () { return wtSelect.value || null; },
              commitStateChange,
              onError: function (error) {
                try { window.alert('Schema oder Sek-II-Kontext konnte nicht gespeichert werden: ' + error.message); } catch (e) {}
              }
            });

            // Sek-I-Jahreswertung ist nicht optional und wird nur erläutert.
            const prevWrapper = document.createElement("div");
            const prevCheckbox = document.createElement("input");
            prevCheckbox.type = "checkbox";
            prevCheckbox.checked = true;
            const prevInfo = document.createElement("div");
            prevInfo.className = "section-hint";
            prevInfo.textContent = "Sek I: H1 wird einzeln ausgewertet; am Ende von H2 zählen automatisch alle Einzelbewertungen aus H1 und H2.";
            prevWrapper.appendChild(prevInfo);
            if (currentCourse.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
              gradingForm.appendChild(prevWrapper);
            }

            // Halbjahres-Stichtage für diesen Kurs (Optional Override)
            const cutoffWrapper = document.createElement("div");
            cutoffWrapper.style.gridColumn = '1 / -1';
            cutoffWrapper.style.marginTop = '0.6rem';
            cutoffWrapper.style.padding = '0.5rem';
            cutoffWrapper.style.border = '1px dashed var(--border-soft)';
            cutoffWrapper.style.borderRadius = '6px';

            const cutoffToggleLabel = document.createElement('label');
            cutoffToggleLabel.style.display = 'flex';
            cutoffToggleLabel.style.alignItems = 'center';
            cutoffToggleLabel.style.gap = '0.45rem';
            cutoffToggleLabel.style.fontWeight = '600';
            const cutoffToggle = document.createElement('input');
            cutoffToggle.type = 'checkbox';
            cutoffToggle.checked = !!(currentCourse.termCutoffs && currentCourse.termCutoffs.h1EndMonth);
            cutoffToggleLabel.appendChild(cutoffToggle);
            cutoffToggleLabel.appendChild(document.createTextNode('Eigene Halbjahres-Stichtage für diesen Kurs'));
            cutoffWrapper.appendChild(cutoffToggleLabel);

            const cutoffHint = document.createElement('div');
            cutoffHint.className = 'text-muted';
            cutoffHint.style.fontSize = '0.82rem';
            cutoffHint.style.marginTop = '0.35rem';
            cutoffHint.textContent = 'Der H2-Start entscheidet über die Zuordnung; das H1-Ende ist informativ. Tage in einer Lücke bleiben H1, bei einer Überlappung hat H2 ab seinem Beginn Vorrang.';
            cutoffWrapper.appendChild(cutoffHint);

            const cutoffFields = document.createElement('div');
            cutoffFields.style.display = cutoffToggle.checked ? 'flex' : 'none';
            cutoffFields.style.gap = '0.6rem';
            cutoffFields.style.marginTop = '0.5rem';
            cutoffFields.style.flexWrap = 'wrap';
            cutoffFields.style.alignItems = 'center';

            const courseTermBoundaries = GradingLogic.resolveSchoolYearBoundaries(
              new Date(), currentCourse, state.settings
            );
            const formatBoundaryInput = boundary => boundary
              ? `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, '0')}-${String(boundary.getDate()).padStart(2, '0')}`
              : '';

            const h1EndLabel = document.createElement('label');
            h1EndLabel.textContent = 'H1 Ende:';
            const h1EndInput = document.createElement('input');
            h1EndInput.type = 'date';
            h1EndInput.style.width = '10.5rem';
            if (currentCourse.termCutoffs && currentCourse.termCutoffs.h1EndMonth && courseTermBoundaries) {
              h1EndInput.value = formatBoundaryInput(courseTermBoundaries.h1End);
            }
            h1EndLabel.appendChild(h1EndInput);

            const h2StartLabel = document.createElement('label');
            h2StartLabel.textContent = 'H2 Start:';
            const h2StartInput = document.createElement('input');
            h2StartInput.type = 'date';
            h2StartInput.style.width = '10.5rem';
            if (currentCourse.termCutoffs && currentCourse.termCutoffs.h2StartMonth && courseTermBoundaries) {
              h2StartInput.value = formatBoundaryInput(courseTermBoundaries.h2Start);
            }
            h2StartLabel.appendChild(h2StartInput);

            cutoffFields.appendChild(h1EndLabel);
            cutoffFields.appendChild(h2StartLabel);
            cutoffWrapper.appendChild(cutoffFields);

            cutoffToggle.addEventListener('change', () => {
              cutoffFields.style.display = cutoffToggle.checked ? 'flex' : 'none';
            });

            const saveCutoffBtn = document.createElement('button');
            saveCutoffBtn.type = 'button';
            saveCutoffBtn.textContent = 'Stichtage speichern';
            saveCutoffBtn.style.marginTop = '0.4rem';
            saveCutoffBtn.addEventListener('click', async () => {
              let nextCutoffs = null;
              if (!cutoffToggle.checked) {
                nextCutoffs = null;
              } else {
                if (!h1EndInput.value || !h2StartInput.value) {
                  try { window.alert('Bitte beide Stichtage (H1 Ende und H2 Start) ausfüllen.'); } catch (e) {}
                  return;
                }
                const h1d = parseHalfYearDateValue(h1EndInput.value);
                const h2d = parseHalfYearDateValue(h2StartInput.value);
                if (!h1d || !h2d) {
                  try { window.alert('Bitte gültige Stichtage verwenden.'); } catch (e) {}
                  return;
                }
                nextCutoffs = {
                  h1EndMonth: h1d.getMonth() + 1,
                  h1EndDay: h1d.getDate(),
                  h2StartMonth: h2d.getMonth() + 1,
                  h2StartDay: h2d.getDate()
                };
              }
              const courseId = currentCourse.id;
              try {
                await commitStateChange(function (candidate) {
                  requireActiveCourse(candidate, courseId).termCutoffs = nextCutoffs;
                  recalcAssessmentTermsForCurrentState(candidate, courseId);
                });
              } catch (error) {
                if (!isStateCommitAborted(error)) window.alert('Die Stichtage konnten nicht gespeichert werden: ' + error.message);
              }
            });
            cutoffWrapper.appendChild(saveCutoffBtn);

            form.appendChild(cutoffWrapper);

            generalPanel.appendChild(form);

            const smallHint = document.createElement("div");
            smallHint.className = 'courses-editor-effect text-muted';
            smallHint.textContent =
              "Hinweis: Änderungen am Bewertungsschema oder an der Gewichtung wirken sich sofort auf die Berechnung der " +
              getOverallMetricLabel(currentCourse.schemaMode, "plural") + " aus.";
            gradingPanel.appendChild(gradingForm);
            gradingPanel.appendChild(smallHint);

            // --- Schüler im Kurs anzeigen und verwalten ---
            const enrolledBox = document.createElement("div");
            enrolledBox.style.marginTop = "0.75rem";

            const enrolledTitle = document.createElement("div");
            enrolledTitle.style.fontSize = "0.9rem";
            enrolledTitle.style.fontWeight = "600";
            enrolledTitle.textContent = "Schüler im Kurs:";
            enrolledBox.appendChild(enrolledTitle);

            const enrollments = DomainModel.listEnrollmentsForCourse(state, currentCourse.id);

            // Formular zum Hinzufügen: aus Stammdaten oder als neuer Schüler
            const manageRow = document.createElement("div");
            manageRow.style.display = "flex";
            manageRow.style.flexWrap = "wrap";
            manageRow.style.gap = "0.5rem";
            manageRow.style.alignItems = "center";
            manageRow.style.marginTop = "0.35rem";

            // --- 1) Vorhandene Schüler aus Stammdaten hinzufügen ---
            const existingSelect = document.createElement("select");
            existingSelect.id = 'course-editor-existing-student';
            existingSelect.style.minWidth = "220px";
            const existingSelectLabel = document.createElement('label');
            existingSelectLabel.className = 'courses-editor-label';
            existingSelectLabel.setAttribute('for', existingSelect.id);
            existingSelectLabel.textContent = 'Schüler aus Stammdaten:';

            const placeholderOpt = document.createElement("option");
            placeholderOpt.value = "";
            placeholderOpt.textContent = "Schüler aus Stammdaten wählen…";
            existingSelect.appendChild(placeholderOpt);

            const enrolledIds = new Set(enrollments.map(e => e.studentId));
            const availableStudents = (state.students || []).filter(stu => !enrolledIds.has(stu.id));

            for (const stu of availableStudents) {
              const opt = document.createElement("option");
              opt.value = stu.id;
              opt.textContent =
                (stu.lastName || "") + ", " + (stu.firstName || "");
              existingSelect.appendChild(opt);
            }

            const addExistingBtn = document.createElement("button");
            addExistingBtn.type = "button";
            addExistingBtn.textContent = "aus Stammdaten hinzufügen";
            addExistingBtn.addEventListener("click", async function () {
              const stuId = existingSelect.value;
              if (!stuId) {
                window.alert("Bitte zuerst einen Schüler aus der Liste wählen.");
                return;
              }
              const courseId = currentCourse.id;
              try {
                await commitStateChange(function (candidate) {
                  requireActiveCourse(candidate, courseId);
                  requireStudent(candidate, stuId);
                  DomainModel.enrollStudentInCourse(candidate, courseId, stuId, null);
                });
              } catch (error) {
                if (!isStateCommitAborted(error)) window.alert('Die Person konnte nicht aufgenommen werden: ' + error.message);
              }
            });

            manageRow.appendChild(existingSelectLabel);
            manageRow.appendChild(existingSelect);
            manageRow.appendChild(addExistingBtn);

            // Zeilenumbruch innerhalb des Flex-Containers
            const sep = document.createElement("div");
            sep.style.flexBasis = "100%";
            sep.style.height = "0";
            manageRow.appendChild(sep);

            // --- 2) Neuen Schüler anlegen und direkt in den Kurs aufnehmen ---
            const lnInput = document.createElement("input");
            lnInput.type = "text";
            lnInput.placeholder = "Nachname";

            const fnInput = document.createElement("input");
            fnInput.type = "text";
            fnInput.placeholder = "Vorname";

            const bdInput = document.createElement("input");
            bdInput.type = "text";
            bdInput.placeholder = "Geburtstag (optional)";

            const addNewBtn = document.createElement("button");
            addNewBtn.type = "button";
            addNewBtn.textContent = "neuen Schüler anlegen";

            addNewBtn.addEventListener("click", async function () {
              const ln = (lnInput.value || "").trim();
              const fn = (fnInput.value || "").trim();
              const bd = (bdInput.value || "").trim();

              if (!ln && !fn) {
                window.alert("Bitte mindestens Nachname oder Vorname angeben.");
                return;
              }

              const courseId = currentCourse.id;
              addNewBtn.disabled = true;
              try {
                await commitStateChange(function (candidate) {
                  const candidateCourse = requireActiveCourse(candidate, courseId);
                  const stu = DomainModel.createStudent({
                    lastName: ln,
                    firstName: fn,
                    birthDate: bd || null,
                    homeClass: candidateCourse.classLabel || ''
                  });
                  DomainModel.addStudentToState(candidate, stu);
                  DomainModel.enrollStudentInCourse(candidate, courseId, stu.id, null);
                });
                lnInput.value = '';
                fnInput.value = '';
                bdInput.value = '';
              } catch (error) {
                if (!isStateCommitAborted(error)) window.alert('Die Person konnte nicht angelegt werden: ' + error.message);
              } finally {
                addNewBtn.disabled = false;
              }
            });

            manageRow.appendChild(lnInput);
            manageRow.appendChild(fnInput);
            manageRow.appendChild(bdInput);
            manageRow.appendChild(addNewBtn);

            enrolledBox.appendChild(manageRow);

            if (enrollments.length === 0) {
              const p = document.createElement("div");
              p.className = "text-muted";
              p.style.fontSize = "0.85rem";
              p.textContent =
                "Noch keine Schüler in diesem Kurs. Du kannst sie oben aus den Stammdaten auswählen oder neu anlegen.";
              enrolledBox.appendChild(p);
            } else {
              const ul = document.createElement("ul");
              ul.style.listStyle = "none";
              ul.style.paddingLeft = "0";
              // Klarere Trennung der Einträge
              ul.style.marginTop = "0.25rem";

              for (const enr of enrollments) {
                const stu = DomainModel.findStudentById(state, enr.studentId);
                if (!stu) continue;

                const li = document.createElement("li");
                li.style.display = "flex";
                li.style.alignItems = "center";
                li.style.justifyContent = "space-between";
                li.style.gap = "0.5rem";
                li.style.fontSize = "0.85rem";
                // Visuelle Linie je Eintrag, damit Button-Zugehörigkeit klar ist
                li.style.padding = "0.35rem 0";
                li.style.borderBottom = "1px solid var(--border-soft)";

                const nameSpan = document.createElement("span");
                const classHint = stu.homeClass ? " (" + stu.homeClass + ")" : "";
                nameSpan.textContent =
                  (stu.lastName || "") + ", " + (stu.firstName || "") + classHint;
                li.appendChild(nameSpan);

                if (canManageWrittenExamSubjectQ4(currentCourse)) {
                  const examLabel = document.createElement('label');
                  examLabel.style.display = 'flex';
                  examLabel.style.alignItems = 'center';
                  examLabel.style.gap = '0.35rem';
                  const examCheckbox = document.createElement('input');
                  examCheckbox.type = 'checkbox';
                  examCheckbox.checked = enr.writtenExamSubjectQ4 === true;
                  examCheckbox.setAttribute('aria-label', 'In Q4 schriftliches 3. Prüfungsfach');
                  examLabel.appendChild(examCheckbox);
                  examLabel.appendChild(document.createTextNode('Q4: schriftliches 3. Prüfungsfach'));
                  examCheckbox.addEventListener('change', async function () {
                    const nextValue = this.checked === true;
                    if (!nextValue) {
                      const conflicts = listExistingQ4WrittenScoresForStudent(
                        state,
                        currentCourse,
                        stu.id,
                        state.settings
                      );
                      if (conflicts.length > 0) {
                        const accepted = window.confirm(
                          'Für diese Person sind bereits ' + conflicts.length +
                          ' Q4-Klausurwert(e) gespeichert. Die Werte bleiben erhalten, werden aber nicht gewertet. Kennzeichnung trotzdem entfernen?'
                        );
                        if (!accepted) {
                          this.checked = true;
                          return;
                        }
                      }
                    }
                    try {
                      const courseId = currentCourse.id;
                      const studentId = stu.id;
                      await commitStateChange(function (candidate) {
                        const candidateCourse = requireActiveCourse(candidate, courseId);
                        requireStudent(candidate, studentId);
                        if (!(candidateCourse.enrollments || []).some(function (item) { return item.studentId === studentId; })) {
                          throw new Error('Die Person ist dem Kurs nicht mehr zugeordnet.');
                        }
                        applyWrittenExamSubjectQ4Change(candidate, courseId, studentId, nextValue);
                      });
                    } catch (error) {
                      this.checked = !nextValue;
                      if (!isStateCommitAborted(error)) {
                        try { window.alert('Q4-Kennzeichnung konnte nicht gespeichert werden: ' + error.message); } catch (e) {}
                      }
                    }
                  });
                  li.appendChild(examLabel);
                }

                const btnRow = document.createElement("div");
                btnRow.style.display = "flex";
                btnRow.style.gap = "0.3rem";
                // Vertikale Trennlinie vor den Aktionen
                btnRow.style.borderLeft = "2px solid var(--border-soft)";
                btnRow.style.paddingLeft = "0.5rem";

                // Nur aus diesem Kurs entfernen
                const removeFromCourseBtn = document.createElement("button");
                removeFromCourseBtn.type = "button";
                removeFromCourseBtn.textContent = "aus Kurs entfernen";
                removeFromCourseBtn.addEventListener("click", async function () {
                  const ok = window.confirm(
                    "Schüler nur aus diesem Kurs entfernen?\n\nHinweis: Die bereits gespeicherten Noten bleiben beim Schüler archiviert und werden nicht gelöscht."
                  );
                  if (!ok) return;
                  try {
                    await commitStateChange(function (candidate) {
                      const course = requireActiveCourse(candidate, currentCourse.id);
                      requireStudent(candidate, stu.id);
                      if (!Array.isArray(course.enrollments)) course.enrollments = [];
                      course.enrollments = course.enrollments.filter(function (enrollment) {
                        return enrollment.studentId !== stu.id;
                      });
                    });
                  } catch (error) {
                    try { window.alert('Die Änderung wurde nicht gespeichert: ' + error.message); } catch (e) {}
                  }
                });
                btnRow.appendChild(removeFromCourseBtn);

                // Schüler komplett löschen
                const deleteStudentBtn = document.createElement("button");
                deleteStudentBtn.type = "button";
                deleteStudentBtn.textContent = "Schüler löschen";
                deleteStudentBtn.className = "danger";
                deleteStudentBtn.addEventListener("click", async function () {
                  const ok = window.confirm(
                    "Schüler komplett löschen? Er wird aus allen Kursen entfernt und alle Noteneinträge werden gelöscht."
                  );
                  if (!ok) return;
                  try {
                    await commitStateChange(function (candidate) {
                      requireStudent(candidate, stu.id);
                      const removalResult = DomainModel.removeStudentFromState(candidate, stu.id);
                      if (removalResult === false) {
                        throw new Error('Dieser Schüler ist Bestandteil eines archivierten Kurses und kann nicht gelöscht werden. Stelle den Kurs zuerst wieder her oder bewahre die Dokumentation auf.');
                      }
                      if (removalResult !== true) {
                        throw new Error('Der Schülerdatensatz ist unvollständig und kann nicht gelöscht werden.');
                      }
                    });
                  } catch (error) {
                    const knownDomainMessage = error && (
                      error.message === 'Dieser Schüler ist Bestandteil eines archivierten Kurses und kann nicht gelöscht werden. Stelle den Kurs zuerst wieder her oder bewahre die Dokumentation auf.' ||
                      error.message === 'Der Schülerdatensatz ist unvollständig und kann nicht gelöscht werden.'
                    );
                    try {
                      window.alert(knownDomainMessage
                        ? error.message
                        : 'Die Änderung wurde nicht gespeichert: ' + (error.message || 'Unbekannter Speicherfehler'));
                    } catch (e) {}
                  }
                });
                btnRow.appendChild(deleteStudentBtn);

                li.appendChild(btnRow);
                ul.appendChild(li);
              }

              enrolledBox.appendChild(ul);
            }
            studentsPanel.appendChild(enrolledBox);

            const archiveCourseBtn = document.createElement("button");
            archiveCourseBtn.type = "button";
            archiveCourseBtn.textContent = "Kurs archivieren";
            archiveCourseBtn.style.marginTop = "0.6rem";
            archiveCourseBtn.addEventListener("click", async function () {
              const courseId = currentCourse.id;
              const completed = await requestArchiveMetadata({
                title: "Kurs archivieren: " + (currentCourse.name || "Kurs"),
                description: "Der Kurs wird schreibgeschützt. Leistungen, Zuordnungen und Bewertungsgrundlagen bleiben erhalten.",
                confirmLabel: "Kurs archivieren",
                formatSaveError: error => "Der Kurs wurde nicht archiviert: " + error.message,
                onConfirm: metadata => commitStateChange(function (nextState) {
                  requireActiveCourse(nextState, courseId);
                  if (!DomainModel.archiveCourse(nextState, courseId, 'manual', metadata)) {
                    throw new Error('Der Kurs konnte nicht archiviert werden.');
                  }
                }, { render: false })
              });
              if (!completed) return;
              currentCourseId = DomainModel.listActiveCourses(completed.value)[0]?.id || null;
              render();
            });
            const courseActions = document.createElement('div');
            courseActions.className = 'courses-editor-actions';
            courseActions.appendChild(archiveCourseBtn);


            // --- Kurs löschen ---
            const delCourseBtn = document.createElement("button");
            delCourseBtn.type = "button";
            delCourseBtn.textContent = "Kurs löschen";
            delCourseBtn.className = "danger";
            delCourseBtn.style.marginTop = "0.6rem";

            delCourseBtn.addEventListener("click", async function () {
              const ok = window.confirm(
                "Diesen Kurs inklusive aller zugehörigen Leistungen und Noten wirklich löschen?"
              );
              if (!ok) return;
              try {
                const candidate = await commitStateChange(function (nextState) {
                  requireActiveCourse(nextState, currentCourse.id);
                  DomainModel.removeCourseFromState(nextState, currentCourse.id);
                }, { render: false });
                const remainingActive = DomainModel.listActiveCourses(candidate);
                currentCourseId = remainingActive.length > 0 ? remainingActive[0].id : null;
                render();
              } catch (error) {
                try { window.alert('Die Änderung wurde nicht gespeichert: ' + error.message); } catch (e) {}
              }
            });

            courseActions.appendChild(delCourseBtn);
            generalPanel.appendChild(courseActions);


            section.appendChild(detailBox);
          }

          section.appendChild(notices);

          function showArchivedCourseDetails(archived, triggerButton) {
            const archivedAssessments = DomainModel.listAssessmentsForCourse(state, archived.id);
            const snapshot = archived.archiveSnapshot && typeof archived.archiveSnapshot === "object" ? archived.archiveSnapshot : null;
            const archivedCourseForEvaluation = snapshot
              ? {
                  ...archived,
                  upperSecContext: snapshot.upperSecContext || archived.upperSecContext || null,
                  enrollments: Array.isArray(snapshot.enrollments) ? snapshot.enrollments : (archived.enrollments || [])
                }
              : archived;
            const archivedEvaluationSettings = GradingLogic.getSettingsForCourse(archivedCourseForEvaluation, state);
            const snapshotCategories = snapshot && Array.isArray(snapshot.categories) ? snapshot.categories : (state.settings.categories || []);
            const categoryById = new Map(snapshotCategories.map(category => [category.id, category]));
            const referencedStudentIds = DomainModel.listReferencedStudentIdsForCourse(state, archived.id);
            const enrollmentByStudentId = new Map((archivedCourseForEvaluation.enrollments || []).map(enrollment => [enrollment.studentId, enrollment]));
            const archivedStudents = Array.from(referencedStudentIds)
              .map(studentId => DomainModel.findStudentById(state, studentId))
              .filter(Boolean)
              .sort((a, b) => compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName));

            function deriveArchivedTermFromDateValue(date, course) {
              const settings = GradingLogic.getSettingsForCourse(course, state);
              return resolveAssessmentTermFromDateValue(date, course, settings);
            }

            function formatArchiveTerm(term) {
              return GradingLogic.formatCourseTermLabel(
                term,
                archivedCourseForEvaluation,
                archivedEvaluationSettings,
                { fullStartYear: true }
              ) || "–";
            }

            const overlay = document.createElement("div");
            overlay.dataset.sessionSensitiveOverlay = "true";
            overlay.style.position = "fixed";
            overlay.style.inset = "0";
            overlay.style.background = "rgba(0,0,0,0.55)";
            overlay.style.display = "flex";
            overlay.style.alignItems = "center";
            overlay.style.justifyContent = "center";
            overlay.style.padding = "1rem";
            overlay.style.zIndex = "100400";

            const dialog = document.createElement("div");
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.style.background = "var(--bg-card, #fff)";
            dialog.style.color = "var(--text-main, #111)";
            dialog.style.borderRadius = "10px";
            dialog.style.padding = "1rem";
            dialog.style.width = "min(900px, 96vw)";
            dialog.style.maxHeight = "88vh";
            dialog.style.overflow = "auto";
            dialog.style.boxShadow = "0 12px 42px rgba(0,0,0,0.35)";

            const titleId = DomainModel.generateId("archive_detail_title");
            const headingRow = document.createElement("div");
            headingRow.style.display = "flex";
            headingRow.style.alignItems = "flex-start";
            headingRow.style.justifyContent = "space-between";
            headingRow.style.gap = "1rem";
            const title = document.createElement("h3");
            title.id = titleId;
            title.style.margin = "0";
            title.textContent = "Archivierter Kurs: " + (archived.name || "Kurs");
            dialog.setAttribute("aria-labelledby", titleId);
            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.textContent = "Schließen";
            closeButton.setAttribute("aria-label", "Archivdetails schließen");
            headingRow.appendChild(title);
            headingRow.appendChild(closeButton);
            dialog.appendChild(headingRow);

            const readOnlyHint = document.createElement("div");
            readOnlyHint.className = "text-muted";
            readOnlyHint.style.margin = "0.35rem 0 0.75rem";
            readOnlyHint.textContent = "Nur-Lese-Ansicht: Leistungsdaten und Bewertungsgrundlagen können nicht geändert werden. Aufbewahrungsangaben lassen sich separat in der Archivliste bearbeiten.";
            dialog.appendChild(readOnlyHint);

            const metadata = document.createElement("div");
            metadata.className = "info-box";
            function appendMetadata(label, value) {
              const row = document.createElement("div");
              const strong = document.createElement("strong");
              strong.textContent = label + ": ";
              row.appendChild(strong);
              row.appendChild(document.createTextNode(value || "–"));
              metadata.appendChild(row);
            }
            const schoolYear = Number.isInteger(Number(archived.schoolYearStartYear))
              ? archived.schoolYearStartYear + "/" + String(Number(archived.schoolYearStartYear) + 1).slice(-2)
              : "–";
            appendMetadata("Fach", archived.subject || "–");
            appendMetadata("Klasse/Kurs", archived.classLabel || "–");
            appendMetadata("Bewertungsschema", archived.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC ? "Oberstufenpunkte 0–15" : "Noten 1–6");
            if (archived.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
              const archivedContext = archivedCourseForEvaluation.upperSecContext || {};
              const courseTypeLabels = { basic: "Grundkurs", advanced: "Leistungskurs", other: "Sonstiger Kurs" };
              const qualificationLabels = { "q1-q2": "Q1/Q2", "q3-q4": "Q3/Q4" };
              appendMetadata("Kursart", courseTypeLabels[archivedContext.courseType] || "Kontext unvollständig");
              appendMetadata("Qualifikationsabschnitt", qualificationLabels[archivedContext.qualificationYear] || "Kontext unvollständig");
              appendMetadata("Historische Gewichtung", snapshot && snapshot.weightTemplate
                ? (snapshot.weightTemplate.name || "Gespeicherte Vorlage")
                : "Gleichverteilung / keine gespeicherte Vorlage");
              if (archivedContext.weightingDeviationReason) {
                appendMetadata("Optionale Begründung", archivedContext.weightingDeviationReason);
              }
            }
            appendMetadata("Schuljahr", schoolYear);
            appendMetadata("Archiviert am", formatInstant(archived.archivedAt, {
              locale: DISPLAY_LOCALE,
              timeZone: DISPLAY_TIME_ZONE
            }) ?? "–");
            appendMetadata("Archivgrund", archived.archiveReason || "–");
            appendMetadata("Aufbewahren bis", formatCalendarDate(archived.archiveRetentionUntil, {
              locale: DISPLAY_LOCALE
            }) ?? "–");
            appendMetadata("Archivnotiz", archived.archiveNote || "–");
            appendMetadata("Umfang", archivedStudents.length + " Schüler:innen, " + archivedAssessments.length + " Leistungen");
            dialog.appendChild(metadata);

            const studentsHeading = document.createElement("h4");
            studentsHeading.textContent = "Schüler:innen";
            dialog.appendChild(studentsHeading);
            if (archivedStudents.length === 0) {
              const empty = document.createElement("p");
              empty.className = "text-muted";
              empty.textContent = "Keine zugeordneten Schüler:innen vorhanden.";
              dialog.appendChild(empty);
            } else {
              const studentTable = document.createElement("table");
              const studentHead = document.createElement("thead");
              const studentHeadRow = document.createElement("tr");
              const studentHeaders = ["Name", "Stammklasse beim Kursbesuch"];
              const showUpperSecResults = archived.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC;
              const showWrittenExamFlag = !!(
                archivedCourseForEvaluation.upperSecContext &&
                archivedCourseForEvaluation.upperSecContext.courseType === DomainModel.UPPERSEC_COURSE_TYPES.BASIC &&
                archivedCourseForEvaluation.upperSecContext.qualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4
              );
              if (showWrittenExamFlag) studentHeaders.push("Q4: schriftliches 3. Prüfungsfach");
              if (showUpperSecResults) studentHeaders.push("Ergebnisse (Nur-Lese-Ansicht)");
              studentHeaders.forEach(label => {
                const th = document.createElement("th"); th.scope = "col"; th.textContent = label; studentHeadRow.appendChild(th);
              });
              studentHead.appendChild(studentHeadRow); studentTable.appendChild(studentHead);
              const studentBody = document.createElement("tbody");
              for (const student of archivedStudents) {
                const row = document.createElement("tr");
                const nameCell = document.createElement("td");
                nameCell.textContent = (student.lastName || "") + ", " + (student.firstName || "");
                const classCell = document.createElement("td");
                const enrollment = enrollmentByStudentId.get(student.id);
                classCell.textContent = (enrollment && enrollment.homeClassAtEnrollment) || student.homeClass || "–";
                row.appendChild(nameCell); row.appendChild(classCell);
                if (showWrittenExamFlag) {
                  const examCell = document.createElement('td');
                  examCell.textContent = enrollment && enrollment.writtenExamSubjectQ4 === true ? 'Ja' : 'Nein';
                  row.appendChild(examCell);
                }
                if (showUpperSecResults) {
                  const resultsCell = document.createElement("td");
                  const getArchivedAssessmentTerm = assessment =>
                    getAssessmentTerm(assessment, archived, deriveArchivedTermFromDateValue);
                  const assessmentTerms = archivedAssessments
                    .filter(assessment => assessment.scores && assessment.scores[student.id])
                    .map(getArchivedAssessmentTerm)
                    .filter(term => /^\d{4}-H[12]$/.test(String(term || "")));
                  const reportedTerms = listReportedTermsForStudent(archived, student.id, assessmentTerms);
                  if (reportedTerms.length === 0) {
                    resultsCell.textContent = "Keine halbjahresbezogenen Ergebnisse";
                  } else {
                    for (const term of reportedTerms) {
                      const presentation = buildUpperSecContextPresentation(archived, student.id, term, state);
                      const resultLine = document.createElement("div");
                      resultLine.textContent = formatArchiveTerm(term) + " (" + presentation.qualificationPhase + ", " +
                        presentation.courseTypeLabel + ", " + presentation.examRequirementLabel + "): " +
                        presentation.calculatedLabel + ": " + presentation.calculatedText +
                        (Number.isInteger(presentation.finalizedPoints)
                          ? "; " + presentation.finalizedLabel + ": " + presentation.finalizedPoints
                          : "");
                      resultsCell.appendChild(resultLine);
                    }
                  }
                  row.appendChild(resultsCell);
                }
                studentBody.appendChild(row);
              }
              studentTable.appendChild(studentBody); dialog.appendChild(studentTable);
            }

            const assessmentsHeading = document.createElement("h4");
            assessmentsHeading.textContent = "Leistungen";
            dialog.appendChild(assessmentsHeading);
            if (archivedAssessments.length === 0) {
              const empty = document.createElement("p");
              empty.className = "text-muted";
              empty.textContent = "Keine Leistungen vorhanden.";
              dialog.appendChild(empty);
            } else {
              const assessmentTable = document.createElement("table");
              const assessmentHead = document.createElement("thead");
              const assessmentHeadRow = document.createElement("tr");
              ["Leistung", "Kategorie", "Datum", "Halbjahr", "Einträge"].forEach(label => {
                const th = document.createElement("th"); th.scope = "col"; th.textContent = label; assessmentHeadRow.appendChild(th);
              });
              assessmentHead.appendChild(assessmentHeadRow); assessmentTable.appendChild(assessmentHead);
              const assessmentBody = document.createElement("tbody");
              for (const assessment of archivedAssessments) {
                const row = document.createElement("tr");
                const category = categoryById.get(assessment.categoryId);
                const subcategory = assessment.subcategoryId && category && Array.isArray(category.subcategories)
                  ? category.subcategories.find(item => item.id === assessment.subcategoryId)
                  : null;
                const values = [
                  assessment.title || "Leistung",
                  (category && category.name ? category.name : "Ohne Kategorie") + (subcategory && subcategory.name ? " / " + subcategory.name : ""),
                  assessment.date || "–",
                  formatArchiveTerm(assessment.term)
                ];
                for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); }

                const scoreStudentIds = Object.keys(assessment.scores || {});
                const entriesCell = document.createElement("td");
                entriesCell.appendChild(document.createTextNode(String(scoreStudentIds.length)));
                const scoreDetails = document.createElement("details");
                scoreDetails.style.marginTop = "0.35rem";
                const scoreSummary = document.createElement("summary");
                scoreSummary.style.cursor = "pointer";
                scoreSummary.textContent = "Einzelnoten (" + scoreStudentIds.length + ")";
                scoreDetails.appendChild(scoreSummary);

                if (scoreStudentIds.length === 0) {
                  const emptyScores = document.createElement("p");
                  emptyScores.className = "text-muted";
                  emptyScores.textContent = "Keine Einzelnoten vorhanden.";
                  scoreDetails.appendChild(emptyScores);
                } else {
                  const scoreTable = document.createElement("table");
                  scoreTable.style.marginTop = "0.5rem";
                  const scoreHead = document.createElement("thead");
                  const scoreHeadRow = document.createElement("tr");
                  const scoreValueHeading = archived.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC ? "Punkte" : "Note";
                  ["Name", scoreValueHeading, "Status"].forEach(label => {
                    const th = document.createElement("th");
                    th.scope = "col";
                    th.textContent = label;
                    scoreHeadRow.appendChild(th);
                  });
                  scoreHead.appendChild(scoreHeadRow);
                  scoreTable.appendChild(scoreHead);

                  const scoreBody = document.createElement("tbody");
                  const scoreStudents = scoreStudentIds
                    .map(studentId => DomainModel.findStudentById(state, studentId))
                    .filter(Boolean)
                    .sort((a, b) => compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName));
                  for (const student of scoreStudents) {
                    const presentation = formatReportScorePresentation(
                      archivedCourseForEvaluation,
                      assessment,
                      student.id,
                      archivedEvaluationSettings,
                      "internal"
                    );
                    const statusLabels = {
                      [DomainModel.SCORE_STATUS.VALID]: "gültig",
                      [DomainModel.SCORE_STATUS.MISSING]: "fehlt",
                      [DomainModel.SCORE_STATUS.EXCUSED]: "entschuldigt",
                      "not-scheduled": "nicht vorgesehen"
                    };
                    const valueText = presentation.status === DomainModel.SCORE_STATUS.MISSING ||
                      presentation.status === DomainModel.SCORE_STATUS.EXCUSED
                      ? "–"
                      : presentation.text;
                    const scoreRow = document.createElement("tr");
                    [
                      (student.lastName || "") + ", " + (student.firstName || ""),
                      valueText || "–",
                      statusLabels[presentation.status] || String(presentation.status || "–")
                    ].forEach(value => {
                      const td = document.createElement("td");
                      td.textContent = value;
                      scoreRow.appendChild(td);
                    });
                    scoreBody.appendChild(scoreRow);
                  }
                  scoreTable.appendChild(scoreBody);
                  scoreDetails.appendChild(scoreTable);
                }
                entriesCell.appendChild(scoreDetails);
                row.appendChild(entriesCell);
                assessmentBody.appendChild(row);
              }
              assessmentTable.appendChild(assessmentBody); dialog.appendChild(assessmentTable);
            }

            function closeDialog() {
              document.removeEventListener("keydown", onKeyDown);
              overlay.remove();
              if (triggerButton && typeof triggerButton.focus === "function") triggerButton.focus();
            }
            function onKeyDown(event) {
              if (event.key === "Escape") closeDialog();
            }
            closeButton.addEventListener("click", closeDialog);
            overlay.addEventListener("click", event => { if (event.target === overlay) closeDialog(); });
            document.addEventListener("keydown", onKeyDown);
            overlay.__closeForSessionLock = closeDialog;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            closeButton.focus();
          }

          if (archivedCourses.length > 0) {
            const archiveBox = document.createElement("div");
            archiveBox.className = "info-box";
            archiveBox.style.marginTop = "1rem";
            const archiveTitle = document.createElement("strong");
            archiveTitle.textContent = "Archivierte Kurse (" + archivedCourses.length + ")";
            archiveBox.appendChild(archiveTitle);
            const archiveHint = document.createElement("div");
            archiveHint.className = "text-muted";
            archiveHint.style.fontSize = "0.82rem";
            archiveHint.textContent = "Archivierte Kurse sind schreibgeschützt und bleiben mit Leistungen und Bewertungsgrundlagen im verschlüsselten Datenbestand erhalten.";
            archiveBox.appendChild(archiveHint);

            const archiveTable = document.createElement("table");
            const ah = document.createElement("thead");
            const ahr = document.createElement("tr");
            ["Kurs", "Archiviert", "Aufbewahren bis", "Umfang", "Aktionen"].forEach(label => {
              const th = document.createElement("th"); th.textContent = label; ahr.appendChild(th);
            });
            ah.appendChild(ahr); archiveTable.appendChild(ah);
            const ab = document.createElement("tbody");

            for (const archived of archivedCourses) {
              const tr = document.createElement("tr");
              const tdName = document.createElement("td");
              tdName.textContent = (archived.name || "Kurs") + (archived.classLabel ? " (" + archived.classLabel + ")" : "");
              const tdDate = document.createElement("td");
              tdDate.textContent = formatInstant(archived.archivedAt, {
                locale: DISPLAY_LOCALE,
                timeZone: DISPLAY_TIME_ZONE
              }) ?? archived.archivedAt;
              const tdRetention = document.createElement("td");
              tdRetention.textContent = formatCalendarDate(archived.archiveRetentionUntil, {
                locale: DISPLAY_LOCALE
              }) ?? "–";
              const tdCount = document.createElement("td");
              tdCount.textContent = DomainModel.listReferencedStudentIdsForCourse(state, archived.id).size + " Schüler:innen, " + DomainModel.listAssessmentsForCourse(state, archived.id).length + " Leistungen";
              const tdActions = document.createElement("td");

              const viewBtn = document.createElement("button");
              viewBtn.type = "button"; viewBtn.textContent = "Ansehen";
              viewBtn.addEventListener("click", function () {
                showArchivedCourseDetails(archived, viewBtn);
              });

              const restoreBtn = document.createElement("button");
              restoreBtn.type = "button"; restoreBtn.textContent = "Wiederherstellen";
              restoreBtn.addEventListener("click", async function () {
                if (!window.confirm("Diesen Kurs wieder als aktiven Kurs freigeben? Der bisherige Archivstand bleibt unveränderlich im Archivverlauf erhalten; der aktive Kurs verwendet anschließend die aktuellen Einstellungen.")) return;
                const courseId = archived.id;
                try {
                  await commitStateChange(function (candidate) {
                    const current = DomainModel.findCourseById(candidate, courseId);
                    if (!current || !current.archivedAt) throw new Error('Der Archivkurs ist nicht mehr verfügbar.');
                    DomainModel.restoreCourse(candidate, courseId);
                  }, { render: false });
                  currentCourseId = courseId;
                  render();
                } catch (error) {
                  if (!isStateCommitAborted(error)) window.alert('Der Kurs konnte nicht wiederhergestellt werden: ' + error.message);
                }
              });

              const metadataBtn = document.createElement("button");
              metadataBtn.type = "button";
              metadataBtn.textContent = "Aufbewahrung bearbeiten";
              metadataBtn.addEventListener("click", async function () {
                const courseId = archived.id;
                await requestArchiveMetadata({
                  title: "Archivangaben bearbeiten: " + (archived.name || "Kurs"),
                  description: "Leistungsdaten und Bewertungsgrundlagen bleiben unverändert. Bearbeitet werden nur Aufbewahrungsdatum und Verwaltungsnotiz.",
                  confirmLabel: "Angaben speichern",
                  initialRetentionUntil: archived.archiveRetentionUntil,
                  initialNote: archived.archiveNote,
                  formatSaveError: error => "Die Archivangaben konnten nicht gespeichert werden: " + error.message,
                  onConfirm: metadata => commitStateChange(function (candidate) {
                    const candidateCourse = DomainModel.findCourseById(candidate, courseId);
                    if (!candidateCourse || !candidateCourse.archivedAt) throw new Error('Der Archivkurs ist nicht mehr verfügbar.');
                    candidateCourse.archiveRetentionUntil = metadata.archiveRetentionUntil;
                    candidateCourse.archiveNote = metadata.archiveNote;
                  })
                });
              });

              const exportBtn = document.createElement("button");
              exportBtn.type = "button"; exportBtn.textContent = "Archiv exportieren";
              exportBtn.addEventListener("click", async function () {
                try {
                  const archivedAssessments = DomainModel.listAssessmentsForCourse(state, archived.id);
                  const studentIds = DomainModel.listReferencedStudentIdsForCourse(state, archived.id);
                  const archiveState = {
                    version: state.version,
                    students: (state.students || []).filter(s => studentIds.has(s.id)),
                    courses: [archived],
                    assessments: archivedAssessments,
                    settings: state.settings
                  };
                  const payload = await Storage.encryptForBackup(JSON.stringify(archiveState));
                  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  const timestamp = formatUtcFileTimestamp(new Date());
                  a.download = "notenverwaltung_archiv_" + timestamp + ".enc.json";
                  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                } catch (err) {
                  window.alert("Archivexport fehlgeschlagen: " + err.message);
                }
              });

              [viewBtn, metadataBtn, restoreBtn, exportBtn].forEach(btn => { btn.style.marginRight = "0.3rem"; tdActions.appendChild(btn); });
              tr.appendChild(tdName); tr.appendChild(tdDate); tr.appendChild(tdRetention); tr.appendChild(tdCount); tr.appendChild(tdActions); ab.appendChild(tr);
            }
            archiveTable.appendChild(ab); archiveBox.appendChild(archiveTable); section.appendChild(archiveBox);
          }

          function promoteHomeClass(value) {
            const match = /^([5-9])([a-zA-Z])$/.exec(String(value || "").trim());
            return match ? String(Number(match[1]) + 1) + match[2] : "";
          }

          function replaceStandaloneClassLabel(courseName, currentLabel, promotedLabel) {
            const name = String(courseName || "Kurs");
            if (!currentLabel || !promotedLabel) return name;
            const escapedLabel = String(currentLabel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const standaloneLabel = new RegExp("(^|[^0-9A-Za-z])" + escapedLabel + "(?=$|[^0-9A-Za-z])");
            return name.replace(standaloneLabel, (_match, prefix) => prefix + promotedLabel);
          }

          function decorateSuccessorPlanWithWeighting(course, successorPlan, settings) {
            const plan = { ...successorPlan };
            if (!course || !plan || plan.action !== "continue" ||
                course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC) {
              return plan;
            }
            const successor = DomainModel.createSuccessorCourseCandidate(course, plan.targetYear, plan);
            const targetTerm = String(plan.targetYear) + "-H1";
            const recommendation = successor
              ? GradingLogic.resolveUpperSecGradingContext(successor, null, targetTerm, settings)
              : null;
            const templateId = recommendation && recommendation.recommendedWeightTemplateId;
            const template = (Array.isArray(settings && settings.weightTemplates) ? settings.weightTemplates : [])
              .find(item => item && item.id === templateId);
            plan.targetWeightTemplateId = template ? template.id : null;
            plan.targetWeightingLabel = template
              ? template.name
              : "Keine sichere Empfehlung – Gewichtung nach der Anlage festlegen";
            plan.requiresWeightingConfirmation = !!template;
            return plan;
          }

          function openSchoolYearAssistant(triggerButton) {
            const sourceCourses = DomainModel.listActiveCourses(state);
            if (sourceCourses.length === 0) {
              window.alert("Es gibt keine aktiven Kurse für den Schuljahreswechsel.");
              return;
            }
            const currentStart = Number(state.settings?.halfYearSettings?.seckI?.schoolYearStartYear) || new Date().getFullYear();
            const overlay = document.createElement("div");
            overlay.dataset.sessionSensitiveOverlay = "true";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;z-index:100300";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background:var(--bg-card,#fff);padding:1rem;border-radius:8px;max-width:900px;width:92%;max-height:88%;overflow:auto";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            const title = document.createElement("h3");
            title.id = DomainModel.generateId("school_year_dialog_title");
            title.setAttribute("id", title.id);
            title.textContent = "Schuljahreswechsel vorbereiten";
            dialog.setAttribute("aria-labelledby", title.id);
            dialog.appendChild(title);
            const info = document.createElement("div"); info.className = "section-hint";
            info.textContent = "Alle aktiven alten Kurse werden gemeinsam unverändert archiviert, weil die Halbjahresgrenzen global gelten. Es entstehen neue Nachfolgekurse ohne Leistungen. Stammklassen 5–9 werden nur nach deiner Vorschau übernommen.";
            dialog.appendChild(info);

            const yearLabel = document.createElement("label"); yearLabel.textContent = "Startjahr des neuen Schuljahres: ";
            const yearInput = document.createElement("input"); yearInput.type = "number"; yearInput.min = "2000"; yearInput.max = "2200"; yearInput.value = String(currentStart + 1);
            yearLabel.appendChild(yearInput); dialog.appendChild(yearLabel);

            const courseRows = [];
            const courseTable = document.createElement("table");
            const ch = document.createElement("thead"); ch.innerHTML = "<tr><th>Archiv</th><th>Alter Kurs</th><th>Übergang</th><th>Neuer Kursname</th><th>Neue Klasse</th><th>Gewichtung</th></tr>"; courseTable.appendChild(ch);
            const cb = document.createElement("tbody");
            for (const course of sourceCourses) {
              const tr = document.createElement("tr");
              const checked = document.createElement("input"); checked.type = "checkbox"; checked.checked = true; checked.disabled = true;
              const promotedClass = promoteHomeClass(course.classLabel);
              const nameInput = document.createElement("input"); nameInput.type = "text";
              nameInput.value = promotedClass && course.classLabel
                ? replaceStandaloneClassLabel(course.name, course.classLabel, promotedClass)
                : String(course.name || "Kurs");
              const classInput = document.createElement("input"); classInput.type = "text"; classInput.value = promotedClass || course.classLabel || "";
              const status = document.createElement("strong");
              const weightingConfirmation = document.createElement("input"); weightingConfirmation.type = "checkbox";
              const weightingLabel = document.createElement("label");
              const weightingText = document.createElement("span");
              weightingLabel.appendChild(weightingConfirmation);
              weightingLabel.appendChild(weightingText);
              const cells = [checked, document.createTextNode(course.name || "Kurs"), status, nameInput, classInput, weightingLabel];
              for (const content of cells) { const td = document.createElement("td"); td.appendChild(content); tr.appendChild(td); }
              cb.appendChild(tr); courseRows.push({
                courseId: course.id, checked, nameInput, classInput, status,
                weightingLabel, weightingConfirmation, weightingText, plan: null
              });
            }
            courseTable.appendChild(cb); dialog.appendChild(courseTable);

            function refreshCoursePlans() {
              const targetYear = Number(yearInput.value);
              for (const row of courseRows) {
                const course = DomainModel.findCourseById(state, row.courseId);
                try {
                  row.plan = DomainModel.planCourseSuccessor(course, targetYear);
                  row.plan = decorateSuccessorPlanWithWeighting(course, row.plan, state.settings);
                  row.status.textContent = row.plan.label;
                } catch (_) {
                  row.plan = null;
                  row.status.textContent = "Zieljahr prüfen";
                }
                const createsSuccessor = !!(row.plan && row.plan.action === "continue");
                row.nameInput.disabled = !createsSuccessor;
                row.classInput.disabled = !createsSuccessor;
                const requiresConfirmation = !!(row.plan && row.plan.requiresWeightingConfirmation);
                const showsWeighting = !!(
                  createsSuccessor && course &&
                  course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                );
                row.weightingLabel.hidden = !showsWeighting;
                row.weightingConfirmation.hidden = !requiresConfirmation;
                row.weightingText.textContent = requiresConfirmation
                  ? " " + row.plan.targetWeightingLabel + " geprüft"
                  : (row.plan && row.plan.targetWeightingLabel) || "";
                if (!requiresConfirmation) row.weightingConfirmation.checked = false;
              }
            }
            yearInput.addEventListener("input", refreshCoursePlans);
            refreshCoursePlans();

            const classTitle = document.createElement("strong"); classTitle.textContent = "Stammklassen-Vorschau"; dialog.appendChild(classTitle);
            const classRows = [];
            const uniqueClasses = Array.from(new Set((state.students || []).map(s => s.homeClass).filter(Boolean))).sort(compareText);
            const classTable = document.createElement("table");
            const kh = document.createElement("thead"); kh.innerHTML = "<tr><th>Übernehmen</th><th>Bisher</th><th>Neu</th><th>Betroffene Schüler:innen</th></tr>"; classTable.appendChild(kh);
            const kb = document.createElement("tbody");
            for (const oldClass of uniqueClasses) {
              const suggested = promoteHomeClass(oldClass);
              const tr = document.createElement("tr");
              const checked = document.createElement("input"); checked.type = "checkbox"; checked.checked = !!suggested; checked.disabled = !suggested;
              const newInput = document.createElement("input"); newInput.type = "text"; newInput.value = suggested; newInput.disabled = !suggested;
              const count = (state.students || []).filter(s => s.homeClass === oldClass).length;
              [checked, document.createTextNode(oldClass), newInput, document.createTextNode(String(count))].forEach(content => { const td = document.createElement("td"); td.appendChild(content); tr.appendChild(td); });
              kb.appendChild(tr); classRows.push({ oldClass, checked, newInput });
            }
            classTable.appendChild(kb); dialog.appendChild(classTable);

            function listFocusableElements() {
              return Array.from(dialog.querySelectorAll(
                'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), a[href]:not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])'
              ));
            }
            function closeDialog() {
              document.removeEventListener("keydown", handleDialogKeydown);
              overlay.remove();
              if (triggerButton && triggerButton.isConnected && typeof triggerButton.focus === "function") triggerButton.focus();
            }
            function handleDialogKeydown(event) {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = listFocusableElements();
              if (focusable.length === 0) {
                event.preventDefault();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }

            const actions = document.createElement("div"); actions.style.cssText = "display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem";
            const cancel = document.createElement("button"); cancel.textContent = "Abbrechen"; cancel.addEventListener("click", closeDialog);
            const apply = document.createElement("button"); apply.textContent = "Vorschau bestätigen und durchführen";
            apply.addEventListener("click", async function () {
              const targetYear = Number(yearInput.value);
              if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2200 || courseRows.some(row => !row.plan || row.plan.targetYear !== targetYear)) {
                window.alert("Bitte ein gültiges Zieljahr verwenden."); return;
              }
              if (courseRows.some(row => row.plan.action === "review")) {
                window.alert("Bitte den Sek-II-Kontext aller mit „Kontext prüfen“ markierten Kurse vor dem Schuljahreswechsel vervollständigen."); return;
              }
              if (courseRows.some(row => row.plan.requiresWeightingConfirmation && !row.weightingConfirmation.checked)) {
                window.alert("Bitte die angezeigte Gewichtung für jeden Q3/Q4-Nachfolger sichtbar bestätigen."); return;
              }
              const successorCount = courseRows.filter(row => row.plan.action === "continue").length;
              const courseInputs = courseRows.map(function (row) {
                return {
                  courseId: row.courseId,
                  name: row.nameInput.value.trim(),
                  classLabel: row.classInput.value.trim(),
                  weightingConfirmed: row.weightingConfirmation.checked
                };
              });
              const classChanges = classRows.filter(function (row) {
                return row.checked.checked && row.newInput.value.trim();
              }).map(function (row) { return [row.oldClass, row.newInput.value.trim()]; });
              let archiveResult;
              document.removeEventListener("keydown", handleDialogKeydown);
              try {
                archiveResult = await requestArchiveMetadata({
                  title: "Archivangaben für die alten Kurse",
                  description: "Das optionale Aufbewahrungsdatum und die Notiz gelten für alle Kurse, die bei diesem Schuljahreswechsel archiviert werden.",
                  confirmLabel: "Angaben übernehmen",
                  formatSaveError: error => "Schuljahreswechsel wurde nicht übernommen: " + error.message,
                  onConfirm: async function (archiveMetadata) {
                    if (!window.confirm(sourceCourses.length + " alte Kurse archivieren und " + successorCount + " leere Nachfolgekurse für " + targetYear + "/" + (targetYear + 1) + " anlegen?")) {
                      return { committed: false };
                    }
                    let successorIds = [];
                    const candidate = await commitStateChange(function (nextState) {
                      const classMap = new Map(classChanges);
                      for (const student of nextState.students || []) {
                        if (classMap.has(student.homeClass)) student.homeClass = classMap.get(student.homeClass);
                      }
                      successorIds = [];
                      for (const input of courseInputs) {
                        const oldCourse = requireActiveCourse(nextState, input.courseId);
                        let plan = DomainModel.planCourseSuccessor(oldCourse, targetYear);
                        plan = decorateSuccessorPlanWithWeighting(oldCourse, plan, nextState.settings);
                        if (plan.action === 'review') throw new Error('Ein Sek-II-Kontext muss erneut geprüft werden.');
                        if (plan.requiresWeightingConfirmation && !input.weightingConfirmed) {
                          throw new Error('Eine Gewichtung wurde nicht bestätigt.');
                        }
                        DomainModel.archiveCourse(nextState, oldCourse.id, 'school-year-change', archiveMetadata);
                        if (plan.action !== 'continue') continue;
                        const successor = DomainModel.createSuccessorCourseCandidate(oldCourse, targetYear, plan);
                        if (!successor) throw new Error('Ein Nachfolgekurs konnte nicht angelegt werden.');
                        successor.name = input.name || oldCourse.name;
                        successor.classLabel = input.classLabel;
                        successor.enrollments = successor.enrollments.map(function (enrollment) {
                          const student = nextState.students.find(function (item) { return item.id === enrollment.studentId; });
                          return DomainModel.createEnrollment({
                            studentId: enrollment.studentId,
                            subgroup: enrollment.subgroup || null,
                            homeClassAtEnrollment: (student && student.homeClass) || enrollment.homeClassAtEnrollment || null,
                            writtenExamSubjectQ4: false
                          });
                        });
                        DomainModel.addCourseToState(nextState, successor);
                        successorIds.push(successor.id);
                      }
                      for (const level of ['seckI', 'seckII']) {
                        const hys = nextState.settings?.halfYearSettings?.[level];
                        if (!hys) continue;
                        hys.schoolYearStartYear = targetYear;
                        hys.h1EndYear = targetYear + 1;
                        hys.h2StartYear = targetYear + 1;
                      }
                    }, { render: false });
                    return { committed: true, candidate, successorIds };
                  }
                });
              } finally {
                if (overlay.isConnected) {
                  document.addEventListener("keydown", handleDialogKeydown);
                  apply.focus();
                }
              }
              if (!archiveResult || !archiveResult.value.committed) return;
              currentCourseId = archiveResult.value.successorIds[0] || DomainModel.listActiveCourses(archiveResult.value.candidate)[0]?.id || null;
              closeDialog();
              render();
              const replacementTrigger = document.getElementById("school-year-assistant-trigger");
              if (replacementTrigger && typeof replacementTrigger.focus === "function") replacementTrigger.focus();
              window.alert("Schuljahreswechsel abgeschlossen.");
            });
            actions.appendChild(cancel); actions.appendChild(apply); dialog.appendChild(actions); overlay.appendChild(dialog);
            overlay.addEventListener("click", event => { if (event.target === overlay) closeDialog(); });
            overlay.__closeForSessionLock = closeDialog;
            document.addEventListener("keydown", handleDialogKeydown);
            document.body.appendChild(overlay);
            yearInput.focus();
          }

          container.appendChild(section);
        }



        /**
         * Stammdaten – zentrale Schülerverwaltung.
         *
         * Funktionen:
         * - Neue Schüler in den Stammdaten anlegen.
         * - Bestehende Schüler bearbeiten (Name, Geburtstag).
         * - Schüler komplett löschen (inkl. Kurszuordnungen und Noteneinträgen).
         * - Schülerliste filtern:
         *   - nach Name (Vorname/Nachname, Teilstring),
         *   - nach Klasse (explizit homeClass oder aus Kursen abgeleitet),
         *   - nach Kurs (zeigt nur Schüler, die in diesem Kurs sind).
         */
        // Gemeinsamer Ausgabepfad für Gesamtdurchschnitte in beiden Notentabellen.
        function renderWeightedOverallCell(cell, assessments, course, studentId, settings, term = null) {
          const overall = GradingLogic.computeWeightedOverallForAssessments(
            assessments,
            course,
            studentId,
            settings,
            term
          );
          if (overall === null || !Number.isFinite(overall)) {
            cell.textContent = '–';
            cell.classList.add('text-muted');
            return null;
          }
          cell.textContent = formatLegacyFixed(overall, 2);
          cell.classList.remove('text-muted');
          return overall;
        }

        function getPreviousTerm(term) {
          const match = /^(\d{4})-H([12])$/.exec(term);
          if (!match) return null;
          const year = parseInt(match[1], 10);
          const half = parseInt(match[2], 10);
          return half === 2 ? `${year}-H1` : `${year - 1}-H2`;
        }

        function getAssessmentTerm(asm, course, deriveTermForDate = null) {
          if (!asm) return null;
          if (asm.term) return asm.term;
          if (asm.date && typeof deriveTermForDate === "function") {
            const d = new Date(asm.date);
            if (!isNaN(d)) return deriveTermForDate(d, course);
          }
          return null;
        }

        function filterPdfAssessments(allAssessments, course, selectedTerm = null, currentTermForCourse = null, deriveTermForDate = null) {
          const assessments = Array.isArray(allAssessments) ? allAssessments : [];
          return assessments.filter(assessment => {
            if (!assessment || assessment.courseId !== course.id) return false;
            if (assessment.visible === false) return false;
            if (!selectedTerm) return true;
            const assessmentTerm = getAssessmentTerm(assessment, course, deriveTermForDate) || currentTermForCourse;
            return assessmentTerm === selectedTerm;
          });
        }

        function filterPdfOverallAssessments(allAssessments, course, selectedTerm = null, currentTermForCourse = null, deriveTermForDate = null) {
          const selectedAssessments = filterPdfAssessments(
            allAssessments,
            course,
            selectedTerm,
            currentTermForCourse,
            deriveTermForDate
          );
          if (!selectedTerm) return selectedAssessments;
          const resultTerms = GradingLogic.resolveAssessmentTermsForResult(course, selectedTerm);
          if (resultTerms.length <= 1) return selectedAssessments;
          return resultTerms.flatMap(term => filterPdfAssessments(
            allAssessments,
            course,
            term,
            currentTermForCourse,
            deriveTermForDate
          ));
        }

        function buildUpperSecResultPresentation(course, studentId, term, calculatedValue) {
          const calculatedText = formatLegacyFixed(calculatedValue, 2) ?? '–';
          return {
            calculatedLabel: 'Rechenwert',
            calculatedText,
            finalizedLabel: 'Festgesetzte Punktzahl',
            finalizedPoints: term ? DomainModel.getTermResult(course, studentId, term) : null
          };
        }

        function buildUpperSecContextPresentation(course, studentId, term, stateForPresentation) {
          const snapshot = course && course.archivedAt && course.archiveSnapshot && typeof course.archiveSnapshot === 'object'
            ? course.archiveSnapshot
            : null;
          const evaluationCourse = snapshot
            ? {
                ...course,
                upperSecContext: snapshot.upperSecContext || course.upperSecContext || null,
                enrollments: Array.isArray(snapshot.enrollments) ? snapshot.enrollments : (course.enrollments || [])
              }
            : course;
          const settings = GradingLogic.getSettingsForCourse(evaluationCourse, stateForPresentation);
          const gradingContext = GradingLogic.resolveUpperSecGradingContext(
            evaluationCourse, studentId, term, settings
          );
          const assessments = (DomainModel.listAssessmentsForCourse(stateForPresentation, evaluationCourse.id) || [])
            .filter(assessment => getAssessmentTerm(
              assessment,
              evaluationCourse,
              date => resolveAssessmentTermFromDateValue(date, evaluationCourse, settings)
            ) === term);
          const calculatedValue = GradingLogic.computeWeightedOverallForAssessments(
            assessments, evaluationCourse, studentId, settings, term
          );
          const resultPresentation = buildUpperSecResultPresentation(
            evaluationCourse, studentId, term, calculatedValue
          );
          const assessmentWarning = GradingLogic.resolveUpperSecAssessmentWarning(
            assessments, evaluationCourse, studentId, term, settings
          );
          const courseTypeLabels = {
            basic: 'Grundkurs', advanced: 'Leistungskurs', other: 'Sonstiger Kurs'
          };
          return {
            courseTypeLabel: courseTypeLabels[(evaluationCourse.upperSecContext || {}).courseType] || 'Kontext unvollständig',
            qualificationPhase: gradingContext.qualificationPhase || '–',
            examRequirementLabel: gradingContext.expectedExamCount === 0
              ? 'nur allgemeiner Teil'
              : (gradingContext.expectedExamCount === null ? 'Klausurzahl prüfen' : 'Klausur vorgesehen'),
            manualDecisionWarning: assessmentWarning ? assessmentWarning.message : null,
            ...resultPresentation
          };
        }

        function getStudentDetailOverallLabel(course, selectedTerm) {
          if (!course) return 'Gesamtnote/-punkte';
          if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) return null;
          return GradingLogic.isSchoolYearResultTerm(course, selectedTerm)
            ? 'Jahresgesamtnote (H1 + H2)'
            : 'Halbjahresnote';
        }

        function listReportedTermsForStudent(course, studentId, assessmentTerms) {
          const terms = new Set((assessmentTerms || []).filter(term => /^\d{4}-H[12]$/.test(String(term || ''))));
          for (const result of ((course && course.termResults) || [])) {
            if (result.studentId === studentId && /^\d{4}-H[12]$/.test(String(result.term || ''))) {
              terms.add(result.term);
            }
          }
          return Array.from(terms).sort();
        }

        function renderStudentsSection(container) {
          try {
            const section = document.createElement("section");
            section.className = "section students-section";

            // Placeholder für currentTermLocal - wird später definiert nach den Hilfsfunktionen
            let currentTermLocal = null;
          // Regeln:
          // - Sek I (GRADES): ab "4-" und schlechter → rot. Da das interne Parsen
          //   keine feinen +/-‑Abstände abbildet, verwenden wir heuristisch:
          //   - Wenn ein roher String vorhanden ist und ein '-' enthält und die
          //     numerische Note >= 4 ist → schlecht.
          //   - Sonst: numerischer Schwellenwert von 4.25 und höher gilt als schlecht
          //     (approx. 4- und schlechter).
          // - Sek II (UPPERSEC): Punkte ≤ 4 gelten als schlecht.
          function isPoorValue(course, numericValue, rawString) {
            if (numericValue === null || numericValue === undefined || !Number.isFinite(numericValue)) return false;
            if (!course || course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
              // Grades: prüfe rohen String zuerst
              if (rawString && /-/.test(String(rawString))) {
                if (Number(numericValue) >= 4) return true;
              }
              // Fallback-Schwelle für Durchschnittswerte bzw. fehlenden Raw-String
              return Number(numericValue) >= 4.25;
            } else {
              // Oberstufe: niedrige Punktzahlen sind schlecht
              return Number(numericValue) <= 4;
            }
          }

          function getEvaluationSettingsForCourse(course) {
            return GradingLogic.getSettingsForCourse(course, state);
          }

          // Hilfsfunktion: Halbjahr einer Leistung über term/Datum ermitteln
          // ------------------------------------------------------
          // Abschnitt: PDF-Hilfsfunktionen (Term/Ø-Berechnung)
          // ------------------------------------------------------
          // Berechnet den gewichteten Gesamtschnitt wie in der Notenübersicht
          function computeReportOverallForAssessments(assessments, course, studentId, settings, term = null) {
            return GradingLogic.computeWeightedOverallForAssessments(
              assessments,
              course,
              studentId,
              settings,
              term
            );
          }

          function getPdfOverallLabel(course, term, termLabel) {
            return GradingLogic.isSchoolYearResultTerm(course, term)
              ? 'Jahresgesamtnote (H1 + H2)'
              : termLabel;
          }

          // ------------------------------------------------------
          // Hilfsfunktion: PDF-Notenübersicht für einen Schüler erstellen
          // ------------------------------------------------------
          function generateStudentGradePDF(student, selectedTerm = null) {
            try {
            // Shared upper-sec presentation: Rechenwert and Festgesetzte Punktzahl.
            // Neue Fenster mit Druckansicht öffnen
            const printWin = window.open('', '_blank');
            if (!printWin) {
              alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
              return;
            }

            const reportCourses = DomainModel.listStudentReportCourses(state, student.id);
            const courses = reportCourses.filter(course => !course.archivedAt);
            const archivedCourses = reportCourses.filter(course => !!course.archivedAt);

            // Hilfsfunktion: Verarbeite eine Kursliste (aktuelle oder archivierte) und bereite coursesData auf
            function processCourseList(courseList) {
              const coursesData = [];
              for (const course of courseList) {
              const evaluationSettings = getEvaluationSettingsForCourse(course);
              const currentTermForCourse = deriveTermFromDateValue(new Date(), course) || null;
              // Leistungen für diesen Schüler/Kurs sammeln
              // WICHTIG: Leistungen haben ein "scores"-Objekt mit Schüler-IDs als Keys!
              const allAssessments = state.assessments || [];
              const asms = filterPdfAssessments(
                allAssessments,
                course,
                selectedTerm,
                currentTermForCourse,
                deriveTermFromDateValue
              );

              if (!selectedTerm) {
                // Gruppierung nach Halbjahr, inkl. Durchschnitt je Halbjahr
                const termAssessmentsMap = new Map();
                for (const asm of asms) {
                  let termValue = asm.term || null;
                  if (!termValue && asm.date) {
                    const d = new Date(asm.date);
                    if (!isNaN(d)) termValue = deriveTermFromDateValue(d, course);
                  }
                  if (!termValue) termValue = 'no-term';
                  if (!termAssessmentsMap.has(termValue)) termAssessmentsMap.set(termValue, []);
                  termAssessmentsMap.get(termValue).push(asm);
                }

                if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
                  const reportedTerms = listReportedTermsForStudent(
                    course,
                    student.id,
                    Array.from(termAssessmentsMap.keys())
                  ).filter(term => !selectedTerm || term === selectedTerm);
                  for (const term of reportedTerms) {
                    if (!termAssessmentsMap.has(term)) termAssessmentsMap.set(term, []);
                  }
                }

                const assessmentsByTerm = [];
                const sortedTerms = Array.from(termAssessmentsMap.keys()).sort().reverse();
                for (const termKey of sortedTerms) {
                  const termsAssms = termAssessmentsMap.get(termKey);
                  const assessmentsData = termsAssms.map(asm => {
                    let catName = '–';
                    if (asm.categoryId) {
                      const cat = (evaluationSettings.categories || []).find(c => c.id === asm.categoryId);
                      if (cat) {
                        catName = cat.name || '–';
                        if (asm.subcategoryId && cat.subcategories) {
                          const subcat = cat.subcategories.find(sc => sc.id === asm.subcategoryId);
                          if (subcat) catName = cat.name + ' / ' + subcat.name;
                        }
                      }
                    }
                    const asmName = asm.title || '–';
                    const asmDate = asm.date || '–';
                    const scorePresentation = formatReportScorePresentation(
                      course, asm, student.id, evaluationSettings, 'student'
                    );
                    const rawValue = scorePresentation.text;
                    const numeric = scorePresentation.numeric;
                    const isPoor = (numeric != null) && isPoorValue(course, numeric, rawValue);
                    return { catName, asmName, asmDate, rawValue, isPoor };
                  });

                  let termOverall = null;
                  try {
                    const resultAssessments = termKey !== 'no-term'
                      ? filterPdfOverallAssessments(
                        allAssessments,
                        course,
                        termKey,
                        currentTermForCourse,
                        deriveTermFromDateValue
                      )
                      : termsAssms;
                    termOverall = computeReportOverallForAssessments(
                      resultAssessments, course, student.id, evaluationSettings, termKey
                    );
                  } catch (e) {}

                  assessmentsByTerm.push({
                    term: termKey !== 'no-term' ? termKey : null,
                    termLabel: termKey !== 'no-term' ? formatTermLabel(termKey, course.schemaMode, currentTermForCourse || termKey, course) : 'Ohne Halbjahr',
                    overallLabel: getPdfOverallLabel(course, termKey !== 'no-term' ? termKey : null, 'Halbjahrs-Durchschnitt'),
                    assessments: assessmentsData,
                    overall: termOverall,
                    overallIsPoor: (termOverall != null && isPoorValue(course, termOverall)),
                    presentation: course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                      ? buildUpperSecContextPresentation(course, student.id, termKey !== 'no-term' ? termKey : null, state)
                      : null
                  });
                }

                coursesData.push({
                  name: course.name || 'Kurs',
                  classLabel: course.classLabel || '',
                  assessmentsByTerm: assessmentsByTerm
                });
              } else {
                // Flache Ansicht für spezifisches Halbjahr
                let overall = null;
                let termOverall = null;
                try {
                  // Falls Kurs-Setting aktiv ist, Vorhalbjahr in die Gesamtnote einbeziehen
                  const overallAssessments = filterPdfOverallAssessments(
                    state.assessments || [],
                    course,
                    selectedTerm,
                    currentTermForCourse,
                    deriveTermFromDateValue
                  );
                  overall = computeReportOverallForAssessments(overallAssessments, course, student.id, evaluationSettings, selectedTerm);
                  termOverall = computeReportOverallForAssessments(asms, course, student.id, evaluationSettings, selectedTerm);
                } catch (e) {}
                const schoolYearResult = GradingLogic.isSchoolYearResultTerm(course, selectedTerm);
                const assessmentsData = asms.map(asm => {
                  let catName = '–';
                  if (asm.categoryId) {
                    const cat = (evaluationSettings.categories || []).find(c => c.id === asm.categoryId);
                    if (cat) {
                      catName = cat.name || '–';
                      if (asm.subcategoryId && cat.subcategories) {
                        const subcat = cat.subcategories.find(sc => sc.id === asm.subcategoryId);
                        if (subcat) catName = cat.name + ' / ' + subcat.name;
                      }
                    }
                  }
                  let termValue = getAssessmentTerm(asm, course, deriveTermFromDateValue);
                  const termLabel = termValue ? formatTermLabel(termValue, course.schemaMode, currentTermForCourse || termValue, course) : '–';
                  const asmName = asm.title || '–';
                  const asmDate = asm.date || '–';
                  const scorePresentation = formatReportScorePresentation(
                    course, asm, student.id, evaluationSettings, 'student'
                  );
                  const rawValue = scorePresentation.text;
                  const numeric = scorePresentation.numeric;
                  const isPoor = (numeric != null) && isPoorValue(course, numeric, rawValue);
                  return { catName, asmName, asmDate, term: termLabel, rawValue, isPoor };
                });
                coursesData.push({
                  name: course.name || 'Kurs',
                  classLabel: course.classLabel || '',
                  assessments: assessmentsData,
                  overall: schoolYearResult ? overall : termOverall,
                  overallIsPoor: ((schoolYearResult ? overall : termOverall) != null &&
                    isPoorValue(course, schoolYearResult ? overall : termOverall)),
                  overallLabel: getStudentDetailOverallLabel(course, selectedTerm),
                  presentation: course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                    ? buildUpperSecContextPresentation(course, student.id, selectedTerm, state)
                    : null,
                  combinedOverall: null,
                  combinedOverallIsPoor: (overall != null && isPoorValue(course, overall))
                });
              }
            }
            return coursesData;
          }

          // Verarbeite aktuelle und archivierte Kurse
          const currentCoursesData = processCourseList(courses);
          const archivedCoursesData = processCourseList(archivedCourses);

            // HTML-Dokument generieren (Querformat DIN A4)
            let html = `
<!DOCTYPE html>
<html>
<head>
  <base href=".">
  <meta charset="UTF-8">
  <title>Notenübersicht - ${escapeHtml(student.lastName)}, ${escapeHtml(student.firstName)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 1.5cm;
    }
    @media print {
      body { margin: 0; }
      .page-break { page-break-after: always; }
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.3;
    }
    h1 {
      font-size: 16pt;
      margin: 0 0 0.3em 0;
    }
${buildPrintHeaderCss()}
    h2 {
      font-size: 13pt;
      margin: 0.5em 0 0.3em 0;
      border-bottom: 1px solid #333;
    }
    h3 {
      font-size: 11pt;
      margin: 0.4em 0 0.2em 0;
      color: #555;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 0.5em;
    }
    th, td {
      border: 1px solid #333;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background: #e0e0e0;
      font-weight: 600;
    }
    .poor-grade {
      background: #ffcdd2 !important;
      color: #000;
    }
    .info-line {
      margin: 0.3em 0;
      font-size: 10pt;
    }
    .signature-area {
      display: flex;
      justify-content: space-around;
      margin-top: 0.75em;
      border-top: 2px solid #333;
      padding-top: 0.4em;
      break-inside: avoid-page;
      page-break-inside: avoid;
      break-before: avoid-page;
      page-break-before: avoid;
    }
    .signature-box {
      text-align: center;
      width: 30%;
    }
    .signature-line {
      border-bottom: 1px solid #000;
      margin-bottom: 0.3em;
      height: 2.5em;
    }
    .overall-grade {
      font-weight: 600;
      margin-top: 0.5em;
      font-size: 11pt;
    }
    .term-average {
      font-weight: 600;
      margin-top: 0.3em;
      margin-bottom: 0.4em;
      font-size: 11pt;
    }
  </style>
</head>
<body>
`;

            // Schüler-Übersicht
            html += buildPrintHeaderHtml(`Notenübersicht: ${student.lastName || ''}, ${student.firstName || ''}`) + '\n';
            html += `<div class="info-line"><strong>Klasse:</strong> ${escapeHtml(student.homeClass || '–')} | <strong>Geburtsdatum:</strong> ${escapeHtml(student.birthDate || '–')}</div>\n`;

            // Hilfsfunktion: Rendere eine Kursliste (aktuelle oder archivierte)
            function renderCourseSection(coursesData, sectionTitle) {
              if (coursesData.length === 0) return '';

              let sectionHtml = '';
              if (sectionTitle) {
                sectionHtml += `<h2 style="margin-top:1.5em;font-size:14pt;border-bottom:2px solid #555;">${escapeHtml(sectionTitle)}</h2>\n`;
              }

              for (const courseData of coursesData) {
                sectionHtml += `<h2>${escapeHtml(courseData.name)}`;
                if (courseData.classLabel) sectionHtml += ` (${escapeHtml(courseData.classLabel)})`;
                sectionHtml += `</h2>\n`;

                if (courseData.assessmentsByTerm) {
                  // Gruppierte Ansicht: je Halbjahr eigene Tabelle + Durchschnitt
                  for (const termData of courseData.assessmentsByTerm) {
                    sectionHtml += `<h3>${escapeHtml(termData.termLabel)}</h3>\n`;
                    if (termData.assessments.length === 0) {
                      sectionHtml += '<p style="font-size:10pt; color:#666;">Keine Noten in diesem Halbjahr.</p>\n';
                    } else {
                      sectionHtml += '<table>\n';
                      sectionHtml += '<thead><tr>';
                      sectionHtml += '<th>Kategorie</th>';
                      sectionHtml += '<th>Name</th>';
                      sectionHtml += '<th>Datum</th>';
                      sectionHtml += '<th>Note/Punkt</th>';
                      sectionHtml += '</tr></thead>\n<tbody>\n';
                      for (const asm of termData.assessments) {
                        const rowClass = asm.isPoor ? ' class="poor-grade"' : '';
                        sectionHtml += `<tr${rowClass}>`;
                        sectionHtml += `<td>${escapeHtml(asm.catName)}</td>`;
                        sectionHtml += `<td>${escapeHtml(asm.asmName)}</td>`;
                        sectionHtml += `<td>${escapeHtml(asm.asmDate)}</td>`;
                        sectionHtml += `<td>${escapeHtml(asm.rawValue)}</td>`;
                        sectionHtml += '</tr>\n';
                      }
                      sectionHtml += '</tbody></table>\n';
                    }
                    const overallClassTerm = termData.overallIsPoor ? ' class="poor-grade"' : '';
                    sectionHtml += `<div class="term-average"${overallClassTerm}>`;
                    if (termData.presentation) {
                      sectionHtml += `${termData.presentation.qualificationPhase}, ${termData.presentation.courseTypeLabel}, ${termData.presentation.examRequirementLabel}: ${termData.presentation.calculatedLabel}: ${termData.presentation.calculatedText}`;
                    } else if (termData.overall != null && Number.isFinite(termData.overall)) {
                      sectionHtml += `${termData.overallLabel}: ${formatLegacyFixed(termData.overall, 2)}`;
                    } else {
                      sectionHtml += `${termData.overallLabel}: kann nicht berechnet werden`;
                    }
                    sectionHtml += '</div>\n';
                    if (termData.presentation && Number.isInteger(termData.presentation.finalizedPoints)) {
                      sectionHtml += `<div class="term-average">${termData.presentation.finalizedLabel}: ${termData.presentation.finalizedPoints}</div>\n`;
                    }
                  }
                } else {
                  // Flache Ansicht: wie bisher
                  if (courseData.assessments.length === 0) {
                    sectionHtml += '<p style="font-size:10pt; color:#666;">Noch keine Noten eingetragen.</p>\n';
                  } else {
                    sectionHtml += '<table>\n';
                    sectionHtml += '<thead><tr>';
                    sectionHtml += '<th>Kategorie</th>';
                    sectionHtml += '<th>Name</th>';
                    sectionHtml += '<th>Datum</th>';
                    sectionHtml += '<th>Halbjahr</th>';
                    sectionHtml += '<th>Note/Punkt</th>';
                    sectionHtml += '</tr></thead>\n<tbody>\n';
                    for (const asm of courseData.assessments) {
                      const rowClass = asm.isPoor ? ' class="poor-grade"' : '';
                      sectionHtml += `<tr${rowClass}>`;
                      sectionHtml += `<td>${escapeHtml(asm.catName)}</td>`;
                      sectionHtml += `<td>${escapeHtml(asm.asmName)}</td>`;
                      sectionHtml += `<td>${escapeHtml(asm.asmDate)}</td>`;
                      sectionHtml += `<td>${escapeHtml(asm.term || '-')}</td>`;
                      sectionHtml += `<td>${escapeHtml(asm.rawValue)}</td>`;
                      sectionHtml += '</tr>\n';
                    }
                    sectionHtml += '</tbody></table>\n';
                  }
                  const overallClass = courseData.overallIsPoor ? ' class="poor-grade"' : '';
                  sectionHtml += `<div class="overall-grade"${overallClass}>`;
                  if (courseData.presentation) {
                    sectionHtml += `${courseData.presentation.calculatedLabel}: ${courseData.presentation.calculatedText}`;
                  } else if (courseData.overall != null && Number.isFinite(courseData.overall)) {
                    sectionHtml += `${escapeHtml(courseData.overallLabel || 'Gesamtnote/-punkte')}: ${formatLegacyFixed(courseData.overall, 2)}`;
                  } else {
                    sectionHtml += 'Gesamtnote/-punkte: noch nicht berechenbar';
                  }
                  sectionHtml += '</div>\n';
                  if (courseData.presentation && Number.isInteger(courseData.presentation.finalizedPoints)) {
                    sectionHtml += `<div class="overall-grade">${courseData.presentation.finalizedLabel}: ${courseData.presentation.finalizedPoints}</div>\n`;
                  }
                  if (courseData.presentation && courseData.combinedOverall != null && Number.isFinite(courseData.combinedOverall)) {
                    const combinedClass = courseData.combinedOverallIsPoor ? ' class="poor-grade overall-grade"' : ' class="overall-grade"';
                    sectionHtml += `<div${combinedClass}>Rechenwert inkl. Vorhalbjahr: ${formatLegacyFixed(courseData.combinedOverall, 2)}</div>\n`;
                  }
                }
              }
              return sectionHtml;
            }

            if (currentCoursesData.length === 0 && archivedCoursesData.length === 0) {
              html += '<p>Dieser Schüler ist in keinem Kurs eingeschrieben.</p>\n';
            } else {
              html += renderCourseSection(currentCoursesData, currentCoursesData.length > 0 ? 'Aktuelle Kurse' : null);
              html += renderCourseSection(archivedCoursesData, archivedCoursesData.length > 0 ? 'Archivierte Kurse' : null);
            }

            // Unterschriftenbereich am Seitenende
            html += `
<div class="signature-area">
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Datum</div>
  </div>
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Unterschrift Schüler/in</div>
  </div>
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Unterschrift Erziehungsberechtigte/r</div>
  </div>
</div>
`;

            html += '</body></html>';

            printWin.document.open();
            printWin.document.write(html);
            printWin.document.close();

            // Erst drucken, wenn das austauschbare Begleitlogo geladen oder verworfen wurde.
            printWhenAssetsReady(printWin);
            } catch(err) {
              console.error('Fehler beim Drucken', err);
              alert('Druck konnte nicht erstellt werden: ' + err.message);
            }
          }

          // ------------------------------------------------------
          // Überschrift und Einleitung
          // ------------------------------------------------------
          const eyebrow = document.createElement('div');
          eyebrow.className = 'section-eyebrow';
          eyebrow.textContent = 'STAMMDATEN';
          section.appendChild(eyebrow);

          const headingRow = document.createElement('div');
          headingRow.className = 'section-heading students-heading';
          const headingText = document.createElement('div');
          const h2 = document.createElement("h2");
          h2.textContent = "Schüler";
          headingText.appendChild(h2);

          const intro = document.createElement("div");
          intro.className = "section-hint";
          intro.textContent = "Stammdaten und Kurszuordnungen an einem Ort verwalten.";
          headingText.appendChild(intro);
          headingRow.appendChild(headingText);

          const openCreateButton = document.createElement('button');
          openCreateButton.type = 'button';
          openCreateButton.className = 'section-action students-create-trigger';
          openCreateButton.textContent = 'Schüler anlegen';
          openCreateButton.setAttribute('aria-controls', 'students-create-form');
          openCreateButton.setAttribute('aria-expanded', 'false');
          headingRow.appendChild(openCreateButton);
          section.appendChild(headingRow);

          // ------------------------------------------------------
          // Hilfsstrukturen: Kurse und Klassen pro Schüler berechnen
          // ------------------------------------------------------
          function buildStudentCourseIndex() {
            const coursesByStudent = new Map();
            const allClasses = new Set();

            // Klassen aus den Stammdaten sammeln
            for (const s of state.students) {
                if (s.homeClass) allClasses.add(s.homeClass);
            }

            // Kurse pro Schüler zuordnen
            for (const c of DomainModel.listActiveCourses(state)) {
              // Auch Klassen aus Kursbezeichnungen sammeln, falls relevant?
              // Besser: Nur Stammdaten-Klassen filtern, aber wir fügen Kurs-Klassen hinzu
              // falls Stammdaten leer sind.
              if (c.classLabel) allClasses.add(c.classLabel);

              if (!Array.isArray(c.enrollments)) continue;

              for (const enr of c.enrollments) {
                const stuId = enr.studentId;
                if (!stuId) continue;

                if (!coursesByStudent.has(stuId)) {
                  coursesByStudent.set(stuId, []);
                }
                coursesByStudent.get(stuId).push(c);
              }
            }

            return { coursesByStudent, allClasses };
          }

          const { coursesByStudent, allClasses } = buildStudentCourseIndex();

          function getCoursesForMassPrint(studentId, activeCourseFilterId) {
            return DomainModel.listStudentReportCourses(state, studentId, activeCourseFilterId || null);
          }

          // ------------------------------------------------------
          // Filterleiste (Name, Klasse, Kurs)
          // ------------------------------------------------------
          const filterBox = document.createElement("div");
          filterBox.className = "students-filters";

          const filterTitle = document.createElement("h3");
          filterTitle.textContent = "Personen filtern";
          filterBox.appendChild(filterTitle);

          const filterRow = document.createElement("div");
          filterRow.className = 'students-filter-grid';

          // Filter: Name (Vorname oder Nachname, Teilstring)
          const nameFilterWrapper = document.createElement("div");
          nameFilterWrapper.className = 'students-field';

          const nameFilterLabel = document.createElement("label");
          nameFilterLabel.textContent = "Name suchen";
          nameFilterLabel.setAttribute('for', 'students-name-filter');

          const nameFilterInput = document.createElement("input");
          nameFilterInput.id = 'students-name-filter';
          nameFilterInput.type = "text";
          nameFilterInput.placeholder = "Vor- oder Nachname";

          nameFilterWrapper.appendChild(nameFilterLabel);
          nameFilterWrapper.appendChild(nameFilterInput);

          filterRow.appendChild(nameFilterWrapper);

          // Filter: Klasse
          const classFilterWrapper = document.createElement("div");
          classFilterWrapper.className = 'students-field';

          const classFilterLabel = document.createElement("label");
          classFilterLabel.textContent = "Stammklasse filtern";
          classFilterLabel.setAttribute('for', 'students-class-filter');

          const classFilterSelect = document.createElement("select");
          classFilterSelect.id = 'students-class-filter';

          const optAllClasses = document.createElement("option");
          optAllClasses.value = "";
          optAllClasses.textContent = "Alle Stammklassen";
          classFilterSelect.appendChild(optAllClasses);

          const sortedClasses = Array.from(allClasses).sort((a, b) =>
            compareText(a, b)
          );
          for (const cls of sortedClasses) {
            const opt = document.createElement("option");
            opt.value = cls;
            opt.textContent = cls;
            classFilterSelect.appendChild(opt);
          }

          classFilterWrapper.appendChild(classFilterLabel);
          classFilterWrapper.appendChild(classFilterSelect);

          filterRow.appendChild(classFilterWrapper);

          // Filter: Kurs (nur Schüler anzeigen, die in diesem Kurs sind)
          const courseFilterWrapper = document.createElement("div");
          courseFilterWrapper.className = 'students-field';

          const courseFilterLabel = document.createElement("label");
          courseFilterLabel.textContent = "Kurs filtern";
          courseFilterLabel.setAttribute('for', 'students-course-filter');

          const courseFilterSelect = document.createElement("select");
          courseFilterSelect.id = 'students-course-filter';

          const optAllCourses = document.createElement("option");
          optAllCourses.value = "";
          optAllCourses.textContent = "Alle Kurse";
          courseFilterSelect.appendChild(optAllCourses);

          const sortedCourses = DomainModel.listActiveCourses(state).slice().sort((a, b) =>
            compareText(a.name, b.name)
          );
          for (const c of sortedCourses) {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent =
              c.name + (c.classLabel ? " (" + c.classLabel + ")" : "");
            courseFilterSelect.appendChild(opt);
          }

          courseFilterWrapper.appendChild(courseFilterLabel);
          courseFilterWrapper.appendChild(courseFilterSelect);

          filterRow.appendChild(courseFilterWrapper);

          filterBox.appendChild(filterRow);

          const filterHint = document.createElement("div");
          filterHint.className = "text-muted";
          filterHint.textContent =
            "Die Filter werden kombiniert. Die Klassenwahl bezieht sich auf die hinterlegte Stammklasse.";
          filterBox.appendChild(filterHint);

          function deriveTermFromDateValue(d, courseObj) {
            return resolveAssessmentTermFromDateValue(d, courseObj, getEvaluationSettingsForCourse(courseObj));
          }

          function hTermToQNumber(term, currentTerm) {
            if (!term || !currentTerm || !/^\d{4}-H[12]$/.test(term) || !/^\d{4}-H[12]$/.test(currentTerm)) {
              return null;
            }
            const currYear = parseInt(currentTerm.slice(0, 4), 10);
            const currHalf = currentTerm.endsWith('H1') ? 1 : 2;
            const termYear = parseInt(term.slice(0, 4), 10);
            const termHalf = term.endsWith('H1') ? 1 : 2;

            if (termYear === currYear) {
              return termHalf === 1 ? 1 : 2;
            } else if (termYear === currYear - 1) {
              return termHalf === 1 ? 3 : 4;
            } else if (termYear === currYear + 1) {
              return termHalf === 1 ? 1 : 2;
            }
            return null;
          }

          function formatTermLabel(term, schemaMode = 'GRADES', currentTerm = null, courseObj = null) {
            const evaluationCourse = courseObj || { schemaMode };
            return GradingLogic.formatCourseTermLabel(
              term,
              evaluationCourse,
              getEvaluationSettingsForCourse(courseObj)
            );
          }

          // Bestimme das aktuelle Halbjahr (currentTermLocal) - IMMER aus Datum ableiten
          // WICHTIG: Nicht aus vorhandenen Leistungen ableiten, sonst bleibt es auf H1
          // hängen wenn nur H1-Daten existieren, obwohl heute bereits H2 ist.
          if (DomainModel.listActiveCourses(state).length > 0) {
            const course = DomainModel.listActiveCourses(state)[0];
            currentTermLocal = deriveTermFromDateValue(new Date(), course);
          }
          // Fallback: nur wenn deriveTermFromDateValue fehlschlägt
          if (!currentTermLocal) {
            const allTermsGlobal = new Set();
            for (const asm of (state.assessments || [])) {
              if (asm.term && asm.term.match(/^\d{4}-H[12]$/)) {
                allTermsGlobal.add(asm.term);
              }
            }
            if (allTermsGlobal.size > 0) {
              let best = null;
              let bestNum = -Infinity;
              for (const t of allTermsGlobal) {
                const m = /^(\d{4})-H([12])$/.exec(t);
                if (m) {
                  const n = parseInt(m[1], 10) * 10 + parseInt(m[2], 10);
                  if (n > bestNum) {
                    bestNum = n;
                    best = t;
                  }
                }
              }
              currentTermLocal = best;
            }
          }

          function getFilteredStudents() {
            const nameFilter = (nameFilterInput.value || "").trim().toLowerCase();
            const classFilter = classFilterSelect.value || "";
            const courseFilterId = courseFilterSelect.value || "";
            const students = [...state.students];
            students.sort((a, b) => {
              const lnA = (a.lastName || "").toLowerCase();
              const lnB = (b.lastName || "").toLowerCase();
              if (lnA !== lnB) return compareText(lnA, lnB);
              const fnA = (a.firstName || "").toLowerCase();
              const fnB = (b.firstName || "").toLowerCase();
              return compareText(fnA, fnB);
            });
            return students.filter(stu => {
              if (nameFilter) {
                const combo =
                  (stu.lastName || "").toLowerCase() +
                  " " +
                  (stu.firstName || "").toLowerCase();
                if (!combo.includes(nameFilter)) return false;
              }
              if (classFilter && stu.homeClass !== classFilter) return false;
              if (courseFilterId) {
                const courses = coursesByStudent.get(stu.id) || [];
                if (!courses.some(course => course.id === courseFilterId)) return false;
              }
              return true;
            });
          }

          // Massendruck-Button für gefilterte Schüler
          const massPrintBox = document.createElement('details');
          massPrintBox.className = 'students-reports';
          massPrintBox.open = false;

          const massPrintSummary = document.createElement('summary');
          massPrintSummary.textContent = 'Berichte für angezeigte Personen';
          massPrintBox.appendChild(massPrintSummary);

          const massPrintBody = document.createElement('div');
          massPrintBody.className = 'students-reports-body';
          massPrintBox.appendChild(massPrintBody);

          const massPrintTitle = document.createElement('h3');
          massPrintTitle.textContent = 'PDF-Berichte erstellen';
          massPrintBody.appendChild(massPrintTitle);

          const termSelectRow = document.createElement('div');
          termSelectRow.className = 'students-report-controls';

          const termSelectLabel = document.createElement('label');
          termSelectLabel.textContent = 'Halbjahr';
          termSelectLabel.setAttribute('for', 'students-report-term');
          termSelectRow.appendChild(termSelectLabel);

          const termSelect = document.createElement('select');
          termSelect.id = 'students-report-term';

          // Placeholder-Option
          const optAll = document.createElement('option');
          optAll.value = '';
          optAll.textContent = 'Alle Halbjahre';
          termSelect.appendChild(optAll);

          // Standardmäßig aktuelles Halbjahr setzen (wird später überschrieben wenn verfügbar)
          let defaultTermValue = currentTermLocal || '';
          let preferredTermValue = null;
          termSelect.addEventListener('change', function () {
            preferredTermValue = termSelect.value || '';
            updateMassPrintScope(getFilteredStudents());
          });

          termSelectRow.appendChild(termSelect);
          massPrintBody.appendChild(termSelectRow);

          const massPrintScope = document.createElement('section');
          massPrintScope.className = 'students-print-scope students-print-scope--batch';
          if (typeof massPrintScope.setAttribute === 'function') massPrintScope.setAttribute('aria-live', 'polite');
          const massPrintScopeTitle = document.createElement('h4');
          massPrintScopeTitle.textContent = 'Druckumfang';
          massPrintScope.appendChild(massPrintScopeTitle);
          const massPrintPeople = document.createElement('div');
          massPrintPeople.className = 'students-print-scope-row';
          massPrintScope.appendChild(massPrintPeople);
          const massPrintCourses = document.createElement('div');
          massPrintCourses.className = 'students-print-scope-row';
          massPrintScope.appendChild(massPrintCourses);
          const massPrintTerm = document.createElement('div');
          massPrintTerm.className = 'students-print-scope-row';
          massPrintScope.appendChild(massPrintTerm);
          const massPrintHint = document.createElement('p');
          massPrintHint.className = 'students-print-scope-hint';
          massPrintHint.textContent = 'Nur für PDF-Berichte freigegebene Leistungen werden ausgegeben.';
          massPrintScope.appendChild(massPrintHint);
          massPrintBody.appendChild(massPrintScope);

          function selectedOptionText(select, fallback) {
            const selected = Array.from(select && select.options ? select.options : [])
              .find(option => option.value === select.value);
            return selected ? selected.textContent : fallback;
          }

          function updateMassPrintScope(filteredStudents) {
            const students = Array.isArray(filteredStudents) ? filteredStudents : getFilteredStudents();
            massPrintPeople.textContent = students.length > 0
              ? 'Personen: ' + students.length + ' angezeigt'
              : 'Personen: Keine Personen ausgewählt';
            const selectedCourseId = courseFilterSelect.value || '';
            const selectedCourse = selectedCourseId
              ? DomainModel.findCourseById(state, selectedCourseId)
              : null;
            massPrintCourses.textContent = selectedCourse && !selectedCourse.archivedAt
              ? 'Kurse: ' + (selectedCourse.name || 'Kurs') +
                (selectedCourse.classLabel ? ' (' + selectedCourse.classLabel + ')' : '')
              : 'Kurse: Alle aktiven und archivierten Berichtskurse der angezeigten Personen';
            massPrintTerm.textContent = 'Zeitraumauswahl: ' + selectedOptionText(termSelect, 'Alle Halbjahre');
          }

          const massPrintBtn = document.createElement('button');
          massPrintBtn.type = 'button';
          massPrintBtn.textContent = 'PDF für alle angezeigten Schüler drucken';
          // Funktion: Aktualisiere Halbjahre im Dropdown basierend auf aktuellen Filtern
          function updateTermsInDropdown(filteredStudents = getFilteredStudents()) {
            const courseFilterId = courseFilterSelect.value || "";

            const allTermsSet = new Set();
            const termCourses = new Map();
            for (const student of filteredStudents) {
              const courses = getCoursesForMassPrint(student.id, courseFilterId);
              for (const course of courses) {
                const allAssessments = state.assessments || [];
                const assessmentTerms = [];
                for (const asm of allAssessments) {
                  if (asm.courseId !== course.id) continue;
                  if (!asm.scores || !asm.scores[student.id]) continue;
                  const term = asm.term || (asm.date ? deriveTermFromDateValue(new Date(asm.date), course) : null);
                  if (term && term.match(/^\d{4}-H[12]$/)) {
                    assessmentTerms.push(term);
                  }
                }
                for (const term of listReportedTermsForStudent(course, student.id, assessmentTerms)) {
                  allTermsSet.add(term);
                  if (!termCourses.has(term)) termCourses.set(term, new Map());
                  termCourses.get(term).set(course.id, course);
                }
              }
            }

            const allTerms = Array.from(allTermsSet).sort().reverse();
            while (termSelect.options.length > 1) {
              termSelect.remove(1);
            }
            defaultTermValue = preferredTermValue === ''
              ? ''
              : allTerms.includes(preferredTermValue)
              ? preferredTermValue
              : currentTermLocal && allTerms.includes(currentTermLocal)
                ? currentTermLocal
                : (allTerms.length > 0 ? allTerms[0] : '');
            for (const term of allTerms) {
              const opt = document.createElement('option');
              opt.value = term;
              opt.textContent = formatTermLabelForCourses(
                term,
                Array.from((termCourses.get(term) || new Map()).values()),
                state
              );
              termSelect.appendChild(opt);
            }
            termSelect.value = defaultTermValue;
          }

          massPrintBtn.addEventListener('click', function () {
            try {
              // Ermittle aktuell gefilterte Schüler (analog zu refreshTable)
              const courseFilterId = courseFilterSelect.value || "";
            const filteredStudents = getFilteredStudents();

            if (filteredStudents.length === 0) {
              alert('Keine Schüler entsprechen dem aktuellen Filter.');
              return;
            }

            // Reuse the filtered assessment-plus-finalization union used by the dropdown updater.
            updateTermsInDropdown();
            const selectedTerm = termSelect.value || null; // null = alle Halbjahre

            // PDF für alle gefilterten Schüler erstellen (ein Schüler pro Seite)
            const printWin = window.open('', '_blank');
            if (!printWin) {
              alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite.');
              return;
            }

            // WICHTIG: Alle Daten VOR HTML-Generierung extrahieren
            const allStudentsData = [];
            // Shared upper-sec presentation: Rechenwert and Festgesetzte Punktzahl.
            for (const student of filteredStudents) {
              const courses = getCoursesForMassPrint(student.id, courseFilterId);
              const coursesData = [];

              for (const course of courses) {
                const evaluationSettings = getEvaluationSettingsForCourse(course);
                const currentTermForCourse = deriveTermFromDateValue(new Date(), course) || null;
                const allAssessments = state.assessments || [];

                // Nur für PDF-Berichte freigegebene Leistungen dieses Kurses filtern.
                const asms = filterPdfAssessments(
                  allAssessments,
                  course,
                  selectedTerm,
                  currentTermForCourse,
                  deriveTermFromDateValue
                );

                // Gruppiere Leistungen nach Halbjahr (Map mit term als Key)
                const termAssessmentsMap = new Map();
                for (const asm of asms) {
                  let termValue = asm.term || null;
                  if (!termValue && asm.date) {
                    const d = new Date(asm.date);
                    if (!isNaN(d)) {
                      termValue = deriveTermFromDateValue(d, course);
                    }
                  }

                  if (!termValue) termValue = 'no-term';

                  if (!termAssessmentsMap.has(termValue)) {
                    termAssessmentsMap.set(termValue, []);
                  }
                  termAssessmentsMap.get(termValue).push(asm);
                }

                if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
                  const reportedTerms = listReportedTermsForStudent(
                    course,
                    student.id,
                    Array.from(termAssessmentsMap.keys())
                  ).filter(term => !selectedTerm || term === selectedTerm);
                  for (const term of reportedTerms) {
                    if (!termAssessmentsMap.has(term)) termAssessmentsMap.set(term, []);
                  }
                }

                // Verarbeite Leistungen pro Halbjahr
                const assessmentsByTerm = [];
                const sortedTerms = Array.from(termAssessmentsMap.keys()).sort().reverse();

                for (const termKey of sortedTerms) {
                  const termsAssms = termAssessmentsMap.get(termKey);
                  const assessmentsData = termsAssms.map(asm => {
                    // Kategorie-Name und Unterkategorie-Name finden
                    let catName = '–';
                    if (asm.categoryId) {
                      const cat = (evaluationSettings.categories || []).find(c => c.id === asm.categoryId);
                      if (cat) {
                        catName = cat.name || '–';
                        // Unterkategorie hinzufügen, falls vorhanden
                        if (asm.subcategoryId && cat.subcategories) {
                          const subcat = cat.subcategories.find(sc => sc.id === asm.subcategoryId);
                          if (subcat) {
                            catName = cat.name + ' / ' + subcat.name;
                          }
                        }
                      }
                    }

                    // Term-Label für Anzeige
                    const termLabel = termKey !== 'no-term' ? formatTermLabel(termKey, course.schemaMode, currentTermForCourse || termKey, course) : '–';

                    const asmName = asm.title || '–';
                    const asmDate = asm.date || '–';
                    const weight = (asm.weight != null) ? String(asm.weight) : '–';

                    // Score des Schülers holen
                    const scorePresentation = formatReportScorePresentation(
                      course, asm, student.id, evaluationSettings, 'student'
                    );
                    const rawValue = scorePresentation.text;
                    const numeric = scorePresentation.numeric;

                    const isPoor = (numeric != null) && isPoorValue(course, numeric, rawValue);

                    return {
                      catName,
                      asmName,
                      asmDate,
                      weight,
                      term: termLabel,
                      rawValue,
                      isPoor
                    };
                  });

                  // Berechne Durchschnitt für dieses Halbjahr (nur für die Leistungen in diesem Term)
                  let termOverall = null;
                  try {
                    const resultAssessments = termKey !== 'no-term'
                      ? filterPdfOverallAssessments(
                        allAssessments,
                        course,
                        termKey,
                        currentTermForCourse,
                        deriveTermFromDateValue
                      )
                      : termsAssms;
                    termOverall = computeReportOverallForAssessments(
                      resultAssessments, course, student.id, evaluationSettings, termKey
                    );
                  } catch (e) {}

                  assessmentsByTerm.push({
                    term: termKey !== 'no-term' ? termKey : null,
                    termLabel: termKey !== 'no-term' ? formatTermLabel(termKey, course.schemaMode, currentTermForCourse || termKey, course) : 'Ohne Halbjahr',
                    overallLabel: getPdfOverallLabel(
                      course,
                      termKey !== 'no-term' ? termKey : null,
                      `Durchschnitt ${termKey !== 'no-term' ? formatTermLabel(termKey, course.schemaMode, currentTermForCourse || termKey, course) : 'Ohne Halbjahr'}`
                    ),
                    assessments: assessmentsData,
                    overall: termOverall,
                    overallIsPoor: (termOverall != null && isPoorValue(course, termOverall)),
                    presentation: course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                      ? buildUpperSecContextPresentation(course, student.id, termKey !== 'no-term' ? termKey : null, state)
                      : null
                  });
                }

                let combinedOverall = null;
                if (selectedTerm && GradingLogic.isSchoolYearResultTerm(course, selectedTerm)) {
                  try {
                    const overallAssessments = filterPdfOverallAssessments(
                      allAssessments,
                      course,
                      selectedTerm,
                      currentTermForCourse,
                      deriveTermFromDateValue
                    );
                    combinedOverall = computeReportOverallForAssessments(
                      overallAssessments,
                      course,
                      student.id,
                      evaluationSettings,
                      selectedTerm
                    );
                  } catch (e) {}
                }

                if (assessmentsByTerm.length > 0 || course.archivedAt) {
                  coursesData.push({
                    name: course.name || 'Kurs',
                    classLabel: course.classLabel || '',
                    isArchived: !!course.archivedAt,
                    assessmentsByTerm: assessmentsByTerm,
                    combinedOverall: combinedOverall,
                    combinedOverallIsPoor: (combinedOverall != null && isPoorValue(course, combinedOverall)),
                    upperSec: course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                  });
                }
              }

              allStudentsData.push({
                lastName: student.lastName || '',
                firstName: student.firstName || '',
                homeClass: student.homeClass || '–',
                birthDate: student.birthDate || '–',
                courses: coursesData
              });
            }

          let html = `
<!DOCTYPE html>
<html>
<head>
  <base href=".">
  <meta charset="UTF-8">
  <title>Notenübersichten - Sammelausdruck</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 1.5cm;
    }
    @media print {
      body { margin: 0; }
      .page-break { page-break-after: always; }
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.3;
    }
    h1 {
      font-size: 16pt;
      margin: 0 0 0.3em 0;
    }
${buildPrintHeaderCss()}
    h2 {
      font-size: 13pt;
      margin: 0.5em 0 0.3em 0;
      border-bottom: 1px solid #333;
    }
    h3 {
      font-size: 11pt;
      margin: 0.4em 0 0.2em 0;
      color: #555;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 0.5em;
    }
    th, td {
      border: 1px solid #333;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background: #e0e0e0;
      font-weight: 600;
    }
    .poor-grade {
      background: #ffcdd2 !important;
      color: #000;
    }
    .info-line {
      margin: 0.3em 0;
      font-size: 10pt;
    }
    .signature-area {
      display: flex;
      justify-content: space-around;
      margin-top: 0.75em;
      border-top: 2px solid #333;
      padding-top: 0.4em;
      break-inside: avoid-page;
      page-break-inside: avoid;
      break-before: avoid-page;
      page-break-before: avoid;
    }
    .signature-box {
      text-align: center;
      width: 30%;
    }
    .signature-line {
      border-bottom: 1px solid #000;
      margin-bottom: 0.3em;
      height: 2.5em;
    }
    .term-average {
      font-weight: 600;
      margin-top: 0.3em;
      margin-bottom: 0.4em;
      font-size: 11pt;
    }
  </style>
</head>
<body>
`;

            // Jeder Schüler auf eigener Seite
            for (let i = 0; i < allStudentsData.length; i++) {
              const studentData = allStudentsData[i];

              html += buildPrintHeaderHtml(`Notenübersicht: ${studentData.lastName}, ${studentData.firstName}`) + '\n';
              html += `<div class="info-line"><strong>Klasse:</strong> ${escapeHtml(studentData.homeClass)} | <strong>Geburtsdatum:</strong> ${escapeHtml(studentData.birthDate)}</div>\n`;

              if (studentData.courses.length === 0) {
                html += '<p>Dieser Schüler ist in keinem Kurs eingeschrieben.</p>\n';
              } else {
                // Kurse durchlaufen
                let archiveSectionStarted = false;
                for (const courseData of studentData.courses) {
                  if (courseData.isArchived && !archiveSectionStarted) {
                    html += '<div style="margin-top:1.2em;padding:0.35em 0.5em;border:2px solid #666;background:#f0f0f0;font-weight:700;">Archivbereich – historische, unveränderliche Bewertungsgrundlagen</div>\n';
                    archiveSectionStarted = true;
                  }
                  html += `<h2>${escapeHtml(courseData.name)}`;
                  if (courseData.classLabel) html += ` (${escapeHtml(courseData.classLabel)})`;
                  if (courseData.isArchived) html += ' [Archiv]';
                  html += `</h2>\n`;

                  if (courseData.assessmentsByTerm.length === 0) {
                    html += '<p style="font-size:10pt; color:#666;">Keine gespeicherten Leistungen; Archivzuordnung ist vorhanden.</p>\n';
                  }

                  // Halbjahre durchlaufen
                  for (const termData of courseData.assessmentsByTerm) {
                    // Halbjahr-Überschrift
                    html += `<h3>${escapeHtml(termData.termLabel)}</h3>\n`;

                    if (termData.assessments.length === 0) {
                      html += '<p style="font-size:10pt; color:#666;">Keine Noten für dieses Halbjahr.</p>\n';
                    } else {
                      html += '<table>\n';
                      html += '<thead><tr>';
                      html += '<th>Kategorie</th>';
                      html += '<th>Name</th>';
                      html += '<th>Datum</th>';
                      html += '<th>Note/Punkt</th>';
                      html += '</tr></thead>\n<tbody>\n';

                      for (const asm of termData.assessments) {
                        const rowClass = asm.isPoor ? ' class="poor-grade"' : '';
                        html += `<tr${rowClass}>`;
                        html += `<td>${escapeHtml(asm.catName)}</td>`;
                        html += `<td>${escapeHtml(asm.asmName)}</td>`;
                        html += `<td>${escapeHtml(asm.asmDate)}</td>`;
                        html += `<td>${escapeHtml(asm.rawValue)}</td>`;
                        html += '</tr>\n';
                      }

                      html += '</tbody></table>\n';
                    }

                    // Durchschnitt für dieses Halbjahr
                    const termAvgClass = termData.overallIsPoor ? ' class="poor-grade"' : '';
                    html += `<div class="term-average"${termAvgClass}>`;
                    if (termData.presentation) {
                      html += `${termData.presentation.qualificationPhase}, ${termData.presentation.courseTypeLabel}, ${termData.presentation.examRequirementLabel}: ${termData.presentation.calculatedLabel}: ${termData.presentation.calculatedText}`;
                    } else if (termData.overall != null && Number.isFinite(termData.overall)) {
                      html += `${termData.overallLabel}: ${formatLegacyFixed(termData.overall, 2)}`;
                    } else {
                      html += `${termData.overallLabel}: noch nicht berechenbar`;
                    }
                    html += '</div>\n';
                    if (termData.presentation && Number.isInteger(termData.presentation.finalizedPoints)) {
                      html += `<div class="term-average">${termData.presentation.finalizedLabel}: ${termData.presentation.finalizedPoints}</div>\n`;
                    }
                  }

                  if (courseData.combinedOverall != null && Number.isFinite(courseData.combinedOverall)) {
                    const combinedAvgClass = courseData.combinedOverallIsPoor
                      ? ' class="poor-grade term-average"'
                      : ' class="term-average"';
                    const combinedLabel = courseData.upperSec
                      ? 'Rechenwert inkl. Vorhalbjahr'
                      : 'Jahresgesamtnote (H1 + H2)';
                    html += `<div${combinedAvgClass}>${combinedLabel}: ${formatLegacyFixed(courseData.combinedOverall, 2)}</div>\n`;
                  }
                }
              }

              // Unterschriftenbereich
              html += `
<div class="signature-area">
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Datum</div>
  </div>
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Unterschrift Schüler/in</div>
  </div>
  <div class="signature-box">
    <div class="signature-line"></div>
    <div>Unterschrift Erziehungsberechtigte/r</div>
  </div>
</div>
`;

              // Page break nach jedem Schüler außer dem letzten
              if (i < allStudentsData.length - 1) {
                html += '<div class="page-break"></div>\n';
              }
            }

            html += '</body></html>';

              printWin.document.open();
              printWin.document.write(html);
              printWin.document.close();

              // Erst drucken, wenn das austauschbare Begleitlogo geladen oder verworfen wurde.
              printWhenAssetsReady(printWin);
            } catch(err) {
              console.error('Fehler beim Sammeldruck', err);
              alert('Druck konnte nicht erstellt werden: ' + err.message);
            }
          });
          massPrintBody.appendChild(massPrintBtn);
          // massPrintBox.appendChild(massPrintBtn); -- extraction boundary retained for focused report tests.
          section.appendChild(filterBox);

          // ------------------------------------------------------
          // Formular: neuen Schüler in den Stammdaten anlegen
          // ------------------------------------------------------
          const createBox = document.createElement("details");
          createBox.id = 'students-create-form';
          createBox.className = "students-create";
          createBox.open = false;

          const createTitle = document.createElement("summary");
          createTitle.textContent = "Neuen Schüler erfassen";
          createBox.appendChild(createTitle);

          const createRow = document.createElement("div");
          createRow.className = 'students-create-grid';

          function appendStudentField(parent, labelText, id, input) {
            const field = document.createElement('div');
            field.className = 'students-field';
            const label = document.createElement('label');
            label.textContent = labelText;
            label.setAttribute('for', id);
            input.id = id;
            field.appendChild(label);
            field.appendChild(input);
            parent.appendChild(field);
            return field;
          }

          const lnInput = document.createElement("input");
          lnInput.type = "text";
          lnInput.setAttribute('autocomplete', 'family-name');

          const fnInput = document.createElement("input");
          fnInput.type = "text";
          fnInput.setAttribute('autocomplete', 'given-name');

          const bdInput = document.createElement("input");
          bdInput.type = "text";

          const clsInput = document.createElement("input");
          clsInput.type = "text";

          const createBtn = document.createElement("button");
          createBtn.type = "button";
          createBtn.className = 'students-create-submit';
          createBtn.textContent = "Anlegen";

          createBtn.addEventListener("click", async function () {
            const ln = (lnInput.value || "").trim();
            const fn = (fnInput.value || "").trim();
            const bd = (bdInput.value || "").trim();
            const cls = (clsInput.value || "").trim();

            if (!ln && !fn) {
              window.alert("Bitte mindestens Nachname oder Vorname angeben.");
              return;
            }

            createBtn.disabled = true;
            try {
              await commitStateChange(function (candidate) {
                const stu = DomainModel.createStudent({
                  lastName: ln, firstName: fn, birthDate: bd || null, homeClass: cls || ''
                });
                DomainModel.addStudentToState(candidate, stu);
              });
              lnInput.value = '';
              fnInput.value = '';
              bdInput.value = '';
              clsInput.value = '';
            } catch (error) {
              if (!isStateCommitAborted(error)) window.alert('Die Person konnte nicht angelegt werden: ' + error.message);
            } finally {
              createBtn.disabled = false;
            }
          });

          appendStudentField(createRow, 'Nachname', 'students-create-last-name', lnInput);
          appendStudentField(createRow, 'Vorname', 'students-create-first-name', fnInput);
          appendStudentField(createRow, 'Geburtsdatum (optional)', 'students-create-birth-date', bdInput);
          appendStudentField(createRow, 'Stammklasse', 'students-create-home-class', clsInput);
          const createActions = document.createElement('div');
          createActions.className = 'students-form-actions';
          const closeCreateButton = document.createElement('button');
          closeCreateButton.type = 'button';
          closeCreateButton.textContent = 'Schließen';
          closeCreateButton.addEventListener('click', function () {
            createBox.open = false;
            openCreateButton.setAttribute('aria-expanded', 'false');
            try { openCreateButton.focus(); } catch (e) {}
          });
          createActions.appendChild(closeCreateButton);
          createActions.appendChild(createBtn);
          createRow.appendChild(createActions);

          createBox.appendChild(createRow);

          section.appendChild(createBox);
          openCreateButton.addEventListener('click', function () {
            createBox.open = true;
            openCreateButton.setAttribute('aria-expanded', 'true');
            try { lnInput.focus(); } catch (e) {}
          });
          createBox.addEventListener('toggle', function () {
            openCreateButton.setAttribute('aria-expanded', createBox.open ? 'true' : 'false');
          });

          // ------------------------------------------------------
          // Tabelle: alle Schüler (mit Bearbeiten / Löschen)
          // ------------------------------------------------------
          const tableBox = document.createElement("div");
          tableBox.className = "students-list";

          const tableToolbar = document.createElement('div');
          tableToolbar.className = 'students-list-toolbar';
          const tableTitle = document.createElement("h3");
          tableTitle.textContent = "Personen";
          tableToolbar.appendChild(tableTitle);
          const filteredCount = document.createElement('span');
          filteredCount.id = 'students-filter-count';
          filteredCount.className = 'students-filter-count';
          filteredCount.setAttribute('role', 'status');
          tableToolbar.appendChild(filteredCount);
          tableBox.appendChild(tableToolbar);

          const tableScroller = document.createElement('div');
          tableScroller.className = 'students-table-scroll';

          const table = document.createElement("table");
          table.className = "data-table";

          const thead = document.createElement("thead");
          const headRow = document.createElement("tr");
          const headCols = ["Schüler", "Geburtsdatum", "Stammklasse", "Aktive Kurse", "Aktionen"];
          for (const col of headCols) {
            const th = document.createElement("th");
            th.textContent = col;
            headRow.appendChild(th);
          }
          thead.appendChild(headRow);
          table.appendChild(thead);

          const tbody = document.createElement("tbody");
          tbody.className = 'students-list-body';
          table.appendChild(tbody);

          tableScroller.appendChild(table);
          tableBox.appendChild(tableScroller);
          section.appendChild(tableBox);
          section.appendChild(massPrintBox);

          // ------------------------------------------------------
          // Hilfsfunktion: Schüler-Detail-Modal (zeigt alle Kurse + Noten)
          // ------------------------------------------------------
          function showStudentDetailsModal(student, returnFocus) {
            // Shared upper-sec presentation: Rechenwert and Festgesetzte Punktzahl.
            const overlay = document.createElement('div');
            overlay.className = 'students-detail-overlay';
            overlay.dataset.sessionSensitiveOverlay = 'true';
            overlay.style.position = 'fixed';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.background = 'rgba(0,0,0,0.45)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '100200';

            const dialog = document.createElement('div');
            dialog.className = 'students-detail-dialog';
            if (typeof dialog.setAttribute === 'function') {
              dialog.setAttribute('role', 'dialog');
              dialog.setAttribute('aria-modal', 'true');
            }
            dialog.style.background = 'var(--bg-card, #fff)';
            dialog.style.padding = '1rem';
            dialog.style.borderRadius = '8px';
            dialog.style.maxWidth = '90%';
            dialog.style.maxHeight = '80%';
            dialog.style.overflow = 'auto';
            dialog.style.boxShadow = '0 8px 36px rgba(0,0,0,0.3)';

            const title = document.createElement('div');
            const detailIdSuffix = String(student.id).replace(/[^A-Za-z0-9_-]/g, '-');
            title.id = 'students-detail-title-' + detailIdSuffix;
            if (typeof dialog.setAttribute === 'function') dialog.setAttribute('aria-labelledby', title.id);
            title.style.fontWeight = '600';
            title.style.marginBottom = '0.5rem';
            title.style.fontSize = '1.1rem';
            title.textContent = 'Schülerdetails: ' + (student.lastName || '') + ', ' + (student.firstName || '');
            dialog.appendChild(title);

            const infoRow = document.createElement('div');
            infoRow.style.fontSize = '0.9rem';
            infoRow.style.marginBottom = '0.8rem';
            infoRow.className = 'text-muted';
            infoRow.textContent = 'Klasse: ' + (student.homeClass || '–') + ' | Geburtstag: ' + (student.birthDate || '–');
            dialog.appendChild(infoRow);

            const reportCourses = DomainModel.listStudentReportCourses(state, student.id);
            const courses = reportCourses.filter(course => !course.archivedAt);
            const archivedCourses = reportCourses.filter(course => !!course.archivedAt);

            // Halbjahrs-Filter-Dropdown (wird immer angezeigt)
            let detailTermSelect = null;

            if (courses.length === 0 && archivedCourses.length === 0) {
              const noData = document.createElement('div');
              noData.className = 'text-muted';
              noData.textContent = 'Dieser Schüler ist in keinem Kurs eingeschrieben.';
              dialog.appendChild(noData);
            } else {
              // Halbjahrs-Filter für Schüler-Detailansicht
              const detailTermSelectRow = document.createElement('div');
              detailTermSelectRow.style.display = 'flex';
              detailTermSelectRow.style.gap = '0.5rem';
              detailTermSelectRow.style.alignItems = 'center';
              detailTermSelectRow.style.marginBottom = '1rem';
              detailTermSelectRow.style.padding = '0.5rem';
              detailTermSelectRow.style.background = 'var(--info-bg)';
              detailTermSelectRow.style.borderRadius = '4px';

              const detailTermLabel = document.createElement('label');
              detailTermLabel.style.fontSize = '0.85rem';
              detailTermLabel.textContent = 'Filter nach Halbjahr:';
              if (typeof detailTermLabel.setAttribute === 'function') {
                detailTermLabel.setAttribute('for', 'students-detail-term-' + detailIdSuffix);
              }
              detailTermSelectRow.appendChild(detailTermLabel);

              detailTermSelect = document.createElement('select');
              detailTermSelect.id = 'students-detail-term-' + detailIdSuffix;
              detailTermSelect.style.padding = '0.3rem 0.5rem';
              detailTermSelect.style.borderRadius = '4px';
              detailTermSelect.style.border = '1px solid var(--btn-border)';
              detailTermSelect.style.fontSize = '0.85rem';
              detailTermSelect.style.background = 'var(--btn-bg)';
              detailTermSelect.style.color = 'var(--text-main)';

              const detailOptAll = document.createElement('option');
              detailOptAll.value = '';
              detailOptAll.textContent = 'Alle Halbjahre';
              detailTermSelect.appendChild(detailOptAll);

              // Sammle alle verfügbaren Halbjahre aus aktuellen und archivierten Kursen
              const detailTermsSet = new Set();
              const detailTermCourses = new Map();
              const collectTermsForCourse = (course) => {
                const allAssessments = state.assessments || [];
                const assessmentTerms = [];
                for (const asm of allAssessments) {
                  if (asm.courseId !== course.id) continue;
                  if (!asm.scores || !asm.scores[student.id]) continue;
                  const term = asm.term || (asm.date ? deriveTermFromDateValue(new Date(asm.date), course) : null);
                  if (term && term.match(/^\d{4}-H[12]$/)) assessmentTerms.push(term);
                }
                for (const term of listReportedTermsForStudent(course, student.id, assessmentTerms)) {
                  detailTermsSet.add(term);
                  if (!detailTermCourses.has(term)) detailTermCourses.set(term, new Map());
                  detailTermCourses.get(term).set(course.id, course);
                }
              };
              for (const course of courses) collectTermsForCourse(course);
              for (const course of archivedCourses) collectTermsForCourse(course);

              // Sortiere und füge Halbjahre hinzu
              const detailTerms = Array.from(detailTermsSet).sort().reverse();
              for (const term of detailTerms) {
                const opt = document.createElement('option');
                opt.value = term;
                opt.textContent = formatTermLabelForCourses(
                  term,
                  Array.from((detailTermCourses.get(term) || new Map()).values()),
                  state
                );
                detailTermSelect.appendChild(opt);
              }

              // Setze Standard auf aktuelles Halbjahr
              if (currentTermLocal && detailTerms.includes(currentTermLocal)) {
                detailTermSelect.value = currentTermLocal;
              } else if (detailTerms.length > 0) {
                detailTermSelect.value = detailTerms[0];
              }

              detailTermSelectRow.appendChild(detailTermSelect);
              dialog.appendChild(detailTermSelectRow);

              // Container für die Kurse (wird je nach Filter-Auswahl gefüllt)
              const coursesContainer = document.createElement('div');
              dialog.appendChild(coursesContainer);

              function renderCourseList(selectedDetailTerm, courseList, sectionTitle) {
                if (!courseList || courseList.length === 0) return;
                const sectionHeader = document.createElement('div');
                sectionHeader.style.fontWeight = '600';
                sectionHeader.style.margin = '0.25rem 0 0.4rem 0';
                sectionHeader.textContent = sectionTitle;
                coursesContainer.appendChild(sectionHeader);

                for (const course of courseList) {
                  const evaluationSettings = getEvaluationSettingsForCourse(course);
                  const courseBox = document.createElement('div');
                  courseBox.style.marginBottom = '1rem';
                  courseBox.style.borderTop = '1px solid var(--border-soft)';
                  courseBox.style.paddingTop = '0.5rem';

                  const courseHeader = document.createElement('div');
                  courseHeader.style.fontWeight = '600';
                  courseHeader.style.marginBottom = '0.3rem';
                  courseHeader.textContent = course.name + ' (' + course.subject + ', ' + (course.classLabel || '–') + ')';
                  courseBox.appendChild(courseHeader);

                  // Leistungen für diesen Kurs abrufen und nach Halbjahr filtern
                  const allAssessments = DomainModel.listAssessmentsForCourse(state, course.id);
                  const assessments = allAssessments.filter(asm => {
                    if (!asm.scores || !asm.scores[student.id]) return false;
                    if (!selectedDetailTerm) return true; // Alle Halbjahre
                    const asmTerm = asm.term || (asm.date ? deriveTermFromDateValue(new Date(asm.date), course) : null);
                    return asmTerm === selectedDetailTerm;
                  });

                  if (assessments.length === 0) {
                    const noAsm = document.createElement('div');
                    noAsm.className = 'text-muted';
                    noAsm.style.fontSize = '0.85rem';
                    noAsm.textContent = 'Keine Leistungen für dieses Halbjahr.';
                    courseBox.appendChild(noAsm);
                  } else {
                    // Tabelle: Leistungen
                    const asmTable = document.createElement('table');
                    asmTable.style.fontSize = '0.85rem';
                    asmTable.style.width = '100%';
                    asmTable.style.marginBottom = '0.4rem';

                    const asmThead = document.createElement('thead');
                    const asmTr = document.createElement('tr');
                    ['Leistung', 'Kategorie', 'Datum', 'Halbjahr', 'Note/Punkte', 'Status'].forEach(t => {
                      const th = document.createElement('th');
                      th.textContent = t;
                      th.style.textAlign = 'left';
                      asmTr.appendChild(th);
                    });
                    asmThead.appendChild(asmTr);
                    asmTable.appendChild(asmThead);

                    const asmTbody = document.createElement('tbody');

                    for (const asm of assessments) {
                      const scorePresentation = formatReportScorePresentation(
                        course, asm, student.id, evaluationSettings, 'student'
                      );
                      const status = scorePresentation.status;
                      const rawValue = scorePresentation.text;

                      const tr = document.createElement('tr');

                      const tdTitle = document.createElement('td');
                      tdTitle.textContent = asm.title || 'L';
                      tr.appendChild(tdTitle);

                      const tdCat = document.createElement('td');
                      const cat = (evaluationSettings.categories || []).find(c => c.id === asm.categoryId);
                      let categoryLabel = cat ? cat.name : '–';
                      if (cat && asm.subcategoryId && Array.isArray(cat.subcategories)) {
                        const subcategory = cat.subcategories.find(item => item.id === asm.subcategoryId);
                        if (subcategory) categoryLabel += ' / ' + subcategory.name;
                      }
                      tdCat.textContent = categoryLabel;
                      tr.appendChild(tdCat);

                      const tdDate = document.createElement('td');
                      tdDate.textContent = asm.date || '–';
                      tr.appendChild(tdDate);

                      const tdTerm = document.createElement('td');
                      const termVal = asm.term || (asm.date ? deriveTermFromDateValue(new Date(asm.date), course) : null);
                      tdTerm.textContent = termVal ? formatTermLabel(termVal, course.schemaMode, termVal, course) : '–';
                      tr.appendChild(tdTerm);

                      const tdValue = document.createElement('td');
                      tdValue.textContent = rawValue;
                      // Markiere schlechte Einzelnoten im Detail-Modal
                      const numeric = scorePresentation.numeric;
                      try {
                        if (numeric != null && isPoorValue(course, numeric, rawValue)) {
                          tdValue.style.backgroundColor = '#ffcdd2';
                          if (document.body.classList.contains('theme-dark')) tdValue.style.color = '#050505';
                        }
                      } catch (e) {}
                      tr.appendChild(tdValue);

                      const tdStatus = document.createElement('td');
                      if (status === DomainModel.SCORE_STATUS.VALID) tdStatus.textContent = 'gültig';
                      else if (status === DomainModel.SCORE_STATUS.MISSING) tdStatus.textContent = 'fehlt';
                      else if (status === DomainModel.SCORE_STATUS.EXCUSED) tdStatus.textContent = 'entsch.';
                      else if (status === 'not-scheduled') tdStatus.textContent = 'nicht vorgesehen';
                      tr.appendChild(tdStatus);

                      asmTbody.appendChild(tr);
                    }

                    asmTable.appendChild(asmTbody);
                    const asmTableScroll = document.createElement('div');
                    asmTableScroll.className = 'students-detail-table-scroll';
                    asmTableScroll.appendChild(asmTable);
                    courseBox.appendChild(asmTableScroll);
                  }

                  const assessmentTerms = allAssessments
                    .filter(asm => asm.scores && asm.scores[student.id])
                    .map(asm => asm.term || (asm.date ? deriveTermFromDateValue(new Date(asm.date), course) : null));
                  const reportedTerms = listReportedTermsForStudent(course, student.id, assessmentTerms)
                    .filter(term => !selectedDetailTerm || term === selectedDetailTerm);

                  if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
                    for (const term of reportedTerms) {
                      const presentation = buildUpperSecContextPresentation(course, student.id, term, state);
                      const resultDiv = document.createElement('div');
                      resultDiv.style.fontSize = '0.9rem';
                      resultDiv.style.fontWeight = '600';
                      resultDiv.style.marginBottom = '0.3rem';
                      resultDiv.textContent = formatTermLabel(term, course.schemaMode, term, course) + ' (' +
                        presentation.qualificationPhase + ', ' + presentation.courseTypeLabel + ', ' +
                        presentation.examRequirementLabel + '): ' +
                        presentation.calculatedLabel + ': ' + presentation.calculatedText;
                      courseBox.appendChild(resultDiv);
                      if (Number.isInteger(presentation.finalizedPoints)) {
                        const finalizedDiv = document.createElement('div');
                        finalizedDiv.style.fontSize = '0.9rem';
                        finalizedDiv.textContent = presentation.finalizedLabel + ': ' + presentation.finalizedPoints;
                        courseBox.appendChild(finalizedDiv);
                      }
                      if (presentation.manualDecisionWarning) {
                        const warningDiv = document.createElement('div');
                        warningDiv.className = 'info-box';
                        warningDiv.dataset.upperSecManualDecisionWarning = 'true';
                        warningDiv.style.fontSize = '0.85rem';
                        warningDiv.style.margin = '0.35rem 0';
                        warningDiv.style.borderColor = '#b45309';
                        warningDiv.textContent = 'Fachlicher Warnhinweis: ' + presentation.manualDecisionWarning;
                        courseBox.appendChild(warningDiv);
                      }
                    }
                  }

                  const detailOverallLabel = getStudentDetailOverallLabel(course, selectedDetailTerm);
                  if (detailOverallLabel) {
                    const overall = selectedDetailTerm
                      ? GradingLogic.computeOverallGrade(course, student.id, state, selectedDetailTerm)
                      : GradingLogic.computeOverallGrade(course, student.id, state);
                    const avgDiv = document.createElement('div');
                    avgDiv.style.fontSize = '0.9rem';
                    avgDiv.style.fontWeight = '600';
                    avgDiv.style.marginBottom = '0.3rem';
                    if (overall != null && Number.isFinite(overall)) {
                      avgDiv.textContent = detailOverallLabel + ': ' + formatLegacyFixed(overall, 2);
                      try {
                        if (isPoorValue(course, overall)) {
                          avgDiv.style.backgroundColor = '#ffcdd2';
                          if (document.body.classList.contains('theme-dark')) avgDiv.style.color = '#050505';
                        }
                      } catch (e) {}
                    } else {
                      avgDiv.textContent = detailOverallLabel + ': noch nicht berechenbar';
                      avgDiv.className = 'text-muted';
                    }
                    courseBox.appendChild(avgDiv);
                  }

                  coursesContainer.appendChild(courseBox);
                }
              }

              // Initialer Render mit Standard-Filter: aktuelle und archivierte Kurse
              const initialTerm = detailTermSelect.value || '';
              renderCourseList(initialTerm, courses, 'Aktuelle Kurse');
              renderCourseList(initialTerm, archivedCourses, 'Archivierte Kurse');

              // Filter-Änderung -> Neu-Render
              detailTermSelect.addEventListener('change', function() {
                while (coursesContainer.firstChild) coursesContainer.removeChild(coursesContainer.firstChild);
                const termVal = detailTermSelect.value || '';
                renderCourseList(termVal, courses, 'Aktuelle Kurse');
                renderCourseList(termVal, archivedCourses, 'Archivierte Kurse');
                updateDetailPrintScope();
              });
            }

            const detailPrintScope = document.createElement('section');
            detailPrintScope.className = 'students-print-scope students-print-scope--personal';
            if (typeof detailPrintScope.setAttribute === 'function') detailPrintScope.setAttribute('aria-live', 'polite');
            const detailPrintScopeTitle = document.createElement('h4');
            detailPrintScopeTitle.textContent = 'Druckumfang';
            detailPrintScope.appendChild(detailPrintScopeTitle);
            const detailPrintPerson = document.createElement('div');
            detailPrintPerson.className = 'students-print-scope-row';
            detailPrintScope.appendChild(detailPrintPerson);
            const detailPrintCourses = document.createElement('div');
            detailPrintCourses.className = 'students-print-scope-row';
            detailPrintScope.appendChild(detailPrintCourses);
            const detailPrintTerm = document.createElement('div');
            detailPrintTerm.className = 'students-print-scope-row';
            detailPrintScope.appendChild(detailPrintTerm);
            const detailPrintFilterHint = document.createElement('p');
            detailPrintFilterHint.className = 'students-print-scope-hint';
            detailPrintFilterHint.textContent = 'Der Kursfilter der Personenliste begrenzt diesen persönlichen Bericht nicht.';
            detailPrintScope.appendChild(detailPrintFilterHint);
            const detailPrintVisibilityHint = document.createElement('p');
            detailPrintVisibilityHint.className = 'students-print-scope-hint';
            detailPrintVisibilityHint.textContent = 'Nur für PDF-Berichte freigegebene Leistungen werden ausgegeben.';
            detailPrintScope.appendChild(detailPrintVisibilityHint);

            function updateDetailPrintScope() {
              detailPrintPerson.textContent = 'Person: ' + (student.lastName || '') +
                ((student.lastName && student.firstName) ? ', ' : '') + (student.firstName || '');
              detailPrintCourses.textContent = 'Kurse: ' + (reportCourses.length > 0
                ? reportCourses.map(course => {
                    const context = [];
                    if (course.classLabel) context.push(course.classLabel);
                    if (course.archivedAt) context.push('archiviert');
                    return (course.name || 'Kurs') + (context.length > 0 ? ' (' + context.join(', ') + ')' : '');
                  }).join('; ')
                : 'Keine Berichtskurse');
              detailPrintTerm.textContent = 'Zeitraumauswahl: ' + (detailTermSelect
                ? selectedOptionText(detailTermSelect, 'Alle Halbjahre')
                : 'Alle Halbjahre');
            }

            updateDetailPrintScope();
            dialog.appendChild(detailPrintScope);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'space-between';
            btnRow.style.gap = '0.5rem';
            btnRow.style.marginTop = '0.8rem';

            const pdfBtn = document.createElement('button');
            pdfBtn.type = 'button';
            pdfBtn.textContent = '📄 PDF Notenübersicht drucken';
            if (detailTermSelect) {
              pdfBtn.addEventListener('click', function () {
                // Übergebe den aktuell gewählten Filter-Term an PDF-Generator
                const selectedPrintTerm = detailTermSelect.value || null;
                generateStudentGradePDF(student, selectedPrintTerm);
              });
            } else {
              pdfBtn.addEventListener('click', function () {
                // Keine Kurse: keine Filter möglich
                generateStudentGradePDF(student, null);
              });
            }

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.textContent = 'Schließen';
            let detailDialogClosed = false;
            function closeStudentDetailsModal() {
              if (detailDialogClosed) return;
              detailDialogClosed = true;
              dialog.removeEventListener('keydown', onDetailDialogKeyDown);
              try { document.body.removeChild(overlay); } catch (e) {}
              try { if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus(); } catch (e) {}
            }
            overlay.__closeForSessionLock = closeStudentDetailsModal;
            function onDetailDialogKeyDown(event) {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (typeof event.stopPropagation === 'function') event.stopPropagation();
                closeStudentDetailsModal();
                return;
              }
              if (event.key !== 'Tab') return;
              const focusTargets = Array.from(dialog.querySelectorAll('button, select, input, textarea, a'))
                .filter(control => !control.disabled && control.tabIndex !== -1);
              if (focusTargets.length === 0) return;
              const firstTarget = focusTargets[0];
              const lastTarget = focusTargets[focusTargets.length - 1];
              const activeTarget = document.activeElement;
              if (event.shiftKey && activeTarget === firstTarget) {
                event.preventDefault();
                lastTarget.focus();
              } else if (!event.shiftKey && activeTarget === lastTarget) {
                event.preventDefault();
                firstTarget.focus();
              }
            }
            closeBtn.addEventListener('click', closeStudentDetailsModal);

            btnRow.appendChild(pdfBtn);
            btnRow.appendChild(closeBtn);
            dialog.appendChild(btnRow);
            dialog.addEventListener('keydown', onDetailDialogKeyDown);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            try { closeBtn.focus(); } catch (e) {}
          }

          // ------------------------------------------------------
          // Hilfsfunktion: Tabelle basierend auf aktuellen Filterwerten aufbauen
          // ------------------------------------------------------
          function refreshTable(filteredStudents = getFilteredStudents()) {
            // Tabelle leeren
            while (tbody.firstChild) {
              tbody.removeChild(tbody.firstChild);
            }
            let filteredStudentCount = 0;

            for (const stu of filteredStudents) {
              // Kurse des Schülers
              const courses = coursesByStudent.get(stu.id) || [];

              // Zeile erstellen
              const tr = document.createElement("tr");
              tr.setAttribute('data-student-id', stu.id);
              filteredStudentCount += 1;

              const tdLast = document.createElement("td");
              tdLast.className = 'students-person-cell';
              const personName = document.createElement('strong');
              personName.textContent = (stu.lastName || '') + ((stu.lastName && stu.firstName) ? ', ' : '') + (stu.firstName || '');
              tdLast.appendChild(personName);
              tr.appendChild(tdLast);

              const tdBirth = document.createElement("td");
              tdBirth.textContent = stu.birthDate || "–";
              tr.appendChild(tdBirth);

              const tdClass = document.createElement("td");
              tdClass.textContent = stu.homeClass || "–";
              tr.appendChild(tdClass);

              const tdCourseCount = document.createElement("td");
              tdCourseCount.className = 'students-course-memberships';
              if (courses.length === 0) {
                tdCourseCount.textContent = 'Ohne aktiven Kurs';
                tdCourseCount.classList.add('text-muted');
              } else {
                for (const course of courses) {
                  const badge = document.createElement('span');
                  badge.className = 'students-course-badge';
                  badge.textContent = (course.name || 'Kurs') + (course.classLabel ? ' · ' + course.classLabel : '');
                  tdCourseCount.appendChild(badge);
                }
              }
              tr.appendChild(tdCourseCount);

              const tdActions = document.createElement("td");
              tdActions.className = 'students-row-actions';
              // Button: Lösch-Button vorbereiten (wird wiederverwendet bei Inline-Edit)
              const deleteBtn = document.createElement("button");
              deleteBtn.type = "button";
              deleteBtn.textContent = "Löschen";
              deleteBtn.className = "danger";
              deleteBtn.addEventListener("click", async function () {
                const ok = window.confirm(
                  "Schüler komplett löschen?\n" +
                    "Er wird aus allen Kursen entfernt und alle Noteneinträge werden gelöscht."
                );
                if (!ok) return;

                const studentId = stu.id;
                try {
                  await commitStateChange(function (candidate) {
                    requireStudent(candidate, studentId);
                    const removalResult = DomainModel.removeStudentFromState(candidate, studentId);
                    if (removalResult === false) throw new Error('Die Person ist Bestandteil eines archivierten Kurses.');
                    if (removalResult !== true) throw new Error('Der Personendatensatz ist unvollständig.');
                  });
                } catch (error) {
                  if (!isStateCommitAborted(error)) window.alert('Löschen nicht möglich: ' + error.message);
                }
              });

              // Button: Details anzeigen (Kurse + Noten)
              const detailsBtn = document.createElement("button");
              detailsBtn.type = "button";
              detailsBtn.textContent = "Details";
              detailsBtn.addEventListener("click", function () {
                showStudentDetailsModal(stu, detailsBtn);
              });

              // Button: Bearbeiten
              const editBtn = document.createElement("button");
              editBtn.type = "button";
              editBtn.textContent = "Edit";
              editBtn.addEventListener("click", function () {
                // Inline-Editing: ersetze Zellen durch Eingabefelder
                try {
                  // Erzeuge Inputs
                   const lastInput = document.createElement('input');
                   lastInput.type = 'text';
                   lastInput.value = stu.lastName || '';
                   lastInput.setAttribute('autocomplete', 'family-name');

                   const firstInput = document.createElement('input');
                   firstInput.type = 'text';
                   firstInput.value = stu.firstName || '';
                   firstInput.setAttribute('autocomplete', 'given-name');

                   const birthInput = document.createElement('input');
                   birthInput.type = 'text';
                   birthInput.value = stu.birthDate || '';

                   const classInputInline = document.createElement('input');
                   classInputInline.type = 'text';
                   classInputInline.value = stu.homeClass || '';
                   const editIdPrefix = 'students-edit-' + String(stu.id).replace(/[^A-Za-z0-9_-]/g, '-');

                   // Referenzen auf die Zellen
                   tdLast.replaceChildren();
                   tdLast.className = 'students-person-cell students-edit-person';
                   appendStudentField(tdLast, 'Nachname', editIdPrefix + '-last-name', lastInput);
                   appendStudentField(tdLast, 'Vorname', editIdPrefix + '-first-name', firstInput);

                   tdBirth.replaceChildren();
                   appendStudentField(tdBirth, 'Geburtsdatum', editIdPrefix + '-birth-date', birthInput);

                   tdClass.replaceChildren();
                   appendStudentField(tdClass, 'Stammklasse', editIdPrefix + '-home-class', classInputInline);

                  // Ersetze Edit-Button durch Save + Cancel
                  // Entferne vorhandene Buttons im Actions-Bereich temporär
                  const existingDelete = deleteBtn; // closure reference
                  // Clear actions and re-add save/cancel and delete
                  while (tdActions.firstChild) tdActions.removeChild(tdActions.firstChild);

                  const saveBtn = document.createElement('button');
                  saveBtn.type = 'button';
                  saveBtn.textContent = 'Speichern';
                  saveBtn.addEventListener('click', async function () {
                    if (saveBtn.disabled) return;
                    saveBtn.disabled = true;
                    cancelBtn.disabled = true;
                    existingDelete.disabled = true;
                    try {
                      const studentId = stu.id;
                      const values = {
                        lastName: (lastInput.value || '').trim(),
                        firstName: (firstInput.value || '').trim(),
                        birthDate: (birthInput.value || '').trim() || null,
                        homeClass: (classInputInline.value || '').trim()
                      };
                      await commitStateChange(function (candidate) {
                        const candidateStudent = requireStudent(candidate, studentId);
                        Object.assign(candidateStudent, values);
                      });
                    } catch (error) {
                      if (isStateCommitAborted(error)) return;
                      const detail = error && error.message ? error.message : 'Unbekannter Fehler.';
                      try { window.alert('Stammdaten konnten nicht gespeichert werden: ' + detail); } catch (e) {}
                    } finally {
                      saveBtn.disabled = false;
                      cancelBtn.disabled = false;
                      existingDelete.disabled = false;
                    }
                  });

                  const cancelBtn = document.createElement('button');
                  cancelBtn.type = 'button';
                  cancelBtn.textContent = 'Abbrechen';
                  cancelBtn.addEventListener('click', function () {
                    // Verwerfe Änderungen und neu rendern
                    render();
                  });

                  tdActions.appendChild(saveBtn);
                  tdActions.appendChild(cancelBtn);
                  tdActions.appendChild(existingDelete);

                  // Fokus auf erstes Eingabefeld
                  try { lastInput.focus(); } catch (e) {}
                } catch (err) {
                  console.error('Fehler beim Inline-Edit starten:', err);
                }
              });
              tdActions.appendChild(detailsBtn);
              tdActions.appendChild(editBtn);

              // (deleteBtn bereits weiter oben vorbereitet)
              tdActions.appendChild(deleteBtn);

              tr.appendChild(tdActions);

              tbody.appendChild(tr);
            }

            if (tbody.children.length === 0) {
              const trEmpty = document.createElement("tr");
              const tdEmpty = document.createElement("td");
              tdEmpty.colSpan = 5;
              tdEmpty.className = "text-muted students-empty-state";
              tdEmpty.textContent = "Keine Personen für diese Filterkombination.";
              trEmpty.appendChild(tdEmpty);
              tbody.appendChild(trEmpty);
            }
            filteredCount.textContent = filteredStudentCount + ' von ' + state.students.length + ' Personen';
          }

          function refreshFilteredStudentsView() {
            const filteredStudents = getFilteredStudents();
            updateTermsInDropdown(filteredStudents);
            refreshTable(filteredStudents);
            updateMassPrintScope(filteredStudents);
          }

          // Filter-Ereignisse -> Zeitraum, Tabelle und Druckumfang gemeinsam neu aufbauen
          nameFilterInput.addEventListener("input", refreshFilteredStudentsView);
          classFilterSelect.addEventListener("change", refreshFilteredStudentsView);
          courseFilterSelect.addEventListener("change", refreshFilteredStudentsView);

          // Initiales Rendering der Tabelle
          refreshFilteredStudentsView();

          container.appendChild(section);
          } catch (err) {
            console.error('Fehler in renderStudentsSection:', err);
            const errorSection = document.createElement('section');
            errorSection.className = 'section';
            const errorMsg = document.createElement('div');
            errorMsg.style.color = 'red';
            errorMsg.style.padding = '1rem';
            errorMsg.textContent = 'Fehler beim Laden der Stammdaten: ' + err.message;
            errorSection.appendChild(errorMsg);
            container.appendChild(errorSection);
          }
        }


        function renderGradesheetSection(container, dashboardTransition) {
          const section = document.createElement("section");
          section.className = "section gradesheet-workspace";

          // Flag für Tastatur-Navigation (verhindert Re-Rendering während Navigation)
          let isNavigating = false;
          const gradesheetEditors = [];
          const renderedStudentRows = [];
          let gradesheetStatusControlSequence = 0;

          function registerGradesheetEditor(editor) {
            gradesheetEditors.push(editor);
            if (dashboardTransition && typeof dashboardTransition.register === 'function') {
              dashboardTransition.register(editor);
            }
          }

          async function finishGradesheetEditors() {
            for (const editor of gradesheetEditors) {
              try {
                const finished = await editor.finish();
                if (finished === false) {
                  editor.focus();
                  return false;
                }
              } catch (error) {
                editor.focus();
                return false;
              }
            }
            for (const editor of gradesheetEditors) {
              if (typeof editor.isClean === 'function' && !editor.isClean()) {
                editor.focus();
                return false;
              }
            }
            return true;
          }

          function normalizeGradesheetSearch(value) {
            return String(value || '').trim().toLocaleLowerCase('de');
          }

          function trackGradesheetStudentRow(row, student) {
            renderedStudentRows.push({
              row,
              searchName: normalizeGradesheetSearch(
                [student.lastName, student.firstName].filter(Boolean).join(' ')
              )
            });
          }

          function appendRowStatusDisclosure(nameCell, student, row) {
            const studentName = [student.lastName, student.firstName].filter(Boolean).join(', ') || 'Schüler';
            const details = document.createElement('details');
            details.className = 'gradesheet-row-status';
            details.open = false;
            const summary = document.createElement('summary');
            summary.textContent = 'Status';
            summary.setAttribute('aria-label', 'Eintragstatus für ' + studentName);
            summary.setAttribute('aria-controls', '');
            details.appendChild(summary);
            const explanation = document.createElement('span');
            explanation.className = 'gradesheet-row-status-help';
            explanation.textContent = 'Status direkt bei der jeweiligen Leistung auswählen.';
            details.appendChild(explanation);
            nameCell.appendChild(details);
            row._gradesheetStatusSummary = summary;
          }

          function connectRowStatusControl(row, statusSelect) {
            const id = 'gradesheet-entry-status-' + (++gradesheetStatusControlSequence);
            statusSelect.id = id;
            const summary = row._gradesheetStatusSummary;
            if (!summary) return;
            const controlledIds = String(summary.dataset.controlIds || '').split(/\s+/).filter(Boolean);
            controlledIds.push(id);
            summary.dataset.controlIds = controlledIds.join(' ');
            summary.setAttribute('aria-controls', summary.dataset.controlIds);
          }

          const selectedCourse = currentCourseId
            ? DomainModel.findCourseById(state, currentCourseId)
            : null;
          const gradesheetHeader = document.createElement('div');
          gradesheetHeader.className = 'gradesheet-header';
          const gradesheetHeading = document.createElement('div');
          gradesheetHeading.className = 'gradesheet-heading';
          gradesheetHeader.appendChild(gradesheetHeading);
          let courseIdentity = null;
          if (selectedCourse) {
            courseIdentity = document.createElement('div');
            courseIdentity.className = 'gradesheet-course-identity';
            const courseName = document.createElement('strong');
            courseName.textContent = selectedCourse.name || 'Unbenannter Kurs';
            const courseContext = document.createElement('span');
            courseContext.textContent = [selectedCourse.subject, selectedCourse.classLabel]
              .filter(Boolean)
              .join(' · ');
            courseIdentity.appendChild(courseName);
            if (courseContext.textContent) courseIdentity.appendChild(courseContext);
            gradesheetHeading.appendChild(courseIdentity);
          }
          const h2 = document.createElement("h2");
          h2.textContent = gradesheetView === 'year' ? 'Gesamtes Schuljahr' : 'Noteneingabe';
          gradesheetHeading.appendChild(h2);
          section.appendChild(gradesheetHeader);

          let directAssessmentCreateButton = null;
          if (selectedCourse && !selectedCourse.archivedAt && gradesheetView === 'entry') {
            directAssessmentCreateButton = document.createElement('button');
            directAssessmentCreateButton.type = 'button';
            directAssessmentCreateButton.className = 'gradesheet-direct-create';
            directAssessmentCreateButton.textContent = 'Neue Leistung anlegen';
            directAssessmentCreateButton.setAttribute('aria-controls', 'gradesheet-new-assessment');
            gradesheetHeader.appendChild(directAssessmentCreateButton);
          }


          const hint = document.createElement("div");
          hint.className = "section-hint";
          hint.textContent = gradesheetView === 'year'
            ? 'Reine Auswertung: Die Werte sind berechnet und werden hier nicht festgesetzt oder bearbeitet.'
            : (selectedCourse && selectedCourse.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
            ? 'Schüler stehen in den Zeilen, Leistungen in den Spalten. Trage ganze Punkte von 0 bis 15 ein.'
            : 'Schüler stehen in den Zeilen, Leistungen in den Spalten. Trage die im Notenschema hinterlegten Noten ein.');

          // Status-Info (wird später aktualisiert wenn ein Kurs gewählt ist)
          const termStatus = document.createElement('div');
          termStatus.className = 'text-muted gradesheet-term-status';
          termStatus.textContent = '';
          if (courseIdentity) courseIdentity.appendChild(termStatus);
          else gradesheetHeading.appendChild(termStatus);

          // (Entwickler-Testbuttons entfernt für Produktion)
          const tableHelp = document.createElement('details');
          tableHelp.className = 'gradesheet-table-help';
          const tableHelpSummary = document.createElement('summary');
          tableHelpSummary.textContent = 'Legende und Eingabehinweise';
          tableHelp.appendChild(tableHelpSummary);
          const tableHelpContent = document.createElement('div');
          tableHelpContent.className = 'gradesheet-table-help-content';
          tableHelpContent.appendChild(hint);
          tableHelp.appendChild(tableHelpContent);

          // Hilfsfunktionen (für Farben, Änderungen, Löschen)
          function getBackgroundForValue(course, value, rawValue) {
            if (value === null || value === undefined || !Number.isFinite(value)) {
              return "";
            }
            const band = resolveGradeColorBand(course.schemaMode, value, rawValue);
            return band ? 'var(--grade-bg-' + band + ')' : '';
          }

          function appendTermResultEditor(row, stu, term, summaryClass, termLabel) {
            const td = document.createElement('td');
            td.className = 'gradesheet-term-result gradesheet-editor-cell gradesheet-summary-column';
            if (summaryClass) td.classList.add(summaryClass);
            const initialPoints = DomainModel.getTermResult(course, stu.id, term);
            const input = createTermResultInput(initialPoints, course.archivedAt);
            input.className = 'gradesheet-term-result-input';
            input.style.width = '4.5rem';
            const studentName = [stu.lastName, stu.firstName].filter(Boolean).join(', ') || 'Schüler';
            const displayedTerm = termLabel || term || 'Halbjahr';
            const resultHelpId = 'gradesheet-term-result-help';
            input.setAttribute('aria-label', 'Festgesetzte Punktzahl für ' + studentName + ' – ' + displayedTerm);
            input.setAttribute('aria-describedby', resultHelpId);
            input.setAttribute('aria-invalid', 'false');

            const errorEl = document.createElement('div');
            errorEl.className = 'gradesheet-input-error';
            errorEl.id = 'gradesheet-term-result-error-' + (++gradesheetErrorSequence);
            errorEl.textContent = '';
            errorEl.style.display = 'none';

            const wrapper = document.createElement('div');
            wrapper.className = 'gradesheet-input-wrap gradesheet-term-result-wrap';
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.alignItems = 'stretch';
            wrapper.style.flex = '1 1 0';
            wrapper.style.minWidth = '0';
            wrapper.style.width = '100%';
            wrapper.appendChild(input);
            wrapper.appendChild(errorEl);
            td.appendChild(wrapper);
            row.appendChild(td);

            if (course.archivedAt) return;

            const beginTermResultInteraction = createLatestInteractionGuard();
            let lastSavedRaw = input.value;
            let pendingTermResultPromise = null;
            let failedTermResultBlocksNextFinish = false;

            function clearTermResultError() {
              input.classList.remove('gradesheet-input-invalid');
              input.setAttribute('aria-invalid', 'false');
              input.setAttribute('aria-describedby', resultHelpId);
              input.title = '';
              errorEl.textContent = '';
              errorEl.style.display = 'none';
            }

            function showTermResultError(message, invalidInput) {
              if (invalidInput) input.classList.add('gradesheet-input-invalid');
              else input.classList.remove('gradesheet-input-invalid');
              input.setAttribute('aria-invalid', invalidInput ? 'true' : 'false');
              input.setAttribute('aria-describedby', resultHelpId + ' ' + errorEl.id);
              input.title = message;
              errorEl.textContent = message;
              errorEl.style.display = 'block';
              input.focus();
            }

            function saveTermResultInput() {
              if (pendingTermResultPromise) {
                const requestedRaw = input.value;
                return pendingTermResultPromise.then(function (saved) {
                  return saved || input.value === requestedRaw ? saveTermResultInput() : false;
                });
              }
              if (input.validity && input.validity.badInput) {
                showTermResultError('Bitte eine ganze Punktzahl von 0 bis 15 eingeben oder das Feld leeren.', true);
                return false;
              }
              let nextPoints;
              try {
                nextPoints = parseTermResultInput(input.value);
              } catch (error) {
                showTermResultError(error.message, true);
                return false;
              }

              const normalizedRaw = nextPoints === null ? '' : String(nextPoints);
              if (normalizedRaw === lastSavedRaw) {
                input.value = normalizedRaw;
                clearTermResultError();
                return true;
              }

              clearTermResultError();
              const isLatestInteraction = beginTermResultInteraction();
              const operation = (async function () {
                try {
                  await persistTermResultWithRollback(
                    course.id,
                    stu.id,
                    term,
                    nextPoints,
                    commitStateChange
                  );
                  lastSavedRaw = normalizedRaw;
                  if (!isLatestInteraction() || input.value !== normalizedRaw) return true;
                  input.value = normalizedRaw;
                  clearTermResultError();
                  return true;
                } catch (error) {
                  if (!isLatestInteraction() || input.value !== normalizedRaw) return false;
                  const confirmedCourse = DomainModel.findCourseById(state, course.id);
                  const restoredPoints = confirmedCourse
                    ? DomainModel.getTermResult(confirmedCourse, stu.id, term)
                    : null;
                  input.value = Number.isInteger(restoredPoints) ? String(restoredPoints) : '';
                  lastSavedRaw = input.value;
                  failedTermResultBlocksNextFinish = true;
                  showTermResultError('Speichern fehlgeschlagen. Die vorherige Eingabe bleibt erhalten.', false);
                  return false;
                } finally {
                  if (pendingTermResultPromise === operation) {
                    pendingTermResultPromise = null;
                  }
                }
              })();
              pendingTermResultPromise = operation;
              return operation;
            }

            function finishTermResultEditor() {
              if (failedTermResultBlocksNextFinish) {
                failedTermResultBlocksNextFinish = false;
                return false;
              }
              const result = saveTermResultInput();
              if (!result || typeof result.then !== 'function') return result;
              return result.then(function (saved) {
                if (!saved) {
                  failedTermResultBlocksNextFinish = false;
                  return false;
                }
                return finishTermResultEditor();
              });
            }

            function termResultEditorIsClean() {
              if (pendingTermResultPromise || failedTermResultBlocksNextFinish) return false;
              if (input.validity && input.validity.badInput) return false;
              try {
                const points = parseTermResultInput(input.value);
                const raw = points === null ? '' : String(points);
                return raw === lastSavedRaw;
              } catch (error) {
                return false;
              }
            }

            const termResultEditor = {
              finish: finishTermResultEditor,
              isClean: termResultEditorIsClean,
              focus: function () { input.focus(); }
            };
            if (typeof registerGradesheetEditor === 'function') {
              registerGradesheetEditor(termResultEditor);
            } else if (dashboardTransition && typeof dashboardTransition.register === 'function') {
              dashboardTransition.register(termResultEditor);
            }

            input.addEventListener('change', async function () {
              await saveTermResultInput();
            });

            input.addEventListener('keydown', async function (event) {
              if (event.key !== 'Enter' && event.key !== 'Tab') return;
              event.preventDefault();
              const saved = await saveTermResultInput();
              if (!saved) return;
              const inputs = Array.from(document.querySelectorAll(
                '.gradesheet-input, .gradesheet-term-result-input:not([disabled])'
              ));
              const nextInput = findNextGradesheetInput(inputs, input, 'Tab');
              if (nextInput) {
                nextInput.focus();
                nextInput.select();
              }
            });
          }

          // --- Integrationstest-Funktion: erstellt temporär Daten, prüft Berechnung und entfernt alles wieder ---
          function runPrevTermIntegrationTest() {
            // Sorgt dafür, dass der Test keine sichtbaren Persistenz-Reste hinterlässt.
            const createdIds = { students: [], courses: [], assessments: [], categories: [] };
            // Aktivere temporäres Debug-Logging für die Laufzeit dieses Tests
            const _prevDebug = !!window.DEBUG_PREVTERM;
            window.DEBUG_PREVTERM = true;

            // Hilfs: sicherstellen dass es mindestens eine aktive Kategorie gibt
            let catId = null;
            if (Array.isArray(state.settings.categories) && state.settings.categories.length > 0) {
              const act = state.settings.categories.find(c => c.active);
              if (act) catId = act.id;
            }
            if (!catId) {
              const cat = DomainModel.createCategory({ name: 'TMP-Kategorie', active: true });
              state.settings.categories = state.settings.categories || [];
              state.settings.categories.push(cat);
              createdIds.categories.push(cat.id);
              catId = cat.id;
            }

            // 1) Erzeuge Test-Schüler
            const testStu = DomainModel.createStudent({ lastName: 'TestPrev', firstName: 'T' });
            DomainModel.addStudentToState(state, testStu);
            createdIds.students.push(testStu.id);

            // 2) Erzeuge Test-Kurs mit includePrevTermGrades = true
            const testCourse = DomainModel.createCourse({ name: 'PrevTerm Test', subject: 'TEST', classLabel: 'T1', schemaMode: DomainModel.SCHEMA_MODES.GRADES, includePrevTermGrades: true });
            DomainModel.addCourseToState(state, testCourse);
            createdIds.courses.push(testCourse.id);

            // Einschreiben
            DomainModel.enrollStudentInCourse(state, testCourse.id, testStu.id);

            // 3) Erzeuge 2 Leistungen (H1 und H2)
            const asmH1 = DomainModel.createAssessment({ courseId: testCourse.id, categoryId: catId, title: 'M1 (H1)', date: '2025-02-15', term: '2025-H1', weight: 1, visible: true });
            const asmH2 = DomainModel.createAssessment({ courseId: testCourse.id, categoryId: catId, title: 'M2 (H2)', date: '2025-10-01', term: '2025-H2', weight: 1, visible: true });
            DomainModel.addAssessmentToState(state, asmH1);
            DomainModel.addAssessmentToState(state, asmH2);
            createdIds.assessments.push(asmH1.id, asmH2.id);

            // 4) Trage Noten ein (H1 -> 2.0 ; H2 -> 4.0)
            const a1 = DomainModel.findAssessmentById(state, asmH1.id);
            const a2 = DomainModel.findAssessmentById(state, asmH2.id);
            if (!a1 || !a2) {
              alert('Fehler: Test-Assessments konnten nicht angelegt werden.');
              return;
            }
            a1.scores = a1.scores || {};
            a2.scores = a2.scores || {};
            const e1 = DomainModel.createScoreEntry({ valueRaw: '2', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 2 });
            const e2 = DomainModel.createScoreEntry({ valueRaw: '4', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 4 });
            a1.scores[testStu.id] = e1;
            a2.scores[testStu.id] = e2;

            // Speichern (lokal) und Render aktualisieren
            persistDiagnosticState();
            // Setze Testkurs als aktuell, damit Gradesheet gerendert wird und DOM-Checks möglich sind
            currentCourseId = testCourse.id;
            try { render(); } catch (e) { /* ignore */ }

            // DOM-Check: ist das Vorjahres-Element sichtbar (gestapelte Ansicht)?
            try {
              const prevElem = document.querySelector('.term-section.prev-term');
              if (!prevElem) {
                console.error('[TEST ASSERT] Prev-term section not rendered in DOM');
                alert('Integrationstest Vorhalbjahr: Darstellung des Vorjahres fehlt (siehe Konsole).');
              } else {
                console.log('[TEST ASSERT] Prev-term section present in DOM');
              }
            } catch (e) { console.error('DOM check failed', e); }

            // 5) Berechnung: mit includePrevTermGrades = true
            let overallWith = null; let overallWithout = null;
            try {
              overallWith = GradingLogic.computeOverallGrade(testCourse, testStu.id, state);
            } catch (e) { console.error(e); }

            // 6) Jetzt Schalter aus und erneut berechnen
            testCourse.includePrevTermGrades = false;
            try { render(); } catch (e) {}
            try {
              overallWithout = GradingLogic.computeOverallGrade(testCourse, testStu.id, state);
            } catch (e) { console.error(e); }

            // 6b) Berechne per-term Kategoriedurchschnitte zur Kontrolle
            let _perTermCheckPassed = null;
            try {
              const assessmentsForCourse = DomainModel.listAssessmentsForCourse(state, testCourse.id) || [];
              function inferTermLocal(a) { if (!a) return null; if (a.term) return a.term; if (a.date) { const d = new Date(a.date); if (!isNaN(d)) { return `${d.getFullYear()}-${(d.getMonth()+1)<=6 ? 'H1' : 'H2'}`; } } return null; }
              const found = assessmentsForCourse.map(a => inferTermLocal(a)).filter(Boolean);
              let currentTermLocal = null; if (found.length > 0) { let best=null,bestNum=-Infinity; for (const t of found) { const m=/^(\d{4})-H([12])$/.exec(t); if (m) { const n=parseInt(m[1],10)*10+parseInt(m[2],10); if (n>bestNum) {bestNum=n;best=t;} } } currentTermLocal = best; }
              let prevTermLocal = null; if (currentTermLocal) { const pm=/^(\d{4})-H([12])$/.exec(currentTermLocal); if (pm) { const yy=parseInt(pm[1],10); const hh=parseInt(pm[2],10); prevTermLocal = (hh===2) ? `${yy}-H1` : `${yy-1}-H2`; } }

              const currAss = assessmentsForCourse.filter(a => inferTermLocal(a) === currentTermLocal && a.categoryId === catId);
              const prevAss = assessmentsForCourse.filter(a => inferTermLocal(a) === prevTermLocal && a.categoryId === catId);
              const catCurr = GradingLogic.computeCategoryAverage(currAss, testCourse, testStu.id, catId, state.settings);
              const catPrev = GradingLogic.computeCategoryAverage(prevAss, testCourse, testStu.id, catId, state.settings);

              console.log('[TEST] Per-term category averages', {currentTermLocal, prevTermLocal, catCurr, catPrev});

              // Einfache Assertions: Basiserwartung für die Testdaten (H1=2, H2=4)
              const expectedPrev = 2;
              const expectedCurr = 4;
              _perTermCheckPassed = true;
              if (catPrev !== expectedPrev) {
                _perTermCheckPassed = false;
                console.error('[TEST ASSERT] Prev-term category avg mismatch: expected', expectedPrev, 'got', catPrev);
              }
              if (catCurr !== expectedCurr) {
                _perTermCheckPassed = false;
                console.error('[TEST ASSERT] Curr-term category avg mismatch: expected', expectedCurr, 'got', catCurr);
              }
              if (!_perTermCheckPassed) {
                alert('Integrationstest Vorhalbjahr: Per-term averages mismatch — siehe Konsole.');
              }
            } catch (e) { _perTermCheckPassed = false; console.error('Per-term cat avg failed', e); }

            // 7) Aufräumen: entferne Testdaten
            state.assessments = state.assessments.filter(a => !createdIds.assessments.includes(a.id));
            state.students = state.students.filter(s => !createdIds.students.includes(s.id));
            state.courses = state.courses.filter(c => !createdIds.courses.includes(c.id));
            if (createdIds.categories.length > 0) {
              state.settings.categories = (state.settings.categories || []).filter(c => !createdIds.categories.includes(c.id));
            }

            persistDiagnosticState();
            try { render(); } catch (e) {}

            // Debug-Flag zurücksetzen
            window.DEBUG_PREVTERM = _prevDebug;

            // 8) Ergebnis darstellen
            let msg = 'Integrationstest Vorhalbjahr:\n';
            msg += `Gesamtnote (mit Aktiviert): ${overallWith === null ? 'nicht berechenbar' : formatLegacyFixed(overallWith, 2) ?? String(overallWith)}\n`;
            msg += `Gesamtnote (mit Deaktiviert): ${overallWithout === null ? 'nicht berechenbar' : formatLegacyFixed(overallWithout, 2) ?? String(overallWithout)}\n`;

            if (overallWith !== null && overallWithout !== null) {
              if (Math.abs(Number(overallWith) - Number(overallWithout)) > 1e-6) {
                msg += '\nErgebnis: Unterschied festgestellt – Test erfolgreich.';
              } else {
                msg += '\nErgebnis: Keine Veränderung festgestellt (möglicherweise fehlerhafte Term-Erkennung).';
              }
            }

            if (_perTermCheckPassed === false) {
              msg += '\nPer-term averages: Mismatch (siehe Konsole).';
            } else if (_perTermCheckPassed === true) {
              msg += '\nPer-term averages: OK.';
            } else {
              msg += '\nPer-term averages: nicht abgeprüft.';
            }

            alert(msg);
            console.log(msg);
          }

          // --- Integrationstest: Oberstufe (Punkte) ---
          function runUpperSecPrevTermTest() {
            const createdIds = { students: [], courses: [], assessments: [], categories: [] };

            // Ensure a category exists
            let catId = null;
            if (Array.isArray(state.settings.categories) && state.settings.categories.length > 0) {
              const act = state.settings.categories.find(c => c.active);
              if (act) catId = act.id;
            }
            if (!catId) {
              const cat = DomainModel.createCategory({ name: 'TMP-OS', active: true });
              state.settings.categories = state.settings.categories || [];
              state.settings.categories.push(cat);
              createdIds.categories.push(cat.id);
              catId = cat.id;
            }

            // Einige Schüler anlegen
            const s1 = DomainModel.createStudent({ lastName: 'Müller', firstName: 'Lena' });
            const s2 = DomainModel.createStudent({ lastName: 'Schmidt', firstName: 'Jonas' });
            DomainModel.addStudentToState(state, s1);
            DomainModel.addStudentToState(state, s2);
            createdIds.students.push(s1.id, s2.id);

            // Oberstufen-Kurs anlegen (UPPERSEC)
            const c = DomainModel.createCourse({ name: 'Oberstufe Test', subject: 'Mathe', classLabel: 'Q1', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, includePrevTermGrades: true });
            DomainModel.addCourseToState(state, c);
            createdIds.courses.push(c.id);

            // Schüler einschreiben
            DomainModel.enrollStudentInCourse(state, c.id, s1.id);
            DomainModel.enrollStudentInCourse(state, c.id, s2.id);

            // Leistungen anlegen: H1 und H2
            const asmH1 = DomainModel.createAssessment({ courseId: c.id, categoryId: catId, title: 'Klassenarbeit 1 (H1)', date: '2025-03-10', term: '2025-H1', maxPoints: 20, weight: 1, visible: true });
            const asmH2 = DomainModel.createAssessment({ courseId: c.id, categoryId: catId, title: 'Klassenarbeit 2 (H2)', date: '2025-10-05', term: '2025-H2', maxPoints: 20, weight: 1, visible: true });
            DomainModel.addAssessmentToState(state, asmH1);
            DomainModel.addAssessmentToState(state, asmH2);
            createdIds.assessments.push(asmH1.id, asmH2.id);

            // Punkte eintragen. Beispiel: s1 -> H1: 15, H2: 12; s2 -> H1: 8, H2: 10
            const a1 = DomainModel.findAssessmentById(state, asmH1.id);
            const a2 = DomainModel.findAssessmentById(state, asmH2.id);
            a1.scores = a1.scores || {};
            a2.scores = a2.scores || {};
            a1.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: '15', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('15') });
            a2.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: '12', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('12') });
            a1.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: '8', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('8') });
            a2.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: '10', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('10') });

            persistDiagnosticState();
            // Aktuellen Kurs setzen, damit das Notenblatt rendert und DOM-Checks möglich sind
            currentCourseId = c.id;
            try { render(); } catch (e) {}

            // DOM-Check: Vorjahr-Sektion sollte sichtbar sein
            try {
              const prevElem = document.querySelector('.term-section.prev-term');
              if (!prevElem) {
                console.error('[TEST ASSERT] Prev-term section not rendered in DOM (UpperSec)');
                alert('Integrationstest Oberstufe: Darstellung des Vorjahres fehlt (siehe Konsole).');
              } else {
                console.log('[TEST ASSERT] Prev-term section present in DOM (UpperSec)');
              }
            } catch (e) { console.error('DOM-Check fehlgeschlagen', e); }

            // Gesamtnoten berechnen
            let overallWith = null, overallWithout = null;
            try { overallWith = GradingLogic.computeOverallGrade(c, s1.id, state); } catch (e) { console.error(e); }
            c.includePrevTermGrades = false;
            try { render(); } catch (e) {}
            try { overallWithout = GradingLogic.computeOverallGrade(c, s1.id, state); } catch (e) { console.error(e); }

            // Aufräumen
            state.assessments = state.assessments.filter(a => !createdIds.assessments.includes(a.id));
            state.students = state.students.filter(s => !createdIds.students.includes(s.id));
            state.courses = state.courses.filter(cc => !createdIds.courses.includes(cc.id));
            if (createdIds.categories.length) state.settings.categories = (state.settings.categories || []).filter(ca => !createdIds.categories.includes(ca.id));

            persistDiagnosticState();
            try { render(); } catch (e) {}

            const overallWithNumber = Number(overallWith);
            const overallWithoutNumber = Number(overallWithout);
            const msg = `Oberstufen-Test abgeschlossen. Schüler ${s1.lastName}, ${s1.firstName}: Gesamt mit Vorjahr=${overallWith != null ? formatLegacyFixed(overallWithNumber, 2) ?? String(overallWithNumber) : 'n/a'}, ohne Vorjahr=${overallWithout != null ? formatLegacyFixed(overallWithoutNumber, 2) ?? String(overallWithoutNumber) : 'n/a'}`;
            alert(msg);
            console.log(msg);
          }

          // --- Persistenter Oberstufen-Kurs anlegen (bleibt im State) ---
          function runCreatePersistentUpperSecTestCourse() {
            // Vermeide Duplikate: suche nach Kurs mit dem speziellen Namen
            const NAME = 'Oberstufe Test (persistent)';
            let existing = (state.courses || []).find(c => c.name === NAME);
            if (existing) {
              // Setze aktuellen Kurs und informiere
              currentCourseId = existing.id;
              try { render(); } catch (e) {}
              alert('Ein persistenter Testkurs existiert bereits und wurde ausgewählt.');
              return;
            }

            const created = { students: [], assessments: [] };

            // Kategorie
            let catId = null;
            if (Array.isArray(state.settings.categories) && state.settings.categories.length > 0) {
              const act = state.settings.categories.find(c => c.active);
              if (act) catId = act.id;
            }
            if (!catId) {
              const cat = DomainModel.createCategory({ name: 'TMP-OS-P', active: true });
              state.settings.categories = state.settings.categories || [];
              state.settings.categories.push(cat);
              catId = cat.id;
            }

            // Schüler anlegen
            const s1 = DomainModel.createStudent({ lastName: 'Meier', firstName: 'Anna' });
            const s2 = DomainModel.createStudent({ lastName: 'Klein', firstName: 'Ben' });
            const s3 = DomainModel.createStudent({ lastName: 'Fischer', firstName: 'Clara' });
            DomainModel.addStudentToState(state, s1);
            DomainModel.addStudentToState(state, s2);
            DomainModel.addStudentToState(state, s3);
            created.students.push(s1.id, s2.id, s3.id);

            // Kurs anlegen (Oberstufe / Punkte)
            const c = DomainModel.createCourse({ name: NAME, subject: 'Mathe', classLabel: 'Q1', schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC, includePrevTermGrades: false });
            DomainModel.addCourseToState(state, c);

            // Einschreiben
            DomainModel.enrollStudentInCourse(state, c.id, s1.id);
            DomainModel.enrollStudentInCourse(state, c.id, s2.id);
            DomainModel.enrollStudentInCourse(state, c.id, s3.id);

            // Leistungen H1 / H2
            const asmH1 = DomainModel.createAssessment({ courseId: c.id, categoryId: catId, title: 'KA H1', date: '2025-03-15', term: '2025-H1', maxPoints: 20, weight: 1, visible: true });
            const asmH2 = DomainModel.createAssessment({ courseId: c.id, categoryId: catId, title: 'KA H2', date: '2025-10-10', term: '2025-H2', maxPoints: 20, weight: 1, visible: true });
            DomainModel.addAssessmentToState(state, asmH1);
            DomainModel.addAssessmentToState(state, asmH2);
            created.assessments.push(asmH1.id, asmH2.id);

            // Beispielnoten eintragen (Punkte)
            const a1 = DomainModel.findAssessmentById(state, asmH1.id);
            const a2 = DomainModel.findAssessmentById(state, asmH2.id);
            a1.scores = a1.scores || {};
            a2.scores = a2.scores || {};
            a1.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: '15', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('15') });
            a2.scores[s1.id] = DomainModel.createScoreEntry({ valueRaw: '12', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('12') });

            a1.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: '9', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('9') });
            a2.scores[s2.id] = DomainModel.createScoreEntry({ valueRaw: '10', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('10') });

            a1.scores[s3.id] = DomainModel.createScoreEntry({ valueRaw: '18', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('18') });
            a2.scores[s3.id] = DomainModel.createScoreEntry({ valueRaw: '16', status: DomainModel.SCORE_STATUS.VALID, valueNumeric: GradingLogic.parseUpperSecPoints('16') });

            // Setze aktuellen Kurs sichtbar
            currentCourseId = c.id;

            persistDiagnosticState();
            try { render(); } catch (e) {}

            alert('Persistenter Oberstufen-Kurs angelegt: "' + NAME + '" (wird nicht automatisch entfernt).');
            console.log('Persistenter Oberstufen-Kurs angelegt:', c.id);
          }

          // Exportiere die Test-Funktionen nur im expliziten Debug-Modus.
          runWhenDebugModeEnabled(function () {
            try {
            installDebugWindowHook('runPrevTermIntegrationTest', function () {
              try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Invoking runPrevTermIntegrationTest'); } catch (e) {}
              if (typeof runPrevTermIntegrationTest === 'function') {
                try { return runPrevTermIntegrationTest(); } catch (err) { console.error('runPrevTermIntegrationTest failed', err); alert('Fehler beim Test: ' + (err && err.message)); }
              } else {
                alert('Test-Funktion noch nicht verfügbar. Bitte kurze Sekunde warten und erneut versuchen.');
              }
            });
            installDebugWindowHook('runUpperSecPrevTermTest', function () {
              try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Invoking runUpperSecPrevTermTest'); } catch (e) {}
              if (typeof runUpperSecPrevTermTest === 'function') {
                try { return runUpperSecPrevTermTest(); } catch (err) { console.error('runUpperSecPrevTermTest failed', err); alert('Fehler beim Test: ' + (err && err.message)); }
              } else {
                alert('Test-Funktion noch nicht verfügbar. Bitte kurze Sekunde warten und erneut versuchen.');
              }
            });
            installDebugWindowHook('runCreatePersistentUpperSecTestCourse', function () {
              try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Invoking runCreatePersistentUpperSecTestCourse'); } catch (e) {}
              if (typeof runCreatePersistentUpperSecTestCourse === 'function') {
                try { return runCreatePersistentUpperSecTestCourse(); } catch (err) { console.error('runCreatePersistentUpperSecTestCourse failed', err); alert('Fehler beim Anlegen: ' + (err && err.message)); }
              } else {
                alert('Erstellungs-Funktion noch nicht verfügbar. Bitte kurze Sekunde warten und erneut versuchen.');
              }
            });
            // If autorun params were recorded earlier, trigger the requested tests now that functions are exported
            try {
              if (window.__autorunParams) {
                if (window.__autorunParams.runPrevTest) {
                  try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting runPrevTermIntegrationTest (deferred)'); } catch (e) {}
                  try { runPrevTermIntegrationTest(); } catch (e) { console.error('Deferred runPrevTermIntegrationTest failed', e); }
                }
                if (window.__autorunParams.createPersistTest) {
                  try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting runCreatePersistentUpperSecTestCourse (deferred)'); } catch (e) {}
                  try { runCreatePersistentUpperSecTestCourse(); } catch (e) { console.error('Deferred runCreatePersistentUpperSecTestCourse failed', e); }
                }
                if (window.__autorunParams.fixPersistTest) {
                  // perform fix
                  try {
                    const NAME = 'Oberstufe Test (persistent)';
                    const existing = (state.courses || []).find(c => c.name === NAME);
                    if (existing) {
                      existing.includePrevTermGrades = false;
                      currentCourseId = existing.id;
                      persistDiagnosticState();
                      try { render(); } catch (e) {}
                    }
                  } catch (e) { console.error('Deferred fixPersistTest failed', e); }
                }
                // Clear params after attempting
                window.__autorunParams = null;
              }
            } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
          });

          // Prüft, ob ein Wert als "schlecht" gilt und rot markiert werden soll.
          // Regeln:
          // - Sek I (GRADES): ab "4-" und schlechter → rot. Da das interne Parsen
          //   keine feinen +/-‑Abstände abbildet, verwenden wir heuristisch:
          //   - Wenn ein roher String vorhanden ist und ein '-' enthält und die
          //     numerische Note >= 4 ist → schlecht.
          //   - Sonst: numerischer Schwellenwert von 4.25 und höher gilt als schlecht
          //     (approx. 4- und schlechter).
          // - Sek II (UPPERSEC): Punkte ≤ 4 gelten als schlecht.
          function isPoorValue(course, numericValue, rawString) {
            if (numericValue === null || numericValue === undefined || !Number.isFinite(numericValue)) return false;
            if (!course || course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
              // Grades: prüfe rohen String zuerst
              if (rawString && /-/.test(String(rawString))) {
                if (Number(numericValue) >= 4) return true;
              }
              // Fallback-Schwelle für Durchschnittswerte bzw. fehlenden Raw-String
              return Number(numericValue) >= 4.25;
            } else {
              // Oberstufe: niedrige Punktzahlen sind schlecht
              return Number(numericValue) <= 4;
            }
          }

          async function deleteAssessment(assessmentId) {
            const assessment = DomainModel.findAssessmentById(state, assessmentId);
            if (!isAssessmentInManagementScope(assessment)) return false;
            const ok = window.confirm(
              "Diese Leistung inkl. aller eingetragenen Noten wirklich löschen?"
            );
            if (!ok) return false;
            try {
              return await persistAssessmentDeletionWithRollback(assessmentId, function (change) {
                return commitStateChange(function (candidate) {
                  requireManagedAssessment(candidate, assessmentId);
                  change(candidate);
                });
              });
            } catch (error) {
              console.error("Leistung konnte nicht gelöscht werden:", error);
              window.alert(
                "Die Leistung wurde nicht gelöscht. Bitte prüfen und erneut versuchen. " + error.message
              );
              return false;
            }
          }

          // Zwischenspeicher für erlaubte Halbjahre in Add/Edit-Dialogen (wird nach Term-Ermittlung befüllt)
          let allowedTerms = [];

          function editAssessment(assessment) {
            assessment = DomainModel.findAssessmentById(state, assessment.id);
            if (!isAssessmentInManagementScope(assessment)) return;
            // Modal zum Bearbeiten der Leistung
            const overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.background = "rgba(0,0,0,0.5)";
            overlay.style.display = "flex";
            overlay.style.alignItems = "center";
            overlay.style.justifyContent = "center";
            overlay.style.zIndex = "10000";

            const dialog = document.createElement("div");
            dialog.style.background = "var(--bg-card, #fff)";
            dialog.style.padding = "1.5rem";
            dialog.style.borderRadius = "8px";
            dialog.style.minWidth = "400px";
            dialog.style.maxWidth = "90%";
            dialog.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";

            const title = document.createElement("h3");
            title.textContent = "Leistung bearbeiten";
            title.style.marginTop = "0";
            dialog.appendChild(title);

            // Kategorie
            const catLabel = document.createElement("label");
            catLabel.textContent = "Kategorie:";
            catLabel.style.display = "block";
            catLabel.style.marginTop = "0.5rem";
            catLabel.style.fontWeight = "600";
            dialog.appendChild(catLabel);

            const catSelect = document.createElement("select");
            catSelect.style.width = "100%";
            catSelect.style.boxSizing = "border-box";
            catSelect.style.marginTop = "0.3rem";

            const activeCats = (state.settings.categories || []).filter(c => c.active);
            for (const c of activeCats) {
              const opt = document.createElement("option");
              opt.value = c.id;
              opt.textContent = c.name;
              if (c.id === assessment.categoryId) opt.selected = true;
              catSelect.appendChild(opt);
            }
            catSelect.value = assessment.categoryId || '';
            dialog.appendChild(catSelect);

            // Unterkategorie
            const subcatLabel = document.createElement("label");
            subcatLabel.textContent = "Unterkategorie:";
            subcatLabel.style.display = "block";
            subcatLabel.style.marginTop = "0.8rem";
            subcatLabel.style.fontWeight = "600";
            dialog.appendChild(subcatLabel);

            const subcatSelect = document.createElement("select");
            subcatSelect.style.width = "100%";
            subcatSelect.style.boxSizing = "border-box";
            subcatSelect.style.marginTop = "0.3rem";

            const subcatPlaceholder = document.createElement("option");
            subcatPlaceholder.value = "";
            subcatPlaceholder.textContent = "(keine)";
            subcatSelect.appendChild(subcatPlaceholder);

            // Funktion zum Aktualisieren der Unterkategorien
            const updateSubcategories = () => {
              while (subcatSelect.children.length > 1) {
                subcatSelect.removeChild(subcatSelect.lastChild);
              }

              const selectedCatId = catSelect.value;
              const selectedCat = state.settings.categories.find(c => c.id === selectedCatId);

              if (selectedCat && selectedCat.subcategories && selectedCat.subcategories.length > 0) {
                subcatSelect.style.display = "block";
                subcatLabel.style.display = "block";
                for (const subcat of selectedCat.subcategories) {
                  const opt = document.createElement("option");
                  opt.value = subcat.id;
                  opt.textContent = subcat.name;
                  if (subcat.id === assessment.subcategoryId) opt.selected = true;
                  subcatSelect.appendChild(opt);
                }
              } else {
                subcatSelect.style.display = "none";
                subcatLabel.style.display = "none";
              }
            };

            catSelect.addEventListener("change", updateSubcategories);
            updateSubcategories();
            dialog.appendChild(subcatSelect);

            // Titel
            const titleLabel = document.createElement("label");
            titleLabel.textContent = "Bezeichnung:";
            titleLabel.style.display = "block";
            titleLabel.style.marginTop = "0.8rem";
            titleLabel.style.fontWeight = "600";
            dialog.appendChild(titleLabel);

            const titleInput = document.createElement("input");
            titleInput.type = "text";
            titleInput.value = assessment.title || "";
            titleInput.style.width = "100%";
            titleInput.style.boxSizing = "border-box";
            titleInput.style.marginTop = "0.3rem";
            dialog.appendChild(titleInput);

            // Datum
            const dateLabel = document.createElement("label");
            dateLabel.textContent = "Datum:";
            dateLabel.style.display = "block";
            dateLabel.style.marginTop = "0.8rem";
            dateLabel.style.fontWeight = "600";
            dialog.appendChild(dateLabel);

            const dateInput = document.createElement("input");
            dateInput.type = "date";
            dateInput.value = assessment.date || "";
            dateInput.style.marginTop = "0.3rem";
            dialog.appendChild(dateInput);

            const termLabel = document.createElement("label");
            termLabel.textContent = "Halbjahr:";
            termLabel.style.display = "block";
            termLabel.style.marginTop = "0.8rem";
            termLabel.style.fontWeight = "600";
            dialog.appendChild(termLabel);

            const termSelect = document.createElement('select');
            termSelect.style.width = '100%';
            termSelect.style.boxSizing = 'border-box';
            termSelect.style.marginTop = '0.3rem';

            const automaticTermOption = document.createElement('option');
            automaticTermOption.value = 'auto';
            automaticTermOption.textContent = 'Automatisch nach Datum';
            termSelect.appendChild(automaticTermOption);

            const allowed = (allowedTerms && allowedTerms.length ? allowedTerms.slice() : []);
            if (allowed.length === 0) {
              const fallbackTerm = deriveTermFromDateValue(new Date(), course);
              if (fallbackTerm) allowed.push(fallbackTerm);
            }

            // Generiere nur sinnvolle Halbjahre: vorheriges, aktuelles, nächstes
            const allPossibleTerms = new Set(allowed);
            const storedTerm = typeof assessment.term === 'string' ? assessment.term.trim() : '';
            if (/^\d{4}-H[12]$/.test(storedTerm)) allPossibleTerms.add(storedTerm);

            // Füge vorheriges, aktuelles und nächstes Halbjahr hinzu
            if (prevTermLocal) allPossibleTerms.add(prevTermLocal);
            if (currentTermLocal) allPossibleTerms.add(currentTermLocal);
            if (nextTermLocal) allPossibleTerms.add(nextTermLocal);

            const termsArray = Array.from(allPossibleTerms).sort((a, b) => {
              const aNum = parseInt(a.split('-')[0]) * 10 + (a.endsWith('H1') ? 1 : 2);
              const bNum = parseInt(b.split('-')[0]) * 10 + (b.endsWith('H1') ? 1 : 2);
              return aNum - bNum;
            });

            for (const t of termsArray) {
              const opt = document.createElement('option');
              const label = formatTermLabel(t, course.schemaMode, currentTermLocal).replace(/^\d{4}-/, '') + (t === currentTermLocal ? ' (aktuell)' : (t === prevTermLocal ? ' (vorher)' : (t === nextTermLocal ? ' (nächstes)' : '')));
              opt.value = t; opt.textContent = label;
              termSelect.appendChild(opt);
            }

            // Vorauswahl: automatische Ableitung oder vorhandenes manuelles Halbjahr.
            const existingTerm = assessment.term || null;
            if (assessment.termAssignment === 'auto') {
              termSelect.value = 'auto';
            } else if (existingTerm && termsArray.indexOf(existingTerm) !== -1) {
              termSelect.value = existingTerm;
            } else if (termsArray.length > 0) {
              termSelect.value = termsArray[0];
            } else {
              termSelect.value = 'auto';
            }

            dialog.appendChild(termSelect);

            // Gewicht
            const weightLabel = document.createElement("label");
            weightLabel.textContent = "Gewicht:";
            weightLabel.style.display = "block";
            weightLabel.style.marginTop = "0.8rem";
            weightLabel.style.fontWeight = "600";
            dialog.appendChild(weightLabel);

            const weightInput = document.createElement("input");
            weightInput.type = "number";
            weightInput.step = "0.1";
            weightInput.min = "0";
            weightInput.value = assessment.weight ?? 1;
            weightInput.style.width = "6rem";
            weightInput.style.marginTop = "0.3rem";
            dialog.appendChild(weightInput);

            // Sichtbarkeit
            const visibleLabel = document.createElement("label");
            visibleLabel.style.display = "flex";
            visibleLabel.style.alignItems = "center";
            visibleLabel.style.marginTop = "0.8rem";
            visibleLabel.style.gap = "0.5rem";
            visibleLabel.style.cursor = "pointer";

            const visibleCheckbox = document.createElement("input");
            visibleCheckbox.type = "checkbox";
            visibleCheckbox.checked = assessment.visible !== false;
            visibleCheckbox.id = "edit-visible-checkbox";

            const visibleText = document.createElement("span");
            visibleText.textContent = "In PDF-Berichten anzeigen";
            visibleText.style.fontWeight = "600";

            visibleLabel.appendChild(visibleCheckbox);
            visibleLabel.appendChild(visibleText);
            dialog.appendChild(visibleLabel);

            const visibleHint = document.createElement("div");
            visibleHint.textContent = "Deaktivierte Leistungen bleiben in Notentabelle, Statistik und Berechnung enthalten, werden aber in Einzel- und Sammel-PDFs ausgeblendet.";
            visibleHint.style.fontSize = "0.8rem";
            visibleHint.style.marginTop = "0.3rem";
            visibleHint.style.color = "var(--text-muted, #777)";
            dialog.appendChild(visibleHint);

            // Buttons
            const btnRow = document.createElement("div");
            btnRow.style.display = "flex";
            btnRow.style.gap = "0.5rem";
            btnRow.style.marginTop = "1.5rem";
            btnRow.style.justifyContent = "flex-end";

            const saveBtn = document.createElement("button");
            saveBtn.textContent = "Speichern";
            saveBtn.type = "button";
            const saveStatus = document.createElement('div');
            saveStatus.setAttribute('role', 'alert');
            saveStatus.className = 'text-muted';
            saveStatus.style.marginTop = '0.6rem';
            saveBtn.addEventListener("click", async function() {
              if (saveBtn.disabled) return;
              const newTitle = titleInput.value.trim();
              if (!newTitle) {
                window.alert("Bitte eine Bezeichnung eingeben.");
                return;
              }

              const newCatId = catSelect.value;
              const newSubcatId = subcatSelect.value || null;

              // Prüfe ob Unterkategorie erforderlich ist
              const selectedCat = state.settings.categories.find(c => c.id === newCatId);
              if (selectedCat && selectedCat.subcategories && selectedCat.subcategories.length > 0) {
                if (!newSubcatId) {
                  window.alert("Bitte eine Unterkategorie auswählen.");
                  return;
                }
              }

              // Term-Auswahl validieren (kein Freitext)
              const selTerm = termSelect.value ? String(termSelect.value).trim() : '';
              const automaticAssignment = selTerm === 'auto';
              if (!automaticAssignment && (!selTerm || termsArray.indexOf(selTerm) === -1)) {
                window.alert('Bitte eine gültige Vorauswahl wählen.');
                return;
              }
              const assignmentDate = dateInput.value ? parseHalfYearDateValue(dateInput.value) : new Date();
              const resolvedTerm = automaticAssignment
                ? deriveTermFromDateValue(assignmentDate, course)
                : selTerm;
              if (!resolvedTerm) { window.alert('Das Halbjahr konnte nicht automatisch bestimmt werden.'); return; }
              const newWeight = parseFloat(weightInput.value.replace(",", "."));
              if (!Number.isFinite(newWeight) || newWeight < 0) {
                window.alert("Das Gewicht muss eine Zahl größer oder gleich 0 sein.");
                return;
              }

              const assessmentId = assessment.id;
              const input = {
                categoryId: newCatId,
                subcategoryId: newSubcatId,
                title: newTitle,
                date: dateInput.value || null,
                selectedTerm: selTerm,
                automaticAssignment: automaticAssignment,
                weight: newWeight,
                visible: visibleCheckbox.checked
              };
              saveBtn.disabled = true;
              saveStatus.textContent = '';
              try {
                await commitStateChange(function (candidate) {
                  const candidateAssessment = requireManagedAssessment(candidate, assessmentId);
                  const candidateCourse = requireActiveCourse(candidate, candidateAssessment.courseId);
                  const candidateCategory = (candidate.settings.categories || []).find(function (item) {
                    return item.id === input.categoryId && item.active;
                  });
                  if (!candidateCategory) throw new Error('Die ausgewählte Kategorie ist nicht mehr verfügbar.');
                  if (candidateCategory.subcategories && candidateCategory.subcategories.length > 0 &&
                      !candidateCategory.subcategories.some(function (item) { return item.id === input.subcategoryId; })) {
                    throw new Error('Die ausgewählte Unterkategorie ist nicht mehr verfügbar.');
                  }
                  const candidateDate = input.date ? parseHalfYearDateValue(input.date) : new Date();
                  const candidateTerm = input.automaticAssignment
                    ? GradingLogic.resolveAssessmentTermFromDateValue(candidateDate, candidateCourse, candidate.settings)
                    : input.selectedTerm;
                  if (!candidateTerm) throw new Error('Das Halbjahr konnte nicht bestimmt werden.');
                  candidateAssessment.categoryId = input.categoryId;
                  candidateAssessment.subcategoryId = input.subcategoryId;
                  candidateAssessment.title = input.title;
                  candidateAssessment.date = input.date;
                  candidateAssessment.term = candidateTerm;
                  candidateAssessment.termAssignment = input.automaticAssignment ? 'auto' : 'manual';
                  candidateAssessment.weight = input.weight;
                  candidateAssessment.visible = input.visible;
                }, { render: false });
                try { document.body.removeChild(overlay); } catch (e) {}
                render();
              } catch (error) {
                saveStatus.textContent = 'Die Leistung wurde nicht gespeichert. Bitte prüfen und erneut versuchen. ' + error.message;
              } finally {
                saveBtn.disabled = false;
              }
            });

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Abbrechen";
            cancelBtn.type = "button";
            cancelBtn.addEventListener("click", function() {
              try { document.body.removeChild(overlay); } catch (e) {}
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(saveBtn);
            dialog.appendChild(btnRow);
            dialog.appendChild(saveStatus);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
          }

          // Kein Kurs gewählt?
          if (!currentCourseId) {
            const p = document.createElement("p");
            p.className = "text-muted";
            p.textContent =
              "Es ist kein Kurs ausgewählt. Bitte oben einen Kurs wählen oder in der Kursübersicht einen Kurs anlegen.";
            section.appendChild(p);
            container.appendChild(section);
            return;
          }

          const course = selectedCourse;
          if (!course) {
            const p = document.createElement("p");
            p.className = "text-muted";
            p.textContent = "Der ausgewählte Kurs konnte nicht gefunden werden.";
            section.appendChild(p);
            container.appendChild(section);
            return;
          }

          function isAcceptableScoreEditorDraft(raw, scoreStatus) {
            if (scoreStatus !== DomainModel.SCORE_STATUS.VALID) return true;
            const trimmed = String(raw || '').trim();
            return trimmed === '' || GradingLogic.isValidRawForCourse(trimmed, course, state.settings);
          }

          const assessmentsAll = DomainModel.listAssessmentsForCourse(state, course.id) || [];
          let gradesheetErrorSequence = 0;

          function scoreInputGuidance() {
            if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
              return 'Erlaubt: 0 bis 15, nur ganze Punkte.';
            }
            const standardLabels = [
              '1+', '1', '1-', '2+', '2', '2-', '3+', '3', '3-',
              '4+', '4', '4-', '5+', '5', '5-', '6'
            ];
            const acceptedLabels = Object.keys(state.settings.gradeMapping || {}).filter(label =>
              GradingLogic.isValidRawForCourse(label, course, state.settings)
            );
            const usesStandardLabels = acceptedLabels.length === standardLabels.length &&
              standardLabels.every(label => acceptedLabels.includes(label));
            if (usesStandardLabels) return 'Erlaubt: Noten von 1+ bis 6.';
            if (acceptedLabels.length === 0) return 'Es sind keine gültigen Notenlabels im Notenschema hinterlegt. Bitte das Notenschema prüfen.';
            return 'Erlaubt: ' + acceptedLabels.sort((a, b) => a.localeCompare(b, 'de')).join(', ') + '.';
          }

          function invalidScoreMessage(statusError) {
            return (statusError ? 'Status bleibt unverändert. ' : 'Nicht gespeichert. ') + scoreInputGuidance();
          }

          function deriveTermFromDateValue(d, courseObj) {
            return resolveGradesheetTermFromDateValue(d, courseObj, state);
          }

          // Konvertiere H1/H2 Term zu Q-Nummer für Oberstufe
          function hTermToQNumber(hTerm, currentTerm, schoolYearStartMonth) {
            if (!hTerm || !currentTerm || !/^\d{4}-H[12]$/.test(hTerm) || !/^\d{4}-H[12]$/.test(currentTerm)) {
              return null;
            }
            // schoolYearStartMonth: z.B. 8 für August (Standard)
            // Wenn currentTerm H1 ist, befinden wir uns im Schuljahr des Jahres (Aug-Jan)
            // Wenn currentTerm H2 ist, befinden wir uns im Schuljahr des Jahres (Feb-Jul)
            const currYear = parseInt(currentTerm.slice(0, 4), 10);
            const currHalf = currentTerm.endsWith('H1') ? 1 : 2;
            const termYear = parseInt(hTerm.slice(0, 4), 10);
            const termHalf = hTerm.endsWith('H1') ? 1 : 2;

            // Basis: Q1 = aktuelles H1, Q2 = aktuelles H2, Q3/Q4 = Vorjahr
            let qNum;
            if (termYear === currYear) {
              // Im aktuellen Schuljahr
              qNum = termHalf === 1 ? 1 : 2;
            } else if (termYear === currYear - 1) {
              // Im Vorjahr
              qNum = termHalf === 1 ? 3 : 4;
            } else if (termYear === currYear + 1) {
              // Im Folgejahr (rare)
              qNum = termHalf === 1 ? 1 : 2;
            } else {
              return null;
            }
            return qNum;
          }

          function formatTermLabel(term, schemaMode = 'GRADES', currentTerm = null) {
            return formatGradesheetTermLabel(term, course || { schemaMode }, state);
          }
          function computePrevTerm(term) {
            const m = /^(.+)-H([12])$/.exec(term || '');
            if (!m) return null;
            const y = parseInt(m[1], 10);
            const h = parseInt(m[2], 10);
            return h === 2 ? `${y}-H1` : `${y - 1}-H2`;
          }
          function computeNextTerm(term) {
            const m = /^(.+)-H([12])$/.exec(term || '');
            if (!m) return null;
            const y = parseInt(m[1], 10);
            const h = parseInt(m[2], 10);
            return h === 1 ? `${y}-H2` : `${y + 1}-H1`;
          }
          function getTermValue(asm, fallback, termCourse = course, termState = state) {
            if (!asm) return fallback || null;
            if (asm.term) return asm.term;
            if (asm.date) {
              const t = resolveGradesheetTermFromDateValue(parseAssessmentDateValue(asm.date), termCourse, termState);
              if (t) return t;
            }
            return fallback || null;
          }

          function isAssessmentInManagementScope(assessment, candidateState = state) {
            if (!assessment || assessment.courseId !== course.id) return false;
            const candidateCourse = DomainModel.findCourseById(candidateState, course.id);
            if (!candidateCourse || candidateCourse.archivedAt) return false;
            const currentTerm = resolveGradesheetTermFromDateValue(new Date(), candidateCourse, candidateState);
            const assessmentTerm = getTermValue(assessment, null, candidateCourse, candidateState);
            return !!currentTerm && (assessmentTerm === currentTerm || assessmentTerm === computeNextTerm(currentTerm));
          }

          function requireManagedAssessment(candidate, assessmentId) {
            const assessment = requireAssessment(candidate, assessmentId);
            if (!isAssessmentInManagementScope(assessment, candidate)) {
              throw new Error('Leistungen können nur im aktuellen oder nächsten Halbjahr bearbeitet oder gelöscht werden.');
            }
            return assessment;
          }

          function setGradesheetEntryAccessibleNames(input, statusSelect, student, assessment, fallbackTerm) {
            const studentName = [student.lastName, student.firstName].filter(Boolean).join(', ') || 'Schüler';
            const assessmentTitle = assessment && assessment.title ? assessment.title : 'L';
            const assessmentTerm = getTermValue(assessment, fallbackTerm);
            const displayedTerm = formatTermLabel(
              assessmentTerm,
              course.schemaMode,
              currentTermLocal
            ) || assessmentTerm || 'Halbjahr';
            const entryContext = studentName + ' – Leistung „' + assessmentTitle + '“ – ' + displayedTerm;
            const valueLabel = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC ? 'Punktzahl' : 'Note';
            input.setAttribute('aria-label', valueLabel + ' für ' + entryContext);
            statusSelect.setAttribute('aria-label', 'Eingabestatus für ' + entryContext);
          }

          function buildAllowedTerms(curr, prev, next, assessmentsList) {
            const set = new Set();
            const add = (t) => { if (t) set.add(t); };
            add(curr); add(prev); add(next);
            (assessmentsList || []).forEach(a => {
              const t = getTermValue(a, null);
              if (t) set.add(t);
            });
            if (set.size === 0) {
              add(deriveTermFromDateValue(new Date(), course));
            }
            return Array.from(set);
          }

          // Aktualisiere Term-Statusanzeige
          // HOIST: Variablen hier deklarieren, damit sie auch später beim Rendern verfügbar sind
          let currentTermLocal = null;
          let prevTermLocal = null;
          let nextTermLocal = null;
          try {
            // WICHTIG: Aktuelles Halbjahr IMMER aus dem heutigen Datum ableiten,
            // nicht aus vorhandenen Leistungen (sonst bleibt es auf H1 hängen wenn nur H1-Daten existieren)
            currentTermLocal = deriveTermFromDateValue(new Date(), course);
            // Fallback: nur wenn deriveTermFromDateValue fehlschlägt, höchstes vorhandenes Halbjahr nehmen
            if (!currentTermLocal) {
              const found = assessmentsAll.map(a => getTermValue(a)).filter(Boolean);
              if (found.length > 0) {
                let best = null; let bestNum = -Infinity;
                for (const t of found) { const m = /^(\d{4})-H([12])$/.exec(t); if (m) { const n = parseInt(m[1],10)*10 + parseInt(m[2],10); if (n > bestNum) { bestNum = n; best = t; } } }
                currentTermLocal = best;
              }
            }
            prevTermLocal = null;
            if (currentTermLocal) {
              prevTermLocal = computePrevTerm(currentTermLocal);
              nextTermLocal = computeNextTerm(currentTermLocal);
            }

            allowedTerms = buildAllowedTerms(currentTermLocal, prevTermLocal, nextTermLocal, assessmentsAll);

            const resultScopeText = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
              ? 'Bewertung: jedes Kurshalbjahr wird getrennt berechnet.'
              : (GradingLogic.isSchoolYearResultTerm(course, currentTermLocal)
                ? 'Jahresauswertung: alle Einzelbewertungen aus H1 und H2.'
                : 'Halbjahresauswertung: nur die Einzelbewertungen aus H1.');
            termStatus.textContent = gradesheetView === 'year' && course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC
              ? 'Schuljahr: ' + (formatTermLabel(currentTermLocal && currentTermLocal.endsWith('H1') ? currentTermLocal : prevTermLocal, course.schemaMode, currentTermLocal) || 'H1') +
                ' + ' + (formatTermLabel(currentTermLocal && currentTermLocal.endsWith('H1') ? nextTermLocal : currentTermLocal, course.schemaMode, currentTermLocal) || 'H2') +
                '; reine Auswertung der vorhandenen Einzelbewertungen.'
              : `Aktuelles Halbjahr: ${formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal) || '-'}; ${resultScopeText}`;
          } catch (e) {
            termStatus.textContent = '';
          }

          if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
            const contextStrip = document.createElement('div');
            contextStrip.className = 'gradesheet-uppersec-context';
            const contextHeading = document.createElement('strong');
            contextHeading.textContent = 'Sekundarstufe II';
            contextStrip.appendChild(contextHeading);

            const upperSecContext = course.upperSecContext || {};
            const courseTypeLabels = {
              [DomainModel.UPPERSEC_COURSE_TYPES.BASIC]: 'Grundkurs',
              [DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED]: 'Leistungskurs',
              [DomainModel.UPPERSEC_COURSE_TYPES.OTHER]: 'Sonstiger Kurs'
            };
            const qualificationYearLabels = {
              [DomainModel.QUALIFICATION_YEARS.Q1_Q2]: 'Q1/Q2',
              [DomainModel.QUALIFICATION_YEARS.Q3_Q4]: 'Q3/Q4'
            };
            const courseTypeLabel = courseTypeLabels[upperSecContext.courseType];
            const qualificationYearLabel = qualificationYearLabels[upperSecContext.qualificationYear];

            if (!courseTypeLabel || !qualificationYearLabel) {
              const reviewHint = document.createElement('span');
              reviewHint.className = 'gradesheet-uppersec-context-review';
              reviewHint.textContent = 'Kursart und Qualifikationsabschnitt prüfen.';
              contextStrip.appendChild(reviewHint);
            } else {
              const courseType = document.createElement('span');
              courseType.textContent = 'Kursart: ' + courseTypeLabel;
              contextStrip.appendChild(courseType);

              const qualificationYear = document.createElement('span');
              qualificationYear.textContent = 'Qualifikationsabschnitt: ' + qualificationYearLabel;
              contextStrip.appendChild(qualificationYear);

              const gradingContext = GradingLogic.resolveUpperSecGradingContext(
                course, null, currentTermLocal, GradingLogic.getSettingsForCourse(course, state)
              );
              const displayedTerm = formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal);
              if (gradingContext.qualificationPhase && displayedTerm) {
                const currentPhase = document.createElement('span');
                currentPhase.textContent = 'Aktuelles Kurshalbjahr: ' + displayedTerm;
                contextStrip.appendChild(currentPhase);
              } else {
                const phaseReviewHint = document.createElement('span');
                phaseReviewHint.className = 'gradesheet-uppersec-context-review';
                phaseReviewHint.textContent = 'Aktuelles Kurshalbjahr konnte nicht bestimmt werden. Kurskontext prüfen.';
                contextStrip.appendChild(phaseReviewHint);
              }
              if (courseTypeLabel === 'Grundkurs' && gradingContext.qualificationPhase === 'Q4') {
                const q4Hint = document.createElement('span');
                q4Hint.className = 'gradesheet-uppersec-context-review';
                q4Hint.textContent = 'Q4-Grundkurs: Klausurentscheidung je Person.';
                contextStrip.appendChild(q4Hint);
              }
            }
            gradesheetHeading.appendChild(contextStrip);
          }

          const isSekIGradesheet = course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC;
          let annualViewActions = null;
          if (isSekIGradesheet) {
            annualViewActions = document.createElement('div');
            annualViewActions.className = 'gradesheet-view-actions gradesheet-view-tabs';
            annualViewActions.setAttribute('aria-label', 'Ansicht der Notenverwaltung');
            const entryViewButton = document.createElement('button');
            entryViewButton.type = 'button';
            entryViewButton.className = 'gradesheet-annual-view-button';
            entryViewButton.textContent = 'Noteneingabe';
            entryViewButton.setAttribute('aria-current', gradesheetView === 'year' ? 'false' : 'page');
            entryViewButton.addEventListener('click', function () {
              if (gradesheetView !== 'entry') {
                gradesheetView = 'entry';
                focusTargetHeading = true;
                render();
              }
            });
            const annualViewButton = document.createElement('button');
            annualViewButton.type = 'button';
            annualViewButton.className = 'gradesheet-annual-view-button';
            annualViewButton.textContent = 'Gesamtes Schuljahr';
            annualViewButton.setAttribute('aria-current', gradesheetView === 'year' ? 'page' : 'false');
            annualViewButton.addEventListener('click', function () {
              if (gradesheetView !== 'year') requestGradesheetAnnualView();
            });
            annualViewActions.appendChild(entryViewButton);
            annualViewActions.appendChild(annualViewButton);
          }

          const gradesheetToolbar = document.createElement('div');
          gradesheetToolbar.className = 'gradesheet-table-toolbar';
          const searchField = document.createElement('label');
          searchField.className = 'gradesheet-search-field';
          const searchLabel = document.createElement('span');
          searchLabel.textContent = 'Schüler';
          const studentSearch = document.createElement('input');
          studentSearch.type = 'search';
          studentSearch.className = 'gradesheet-student-search';
          studentSearch.placeholder = 'Name suchen …';
          studentSearch.setAttribute('aria-label', 'Schüler in Notentabelle suchen');
          searchField.appendChild(searchLabel);
          searchField.appendChild(studentSearch);
          const searchResult = document.createElement('span');
          searchResult.className = 'gradesheet-search-result';
          searchResult.setAttribute('role', 'status');
          searchResult.setAttribute('aria-live', 'polite');
          if (annualViewActions) gradesheetToolbar.appendChild(annualViewActions);
          gradesheetToolbar.appendChild(searchField);
          gradesheetToolbar.appendChild(searchResult);
          section.appendChild(gradesheetToolbar);

          let appliedStudentSearch = '';
          let studentSearchSequence = 0;
          function applyStudentSearch(query) {
            for (const item of renderedStudentRows) {
              const visible = !query || item.searchName.includes(query);
              item.row.hidden = !visible;
            }
            const totalStudents = new Set(renderedStudentRows.map(item => item.row.dataset.student)).size;
            const visibleStudents = new Set(renderedStudentRows
              .filter(item => !item.row.hidden)
              .map(item => item.row.dataset.student)).size;
            searchResult.textContent = totalStudents
              ? visibleStudents + ' von ' + totalStudents + ' Schülern'
              : '';
          }
          studentSearch.addEventListener('input', async function () {
            const requestSequence = ++studentSearchSequence;
            const requestedSearch = normalizeGradesheetSearch(studentSearch.value);
            if (!await finishGradesheetEditors()) {
              if (requestSequence === studentSearchSequence) studentSearch.value = appliedStudentSearch;
              return;
            }
            if (requestSequence !== studentSearchSequence) return;
            appliedStudentSearch = requestedSearch;
            applyStudentSearch(appliedStudentSearch);
          });

          if (isSekIGradesheet && gradesheetView === 'year') {
            const yearH2Term = currentTermLocal && currentTermLocal.endsWith('H1')
              ? computeNextTerm(currentTermLocal)
              : currentTermLocal;
            const yearH1Term = yearH2Term ? computePrevTerm(yearH2Term) : null;
            const yearTermLabels = {
              h1: formatTermLabel(yearH1Term, course.schemaMode, currentTermLocal) || 'H1',
              h2: formatTermLabel(yearH2Term, course.schemaMode, currentTermLocal) || 'H2'
            };
            const annualPanel = document.createElement('div');
            annualPanel.className = 'gradesheet-annual-panel';
            const annualToolbar = document.createElement('div');
            annualToolbar.className = 'gradesheet-annual-toolbar';
            const annualToolbarText = document.createElement('div');
            const annualTitle = document.createElement('h3');
            annualTitle.textContent = 'Gesamtes Schuljahr · ' + yearTermLabels.h1 + ' + ' + yearTermLabels.h2;
            annualToolbarText.appendChild(annualTitle);
            const annualHint = document.createElement('p');
            annualHint.className = 'section-hint gradesheet-annual-intro';
            annualHint.textContent = 'Die Jahreswerte berücksichtigen die vorhandenen Einzelbewertungen mit den für diesen Kurs konfigurierten Kategorien und Gewichten.';
            annualToolbarText.appendChild(annualHint);
            annualToolbar.appendChild(annualToolbarText);
            const annualReadonly = document.createElement('span');
            annualReadonly.className = 'gradesheet-annual-readonly';
            annualReadonly.textContent = 'Nur lesen';
            annualToolbar.appendChild(annualReadonly);
            annualPanel.appendChild(annualToolbar);

            const annualGradeKey = document.createElement('div');
            annualGradeKey.className = 'gradesheet-grade-key';
            annualGradeKey.setAttribute('aria-label', 'Notenfarben');
            const annualGradeKeyTitle = document.createElement('span');
            annualGradeKeyTitle.textContent = 'Notenfarben';
            annualGradeKey.appendChild(annualGradeKeyTitle);
            for (const grade of [1, 2, 3, 4, 5, 6]) {
              const keyItem = document.createElement('span');
              const band = resolveGradeColorBand(course.schemaMode, grade);
              keyItem.className = 'gradesheet-grade-key-item' +
                (band ? ' gradesheet-grade-color--' + band : '');
              keyItem.textContent = String(grade);
              annualGradeKey.appendChild(keyItem);
            }
            const poorKeyItem = document.createElement('span');
            poorKeyItem.className = 'gradesheet-grade-key-item gradesheet-grade-color--' +
              resolveGradeColorBand(course.schemaMode, 4, '4-');
            poorKeyItem.textContent = '4−';
            annualGradeKey.appendChild(poorKeyItem);
            const annualGradeKeyHint = document.createElement('span');
            annualGradeKeyHint.className = 'gradesheet-grade-key-hint';
            annualGradeKeyHint.textContent = '4− und schlechter: kritisch · ohne Wert: neutral';
            annualGradeKey.appendChild(annualGradeKeyHint);
            annualPanel.appendChild(annualGradeKey);
            section.appendChild(annualPanel);

            const enrollmentsForYear = DomainModel.listEnrollmentsForCourse(state, course.id) || [];
            if (enrollmentsForYear.length === 0) {
              const emptyEnrollment = document.createElement('p');
              emptyEnrollment.className = 'text-muted';
              emptyEnrollment.textContent = 'Dieser Kurs hat noch keine eingeschriebenen Schüler. Für das gesamte Schuljahr liegen deshalb keine Werte vor.';
              annualPanel.appendChild(emptyEnrollment);
              container.appendChild(section);
              return;
            }

            const categoryWeights = GradingLogic.resolveEffectiveCategoryWeights(
              course, null, yearH2Term, state.settings
            );
            const annualCategories = categoryWeights.map(weight => {
              const category = (state.settings.categories || []).find(item => item.id === weight.categoryId);
              return category ? { category, weight } : null;
            }).filter(Boolean);
            const yearAssessments = assessmentsAll.filter(assessment => {
              const term = getTermValue(assessment, null);
              return term === yearH1Term || term === yearH2Term;
            });
            if (yearAssessments.length === 0) {
              const emptyAssessments = document.createElement('p');
              emptyAssessments.className = 'text-muted';
              emptyAssessments.textContent = 'Für dieses Schuljahr sind noch keine Leistungen angelegt.';
              annualPanel.appendChild(emptyAssessments);
            }

            const annualTable = document.createElement('table');
            annualTable.className = 'gradesheet-table gradesheet-annual-table';
            const annualHead = document.createElement('thead');
            const annualGroupRow = document.createElement('tr');
            annualGroupRow.className = 'gradesheet-annual-group-row';
            const annualNameHeader = document.createElement('th');
            annualNameHeader.className = 'gradesheet-student-name';
            annualNameHeader.textContent = 'Schüler';
            annualNameHeader.rowSpan = 2;
            annualGroupRow.appendChild(annualNameHeader);
            const appendAnnualGroupHeader = function (text, columnCount, summaryClass, groupStart) {
              const header = document.createElement('th');
              header.className = 'gradesheet-annual-group-header ' + summaryClass;
              if (groupStart) header.classList.add('gradesheet-annual-group-start');
              header.colSpan = columnCount;
              header.textContent = text;
              annualGroupRow.appendChild(header);
            };
            appendAnnualGroupHeader(yearTermLabels.h1, annualCategories.length, 'gradesheet-summary-previous', false);
            appendAnnualGroupHeader(yearTermLabels.h2, annualCategories.length, 'gradesheet-summary-current', true);
            appendAnnualGroupHeader('Jahr', annualCategories.length + 1, 'gradesheet-summary-year', true);
            annualHead.appendChild(annualGroupRow);

            const annualCategoryRow = document.createElement('tr');
            annualCategoryRow.className = 'gradesheet-annual-category-row';
            const appendAnnualHeader = function (text, summaryClass, groupStart) {
              const header = document.createElement('th');
              header.className = 'gradesheet-summary-column ' + summaryClass;
              if (groupStart) header.classList.add('gradesheet-annual-group-start');
              header.textContent = text;
              annualCategoryRow.appendChild(header);
            };
            annualCategories.forEach(function (item) {
              appendAnnualHeader(item.category.name, 'gradesheet-summary-previous', false);
            });
            annualCategories.forEach(function (item, index) {
              appendAnnualHeader(item.category.name, 'gradesheet-summary-current', index === 0);
            });
            annualCategories.forEach(function (item, index) {
              appendAnnualHeader(item.category.name, 'gradesheet-summary-year', index === 0);
            });
            appendAnnualHeader('Gesamt', 'gradesheet-summary-year', false);
            annualHead.appendChild(annualCategoryRow);
            annualTable.appendChild(annualHead);

            const annualBody = document.createElement('tbody');
            const settingsForYear = GradingLogic.getSettingsForCourse(course, state);
            const countContributingAssessments = function (assessments, studentId) {
              return assessments.reduce(function (count, assessment) {
                const assessmentWeight = Number(assessment.weight);
                if (!Number.isFinite(assessmentWeight) || assessmentWeight <= 0) return count;
                const entry = assessment.scores ? assessment.scores[studentId] : null;
                const numeric = GradingLogic.getNumericScoreForEntry(entry, course, settingsForYear);
                return count + (numeric !== null && Number.isFinite(numeric) ? 1 : 0);
              }, 0);
            };
            const formatAnnualCount = function (count, singular, plural) {
              return count + ' ' + (count === 1 ? singular : plural);
            };
            const appendAnnualValue = function (row, value, summaryClass, groupStart, detail) {
              const cell = document.createElement('td');
              cell.className = 'gradesheet-avg gradesheet-summary-column ' + summaryClass;
              if (groupStart) cell.classList.add('gradesheet-annual-group-start');
              if (value === null || !Number.isFinite(value)) {
                cell.textContent = '–';
                cell.classList.add('text-muted');
              } else {
                const valueElement = document.createElement('span');
                valueElement.className = 'gradesheet-annual-value';
                valueElement.textContent = String(formatLegacyFixed(value, 2)).replace('.', ',');
                const band = resolveGradeColorBand(course.schemaMode, value);
                if (band) valueElement.classList.add('gradesheet-grade-color--' + band);
                cell.appendChild(valueElement);
              }
              if (detail) {
                const detailElement = document.createElement('small');
                detailElement.className = 'gradesheet-annual-detail';
                detailElement.textContent = detail;
                cell.appendChild(detailElement);
              }
              row.appendChild(cell);
            };
            for (const enrollment of enrollmentsForYear) {
              const student = DomainModel.findStudentById(state, enrollment.studentId);
              if (!student) continue;
              const annualRow = document.createElement('tr');
              annualRow.dataset.student = student.id;
              annualRow.dataset.term = 'year';
              trackGradesheetStudentRow(annualRow, student);
              const nameCell = document.createElement('td');
              nameCell.className = 'gradesheet-student-name';
              nameCell.textContent = student.lastName + ', ' + student.firstName;
              annualRow.appendChild(nameCell);
              const h1Values = annualCategories.map(function (item) {
                const h1Assessments = yearAssessments.filter(assessment =>
                  assessment.categoryId === item.category.id && getTermValue(assessment, null) === yearH1Term
                );
                return {
                  value: GradingLogic.computeCategoryAverage(
                    h1Assessments, course, student.id, item.category.id, state.settings
                  ),
                  count: countContributingAssessments(h1Assessments, student.id)
                };
              });
              const h2Values = annualCategories.map(function (item) {
                const h2Assessments = yearAssessments.filter(assessment =>
                  assessment.categoryId === item.category.id && getTermValue(assessment, null) === yearH2Term
                );
                return {
                  value: GradingLogic.computeCategoryAverage(
                    h2Assessments, course, student.id, item.category.id, state.settings
                  ),
                  count: countContributingAssessments(h2Assessments, student.id)
                };
              });
              const yearValues = annualCategories.map(function (item) {
                const categoryAssessments = yearAssessments.filter(assessment => assessment.categoryId === item.category.id);
                return {
                  value: GradingLogic.computeCategoryAverage(
                    categoryAssessments, course, student.id, item.category.id, state.settings
                  ),
                  count: countContributingAssessments(categoryAssessments, student.id)
                };
              });
              h1Values.forEach(function (result) {
                appendAnnualValue(annualRow, result.value, 'gradesheet-summary-previous', false,
                  formatAnnualCount(result.count, 'berücksichtigte Leistung', 'berücksichtigte Leistungen'));
              });
              h2Values.forEach(function (result, index) {
                appendAnnualValue(annualRow, result.value, 'gradesheet-summary-current', index === 0,
                  formatAnnualCount(result.count, 'berücksichtigte Leistung', 'berücksichtigte Leistungen'));
              });
              yearValues.forEach(function (result, index) {
                appendAnnualValue(annualRow, result.value, 'gradesheet-summary-year', index === 0,
                  formatAnnualCount(result.count, 'berücksichtigte Leistung', 'berücksichtigte Leistungen'));
              });
              const weightedCategoryCount = yearValues.filter(function (result, index) {
                const configuredWeight = Number(annualCategories[index].weight.weightPercent);
                return result.value !== null && Number.isFinite(result.value) &&
                  Number.isFinite(configuredWeight) && configuredWeight > 0;
              }).length;
              appendAnnualValue(annualRow, GradingLogic.computeWeightedOverallForAssessments(
                yearAssessments, course, student.id, state.settings, yearH2Term
              ), 'gradesheet-summary-year', false,
              formatAnnualCount(weightedCategoryCount, 'Kategorie gewichtet', 'Kategorien gewichtet'));
              annualBody.appendChild(annualRow);
            }
            annualTable.appendChild(annualBody);
            applyStudentSearch(appliedStudentSearch);
            const annualTableWrapper = document.createElement('div');
            annualTableWrapper.className = 'gradesheet-table-wrapper gradesheet-annual-table-wrapper';
            annualTableWrapper.appendChild(annualTable);
            annualPanel.appendChild(annualTableWrapper);

            const annualNote = document.createElement('div');
            annualNote.className = 'gradesheet-annual-note';
            const countNote = document.createElement('span');
            countNote.textContent = 'Berücksichtigte Einzelbewertungen haben ein positives Gewicht und werden je Kategorie und Zeitraum gezählt.';
            annualNote.appendChild(countNote);
            const weightNote = document.createElement('span');
            const totalWeight = annualCategories.reduce(function (sum, item) {
              return sum + (Number(item.weight.weightPercent) || 0);
            }, 0);
            weightNote.textContent = 'Gewichtung: ' + annualCategories.map(function (item) {
              const percentage = totalWeight > 0
                ? (Number(item.weight.weightPercent) || 0) / totalWeight * 100
                : 0;
              const display = Number.isInteger(percentage)
                ? String(percentage)
                : String(formatLegacyFixed(percentage, 1)).replace('.', ',');
              return item.category.name + ' ' + display + ' %';
            }).join(' · ');
            annualNote.appendChild(weightNote);
            annualPanel.appendChild(annualNote);
            container.appendChild(section);
            return;
          }

          const enrollments = DomainModel.listEnrollmentsForCourse(state, course.id);

          // Frühere Leistungen bleiben für Auswertungen gespeichert, sind hier aber nicht bearbeitbar.
          const managedAssessments = assessmentsAll.filter(assessment => isAssessmentInManagementScope(assessment));
          const assessmentManagement = document.createElement('details');
          assessmentManagement.className = 'gradesheet-assessment-management';
          assessmentManagement.open = managedAssessments.length === 0;
          const assessmentManagementSummary = document.createElement('summary');
          assessmentManagementSummary.textContent = 'Leistungen verwalten';
          assessmentManagement.appendChild(assessmentManagementSummary);

          // Panel: Neue Leistung anlegen
          const newAsmBox = document.createElement("details");
          newAsmBox.id = 'gradesheet-new-assessment';
          newAsmBox.className = "info-box gradesheet-disclosure gradesheet-create";
          newAsmBox.open = managedAssessments.length === 0;

          const newAsmSummary = document.createElement("summary");
          newAsmSummary.textContent = "Neue Leistung anlegen";
          newAsmBox.appendChild(newAsmSummary);

          const formRow = document.createElement("form");
          formRow.className = 'gradesheet-create-grid';

          const catSelect = document.createElement("select");
          catSelect.id = 'gradesheet-new-category';

          const placeholderOpt = document.createElement("option");
          placeholderOpt.value = "";
          placeholderOpt.textContent = "Kategorie wählen...";
          catSelect.appendChild(placeholderOpt);

          const activeCats = (state.settings.categories || []).filter(c => c.active);
          for (const c of activeCats) {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.name;
            catSelect.appendChild(opt);
          }

          // Unterkategorie-Dropdown (wird dynamisch angezeigt)
          const subcatSelect = document.createElement("select");
          subcatSelect.id = 'gradesheet-new-subcategory';

          const subcategoryField = document.createElement('div');
          subcategoryField.className = 'gradesheet-create-field';
          subcategoryField.style.display = 'none';
          const subcategoryLabel = document.createElement('label');
          subcategoryLabel.htmlFor = subcatSelect.id;
          subcategoryLabel.textContent = 'Unterkategorie';
          subcategoryField.appendChild(subcategoryLabel);
          subcategoryField.appendChild(subcatSelect);

          const subcatPlaceholder = document.createElement("option");
          subcatPlaceholder.value = "";
          subcatPlaceholder.textContent = "Unterkategorie wählen...";
          subcatSelect.appendChild(subcatPlaceholder);

          // Event listener um Unterkategorie-Dropdown zu aktualisieren
          catSelect.addEventListener("change", function() {
            while (subcatSelect.children.length > 1) {
              subcatSelect.removeChild(subcatSelect.lastChild);
            }

            const selectedCatId = this.value;
            if (!selectedCatId) {
              subcategoryField.style.display = "none";
              return;
            }

            const selectedCat = state.settings.categories.find(c => c.id === selectedCatId);
            if (selectedCat && selectedCat.subcategories && selectedCat.subcategories.length > 0) {
              subcategoryField.style.display = "";
              for (const subcat of selectedCat.subcategories) {
                const opt = document.createElement("option");
                opt.value = subcat.id;
                opt.textContent = subcat.name;
                subcatSelect.appendChild(opt);
              }
              // Erste Unterkategorie automatisch auswählen
              if (selectedCat.subcategories.length > 0) {
                subcatSelect.value = selectedCat.subcategories[0].id;
              }
            } else {
              subcategoryField.style.display = "none";
              subcatSelect.value = "";
            }
          });

          const titleInput = document.createElement("input");
          titleInput.type = "text";
          titleInput.id = 'gradesheet-new-title';
          titleInput.placeholder = "Bezeichnung (z. B. M1, Test 1)";

          const dateInput = document.createElement("input");
          dateInput.type = "date";
          dateInput.id = 'gradesheet-new-date';

          // Halbjahr-Auswahl (H1 / H2)
          const termSelect = document.createElement('select');
          termSelect.id = 'gradesheet-new-term';

          function appendAutomaticTermOption() {
            const automaticOption = document.createElement('option');
            automaticOption.value = 'auto';
            automaticOption.textContent = 'Automatisch nach Datum';
            termSelect.appendChild(automaticOption);
          }

          const termOpts = (allowedTerms && allowedTerms.length ? allowedTerms.slice() : []);
          if (termOpts.length === 0) {
            const fallbackTerm = deriveTermFromDateValue(new Date(), course);
            if (fallbackTerm) termOpts.push(fallbackTerm);
          }

          function updateTermOptions() {
            const selectedTerm = termSelect.value || 'auto';
            // Der berechnete Term bleibt zusätzlich als bewusst manuelle Auswahl verfügbar.
            if (dateInput.value) {
              const calculatedDate = parseHalfYearDateValue(dateInput.value);
              const calculatedTerm = calculatedDate ? deriveTermFromDateValue(calculatedDate, course) : null;
              if (calculatedTerm) {
                // Füge den berechneten Term zu den Optionen hinzu, falls nicht vorhanden
                if (!termOpts.includes(calculatedTerm)) {
                  termOpts.push(calculatedTerm);
                  termOpts.sort((a, b) => {
                    const aNum = parseInt(a.split('-')[0]) * 10 + (a.endsWith('H1') ? 1 : 2);
                    const bNum = parseInt(b.split('-')[0]) * 10 + (b.endsWith('H1') ? 1 : 2);
                    return aNum - bNum;
                  });
                }
              }
            }
            // Aktualisiere die Dropdown-Optionen
            while (termSelect.children.length > 0) {
              termSelect.removeChild(termSelect.firstChild);
            }
            appendAutomaticTermOption();
            for (const t of termOpts) {
              const opt = document.createElement('option');
              const label = formatTermLabel(t, course.schemaMode, currentTermLocal) + (t===currentTermLocal? ' (aktuell)' : (t===prevTermLocal? ' (vorher)' : (t===nextTermLocal ? ' (nächstes)' : '')));
              opt.value = t; opt.textContent = label; termSelect.appendChild(opt);
            }
            if (selectedTerm === 'auto' || termOpts.includes(selectedTerm)) {
              termSelect.value = selectedTerm;
            }
            if (termSelect.value === '') termSelect.value = 'auto';
          }

          // Initial populieren
          appendAutomaticTermOption();
          for (const t of termOpts) {
            const opt = document.createElement('option');
            const label = formatTermLabel(t, course.schemaMode, currentTermLocal) + (t===currentTermLocal? ' (aktuell)' : (t===prevTermLocal? ' (vorher)' : (t===nextTermLocal ? ' (nächstes)' : '')));
            opt.value = t; opt.textContent = label; termSelect.appendChild(opt);
          }
          termSelect.value = 'auto';

          // Aktualisiere Term-Optionen, wenn sich das Datum ändert
          dateInput.addEventListener('change', updateTermOptions);

          const weightInput = document.createElement("input");
          weightInput.type = "number";
          weightInput.id = 'gradesheet-new-weight';
          weightInput.step = "0.1";
          weightInput.min = "0";
          weightInput.value = "1";

          // Sichtbarkeit-Checkbox
          const visibleCheckbox = document.createElement("input");
          visibleCheckbox.type = "checkbox";
          visibleCheckbox.checked = true;
          visibleCheckbox.id = "visible-checkbox-new";

          const visibleLabel = document.createElement("label");
          visibleLabel.htmlFor = "visible-checkbox-new";
          visibleLabel.textContent = "In PDF-Berichten anzeigen";
          visibleLabel.style.fontSize = "0.9rem";
          visibleLabel.style.display = "flex";
          visibleLabel.style.alignItems = "center";
          visibleLabel.style.gap = "0.3rem";
          visibleLabel.style.cursor = "pointer";

          const visibleWrapper = document.createElement("div");
          visibleWrapper.style.display = "flex";
          visibleWrapper.style.alignItems = "center";
          visibleWrapper.style.gap = "0.3rem";
          visibleWrapper.appendChild(visibleCheckbox);
          visibleWrapper.appendChild(visibleLabel);



          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.textContent = "Leistung hinzufügen";
          const addStatus = document.createElement('div');
          addStatus.setAttribute('role', 'alert');
          addStatus.className = 'text-muted';

          addBtn.addEventListener("click", async function () {
            if (addBtn.disabled) return;
            const catId = catSelect.value;
            const subcatId = subcatSelect.value || null;
            const label = titleInput.value.trim();
            const weightVal = parseFloat(weightInput.value.replace(",", "."));

            // Ausgewähltes Halbjahr bestimmen
            const selTerm = termSelect.value;
            const automaticAssignment = selTerm === 'auto';

            if (!catId) {
              window.alert("Bitte eine Kategorie auswählen.");
              return;
            }

            // Prüfe ob Unterkategorie erforderlich ist
            const selectedCat = state.settings.categories.find(c => c.id === catId);
            if (selectedCat && selectedCat.subcategories && selectedCat.subcategories.length > 0) {
              if (!subcatId) {
                window.alert("Bitte eine Unterkategorie auswählen.");
                return;
              }
            }

            if (!label) {
              window.alert("Bitte eine Bezeichnung für die Leistung eingeben.");
              return;
            }

            if (!Number.isFinite(weightVal) || weightVal < 0) {
              window.alert("Das Gewicht muss eine Zahl größer oder gleich 0 sein.");
              return;
            }

            if (!selTerm) {
              window.alert('Bitte ein Halbjahr auswählen.');
              return;
            }
            if (!automaticAssignment && termOpts.indexOf(selTerm) === -1) {
              window.alert('Bitte eine gültige Halbjahresauswahl verwenden.');
              return;
            }
            const assignmentDate = dateInput.value ? parseHalfYearDateValue(dateInput.value) : new Date();
            const resolvedTerm = automaticAssignment
              ? deriveTermFromDateValue(assignmentDate, course)
              : selTerm;
            if (!resolvedTerm) {
              window.alert('Das Halbjahr konnte nicht automatisch bestimmt werden.');
              return;
            }

            const courseId = course.id;
            const input = {
              categoryId: catId,
              subcategoryId: subcatId,
              title: label,
              date: dateInput.value || null,
              selectedTerm: selTerm,
              automaticAssignment: automaticAssignment,
              weight: weightVal,
              visible: visibleCheckbox.checked
            };
            addBtn.disabled = true;
            addStatus.textContent = '';
            try {
              await commitStateChange(function (candidate) {
                const candidateCourse = requireActiveCourse(candidate, courseId);
                const candidateCategory = (candidate.settings.categories || []).find(function (item) {
                  return item.id === input.categoryId && item.active;
                });
                if (!candidateCategory) throw new Error('Die ausgewählte Kategorie ist nicht mehr verfügbar.');
                if (candidateCategory.subcategories && candidateCategory.subcategories.length > 0 &&
                    !candidateCategory.subcategories.some(function (item) { return item.id === input.subcategoryId; })) {
                  throw new Error('Die ausgewählte Unterkategorie ist nicht mehr verfügbar.');
                }
                const candidateDate = input.date ? parseHalfYearDateValue(input.date) : new Date();
                const candidateTerm = input.automaticAssignment
                  ? GradingLogic.resolveAssessmentTermFromDateValue(candidateDate, candidateCourse, candidate.settings)
                  : input.selectedTerm;
                if (!candidateTerm) throw new Error('Das Halbjahr konnte nicht bestimmt werden.');
                const created = DomainModel.createAssessment({
                  courseId: candidateCourse.id,
                  categoryId: input.categoryId,
                  subcategoryId: input.subcategoryId,
                  title: input.title,
                  date: input.date,
                  term: candidateTerm,
                  termAssignment: input.automaticAssignment ? 'auto' : 'manual',
                  maxPoints: null,
                  weight: input.weight,
                  visible: input.visible
                });
                DomainModel.addAssessmentToState(candidate, created);
              }, { render: false });
              titleInput.value = "";
              weightInput.value = "1";
              visibleCheckbox.checked = true;
              catSelect.value = "";
              subcatSelect.value = "";
              subcategoryField.style.display = "none";
              if (dateInput.value) updateTermOptions();
              render();
            } catch (error) {
              addStatus.textContent = 'Die Leistung wurde nicht gespeichert. Bitte prüfen und erneut versuchen. ' + error.message;
            } finally {
              addBtn.disabled = false;
            }
          });

          const categoryField = document.createElement('div');
          categoryField.className = 'gradesheet-create-field';
          const categoryLabel = document.createElement('label');
          categoryLabel.htmlFor = catSelect.id;
          categoryLabel.textContent = 'Kategorie';
          categoryField.appendChild(categoryLabel);
          categoryField.appendChild(catSelect);

          const titleField = document.createElement('div');
          titleField.className = 'gradesheet-create-field gradesheet-create-title';
          const assessmentTitleLabel = document.createElement('label');
          assessmentTitleLabel.htmlFor = titleInput.id;
          assessmentTitleLabel.textContent = 'Bezeichnung';
          titleField.appendChild(assessmentTitleLabel);
          titleField.appendChild(titleInput);

          const dateField = document.createElement('div');
          dateField.className = 'gradesheet-create-field';
          const assessmentDateLabel = document.createElement('label');
          assessmentDateLabel.htmlFor = dateInput.id;
          assessmentDateLabel.textContent = 'Datum';
          dateField.appendChild(assessmentDateLabel);
          dateField.appendChild(dateInput);

          const termField = document.createElement('div');
          termField.className = 'gradesheet-create-field';
          const assessmentTermLabel = document.createElement('label');
          assessmentTermLabel.htmlFor = termSelect.id;
          assessmentTermLabel.textContent = 'Halbjahr';
          termField.appendChild(assessmentTermLabel);
          termField.appendChild(termSelect);

          const weightField = document.createElement('div');
          weightField.className = 'gradesheet-create-field gradesheet-create-weight';
          const weightLabel = document.createElement('label');
          weightLabel.htmlFor = weightInput.id;
          weightLabel.textContent = 'Gewicht';
          weightField.appendChild(weightLabel);
          weightField.appendChild(weightInput);

          formRow.appendChild(categoryField);
          formRow.appendChild(subcategoryField);
          formRow.appendChild(titleField);
          formRow.appendChild(dateField);
          formRow.appendChild(termField);
          formRow.appendChild(weightField);
          formRow.appendChild(visibleWrapper);

          formRow.appendChild(addBtn);
          formRow.appendChild(addStatus);

          newAsmBox.appendChild(formRow);
          assessmentManagement.appendChild(newAsmBox);

          if (directAssessmentCreateButton) {
            directAssessmentCreateButton.addEventListener('click', async function () {
              if (!await finishGradesheetEditors()) return;
              const activeCourse = currentCourseId
                ? DomainModel.findCourseById(state, currentCourseId)
                : null;
              if (!activeCourse || activeCourse.id !== course.id || activeCourse.archivedAt) return;
              assessmentManagement.open = true;
              newAsmBox.open = true;
              catSelect.focus();
            });
          }

          if (managedAssessments.length > 0) {
            const assessmentList = document.createElement('div');
            assessmentList.className = 'gradesheet-assessment-list';
            const assessmentListTitle = document.createElement('h3');
            assessmentListTitle.textContent = 'Leistungen im aktuellen und nächsten Halbjahr';
            assessmentList.appendChild(assessmentListTitle);
            for (const assessment of managedAssessments) {
              const assessmentRow = document.createElement('div');
              assessmentRow.className = 'gradesheet-assessment-list-row';
              const assessmentDescription = document.createElement('div');
              assessmentDescription.className = 'gradesheet-assessment-list-description';
              const assessmentName = document.createElement('strong');
              assessmentName.textContent = assessment.title || 'L';
              const assessmentMeta = document.createElement('span');
              const assessmentCategory = (state.settings.categories || [])
                .find(category => category.id === assessment.categoryId);
              assessmentMeta.textContent = [
                assessmentCategory && assessmentCategory.name,
                assessment.date,
                formatTermLabel(getTermValue(assessment, null), course.schemaMode, currentTermLocal)
              ].filter(Boolean).join(' · ');
              assessmentDescription.appendChild(assessmentName);
              if (assessmentMeta.textContent) assessmentDescription.appendChild(assessmentMeta);
              assessmentRow.appendChild(assessmentDescription);
              appendAssessmentActionControls(assessmentRow, assessment);
              assessmentList.appendChild(assessmentRow);
            }
            assessmentManagement.appendChild(assessmentList);
          }
          gradesheetHeader.appendChild(assessmentManagement);

          if (!enrollments || enrollments.length === 0) {
            const p = document.createElement("p");
            p.className = "text-muted";
            p.textContent =
              "Dieser Kurs hat noch keine eingeschriebenen Schüler. Die Leistungsverwaltung bleibt verfügbar; Noten können nach der Einschreibung eingegeben werden.";
            section.appendChild(p);
            container.appendChild(section);
            return;
          }

          if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
            const resultGuide = document.createElement('div');
            resultGuide.id = 'gradesheet-term-result-help';
            resultGuide.className = 'gradesheet-result-guide';

            const calculatedGuide = document.createElement('div');
            const calculatedLabel = document.createElement('strong');
            calculatedLabel.textContent = 'Rechenwert';
            calculatedGuide.appendChild(calculatedLabel);
            calculatedGuide.appendChild(document.createTextNode(
              ' wird automatisch aus den eingetragenen Leistungen berechnet.'
            ));

            const finalizedGuide = document.createElement('div');
            const finalizedLabel = document.createElement('strong');
            finalizedLabel.textContent = 'Festgesetzt';
            finalizedGuide.appendChild(finalizedLabel);
            finalizedGuide.appendChild(document.createTextNode(
              ' ist die von der Lehrkraft eingetragene ganze Punktzahl von 0 bis 15. ' +
              'Ein leeres Feld bedeutet „noch nicht festgesetzt“; 0 ist gültig.'
            ));

            resultGuide.appendChild(calculatedGuide);
            resultGuide.appendChild(finalizedGuide);
            section.appendChild(resultGuide);
          }

          function listSortedGradesheetStudents() {
            return enrollments
              .map(enrollment => {
                const student = DomainModel.findStudentById(state, enrollment.studentId);
                return student ? { enrollment, student } : null;
              })
              .filter(Boolean)
              .sort((a, b) => {
                const lastNameA = (a.student.lastName || "").toLocaleLowerCase("de");
                const lastNameB = (b.student.lastName || "").toLocaleLowerCase("de");
                if (lastNameA < lastNameB) return -1;
                if (lastNameA > lastNameB) return 1;
                const firstNameA = (a.student.firstName || "").toLocaleLowerCase("de");
                const firstNameB = (b.student.firstName || "").toLocaleLowerCase("de");
                if (firstNameA < firstNameB) return -1;
                if (firstNameA > firstNameB) return 1;
                return 0;
              });
          }

          // Jetzt aktuelle Leistungen für diesen Kurs holen
          if (!assessmentsAll || assessmentsAll.length === 0) {
            const p = document.createElement("p");
            p.className = "text-muted";
            const isUpperSecResultOnly = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC;
            p.textContent = isUpperSecResultOnly
              ? "Für diesen Kurs wurden noch keine Leistungen angelegt. Festgesetzte Punktzahlen können weiterhin halbjahresbezogen bearbeitet werden."
              : "Für diesen Kurs wurden noch keine Leistungen angelegt. Lege oben eine neue Leistung an, um mit der Noteneingabe zu beginnen.";
            section.appendChild(p);
            if (isUpperSecResultOnly) {
              const enrolledStudentIds = new Set(enrollments.map(enrollment => enrollment.studentId));
              const resultOnlyTerms = new Set(currentTermLocal ? [currentTermLocal] : []);
              for (const result of course.termResults || []) {
                if (enrolledStudentIds.has(result.studentId) && /^\d{4}-H[12]$/.test(String(result.term || ""))) {
                  resultOnlyTerms.add(result.term);
                }
              }
              const resultOnlyStudents = listSortedGradesheetStudents();
              for (const term of Array.from(resultOnlyTerms).sort()) {
                section.appendChild(renderTermSection(
                  formatTermLabel(term, course.schemaMode, currentTermLocal) || term,
                  [],
                  term !== currentTermLocal,
                  term,
                  resultOnlyStudents
                ));
              }
            }
            if (!isUpperSecResultOnly) {
              const roster = document.createElement('section');
              roster.className = 'empty-course-roster';
              roster.setAttribute('data-role', 'empty-course-roster');
              const heading = document.createElement('h3');
              const students = listSortedGradesheetStudents();
              heading.textContent = 'Zugeordnete Schüler:innen (' + students.length + ')';
              roster.appendChild(heading);
              const list = document.createElement('ul');
              for (const { student } of students) {
                const item = document.createElement('li');
                item.textContent = [student.lastName, student.firstName].filter(Boolean).join(', ');
                item.dataset.student = student.id;
                trackGradesheetStudentRow(item, student);
                list.appendChild(item);
              }
              roster.appendChild(list);
              section.appendChild(roster);
              applyStudentSearch(appliedStudentSearch);
            }
            section.appendChild(tableHelp);
            container.appendChild(section);
            return;
          }

          // Schülerliste vorbereiten (sortiert)
          const studentRows = listSortedGradesheetStudents();

          // Leistungen nach Kategorie gruppieren
          const catById = new Map();
          for (const c of state.settings.categories || []) {
            catById.set(c.id, c);
          }

          const groupMap = new Map(); // categoryId -> { category, leistungen: [] }
          for (const asm of assessmentsAll) {
            const cat = catById.get(asm.categoryId);
            if (!cat) continue;
            let group = groupMap.get(cat.id);
            if (!group) {
              group = { category: cat, assessments: [] };
              groupMap.set(cat.id, group);
            }
            group.assessments.push(asm);
          }

          const groups = Array.from(groupMap.values());
          groups.sort((a, b) =>
            compareText(a.category.name, b.category.name)
          );
          for (const g of groups) {
            g.assessments.sort((a, b) =>
              compareText(a.title, b.title)
            );
          }

          const entryGradeKey = document.createElement('div');
          entryGradeKey.className = 'gradesheet-grade-key gradesheet-entry-grade-key';
          entryGradeKey.setAttribute('aria-label', 'Bewertungsfarben');
          const entryGradeKeyTitle = document.createElement('strong');
          entryGradeKeyTitle.textContent = 'Bewertungsfarben';
          entryGradeKey.appendChild(entryGradeKeyTitle);
          for (const item of [
            ['best', 'sehr gut'],
            ['good', 'gut'],
            ['middle', 'mittel'],
            ['notice', 'ausreichend'],
            ['critical', 'kritisch']
          ]) {
            const keyItem = document.createElement('span');
            keyItem.className = 'gradesheet-grade-key-item gradesheet-grade-color--' + item[0];
            keyItem.textContent = item[1];
            entryGradeKey.appendChild(keyItem);
          }
          const entryGradeKeyHint = document.createElement('span');
          entryGradeKeyHint.className = 'gradesheet-grade-key-hint';
          entryGradeKeyHint.textContent = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
            ? '4 Punkte und weniger: kritisch · ohne Wert: neutral'
            : '4− und schlechter: kritisch · ohne Wert: neutral';
          entryGradeKey.appendChild(entryGradeKeyHint);
          tableHelpContent.appendChild(entryGradeKey);

          const legend = document.createElement("div");
          legend.className = "gradesheet-legend";
          const legStrong = document.createElement('strong');
          legStrong.textContent = 'Status';
          legend.appendChild(legStrong);
          const iconLegend = document.createElement('div');
          iconLegend.className = 'gradesheet-status-legend';

          function makeLegendIcon(svgHtml, title, colorClass) {
            const wrap = document.createElement('span');
            wrap.className = 'gradesheet-status-icon ' + colorClass;
            wrap.title = title;
            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon';
            iconSpan.innerHTML = svgHtml;
            wrap.appendChild(iconSpan);
            const labelSpan = document.createElement('span');
            labelSpan.className = 'gradesheet-status-label';
            labelSpan.textContent = title;
            wrap.appendChild(labelSpan);
            return wrap;
          }

          const svgValid = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 9l3 3 9-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          const svgMissing = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
          const svgExcused = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 2v11h1l4-1.5L12 13V3l-4 1.5L4 2H3z" fill="currentColor"/></svg>';

          iconLegend.appendChild(makeLegendIcon(svgValid, 'gültig', 'status-valid'));
          iconLegend.appendChild(makeLegendIcon(svgMissing, 'fehlt', 'status-missing'));
          iconLegend.appendChild(makeLegendIcon(svgExcused, 'entschuldigt', 'status-excused'));

          legend.appendChild(iconLegend);
          const avgHint = document.createElement('div');
          avgHint.className = 'text-muted gradesheet-scope-hint';
          avgHint.textContent = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
            ? 'Jedes Kurshalbjahr wird getrennt ausgewertet.'
            : (GradingLogic.isSchoolYearResultTerm(course, currentTermLocal)
              ? 'Ø aktuell zeigt H2, Ø vorher H1. Die Jahresgesamtnote berücksichtigt die Einzelbewertungen aus H1 und H2 und ist kein einfacher Mittelwert der beiden Halbjahreswerte.'
              : 'Die Durchschnittswerte beziehen sich nur auf H1. H2 wird erst nach dem Halbjahreswechsel einbezogen.');
          legend.appendChild(avgHint);
          if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
            const pointGuide = document.createElement('details');
            pointGuide.className = 'gradesheet-point-guide';
            const pointGuideSummary = document.createElement('summary');
            pointGuideSummary.textContent = 'Punkte-Noten-Orientierung anzeigen';
            const pointGuideText = document.createElement('p');
            pointGuideText.textContent = '15/14/13 = 1+/1/1-, 12/11/10 = 2+/2/2-, 9/8/7 = 3+/3/3-, 6/5/4 = 4+/4/4-, 3/2/1 = 5+/5/5-, 0 = 6.';
            pointGuide.appendChild(pointGuideSummary);
            pointGuide.appendChild(pointGuideText);
            legend.appendChild(pointGuide);
          }
          tableHelpContent.appendChild(legend);

          const table = document.createElement("table");
          table.className = "gradesheet-table";

          function appendAssessmentActionControls(headerCell, assessment) {
            const displayTitle = assessment.title || "L";
            const actions = document.createElement("div");
            actions.className = "gradesheet-assessment-actions";

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "gradesheet-assessment-action";
            editBtn.textContent = "Bearbeiten";
            editBtn.title = "Leistung bearbeiten";
            editBtn.setAttribute("aria-label", `Leistung „${displayTitle}“ bearbeiten`);
            editBtn.addEventListener("click", function (ev) {
              ev.stopPropagation();
              editAssessment(assessment);
            });
            actions.appendChild(editBtn);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "gradesheet-assessment-action danger";
            delBtn.textContent = "Löschen";
            delBtn.title = "Leistung löschen";
            delBtn.setAttribute("aria-label", `Leistung „${displayTitle}“ löschen`);
            delBtn.addEventListener("click", async function (ev) {
              ev.stopPropagation();
              await deleteAssessment(assessment.id);
            });
            actions.appendChild(delBtn);

            headerCell.appendChild(actions);
          }

          // Hilfsfunktion: rendert eine Gradesheet-Tabelle nur für ein bestimmtes Halbjahr
          function renderTermSection(termLabel, assessmentsForTerm, isPrev, termKeyRaw, rowsForTerm = studentRows, persistCollapse = true) {
            const termSection = document.createElement('div');
            termSection.className = 'term-section ' + (isPrev
              ? 'prev-term term-section-archive'
              : 'term-section-current');
            const isUpperSecGradesheet = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC;

            const header = document.createElement('div');
            // Gleicher Ein-/Ausklapp-Mechanismus wie in Einstellungen/Statistiken
            const collapsedFlag = persistCollapse
              ? (isPrev ? !!course._prevCollapsed : !!course._currCollapsed)
              : false;
            const isOpen = !collapsedFlag;
            header.className = 'collapsible-header' + (isOpen ? '' : ' collapsed');
            header.style.padding = '0.25rem 0.35rem';
            header.style.border = '1px solid var(--border-soft)';
            header.style.borderRadius = '6px';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '0.5rem';

            const title = document.createElement('strong');
            title.textContent = isPrev ? `Archiv: ${termLabel}` : `Halbjahr: ${termLabel}`;
            header.appendChild(title);

            const content = document.createElement('div');
            content.className = 'collapsible-content' + (isOpen ? '' : ' hidden');
            content.style.marginTop = '0.5rem';
            content.style.overflowX = 'auto';
            content.style.maxWidth = '100%';

            // Klick auf Header toggelt die Sichtbarkeit für aktuelle und Vorjahr-Sektion
            header.addEventListener('click', async function () {
              const nowHidden = content.classList.toggle('hidden');
              header.classList.toggle('collapsed');
              if (persistCollapse) {
                const courseId = course.id;
                const key = isPrev ? '_prevCollapsed' : '_currCollapsed';
                try {
                  await commitStateChange(function (candidate) {
                    requireActiveCourse(candidate, courseId)[key] = !!nowHidden;
                  }, { render: false });
                } catch (error) {
                  const confirmed = DomainModel.findCourseById(state, courseId);
                  const hidden = confirmed ? !!confirmed[key] : !nowHidden;
                  content.classList.toggle('hidden', hidden);
                  header.classList.toggle('collapsed', hidden);
                  if (!isStateCommitAborted(error)) console.error('Der Ansichtsstatus konnte nicht gespeichert werden:', error);
                }
              }
            });

            termSection.appendChild(header);
            termSection.appendChild(content);

            // Gruppen nach Kategorie (nur Leistungen für dieses Halbjahr)
            const catById2 = new Map();
            for (const c of state.settings.categories || []) catById2.set(c.id, c);
            const groupMap2 = new Map();
            for (const a of assessmentsForTerm) {
              const cat = catById2.get(a.categoryId);
              if (!cat) continue;
              let g = groupMap2.get(cat.id);
              if (!g) { g = { category: cat, assessments: [] }; groupMap2.set(cat.id, g); }
              g.assessments.push(a);
            }
            const groupsTerm = Array.from(groupMap2.values());
            groupsTerm.sort((a,b)=>compareText(a.category.name, b.category.name));

            const table2 = document.createElement('table');
            table2.className = 'gradesheet-table term-' + (isPrev ? 'prev' : 'curr');

            const thead2 = document.createElement('thead');

            const r1 = document.createElement('tr');
            const thn = document.createElement('th'); thn.rowSpan = 2; thn.className = 'gradesheet-student-name'; thn.textContent = 'Schüler'; r1.appendChild(thn);
            for (const g of groupsTerm) { const th = document.createElement('th'); th.colSpan = g.assessments.length; th.textContent = g.category.name; r1.appendChild(th); }
            const thAvg = document.createElement('th');
            thAvg.colSpan = groupsTerm.length + 1 + (isUpperSecGradesheet ? 1 : 0);
            thAvg.textContent = 'Durchschnitte';
            r1.appendChild(thAvg);
            thead2.appendChild(r1);

            const r2 = document.createElement('tr');
            for (const g of groupsTerm) {
              for (const asm of g.assessments) {
                const th = document.createElement('th');
                th.className = 'gradesheet-assessment-header';
                const sp = document.createElement('span');
                sp.className = 'gradesheet-assessment-title';
                sp.textContent = asm.title || 'L';
                th.appendChild(sp);
                if (asm.date) {
                  const metadata = document.createElement('div');
                  metadata.className = 'gradesheet-assessment-meta';
                  const ds = document.createElement('span');
                  ds.className = 'gradesheet-assessment-meta-item';
                  ds.textContent = asm.date;
                  metadata.appendChild(ds);
                  th.appendChild(metadata);
                }
                r2.appendChild(th);
              }
            }
            for (const g of groupsTerm) { const th = document.createElement('th'); th.className = 'gradesheet-summary-column'; th.textContent = 'Ø ' + g.category.name; r2.appendChild(th); }
            const thTot = document.createElement('th');
            thTot.className = 'gradesheet-summary-column';
            thTot.textContent = isUpperSecGradesheet ? `Rechenwert (${termLabel})` : 'Ø Gesamt';
            r2.appendChild(thTot);
            if (isUpperSecGradesheet) {
              const thResult = document.createElement('th');
              thResult.className = 'gradesheet-summary-column gradesheet-term-result-header';
              thResult.textContent = `Festgesetzt (${termLabel})`;
              r2.appendChild(thResult);
            }
            thead2.appendChild(r2);
            table2.appendChild(thead2);

            const tbody2 = document.createElement('tbody');

            // Zeilen: Schüler
            for (const [studentRowIndex, row] of rowsForTerm.entries()) {
              const stu = row.student;
              const tr = document.createElement('tr');
              tr.dataset.student = stu.id;
              tr.dataset.term = termKeyRaw || termLabel || 'all';

              const tdName = document.createElement('td');
              tdName.className = 'gradesheet-student-name';
              tdName.textContent = stu.lastName + ', ' + stu.firstName;
              if (assessmentsForTerm.length > 0) appendRowStatusDisclosure(tdName, stu, tr);
              tr.appendChild(tdName);
              trackGradesheetStudentRow(tr, stu);

              // Assessment-Zellen (nur für diesen Term)
              let assessmentColumnIndex = 0;
              for (const g of groupsTerm) {
                for (const asm of g.assessments) {
                  const currentAssessmentColumn = assessmentColumnIndex++;
                  const td = document.createElement('td');
                  const entry = asm.scores ? asm.scores[stu.id] : undefined;
                  if (isAssessmentNotScheduledForStudent(course, asm, stu.id, state.settings)) {
                    const unavailable = document.createElement('div');
                    unavailable.className = 'gradesheet-not-scheduled';
                    unavailable.textContent = 'nicht vorgesehen';
                    unavailable.title = 'In Q4 ist für diese Person keine Klausur vorgesehen.';
                    td.appendChild(unavailable);
                    if (entry) {
                      const conflict = document.createElement('div');
                      conflict.className = 'gradesheet-not-scheduled-conflict';
                      conflict.textContent = 'Vorhandener Wert: ' +
                        (entry.valueRaw != null && entry.valueRaw !== '' ? String(entry.valueRaw) : entry.status);
                      conflict.title = 'Der gespeicherte Altwert bleibt erhalten, wird aber nicht gewertet.';
                      td.appendChild(conflict);
                    }
                    tr.appendChild(td);
                    continue;
                  }
                  td.classList.add('gradesheet-editor-cell');
                  const input = document.createElement('input'); input.type='text'; input.className='gradesheet-input';
                  input.dataset.gradesheetRow = String(studentRowIndex);
                  input.dataset.gradesheetColumn = String(currentAssessmentColumn);
                  input.dataset.gradesheetTerm = termKeyRaw || termLabel || 'all';
                  const inputWrap = document.createElement('div');
                  inputWrap.className = 'gradesheet-input-wrap';
                  inputWrap.style.display = 'flex';
                  inputWrap.style.flexDirection = 'column';
                  inputWrap.style.alignItems = 'stretch';
                  inputWrap.style.flex = '1 1 0';
                  inputWrap.style.minWidth = '0';
                  inputWrap.style.width = '100%';
                  const errorEl = document.createElement('div');
                  errorEl.className = 'gradesheet-input-error';
                  errorEl.id = 'gradesheet-score-error-' + (++gradesheetErrorSequence);
                  input.setAttribute('aria-describedby', errorEl.id);
                  input.setAttribute('aria-invalid', 'false');
                  const rawValue = entry && entry.valueRaw != null ? String(entry.valueRaw) : '';
                  input.value = rawValue;

                  // initiale Farbcodierung (wenn bereits ein numerischer Wert vorhanden)
                  let numeric = null;
                  if (entry && entry.status === DomainModel.SCORE_STATUS.VALID && rawValue) {
                    if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) numeric = GradingLogic.parseGradeLabel(rawValue, state.settings.gradeMapping);
                    else if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) numeric = GradingLogic.parseUpperSecPoints(rawValue);
                  }
                  let bg = numeric != null ? getBackgroundForValue(course, numeric) : '';
                  const poorCell = (numeric != null) && isPoorValue(course, numeric, rawValue);
                  if (poorCell) bg = 'var(--grade-bg-critical)';
                  input.style.backgroundColor = bg || '';
                  if (bg) { td.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) td.style.color = '#050505'; }

                  // Status-Icon und Select erstellen
                  const statusIcon = document.createElement('div');
                  statusIcon.className = 'gradesheet-status-icon';
                  statusIcon.style.flex = '0 0 auto';
                  const iconSpan = document.createElement('span');
                  iconSpan.className = 'icon';
                  statusIcon.appendChild(iconSpan);

                  const statusSelect = document.createElement('select');
                  statusSelect.className = 'gradesheet-status';
                  statusSelect.style.flex = '0 0 auto';
                  setGradesheetEntryAccessibleNames(input, statusSelect, stu, asm, termKeyRaw || currentTermLocal);
                  connectRowStatusControl(tr, statusSelect);

                  const optValid = document.createElement('option');
                  optValid.value = DomainModel.SCORE_STATUS.VALID;
                  optValid.textContent = 'gültig';

                  const optMissing = document.createElement('option');
                  optMissing.value = DomainModel.SCORE_STATUS.MISSING;
                  optMissing.textContent = 'fehlt';

                  const optExcused = document.createElement('option');
                  optExcused.value = DomainModel.SCORE_STATUS.EXCUSED;
                  optExcused.textContent = 'entsch.';

                  statusSelect.appendChild(optValid);
                  statusSelect.appendChild(optMissing);
                  statusSelect.appendChild(optExcused);

                  const entryState = document.createElement('span');
                  entryState.className = 'gradesheet-entry-state';

                  const status = entry ? entry.status : DomainModel.SCORE_STATUS.VALID;
                  statusSelect.value = status;

                  function updateStatusIconFor(statusVal, statusRawValue) {
                    let svg = '';
                    const hasValue = String(statusRawValue == null ? input.value : statusRawValue).trim() !== '';
                    if (statusVal === DomainModel.SCORE_STATUS.VALID && hasValue) {
                      svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 9l3 3 9-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                      statusIcon.classList.toggle('status-valid', true);
                      statusIcon.classList.toggle('status-missing', false);
                      statusIcon.classList.toggle('status-excused', false);
                    } else if (statusVal === DomainModel.SCORE_STATUS.MISSING) {
                      svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
                      statusIcon.classList.toggle('status-valid', false);
                      statusIcon.classList.toggle('status-missing', true);
                      statusIcon.classList.toggle('status-excused', false);
                    } else if (statusVal === DomainModel.SCORE_STATUS.EXCUSED) {
                      svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 2v11h1l4-1.5L12 13V3l-4 1.5L4 2H3z" fill="currentColor"/></svg>';
                      statusIcon.classList.toggle('status-valid', false);
                      statusIcon.classList.toggle('status-missing', false);
                      statusIcon.classList.toggle('status-excused', true);
                    } else {
                      svg = '';
                      statusIcon.classList.remove('status-valid','status-missing','status-excused');
                    }
                    iconSpan.innerHTML = svg;
                    entryState.textContent = statusVal === DomainModel.SCORE_STATUS.MISSING
                      ? 'fehlt'
                      : (statusVal === DomainModel.SCORE_STATUS.EXCUSED ? 'entschuldigt' : '');
                    entryState.hidden = entryState.textContent === '';
                  }

                  updateStatusIconFor(status, rawValue);
                  let lastStatus = status;
                  const beginScoreInteraction = createLatestInteractionGuard();
                  let lastSavedSignature = null;
                  let pendingSavePromise = null;
                  let failedSaveBlocksNextFinish = false;

                  function scoreChangeSignature(raw, scoreStatus) {
                    return JSON.stringify([String(raw || '').trim(), scoreStatus]);
                  }

                  lastSavedSignature = scoreChangeSignature(input.value, statusSelect.value);

                  function showInputError(message, invalidValue) {
                    input.classList.add('gradesheet-input-invalid');
                    input.title = message;
                    input.setAttribute('aria-invalid', invalidValue ? 'true' : 'false');
                    errorEl.textContent = message;
                    errorEl.style.display = 'block';
                  }

                  function clearInputError() {
                    input.classList.remove('gradesheet-input-invalid');
                    input.title = '';
                    input.setAttribute('aria-invalid', 'false');
                    errorEl.textContent = '';
                    errorEl.style.display = 'none';
                  }

                  function numericFor(raw, scoreStatus) {
                    if (scoreStatus !== DomainModel.SCORE_STATUS.VALID || !raw) return null;
                    return course.schemaMode === DomainModel.SCHEMA_MODES.GRADES
                      ? GradingLogic.parseGradeLabel(raw, state.settings.gradeMapping)
                      : GradingLogic.parseUpperSecPoints(raw);
                  }

                  function updateCellPresentation(raw, scoreStatus, numericValue) {
                    let cellBg = numericValue != null ? getBackgroundForValue(course, numericValue) : '';
                    if (numericValue != null && isPoorValue(course, numericValue, raw)) cellBg = 'var(--grade-bg-critical)';
                    td.style.backgroundColor = cellBg || '';
                    input.style.backgroundColor = cellBg || '';
                    td.style.color = cellBg && document.body.classList.contains('theme-dark') ? '#050505' : '';
                    if (scoreStatus !== DomainModel.SCORE_STATUS.VALID) clearInputError();
                  }

                  function updateAffectedAverages() {
                    const currentRow = input.closest('tr');
                    if (currentRow) {
                      updateAveragesForTermRow(stu.id, currentRow, currentRow.dataset.term || 'all');
                      const comboRow = document.querySelector(`tr[data-student="${stu.id}"][data-term="all"]`);
                      if (comboRow && comboRow !== currentRow) {
                        updateAveragesForRow(stu.id, comboRow);
                        const trendCell = comboRow.querySelectorAll('td.gradesheet-trend')[0];
                        if (trendCell) updateTrendCell(trendCell, stu.id);
                      }
                    }
                  }

                  function buildNextTermScoreEntry(assessment, nextRaw, nextStatus) {
                    const current = assessment.scores && assessment.scores[stu.id];
                    const next = current ? { ...current } : DomainModel.createScoreEntry({});
                    next.valueRaw = nextRaw || null;
                    next.status = nextStatus;
                    next.valueNumeric = numericFor(nextRaw, nextStatus);
                    return next;
                  }

                  function persistTermScore(nextRaw, nextStatus) {
                    return persistScoreEntryWithRollback(
                      asm.id,
                      stu.id,
                      function (_current, candidateAssessment) {
                        return buildNextTermScoreEntry(candidateAssessment, nextRaw, nextStatus);
                      },
                      commitStateChange
                    );
                  }

                  function restoreTermScoreAfterSaveFailure(message) {
                    const assessment = DomainModel.findAssessmentById(state, asm.id);
                    const restored = assessment && assessment.scores ? assessment.scores[stu.id] : null;
                    input.value = restored && restored.valueRaw != null ? String(restored.valueRaw) : '';
                    statusSelect.value = restored ? restored.status : status;
                    lastStatus = statusSelect.value;
                    updateStatusIconFor(lastStatus, input.value);
                    updateCellPresentation(input.value, lastStatus, restored ? restored.valueNumeric : null);
                    updateAffectedAverages();
                    showInputError(message, false);
                    lastSavedSignature = scoreChangeSignature(input.value, statusSelect.value);
                  }

                  function validateCurrentTermScore(newRaw, newStatus, statusError) {
                    if (isAcceptableScoreEditorDraft(newRaw, newStatus)) return true;
                    showInputError(invalidScoreMessage(statusError), true);
                    return false;
                  }

                  function saveCurrentTermScoreEditor() {
                    if (pendingSavePromise) {
                      const requestedSignature = scoreChangeSignature(input.value, statusSelect.value);
                      return pendingSavePromise.then(function (saved) {
                        const requestIsStillCurrent = scoreChangeSignature(input.value, statusSelect.value) === requestedSignature;
                        return saved || requestIsStillCurrent ? saveCurrentTermScoreEditor() : false;
                      });
                    }
                    const newRaw = String(input.value || '').trim();
                    const newStatus = statusSelect.value;
                    const signature = scoreChangeSignature(newRaw, newStatus);
                    if (!validateCurrentTermScore(newRaw, newStatus, false)) return false;
                    if (signature === lastSavedSignature) {
                      clearInputError();
                      return true;
                    }
                    clearInputError();
                    input.value = newRaw;
                    const isLatestInteraction = beginScoreInteraction();
                    const operation = (async function () {
                      try {
                        const savedEntry = await persistTermScore(newRaw, newStatus);
                        lastSavedSignature = signature;
                        if (!isLatestInteraction() ||
                            scoreChangeSignature(input.value, statusSelect.value) !== signature) return true;
                        clearInputError();
                        lastStatus = newStatus;
                        updateStatusIconFor(newStatus, savedEntry.valueRaw);
                        updateCellPresentation(savedEntry.valueRaw, savedEntry.status, savedEntry.valueNumeric);
                        updateAffectedAverages();
                        return true;
                      } catch (error) {
                        if (!isLatestInteraction() ||
                            scoreChangeSignature(input.value, statusSelect.value) !== signature) return false;
                        restoreTermScoreAfterSaveFailure('Speichern fehlgeschlagen. Die vorherige Eingabe bleibt erhalten.');
                        failedSaveBlocksNextFinish = true;
                        return false;
                      } finally {
                        if (pendingSavePromise === operation) pendingSavePromise = null;
                      }
                    })();
                    pendingSavePromise = operation;
                    return operation;
                  }

                  function finishCurrentTermScoreEditor() {
                    if (failedSaveBlocksNextFinish) {
                      failedSaveBlocksNextFinish = false;
                      return false;
                    }
                    const result = saveCurrentTermScoreEditor();
                    if (!result || typeof result.then !== 'function') return result;
                    return result.then(function (saved) {
                      if (!saved) {
                        failedSaveBlocksNextFinish = false;
                        return false;
                      }
                      return finishCurrentTermScoreEditor();
                    });
                  }

                  function currentTermScoreEditorIsClean() {
                    if (pendingSavePromise || failedSaveBlocksNextFinish) return false;
                    const newRaw = String(input.value || '').trim();
                    const newStatus = statusSelect.value;
                    if (!isAcceptableScoreEditorDraft(newRaw, newStatus)) return false;
                    return scoreChangeSignature(newRaw, newStatus) === lastSavedSignature;
                  }

                  registerGradesheetEditor({
                    finish: finishCurrentTermScoreEditor,
                    isClean: currentTermScoreEditorIsClean,
                    focus: function () {
                      content.classList.remove('hidden');
                      header.classList.remove('collapsed');
                      input.focus();
                    }
                  });

                  input.addEventListener('change', async function() {
                    await saveCurrentTermScoreEditor();
                  });

                  statusSelect.addEventListener('change', async function() {
                    const newStatus = this.value;
                    if (newStatus === DomainModel.SCORE_STATUS.VALID) {
                      if (!validateCurrentTermScore(String(input.value || '').trim(), newStatus, true)) {
                        this.value = lastStatus;
                        return;
                      }
                    }
                    await saveCurrentTermScoreEditor();
                  });

                  input.addEventListener('keydown', async function(event) {
                    if (!['Enter', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
                    const allInputs = Array.from(document.querySelectorAll('.gradesheet-input'));
                    const target = findNextGradesheetInput(allInputs, input, event.key);
                    const shouldSave = event.key === 'Enter' || event.key === 'Tab';
                    if (!target && !shouldSave) return;
                    if (target || event.key === 'Enter') event.preventDefault();
                    if (shouldSave) {
                      const saved = await saveCurrentTermScoreEditor();
                      if (!saved) return false;
                    }
                    if (target) setTimeout(function () { target.focus(); target.select(); }, 0);
                    return false;
                  });

                  // Füge Input + Status-Elemente in die Zelle ein
                  const cellWrapper = document.createElement('div');
                  cellWrapper.className = 'gradesheet-cell';
                  inputWrap.appendChild(input);
                  inputWrap.appendChild(errorEl);
                  cellWrapper.appendChild(inputWrap);
                  cellWrapper.appendChild(entryState);
                  const statusControl = document.createElement('div');
                  statusControl.className = 'gradesheet-status-control';
                  statusControl.appendChild(statusIcon);
                  statusControl.appendChild(statusSelect);
                  cellWrapper.appendChild(statusControl);
                  td.appendChild(cellWrapper);
                  tr.appendChild(td);
                }
              }

              // Kategoriedurchschnitte
              for (const g of groupsTerm) {
                const tdAvg = document.createElement('td'); tdAvg.className='gradesheet-avg gradesheet-summary-column';
                const catAvg = GradingLogic.computeCategoryAverage(groupsTerm.flatMap(g2 => g2.assessments), course, stu.id, g.category.id, state.settings);
                if (catAvg === null || !Number.isFinite(catAvg)) { tdAvg.textContent='–'; tdAvg.classList.add('text-muted'); }
                else { tdAvg.textContent = formatLegacyFixed(catAvg, 2); let bg = getBackgroundForValue(course, catAvg); if (isPoorValue(course, catAvg)) bg = 'var(--grade-bg-critical)'; if (bg) { tdAvg.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) tdAvg.style.color='#050505'; } }
                tr.appendChild(tdAvg);
              }

              // Gesamtdurchschnitt nur für dieses Halbjahr
              const tdTotal = document.createElement('td'); tdTotal.className='gradesheet-avg gradesheet-summary-column';
              const overallTerm = renderWeightedOverallCell(
                tdTotal,
                assessmentsForTerm,
                course,
                stu.id,
                state.settings,
                termKeyRaw
              );
              if (overallTerm !== null) { let bg = getBackgroundForValue(course, overallTerm); if (isPoorValue(course, overallTerm)) bg = 'var(--grade-bg-critical)'; if (bg) { tdTotal.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) tdTotal.style.color='#050505'; } }
              tr.appendChild(tdTotal);
              if (isUpperSecGradesheet && termKeyRaw) {
                appendTermResultEditor(tr, stu, termKeyRaw, '', termLabel);
              }

              tbody2.appendChild(tr);
            }

            table2.appendChild(tbody2);
            content.appendChild(table2);
            return termSection;
          }

          // Sek I zeigt in H2 die verbindliche Jahresauswertung; alle anderen Fälle bleiben termweise.
          const showPrevTermAverages = !!prevTermLocal &&
            GradingLogic.isSchoolYearResultTerm(course, currentTermLocal);
          const needsSplit = !!prevTermLocal && !showPrevTermAverages;
          const mainAssessments = showPrevTermAverages
            ? (assessmentsAll || []).filter(a => {
                const term = getTermValue(a, null);
                return term === currentTermLocal || term === prevTermLocal;
              })
            : assessmentsAll;
          const mainGroups = showPrevTermAverages
            ? groups.map(g => ({
                category: g.category,
                assessments: g.assessments.filter(a => {
                  const term = getTermValue(a, null);
                  return term === currentTermLocal || term === prevTermLocal;
                })
              })).filter(g => g.assessments.length > 0)
            : groups;
          const displayGroups = showPrevTermAverages
            ? mainGroups.map(g => ({
                category: g.category,
                assessments: g.assessments.filter(a => getTermValue(a, null) === currentTermLocal)
              })).filter(g => g.assessments.length > 0)
            : mainGroups;
          if (needsSplit) {
            const assessmentsCurr = (assessmentsAll || []).filter(a => getTermValue(a, null) === currentTermLocal);
            const assessmentsPrev = (assessmentsAll || []).filter(a => getTermValue(a, null) === prevTermLocal);
            const assessmentsNext = (assessmentsAll || []).filter(a => getTermValue(a, null) === nextTermLocal);

            section.appendChild(renderTermSection(formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal) || 'akt.', assessmentsCurr, false, currentTermLocal));
            if (nextTermLocal && assessmentsNext.length > 0) {
              section.appendChild(renderTermSection(formatTermLabel(nextTermLocal, course.schemaMode, currentTermLocal) || 'nächst.', assessmentsNext, false, nextTermLocal, studentRows, false));
            }
            section.appendChild(renderTermSection(formatTermLabel(prevTermLocal, course.schemaMode, currentTermLocal) || 'vorj.', assessmentsPrev, true, prevTermLocal));

            section.appendChild(tableHelp);
            container.appendChild(section);
            return;
          }
          const thead = document.createElement("thead");

          // Erste Kopfzeile: Schüler + Kategorien + Block für Durchschnitte
          const tr1 = document.createElement("tr");
          const thName = document.createElement("th");
          thName.rowSpan = 2;
          thName.className = "gradesheet-student-name";
          thName.textContent = "Schüler";
          tr1.appendChild(thName);

          for (const g of displayGroups) {
            const th = document.createElement("th");
            th.colSpan = g.assessments.length;
            th.textContent = g.category.name;
            tr1.appendChild(th);
          }

          if (mainGroups.length > 0) {
            // Berechne Spalten-Anzahl für die Durchschnitts-Box: pro Kategorie 1 oder 2 Spalten
            const hasPrev = !!prevTermLocal;
            const isUpperSecGradesheet = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC;
            const avgColsPerCategory = hasPrev ? 2 : 1;
            const totalAvgCols = mainGroups.length * avgColsPerCategory + (hasPrev ? 4 : 2) +
              (isUpperSecGradesheet ? (hasPrev ? 2 : 1) : 0);

            const thAvgBlock = document.createElement("th");
            thAvgBlock.colSpan = totalAvgCols;
            thAvgBlock.textContent = "Durchschnittswerte & Tendenz";
            tr1.appendChild(thAvgBlock);
          }

          thead.appendChild(tr1);

          // Zweite Kopfzeile: einzelne Leistungen + Ø-Kategorien + Ø-Gesamt
          const tr2 = document.createElement("tr");
          for (const g of displayGroups) {
            for (const asm of g.assessments) {
              const th = document.createElement("th");
              th.className = "gradesheet-assessment-header";

              const spanTitle = document.createElement("span");
              spanTitle.className = "gradesheet-assessment-title";
              spanTitle.textContent = asm.title || "L";

              const metadata = document.createElement("div");
              metadata.className = "gradesheet-assessment-meta";

              // Term / Archiv Indikator
              const termVal = getTermValue(asm, null);
              if (termVal && termVal !== currentTermLocal) {
                const termBadge = document.createElement('span');
                termBadge.className = 'term-badge';
                termBadge.textContent = formatTermLabel(termVal, course.schemaMode, currentTermLocal);
                termBadge.title = 'Archiviertes Halbjahr';
                metadata.appendChild(termBadge);
                th.classList.add('prev-term');
                // Zeige zusätzlich an, ob diese Leistung in die Berechnung einfließt
                if (showPrevTermAverages && termVal === prevTermLocal) {
                  const inc = document.createElement('span');
                  inc.className = 'badge';
                  inc.textContent = 'in Berechnung';
                  metadata.appendChild(inc);
                }
              }

              // Sichtbarkeits-Indikator
              if (asm.visible === false) {
                const hiddenIcon = document.createElement("span");
                hiddenIcon.textContent = "👁️‍🗨️";
                hiddenIcon.title = "Nicht in PDF-Berichten sichtbar";
                hiddenIcon.className = "gradesheet-assessment-meta-item";
                metadata.appendChild(hiddenIcon);
              }

              th.appendChild(spanTitle);

              // Unterkategorie anzeigen (falls vorhanden)
              if (asm.subcategoryId) {
                const category = (state.settings.categories || []).find(c => c.id === asm.categoryId);
                if (category && category.subcategories) {
                  const subcat = category.subcategories.find(sc => sc.id === asm.subcategoryId);
                  if (subcat) {
                    const subcatSpan = document.createElement("span");
                    subcatSpan.className = "gradesheet-assessment-meta-item";
                    subcatSpan.textContent = subcat.name;
                    metadata.appendChild(subcatSpan);
                  }
                }
              }

              // Datum unter der Unterkategorie/dem Titel anzeigen (falls vorhanden)
              if (asm.date) {
                const dateSpan = document.createElement("span");
                dateSpan.className = "gradesheet-assessment-meta-item";
                dateSpan.textContent = asm.date;
                metadata.appendChild(dateSpan);
              }

              if (metadata.children.length > 0) th.appendChild(metadata);
              tr2.appendChild(th);
            }
          }

          const hasPrev = !!prevTermLocal;
          const isUpperSecGradesheet = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC;
          const currentCategoryTermLabel = formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal) || 'akt.';
          const previousCategoryTermLabel = formatTermLabel(prevTermLocal, course.schemaMode, currentTermLocal) || 'vorj.';
          for (const g of mainGroups) {
            if (hasPrev) {
              const thCurr = document.createElement('th');
              thCurr.classList.add('gradesheet-summary-column', 'gradesheet-summary-current');
              thCurr.textContent = `Ø ${g.category.name} (${currentCategoryTermLabel})`;
              tr2.appendChild(thCurr);

              const thPrev = document.createElement('th');
              thPrev.textContent = `Ø ${g.category.name} (${previousCategoryTermLabel})`;
              thPrev.classList.add('gradesheet-summary-column', 'prev-term', 'gradesheet-summary-previous');
              tr2.appendChild(thPrev);
            } else {
              const th = document.createElement("th");
              th.className = 'gradesheet-summary-column';
              th.textContent = "Ø " + g.category.name;
              tr2.appendChild(th);
            }
          }

          if (hasPrev) {
            const thTotalCurr = document.createElement('th');
            thTotalCurr.classList.add('gradesheet-summary-column', 'gradesheet-summary-current');
            const currentTermLabel = formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal) || 'akt.';
            thTotalCurr.textContent = isUpperSecGradesheet ? `Rechenwert (${currentTermLabel})` : `Ø Gesamt (${currentTermLabel})`;
            tr2.appendChild(thTotalCurr);
            if (isUpperSecGradesheet) {
              const thResultCurr = document.createElement('th');
              thResultCurr.classList.add('gradesheet-summary-column', 'gradesheet-summary-current', 'gradesheet-term-result-header');
              thResultCurr.textContent = `Festgesetzt (${currentTermLabel})`;
              tr2.appendChild(thResultCurr);
            }

            const thTotalPrev = document.createElement('th');
            const previousTermLabel = formatTermLabel(prevTermLocal, course.schemaMode, currentTermLocal) || 'vorj.';
            thTotalPrev.textContent = isUpperSecGradesheet ? `Rechenwert (${previousTermLabel})` : `Ø Gesamt (${previousTermLabel})`;
            thTotalPrev.classList.add('gradesheet-summary-column', 'prev-term', 'gradesheet-summary-previous');
            tr2.appendChild(thTotalPrev);
            if (isUpperSecGradesheet) {
              const thResultPrev = document.createElement('th');
              thResultPrev.textContent = `Festgesetzt (${previousTermLabel})`;
              thResultPrev.classList.add('gradesheet-summary-column', 'prev-term', 'gradesheet-summary-previous', 'gradesheet-term-result-header');
              tr2.appendChild(thResultPrev);
            }

            const thTotalAll = document.createElement('th');
            thTotalAll.classList.add('gradesheet-summary-column', 'gradesheet-summary-year');
            thTotalAll.textContent = isUpperSecGradesheet ? 'Rechenwert (gesamt)' : 'Jahresgesamtnote (H1 + H2)';
            tr2.appendChild(thTotalAll);
          } else {
            const thTotal = document.createElement("th");
            thTotal.className = 'gradesheet-summary-column';
            const currentTermLabel = formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal) || 'akt.';
            thTotal.textContent = isUpperSecGradesheet ? `Rechenwert (${currentTermLabel})` : 'Ø Gesamt';
            tr2.appendChild(thTotal);
            if (isUpperSecGradesheet) {
              const thResult = document.createElement('th');
              thResult.className = 'gradesheet-summary-column gradesheet-term-result-header';
              thResult.textContent = `Festgesetzt (${currentTermLabel})`;
              tr2.appendChild(thResult);
            }
          }

          const thTrend = document.createElement("th");
          thTrend.textContent = "Tendenz";
          thTrend.title = "Vergleich erste vs. zweite Hälfte der Noten";
          tr2.appendChild(thTrend);

          thead.appendChild(tr2);
          table.appendChild(thead);

          const tbody = document.createElement("tbody");

          // ------------------------------------------------------
          // FEATURE: Tendenz-Anzeige (Leistungsentwicklung)
          // Berechnet ob sich Schülerleistung verbessert, verschlechtert oder stabil bleibt
          // durch Vergleich der ersten und zweiten Hälfte aller chronologisch sortierten Leistungen
          // Symbole: ↗️ (Verbesserung), ↘️ (Verschlechterung), ↔️ (stabil)
          // ------------------------------------------------------
          function computeTrend(studentId) {
            const confirmedCourse = DomainModel.findCourseById(state, course.id) || course;
            const assessments = mainAssessments.map(a => {
              const current = DomainModel.findAssessmentById(state, a.id);
              const entry = current && current.scores ? current.scores[studentId] : undefined;
              const numeric = GradingLogic.getNumericScoreForEntry(entry, confirmedCourse, state.settings);
              return numeric == null ? null : { assessment: current, numeric };
            }).filter(Boolean);

            if (assessments.length < 2) return null; // Zu wenig Daten

            // Sortiere nach Datum (falls vorhanden), sonst nach Erstellungsreihenfolge
            assessments.sort((a, b) => {
              if (a.assessment.date && b.assessment.date) return a.assessment.date.localeCompare(b.assessment.date);
              return 0;
            });

            const midPoint = Math.floor(assessments.length / 2);
            const firstHalf = assessments.slice(0, midPoint);
            const secondHalf = assessments.slice(midPoint);

            if (firstHalf.length === 0 || secondHalf.length === 0) return null;

            // Berechne Durchschnitt für jede Hälfte
            const avgFirst = firstHalf.reduce((sum, a) => sum + a.numeric, 0) / firstHalf.length;

            const avgSecond = secondHalf.reduce((sum, a) => sum + a.numeric, 0) / secondHalf.length;

            const diff = avgSecond - avgFirst;
            const threshold = 0.3; // Schwellwert für "stabil"

            // Bei Noten (1-6): kleinere Werte sind besser, also umgekehrte Logik
            if (confirmedCourse.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
              if (diff <= -threshold) return "up";    // Verbesserung (kleinere Note)
              if (diff >= threshold) return "down";   // Verschlechterung (größere Note)
              return "stable";
            } else {
              // Bei Punkten (0-15): größere Werte sind besser
              if (diff >= threshold) return "up";     // Verbesserung (mehr Punkte)
              if (diff <= -threshold) return "down";  // Verschlechterung (weniger Punkte)
              return "stable";
            }
          }

          function updateTrendCell(cell, studentId) {
            const trend = computeTrend(studentId);
            cell.classList.remove('text-muted');
            cell.style.color = '';
            if (trend === 'up') {
              cell.textContent = '↗️';
              cell.title = 'Verbesserung: zweite Hälfte besser als erste';
              cell.style.color = '#2e7d32';
            } else if (trend === 'down') {
              cell.textContent = '↘️';
              cell.title = 'Verschlechterung: zweite Hälfte schlechter als erste';
              cell.style.color = '#c62828';
            } else if (trend === 'stable') {
              cell.textContent = '↔️';
              cell.title = 'Stabil: keine signifikante Änderung';
              cell.style.color = '#757575';
            } else {
              cell.textContent = '–';
              cell.title = 'Zu wenig Daten für Trendanalyse';
              cell.classList.add('text-muted');
            }
          }

          // Hilfsfunktion: Aktualisiert nur die Durchschnittswerte einer Zeile ohne Re-Rendering
          // FEATURE: Schnelleingabe-Modus (Excel-Navigation)
          // Aktualisiert Durchschnittszellen direkt im DOM ohne Re-Rendering
          // um den Fokus während der Tastatureingabe zu erhalten
          function updateAveragesForRow(studentId, rowElement) {
            const avgCells = rowElement.querySelectorAll('td.gradesheet-avg, td.term-current, td.term-prev');
            let cellIndex = 0;
            const hasPrevCells = !!prevTermLocal;
            const confirmedCourse = DomainModel.findCourseById(state, course.id) || course;
            const confirmedAssessments = DomainModel.listAssessmentsForCourse(state, course.id) || [];
            const confirmedMainAssessments = showPrevTermAverages
              ? confirmedAssessments.filter(a => {
                  const term = getTermValue(a, null);
                  return term === currentTermLocal || term === prevTermLocal;
                })
              : confirmedAssessments;

            // Kategoriedurchschnitte aktualisieren
            for (const g of mainGroups) {
              if (hasPrevCells) {
                const cellCurr = avgCells[cellIndex++];
                const currAss = confirmedAssessments.filter(a => a.categoryId === g.category.id && getTermValue(a, null) === currentTermLocal);
                const catCurr = GradingLogic.computeCategoryAverage(currAss, confirmedCourse, studentId, g.category.id, state.settings);
                if (cellCurr) {
                  if (catCurr === null || !Number.isFinite(catCurr)) {
                    cellCurr.textContent = '–'; cellCurr.style.backgroundColor = ''; cellCurr.style.color = ''; cellCurr.classList.add('text-muted');
                  } else { cellCurr.textContent = formatLegacyFixed(catCurr, 2); cellCurr.classList.remove('text-muted'); let bg = getBackgroundForValue(confirmedCourse, catCurr); if (isPoorValue(confirmedCourse, catCurr)) bg = 'var(--grade-bg-critical)'; if (bg) { cellCurr.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) cellCurr.style.color = '#050505'; } else { cellCurr.style.backgroundColor = ''; cellCurr.style.color = ''; } }
                }

                const cellPrev = avgCells[cellIndex++];
                const prevAss = confirmedAssessments.filter(a => a.categoryId === g.category.id && getTermValue(a, null) === prevTermLocal);
                const catPrev = GradingLogic.computeCategoryAverage(prevAss, confirmedCourse, studentId, g.category.id, state.settings);
                if (cellPrev) {
                  if (catPrev === null || !Number.isFinite(catPrev)) { cellPrev.textContent = '–'; cellPrev.style.backgroundColor = ''; cellPrev.style.color = ''; cellPrev.classList.add('text-muted'); }
                  else { cellPrev.textContent = formatLegacyFixed(catPrev, 2); cellPrev.classList.remove('text-muted'); let bgp = getBackgroundForValue(confirmedCourse, catPrev); if (isPoorValue(confirmedCourse, catPrev)) bgp = 'var(--grade-bg-critical)'; if (bgp) { cellPrev.style.backgroundColor = bgp; if (document.body.classList.contains('theme-dark')) cellPrev.style.color = '#050505'; } else { cellPrev.style.backgroundColor = ''; cellPrev.style.color = ''; } }
                }

              } else {
                const cell = avgCells[cellIndex++];
                const catAvg = GradingLogic.computeCategoryAverage(
                  confirmedAssessments,
                  confirmedCourse,
                  studentId,
                  g.category.id,
                  state.settings
                );
                if (cell) {
                  if (catAvg === null || !Number.isFinite(catAvg)) {
                    cell.textContent = "–";
                    cell.style.backgroundColor = "";
                    cell.style.color = "";
                    cell.classList.add("text-muted");
                  } else {
                    cell.textContent = formatLegacyFixed(catAvg, 2);
                    cell.classList.remove("text-muted");
                    let bg = getBackgroundForValue(confirmedCourse, catAvg);
                    if (isPoorValue(confirmedCourse, catAvg)) bg = "var(--grade-bg-critical)";
                    if (bg) {
                      cell.style.backgroundColor = bg;
                      if (document.body.classList.contains("theme-dark")) {
                        cell.style.color = "#050505";
                      }
                    } else {
                      cell.style.backgroundColor = "";
                      cell.style.color = "";
                    }
                  }
                }
              }
            }

            // Gesamtdurchschnitte aktualisieren
            if (hasPrevCells) {
              const cellTotalCurr = avgCells[cellIndex++];
              if (cellTotalCurr) {
                const currentAssessments = confirmedMainAssessments.filter(
                  assessment => getTermValue(assessment, null) === currentTermLocal
                );
                const overallCurr = renderWeightedOverallCell(
                  cellTotalCurr,
                  currentAssessments,
                  confirmedCourse,
                  studentId,
                  state.settings,
                  currentTermLocal
                );
                if (overallCurr === null || !Number.isFinite(overallCurr)) { cellTotalCurr.textContent = '–'; cellTotalCurr.style.backgroundColor = ''; cellTotalCurr.style.color = ''; cellTotalCurr.classList.add('text-muted'); }
                else { cellTotalCurr.textContent = formatLegacyFixed(overallCurr, 2); cellTotalCurr.classList.remove('text-muted'); let bg = getBackgroundForValue(confirmedCourse, overallCurr); if (isPoorValue(confirmedCourse, overallCurr)) bg = 'var(--grade-bg-critical)'; if (bg) { cellTotalCurr.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) cellTotalCurr.style.color = '#050505'; } else { cellTotalCurr.style.backgroundColor = ''; cellTotalCurr.style.color = ''; } }
              }

              const cellTotalPrev = avgCells[cellIndex++];
              const previousAssessments = confirmedAssessments.filter(
                assessment => getTermValue(assessment, null) === prevTermLocal
              );
              if (cellTotalPrev) {
                const overallPrev = renderWeightedOverallCell(
                  cellTotalPrev,
                  previousAssessments,
                  confirmedCourse,
                  studentId,
                  state.settings,
                  prevTermLocal
                );
                if (overallPrev === null) { cellTotalPrev.style.backgroundColor = ''; cellTotalPrev.style.color = ''; }
                else { let bg = getBackgroundForValue(confirmedCourse, overallPrev); if (isPoorValue(confirmedCourse, overallPrev)) bg = 'var(--grade-bg-critical)'; if (bg) { cellTotalPrev.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) cellTotalPrev.style.color = '#050505'; } else { cellTotalPrev.style.backgroundColor = ''; cellTotalPrev.style.color = ''; } }
              }

              const cellTotalAll = avgCells[cellIndex++];
              const overallAll = GradingLogic.computeOverallGrade(confirmedCourse, studentId, state, currentTermLocal);
              if (cellTotalAll) {
                if (overallAll === null || !Number.isFinite(overallAll)) { cellTotalAll.textContent = '–'; cellTotalAll.style.backgroundColor = ''; cellTotalAll.style.color = ''; cellTotalAll.classList.add('text-muted'); }
                else { cellTotalAll.textContent = formatLegacyFixed(overallAll, 2); cellTotalAll.classList.remove('text-muted'); let bg = getBackgroundForValue(confirmedCourse, overallAll); if (isPoorValue(confirmedCourse, overallAll)) bg = 'var(--grade-bg-critical)'; if (bg) { cellTotalAll.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) cellTotalAll.style.color = '#050505'; } else { cellTotalAll.style.backgroundColor = ''; cellTotalAll.style.color = ''; } }
              }

            } else {
              const cellTotal = avgCells[cellIndex++];
              const overall = GradingLogic.computeOverallGrade(confirmedCourse, studentId, state);
              if (cellTotal) {
                if (overall === null || !Number.isFinite(overall)) {
                  cellTotal.textContent = "–";
                  cellTotal.style.backgroundColor = "";
                  cellTotal.style.color = "";
                  cellTotal.classList.add("text-muted");
                } else {
                  cellTotal.textContent = formatLegacyFixed(overall, 2);
                  cellTotal.classList.remove("text-muted");
                  let bg = getBackgroundForValue(confirmedCourse, overall);
                  if (isPoorValue(confirmedCourse, overall)) bg = "var(--grade-bg-critical)";
                  if (bg) {
                    cellTotal.style.backgroundColor = bg;
                    if (document.body.classList.contains("theme-dark")) {
                      cellTotal.style.color = "#050505";
                    }
                  } else {
                    cellTotal.style.backgroundColor = "";
                    cellTotal.style.color = "";
                  }
                }
              }
            }
          }

          // Aktualisiert die Durchschnittszellen nur für eine bestimmte Halbjahr-Zeile
          function updateAveragesForTermRow(studentId, rowElement, termLabel) {
            if (!rowElement) return;
            if (!termLabel || termLabel === 'all') { return updateAveragesForRow(studentId, rowElement); }

            // Bestimme die Leistungen für dieses Halbjahr
            const confirmedCourse = DomainModel.findCourseById(state, course.id) || course;
            const confirmedAssessments = DomainModel.listAssessmentsForCourse(state, course.id) || [];
            const courseSettings = GradingLogic.getSettingsForCourse(confirmedCourse, state);
            const termAssessments = confirmedAssessments.filter(a => {
              const t = a && (a.term || (a.date
                ? GradingLogic.resolveAssessmentTermFromDateValue(new Date(a.date), confirmedCourse, courseSettings)
                : null));
              return t === termLabel;
            });

            // Gruppiere nach Kategorie
            const catByIdLocal = new Map();
            for (const c of state.settings.categories || []) catByIdLocal.set(c.id, c);
            const groupsLocal = new Map();
            for (const a of termAssessments) {
              const cat = catByIdLocal.get(a.categoryId);
              if (!cat) continue;
              let g = groupsLocal.get(cat.id);
              if (!g) { g = { category: cat, assessments: [] }; groupsLocal.set(cat.id, g); }
              g.assessments.push(a);
            }
            const groupsTerm = Array.from(groupsLocal.values());
            groupsTerm.sort((a,b)=>compareText(a.category.name, b.category.name));

            // Finde avg-Zellen in der Zeile (nur die term-spezifischen)
            const avgCells = rowElement.querySelectorAll('td.gradesheet-avg');
            let idx = 0;

            // Kategoriedurchschnitte
            for (const g of groupsTerm) {
              const cell = avgCells[idx++];
              if (!cell) continue;
              const catAvg = GradingLogic.computeCategoryAverage(g.assessments, confirmedCourse, studentId, g.category.id, state.settings);
              if (catAvg === null || !Number.isFinite(catAvg)) { cell.textContent = '–'; cell.classList.add('text-muted'); cell.style.backgroundColor=''; cell.style.color=''; }
              else { cell.textContent = formatLegacyFixed(catAvg, 2); cell.classList.remove('text-muted'); let bg = getBackgroundForValue(confirmedCourse, catAvg); if (isPoorValue(confirmedCourse, catAvg)) bg = 'var(--grade-bg-critical)'; if (bg) { cell.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) cell.style.color = '#050505'; } else { cell.style.backgroundColor=''; cell.style.color=''; } }
            }

            // Gesamtdurchschnitt für dieses Halbjahr
            const totalCell = avgCells[idx++];
            if (totalCell) {
              const overall = renderWeightedOverallCell(
                totalCell,
                termAssessments,
                confirmedCourse,
                studentId,
                state.settings,
                termLabel
              );
              if (overall !== null) { let bg = getBackgroundForValue(confirmedCourse, overall); if (isPoorValue(confirmedCourse, overall)) bg = 'var(--grade-bg-critical)'; if (bg) { totalCell.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) totalCell.style.color = '#050505'; } else { totalCell.style.backgroundColor=''; totalCell.style.color=''; } }
            }
          }

          for (const [studentRowIndex, row] of studentRows.entries()) {
            const stu = row.student;
            const tr = document.createElement("tr");
            tr.dataset.student = stu.id;
            tr.dataset.term = 'all';

            const tdName = document.createElement("td");
            tdName.className = "gradesheet-student-name";
            tdName.textContent = stu.lastName + ", " + stu.firstName;
            appendRowStatusDisclosure(tdName, stu, tr);
            tr.appendChild(tdName);
            trackGradesheetStudentRow(tr, stu);

            // Zellen für jede Leistung (nur aktuelle HJ-Leistungen wenn includePrevTermGrades aktiv)
            let assessmentColumnIndex = 0;
            for (const g of displayGroups) {
              for (const asm of g.assessments) {
                const currentAssessmentColumn = assessmentColumnIndex++;
                const td = document.createElement("td");

                const termVal = getTermValue(asm, null);
                const isPrevTerm = termVal === prevTermLocal;
                const entry = asm.scores ? asm.scores[stu.id] : undefined;

                if (isAssessmentNotScheduledForStudent(course, asm, stu.id, state.settings)) {
                  const unavailable = document.createElement('div');
                  unavailable.className = 'gradesheet-not-scheduled';
                  unavailable.textContent = 'nicht vorgesehen';
                  unavailable.title = 'In Q4 ist für diese Person keine Klausur vorgesehen.';
                  td.appendChild(unavailable);
                  if (entry) {
                    const conflict = document.createElement('div');
                    conflict.className = 'gradesheet-not-scheduled-conflict';
                    conflict.textContent = 'Vorhandener Wert: ' +
                      (entry.valueRaw != null && entry.valueRaw !== '' ? String(entry.valueRaw) : entry.status);
                    conflict.title = 'Der gespeicherte Altwert bleibt erhalten, wird aber nicht gewertet.';
                    td.appendChild(conflict);
                  }
                  tr.appendChild(td);
                  continue;
                }

                // Optische Abgrenzung für Leistungen aus vorherigem Halbjahr
                if (isPrevTerm) {
                  td.classList.add('prev-term');
                }
                td.classList.add('gradesheet-editor-cell');

                const cellWrapper = document.createElement("div");
                cellWrapper.className = "gradesheet-cell";

                const input = document.createElement("input");
                input.type = "text";
                input.className = "gradesheet-input";
                input.dataset.gradesheetRow = String(studentRowIndex);
                input.dataset.gradesheetColumn = String(currentAssessmentColumn);
                input.dataset.gradesheetTerm = 'all';

                if (isPrevTerm) {
                  input.title = 'Archiv: ' + formatTermLabel(termVal, course.schemaMode, currentTermLocal) + (course.includePrevTermGrades && termVal === prevTermLocal ? ' (in Berechnung)' : ' (nicht in Berechnung)');
                }

                // Wrapper für Input + Inline-Fehlermeldung
                const inputWrap = document.createElement('div');
                inputWrap.className = 'gradesheet-input-wrap';
                inputWrap.style.display = 'flex';
                inputWrap.style.flexDirection = 'column';
                inputWrap.style.alignItems = 'stretch';
                inputWrap.style.flex = '1 1 0';
                inputWrap.style.minWidth = '0';
                inputWrap.style.width = '100%';

                const errorEl = document.createElement('div');
                errorEl.className = 'gradesheet-input-error';
                errorEl.textContent = '';
                errorEl.id = 'gradesheet-score-error-' + (++gradesheetErrorSequence);
                input.setAttribute('aria-describedby', errorEl.id);
                input.setAttribute('aria-invalid', 'false');

                // Status-Icon (sichtbar) + Select (für Änderung)
                const statusIcon = document.createElement('div');
                statusIcon.className = 'gradesheet-status-icon';
                statusIcon.style.flex = '0 0 auto';
                const iconSpan = document.createElement('span');
                iconSpan.className = 'icon';
                statusIcon.appendChild(iconSpan);

                const statusSelect = document.createElement("select");
                statusSelect.className = "gradesheet-status";
                statusSelect.style.flex = '0 0 auto';
                setGradesheetEntryAccessibleNames(input, statusSelect, stu, asm, currentTermLocal);
                connectRowStatusControl(tr, statusSelect);

                const optValid = document.createElement("option");
                optValid.value = DomainModel.SCORE_STATUS.VALID;
                optValid.textContent = "gültig";

                const optMissing = document.createElement("option");
                optMissing.value = DomainModel.SCORE_STATUS.MISSING;
                optMissing.textContent = "fehlt";

                const optExcused = document.createElement("option");
                optExcused.value = DomainModel.SCORE_STATUS.EXCUSED;
                optExcused.textContent = "entsch.";

                statusSelect.appendChild(optValid);
                statusSelect.appendChild(optMissing);
                statusSelect.appendChild(optExcused);

                const entryState = document.createElement('span');
                entryState.className = 'gradesheet-entry-state';

                const status = entry ? entry.status : DomainModel.SCORE_STATUS.VALID;
                const rawValue =
                  entry && entry.valueRaw != null ? String(entry.valueRaw) : "";

                input.value = rawValue;
                statusSelect.value = status;

                const numeric =
                  entry && entry.status === DomainModel.SCORE_STATUS.VALID
                    ? GradingLogic.getNumericScoreForEntry(entry, course, state.settings)
                    : null;

                if (
                  status === DomainModel.SCORE_STATUS.VALID &&
                  rawValue &&
                  (numeric === null || !Number.isFinite(numeric))
                ) {
                  input.classList.add("gradesheet-input-invalid");
                  input.setAttribute('aria-invalid', 'true');
                } else {
                  input.classList.remove("gradesheet-input-invalid");
                }

                // Setze Icon + Label basierend auf dem Status
                function updateStatusIconFor(statusVal, statusRawValue) {
                  // Kleine Inline-SVGs nutzen, die `currentColor` übernehmen, damit die Statusfarbe greift
                  let svg = '';
                  const hasValue = String(statusRawValue == null ? input.value : statusRawValue).trim() !== '';
                  if (statusVal === DomainModel.SCORE_STATUS.VALID && hasValue) {
                    svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 9l3 3 9-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                    statusIcon.classList.toggle('status-valid', true);
                    statusIcon.classList.toggle('status-missing', false);
                    statusIcon.classList.toggle('status-excused', false);
                  } else if (statusVal === DomainModel.SCORE_STATUS.MISSING) {
                    svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
                    statusIcon.classList.toggle('status-valid', false);
                    statusIcon.classList.toggle('status-missing', true);
                    statusIcon.classList.toggle('status-excused', false);
                  } else if (statusVal === DomainModel.SCORE_STATUS.EXCUSED) {
                    svg = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 2v11h1l4-1.5L12 13V3l-4 1.5L4 2H3z" fill="currentColor"/></svg>';
                    statusIcon.classList.toggle('status-valid', false);
                    statusIcon.classList.toggle('status-missing', false);
                    statusIcon.classList.toggle('status-excused', true);
                  } else {
                    svg = '';
                    statusIcon.classList.remove('status-valid','status-missing','status-excused');
                  }
                  iconSpan.innerHTML = svg;
                  entryState.textContent = statusVal === DomainModel.SCORE_STATUS.MISSING
                    ? 'fehlt'
                    : (statusVal === DomainModel.SCORE_STATUS.EXCUSED ? 'entschuldigt' : '');
                  entryState.hidden = entryState.textContent === '';
                }

                let bg = numeric != null ? getBackgroundForValue(course, numeric) : "";
                // Wenn die Note als 'schlecht' eingestuft wird, überschreibe die Hintergrundfarbe
                const poorCell = (numeric != null) && isPoorValue(course, numeric, rawValue);
                if (poorCell) bg = "var(--grade-bg-critical)";
                input.style.backgroundColor = bg || '';
                if (bg) {
                  td.style.backgroundColor = bg;
                  // Im Darkmode in farbigen Zellen dunkle Schrift, damit der Kontrast stimmt
                  if (document.body.classList.contains("theme-dark")) {
                    td.style.color = "#050505";
                  }
                }


                // Merke zuletzt bekannten Status, damit wir bei ungültigen Änderungen zurücksetzen können
                let lastStatus = status;
                const beginScoreInteraction = createLatestInteractionGuard();
                let suppressedChangeSignature = null;
                let lastSavedSignature = null;
                let pendingSavePromise = null;
                let failedSaveBlocksNextFinish = false;

                function scoreChangeSignature(raw, scoreStatus) {
                  return JSON.stringify([String(raw || '').trim(), scoreStatus]);
                }

                lastSavedSignature = scoreChangeSignature(input.value, statusSelect.value);

                function updateCurrentRowAverages() {
                  const currentRow = input.closest('tr');
                  if (currentRow) {
                    updateAveragesForRow(stu.id, currentRow);
                    const trendCell = currentRow.querySelectorAll('td.gradesheet-trend')[0];
                    if (trendCell) updateTrendCell(trendCell, stu.id);
                  }
                }

                function updateCurrentCellPresentation() {
                  const assessment = DomainModel.findAssessmentById(state, asm.id);
                  const current = assessment && assessment.scores ? assessment.scores[stu.id] : null;
                  const currentRaw = current && current.valueRaw != null ? String(current.valueRaw) : '';
                  const currentNumeric = current && current.status === DomainModel.SCORE_STATUS.VALID
                    ? GradingLogic.getNumericScoreForEntry(current, course, state.settings)
                    : null;
                  let nextBackground = currentNumeric != null
                    ? getBackgroundForValue(course, currentNumeric)
                    : '';
                  if (currentNumeric != null && isPoorValue(course, currentNumeric, currentRaw)) {
                    nextBackground = 'var(--grade-bg-critical)';
                  }
                  td.style.backgroundColor = nextBackground || '';
                  input.style.backgroundColor = nextBackground || '';
                  td.style.color = nextBackground && document.body.classList.contains('theme-dark')
                    ? '#050505'
                    : '';
                }

                function buildNextScoreEntry(assessment, newRaw, newStatus) {
                  const current = assessment.scores && assessment.scores[stu.id];
                  const next = current ? { ...current } : DomainModel.createScoreEntry({});
                  next.status = newStatus;
                  next.valueRaw = newRaw || null;
                  if (newStatus === DomainModel.SCORE_STATUS.VALID && newRaw) {
                    if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
                      next.valueNumeric = GradingLogic.parseGradeLabel(newRaw, state.settings.gradeMapping);
                    } else if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
                      next.valueNumeric = GradingLogic.parseUpperSecPoints(newRaw);
                    }
                  } else {
                    next.valueNumeric = null;
                  }
                  return next;
                }

                async function persistCurrentGradesheetScore(newRaw, newStatus) {
                  return persistScoreEntryWithRollback(
                    asm.id,
                    stu.id,
                    function (_current, candidateAssessment) {
                      return buildNextScoreEntry(candidateAssessment, newRaw, newStatus);
                    },
                    commitStateChange
                  );
                }

                function restoreCellAfterSaveFailure(message) {
                  const assessment = DomainModel.findAssessmentById(state, asm.id);
                  const restored = assessment && assessment.scores ? assessment.scores[stu.id] : null;
                  input.value = restored && restored.valueRaw != null ? String(restored.valueRaw) : '';
                  statusSelect.value = restored ? restored.status : status;
                  lastStatus = statusSelect.value;
                  updateStatusIconFor(lastStatus, input.value);
                  updateCurrentCellPresentation();
                  updateCurrentRowAverages();
                  input.setAttribute('aria-invalid', 'false');
                  errorEl.textContent = message;
                  errorEl.style.display = 'block';
                  lastSavedSignature = scoreChangeSignature(input.value, statusSelect.value);
                }

                function validateCurrentGradesheetScore(newRaw, newStatus, statusError) {
                  if (isAcceptableScoreEditorDraft(newRaw, newStatus)) return true;
                  input.classList.add("gradesheet-input-invalid");
                  input.title = 'Ungültiger Wert für dieses Bewertungsschema';
                  input.setAttribute('aria-invalid', 'true');
                  errorEl.textContent = invalidScoreMessage(statusError);
                  errorEl.style.display = 'block';
                  return false;
                }

                function saveCurrentGradesheetEditor() {
                  if (pendingSavePromise) {
                    const requestedSignature = scoreChangeSignature(input.value, statusSelect.value);
                    return pendingSavePromise.then(function (saved) {
                      const requestIsStillCurrent = scoreChangeSignature(input.value, statusSelect.value) === requestedSignature;
                      return saved || requestIsStillCurrent ? saveCurrentGradesheetEditor() : false;
                    });
                  }
                  const newRaw = String(input.value || "").trim();
                  const currentStatus = statusSelect.value;
                  const signature = scoreChangeSignature(newRaw, currentStatus);
                  if (!validateCurrentGradesheetScore(newRaw, currentStatus, false)) return false;
                  if (signature === lastSavedSignature) {
                    input.classList.remove("gradesheet-input-invalid");
                    input.title = '';
                    input.setAttribute('aria-invalid', 'false');
                    errorEl.textContent = '';
                    errorEl.style.display = 'none';
                    return true;
                  }
                  const isLatestInteraction = beginScoreInteraction();
                  const operation = (async function () {
                    try {
                      await persistCurrentGradesheetScore(newRaw, currentStatus);
                      lastSavedSignature = signature;
                      if (!isLatestInteraction() ||
                          scoreChangeSignature(input.value, statusSelect.value) !== signature) return true;
                      input.classList.remove("gradesheet-input-invalid");
                      input.title = '';
                      input.setAttribute('aria-invalid', 'false');
                      errorEl.textContent = '';
                      errorEl.style.display = 'none';
                      lastStatus = currentStatus;
                      updateStatusIconFor(currentStatus, input.value);
                      updateCurrentCellPresentation();
                      updateCurrentRowAverages();
                      return true;
                    } catch (error) {
                      if (!isLatestInteraction() ||
                          scoreChangeSignature(input.value, statusSelect.value) !== signature) return false;
                      restoreCellAfterSaveFailure('Speichern fehlgeschlagen. Die vorherige Eingabe bleibt erhalten.');
                      failedSaveBlocksNextFinish = true;
                      return false;
                    } finally {
                      if (pendingSavePromise === operation) {
                        pendingSavePromise = null;
                      }
                    }
                  })();
                  pendingSavePromise = operation;
                  return operation;
                }

                function finishCurrentGradesheetEditor() {
                  if (failedSaveBlocksNextFinish) {
                    failedSaveBlocksNextFinish = false;
                    return false;
                  }
                  const result = saveCurrentGradesheetEditor();
                  if (!result || typeof result.then !== 'function') return result;
                  return result.then(function (saved) {
                    if (!saved) {
                      failedSaveBlocksNextFinish = false;
                      return false;
                    }
                    return finishCurrentGradesheetEditor();
                  });
                }

                function currentGradesheetEditorIsClean() {
                  if (pendingSavePromise || failedSaveBlocksNextFinish) return false;
                  const newRaw = String(input.value || '').trim();
                  const currentStatus = statusSelect.value;
                  if (!isAcceptableScoreEditorDraft(newRaw, currentStatus)) return false;
                  return scoreChangeSignature(newRaw, currentStatus) === lastSavedSignature;
                }

                registerGradesheetEditor({
                  finish: finishCurrentGradesheetEditor,
                  isClean: currentGradesheetEditorIsClean,
                  focus: function () { input.focus(); }
                });

                // ------------------------------------------------------
                // FEATURE: Schnelleingabe-Modus - Excel-ähnliche Tastaturnavigation
                // Kombinierter Event-Handler für Enter, Tab und Pfeiltasten
                // WICHTIG: Mit capture-Phase (true), damit der Handler VOR den Browser-Standardaktionen ausgeführt wird
                // Dies ermöglicht Navigation durch die Notenerfassungstabelle mit:
                // - Enter/Tab: Nächste Zelle rechts, am Zeilenende zur nächsten Zeile
                // - Pfeiltasten: Hoch/Runter in derselben Spalte
                // - Automatische Validierung und Speicherung bei Enter/Tab
                // ------------------------------------------------------
                input.addEventListener("keydown", async function (e) {
                  if (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const allInputsNav = Array.from(document.querySelectorAll('.gradesheet-input'));
                    const targetInput = findNextGradesheetInput(allInputsNav, input, e.key);
                    let shouldSave = false;

                    if (e.key === "Enter") {
                      shouldSave = true;
                    } else if (e.key === "Tab") {
                      shouldSave = true;
                    }

                    // Wenn wir speichern sollen (Enter/Tab), validiere und speichere
                    if (shouldSave) {
                      const saved = await saveCurrentGradesheetEditor();
                      if (!saved) return false;
                      suppressedChangeSignature = scoreChangeSignature(input.value, statusSelect.value);
                    }

                    // Springe zum Zielfeld (wenn es existiert) - mit setTimeout um sicherzustellen dass der Event vollständig verarbeitet ist
                    if (targetInput) {
                      // Kleines Timeout um sicherzustellen dass kein anderer Event-Handler dazwischen funkt
                      setTimeout(function() {
                        targetInput.focus();
                        targetInput.select();
                      }, 0);
                    }

                    return false;
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    // Verlasse Eingabe ohne Speichern - setze auf ursprünglichen Wert zurück
                    const entry = asm.scores ? asm.scores[stu.id] : undefined;
                    const originalValue = entry && entry.valueRaw != null ? String(entry.valueRaw) : "";
                    input.value = originalValue;
                    input.blur();
                  }
                }, true); // Capture-Phase: Handler wird VOR anderen Event-Listenern ausgeführt

                input.addEventListener("change", async function () {
                  const newRaw = String(this.value || "").trim();
                  const currentStatus = statusSelect.value;
                  const changeSignature = scoreChangeSignature(newRaw, currentStatus);
                  if (suppressedChangeSignature === changeSignature) {
                    suppressedChangeSignature = null;
                    return;
                  }
                  suppressedChangeSignature = null;
                  await saveCurrentGradesheetEditor();
                });

                statusSelect.addEventListener("change", async function () {
                  const newVal = this.value;
                  // Beim Umschalten auf 'gültig' prüfen wir die Eingabe
                  if (newVal === DomainModel.SCORE_STATUS.VALID) {
                    if (!validateCurrentGradesheetScore(String(input.value || "").trim(), newVal, true)) {
                      this.value = lastStatus;
                      return;
                    }
                  }
                  await saveCurrentGradesheetEditor();
                });

                // Initial Icon setzen
                updateStatusIconFor(status, rawValue);

                // Füge Input + Error in den Wrapper ein und hänge an die Zelle
                inputWrap.appendChild(input);
                inputWrap.appendChild(errorEl);
                cellWrapper.appendChild(inputWrap);
                cellWrapper.appendChild(entryState);
                // Deutlicher Hinweis: kleines Label vor der Status-Auswahl
                const statusControl = document.createElement('div');
                statusControl.className = 'gradesheet-status-control';
                const statusLabel = document.createElement('span');
                statusLabel.textContent = 'Status:';
                statusLabel.className = 'text-muted';
                statusLabel.style.fontSize = '0.75rem';
                statusLabel.style.flex = '0 0 auto';
                statusControl.appendChild(statusLabel);
                statusControl.appendChild(statusIcon);
                statusControl.appendChild(statusSelect);
                cellWrapper.appendChild(statusControl);
                td.appendChild(cellWrapper);
                tr.appendChild(td);
              }
            }

            // Kategoriedurchschnitte (aktuell / vorher falls vorhanden)
            const hasPrevCells = !!prevTermLocal;
            for (const g of mainGroups) {
              if (hasPrevCells) {
                // Aktuelles Halbjahr
                const tdCurr = document.createElement('td');
                tdCurr.className = 'gradesheet-avg gradesheet-summary-column term-current gradesheet-summary-current';
                const currAss = assessmentsAll.filter(a => a.categoryId === g.category.id && getTermValue(a, null) === currentTermLocal);
                const catCurr = GradingLogic.computeCategoryAverage(currAss, course, stu.id, g.category.id, state.settings);
                if (catCurr === null || !Number.isFinite(catCurr)) {
                  tdCurr.textContent = '–'; tdCurr.classList.add('text-muted');
                } else { tdCurr.textContent = formatLegacyFixed(catCurr, 2); let bg = getBackgroundForValue(course, catCurr); if (isPoorValue(course, catCurr)) bg = 'var(--grade-bg-critical)'; if (bg) { tdCurr.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) tdCurr.style.color = '#050505'; } }
                tr.appendChild(tdCurr);

                // Vorheriges Halbjahr
                const tdPrev = document.createElement('td');
                tdPrev.className = 'gradesheet-avg gradesheet-summary-column term-prev prev-term gradesheet-summary-previous';
                const prevAss = assessmentsAll.filter(a => a.categoryId === g.category.id && getTermValue(a, null) === prevTermLocal);
                const catPrev = GradingLogic.computeCategoryAverage(prevAss, course, stu.id, g.category.id, state.settings);
                if (catPrev === null || !Number.isFinite(catPrev)) { tdPrev.textContent = '–'; tdPrev.classList.add('text-muted'); } else { tdPrev.textContent = formatLegacyFixed(catPrev, 2); let bgp = getBackgroundForValue(course, catPrev); if (isPoorValue(course, catPrev)) bgp = 'var(--grade-bg-critical)'; if (bgp) { tdPrev.style.backgroundColor = bgp; if (document.body.classList.contains('theme-dark')) tdPrev.style.color = '#050505'; } }
                tr.appendChild(tdPrev);

              } else {
                const tdAvg = document.createElement("td");
                tdAvg.className = "gradesheet-avg gradesheet-summary-column"; // Klasse für späteres Finden
                const catAvg = GradingLogic.computeCategoryAverage(
                  assessmentsAll,
                  course,
                  stu.id,
                  g.category.id,
                  state.settings
                );
                if (catAvg === null || !Number.isFinite(catAvg)) {
                  tdAvg.textContent = "–";
                  tdAvg.classList.add("text-muted");
                } else {
                  tdAvg.textContent = formatLegacyFixed(catAvg, 2);
                  let bg = getBackgroundForValue(course, catAvg);
                  if (isPoorValue(course, catAvg)) bg = "var(--grade-bg-critical)";
                  if (bg) {
                    tdAvg.style.backgroundColor = bg;
                    if (document.body.classList.contains("theme-dark")) {
                      tdAvg.style.color = "#050505";
                    }
                  }
                }
                tr.appendChild(tdAvg);
              }
            }

            // Gesamtdurchschnitte
            if (hasPrevCells) {
              // Aktuell
              const tdTotalCurr = document.createElement('td');
              tdTotalCurr.className = 'gradesheet-avg gradesheet-summary-column term-current gradesheet-summary-current';
              const currentAssessments = assessmentsAll.filter(
                assessment => getTermValue(assessment, null) === currentTermLocal
              );
              const overallCurr = renderWeightedOverallCell(
                tdTotalCurr,
                currentAssessments,
                course,
                stu.id,
                state.settings,
                currentTermLocal
              );
              if (overallCurr === null || !Number.isFinite(overallCurr)) { tdTotalCurr.textContent = '–'; tdTotalCurr.classList.add('text-muted'); }
              else { tdTotalCurr.textContent = formatLegacyFixed(overallCurr, 2); let bg = getBackgroundForValue(course, overallCurr); if (isPoorValue(course, overallCurr)) bg = 'var(--grade-bg-critical)'; if (bg) { tdTotalCurr.style.backgroundColor = bg; if (document.body.classList.contains('theme-dark')) tdTotalCurr.style.color = '#050505'; } }
              tr.appendChild(tdTotalCurr);
              if (isUpperSecGradesheet && currentTermLocal) {
                appendTermResultEditor(
                  tr,
                  stu,
                  currentTermLocal,
                  'gradesheet-summary-current',
                  formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal)
                );
              }

              // Vorjahr
              const tdTotalPrev = document.createElement('td');
              tdTotalPrev.className = 'gradesheet-avg gradesheet-summary-column term-prev prev-term gradesheet-summary-previous';
              // Für prev-Cell möchten wir nur Vorjahr berücksichtigen: berechne Gesamt über prev-Term-only
              const previousAssessments = assessmentsAll.filter(
                assessment => getTermValue(assessment, null) === prevTermLocal
              );
              const overallPrev = renderWeightedOverallCell(
                tdTotalPrev,
                previousAssessments,
                course,
                stu.id,
                state.settings,
                prevTermLocal
              );
              if (overallPrev !== null) { let bgp = getBackgroundForValue(course, overallPrev); if (isPoorValue(course, overallPrev)) bgp = 'var(--grade-bg-critical)'; if (bgp) { tdTotalPrev.style.backgroundColor = bgp; if (document.body.classList.contains('theme-dark')) tdTotalPrev.style.color = '#050505'; } }
              tr.appendChild(tdTotalPrev);
              if (isUpperSecGradesheet && prevTermLocal) {
                appendTermResultEditor(
                  tr,
                  stu,
                  prevTermLocal,
                  'gradesheet-summary-previous',
                  formatTermLabel(prevTermLocal, course.schemaMode, currentTermLocal)
                );
              }

              // Gesamt (gesamt)
              const tdTotalAll = document.createElement('td');
              tdTotalAll.className = 'gradesheet-avg gradesheet-summary-column gradesheet-summary-year';
              const overallAll = GradingLogic.computeOverallGrade(course, stu.id, state, currentTermLocal);
              if (overallAll === null || !Number.isFinite(overallAll)) { tdTotalAll.textContent = '–'; tdTotalAll.classList.add('text-muted'); }
              else { tdTotalAll.textContent = formatLegacyFixed(overallAll, 2); let bga = getBackgroundForValue(course, overallAll); if (isPoorValue(course, overallAll)) bga = 'var(--grade-bg-critical)'; if (bga) { tdTotalAll.style.backgroundColor = bga; if (document.body.classList.contains('theme-dark')) tdTotalAll.style.color = '#050505'; } }
              tr.appendChild(tdTotalAll);

            } else {
              const tdTotal = document.createElement("td");
              tdTotal.className = "gradesheet-avg gradesheet-summary-column"; // Klasse für späteres Finden
              const overall = GradingLogic.computeOverallGrade(course, stu.id, state);
              if (overall === null || !Number.isFinite(overall)) {
                tdTotal.textContent = "–";
                tdTotal.classList.add("text-muted");
              } else {
                  tdTotal.textContent = formatLegacyFixed(overall, 2);
                let bg = getBackgroundForValue(course, overall);
                if (isPoorValue(course, overall)) bg = "var(--grade-bg-critical)";
                if (bg) {
                  tdTotal.style.backgroundColor = bg;
                  if (document.body.classList.contains("theme-dark")) {
                    tdTotal.style.color = "#050505";
                  }
                }
              }
              tr.appendChild(tdTotal);
              if (isUpperSecGradesheet && currentTermLocal) {
                appendTermResultEditor(
                  tr,
                  stu,
                  currentTermLocal,
                  '',
                  formatTermLabel(currentTermLocal, course.schemaMode, currentTermLocal)
                );
              }
            }

            // Tendenz-Zelle
            const tdTrend = document.createElement("td");
            tdTrend.className = 'gradesheet-trend';
            tdTrend.style.textAlign = "center";
            tdTrend.style.fontSize = "1.3rem";
            updateTrendCell(tdTrend, stu.id);
            tr.appendChild(tdTrend);

            tbody.appendChild(tr);
          }

          table.appendChild(tbody);
          applyStudentSearch(appliedStudentSearch);

          // Wrapper für horizontales Scrollen
          const tableWrapper = document.createElement("div");
          tableWrapper.className = "gradesheet-table-wrapper";
          tableWrapper.appendChild(table);

          section.appendChild(tableWrapper);

          const assessmentsNext = (assessmentsAll || []).filter(
            assessment => getTermValue(assessment, null) === nextTermLocal
          );
          if (nextTermLocal && assessmentsNext.length > 0) {
            section.appendChild(renderTermSection(
              formatTermLabel(nextTermLocal, course.schemaMode, currentTermLocal) || 'nächst.',
              assessmentsNext,
              false,
              nextTermLocal,
              studentRows,
              false
            ));
          }

          // Wenn includePrevTermGrades aktiv: Archiv-Tabelle für vorheriges Halbjahr unter der Haupttabelle
          if (showPrevTermAverages && prevTermLocal) {
            const assessmentsPrev = (assessmentsAll || []).filter(a => getTermValue(a, null) === prevTermLocal);
            if (assessmentsPrev.length > 0) {
              section.appendChild(renderTermSection(
                formatTermLabel(prevTermLocal, course.schemaMode, currentTermLocal) || 'vorj.',
                assessmentsPrev,
                true,
                prevTermLocal
              ));
            }
          }

          section.appendChild(tableHelp);
          container.appendChild(section);
        }

        // =========================================================
        // FEATURE: Notenverteilungsdiagramm mit hierarchischer Ansicht
        // Zeigt Statistiken auf drei Ebenen:
        // 1. Klassen-Ebene (📚): Gruppierung aller Kurse nach Klasse
        // 2. Kurs-Ebene (📖): Gesamtstatistik und Notenverteilung pro Kurs
        // 3. Leistungs-Ebene (📝): Statistik für einzelne Tests/Klausuren
        // Alle Ebenen sind ein-/ausklappbar für bessere Übersicht
        // =========================================================
        function getOverallMetricLabel(schemaMode, kind) {
          const upperSec = schemaMode === 'uppersec' ||
            (typeof DomainModel !== 'undefined' && schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC);
          const labels = upperSec
            ? { mean: 'Mittelwert (Rechenwerte)', median: 'Median (Rechenwerte)',
                distribution: 'Verteilung Rechenwerte', combined: 'Rechenwert inkl. Vorhalbjahr',
                value: 'Rechenwert', plural: 'Rechenwerte' }
            : { mean: 'Mittelwert (Gesamtnoten)', median: 'Median (Gesamtnoten)',
                distribution: 'Verteilung Gesamtnoten', combined: 'Gesamtnote inkl. Vorhalbjahr',
                value: 'Gesamtnote', plural: 'Gesamtnoten' };
          return labels[kind] || (upperSec ? 'Rechenwert' : 'Gesamtnote');
        }

        function renderStatsSection(container) {
          const activeCourses = DomainModel.listActiveCourses(state);
          let activeTabId = "overview";
          let detailCourseId = activeCourses.some(function (course) {
            return course.id === currentCourseId;
          }) ? currentCourseId : (activeCourses[0] ? activeCourses[0].id : null);

          const section = document.createElement("section");
          section.className = "section stats-section";

          const h2 = document.createElement("h2");
          h2.textContent = "Statistik";
          section.appendChild(h2);

          const hint = document.createElement("div");
          hint.className = "section-hint stats-intro";
          hint.textContent =
            "Auswertung der nach den aktuellen Kursregeln berechenbaren Bewertungen. Fehlende oder ungültige Werte werden nicht mitgezählt.";
          section.appendChild(hint);

          function schemaLabel(course) {
            return course.schemaMode === DomainModel.SCHEMA_MODES.GRADES
              ? "Noten (1–6)"
              : "Punkte (0–15)";
          }

          function metricValue(value) {
            return value !== null && Number.isFinite(value)
              ? (formatLegacyFixed(value, 2) ?? String(value))
              : "–";
          }

          function scopeLabel(course) {
            const scope = GradingLogic.resolveGradingResultScope(course, state);
            const terms = Array.from(scope.includedTerms || []).sort();
            const labels = terms.map(function (term) {
              return GradingLogic.formatCourseTermLabel(term, course, scope.settings) || term;
            }).filter(Boolean);
            if (course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC) {
              return labels.length > 0
                ? "Berechnungsumfang der Rechenwerte: " + labels[labels.length - 1] + " (ein Kurshalbjahr)."
                : "Berechnungsumfang der Rechenwerte: aktuelles Kurshalbjahr gemäß Kursregeln.";
            }
            if (labels.length > 1) {
              return "Berechnungsumfang: " + labels.join(" und ") + " (laufendes Schuljahr).";
            }
            return labels.length === 1
              ? "Berechnungsumfang: " + labels[0] + " (ein Halbjahr)."
              : "Berechnungsumfang: aktuelles Halbjahr gemäß Kursregeln.";
          }

          function createDistributionChart(distribution, totalCount, schemaMode, label, sortedContributions) {
            const maxCount = Math.max.apply(null, distribution.map(function (bucket) {
              return bucket.count;
            }).concat([1]));
            const contributions = Array.isArray(sortedContributions) ? sortedContributions : [];
            const bandLabels = {
              best: 'sehr gut',
              good: 'gut',
              middle: 'befriedigend',
              notice: 'ausreichend',
              critical: 'kritisch',
              neutral: 'neutral'
            };
            let contributionIndex = 0;
            const chart = document.createElement("div");
            chart.className = "stats-distribution";
            chart.setAttribute("role", "list");
            chart.setAttribute("aria-label", label);

            for (const bucket of distribution) {
              const bucketContributions = contributions.slice(
                contributionIndex, contributionIndex + bucket.count
              );
              contributionIndex += bucket.count;
              if (bucket.count === 0) continue;
              const row = document.createElement("div");
              row.className = "stats-distribution-row";
              row.setAttribute("role", "listitem");

              const bucketLabel = document.createElement("span");
              bucketLabel.className = "stats-distribution-label";
              bucketLabel.textContent = bucket.label;
              row.appendChild(bucketLabel);

              const track = document.createElement("span");
              track.className = "stats-distribution-track";
              track.setAttribute("aria-hidden", "true");
              const bar = document.createElement("span");
              bar.className = "stats-distribution-bar";
              bar.style.width = (bucket.count / maxCount * 100) + "%";
              const bandCounts = new Map();
              for (const contribution of bucketContributions) {
                const value = contribution && typeof contribution === 'object'
                  ? contribution.value
                  : contribution;
                const rawString = contribution && typeof contribution === 'object'
                  ? contribution.rawString
                  : null;
                const band = resolveGradeColorBand(schemaMode, value, rawString) || 'neutral';
                bandCounts.set(band, (bandCounts.get(band) || 0) + 1);
              }
              if (bucketContributions.length < bucket.count) {
                bandCounts.set('neutral', (bandCounts.get('neutral') || 0) +
                  bucket.count - bucketContributions.length);
              }
              for (const [band, bandCount] of bandCounts) {
                const segment = document.createElement("span");
                segment.className = "stats-distribution-segment stats-distribution-bar--" + band;
                segment.style.width = (bandCount / bucket.count * 100) + "%";
                bar.appendChild(segment);
              }
              track.appendChild(bar);
              row.appendChild(track);

              const count = document.createElement("span");
              count.className = "stats-distribution-count";
              const percentValue = totalCount > 0 ? bucket.count / totalCount * 100 : 0;
              count.textContent = bucket.count + " (" +
                (formatLegacyFixed(percentValue, 1) ?? String(percentValue)) + " %)";
              const bandSummary = Array.from(bandCounts).map(function (entry) {
                return bandLabels[entry[0]] + ': ' + entry[1];
              }).join(', ');
              count.setAttribute('aria-label', bucket.label + ': ' + count.textContent +
                '. Enthaltene Notenbereiche: ' + bandSummary + '.');
              count.title = 'Enthaltene Notenbereiche: ' + bandSummary;
              row.appendChild(count);
              chart.appendChild(row);
            }
            return chart;
          }

          const tabs = document.createElement("div");
          tabs.className = "stats-tabs";
          tabs.setAttribute("role", "tablist");
          tabs.setAttribute("aria-label", "Statistikansichten");
          section.appendChild(tabs);

          const panels = document.createElement("div");
          panels.className = "stats-panels";
          section.appendChild(panels);

          const tabDefinitions = [
            { id: "overview", label: "Kursübersicht" },
            { id: "critical", label: "Kritische Bewertungen" },
            { id: "details", label: "Kursdetails" }
          ];
          const tabButtons = new Map();
          const panelElements = new Map();

          for (const definition of tabDefinitions) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "stats-tab";
            button.id = "stats-tab-" + definition.id;
            button.textContent = definition.label;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-controls", "stats-panel-" + definition.id);
            tabs.appendChild(button);
            tabButtons.set(definition.id, button);

            const panel = document.createElement("div");
            panel.className = "stats-panel";
            panel.id = "stats-panel-" + definition.id;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", button.id);
            panels.appendChild(panel);
            panelElements.set(definition.id, panel);
          }

          function activateTab(tabId, focusTab) {
            if (!tabButtons.has(tabId)) return;
            activeTabId = tabId;
            for (const definition of tabDefinitions) {
              const selected = definition.id === activeTabId;
              const button = tabButtons.get(definition.id);
              const panel = panelElements.get(definition.id);
              button.setAttribute("aria-selected", selected ? "true" : "false");
              button.tabIndex = selected ? 0 : -1;
              button.classList.toggle("stats-tab--active", selected);
              panel.hidden = !selected;
              panel.classList.toggle("hidden", !selected);
            }
            if (focusTab) tabButtons.get(activeTabId).focus();
          }

          tabDefinitions.forEach(function (definition, index) {
            const button = tabButtons.get(definition.id);
            button.addEventListener("click", function () {
              activateTab(definition.id, false);
            });
            button.addEventListener("keydown", function (event) {
              let nextIndex = null;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % tabDefinitions.length;
              if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabDefinitions.length) % tabDefinitions.length;
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = tabDefinitions.length - 1;
              if (nextIndex === null) return;
              event.preventDefault();
              activateTab(tabDefinitions[nextIndex].id, true);
            });
          });

          function appendEmptyState(panel, text) {
            const empty = document.createElement("p");
            empty.className = "stats-empty text-muted";
            empty.textContent = text;
            panel.appendChild(empty);
          }

          function renderOverview() {
            const panel = panelElements.get("overview");
            if (activeCourses.length === 0) {
              appendEmptyState(panel, "Keine aktiven Kurse vorhanden. Lege zuerst einen Kurs an.");
              return;
            }

            const wrapper = document.createElement("div");
            wrapper.className = "stats-table-wrap";
            const table = document.createElement("table");
            table.className = "data-table stats-table";
            const thead = document.createElement("thead");
            const header = document.createElement("tr");
            ["Kurs", "Klasse", "Schema", "Berechenbar", "Mittelwert", "Median", "Aktion"].forEach(function (label) {
              const th = document.createElement("th");
              th.textContent = label;
              header.appendChild(th);
            });
            thead.appendChild(header);
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            for (const course of activeCourses) {
              const statistics = GradingLogic.computeCourseStatistics(course, state);
              const row = document.createElement("tr");
              row.setAttribute("data-stats-course-id", course.id);

              const values = [
                course.name || course.subject || "Unbenannter Kurs",
                course.classLabel || "Keine Klasse",
                schemaLabel(course),
                String(statistics.count),
                metricValue(statistics.mean),
                metricValue(statistics.median)
              ];
              values.forEach(function (value, cellIndex) {
                const td = document.createElement("td");
                td.textContent = value;
                if (cellIndex === 0) td.className = "stats-course-name";
                row.appendChild(td);
              });

              const actionCell = document.createElement("td");
              const action = document.createElement("button");
              action.type = "button";
              action.className = "btn-secondary stats-detail-action";
              action.textContent = "Details ansehen";
              action.addEventListener("click", function () {
                detailCourseId = course.id;
                const detailSelector = renderDetails();
                activateTab("details", false);
                if (detailSelector) detailSelector.focus();
              });
              actionCell.appendChild(action);
              row.appendChild(actionCell);
              tbody.appendChild(row);
            }
            table.appendChild(tbody);
            wrapper.appendChild(table);
            panel.appendChild(wrapper);
          }

          function collectCriticalValues() {
            const groups = [];
            let computableCount = 0;
            for (const course of activeCourses) {
              const students = [];
              const enrollments = DomainModel.listEnrollmentsForCourse(state, course.id);
              for (const enrollment of enrollments) {
                const student = DomainModel.findStudentById(state, enrollment.studentId);
                if (!student) continue;
                const overall = GradingLogic.computeOverallGrade(course, student.id, state);
                if (overall === null || !Number.isFinite(overall)) continue;
                computableCount += 1;
                const critical = course.schemaMode === DomainModel.SCHEMA_MODES.GRADES
                  ? overall >= 4.25
                  : overall <= 4;
                if (critical) students.push({ student: student, overall: overall });
              }
              if (students.length === 0) continue;
              students.sort(course.schemaMode === DomainModel.SCHEMA_MODES.GRADES
                ? function (a, b) { return b.overall - a.overall; }
                : function (a, b) { return a.overall - b.overall; });
              groups.push({ course: course, students: students });
            }
            return { groups: groups, computableCount: computableCount };
          }

          function renderCritical() {
            const panel = panelElements.get("critical");
            const explanation = document.createElement("p");
            explanation.className = "stats-critical-explanation";
            explanation.textContent =
              "Unveränderte Schwellen: Sek I: ab 4.25; Sek II: bis 4 Punkte. Fehlende oder ungültige Bewertungen werden nicht eingestuft.";
            panel.appendChild(explanation);

            const result = collectCriticalValues();
            if (result.computableCount === 0) {
              appendEmptyState(
                panel,
                "Keine berechenbaren Werte vorhanden. Fehlende Bewertungen werden nicht als unkritisch gewertet."
              );
              return;
            }
            if (result.groups.length === 0) {
              appendEmptyState(
                panel,
                "Keine kritischen Bewertungen unter den " + result.computableCount + " berechenbaren Werten."
              );
              return;
            }

            let total = 0;
            result.groups.forEach(function (group) { total += group.students.length; });
            const summary = document.createElement("p");
            summary.className = "stats-critical-summary";
            summary.textContent = total + " kritische Bewertung" + (total === 1 ? "" : "en") +
              " in " + result.groups.length + " Kurs" + (result.groups.length === 1 ? "" : "en") + ".";
            panel.appendChild(summary);

            for (const data of result.groups) {
              const groupSection = document.createElement("section");
              groupSection.className = "stats-critical-group";
              const title = document.createElement("h3");
              title.textContent = (data.course.name || data.course.subject || "Unbenannter Kurs") +
                " · " + (data.course.classLabel || "Keine Klasse");
              groupSection.appendChild(title);
              const schema = document.createElement("p");
              schema.className = "stats-course-meta text-muted";
              schema.textContent = "Schema: " + schemaLabel(data.course);
              groupSection.appendChild(schema);

              const wrapper = document.createElement("div");
              wrapper.className = "stats-table-wrap";
              const table = document.createElement("table");
              table.className = "data-table stats-table stats-critical-table";
              const atRiskThead = document.createElement("thead");
              const header = document.createElement("tr");
              ["Schüler", "Klasse", getOverallMetricLabel(data.course.schemaMode, "value")].forEach(function (label) {
                const th = document.createElement("th");
                th.textContent = label;
                header.appendChild(th);
              });
              atRiskThead.appendChild(header);
              table.appendChild(atRiskThead);
              const atRiskTbody = document.createElement("tbody");
              for (const item of data.students) {
                const row = document.createElement("tr");
                row.className = "stats-critical-row";
                [
                  (item.student.lastName || "") + ", " + (item.student.firstName || ""),
                  item.student.homeClass || "–",
                  metricValue(item.overall)
                ].forEach(function (value) {
                  const td = document.createElement("td");
                  td.textContent = value;
                  row.appendChild(td);
                });
                atRiskTbody.appendChild(row);
              }
              table.appendChild(atRiskTbody);
              wrapper.appendChild(table);
              groupSection.appendChild(wrapper);
              panel.appendChild(groupSection);
            }
          }

          function assessmentDistribution(values, course) {
            const distribution = [];
            if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
              [
                { label: "1", range: [0, 1.5] },
                { label: "2", range: [1.5, 2.5] },
                { label: "3", range: [2.5, 3.5] },
                { label: "4", range: [3.5, 4.5] },
                { label: "5", range: [4.5, 5.5] },
                { label: "6", range: [5.5, 7] }
              ].forEach(function (bucket) {
                distribution.push({
                  label: bucket.label,
                  count: values.filter(function (value) {
                    return value >= bucket.range[0] && value < bucket.range[1];
                  }).length
                });
              });
            } else {
              for (let points = 0; points <= 15; points++) {
                distribution.push({
                  label: String(points),
                  count: values.filter(function (value) {
                    return Math.round(value) === points;
                  }).length
                });
              }
            }
            return distribution;
          }

          function renderAssessment(panel, course, assessment, assessmentIndex) {
            const box = document.createElement("div");
            box.className = "stats-assessment";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "stats-assessment-toggle";
            button.textContent = (assessment.title || "Leistung") +
              (assessment.date ? " · " + assessment.date : "");
            const contentId = "stats-assessment-" + activeCourses.indexOf(course) + "-" + assessmentIndex;
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-controls", contentId);
            box.appendChild(button);

            const content = document.createElement("div");
            content.className = "stats-assessment-content hidden";
            content.id = contentId;
            content.hidden = true;

            const contributions = [];
            const settings = GradingLogic.getSettingsForCourse(course, state);
            const enrollments = DomainModel.listEnrollmentsForCourse(state, course.id);
            for (const enrollment of enrollments) {
              const entry = assessment.scores ? assessment.scores[enrollment.studentId] : undefined;
              const value = GradingLogic.getNumericScoreForEntry(entry, course, settings);
              if (value !== null && Number.isFinite(value)) {
                contributions.push({
                  value: value,
                  rawString: entry && entry.valueRaw != null ? String(entry.valueRaw) : null
                });
              }
            }
            contributions.sort(function (a, b) { return a.value - b.value; });
            const values = contributions.map(function (contribution) { return contribution.value; });

            if (values.length === 0) {
              appendEmptyState(content, "Keine gültigen Bewertungen für diese Leistung.");
            } else {
              const mean = values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
              const median = values.length % 2 === 0
                ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
                : values[Math.floor(values.length / 2)];
              const metrics = document.createElement("div");
              metrics.className = "stats-assessment-metrics";
              metrics.textContent = "Anzahl: " + values.length +
                " · Mittelwert: " + metricValue(mean) +
                " · Median: " + metricValue(median);
              content.appendChild(metrics);
              content.appendChild(createDistributionChart(
                assessmentDistribution(values, course),
                values.length,
                course.schemaMode,
                "Verteilung " + (assessment.title || "Leistung"),
                contributions
              ));
            }

            button.addEventListener("click", function () {
              const expanded = button.getAttribute("aria-expanded") !== "true";
              button.setAttribute("aria-expanded", expanded ? "true" : "false");
              content.hidden = !expanded;
              content.classList.toggle("hidden", !expanded);
            });

            box.appendChild(content);
            panel.appendChild(box);
          }

          function renderDetails() {
            const panel = panelElements.get("details");
            panel.replaceChildren();
            if (activeCourses.length === 0) {
              appendEmptyState(panel, "Keine aktiven Kurse für Kursdetails vorhanden.");
              return null;
            }
            let course = activeCourses.find(function (candidate) {
              return candidate.id === detailCourseId;
            });
            if (!course) {
              course = activeCourses[0];
              detailCourseId = course.id;
            }

            const selectorRow = document.createElement("div");
            selectorRow.className = "stats-detail-selector";
            const label = document.createElement("label");
            label.setAttribute("for", "stats-detail-course");
            label.textContent = "Kurs für Details";
            selectorRow.appendChild(label);
            const select = document.createElement("select");
            select.id = "stats-detail-course";
            for (const candidate of activeCourses) {
              const option = document.createElement("option");
              option.value = candidate.id;
              option.textContent = (candidate.name || candidate.subject || "Unbenannter Kurs") +
                " · " + (candidate.classLabel || "Keine Klasse");
              select.appendChild(option);
            }
            select.value = course.id;
            select.addEventListener("change", function () {
              if (!activeCourses.some(function (candidate) { return candidate.id === select.value; })) return;
              detailCourseId = select.value;
              const replacementSelector = renderDetails();
              if (replacementSelector) replacementSelector.focus();
            });
            selectorRow.appendChild(select);
            panel.appendChild(selectorRow);

            const identity = document.createElement("div");
            identity.className = "stats-course-detail";
            const title = document.createElement("h3");
            title.textContent = (course.name || course.subject || "Unbenannter Kurs") +
              " · " + (course.classLabel || "Keine Klasse");
            identity.appendChild(title);
            const meta = document.createElement("p");
            meta.className = "stats-course-meta text-muted";
            meta.textContent = "Schema: " + schemaLabel(course) + ". " + scopeLabel(course);
            identity.appendChild(meta);

            const statistics = GradingLogic.computeCourseStatistics(course, state);
            const metrics = document.createElement("dl");
            metrics.className = "stats-metrics";
            [
              ["Berechenbare Bewertungen", String(statistics.count)],
              [getOverallMetricLabel(course.schemaMode, "mean"), metricValue(statistics.mean)],
              [getOverallMetricLabel(course.schemaMode, "median"), metricValue(statistics.median)]
            ].forEach(function (entry) {
              const item = document.createElement("div");
              item.className = "stats-metric";
              const term = document.createElement("dt");
              term.textContent = entry[0];
              const value = document.createElement("dd");
              value.textContent = entry[1];
              item.appendChild(term);
              item.appendChild(value);
              metrics.appendChild(item);
            });
            identity.appendChild(metrics);

            const distributionColorNote = document.createElement("p");
            distributionColorNote.className = "stats-distribution-color-note text-muted";
            distributionColorNote.textContent =
              "Farben innerhalb eines Balkens zeigen die enthaltenen Notenbereiche.";
            identity.appendChild(distributionColorNote);

            if (statistics.count > 0) {
              const distributionTitle = document.createElement("h4");
              distributionTitle.textContent = getOverallMetricLabel(course.schemaMode, "distribution");
              identity.appendChild(distributionTitle);
              identity.appendChild(createDistributionChart(
                statistics.distribution,
                statistics.count,
                course.schemaMode,
                getOverallMetricLabel(course.schemaMode, "distribution"),
                statistics.values
              ));
            } else {
              appendEmptyState(identity, "Für diesen Kurs sind keine berechenbaren Bewertungen vorhanden.");
            }
            panel.appendChild(identity);

            const assessmentsTitle = document.createElement("h3");
            assessmentsTitle.className = "stats-assessments-title";
            assessmentsTitle.textContent = "Einzelne Leistungen";
            panel.appendChild(assessmentsTitle);
            const assessmentHint = document.createElement("p");
            assessmentHint.className = "stats-course-meta text-muted";
            assessmentHint.textContent =
              "Alle im Kurs gespeicherten Leistungen; die Kurskennzahlen folgen dem oben genannten Berechnungsumfang.";
            panel.appendChild(assessmentHint);
            const assessments = DomainModel.listAssessmentsForCourse(state, course.id);
            if (assessments.length === 0) {
              appendEmptyState(panel, "Für diesen Kurs sind keine Leistungen vorhanden.");
              return select;
            }
            assessments.forEach(function (assessment, assessmentIndex) {
              renderAssessment(panel, course, assessment, assessmentIndex);
            });
            return select;
          }

          renderOverview();
          renderCritical();
          renderDetails();
          activateTab(activeTabId, false);

          runWhenDebugModeEnabled(function () {
            const debug = document.createElement("div");
            debug.className = "debug-block";
            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "State-JSON anzeigen (Debug)";
            details.appendChild(summary);
            const pre = document.createElement("pre");
            try {
              const redacted = JSON.parse(JSON.stringify(state));
              if (Array.isArray(redacted.students)) {
                redacted.students.forEach(function (student) {
                  if (student && student.birthDate) delete student.birthDate;
                });
              }
              pre.textContent = JSON.stringify(redacted, null, 2);
            } catch (err) {
              pre.textContent = "Fehler beim Erzeugen der Debug-Ansicht.";
            }
            details.appendChild(pre);
            debug.appendChild(details);
            section.appendChild(debug);
          });

          container.appendChild(section);
        }


        // Funktion zum Bearbeiten von Unterkategorien einer Kategorie
        function editSubcategories(category) {
          const overlay = document.createElement("div");
          overlay.style.position = "fixed";
          overlay.style.top = "0";
          overlay.style.left = "0";
          overlay.style.width = "100%";
          overlay.style.height = "100%";
          overlay.style.background = "rgba(0,0,0,0.5)";
          overlay.style.display = "flex";
          overlay.style.alignItems = "center";
          overlay.style.justifyContent = "center";
          overlay.style.zIndex = "10000";

          const dialog = document.createElement("div");
          dialog.style.background = "var(--bg-card, #fff)";
          dialog.style.padding = "1.5rem";
          dialog.style.borderRadius = "8px";
          dialog.style.minWidth = "500px";
          dialog.style.maxWidth = "90%";
          dialog.style.maxHeight = "80vh";
          dialog.style.overflow = "auto";
          dialog.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";

          const title = document.createElement("h3");
          title.textContent = "Unterkategorien für: " + category.name;
          title.style.marginTop = "0";
          dialog.appendChild(title);

          const hint = document.createElement("div");
          hint.style.fontSize = "0.85rem";
          hint.style.color = "var(--text-muted, #777)";
          hint.style.marginBottom = "1rem";
          hint.textContent = "Erstelle Unterkategorien und lege fest, wie viel Prozent dieser Kategorie diese ausmachen. Beispiel: Schriftlich 100%, davon Klassenarbeiten 60% und Vokabeltests 40%.";
          dialog.appendChild(hint);

          // Tabelle mit Unterkategorien
          const table = document.createElement("table");
          table.className = "data-table";
          table.style.marginBottom = "1rem";

          const thead = document.createElement("thead");
          const tr = document.createElement("tr");
          ["Name", "Gewicht (%)", "Aktion"].forEach(label => {
            const th = document.createElement("th");
            th.textContent = label;
            tr.appendChild(th);
          });
          thead.appendChild(tr);
          table.appendChild(thead);

          const tbody = document.createElement("tbody");
          const categoryId = category.id;

          // Funktion zum Rendern der Tabelle
          const renderTable = () => {
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
            const currentCategory = (state.settings.categories || []).find(function (item) { return item.id === categoryId; });
            for (const subcat of (currentCategory && Array.isArray(currentCategory.subcategories) ? currentCategory.subcategories : [])) {
              const row = document.createElement("tr");

              const tdName = document.createElement("td");
              const nameInput = document.createElement("input");
              nameInput.type = "text";
              nameInput.value = subcat.name || "";
              nameInput.style.width = "100%";
              nameInput.style.boxSizing = "border-box";
              nameInput.addEventListener("change", async function() {
                const subcategoryId = subcat.id;
                const value = this.value.trim() || 'Unterkategorie';
                try {
                  await commitStateChange(function (candidate) {
                    const candidateCategory = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                    const candidateSubcategory = candidateCategory && (candidateCategory.subcategories || []).find(function (item) { return item.id === subcategoryId; });
                    if (!candidateSubcategory) throw new Error('Die Unterkategorie ist nicht mehr verfügbar.');
                    candidateSubcategory.name = value;
                  }, { render: false });
                  renderTable();
                } catch (error) {
                  renderTable();
                  if (!isStateCommitAborted(error)) window.alert('Die Unterkategorie konnte nicht gespeichert werden: ' + error.message);
                }
              });
              tdName.appendChild(nameInput);
              row.appendChild(tdName);

              const tdWeight = document.createElement("td");
              const weightInput = document.createElement("input");
              weightInput.type = "number";
              weightInput.min = "0";
              weightInput.max = "100";
              weightInput.step = "1";
              weightInput.value = subcat.weightPercent || 0;
              weightInput.style.width = "80px";
              weightInput.addEventListener("change", async function() {
                const subcategoryId = subcat.id;
                const value = parseFloat(this.value) || 0;
                try {
                  await commitStateChange(function (candidate) {
                    const candidateCategory = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                    const candidateSubcategory = candidateCategory && (candidateCategory.subcategories || []).find(function (item) { return item.id === subcategoryId; });
                    if (!candidateSubcategory) throw new Error('Die Unterkategorie ist nicht mehr verfügbar.');
                    candidateSubcategory.weightPercent = value;
                  }, { render: false });
                  renderTable();
                } catch (error) {
                  renderTable();
                  if (!isStateCommitAborted(error)) window.alert('Das Gewicht konnte nicht gespeichert werden: ' + error.message);
                }
              });
              tdWeight.appendChild(weightInput);
              row.appendChild(tdWeight);

              const tdAction = document.createElement("td");
              const delBtn = document.createElement("button");
              delBtn.type = "button";
              delBtn.textContent = "Löschen";
              delBtn.style.fontSize = "0.85rem";
              delBtn.addEventListener("click", async function() {
                const subcategoryId = subcat.id;
                try {
                  await commitStateChange(function (candidate) {
                    const candidateCategory = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                    if (!candidateCategory) throw new Error('Die Kategorie ist nicht mehr verfügbar.');
                    const before = (candidateCategory.subcategories || []).length;
                    candidateCategory.subcategories = (candidateCategory.subcategories || []).filter(function (item) { return item.id !== subcategoryId; });
                    if (candidateCategory.subcategories.length === before) throw new Error('Die Unterkategorie ist nicht mehr verfügbar.');
                  }, { render: false });
                  renderTable();
                } catch (error) {
                  renderTable();
                  if (!isStateCommitAborted(error)) window.alert('Die Unterkategorie konnte nicht gelöscht werden: ' + error.message);
                }
              });
              tdAction.appendChild(delBtn);
              row.appendChild(tdAction);

              tbody.appendChild(row);
            }
          };

          renderTable();
          table.appendChild(tbody);
          dialog.appendChild(table);

          // Button zum Hinzufügen einer Unterkategorie
          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.textContent = "+ Unterkategorie hinzufügen";
          addBtn.style.marginBottom = "1rem";
          addBtn.addEventListener("click", async function() {
            try {
              await commitStateChange(function (candidate) {
                const candidateCategory = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                if (!candidateCategory) throw new Error('Die Kategorie ist nicht mehr verfügbar.');
                if (!Array.isArray(candidateCategory.subcategories)) candidateCategory.subcategories = [];
                candidateCategory.subcategories.push({
                  id: DomainModel.generateId('subcat'),
                  name: 'Neue Unterkategorie',
                  weightPercent: DomainModel.getDefaultSubcategoryWeight(candidateCategory)
                });
              }, { render: false });
              renderTable();
            } catch (error) {
              if (!isStateCommitAborted(error)) window.alert('Die Unterkategorie konnte nicht angelegt werden: ' + error.message);
            }
          });
          dialog.appendChild(addBtn);

          // Gewichtungs-Hinweis
          const weightHint = document.createElement("div");
          weightHint.style.fontSize = "0.8rem";
          weightHint.style.color = "var(--text-muted, #777)";
          weightHint.style.padding = "0.75rem";
          weightHint.style.backgroundColor = "var(--info-bg, #f9f9f9)";
          weightHint.style.borderRadius = "4px";
          weightHint.style.marginBottom = "1rem";
          weightHint.textContent = "💡 Tipp: Hierarchisch wird erst gerechnet, wenn alle Leistungen einer vorhandenen Unterkategorie zugeordnet sind und jede verwendete Unterkategorie ein positives gültiges Gewicht hat. Bis dahin bleibt die ganze Kategorie in der flachen Berechnung; keine Leistung wird still ignoriert. Die Gewichte sollten zusammen 100% ergeben.";
          dialog.appendChild(weightHint);

          // Buttons
          const btnRow = document.createElement("div");
          btnRow.style.display = "flex";
          btnRow.style.gap = "0.5rem";
          btnRow.style.justifyContent = "flex-end";

          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Schließen";
          closeBtn.type = "button";
          closeBtn.addEventListener("click", function() {
            try { document.body.removeChild(overlay); } catch (e) {}
          });
          btnRow.appendChild(closeBtn);
          dialog.appendChild(btnRow);

          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
        }

        function bindGradeMappingInput({ input, readState, label, commitStateChange, showAlert }) {
          const getStoredDisplayValue = () => {
            const currentState = readState();
            const value = currentState.settings.gradeMapping[label];
            return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : "";
          };

          input.type = "number";
          input.step = "0.1";
          input.min = "0";
          input.value = getStoredDisplayValue();
          input.addEventListener("change", async function () {
            const value = GradingLogic.parseGradeMappingInput(this.value);
            if (value === null) {
              this.value = getStoredDisplayValue();
              showAlert("Bitte einen gültigen numerischen Wert ab 0 eingeben.");
              return;
            }
            try {
              await commitStateChange(function (candidate) {
                if (!candidate.settings.gradeMapping || typeof candidate.settings.gradeMapping !== 'object') {
                  candidate.settings.gradeMapping = {};
                }
                candidate.settings.gradeMapping[label] = value;
              });
            } catch (error) {
              this.value = getStoredDisplayValue();
              showAlert('Der Wert konnte nicht gespeichert werden: ' + error.message);
            }
          });
        }

        function renderSchoolSettings(panel) {
          const base = JSON.stringify(getSchoolProfile());
          if (!schoolProfileDraft || schoolProfileDraftBase !== base) {
            schoolProfileDraft = { ...getSchoolProfile(), loading: false, saving: false };
            schoolProfileDraftBase = base;
            schoolLogoReadId += 1;
          }
          const draft = schoolProfileDraft;
          const box = document.createElement('div');
          box.className = 'info-box school-settings';
          const label = document.createElement('label');
          label.setAttribute('for', 'settings-school-name');
          label.textContent = 'Schulname / Untertitel';
          const name = document.createElement('input');
          name.id = 'settings-school-name';
          name.type = 'text'; name.maxLength = 120; name.value = draft.name;
          name.placeholder = 'Name deiner Schule';
          name.addEventListener('input', function () { draft.name = name.value; });
          box.appendChild(label); box.appendChild(name);
          const hint = document.createElement('p');
          hint.className = 'text-muted';
          hint.textContent = 'Der Schulname erscheint in der Anwendung, im Browsertitel und auf Ausdrucken. Leer lassen, um ihn auszublenden. Schulname und ausgewähltes Logo werden lokal verschlüsselt gespeichert und im Backup mitgenommen. Auf dem Sperrbildschirm bleibt die Anzeige neutral.';
          box.appendChild(hint);
          const fileLabel = document.createElement('label');
          fileLabel.setAttribute('for', 'settings-school-logo'); fileLabel.textContent = 'Logo auswählen (PNG)';
          const file = document.createElement('input');
          file.id = 'settings-school-logo'; file.type = 'file'; file.accept = 'image/png,.png';
          const fileHint = document.createElement('p');
          fileHint.className = 'text-muted';
          fileHint.textContent = 'Beliebiger Dateiname, höchstens 256 KiB und 4096 × 4096 Pixel. Die Bilddatei wird übernommen und muss danach nicht neben der Anwendung liegen.';
          const preview = document.createElement('div');
          preview.id = 'settings-school-preview'; preview.className = 'school-logo-preview';
          const status = document.createElement('p');
          status.id = 'settings-school-status'; status.setAttribute('role', 'status');
          const actions = document.createElement('div'); actions.className = 'school-settings-actions';
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Logo entfernen';
          const auto = document.createElement('button'); auto.type = 'button'; auto.textContent = 'Logo aus Programmordner verwenden';
          const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Schule und Logo speichern';
          save.id = 'settings-school-save'; save.className = 'primary';
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Änderungen verwerfen';
          const controls = [name, file, remove, auto, save, cancel];
          function refresh() {
            while (preview.firstChild) preview.removeChild(preview.firstChild);
            const sources = draft.logoMode === 'auto' ? ['Logo.png', 'placeholder-logo.svg'] : draft.logoMode === 'custom' ? [draft.logoDataUrl] : [];
            const fallback = document.createElement('span'); fallback.textContent = 'Kein Logo';
            mountSchoolLogo(preview, 'school-logo-image', sources, draft.name, fallback);
            preview.appendChild(fallback);
            for (const control of controls) setSchoolProfileControlDisabled(control, draft.saving);
            setSchoolProfileControlDisabled(save, draft.loading || draft.saving || encryptionRequired);
          }
          function setLogo(mode, dataUrl = '') {
            schoolLogoReadId += 1;
            draft.loading = false; draft.logoMode = mode; draft.logoDataUrl = dataUrl;
            file.value = '';
            status.textContent = 'Änderung vorbereitet. Bitte speichern.';
            refresh();
          }
          remove.addEventListener('click', function () { setLogo('none'); });
          auto.addEventListener('click', function () { setLogo('auto'); });
          cancel.addEventListener('click', function () {
            schoolProfileDraft = null; schoolLogoReadId += 1;
            render();
            const input = document.getElementById('settings-school-name');
            if (input) input.focus();
          });
          file.addEventListener('change', async function () {
            const selected = file.files && file.files[0];
            if (!selected) return;
            const readId = ++schoolLogoReadId;
            draft.loading = true; status.textContent = 'Logo wird geprüft …'; refresh();
            try {
              if (selected.size > 262144 || selected.size === 0) throw new Error('Bitte eine PNG-Datei mit höchstens 256 KiB auswählen.');
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = reader.onabort = function () { reject(new Error('Die Bilddatei konnte nicht gelesen werden.')); };
                reader.readAsDataURL(selected);
              });
              // Some systems leave the file MIME type empty despite a valid PNG signature.
              const pngUrl = String(dataUrl).replace(/^data:[^;,]*;base64,/, 'data:image/png;base64,');
              if (!DomainModel.normalizeSchoolProfile({ logoMode: 'custom', logoDataUrl: pngUrl }).logoDataUrl) throw new Error('Die Datei ist kein gültiges PNG-Bild.');
              await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = function () {
                  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) reject(new Error('Das Logo darf höchstens 4096 × 4096 Pixel groß sein.'));
                  else resolve();
                };
                image.onerror = function () { reject(new Error('Das PNG-Bild konnte nicht geladen werden.')); };
                image.src = pngUrl;
              });
              if (readId !== schoolLogoReadId || schoolProfileDraft !== draft) return;
              setLogo('custom', pngUrl);
              if (currentSection === 'settings' && document.getElementById('settings-school-preview') !== preview) render();
            } catch (error) {
              if (readId !== schoolLogoReadId || schoolProfileDraft !== draft) return;
              draft.loading = false; file.value = '';
              status.textContent = error.message || 'Das Logo konnte nicht übernommen werden.';
              refresh();
              if (currentSection === 'settings' && document.getElementById('settings-school-preview') !== preview) render();
            }
          });
          save.addEventListener('click', async function () {
            if (draft.loading || draft.saving || encryptionRequired || !Storage.hasSessionPassword()) return;
            draft.saving = true; refresh();
            status.textContent = 'Schule und Logo werden gespeichert …';
            try {
              const profile = DomainModel.normalizeSchoolProfile(draft);
              await commitStateChange(function (candidate) {
                candidate.settings.schoolProfile = profile;
              }, { render: false });
              if (schoolProfileDraft !== draft) throw new Error('Sitzung oder Datenbestand wurde geändert.');
              schoolProfileDraft = null;
              render();
              const currentStatus = document.getElementById('settings-school-status');
              if (currentStatus) currentStatus.textContent = 'Schule und Logo gespeichert.';
              const currentSave = document.getElementById('settings-school-save');
              if (currentSave) currentSave.focus();
            } catch (error) {
              status.textContent = 'Schule und Logo wurden nicht gespeichert. Bitte Speicherplatz und Entsperrung prüfen und erneut versuchen.';
            } finally {
              draft.saving = false; refresh();
              // An earlier in-flight settings save may have replaced these controls.
              if (schoolProfileDraft === draft && currentSection === 'settings' &&
                  document.getElementById('settings-school-save') !== save) {
                const message = status.textContent;
                render();
                const currentStatus = document.getElementById('settings-school-status');
                if (currentStatus) currentStatus.textContent = message;
              }
              const currentSave = document.getElementById('settings-school-save');
              if (currentSave && !currentSave.disabled) currentSave.focus();
            }
          });
          box.appendChild(fileLabel); box.appendChild(file); box.appendChild(fileHint); box.appendChild(preview);
          for (const button of [remove, auto, save, cancel]) actions.appendChild(button);
          box.appendChild(actions); box.appendChild(status);
          const automaticHint = document.createElement('p'); automaticHint.className = 'text-muted';
          automaticHint.textContent = 'Im Modus „Programmordner“ wird zuerst Logo.png und danach placeholder-logo.svg neben der HTML-Datei gesucht. „Logo entfernen“ schaltet auch diese Suche aus.';
          box.appendChild(automaticHint);
          panel.appendChild(box);
          refresh();
        }

        function renderSettingsSection(container) {
          const section = document.createElement("section");
          section.className = "section";

          const h2 = document.createElement("h2");
          h2.textContent = "Einstellungen";
          section.appendChild(h2);

          const hint = document.createElement("div");
          hint.className = "section-hint";
          hint.textContent =
            "Hier verwaltest du Schule und Logo, Zeiträume, Bewertung, Sicherheit und Informationen zur Anwendung.";
          section.appendChild(hint);

          const settingsAreaDefinitions = [
            ['periods', 'Schuljahr & Zeiträume'],
            ['grading', 'Bewertung'],
            ['security', 'Sicherheit'],
            ['school', 'Schule und Logo'],
            ['about', 'Über die Anwendung']
          ];
          const settingsLayout = document.createElement('div');
          settingsLayout.className = 'settings-layout';
          const settingsNavigation = document.createElement('nav');
          settingsNavigation.className = 'settings-navigation';
          settingsNavigation.setAttribute('aria-label', 'Einstellungsbereiche');
          settingsNavigation.setAttribute('role', 'tablist');
          const settingsContent = document.createElement('div');
          settingsContent.className = 'settings-content';
          const settingsAreaButtons = new Map();
          const settingsAreaPanels = new Map();

          function selectSettingsArea(areaId, focusTab) {
            if (!settingsAreaPanels.has(areaId)) return;
            settingsActiveArea = areaId;
            for (const [candidateId] of settingsAreaDefinitions) {
              const selected = candidateId === settingsActiveArea;
              const button = settingsAreaButtons.get(candidateId);
              const panel = settingsAreaPanels.get(candidateId);
              button.setAttribute('aria-selected', selected ? 'true' : 'false');
              button.setAttribute('tabindex', selected ? '0' : '-1');
              panel.hidden = !selected;
            }
            if (focusTab) settingsAreaButtons.get(settingsActiveArea).focus();
          }

          function handleSettingsTabKeydown(event, ids, activeId, selectTab) {
            let nextIndex = -1;
            const currentIndex = ids.indexOf(activeId);
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % ids.length;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + ids.length) % ids.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = ids.length - 1;
            if (nextIndex < 0) return;
            event.preventDefault();
            selectTab(ids[nextIndex], true);
          }

          const settingsAreaIds = settingsAreaDefinitions.map(function (definition) { return definition[0]; });
          for (const [areaId, areaLabel] of settingsAreaDefinitions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = 'settings-area-' + areaId + '-tab';
            button.textContent = areaLabel;
            button.setAttribute('role', 'tab');
            button.setAttribute('data-settings-area', areaId);
            button.setAttribute('aria-controls', 'settings-area-' + areaId + '-panel');
            button.addEventListener('click', function () { selectSettingsArea(areaId, true); });
            button.addEventListener('keydown', function (event) {
              handleSettingsTabKeydown(event, settingsAreaIds, areaId, selectSettingsArea);
            });
            settingsAreaButtons.set(areaId, button);
            settingsNavigation.appendChild(button);

            const panel = document.createElement('section');
            panel.className = 'settings-panel';
            panel.id = 'settings-area-' + areaId + '-panel';
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('data-settings-panel', areaId);
            panel.setAttribute('aria-labelledby', button.id);
            const panelTitle = document.createElement('h3');
            panelTitle.textContent = areaLabel;
            panel.appendChild(panelTitle);
            settingsAreaPanels.set(areaId, panel);
            settingsContent.appendChild(panel);
          }

          renderSchoolSettings(settingsAreaPanels.get('school'));

          // Wenn Verschlüsselung erforderlich ist, zeige eine prominente Einrichtungs-Box
          if (typeof encryptionRequired !== 'undefined' && encryptionRequired) {
            const mustBox = document.createElement('div');
            mustBox.className = 'info-box';
            mustBox.style.borderColor = '#1976d2';

            const mustTitle = document.createElement('strong');
            mustTitle.textContent = 'Erforderliche Einrichtung: Verschlüsselung';
            mustBox.appendChild(mustTitle);

            const mustText = document.createElement('div');
            mustText.style.marginTop = '0.4rem';
            mustText.style.fontSize = '0.95rem';
            mustText.textContent = 'Bevor du die Anwendung nutzen kannst, musst du ein Passwort festlegen, damit die Daten verschlüsselt gespeichert werden.';
            mustBox.appendChild(mustText);

            const btnRow = document.createElement('div');
            btnRow.style.marginTop = '0.6rem';
            btnRow.style.display = 'flex';
            btnRow.style.gap = '0.6rem';

            const setupBtn = document.createElement('button');
            setupBtn.type = 'button';
            setupBtn.textContent = 'Verschlüsselung jetzt einrichten';
            setupBtn.addEventListener('click', async function () {
              const setupDialogEpoch = uiStateEpoch;
              const pw = await window.promptPassword({ message: 'Neues Passwort für die Verschlüsselung eingeben (mind. 6 Zeichen):', confirm: true });
              if (uiStateEpoch !== setupDialogEpoch) return;
              if (!pw) { Storage.lockSession(); return; }
              if (pw.length < 6) { try { window.alert('Bitte ein Passwort mit mindestens 6 Zeichen eingeben.'); } catch (e) {} ; return; }
              const encryptionEpoch = invalidateUiStateEpoch();
              try {
                await Storage.enableEncryption(pw, state);
                if (uiStateEpoch !== encryptionEpoch) return;
                encryptionRequired = false;
                window.alert('Verschlüsselung aktiviert. Du kannst nun die Anwendung verwenden.');
                render();
              } catch (err) {
                console.error('Fehler beim Aktivieren der Verschlüsselung:', err);
                window.alert('Aktivierung der Verschlüsselung fehlgeschlagen. Siehe Konsole.');
              }
            });

            btnRow.appendChild(setupBtn);
            mustBox.appendChild(btnRow);

            section.appendChild(mustBox);
            // Früher Rückgabe-Pfad: restliche Einstellungen bleiben sichtbar, aber die Einrichtung wird oben hervorgehoben
          }

          // Neue: Halbjahres-Einstellungen für Sek I und Sek II
          const halfYearBox = document.createElement('div');
          halfYearBox.className = 'info-box settings-periods';
          const halfYearTitle = document.createElement('strong');
          halfYearTitle.textContent = 'Zentrale Vorgaben für beide Stufen';
          halfYearBox.appendChild(halfYearTitle);
          const halfYearText = document.createElement('div');
          halfYearText.style.fontSize = '0.85rem';
          halfYearText.style.margin = '0.35rem 0 0.6rem 0';
          halfYearText.textContent = 'Definiert Schuljahrbeginn und Halbjahres-Grenzen separat für Sek I und Sek II. Der H2-Start entscheidet über die Zuordnung; das H1-Ende ist informativ. Tage in einer Lücke bleiben H1, bei einer Überlappung hat H2 ab seinem Beginn Vorrang.';
          halfYearBox.appendChild(halfYearText);

          function formatSettingsDate(parts, yearKey, monthKey, dayKey) {
            const year = Number(parts && parts[yearKey]) || new Date().getFullYear();
            const month = String(Number(parts && parts[monthKey]) || 1).padStart(2, '0');
            const day = String(Number(parts && parts[dayKey]) || 1).padStart(2, '0');
            return year + '-' + month + '-' + day;
          }

          function createSettingsPeriodDraft(levelKey) {
            const currentYr = new Date().getFullYear();
            const currentMth = new Date().getMonth() + 1;
            const defaultSchoolYearStart = currentMth <= 8 ? currentYr - 1 : currentYr;
            const hys = (state.settings.halfYearSettings && state.settings.halfYearSettings[levelKey]) || {
              schoolYearStartYear: defaultSchoolYearStart,
              schoolYearStartMonth: 9,
              schoolYearStartDay: 8,
              h1EndYear: defaultSchoolYearStart + 1,
              h1EndMonth: 1,
              h1EndDay: 30,
              h2StartYear: defaultSchoolYearStart + 1,
              h2StartMonth: 2,
              h2StartDay: 9
            };
            const names = (state.settings.halfYearNames && state.settings.halfYearNames[levelKey]) ||
              (levelKey === 'seckII' ? { h1: 'Q1', h2: 'Q2' } : { h1: 'H1', h2: 'H2' });
            return {
              schoolYearStart: formatSettingsDate(hys, 'schoolYearStartYear', 'schoolYearStartMonth', 'schoolYearStartDay'),
              h1End: formatSettingsDate(hys, 'h1EndYear', 'h1EndMonth', 'h1EndDay'),
              h2Start: formatSettingsDate(hys, 'h2StartYear', 'h2StartMonth', 'h2StartDay'),
              h1Name: typeof names.h1 === 'string' ? names.h1 : (levelKey === 'seckII' ? 'Q1' : 'H1'),
              h2Name: typeof names.h2 === 'string' ? names.h2 : (levelKey === 'seckII' ? 'Q2' : 'H2')
            };
          }

          if (!settingsPeriodDrafts) {
            settingsPeriodDrafts = {
              seckI: createSettingsPeriodDraft('seckI'),
              seckII: createSettingsPeriodDraft('seckII')
            };
          }

          // Funktion zum Erstellen einer Sek-Ebene UI
          function createHalfYearLevelUI(levelName, levelKey) {
            const levelBox = document.createElement('div');
            levelBox.className = 'settings-stage-panel';
            levelBox.id = 'settings-stage-' + levelKey + '-panel';
            levelBox.setAttribute('role', 'tabpanel');
            levelBox.setAttribute('data-settings-stage-panel', levelKey);
            levelBox.setAttribute('aria-labelledby', 'settings-stage-' + levelKey + '-tab');

            const levelLabel = document.createElement('div');
            levelLabel.className = 'settings-stage-title';
            levelLabel.textContent = levelName;
            levelBox.appendChild(levelLabel);

            const draft = settingsPeriodDrafts[levelKey];

            const rowInputs = document.createElement('div');
            rowInputs.className = 'settings-fields';

            // Schuljahrbeginn
            const syStartWrap = document.createElement('div');
            syStartWrap.className = 'settings-field';
            const syStartLabel = document.createElement('label');
            syStartLabel.textContent = 'Schuljahr beginnt';
            const syStartInput = document.createElement('input');
            syStartInput.id = 'settings-' + levelKey + '-school-year-start';
            syStartInput.type = 'date';
            syStartInput.value = draft.schoolYearStart;
            syStartInput.addEventListener('input', function () { draft.schoolYearStart = this.value; });
            syStartLabel.setAttribute('for', syStartInput.id);
            syStartWrap.appendChild(syStartLabel);
            syStartWrap.appendChild(syStartInput);
            rowInputs.appendChild(syStartWrap);

            // H1 Ende
            const h1EndWrap = document.createElement('div');
            h1EndWrap.className = 'settings-field';
            const h1EndLabel = document.createElement('label');
            h1EndLabel.textContent = 'Erster Zeitraum endet';
            const h1EndInput = document.createElement('input');
            h1EndInput.id = 'settings-' + levelKey + '-h1-end';
            h1EndInput.type = 'date';
            h1EndInput.value = draft.h1End;
            h1EndInput.addEventListener('input', function () { draft.h1End = this.value; });
            h1EndLabel.setAttribute('for', h1EndInput.id);
            h1EndWrap.appendChild(h1EndLabel);
            h1EndWrap.appendChild(h1EndInput);
            rowInputs.appendChild(h1EndWrap);

            // H2 Start
            const h2StartWrap = document.createElement('div');
            h2StartWrap.className = 'settings-field';
            const h2StartLabel = document.createElement('label');
            h2StartLabel.textContent = 'Zweiter Zeitraum beginnt';
            const h2StartInput = document.createElement('input');
            h2StartInput.id = 'settings-' + levelKey + '-h2-start';
            h2StartInput.type = 'date';
            h2StartInput.value = draft.h2Start;
            h2StartInput.addEventListener('input', function () { draft.h2Start = this.value; });
            h2StartLabel.setAttribute('for', h2StartInput.id);
            h2StartWrap.appendChild(h2StartLabel);
            h2StartWrap.appendChild(h2StartInput);
            rowInputs.appendChild(h2StartWrap);

            // H2 Ende
            const h2EndWrap = document.createElement('div');
            h2EndWrap.className = 'settings-field settings-field-info';
            const h2EndLabel = document.createElement('span');
            h2EndLabel.className = 'settings-field-label';
            h2EndLabel.textContent = 'Zweiter Zeitraum endet';
            h2EndWrap.appendChild(h2EndLabel);
            const h2EndInfo = document.createElement('div');
            h2EndInfo.textContent = 'Mit dem Schuljahresende';
            h2EndWrap.appendChild(h2EndInfo);
            rowInputs.appendChild(h2EndWrap);

            // Benutzerdefinierte Namen für Halbjahre
            const namesRow = document.createElement('div');
            namesRow.className = 'settings-fields settings-name-fields';

            // H1 Name
            const h1NameWrap = document.createElement('div');
            h1NameWrap.className = 'settings-field';
            const h1NameLabel = document.createElement('label');
            h1NameLabel.textContent = 'Erster Zeitraum';
            const h1NameInput = document.createElement('input');
            h1NameInput.id = 'settings-' + levelKey + '-h1-name';
            h1NameInput.type = 'text';
            h1NameInput.value = draft.h1Name;
            h1NameInput.addEventListener('input', function () { draft.h1Name = this.value; });
            h1NameLabel.setAttribute('for', h1NameInput.id);
            h1NameWrap.appendChild(h1NameLabel);
            h1NameWrap.appendChild(h1NameInput);
            namesRow.appendChild(h1NameWrap);

            // H2 Name
            const h2NameWrap = document.createElement('div');
            h2NameWrap.className = 'settings-field';
            const h2NameLabel = document.createElement('label');
            h2NameLabel.textContent = 'Zweiter Zeitraum';
            const h2NameInput = document.createElement('input');
            h2NameInput.id = 'settings-' + levelKey + '-h2-name';
            h2NameInput.type = 'text';
            h2NameInput.value = draft.h2Name;
            h2NameInput.addEventListener('input', function () { draft.h2Name = this.value; });
            h2NameLabel.setAttribute('for', h2NameInput.id);
            h2NameWrap.appendChild(h2NameLabel);
            h2NameWrap.appendChild(h2NameInput);
            namesRow.appendChild(h2NameWrap);

            levelBox.appendChild(rowInputs);
            levelBox.appendChild(namesRow);

            return { levelBox, syStartInput, h1EndInput, h2StartInput, h1NameInput, h2NameInput };
          }

          const seckIUI = createHalfYearLevelUI('Sekundarstufe I (Noten 1–6)', 'seckI');
          const seckIIUI = createHalfYearLevelUI('Sekundarstufe II / Oberstufe (Punkte 0–15)', 'seckII');
          const settingsStageIds = ['seckI', 'seckII'];
          const settingsStageNavigation = document.createElement('div');
          settingsStageNavigation.className = 'settings-stage-navigation';
          settingsStageNavigation.setAttribute('role', 'tablist');
          settingsStageNavigation.setAttribute('aria-label', 'Schulstufe');
          const settingsStageButtons = new Map();
          const settingsStagePanels = new Map([
            ['seckI', seckIUI.levelBox],
            ['seckII', seckIIUI.levelBox]
          ]);

          function selectSettingsStage(stageId, focusTab) {
            if (!settingsStagePanels.has(stageId)) return;
            settingsActiveStage = stageId;
            for (const candidateId of settingsStageIds) {
              const selected = candidateId === settingsActiveStage;
              const button = settingsStageButtons.get(candidateId);
              const panel = settingsStagePanels.get(candidateId);
              button.setAttribute('aria-selected', selected ? 'true' : 'false');
              button.setAttribute('tabindex', selected ? '0' : '-1');
              panel.hidden = !selected;
            }
            if (focusTab) settingsStageButtons.get(settingsActiveStage).focus();
          }

          [['seckI', 'Sekundarstufe I'], ['seckII', 'Sekundarstufe II']].forEach(function (definition) {
            const stageId = definition[0];
            const button = document.createElement('button');
            button.type = 'button';
            button.id = 'settings-stage-' + stageId + '-tab';
            button.textContent = definition[1];
            button.setAttribute('role', 'tab');
            button.setAttribute('data-settings-stage', stageId);
            button.setAttribute('aria-controls', 'settings-stage-' + stageId + '-panel');
            button.addEventListener('click', function () { selectSettingsStage(stageId, true); });
            button.addEventListener('keydown', function (event) {
              handleSettingsTabKeydown(event, settingsStageIds, stageId, selectSettingsStage);
            });
            settingsStageButtons.set(stageId, button);
            settingsStageNavigation.appendChild(button);
          });
          halfYearBox.appendChild(settingsStageNavigation);
          const settingsStageContent = document.createElement('div');
          settingsStageContent.className = 'settings-stage-content';
          settingsStageContent.appendChild(seckIUI.levelBox);
          settingsStageContent.appendChild(seckIIUI.levelBox);
          halfYearBox.appendChild(settingsStageContent);
          selectSettingsStage(settingsActiveStage, false);

          // Save-Button
          const saveHYBtn = document.createElement('button');
          saveHYBtn.type = 'button';
          saveHYBtn.className = 'settings-save-periods';
          saveHYBtn.textContent = 'Zeiträume für Sek I und Sek II speichern';
          saveHYBtn.addEventListener('click', async () => {
            Object.assign(settingsPeriodDrafts.seckI, {
              schoolYearStart: seckIUI.syStartInput.value,
              h1End: seckIUI.h1EndInput.value,
              h2Start: seckIUI.h2StartInput.value,
              h1Name: seckIUI.h1NameInput.value,
              h2Name: seckIUI.h2NameInput.value
            });
            Object.assign(settingsPeriodDrafts.seckII, {
              schoolYearStart: seckIIUI.syStartInput.value,
              h1End: seckIIUI.h1EndInput.value,
              h2Start: seckIIUI.h2StartInput.value,
              h1Name: seckIIUI.h1NameInput.value,
              h2Name: seckIIUI.h2NameInput.value
            });
            const safeText = (el, def) => {
              const t = (el && typeof el.value === 'string') ? el.value.trim() : '';
              return t || def;
            };
            const dateInputs = [
              {
                level: 'seckI', label: 'Sek I',
                schoolYearStartValue: seckIUI.syStartInput.value,
                h1EndValue: seckIUI.h1EndInput.value,
                h2StartValue: seckIUI.h2StartInput.value
              },
              {
                level: 'seckII', label: 'Sek II',
                schoolYearStartValue: seckIIUI.syStartInput.value,
                h1EndValue: seckIIUI.h1EndInput.value,
                h2StartValue: seckIIUI.h2StartInput.value
              }
            ];
            const names = {
              seckI: {
              h1: safeText(seckIUI.h1NameInput, 'H1'),
              h2: safeText(seckIUI.h2NameInput, 'H2')
              },
              seckII: {
                h1: safeText(seckIIUI.h1NameInput, 'Q1'),
                h2: safeText(seckIIUI.h2NameInput, 'Q2')
              }
            };
            const submittedPeriodDrafts = JSON.parse(JSON.stringify(settingsPeriodDrafts));

            try {
              await commitStateChange(function (candidate) {
                const dateResult = applyHalfYearDateInputs(candidate, dateInputs);
                if (!dateResult.ok) throw new Error(dateResult.message);
                candidate.settings.halfYearNames = JSON.parse(JSON.stringify(names));
                recalcAssessmentTermsForCurrentState(candidate);
              });
              if (settingsPeriodDrafts) {
                for (const levelKey of ['seckI', 'seckII']) {
                  const confirmedDraft = createSettingsPeriodDraft(levelKey);
                  const currentDraft = settingsPeriodDrafts[levelKey];
                  const submittedDraft = submittedPeriodDrafts[levelKey];
                  for (const field of ['schoolYearStart', 'h1End', 'h2Start', 'h1Name', 'h2Name']) {
                    if (currentDraft[field] === submittedDraft[field]) currentDraft[field] = confirmedDraft[field];
                  }
                }
                render();
              }
              window.alert('Halbjahrs-Einstellungen gespeichert.');
            } catch (e) {
              console.error(e);
              window.alert('Fehler beim Speichern: ' + e.message);
            }
          });
          const saveHYScope = document.createElement('div');
          saveHYScope.className = 'settings-save-scope text-muted';
          saveHYScope.textContent = 'Diese eine Aktion speichert beide Stufen gemeinsam.';
          halfYearBox.appendChild(saveHYScope);
          halfYearBox.appendChild(saveHYBtn);

          settingsAreaPanels.get('periods').appendChild(halfYearBox);

          // ---------------------------
          // 1) Kategorien verwalten
          // ---------------------------
          const catBox = document.createElement("div");
          catBox.className = "info-box";

          const catTitle = document.createElement("strong");
          catTitle.textContent = "Kategorien (Bewertungsbereiche)";
          catBox.appendChild(catTitle);

          const catText = document.createElement("div");
          catText.style.fontSize = "0.85rem";
          catText.style.marginBottom = "0.4rem";
          catText.textContent =
            "Kategorien strukturieren die Leistungen im Kurs (z. B. „Mündlich“, „Schriftlich“, „Sonstiges“). " +
            "Kategorien können umbenannt und bei Bedarf deaktiviert werden.";
          catBox.appendChild(catText);

          const catTable = document.createElement("table");
          catTable.className = 'settings-category-table';
          const catThead = document.createElement("thead");
          const catTr = document.createElement('tr');
          ['Name','Aktiv','Unterkategorien'].forEach(t => { const th = document.createElement('th'); th.textContent = t; catTr.appendChild(th); });
          catThead.appendChild(catTr);
          catTable.appendChild(catThead);

          const catTbody = document.createElement("tbody");

          const categories = state.settings.categories || [];

          for (const [categoryIndex, cat] of categories.entries()) {
            const tr = document.createElement("tr");

            const tdName = document.createElement("td");
            const nameInput = document.createElement("input");
            nameInput.id = 'settings-category-name-' + categoryIndex;
            nameInput.type = "text";
            nameInput.value = cat.name || "";
            nameInput.setAttribute('aria-label', 'Name der Kategorie ' + (cat.name || categoryIndex + 1));
            nameInput.style.width = "100%";
            nameInput.style.boxSizing = "border-box";
            nameInput.addEventListener("change", async function () {
              const val = this.value.trim();
              const categoryId = cat.id;
              try {
                await commitStateChange(function (candidate) {
                  const category = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                  if (!category) throw new Error('Die Kategorie ist nicht mehr verfügbar.');
                  category.name = val || 'Kategorie';
                });
              } catch (error) {
                const confirmed = (state.settings.categories || []).find(function (item) { return item.id === categoryId; });
                this.value = confirmed ? confirmed.name : '';
                if (!isStateCommitAborted(error)) window.alert('Der Kategoriename konnte nicht gespeichert werden: ' + error.message);
              }
            });
            tdName.appendChild(nameInput);

            const tdActive = document.createElement("td");
            const activeInput = document.createElement("input");
            activeInput.id = 'settings-category-active-' + categoryIndex;
            activeInput.type = "checkbox";
            activeInput.checked = !!cat.active;
            activeInput.setAttribute('aria-label', 'Kategorie ' + (cat.name || categoryIndex + 1) + ' aktiv');
            activeInput.addEventListener("change", async function () {
              const categoryId = cat.id;
              const active = this.checked;
              try {
                await commitStateChange(function (candidate) {
                  const category = (candidate.settings.categories || []).find(function (item) { return item.id === categoryId; });
                  if (!category) throw new Error('Die Kategorie ist nicht mehr verfügbar.');
                  category.active = active;
                });
              } catch (error) {
                const confirmed = (state.settings.categories || []).find(function (item) { return item.id === categoryId; });
                this.checked = !!(confirmed && confirmed.active);
                if (!isStateCommitAborted(error)) window.alert('Die Kategorie konnte nicht gespeichert werden: ' + error.message);
              }
            });
            tdActive.appendChild(activeInput);

            // Unterkategorien-Button
            const tdSubcat = document.createElement("td");
            const subcatBtn = document.createElement("button");
            subcatBtn.type = "button";
            subcatBtn.textContent = "Bearbeiten";
            subcatBtn.setAttribute('aria-label', 'Unterkategorien von ' + (cat.name || 'Kategorie') + ' bearbeiten');
            subcatBtn.style.fontSize = "0.85rem";
            subcatBtn.addEventListener("click", function() {
              editSubcategories(cat);
            });
            tdSubcat.appendChild(subcatBtn);

            tr.appendChild(tdName);
            tr.appendChild(tdActive);
            tr.appendChild(tdSubcat);
            catTbody.appendChild(tr);
          }

          catTable.appendChild(catTbody);
          catBox.appendChild(catTable);

          const catAddBtn = document.createElement("button");
          catAddBtn.type = "button";
          catAddBtn.style.marginTop = "0.4rem";
          catAddBtn.textContent = "Kategorie hinzufügen";
          catAddBtn.addEventListener("click", async function () {
            try {
              await commitStateChange(function (candidate) {
                const newCat = DomainModel.createCategory({ name: 'Neue Kategorie', active: true });
                candidate.settings.categories.push(newCat);
                for (const template of candidate.settings.weightTemplates || []) {
                  if (!Array.isArray(template.items)) template.items = [];
                  if (!template.items.some(function (item) { return item.categoryId === newCat.id; })) {
                    template.items.push({ categoryId: newCat.id, weightPercent: 0 });
                  }
                }
              });
            } catch (error) {
              if (!isStateCommitAborted(error)) window.alert('Die Kategorie konnte nicht angelegt werden: ' + error.message);
            }
          });
          catBox.appendChild(catAddBtn);

          settingsAreaPanels.get('grading').appendChild(catBox);

          // ---------------------------
          // 2) Gewichtungsvorlagen
          // ---------------------------
          const wtBox = document.createElement("div");
          wtBox.className = "info-box";

          const wtTitle = document.createElement("strong");
          wtTitle.textContent = "Gewichtungsvorlagen";
          wtBox.appendChild(wtTitle);

          const wtText = document.createElement("div");
          wtText.style.fontSize = "0.85rem";
          wtText.style.marginBottom = "0.4rem";
          wtText.textContent =
            "Gewichtungsvorlagen legen fest, mit welchem Anteil die Kategorien in das Rechenmittel eingehen. Die Berliner Profile sind anpassbare Beispiele für die vorhandenen Kategorien; ihre Summe beträgt 100 %. " +
            "Die genaue schulische Regel, Fachkonferenzbeschlüsse und Sonderfälle müssen vor der Nutzung geprüft werden. Bestehende Kurszuordnungen werden nicht automatisch umgestellt.";
          wtBox.appendChild(wtText);

          const weightTemplates = state.settings.weightTemplates || [];

          if (weightTemplates.length === 0) {
            const p = document.createElement("p");
            p.className = "text-muted";
            p.textContent = "Noch keine Gewichtungsvorlagen vorhanden.";
            wtBox.appendChild(p);
          } else {
            for (const [templateIndex, wt] of weightTemplates.entries()) {
              const card = document.createElement("div");
              card.style.borderTop = "1px solid var(--border-soft)";
              card.style.marginTop = "0.4rem";
              card.style.paddingTop = "0.4rem";

              const nameRow = document.createElement("div");
              nameRow.className = 'settings-template-name-row';
              nameRow.style.display = "flex";
              nameRow.style.alignItems = "center";
              nameRow.style.gap = "0.4rem";
              nameRow.style.marginBottom = "0.3rem";

              const nameLabel = document.createElement("label");
              nameLabel.style.fontSize = "0.85rem";
              nameLabel.textContent = "Name";

              const nameInput = document.createElement("input");
              nameInput.id = 'settings-template-name-' + templateIndex;
              nameInput.type = "text";
              nameInput.value = wt.name || "";
              nameLabel.setAttribute('for', nameInput.id);
              nameInput.style.flex = "1 1 auto";
              nameInput.addEventListener("change", async function () {
                const templateId = wt.id;
                const name = this.value.trim() || 'Neue Vorlage';
                try {
                  await commitStateChange(function (candidate) {
                    const template = (candidate.settings.weightTemplates || []).find(function (item) { return item.id === templateId; });
                    if (!template) throw new Error('Die Gewichtungsvorlage ist nicht mehr verfügbar.');
                    template.name = name;
                  });
                } catch (error) {
                  const confirmed = (state.settings.weightTemplates || []).find(function (item) { return item.id === templateId; });
                  this.value = confirmed ? confirmed.name : '';
                  if (!isStateCommitAborted(error)) window.alert('Der Vorlagenname konnte nicht gespeichert werden: ' + error.message);
                }
              });

              const delBtn = document.createElement("button");
              delBtn.type = "button";
              delBtn.textContent = "Vorlage löschen";
              delBtn.className = "danger";
              delBtn.style.fontSize = "0.75rem";
              delBtn.style.padding = "0.2rem 0.6rem";
              delBtn.addEventListener("click", async function () {
                const ok = window.confirm(
                  "Diese Gewichtungsvorlage wirklich löschen? Kurse, die diese Vorlage verwenden, fallen dann auf Gleichverteilung zurück."
                );
                if (!ok) return;
                try {
                  await commitStateChange(function (candidate) {
                    candidate.settings.weightTemplates = candidate.settings.weightTemplates.filter(
                      function (template) { return template.id !== wt.id; }
                    );
                  });
                } catch (error) {
                  try { window.alert('Die Gewichtungsvorlage konnte nicht gelöscht werden: ' + error.message); } catch (e) {}
                }
              });

              nameRow.appendChild(nameLabel);
              nameRow.appendChild(nameInput);
              nameRow.appendChild(delBtn);
              card.appendChild(nameRow);

              // Tabelle der Gewichte
              const innerTable = document.createElement("table");
              const innerThead = document.createElement("thead");
              const innerTr = document.createElement('tr');
              ['Kategorie','Gewicht [%]'].forEach(t => { const th = document.createElement('th'); th.textContent = t; innerTr.appendChild(th); });
              innerThead.appendChild(innerTr);
              innerTable.appendChild(innerThead);

              const innerTbody = document.createElement("tbody");

              // Sicherstellen, dass für jede Kategorie ein Item existiert
              for (const [categoryIndex, cat] of (state.settings.categories || []).entries()) {
                const item = wt.items.find(i => i.categoryId === cat.id) || { categoryId: cat.id, weightPercent: 0 };

                const tr = document.createElement("tr");

                const tdCatName = document.createElement("td");
                tdCatName.textContent = cat.name || "(Kategorie)";
                tr.appendChild(tdCatName);

                const tdWeight = document.createElement("td");
                const wInput = document.createElement("input");
                wInput.id = 'settings-template-' + templateIndex + '-category-' + categoryIndex;
                wInput.type = "number";
                wInput.step = "1";
                wInput.min = "0";
                wInput.max = "100";
                wInput.value = Number.isFinite(item.weightPercent)
                  ? item.weightPercent
                  : String(item.weightPercent ?? "");
                wInput.setAttribute('aria-label', 'Gewicht für ' + (cat.name || 'Kategorie') + ' in Prozent');
                wInput.style.width = "4.5rem";
                wInput.addEventListener("change", async function () {
                  const rawValue = String(this.value || "").trim().replace(",", ".");
                  const val = rawValue === "" ? NaN : Number(rawValue);
                  if (!Number.isFinite(val) || val < 0 || val > 100) {
                    window.alert("Gewichte müssen endliche Zahlen zwischen 0 und 100 sein.");
                    this.value = Number.isFinite(item.weightPercent)
                      ? item.weightPercent
                      : String(item.weightPercent ?? "");
                    return;
                  }
                  const templateId = wt.id;
                  const categoryId = cat.id;
                  try {
                    await commitStateChange(function (candidate) {
                      const template = (candidate.settings.weightTemplates || []).find(function (entry) { return entry.id === templateId; });
                      const category = (candidate.settings.categories || []).find(function (entry) { return entry.id === categoryId; });
                      if (!template || !category) throw new Error('Vorlage oder Kategorie ist nicht mehr verfügbar.');
                      if (!Array.isArray(template.items)) template.items = [];
                      let candidateItem = template.items.find(function (entry) { return entry.categoryId === categoryId; });
                      if (!candidateItem) {
                        candidateItem = { categoryId: categoryId, weightPercent: 0 };
                        template.items.push(candidateItem);
                      }
                      candidateItem.weightPercent = val;
                    });
                  } catch (error) {
                    const confirmed = (state.settings.weightTemplates || []).find(function (entry) { return entry.id === templateId; });
                    const confirmedItem = confirmed && confirmed.items.find(function (entry) { return entry.categoryId === categoryId; });
                    this.value = confirmedItem && Number.isFinite(confirmedItem.weightPercent) ? confirmedItem.weightPercent : 0;
                    if (!isStateCommitAborted(error)) window.alert('Das Gewicht konnte nicht gespeichert werden: ' + error.message);
                  }
                });
                tdWeight.appendChild(wInput);
                tr.appendChild(tdWeight);

                innerTbody.appendChild(tr);
              }

              innerTable.appendChild(innerTbody);
              card.appendChild(innerTable);

              // Summenanzeige
              const sumDiv = document.createElement("div");
              sumDiv.style.fontSize = "0.8rem";
              sumDiv.style.marginTop = "0.25rem";

              const hasInvalidWeight = wt.items.some(item =>
                typeof item.weightPercent !== "number" || !Number.isFinite(item.weightPercent) ||
                item.weightPercent < 0 || item.weightPercent > 100
              );
              if (hasInvalidWeight) {
                sumDiv.textContent = "Korrektur erforderlich: Gewichte müssen endliche Zahlen von 0 bis 100 sein.";
                sumDiv.style.color = "#c62828";
              } else {
                const sum = wt.items.reduce((acc, item) => acc + item.weightPercent, 0);
                sumDiv.textContent = "Summe: " + formatLegacyPercent(sum, { digits: 1, spaceBeforeSymbol: true });
                sumDiv.style.color = Math.abs(sum - 100) > 0.5
                  ? "#c62828"
                  : "var(--text-muted)";
              }

              card.appendChild(sumDiv);

              wtBox.appendChild(card);
            }
          }

          const wtAddBtn = document.createElement("button");
          wtAddBtn.type = "button";
          wtAddBtn.style.marginTop = "0.5rem";
          wtAddBtn.textContent = "Gewichtungsvorlage hinzufügen";
          wtAddBtn.addEventListener("click", async function () {
            try {
              await commitStateChange(function (candidate) {
                const items = (candidate.settings.categories || []).map(function (category) {
                  return { categoryId: category.id, weightPercent: 0 };
                });
                candidate.settings.weightTemplates.push(DomainModel.createWeightTemplate({
                  name: 'Neue Vorlage', items: items
                }));
              });
            } catch (error) {
              if (!isStateCommitAborted(error)) window.alert('Die Gewichtungsvorlage konnte nicht angelegt werden: ' + error.message);
            }
          });
          wtBox.appendChild(wtAddBtn);

          settingsAreaPanels.get('grading').appendChild(wtBox);

          // ---------------------------
          // 3) Sicherheit / Sitzungs-Timeout
          // ---------------------------
          const secBox = document.createElement("div");
          secBox.className = "info-box";

          const secTitle = document.createElement("strong");
          secTitle.textContent = "Sicherheit: Sitzungspasswort-Timeout";
          secBox.appendChild(secTitle);

          const secText = document.createElement("div");
          secText.style.fontSize = "0.85rem";
          secText.style.marginTop = "0.35rem";
          secText.style.marginBottom = "0.4rem";
          secText.textContent = "Hier kannst du festlegen, nach wie vielen Minuten Inaktivität das Sitzungspasswort automatisch aus dem Arbeitsspeicher entfernt wird. Kleinere Werte erhöhen die Sicherheit, größere Werte den Komfort.";
          secBox.appendChild(secText);

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '0.6rem';

          const label = document.createElement('label');
          label.textContent = 'Timeout (Minuten)';
          label.style.fontSize = '0.9rem';
          row.appendChild(label);

          const timeoutInput = document.createElement('input');
          timeoutInput.id = 'settings-session-timeout';
          timeoutInput.type = 'number';
          timeoutInput.min = '1';
          timeoutInput.step = '1';
          timeoutInput.style.width = '5.5rem';
          // Werte aus `state.settings` oder dem `Storage` laden, falls verfügbar
          try {
            const fromState = (state && state.settings && state.settings.sessionTimeoutMinutes) ? Number(state.settings.sessionTimeoutMinutes) : null;
            const fromStorageApi = (typeof Storage !== 'undefined' && Storage.getSessionTimeoutMinutes) ? Storage.getSessionTimeoutMinutes() : null;
            const val = fromState || fromStorageApi || 15;
            timeoutInput.value = val;
          } catch (e) {
            timeoutInput.value = 15;
          }
          label.setAttribute('for', timeoutInput.id);

          timeoutInput.addEventListener('change', async function () {
            const minutes = Math.max(1, Math.floor(Number(this.value) || 1));
            this.value = minutes;
            try {
              await commitStateChange(function (candidate) {
                candidate.settings.sessionTimeoutMinutes = minutes;
              });
              if (typeof Storage !== 'undefined' && Storage.setSessionTimeoutMinutes) Storage.setSessionTimeoutMinutes(minutes);
            } catch (error) {
              this.value = state.settings.sessionTimeoutMinutes || Storage.getSessionTimeoutMinutes() || 15;
              if (!isStateCommitAborted(error)) window.alert('Der Sitzungs-Timeout konnte nicht gespeichert werden: ' + error.message);
            }
          });

          row.appendChild(timeoutInput);

          const timeoutHint = document.createElement('div');
          timeoutHint.className = 'text-muted';
          timeoutHint.style.fontSize = '0.8rem';
          timeoutHint.style.marginLeft = '0.4rem';
          timeoutHint.textContent = '(Standard: 15 Minuten)';
          row.appendChild(timeoutHint);

          secBox.appendChild(row);

          // Passwort / Verschlüsselung: Status und Aktionen (einrichten / ändern)
          const pwRow = document.createElement('div');
          pwRow.style.display = 'flex';
          pwRow.style.alignItems = 'center';
          pwRow.style.gap = '0.6rem';
          pwRow.style.marginTop = '0.6rem';

          const pwStatus = document.createElement('div');
          pwStatus.className = 'text-muted';
          try {
            pwStatus.textContent = (typeof Storage !== 'undefined' && Storage.isEncrypted && Storage.isEncrypted()) ? 'Verschlüsselung: aktiviert' : 'Verschlüsselung: nicht aktiviert';
          } catch (e) {
            pwStatus.textContent = 'Verschlüsselungsstatus: unbekannt';
          }
          pwRow.appendChild(pwStatus);

          const pwBtn = document.createElement('button');
          pwBtn.type = 'button';
          try {
            pwBtn.textContent = (typeof Storage !== 'undefined' && Storage.isEncrypted && Storage.isEncrypted()) ? 'Passwort ändern' : 'Verschlüsselung einrichten';
          } catch (e) {
            pwBtn.textContent = 'Verschlüsselung verwalten';
          }

          pwBtn.addEventListener('click', async function () {
            const passwordDialogEpoch = uiStateEpoch;
            try {
              if (typeof Storage !== 'undefined' && Storage.isEncrypted && Storage.isEncrypted()) {
                const oldPw = await window.promptPassword({ message: 'Altes Passwort eingeben:', confirm: false });
                if (uiStateEpoch !== passwordDialogEpoch) return;
                if (!oldPw) return;
                const newPw = await window.promptPassword({ message: 'Neues Passwort eingeben:', confirm: true });
                if (uiStateEpoch !== passwordDialogEpoch) return;
                if (!newPw) return;
                if (newPw.length < 6) { try { window.alert('Bitte ein Passwort mit mindestens 6 Zeichen eingeben.'); } catch (e) {} return; }
                if (uiStateEpoch !== passwordDialogEpoch) return;
                try {
                  await runExclusiveStateOperation(async function (passwordEpoch) {
                    try {
                      await Storage.changePassword(oldPw, newPw);
                    } catch (error) {
                      await reconcileExclusiveState(passwordEpoch);
                      if (uiStateEpoch !== passwordEpoch) throw createStateCommitAbortedError();
                      throw error;
                    }
                    if (uiStateEpoch !== passwordEpoch) throw createStateCommitAbortedError();
                    if (!await reconcileExclusiveState(passwordEpoch)) throw createStateCommitAbortedError();
                  });
                  try { window.alert('Passwort erfolgreich geändert.'); } catch (e) {}
                } catch (err) {
                  if (!isStateCommitAborted(err)) {
                    console.error('Fehler beim Ändern des Passworts:', err);
                    try { window.alert('Passwortänderung fehlgeschlagen. Überprüfe das alte Passwort.'); } catch (e) {}
                  }
                }
              } else {
                const pw = await window.promptPassword({ message: 'Neues Passwort für die Verschlüsselung eingeben:', confirm: true });
                if (uiStateEpoch !== passwordDialogEpoch) return;
                if (!pw) { if (!Storage.isEncrypted()) Storage.lockSession(); return; }
                if (pw.length < 6) { try { window.alert('Bitte ein Passwort mit mindestens 6 Zeichen eingeben.'); } catch (e) {} ; return; }
                const encryptionEpoch = invalidateUiStateEpoch();
                try {
                  await Storage.enableEncryption(pw, state);
                  if (uiStateEpoch !== encryptionEpoch) return;
                  try { window.alert('Verschlüsselung aktiviert.'); } catch (e) {}
                  encryptionRequired = false;
                  render();
                } catch (err) {
                  console.error('Fehler beim Aktivieren der Verschlüsselung:', err);
                  try { window.alert('Aktivierung der Verschlüsselung fehlgeschlagen.'); } catch (e) {}
                }
              }
            } catch (e) {
              console.error('Fehler im Verschlüsselungs-Handler:', e);
              try { window.alert('Fehler beim Verarbeiten. Siehe Konsole.'); } catch (ex) {}
            }
          });

          pwRow.appendChild(pwBtn);
          secBox.appendChild(pwRow);

          // Sicherheit/Session-Timeout in eigenes Panel (passt thematisch besser)
          settingsAreaPanels.get('security').appendChild(secBox);

          // ---------------------------
          // 3) Grade-Mapping
          // ---------------------------
          const gmBox = document.createElement("div");
          gmBox.className = "info-box";

          const gmTitle = document.createElement("strong");
          gmTitle.textContent = "Grade-Mapping (numerische Hinterlegung der Noten)";
          gmBox.appendChild(gmTitle);

          const gmText = document.createElement("div");
          gmText.style.fontSize = "0.85rem";
          gmText.style.marginBottom = "0.4rem";
          gmText.textContent =
            "Hier wird festgelegt, welchen numerischen Wert eine Note (z. B. „2+“) für die Berechnung erhält. " +
            "Die Dezimalwerte sind eine schulinterne Rechenkonvention und keine amtliche Berliner Umrechnung. " +
            "Das Schema bildet die sechsstufige Sek-I-Notenskala ab; das gesonderte ISS-/Gemeinschaftsschul-System mit 0–15 Punkten nach Anlage 5 wird nicht unterstützt.";
          gmBox.appendChild(gmText);

          const gmTable = document.createElement("table");
          const gmThead = document.createElement("thead");
          const gmTr = document.createElement('tr');
          ['Notenlabel','numerischer Wert'].forEach(t => { const th = document.createElement('th'); th.textContent = t; gmTr.appendChild(th); });
          gmThead.appendChild(gmTr);
          gmTable.appendChild(gmThead);

          const gmTbody = document.createElement("tbody");

          const gradeOrder = new Map(DomainModel.STANDARD_GRADE_LABELS.map((label, index) => [label, index]));
          const gmEntries = Object.entries(state.settings.gradeMapping || {}).sort((a, b) => {
            const aRank = gradeOrder.has(a[0]) ? gradeOrder.get(a[0]) : Number.MAX_SAFE_INTEGER;
            const bRank = gradeOrder.has(b[0]) ? gradeOrder.get(b[0]) : Number.MAX_SAFE_INTEGER;
            return aRank !== bRank ? aRank - bRank : compareText(a[0], b[0]);
          });

          for (const [mappingIndex, entry] of gmEntries.entries()) {
            const label = entry[0];
            const tr = document.createElement("tr");

            const tdLabel = document.createElement("td");
            tdLabel.textContent = label;
            tr.appendChild(tdLabel);

            const tdValue = document.createElement("td");
            const valInput = document.createElement("input");
            valInput.id = 'settings-grade-mapping-' + mappingIndex;
            valInput.setAttribute('aria-label', 'Numerischer Wert für Note ' + label);
            valInput.style.width = "5rem";
            bindGradeMappingInput({
              input: valInput,
              readState: function () { return state; },
              label,
              commitStateChange,
              showAlert(message) { window.alert(message); }
            });
            tdValue.appendChild(valInput);

            tr.appendChild(tdValue);
            gmTbody.appendChild(tr);
          }

          gmTable.appendChild(gmTbody);
          gmBox.appendChild(gmTable);

          settingsAreaPanels.get('grading').appendChild(gmBox);

                    // --- Über diese Anwendung / Credits ---
          const creditsBox = document.createElement("div");
          creditsBox.className = "info-box";

          const creditsText1 = document.createElement("div");
          creditsText1.style.fontSize = "0.85rem";
          creditsText1.style.marginTop = "0.25rem";
          creditsText1.textContent =
            getSchoolProfile().name
              ? 'Notenverwaltung – Schule: ' + getSchoolProfile().name
              : 'Notenverwaltung für Lehrkräfte.';
          creditsBox.appendChild(creditsText1);

          const versionText = document.createElement("div");
          versionText.style.fontSize = "0.85rem";
          versionText.style.marginTop = "0.25rem";
          versionText.textContent =
            "Programmversion " + APP_RELEASE.version + " · Stand " + APP_RELEASE.dateLabel;
          creditsBox.appendChild(versionText);

          const creditsText2 = document.createElement("div");
          creditsText2.style.fontSize = "0.85rem";
          creditsText2.className = "text-muted";
          creditsText2.textContent =
            "Entwicklung: Marco Civico, 2025 mit Unterstützung durch KI";
          creditsBox.appendChild(creditsText2);

          const creditsText4 = document.createElement("div");
          creditsText4.style.fontSize = "0.85rem";
          creditsText4.className = "text-muted";
          creditsText4.textContent =
            "Getestet, weitergedacht und bereichert von 🙏✨ Milena Schmidt, Marie-Lisette Killmer & Friederike Lerbs";
          creditsBox.appendChild(creditsText4);


          const creditsText3 = document.createElement("div");
          creditsText3.style.fontSize = "0.8rem";
          creditsText3.style.marginTop = "0.25rem";
          creditsText3.className = "text-muted";
          creditsText3.textContent =
            "Hinweis: Die Anwendung wird ohne Gewähr bereitgestellt. Die fachliche und rechtliche Verantwortung für " +
            "Noten und Bewertungen liegt bei den nutzenden Lehrkräften.";
          creditsBox.appendChild(creditsText3);

          settingsAreaPanels.get('about').appendChild(creditsBox);

          settingsLayout.appendChild(settingsNavigation);
          settingsLayout.appendChild(settingsContent);
          section.appendChild(settingsLayout);
          selectSettingsArea(settingsActiveArea, false);
          container.appendChild(section);
        }


        function renderImportSection(container) {
          const section = document.createElement("section");
          section.className = "section transfer-section";

          const h2 = document.createElement("h2");
          h2.textContent = "Import / Export";
          section.appendChild(h2);

          const hint = document.createElement("div");
          hint.className = "section-hint";
          hint.textContent =
            "Exportiere Kurs- und Personenzuordnungen, stelle einen verschlüsselten Datenbestand wieder her oder importiere Kurse und Schüler:innen per CSV. " +
            "Eine neue verschlüsselte Sicherung erstellst du über „Backup“ in der Kopfleiste.";
          section.appendChild(hint);

          const transferTabs = document.createElement("div");
          transferTabs.className = "transfer-tabs";
          transferTabs.setAttribute("role", "tablist");
          transferTabs.setAttribute("aria-label", "Import- und Exportbereiche");
          section.appendChild(transferTabs);

          const transferPanels = document.createElement("div");
          transferPanels.className = "transfer-panels";
          section.appendChild(transferPanels);

          const transferAreaDefinitions = [
            { id: "export", label: "Export" },
            { id: "backup", label: "Backup wiederherstellen" },
            { id: "csv", label: "CSV-Import" }
          ];
          const transferTabButtons = new Map();
          const transferPanelElements = new Map();

          for (const definition of transferAreaDefinitions) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "transfer-tab";
            button.id = "transfer-tab-" + definition.id;
            button.textContent = definition.label;
            button.setAttribute("role", "tab");
            button.setAttribute("data-transfer-area", definition.id);
            button.setAttribute("aria-controls", "transfer-panel-" + definition.id);
            transferTabs.appendChild(button);
            transferTabButtons.set(definition.id, button);

            const panel = document.createElement("section");
            panel.className = "transfer-panel";
            panel.id = "transfer-panel-" + definition.id;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("data-transfer-panel", definition.id);
            panel.setAttribute("aria-labelledby", button.id);
            transferPanels.appendChild(panel);
            transferPanelElements.set(definition.id, panel);
          }

          function selectTransferArea(areaId, focusTab) {
            if (!transferPanelElements.has(areaId)) return;
            for (const definition of transferAreaDefinitions) {
              const selected = definition.id === areaId;
              const button = transferTabButtons.get(definition.id);
              const panel = transferPanelElements.get(definition.id);
              button.setAttribute("aria-selected", selected ? "true" : "false");
              button.tabIndex = selected ? 0 : -1;
              button.classList.toggle("transfer-tab--active", selected);
              panel.hidden = !selected;
              panel.classList.toggle("hidden", !selected);
            }
            if (focusTab) transferTabButtons.get(areaId).focus();
          }

          transferAreaDefinitions.forEach(function (definition, index) {
            const button = transferTabButtons.get(definition.id);
            button.addEventListener("click", function () {
              selectTransferArea(definition.id, false);
            });
            button.addEventListener("keydown", function (event) {
              let nextIndex = null;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % transferAreaDefinitions.length;
              if (event.key === "ArrowLeft") nextIndex = (index - 1 + transferAreaDefinitions.length) % transferAreaDefinitions.length;
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = transferAreaDefinitions.length - 1;
              if (nextIndex === null) return;
              event.preventDefault();
              selectTransferArea(transferAreaDefinitions[nextIndex].id, true);
            });
          });

          // ---------------------------
          // 0) Kurs-/Klassen-Export
          // ---------------------------
          function formatCsvTransferContextFields(course, enrollment) {
            if (!course || course.schemaMode !== DomainModel.SCHEMA_MODES.UPPERSEC) {
              return ["Sek I", "", "", ""];
            }
            const context = course.upperSecContext || {};
            const courseTypeLabels = {
              [DomainModel.UPPERSEC_COURSE_TYPES.BASIC]: "GK",
              [DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED]: "LK",
              [DomainModel.UPPERSEC_COURSE_TYPES.OTHER]: "Sonstiger Kurs"
            };
            const qualificationYearLabels = {
              [DomainModel.QUALIFICATION_YEARS.Q1_Q2]: "Q1/Q2",
              [DomainModel.QUALIFICATION_YEARS.Q3_Q4]: "Q3/Q4"
            };
            return [
              "Sek II",
              courseTypeLabels[context.courseType] || "",
              qualificationYearLabels[context.qualificationYear] || "",
              enrollment && context.courseType === DomainModel.UPPERSEC_COURSE_TYPES.BASIC &&
                context.qualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4
                ? (enrollment.writtenExamSubjectQ4 === true ? "Ja" : "Nein")
                : ""
            ];
          }

          function downloadTextFile(content, mimeType, filename) {
            // Gemeinsame Download-Hilfe, damit CSV- und Excel-Export identisch ausgeloest werden.
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }

          function getSelectedTransferCourses(selectEl) {
            if (!state.courses || state.courses.length === 0) return [];
            if (!selectEl || selectEl.value === "__all__") {
              return DomainModel.listActiveCourses(state);
            }
            const course = state.courses.find(c => c.id === selectEl.value);
            return course ? [course] : [];
          }

          function buildTransferRows(courses) {
            const rows = [];
            for (const course of courses) {
              const enrollments = DomainModel.listEnrollmentsForCourse(state, course.id) || [];
              if (enrollments.length === 0) {
                rows.push({ course, student: null, enrollment: null });
                continue;
              }
              for (const enr of enrollments) {
                rows.push({
                  course,
                  student: DomainModel.findStudentById(state, enr.studentId),
                  enrollment: enr
                });
              }
            }
            return rows;
          }

          function exportTransferCsv(courses) {
            const rows = buildTransferRows(courses);
            if (rows.length === 0) {
              window.alert("Es sind keine Kurse für den Export vorhanden.");
              return;
            }

            const lines = [];
            lines.push("KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz");
            for (const row of rows) {
              const c = row.course;
              const s = row.student;
              const classLabel = c.classLabel || "";
              const homeClass = (row.enrollment && row.enrollment.homeClassAtEnrollment) || (s && s.homeClass) || "";
              const fields = [
                c.importKey || c.id || "",
                c.name || "",
                c.subject || "",
                classLabel,
                s ? s.id : "",
                s ? s.lastName : "",
                s ? s.firstName : "",
                s ? s.birthDate : ""
              ];
              fields.push(...formatCsvTransferContextFields(c, row.enrollment));
              fields.push(homeClass);
              lines.push(encodeCsvTransferRow(fields));
            }

            const date = formatUtcDateStamp(new Date());
            const suffix = courses.length === 1 ? ((courses[0].name || "kurs").replace(/[^\w-]+/g, "_")) : "alle_kurse";
            downloadTextFile("\ufeff" + lines.join("\n"), "text/csv;charset=utf-8", "notenverwaltung_kurs_export_" + suffix + "_" + date + ".csv");
          }

          function exportTransferExcel(courses) {
            const rows = buildTransferRows(courses);
            if (rows.length === 0) {
              window.alert("Es sind keine Kurse für den Export vorhanden.");
              return Promise.resolve(false);
            }

            function getExcelBackgroundForValue(course, value) {
              // Farbskala wie in der Notenübersicht: grün = stark, rot = kritisch.
              if (value === null || value === undefined || !Number.isFinite(value)) return "";
              if (course.schemaMode === DomainModel.SCHEMA_MODES.GRADES) {
                if (value <= 1.5) return "#c8e6c9";
                if (value <= 2.5) return "#dcedc8";
                if (value <= 3.5) return "#fff9c4";
                if (value <= 4.5) return "#ffe0b2";
                return "#ffcdd2";
              }
              if (value >= 13) return "#c8e6c9";
              if (value >= 10) return "#dcedc8";
              if (value >= 7) return "#fff9c4";
              if (value >= 4) return "#ffe0b2";
              return "#ffcdd2";
            }

            function getTermLabelForExcel(asm, course, settingsForCourse = state.settings) {
              const term = typeof asm === 'string' ? asm : asm && asm.term;
              return GradingLogic.formatCourseTermLabel(term, course, settingsForCourse);
            }

            function buildAssessmentTitleForExcel(asm, course, settingsForCourse = state.settings) {
              const parts = [asm.title || "Leistung"];
              const category = (settingsForCourse.categories || []).find(c => c.id === asm.categoryId);
              if (asm.subcategoryId && category && Array.isArray(category.subcategories)) {
                const subcat = category.subcategories.find(sc => sc.id === asm.subcategoryId);
                if (subcat && subcat.name) parts.push(subcat.name);
              }
              if (asm.date) parts.push(asm.date);
              const termLabel = getTermLabelForExcel(asm, course, settingsForCourse);
              if (termLabel) parts.push(termLabel);
              return parts.map(part => String(part)).join("\n");
            }

            function getWrappedExcelRowHeight(text, widthCharacters, fontSize, minimumHeight) {
              const safeWidth = Math.max(1, Number(widthCharacters) || 1);
              const safeFontSize = Math.max(1, Number(fontSize) || 11);
              // Excel column widths are based on digit width. Reserve space for Arial bold
              // text, wide glyphs and word-boundary wrapping instead of assuming every width
              // unit can hold a complete average character.
              const charactersPerLine = Math.max(1, Math.floor(safeWidth * 0.8 * (11 / safeFontSize)));
              const lineCount = String(text == null ? "" : text)
                .replace(/\r\n?/g, "\n")
                .split("\n")
                .reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)), 0);
              const lineHeight = Math.max(safeFontSize + 4, safeFontSize * 1.35);
              // Excel accepts a maximum custom row height of 409 points.
              return Math.min(409, Math.max(minimumHeight, Math.ceil(lineCount * lineHeight)));
            }

            const borderStyle = {
              borderColor: "#94a3b8",
              borderStyle: "thin",
              alignVertical: "center"
            };
            const valueStyle = { ...borderStyle, align: "center", wrap: true };
            const categoryHeaderStyle = {
              ...borderStyle,
              backgroundColor: "#dbeafe",
              fontWeight: "bold",
              align: "center",
              wrap: true,
              height: 28
            };
            const assessmentHeaderStyle = {
              ...borderStyle,
              backgroundColor: "#eff6ff",
              fontWeight: "bold",
              align: "center",
              wrap: true
            };
            const averageHeaderStyle = {
              ...borderStyle,
              backgroundColor: "#e2e8f0",
              fontWeight: "bold",
              align: "center",
              wrap: true
            };

            function createSpanningRow(text, columnCount, style) {
              return [
                createExcelTextCell(text, { ...style, columnSpan: columnCount }),
                ...Array(Math.max(0, columnCount - 1)).fill(null)
              ];
            }

            function createValueCell(course, value, numericForColor) {
              const backgroundColor = getExcelBackgroundForValue(course, numericForColor);
              const style = backgroundColor ? { ...valueStyle, backgroundColor } : valueStyle;
              return createExcelTextCell(value, style);
            }

            function createNumericValueCell(course, value) {
              const backgroundColor = getExcelBackgroundForValue(course, value);
              const style = backgroundColor ? { ...valueStyle, backgroundColor } : valueStyle;
              return createExcelNumberCell(value, style);
            }

            function createScoreCell(course, presentation) {
              const text = String(presentation && presentation.text != null ? presentation.text : "");
              const numeric = presentation && presentation.numeric;
              const isModifiedSekIGrade = course.schemaMode === DomainModel.SCHEMA_MODES.GRADES &&
                /^[1-6][+-]$/.test(text.trim());
              if (Number.isFinite(numeric) && !isModifiedSekIGrade) {
                return createNumericValueCell(course, numeric);
              }
              return createValueCell(course, text, numeric);
            }

            function buildCourseWorksheet(course, sheetName, generatedAt) {
              const gradingSettings = GradingLogic.getSettingsForCourse(course, state);
              const gradingState = { ...state, settings: gradingSettings };
              const studentIds = course.archivedAt
                ? DomainModel.listReferencedStudentIdsForCourse(state, course.id)
                : new Set((DomainModel.listEnrollmentsForCourse(state, course.id) || []).map(enrollment => enrollment.studentId));
              const students = Array.from(studentIds)
                .map(studentId => DomainModel.findStudentById(state, studentId))
                .filter(Boolean)
                .sort((a, b) => (compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName)));

              const assessments = (DomainModel.listAssessmentsForCourse(state, course.id) || [])
                .slice()
                .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || compareText(a.title, b.title));
              const resultScope = GradingLogic.resolveGradingResultScope(course, state);
              const categoriesById = new Map((gradingSettings.categories || []).map(c => [c.id, c]));
              const groups = [];
              const assessmentTerms = assessments.map(assessment => getAssessmentTerm(
                assessment,
                course,
                date => resolveAssessmentTermFromDateValue(date, course, gradingSettings)
              ));
              const reportedTerms = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                ? Array.from(new Set(students.flatMap(student =>
                  listReportedTermsForStudent(course, student.id, assessmentTerms)
                ))).sort()
                : [];

              for (const category of (gradingSettings.categories || [])) {
                const catAssessments = assessments.filter(a => a.categoryId === category.id);
                if (catAssessments.length > 0) {
                  groups.push({ category, assessments: catAssessments });
                }
              }
              for (const asm of assessments) {
                if (!categoriesById.has(asm.categoryId)) {
                  let other = groups.find(g => g.category.id === "__other__");
                  if (!other) {
                    other = { category: { id: "__other__", name: "Ohne Kategorie" }, assessments: [] };
                    groups.push(other);
                  }
                  other.assessments.push(asm);
                }
              }

              const assessmentCount = groups.reduce((sum, g) => sum + g.assessments.length, 0);
              const avgColCount = groups.length + 1 + reportedTerms.length * 2;
              const columnCount = 1 + assessmentCount + avgColCount;
              const averageColumns = [
                ...groups.map(() => ({ width: 18 })),
                { width: 20 },
                ...reportedTerms.flatMap(() => [{ width: 34 }, { width: 24 }])
              ];
              const columns = [
                { width: 28 },
                ...Array(assessmentCount).fill(null).map(() => ({ width: 18 })),
                ...averageColumns
              ];
              const totalColumnWidth = columns.reduce((sum, column) => sum + column.width, 0);
              const data = [];
              const title = (course.name || "Kurs") + (course.classLabel ? " (" + course.classLabel + ")" : "");
              data.push(createSpanningRow(title, columnCount, {
                fontSize: 16,
                fontWeight: "bold",
                align: "left",
                alignVertical: "center",
                backgroundColor: "#f8fafc",
                wrap: true,
                height: getWrappedExcelRowHeight(title, totalColumnWidth, 16, 28)
              }));
              const subjectText = "Fach: " + (course.subject || "-");
              data.push(createSpanningRow(subjectText, columnCount, {
                fontSize: 11,
                textColor: "#475569",
                align: "left",
                wrap: true,
                height: getWrappedExcelRowHeight(subjectText, totalColumnWidth, 11, 15)
              }));
              const metadataText =
                "Erstellt am " + generatedAt + " mit der Notenverwaltung. Diese Excel-Datei ist eine lesbare Übergabeansicht und nicht für den Re-Import gedacht.";
              data.push(createSpanningRow(
                metadataText,
                columnCount,
                {
                  fontSize: 10,
                  textColor: "#475569",
                  align: "left",
                  wrap: true,
                  height: getWrappedExcelRowHeight(metadataText, totalColumnWidth, 10, 30)
                }
              ));
              data.push(Array(columnCount).fill(null));

              const groupHeaderRow = [createExcelTextCell("Schüler", {
                ...categoryHeaderStyle,
                backgroundColor: "#f8fafc",
                align: "left",
                rowSpan: 2
              })];

              for (const g of groups) {
                const categoryName = g.category.name || "Kategorie";
                groupHeaderRow.push(createExcelTextCell(categoryName, {
                  ...categoryHeaderStyle,
                  columnSpan: g.assessments.length,
                  height: getWrappedExcelRowHeight(categoryName, 18 * g.assessments.length, 11, 28)
                }));
                for (let index = 1; index < g.assessments.length; index += 1) groupHeaderRow.push(null);
              }
              const averageGroupTitle = "Durchschnittswerte";
              groupHeaderRow.push(createExcelTextCell(averageGroupTitle, {
                ...averageHeaderStyle,
                columnSpan: avgColCount,
                height: getWrappedExcelRowHeight(
                  averageGroupTitle,
                  averageColumns.reduce((sum, column) => sum + column.width, 0),
                  11,
                  42
                )
              }));
              for (let index = 1; index < avgColCount; index += 1) groupHeaderRow.push(null);
              data.push(groupHeaderRow);

              const columnHeaderRow = [null];

              for (const g of groups) {
                for (const asm of g.assessments) {
                  const assessmentTitle = buildAssessmentTitleForExcel(asm, course, gradingSettings);
                  columnHeaderRow.push(createExcelTextCell(
                    assessmentTitle,
                    {
                      ...assessmentHeaderStyle,
                      height: getWrappedExcelRowHeight(assessmentTitle, 18, 11, 42)
                    }
                  ));
                }
              }
              for (const g of groups) {
                const averageTitle = "Ø " + (g.category.name || "Kategorie");
                columnHeaderRow.push(createExcelTextCell(averageTitle, {
                  ...averageHeaderStyle,
                  height: getWrappedExcelRowHeight(averageTitle, 18, 11, 42)
                }));
              }
              const overallTitle = course.schemaMode === DomainModel.SCHEMA_MODES.UPPERSEC
                ? 'Rechenwert gesamt' : 'Ø Gesamt';
              columnHeaderRow.push(createExcelTextCell(overallTitle, {
                ...averageHeaderStyle,
                height: getWrappedExcelRowHeight(overallTitle, 20, 11, 42)
              }));
              for (const term of reportedTerms) {
                const termLabel = getTermLabelForExcel(term, course, gradingSettings);
                const calculatedTitle = "Rechenwert " + termLabel;
                const finalizedTitle = "Festgesetzte Punktzahl " + termLabel;
                columnHeaderRow.push(createExcelTextCell(calculatedTitle, {
                  ...averageHeaderStyle,
                  height: getWrappedExcelRowHeight(calculatedTitle, 34, 11, 42)
                }));
                columnHeaderRow.push(createExcelTextCell(finalizedTitle, {
                  ...averageHeaderStyle,
                  height: getWrappedExcelRowHeight(finalizedTitle, 24, 11, 42)
                }));
              }
              data.push(columnHeaderRow);

              if (students.length === 0) {
                data.push(createSpanningRow("Keine eingeschriebenen Schüler:innen.", columnCount, {
                  ...borderStyle,
                  textColor: "#64748b",
                  align: "left",
                  wrap: true
                }));
              }

              for (const student of students) {
                const manualDecisionWarnings = [];
                const studentRow = [createExcelTextCell(
                  (student.lastName || "") + ", " + (student.firstName || ""),
                  { ...borderStyle, align: "left", backgroundColor: "#f8fafc", fontWeight: "bold" }
                )];
                for (const g of groups) {
                  for (const asm of g.assessments) {
                    const scorePresentation = formatReportScorePresentation(
                      course, asm, student.id, gradingSettings, 'internal'
                    );
                    studentRow.push(createScoreCell(course, scorePresentation));
                  }
                }
                for (const g of groups) {
                  const catAvg = GradingLogic.computeCategoryAverage(resultScope.assessments, course, student.id, g.category.id, gradingSettings);
                  studentRow.push(Number.isFinite(catAvg)
                    ? createNumericValueCell(course, catAvg)
                    : createValueCell(course, "", null));
                }
                const overall = GradingLogic.computeOverallGrade(course, student.id, gradingState);
                studentRow.push(Number.isFinite(overall)
                  ? createNumericValueCell(course, overall)
                  : createValueCell(course, "", null));
                for (const term of reportedTerms) {
                  const presentation = buildUpperSecContextPresentation(course, student.id, term, state);
                  const calculated = Number(presentation.calculatedText);
                  studentRow.push(createValueCell(course,
                    presentation.qualificationPhase + ' ' + presentation.examRequirementLabel + ': ' +
                      (formatDecimalComma(calculated, { digits: 2, trimTrailingZeros: true }) ?? ''),
                    calculated
                  ));
                  studentRow.push(Number.isInteger(presentation.finalizedPoints)
                    ? createNumericValueCell(course, presentation.finalizedPoints)
                    : createValueCell(course, "", null));
                  if (presentation.manualDecisionWarning) {
                    manualDecisionWarnings.push(
                      getTermLabelForExcel(term, course, gradingSettings) + ': ' + presentation.manualDecisionWarning
                    );
                  }
                }
                data.push(studentRow);
                for (const warning of manualDecisionWarnings) {
                  const warningText =
                    "Fachlicher Warnhinweis: " + (student.lastName || "") + ", " +
                    (student.firstName || "") + ": " + warning;
                  data.push(createSpanningRow(
                    warningText,
                    columnCount,
                    {
                      ...borderStyle,
                      backgroundColor: "#fff7ed",
                      textColor: "#9a3412",
                      fontWeight: "bold",
                      align: "left",
                      wrap: true,
                      height: getWrappedExcelRowHeight(warningText, totalColumnWidth, 11, 30)
                    }
                  ));
                }
              }

              return {
                sheet: sheetName,
                data,
                columns,
                orientation: "landscape",
                stickyRowsCount: 6,
                stickyColumnsCount: 1,
                showGridLines: false,
                zoomScale: 0.9
              };
            }

            const generatedAt = formatInstant(new Date(), {
              locale: DISPLAY_LOCALE,
              timeZone: DISPLAY_TIME_ZONE,
              includeTime: true
            });
            const sheetNames = createUniqueWorksheetNames(courses.map(course => course.name || "Kurs"));
            const sheets = courses.map((course, index) => buildCourseWorksheet(course, sheetNames[index], generatedAt));
            const date = formatUtcDateStamp(new Date());
            const suffix = courses.length === 1 ? ((courses[0].name || "kurs").replace(/[^\w-]+/g, "_")) : "alle_kurse";
            const filename = "notenverwaltung_kurs_export_" + suffix + "_" + date + ".xlsx";
            let sessionClearedWhilePending = false;
            const markSessionCleared = function () { sessionClearedWhilePending = true; };
            try { window.addEventListener("sessionCleared", markSessionCleared); } catch (e) {}
            return Promise.resolve()
              .then(function () { return createExcelWorkbookBlob(sheets); })
              .then(function (blob) {
                if (sessionClearedWhilePending) return false;
                downloadBlobFile(blob, EXCEL_XLSX_MIME_TYPE, filename);
                return true;
              })
              .finally(function () {
                try { window.removeEventListener("sessionCleared", markSessionCleared); } catch (e) {}
              });
          }

          const transferExportBox = document.createElement("div");
          transferExportBox.className = "info-box transfer-card transfer-export-card";

          const transferExportTitle = document.createElement("h3");
          transferExportTitle.textContent = "Kurse / Klassen exportieren";
          transferExportBox.appendChild(transferExportTitle);

          const transferExportText = document.createElement("div");
          transferExportText.className = "transfer-card-intro";
          transferExportText.textContent =
            "CSV überträgt Kurs- und Schülerzuordnungen für den Import in diese Notenverwaltung. Excel erstellt eine lesbare Notenübersicht für Kolleg:innen.";
          transferExportBox.appendChild(transferExportText);

          const transferExportRow = document.createElement("div");
          transferExportRow.className = "transfer-export-controls";

          const transferExportSelection = document.createElement("div");
          transferExportSelection.className = "transfer-field";

          const transferExportLabel = document.createElement("label");
          transferExportLabel.setAttribute("for", "transfer-course-select");
          transferExportLabel.textContent = "Kurs / Klasse für Export";
          transferExportSelection.appendChild(transferExportLabel);

          const transferCourseSelect = document.createElement("select");
          transferCourseSelect.id = "transfer-course-select";
          const allCoursesOption = document.createElement("option");
          allCoursesOption.value = "__all__";
          allCoursesOption.textContent = "Alle aktiven Kurse / Klassen";
          transferCourseSelect.appendChild(allCoursesOption);
          for (const c of state.courses || []) {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = (c.archivedAt ? "[Archiv] " : "") + c.name + (c.classLabel ? " (" + c.classLabel + ")" : "");
            if (c.id === currentCourseId) opt.selected = true;
            transferCourseSelect.appendChild(opt);
          }
          transferCourseSelect.value = (state.courses || []).some(c => c.id === currentCourseId)
            ? currentCourseId
            : "__all__";
          transferExportSelection.appendChild(transferCourseSelect);
          transferExportRow.appendChild(transferExportSelection);

          const transferExportActions = document.createElement("div");
          transferExportActions.className = "transfer-actions";

          const exportCsvBtn = document.createElement("button");
          exportCsvBtn.type = "button";
          exportCsvBtn.textContent = "CSV für Import exportieren";
          exportCsvBtn.addEventListener("click", function () {
            try {
              exportTransferCsv(getSelectedTransferCourses(transferCourseSelect));
            } catch (err) {
              console.error("Fehler beim Kurs-/Klassen-CSV-Export:", err);
              window.alert("CSV-Export fehlgeschlagen. Details siehe Konsole.");
            }
          });
          transferExportActions.appendChild(exportCsvBtn);

          function handleTransferExcelExport(button, selectEl) {
            if (button.disabled) return Promise.resolve(false);
            let sessionClearedWhilePending = false;
            const markSessionCleared = function () { sessionClearedWhilePending = true; };
            const finishActiveUi = function () {
              if (sessionClearedWhilePending) return;
              button.disabled = false;
              button.removeAttribute("aria-busy");
            };
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            try { window.addEventListener("sessionCleared", markSessionCleared); } catch (e) {}
            let selectedCourses;
            try {
              selectedCourses = getSelectedTransferCourses(selectEl);
            } catch (err) {
              try { window.removeEventListener("sessionCleared", markSessionCleared); } catch (e) {}
              console.error("Fehler beim Kurs-/Klassen-Excel-Export:", err);
              window.alert("Excel-Export fehlgeschlagen. Details siehe Konsole.");
              finishActiveUi();
              return Promise.resolve(false);
            }
            return Promise.resolve()
              .then(function () {
                return sessionClearedWhilePending ? false : exportTransferExcel(selectedCourses);
              })
              .then(function (completed) {
                return sessionClearedWhilePending ? false : completed;
              })
              .catch(function (err) {
                if (!sessionClearedWhilePending) {
                  console.error("Fehler beim Kurs-/Klassen-Excel-Export:", err);
                  window.alert("Excel-Export fehlgeschlagen. Details siehe Konsole.");
                }
                return false;
              })
              .finally(function () {
                try { window.removeEventListener("sessionCleared", markSessionCleared); } catch (e) {}
                finishActiveUi();
              });
          }

          const exportExcelBtn = document.createElement("button");
          exportExcelBtn.type = "button";
          exportExcelBtn.textContent = "Excel für Kolleg:innen exportieren";
          exportExcelBtn.addEventListener("click", function () {
            handleTransferExcelExport(exportExcelBtn, transferCourseSelect);
          });
          transferExportActions.appendChild(exportExcelBtn);

          transferExportRow.appendChild(transferExportActions);

          transferExportBox.appendChild(transferExportRow);

          const transferExportHint = document.createElement("div");
          transferExportHint.style.fontSize = "0.8rem";
          transferExportHint.style.marginTop = "0.3rem";
          transferExportHint.className = "text-muted";
          transferExportHint.textContent =
            "Beide Formate dienen der Weitergabe und sind kein vollständiges verschlüsseltes Backup des Datenbestands.";
          transferExportBox.appendChild(transferExportHint);

          if (DomainModel.listActiveCourses(state).length === 0) {
            const transferExportEmpty = document.createElement("p");
            transferExportEmpty.className = "transfer-empty text-muted";
            transferExportEmpty.textContent = "Es sind keine aktiven Kurse vorhanden. Archivierte Kurse bleiben einzeln auswählbar.";
            transferExportBox.appendChild(transferExportEmpty);
          }

          transferPanelElements.get("export").appendChild(transferExportBox);

          // ---------------------------
          // 1) JSON-Backup (Export / Import)
          // ---------------------------
          const jsonBox = document.createElement("div");
          jsonBox.className = "info-box transfer-card transfer-backup-card";

          const jsonTitle = document.createElement("h3");
          jsonTitle.textContent = "Verschlüsseltes Backup wiederherstellen";
          jsonBox.appendChild(jsonTitle);

          const jsonText = document.createElement("div");
          jsonText.className = "transfer-card-intro";
          jsonText.textContent =
            "Eine Backup-Datei kann den gesamten Datenbestand mit Schüler:innen, Kursen, Leistungen und Archiven enthalten. " +
            "Standardmäßig ersetzt der geprüfte Import den aktuellen Bestand. Aktiviere den Merge-Modus, um ihn stattdessen zusammenzuführen. Eine neue Sicherung erstellst du über „Backup“ in der Kopfleiste.";
          jsonBox.appendChild(jsonText);

          const jsonRow = document.createElement("div");
          jsonRow.className = "transfer-form-row";

          // JSON importieren (File-Input)
          const importWrapper = document.createElement("div");
          importWrapper.className = "transfer-field";

          const importLabel = document.createElement("label");
          importLabel.setAttribute("for", "json-import-file");
          importLabel.textContent = "Backup-Datei auswählen";

          // Merge-Option: Standard = Ersetzen. Wenn aktiviert, wird die Datei mit dem bestehenden State zusammengeführt.
          const mergeRow = document.createElement('div');
          mergeRow.className = 'transfer-merge-option';
          mergeRow.style.display = 'flex';
          mergeRow.style.alignItems = 'center';
          mergeRow.style.gap = '0.5rem';

          const mergeCheckbox = document.createElement('input');
          mergeCheckbox.type = 'checkbox';
          mergeCheckbox.id = 'json-import-merge-checkbox';
          mergeCheckbox.checked = false;
          const mergeLabel = document.createElement('label');
          mergeLabel.htmlFor = 'json-import-merge-checkbox';
          mergeLabel.style.fontSize = '0.8rem';
          mergeLabel.textContent = 'Beim Import mit aktuellem Datenbestand zusammenführen (Merge-Modus)';
          mergeRow.appendChild(mergeCheckbox);
          mergeRow.appendChild(mergeLabel);
          importWrapper.appendChild(mergeRow);

          const fileInputJson = document.createElement("input");
          fileInputJson.id = "json-import-file";
          fileInputJson.type = "file";
          fileInputJson.accept = "application/json";

          async function commitImportedState(parsedState, sourceLabel, mergeMode) {
            validateRawTermResults(parsedState);
            validateRawUpperSecContexts(parsedState);
            validateImportedState(parsedState);
            let incoming = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(parsedState)));
            validateImportedState(incoming);
            let candidate;
            let mergeSummary = null;
            if (mergeMode) {
              const merged = mergeImportedStateIntoCurrent(state, incoming);
              candidate = merged.state; mergeSummary = merged.summary;
            } else {
              candidate = incoming;
              // Halbjahresgrenzen und -namen sind lokale App-Einstellungen und werden nicht aus Backups übernommen.
              if (state.settings?.halfYearSettings) candidate.settings.halfYearSettings = JSON.parse(JSON.stringify(state.settings.halfYearSettings));
              if (state.settings?.halfYearNames) candidate.settings.halfYearNames = JSON.parse(JSON.stringify(state.settings.halfYearNames));
            }
            validateImportedState(candidate);
            const modeText = mergeMode ? 'zusammenführen' : 'vollständig ersetzen';
            const details = candidate.students.length + ' Schüler:innen, ' + candidate.courses.length + ' Kurse, ' + candidate.assessments.length + ' Leistungen';
            if (!window.confirm(sourceLabel + ' wurde geprüft.\n\nZiel: ' + modeText + '\nErgebnis: ' + details + (mergeSummary ? '\nLeistungsmetadaten-Konflikte (lokale Werte bleiben): ' + mergeSummary.assessmentMetadataConflicts + '\nScore-Konflikte (vorhandener Wert bleibt): ' + mergeSummary.scoreConflicts + '\nFestsetzungs-Konflikte (lokaler Wert bleibt): ' + mergeSummary.termResultConflicts + '\nSek-II-Kontextkonflikte (lokaler Wert bleibt): ' + mergeSummary.upperSecContextConflicts + '\nQ4-Prüfungsfach-Konflikte (lokaler Wert bleibt): ' + mergeSummary.writtenExamSubjectConflicts + '\nÜbersprungene Archivänderungen: ' + mergeSummary.archiveConflicts : '') + '\n\nJetzt übernehmen?')) return false;
            if (!mergeMode && !window.confirm('Der aktuelle Datenbestand wird ersetzt. Diese Aktion kann nur mit einem vorhandenen Backup rückgängig gemacht werden. Wirklich ersetzen?')) return false;
            if (mergeMode) {
              let actualSummary = null;
              await commitStateChange(function (currentCandidate) {
                const actualMerge = mergeImportedStateIntoCurrent(currentCandidate, incoming);
                validateImportedState(actualMerge.state);
                actualSummary = actualMerge.summary;
                overwriteStateObject(currentCandidate, actualMerge.state);
              }, { render: false });
              mergeSummary = actualSummary;
            } else {
              const incomingReplacement = JSON.parse(JSON.stringify(incoming));
              await runExclusiveStateOperation(async function (importEpoch) {
                try {
                  const persistedBefore = await Storage.loadCurrentSessionState();
                  if (uiStateEpoch !== importEpoch) throw createStateCommitAbortedError();
                  const replacement = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(incomingReplacement)));
                  if (persistedBefore.settings?.halfYearSettings) replacement.settings.halfYearSettings = JSON.parse(JSON.stringify(persistedBefore.settings.halfYearSettings));
                  if (persistedBefore.settings?.halfYearNames) replacement.settings.halfYearNames = JSON.parse(JSON.stringify(persistedBefore.settings.halfYearNames));
                  validateImportedState(replacement);
                  await Storage.replaceState(replacement);
                  if (uiStateEpoch !== importEpoch) throw createStateCommitAbortedError();
                  state = replacement;
                } catch (error) {
                  await reconcileExclusiveState(importEpoch);
                  throw error;
                }
              });
            }
            currentCourseId = DomainModel.listActiveCourses(state)[0]?.id || null;
            settingsPeriodDrafts = null;
            render();
            window.alert('Import erfolgreich und verschlüsselt gespeichert.' + (mergeSummary
              ? '\nLeistungsmetadaten-Konflikte (lokale Werte bleiben): ' + mergeSummary.assessmentMetadataConflicts
              : ''));
            return true;
          }

          let jsonFileReadId = 0;
          fileInputJson.addEventListener("change", function () {
            const readId = ++jsonFileReadId;
            const selectionEpoch = uiStateEpoch;
            const mergeMode = mergeCheckbox.checked;
            const file = this.files && this.files[0];
            if (!file) {
              return;
            }

            const reader = new FileReader();
            let readEventHandled = false;
            reader.onload = async function (ev) {
              if (readEventHandled || readId !== jsonFileReadId || uiStateEpoch !== selectionEpoch) return;
              readEventHandled = true;
              try {
                const text = ev.target.result;
                let maybe;
                try { maybe = JSON.parse(text); } catch (e) { maybe = null; }
                let parsedState;
                let sourceLabel = 'JSON-Datei';
                if (maybe && maybe.format === "notenverwaltung_enc_v1") {
                  const pw = await window.promptPassword({ message: "Passwort zum Entschlüsseln der Datei eingeben:", confirm: false });
                  if (!pw) return;
                  parsedState = await Storage.importStateEncryptedFromText(text, pw);
                  sourceLabel = 'Verschlüsseltes Backup';
                }
                else if (!maybe && text.includes(':') && (text.split(':').length === 2 || text.split(':').length === 3)) {
                  const pw = await window.promptPassword({ message: "Passwort zum Entschlüsseln des Backups eingeben:", confirm: false });
                  if (!pw) return;
                  parsedState = JSON.parse(await Storage._decryptPayload(text, pw));
                  sourceLabel = 'Verschlüsseltes Backup';
                } else {
                  parsedState = maybe || JSON.parse(text);
                }
                if (readId !== jsonFileReadId || uiStateEpoch !== selectionEpoch) return;
                await commitImportedState(parsedState, sourceLabel, mergeMode);
              } catch (err) {
                console.error("Fehler beim JSON-Import:", err);
                window.alert("Import fehlgeschlagen. Der bisherige Datenbestand bleibt erhalten. " + err.message);
              }
            };
            reader.onerror = function () {
              if (readEventHandled || readId !== jsonFileReadId || uiStateEpoch !== selectionEpoch) return;
              readEventHandled = true;
              const readError = reader.error;
              const message = readError && readError.message
                ? readError.message
                : 'Die Backup-Datei konnte nicht gelesen werden.';
              console.error("Fehler beim JSON-Import:", readError || new Error(message));
              window.alert("Import fehlgeschlagen. Der bisherige Datenbestand bleibt erhalten. " + message);
            };
            reader.readAsText(file, "utf-8");

            // Datei-Auswahl zurücksetzen, damit man dieselbe Datei erneut wählen kann
            this.value = "";
          });

          importWrapper.appendChild(importLabel);
          importWrapper.appendChild(fileInputJson);
          jsonRow.appendChild(importWrapper);

          jsonBox.appendChild(jsonRow);
          transferPanelElements.get("backup").appendChild(jsonBox);

          // ---------------------------
          // 2) CSV-Vorlage
          // ---------------------------
          const csvTplBox = document.createElement("div");
          csvTplBox.className = "info-box transfer-card transfer-csv-template-card";

          const csvTitle = document.createElement("h3");
          csvTitle.textContent = "CSV-Vorlage für Massenimport (Schüler/Kurse)";
          csvTplBox.appendChild(csvTitle);

          const csvText = document.createElement("div");
          csvText.className = "transfer-card-intro";
          csvText.textContent =
            "Die CSV-Vorlage enthält die Spalten für Kurs- und Schülerdaten. Du kannst sie in Excel oder einer Tabellenkalkulation bearbeiten.";
          csvTplBox.appendChild(csvText);

          const csvRowTpl = document.createElement("div");
          csvRowTpl.className = "transfer-actions";

          const csvTplBtn = document.createElement("button");
          csvTplBtn.type = "button";
          csvTplBtn.textContent = "CSV-Vorlage herunterladen";
          csvTplBtn.addEventListener("click", function () {
            try {
              const lines = [];
              // Kopfzeile
              lines.push("KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz");
              // Platzhalterzeilen
              for (let i = 0; i < 20; i++) {
                lines.push(encodeCsvTransferRow(Array(13).fill("")));
              }
              const csvContent = "\ufeff" + lines.join("\n"); // BOM für Excel

              const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);

              const a = document.createElement("a");
              const date = formatUtcDateStamp(new Date());
              a.href = url;
              a.download = "notenverwaltung_csv_vorlage_" + date + ".csv";

              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error("Fehler beim CSV-Vorlagen-Export:", err);
              window.alert("CSV-Vorlage konnte nicht erstellt werden. Details siehe Konsole.");
            }
          });

          csvRowTpl.appendChild(csvTplBtn);
          csvTplBox.appendChild(csvRowTpl);

          const csvHint = document.createElement("div");
          csvHint.style.fontSize = "0.8rem";
          csvHint.style.marginTop = "0.3rem";
          csvHint.className = "text-muted";
          csvHint.textContent =
            "Pflichtspalten: KursID; Kurs; Fach; Klasse; SchuelerID; Nachname; Vorname; Geburtstag. Optional folgen Schema; Kursart; Qualifikationsabschnitt; 3. Pruefungsfach schriftlich; Stammklasse. Neue Vorlagen und Exporte ergänzen CSV-Schutz; ältere Programmversionen können dieses 14-spaltige Format nicht lesen.";
          csvTplBox.appendChild(csvHint);

          transferPanelElements.get("csv").appendChild(csvTplBox);

          // ---------------------------
          // 3) CSV-Massenimport
          // ---------------------------

          /* BUGFIX 2: Logikaktualisierung für gemischte Klassen (Verbesserte Zuordnung beim CSV-Import) */
          // Funktion zum Import einer CSV-Datei mit Kurs- und Schülerdaten.
          // Die 8 bisherigen Spalten bleiben gültig; darauf dürfen 4 Sek-II-Kontextspalten
          // und im aktuellen Format die getrennte persönliche Stammklasse folgen.
          // Verhalten:
          // - BOM wird entfernt, leere Zeilen ignoriert.
          // - Kurse werden anhand von KursID oder (Name+Fach) gefunden/angelegt.
          // - Schüler werden anhand (Nachname|Vorname|Geburtsdatum) identifiziert oder neu angelegt.
          // - Einschreibungen (Enrollments) werden für gefundene/erstellte Schüler vorgenommen.
          function isFatalCsvImportIssue(issue) {
            return !!(issue && issue.fatal === true);
          }

          function importCsvText(csvText, { requireFreshDecision = false, excludeStartLines = [] } = {}) {
            const previewStateReference = state;
            const previewEpoch = uiStateEpoch;
            const previewStateContent = JSON.stringify(state);
            const prepared = CsvImportOrchestrator.prepareCsvImport(csvText, state, { excludeStartLines });
            if (prepared.errorMessage) {
              window.alert(prepared.errorMessage);
              return;
            }
            const legacyFormulaHint = document.getElementById('csv-import-legacy-formula-hint');
            if (legacyFormulaHint) {
              legacyFormulaHint.textContent = prepared.legacyFormulaProtectionHint
                ? "Hinweis: Diese ältere oder fremde CSV enthält führende Apostrophe vor möglichen Formeln. Sie bleiben unverändert, weil ohne CSV-Schutz nicht sicher erkennbar ist, ob sie zum Namen gehören."
                : "";
              legacyFormulaHint.style.display = prepared.legacyFormulaProtectionHint ? "block" : "none";
            }
            let {
              importCandidate,
              transferHeader,
              errors,
              createdCourses,
              createdStudents,
              createdEnrollments,
              skippedStartLines,
              legacyFormulaProtectionHint
            } = prepared;
            // Die Zusammenfassung wird erst nach erfolgreicher Speicherung erzeugt,
            // damit Nutzerentscheidung und tatsächliche Zähler konsistent bleiben.
            function formatCsvImportSummary(outcome) {
              let summary = "CSV-Import abgeschlossen:\n" +
                "Neue Kurse: " + createdCourses + "\n" +
                "Neue Schüler:innen: " + createdStudents + "\n" +
                "Anmeldungen (Kurszuordnungen): " + createdEnrollments;
              if (transferHeader.columnCount === 8) {
                summary += "\nHinweis: Keine Sek-II-Angaben übertragen; bei vorhandenen Zielkursen wurde der bestehende Kurskontext beibehalten, neue Kurse wurden als Sek I angelegt.";
              }
              if (outcome === 'skipped') {
                summary += "\nHinweis: Fehlerhafte Zeilen wurden übersprungen (" + skippedStartLines.length + ").";
              } else if (outcome === 'accepted') {
                summary += "\nWarnung: Fehlerhafte Zeilen wurden übernommen (" + errors.length + ").";
                if (skippedStartLines.length > 0) {
                  summary += "\nZuvor übersprungene Zeilen: " + skippedStartLines.length + ".";
                }
              }
              if (legacyFormulaProtectionHint) {
                summary += "\nHinweis: Führende Apostrophe aus dieser älteren oder fremden CSV wurden beibehalten, weil ohne CSV-Schutz nicht sicher erkennbar ist, ob sie zum Namen gehören.";
              }
              return summary;
            }

            function createCsvRefreshError(nextExcludedStartLines = []) {
              const error = new Error('Die CSV-Vorschau ist nicht mehr aktuell.');
              error.code = 'CSV_PREVIEW_STALE';
              error.excludeStartLines = nextExcludedStartLines;
              return error;
            }

            async function commitCsvOutcome(outcome, expectedEpoch = previewEpoch) {
              if (uiStateEpoch !== expectedEpoch) throw createStateCommitAbortedError();
              let actualPrepared = null;
              const noValidRows = { code: 'CSV_NO_VALID_ROWS' };
              try {
                await commitStateChange(function (currentCandidate) {
                  if (uiStateEpoch !== expectedEpoch) throw createStateCommitAbortedError();
                  if ((requireFreshDecision || prepared.errors.length > 0) &&
                      (state !== previewStateReference || JSON.stringify(state) !== previewStateContent)) {
                    throw createCsvRefreshError(excludeStartLines);
                  }
                  const currentPreview = CsvImportOrchestrator.prepareCsvImport(csvText, currentCandidate, { excludeStartLines });
                  if (currentPreview.errorMessage ||
                      JSON.stringify(currentPreview.errors) !== JSON.stringify(prepared.errors)) {
                    throw createCsvRefreshError(excludeStartLines);
                  }
                  if (currentPreview.errors.some(isFatalCsvImportIssue)) throw createCsvRefreshError(excludeStartLines);
                  if (outcome === 'success' && currentPreview.errors.length > 0) throw createCsvRefreshError(excludeStartLines);
                  const replayExcludedStartLines = outcome === 'skipped'
                    ? [...new Set(excludeStartLines.concat(prepared.errors.filter(issue => !isFatalCsvImportIssue(issue)).map(issue => issue.line)))]
                    : excludeStartLines;
                  actualPrepared = outcome === 'skipped'
                    ? CsvImportOrchestrator.prepareCsvImport(csvText, currentCandidate, { excludeStartLines: replayExcludedStartLines })
                    : currentPreview;
                  if (actualPrepared.errorMessage || actualPrepared.errors.some(isFatalCsvImportIssue) ||
                      (outcome === 'skipped' && actualPrepared.errors.length > 0)) {
                    throw createCsvRefreshError(replayExcludedStartLines);
                  }
                  if (outcome === 'skipped' && actualPrepared.appliedStartLines.length === 0) throw noValidRows;
                  const actualCandidate = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(actualPrepared.importCandidate)));
                  validateImportedState(actualCandidate);
                  overwriteStateObject(currentCandidate, actualCandidate);
                }, { render: false });
              } catch (error) {
                if (error === noValidRows) return { noValidRows: true };
                throw error;
              }
              transferHeader = actualPrepared.transferHeader;
              errors = actualPrepared.errors;
              createdCourses = actualPrepared.createdCourses;
              createdStudents = actualPrepared.createdStudents;
              createdEnrollments = actualPrepared.createdEnrollments;
              skippedStartLines = actualPrepared.skippedStartLines;
              legacyFormulaProtectionHint = actualPrepared.legacyFormulaProtectionHint;
              currentCourseId = DomainModel.listActiveCourses(state)[0]?.id || null;
              render();
              return { noValidRows: false };
            }

            // Prüfen auf fatale Fehler (z. B. zu wenige Spalten oder ungültiges Geburtsdatum)
            const fatalErrors = errors.filter(isFatalCsvImportIssue);
            if (fatalErrors.length > 0) {
              try {
                render();

                const overlayF = document.createElement('div');
                overlayF.style.position = 'fixed';
                overlayF.style.left = '0';
                overlayF.style.top = '0';
                overlayF.style.right = '0';
                overlayF.style.bottom = '0';
                overlayF.style.background = 'rgba(0,0,0,0.45)';
                overlayF.style.display = 'flex';
                overlayF.style.alignItems = 'center';
                overlayF.style.justifyContent = 'center';
                overlayF.style.zIndex = '100300';

                const dialogF = document.createElement('div');
                dialogF.style.background = 'var(--bg-card, #fff)';
                dialogF.style.padding = '1rem';
                dialogF.style.borderRadius = '8px';
                dialogF.style.minWidth = '520px';
                dialogF.style.maxWidth = '92%';
                dialogF.style.maxHeight = '74%';
                dialogF.style.overflow = 'auto';
                dialogF.style.boxShadow = '0 8px 36px rgba(0,0,0,0.3)';

                const titleF = document.createElement('div');
                titleF.style.fontWeight = '600';
                titleF.style.marginBottom = '0.5rem';
                titleF.textContent = 'CSV‑Import abgebrochen – fatale Fehler (' + fatalErrors.length + ')';
                dialogF.appendChild(titleF);

                const infoF = document.createElement('div');
                infoF.className = 'text-muted';
                infoF.style.marginBottom = '0.6rem';
                infoF.textContent = 'Der Import wurde abgebrochen, weil mindestens ein fataler Fehler (z. B. zu wenige Spalten oder ungültiges Geburtsdatum) gefunden wurde. Keine Änderungen wurden übernommen.';
                dialogF.appendChild(infoF);

                const listF = document.createElement('ol');
                listF.style.fontSize = '0.85rem';
                listF.style.margin = '0';
                listF.style.paddingLeft = '1.1rem';

                for (const e of fatalErrors) {
                  const li = document.createElement('li');
                  const header = document.createElement('div');
                  header.style.fontWeight = '600';
                  header.textContent = 'Zeile ' + (e.line || '?') + ':';
                  li.appendChild(header);

                  const issues = document.createElement('ul');
                  issues.style.margin = '0.25rem 0 0 0.8rem';
                  for (const msg of e.issues) {
                    const m = document.createElement('li');
                    m.textContent = msg;
                    issues.appendChild(m);
                  }
                  li.appendChild(issues);

                  listF.appendChild(li);
                }

                dialogF.appendChild(listF);

                const btnRowF = document.createElement('div');
                btnRowF.style.display = 'flex';
                btnRowF.style.justifyContent = 'flex-end';
                btnRowF.style.gap = '0.5rem';
                btnRowF.style.marginTop = '0.8rem';

                const downloadCsvF = document.createElement('button');
                downloadCsvF.type = 'button';
                downloadCsvF.textContent = 'Fehler herunterladen (.csv)';
                downloadCsvF.addEventListener('click', function () {
                  try {
                    const csvContent = formatCsvImportIssuesCsv(fatalErrors);
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const date = formatUtcDateStamp(new Date());
                    a.href = url;
                    a.download = 'csv_import_fatal_errors_' + date + '.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (ex) { console.error(ex); }
                });

                const downloadTxtF = document.createElement('button');
                downloadTxtF.type = 'button';
                downloadTxtF.textContent = 'Fehler herunterladen (.txt)';
                downloadTxtF.addEventListener('click', function () {
                  try {
                    const txt = formatCsvImportIssuesText(fatalErrors);
                    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const date = formatUtcDateStamp(new Date());
                    a.href = url;
                    a.download = 'csv_import_fatal_errors_' + date + '.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (ex) { console.error(ex); }
                });

                const copyF = document.createElement('button');
                copyF.type = 'button';
                copyF.textContent = 'Fehler kopieren';
                copyF.addEventListener('click', function () {
                  try {
                    const txt = formatCsvImportIssuesText(fatalErrors);
                    navigator.clipboard.writeText(txt);
                    try { window.alert('Fehler in die Zwischenablage kopiert.'); } catch (e) {}
                  } catch (ex) { console.error(ex); }
                });

                const closeF = document.createElement('button');
                closeF.type = 'button';
                closeF.textContent = 'Schließen';
                closeF.addEventListener('click', function () {
                  try { document.body.removeChild(overlayF); } catch (e) { }
                });

                btnRowF.appendChild(downloadCsvF);
                btnRowF.appendChild(downloadTxtF);
                btnRowF.appendChild(copyF);
                btnRowF.appendChild(closeF);
                dialogF.appendChild(btnRowF);

                overlayF.appendChild(dialogF);
                document.body.appendChild(overlayF);
                try { window.alert('Import abgebrochen: fatale Fehler gefunden. Keine Änderungen wurden übernommen.'); } catch (e) {}
                return;
              } catch (ex) {
                console.error('Fehler beim Anzeigen der fatalen Fehler:', ex);
                try { window.alert('CSV-Import wurde abgebrochen. Keine Änderungen wurden angewendet.'); } catch (alertError) { console.error(alertError); }
                return;
              }
            }

            // Wenn Fehler vorliegen, zeige ein Fehler-Modal mit Detailliste (Speicherung erst nach Benutzerentscheidung)
            if (errors.length > 0) {
              const decisionEpoch = uiStateEpoch;
              try {
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.left = '0';
                overlay.style.top = '0';
                overlay.style.right = '0';
                overlay.style.bottom = '0';
                overlay.style.background = 'rgba(0,0,0,0.45)';
                overlay.style.display = 'flex';
                overlay.style.alignItems = 'center';
                overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '100200';

                const dialog = document.createElement('div');
                dialog.style.background = 'var(--bg-card, #fff)';
                dialog.style.padding = '1rem';
                dialog.style.borderRadius = '8px';
                dialog.style.minWidth = '520px';
                dialog.style.maxWidth = '92%';
                dialog.style.maxHeight = '74%';
                dialog.style.overflow = 'auto';
                dialog.style.boxShadow = '0 8px 36px rgba(0,0,0,0.3)';

                const title = document.createElement('div');
                title.style.fontWeight = '600';
                title.style.marginBottom = '0.5rem';
                title.textContent = 'CSV‑Import: Fehlzeilen (' + errors.length + ')';
                dialog.appendChild(title);

                const info = document.createElement('div');
                info.className = 'text-muted';
                info.style.marginBottom = '0.6rem';
                info.textContent = 'Die folgenden Zeilen konnten nicht vollständig verarbeitet werden. Du kannst fehlerhafte Zeilen überspringen oder trotzdem importieren (dann werden sie mit Warnungen übernommen).';
                dialog.appendChild(info);

                const list = document.createElement('ol');
                list.style.fontSize = '0.85rem';
                list.style.margin = '0';
                list.style.paddingLeft = '1.1rem';

                for (const e of errors) {
                  const li = document.createElement('li');
                  const header = document.createElement('div');
                  header.style.fontWeight = '600';
                  header.textContent = 'Zeile ' + (e.line || '?') + ':';
                  li.appendChild(header);

                  const issues = document.createElement('ul');
                  issues.style.margin = '0.25rem 0 0 0.8rem';
                  for (const msg of e.issues) {
                    const m = document.createElement('li');
                    m.textContent = msg;
                    issues.appendChild(m);
                  }
                  li.appendChild(issues);

                  list.appendChild(li);
                }

                dialog.appendChild(list);

                const btnRow = document.createElement('div');
                btnRow.style.display = 'flex';
                btnRow.style.justifyContent = 'flex-end';
                btnRow.style.gap = '0.5rem';
                btnRow.style.marginTop = '0.8rem';

                const skipBtn = document.createElement('button');
                skipBtn.type = 'button';
                skipBtn.textContent = 'Fehlerhafte Zeilen überspringen';
                skipBtn.addEventListener('click', async function () {
                  if (!beginDecision()) return;
                  if (uiStateEpoch !== decisionEpoch) {
                    settleStaleDecision();
                    return;
                  }
                  try {
                    const result = await commitCsvOutcome('skipped', decisionEpoch);
                    decisionState = 'settled';
                    try { document.body.removeChild(overlay); } catch (e) {}
                    try {
                      window.alert(result.noValidRows
                        ? 'Keine gültigen Zeilen übernommen. Der bisherige Datenbestand bleibt erhalten.'
                        : formatCsvImportSummary('skipped'));
                    } catch (e) {}
                  } catch (ex) {
                    if (ex && ex.code === 'CSV_PREVIEW_STALE') {
                      settleStaleDecision();
                      importCsvText(csvText, { requireFreshDecision: true, excludeStartLines: ex.excludeStartLines });
                      return;
                    }
                    if (isStateCommitAborted(ex) || uiStateEpoch !== decisionEpoch) {
                      settleStaleDecision();
                      return;
                    }
                    console.error('Fehler beim Entfernen fehlerhafter Importobjekte:', ex);
                    resetDecisionAfterFailure();
                    try { window.alert('Fehler beim Bereinigen des Imports. Details in der Konsole.'); } catch (e) {}
                  }
                });

                const acceptBtn = document.createElement('button');
                acceptBtn.type = 'button';
                acceptBtn.textContent = 'Trotz Fehler übernehmen (mit Warnung)';
                acceptBtn.addEventListener('click', async function () {
                  if (!beginDecision()) return;
                  if (uiStateEpoch !== decisionEpoch) {
                    settleStaleDecision();
                    return;
                  }
                  try {
                    await commitCsvOutcome('accepted', decisionEpoch);
                    decisionState = 'settled';
                    try { document.body.removeChild(overlay); } catch (e) {}
                    try { window.alert(formatCsvImportSummary('accepted')); } catch (e) {}
                  } catch (ex) {
                    if (ex && ex.code === 'CSV_PREVIEW_STALE') {
                      settleStaleDecision();
                      importCsvText(csvText, { requireFreshDecision: true, excludeStartLines: ex.excludeStartLines });
                      return;
                    }
                    if (isStateCommitAborted(ex) || uiStateEpoch !== decisionEpoch) {
                      settleStaleDecision();
                      return;
                    }
                    console.error('Fehler beim Abschließen des Imports:', ex);
                    resetDecisionAfterFailure();
                    try { window.alert('Fehler beim Abschließen des Imports. Details in der Konsole.'); } catch (e) {}
                  }
                });

                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.textContent = 'Fehler kopieren';
                copyBtn.addEventListener('click', function () {
                  try {
                    const txt = formatCsvImportIssuesText(errors);
                    navigator.clipboard.writeText(txt);
                    try { window.alert('Fehler in die Zwischenablage kopiert.'); } catch (e) {}
                  } catch (ex) { console.error(ex); }
                });

                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.textContent = 'Fehler herunterladen (.csv)';
                downloadBtn.addEventListener('click', function () {
                  try {
                    const csvContent = formatCsvImportIssuesCsv(errors);
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const date = formatUtcDateStamp(new Date());
                    a.href = url;
                    a.download = 'csv_import_errors_' + date + '.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (ex) {
                    console.error('Fehler beim Erstellen der Fehlerdatei:', ex);
                    try { window.alert('Fehler beim Erstellen der Fehlerdatei. Details in Konsole.'); } catch (e) {}
                  }
                });

                const downloadTxtBtn = document.createElement('button');
                downloadTxtBtn.type = 'button';
                downloadTxtBtn.textContent = 'Fehler herunterladen (.txt)';
                downloadTxtBtn.addEventListener('click', function () {
                  try {
                    const txt = formatCsvImportIssuesText(errors);
                    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const date = formatUtcDateStamp(new Date());
                    a.href = url;
                    a.download = 'csv_import_errors_' + date + '.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (ex) {
                    console.error('Fehler beim Erstellen der Text-Fehlerdatei:', ex);
                    try { window.alert('Fehler beim Erstellen der Fehlerdatei. Details in Konsole.'); } catch (e) {}
                  }
                });

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.textContent = 'Schließen';
                closeBtn.addEventListener('click', function () {
                  if (decisionState !== 'idle') return;
                  decisionState = 'settled';
                  setDecisionButtonsDisabled(true);
                  try {
                    render();
                    try { document.body.removeChild(overlay); } catch (e) {}
                    try { window.alert('Import abgebrochen. Keine Änderungen wurden übernommen.'); } catch (e) {}
                  } catch (e) {
                    try { document.body.removeChild(overlay); } catch (ee) {}
                  }
                });

                let decisionState = 'idle';
                function setDecisionButtonsDisabled(disabled) {
                  for (const button of [skipBtn, acceptBtn, downloadBtn, downloadTxtBtn, copyBtn, closeBtn]) {
                    button.disabled = disabled;
                  }
                }
                function beginDecision() {
                  if (decisionState !== 'idle') return false;
                  decisionState = 'committing';
                  setDecisionButtonsDisabled(true);
                  return true;
                }
                function resetDecisionAfterFailure() {
                  if (decisionState !== 'committing') return;
                  decisionState = 'idle';
                  setDecisionButtonsDisabled(false);
                }
                function settleStaleDecision() {
                  decisionState = 'settled';
                  setDecisionButtonsDisabled(true);
                  try { document.body.removeChild(overlay); } catch (e) {}
                }

                btnRow.appendChild(skipBtn);
                btnRow.appendChild(acceptBtn);
                btnRow.appendChild(downloadBtn);
                btnRow.appendChild(copyBtn);
                btnRow.appendChild(closeBtn);
                dialog.appendChild(btnRow);

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
              } catch (ex) {
                try { window.alert('CSV-Import abgebrochen: Der Fehlerdialog konnte nicht angezeigt werden.'); } catch (e) {}
                console.warn('CSV-Import-Fehlerdialog konnte nicht angezeigt werden. Anzahl:', errors.length);
              }
            } else if (requireFreshDecision) {
              const overlay = document.createElement('div');
              overlay.style.position = 'fixed';
              overlay.style.inset = '0';
              overlay.style.background = 'rgba(0,0,0,0.45)';
              overlay.style.display = 'flex';
              overlay.style.alignItems = 'center';
              overlay.style.justifyContent = 'center';
              overlay.style.zIndex = '100200';
              const dialog = document.createElement('div');
              dialog.style.background = 'var(--bg-card, #fff)';
              dialog.style.padding = '1rem';
              dialog.style.borderRadius = '8px';
              dialog.style.maxWidth = '92%';
              const title = document.createElement('h3');
              title.textContent = 'CSV-Vorschau nach Neuberechnung';
              dialog.appendChild(title);
              const info = document.createElement('p');
              info.textContent = 'Diese Datei wurde nach der letzten Entscheidung neu berechnet und enthält jetzt keine Warnungen. Prüfe die neue Vorschau und bestätige den Import erneut.';
              dialog.appendChild(info);
              const counts = document.createElement('p');
              counts.textContent = 'Neue Kurse: ' + createdCourses + ', neue Schüler:innen: ' + createdStudents +
                ', Anmeldungen: ' + createdEnrollments + '.';
              dialog.appendChild(counts);
              const applyButton = document.createElement('button');
              applyButton.type = 'button';
              applyButton.textContent = 'CSV-Vorschau übernehmen';
              const cancelButton = document.createElement('button');
              cancelButton.type = 'button';
              cancelButton.textContent = 'Schließen';
              let settled = false;
              applyButton.addEventListener('click', async function () {
                if (settled) return;
                applyButton.disabled = true;
                cancelButton.disabled = true;
                try {
                  await commitCsvOutcome('success', previewEpoch);
                  settled = true;
                  try { document.body.removeChild(overlay); } catch (e) {}
                  window.alert(formatCsvImportSummary('success'));
                } catch (error) {
                  if (error && error.code === 'CSV_PREVIEW_STALE') {
                    settled = true;
                    try { document.body.removeChild(overlay); } catch (e) {}
                    importCsvText(csvText, { requireFreshDecision: true, excludeStartLines: error.excludeStartLines });
                    return;
                  }
                  if (isStateCommitAborted(error) || uiStateEpoch !== previewEpoch) {
                    settled = true;
                    try { document.body.removeChild(overlay); } catch (e) {}
                    return;
                  }
                  applyButton.disabled = false;
                  cancelButton.disabled = false;
                  window.alert('CSV-Import konnte nicht gespeichert werden. Der bisherige Datenbestand bleibt erhalten. ' + error.message);
                }
              });
              cancelButton.addEventListener('click', function () {
                if (settled) return;
                settled = true;
                try { document.body.removeChild(overlay); } catch (e) {}
                window.alert('Import abgebrochen. Keine Änderungen wurden übernommen.');
              });
              dialog.appendChild(applyButton);
              dialog.appendChild(cancelButton);
              overlay.appendChild(dialog);
              document.body.appendChild(overlay);
            } else {
              // Keine Fehler: sofort speichern und rendern
              return commitCsvOutcome('success').then(function () {
                try { window.alert(formatCsvImportSummary('success')); } catch (e) {}
                return true;
              }).catch(function (err) {
                if (err && err.code === 'CSV_PREVIEW_STALE') {
                  importCsvText(csvText, { requireFreshDecision: true, excludeStartLines: err.excludeStartLines });
                  return true;
                }
                if (!isStateCommitAborted(err)) window.alert('CSV-Import konnte nicht gespeichert werden. Der bisherige Datenbestand bleibt erhalten. ' + err.message);
                return false;
              });
            }
            return true;
          }

          const csvImportBox = document.createElement("div");
          csvImportBox.className = "info-box transfer-card transfer-csv-import-card";

          const csvImportTitle = document.createElement("h3");
          csvImportTitle.textContent = "CSV-Massenimport (Schüler/Kurse)";
          csvImportBox.appendChild(csvImportTitle);

          const csvImportText = document.createElement("div");
          csvImportText.className = "transfer-card-intro";
          csvImportText.textContent =
            "Importiert Schüler- und Kursdaten aus einer CSV-Datei mit der oben beschriebenen Struktur. " +
            "Vor dem Import empfiehlt sich ein JSON-Backup.";
          csvImportBox.appendChild(csvImportText);

          const csvImportRow = document.createElement("div");
          csvImportRow.className = "transfer-field";

          const csvImportLabel = document.createElement("label");
          csvImportLabel.setAttribute("for", "csv-import-file");
          csvImportLabel.textContent = "CSV-Datei auswählen";
          csvImportRow.appendChild(csvImportLabel);

          const fileInputCsv = document.createElement("input");
          fileInputCsv.id = "csv-import-file";
          fileInputCsv.type = "file";
          // Akzeptiere nur CSV-Dateien. Unterstützung für Excel (.xls, .xlsx)
          // wurde entfernt, um Verwirrung zu vermeiden, da keine Excel‑Parsing‑Bibliothek
          // (z. B. SheetJS) eingebunden ist.
          fileInputCsv.accept = ".csv,text/csv";

          const csvDecodeRetryBox = document.createElement("div");
          csvDecodeRetryBox.id = "csv-import-decode-retry";
          csvDecodeRetryBox.className = "text-muted";
          csvDecodeRetryBox.style.display = "none";
          csvDecodeRetryBox.style.marginTop = "0.5rem";

          const csvDecodeRetryMessage = document.createElement("div");
          csvDecodeRetryMessage.textContent =
            "Die Datei ist kein gültiges UTF-8. Du kannst dieselben Dateibytes bewusst als Windows-1252 lesen und danach die Vorschau prüfen.";
          csvDecodeRetryBox.appendChild(csvDecodeRetryMessage);

          const csvDecodePreview = document.createElement("pre");
          csvDecodePreview.id = "csv-import-decode-preview";
          csvDecodePreview.style.whiteSpace = "pre-wrap";
          csvDecodePreview.style.maxHeight = "14rem";
          csvDecodePreview.style.overflow = "auto";
          csvDecodePreview.style.margin = "0.5rem 0";
          csvDecodeRetryBox.appendChild(csvDecodePreview);

          const csvDecodeRetryActions = document.createElement("div");
          csvDecodeRetryActions.className = "transfer-actions";
          const csvDecodeRetryButton = document.createElement("button");
          csvDecodeRetryButton.type = "button";
          csvDecodeRetryButton.textContent = "Als Windows-1252 erneut lesen";
          const csvDecodeApplyButton = document.createElement("button");
          csvDecodeApplyButton.type = "button";
          csvDecodeApplyButton.textContent = "CSV-Vorschau übernehmen";
          csvDecodeApplyButton.style.display = "none";
          const csvDecodeCancelButton = document.createElement("button");
          csvDecodeCancelButton.type = "button";
          csvDecodeCancelButton.textContent = "Abbrechen";
          csvDecodeRetryActions.appendChild(csvDecodeRetryButton);
          csvDecodeRetryActions.appendChild(csvDecodeApplyButton);
          csvDecodeRetryActions.appendChild(csvDecodeCancelButton);
          csvDecodeRetryBox.appendChild(csvDecodeRetryActions);

          let pendingCsvImportBytes = null;
          let pendingCsvImportText = null;
          let pendingCsvImportEpoch = null;
          let pendingCsvImportAttempt = null;
          let csvReadAttempt = 0;

          function clearPendingCsvDecode() {
            pendingCsvImportBytes = null;
            pendingCsvImportText = null;
            pendingCsvImportEpoch = null;
            pendingCsvImportAttempt = null;
            csvDecodePreview.textContent = "";
            csvDecodeRetryMessage.textContent =
              "Die Datei ist kein gültiges UTF-8. Du kannst dieselben Dateibytes bewusst als Windows-1252 lesen und danach die Vorschau prüfen.";
            csvDecodeRetryButton.style.display = "";
            csvDecodeApplyButton.style.display = "none";
            csvDecodeRetryBox.style.display = "none";
          }

          async function importCsvBytes(bytes, encoding, readAttempt, selectionEpoch) {
            if (readAttempt !== csvReadAttempt || uiStateEpoch !== selectionEpoch) return false;
            let csvText;
            try {
              csvText = decodeCsvBytes(bytes, encoding);
            } catch (err) {
              if (encoding === "utf-8" && err instanceof CsvDecodeError) {
                csvDecodeRetryBox.style.display = "block";
                return false;
              }
              clearPendingCsvDecode();
              console.error("Fehler beim Decodieren der CSV-Datei:", err);
              window.alert("CSV-Datei konnte nicht gelesen werden. Der bisherige Datenbestand bleibt erhalten.");
              return false;
            }
            if (encoding === "windows-1252") {
              pendingCsvImportText = csvText;
              pendingCsvImportEpoch = selectionEpoch;
              pendingCsvImportAttempt = readAttempt;
              csvDecodeRetryMessage.textContent =
                "Vorschau nach bewusster Decodierung als Windows-1252. Prüfe Namen und Sonderzeichen vor der Übernahme.";
              csvDecodePreview.textContent = csvText.length > 4000
                ? csvText.slice(0, 4000) + "\n… Vorschau gekürzt"
                : csvText;
              csvDecodeRetryButton.style.display = "none";
              csvDecodeApplyButton.style.display = "";
              csvDecodeRetryBox.style.display = "block";
              return true;
            }
            return importCsvText(csvText);
          }

          csvDecodeRetryButton.addEventListener("click", async function () {
            if (!pendingCsvImportBytes || pendingCsvImportAttempt !== csvReadAttempt ||
                pendingCsvImportEpoch !== uiStateEpoch) return;
            await importCsvBytes(pendingCsvImportBytes, "windows-1252", pendingCsvImportAttempt, pendingCsvImportEpoch);
          });

          csvDecodeApplyButton.addEventListener("click", async function () {
            if (csvDecodeApplyButton.disabled || pendingCsvImportText === null ||
                pendingCsvImportAttempt !== csvReadAttempt || pendingCsvImportEpoch !== uiStateEpoch) return;
            const csvText = pendingCsvImportText;
            csvDecodeApplyButton.disabled = true;
            try {
              const accepted = await importCsvText(csvText);
              if (accepted) clearPendingCsvDecode();
            } finally {
              csvDecodeApplyButton.disabled = false;
            }
          });

          csvDecodeCancelButton.addEventListener("click", function () {
            csvReadAttempt++;
            clearPendingCsvDecode();
            fileInputCsv.value = "";
          });

          fileInputCsv.addEventListener("change", function () {
            const readAttempt = ++csvReadAttempt;
            const selectionEpoch = uiStateEpoch;
            const file = this.files && this.files[0];
            clearPendingCsvDecode();
            if (!file) return;
            const name = (file.name || '').toLowerCase();

            // CSV/TXT path only
            if (name.endsWith('.csv') || name.endsWith('.txt')) {
              const reader = new FileReader();
              reader.onload = async function (ev) {
                if (readAttempt !== csvReadAttempt || uiStateEpoch !== selectionEpoch) return;
                try {
                  pendingCsvImportBytes = Uint8Array.from(new Uint8Array(ev.target.result));
                  pendingCsvImportEpoch = selectionEpoch;
                  pendingCsvImportAttempt = readAttempt;
                  await importCsvBytes(pendingCsvImportBytes, "utf-8", readAttempt, selectionEpoch);
                } catch (err) {
                  console.error("Fehler beim CSV-Import:", err);
                  window.alert("CSV-Import fehlgeschlagen. Details siehe Konsole.");
                }
              };
              reader.onerror = function () {
                if (readAttempt !== csvReadAttempt || uiStateEpoch !== selectionEpoch) return;
                clearPendingCsvDecode();
                console.error("Fehler beim Lesen der CSV-Datei:", reader.error);
                window.alert("CSV-Datei konnte nicht gelesen werden. Der bisherige Datenbestand bleibt erhalten. Bitte wählen Sie die Datei erneut aus.");
              };
              reader.readAsArrayBuffer(file);
              this.value = "";
              return;
            }

            window.alert('Bitte wählen Sie eine CSV-Datei (.csv). Excel-Dateien werden nicht mehr unterstützt.');
            this.value = "";
          });

          csvImportRow.appendChild(fileInputCsv);
          csvImportBox.appendChild(csvImportRow);
          csvImportBox.appendChild(csvDecodeRetryBox);

          const csvLegacyFormulaHint = document.createElement("div");
          csvLegacyFormulaHint.id = "csv-import-legacy-formula-hint";
          csvLegacyFormulaHint.className = "text-muted";
          csvLegacyFormulaHint.style.display = "none";
          csvLegacyFormulaHint.style.marginTop = "0.5rem";
          csvImportBox.appendChild(csvLegacyFormulaHint);

          const csvImportHint = document.createElement("div");
          csvImportHint.style.fontSize = "0.8rem";
          csvImportHint.style.marginTop = "0.3rem";
          csvImportHint.className = "text-muted";
          csvImportHint.textContent =
            "Hinweis: Eigene Kurs-IDs und eindeutige Importschlüssel werden stabil zugeordnet. Ohne stabile ID erfolgt die Zuordnung anhand von Kurs (Name/Fach) nur bei eindeutigem Ergebnis. " +
            "Schema und Kurskontext müssen je Kurs einheitlich sein; das Q4-Prüfungsfach kann pro Person abweichen. Apostrophe werden nur entfernt, wenn CSV-Schutz sie eindeutig als vom Export hinzugefügt markiert.";
          csvImportBox.appendChild(csvImportHint);

          transferPanelElements.get("csv").appendChild(csvImportBox);

          selectTransferArea("export", false);

          container.appendChild(section);
        }



    function renderExamSection(container) {
      const section = document.createElement("section");
      section.className = "section exam-calculator";

      function normalizeDecimalThreshold(value) {
        const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
        if (!match) return null;
        const fractionDigits = match[2] || "";
        const exponent = Number(match[3] || 0);
        let numerator = BigInt(match[1] + fractionDigits);
        let scalePower = fractionDigits.length - exponent;
        if (scalePower < 0) {
          numerator *= 10n ** BigInt(-scalePower);
          scalePower = 0;
        }
        return {
          numerator: numerator,
          scale: 10n ** BigInt(scalePower)
        };
      }

      function pointsReachPercentageThreshold(points, maxPoints, threshold) {
        const normalized = normalizeDecimalThreshold(threshold);
        if (!normalized) return false;
        return BigInt(points) * 100n * normalized.scale >=
          normalized.numerator * BigInt(maxPoints);
      }

      const h2 = document.createElement("h2");
      h2.id = "exam-calculator-title";
      h2.textContent = "Klausurnotenrechner";
      section.appendChild(h2);
      section.setAttribute("aria-labelledby", h2.id);

      const hint = document.createElement("div");
      hint.className = "section-hint";
      hint.textContent =
        "Berechnet aus Maximalpunktzahl und geprüften Prozentgrenzen eine Tabelle. Sek-I-Profile sind schulinterne Beispiele; der Berliner Sek-II-Schlüssel ist ausschließlich als Preset für Abiturprüfungen 2024–2029 ausgewiesen.";
      section.appendChild(hint);

      const scopeHint = document.createElement("p");
      scopeHint.className = "exam-scope-hint";
      scopeHint.textContent = "Dieser Rechner ändert keine Kursnoten und speichert keine Ergebnisse in der Notenverwaltung.";
      section.appendChild(scopeHint);

      // Moduswahl
      const MODE_SEK1 = "sek1";
      const MODE_SEK2 = "sek2";
      let currentMode = MODE_SEK1;

      let lastGeneratedSek1 = null;
      let lastGeneratedSek2 = null;

      const modeRow = document.createElement("div");
      modeRow.className = "exam-schema-field exam-field";

      const modeLabel = document.createElement("label");
      modeLabel.setAttribute("for", "exam-schema");
      modeLabel.textContent = "Schema";
      modeRow.appendChild(modeLabel);

      const modeSelect = document.createElement("select");
      modeSelect.id = "exam-schema";

      const optSek1 = document.createElement("option");
      optSek1.value = MODE_SEK1;
      optSek1.textContent = "Sek I (Noten 1+ … 6)";
      modeSelect.appendChild(optSek1);

      const optSek2 = document.createElement("option");
      optSek2.value = MODE_SEK2;
      optSek2.textContent = "Sek II (0–15 Punkte)";
      modeSelect.appendChild(optSek2);

      modeSelect.value = MODE_SEK1;
      modeRow.appendChild(modeSelect);

      section.appendChild(modeRow);

      // -----------------------------
      // Sek I: feine Notenskala 1+…6
      // -----------------------------
      const gradeScaleSek1 = [
        { label: "1+", defaultPct: 100 },
        { label: "1",  defaultPct: 95 },
        { label: "1-", defaultPct: 90 },
        { label: "2+", defaultPct: 85 },
        { label: "2",  defaultPct: 80 },
        { label: "2-", defaultPct: 75 },
        { label: "3+", defaultPct: 70 },
        { label: "3",  defaultPct: 65 },
        { label: "3-", defaultPct: 60 },
        { label: "4+", defaultPct: 55 },
        { label: "4",  defaultPct: 50 },
        { label: "4-", defaultPct: 45 },
        { label: "5+", defaultPct: 35 },
        { label: "5",  defaultPct: 30 },
        { label: "5-", defaultPct: 25 },
        { label: "6",  defaultPct: 0 } // Rest
      ];

      const gradeInputsSek1 = new Map();

      const cfgBoxSek1 = document.createElement("div");
      cfgBoxSek1.className = "exam-stage-card";
      cfgBoxSek1.setAttribute("data-exam-stage", MODE_SEK1);
      cfgBoxSek1.setAttribute("aria-labelledby", "exam-sek1-title");

      const cfgTitleSek1 = document.createElement("h3");
      cfgTitleSek1.id = "exam-sek1-title";
      cfgTitleSek1.textContent = "Sek I – schulinterne Beispielprofile";
      cfgBoxSek1.appendChild(cfgTitleSek1);

      const cfgTextSek1 = document.createElement("div");
      cfgTextSek1.className = "exam-stage-note";
      cfgTextSek1.textContent =
        "Fein abgestufte Noten (1+, 1, 1-, …, 5-, 6). Für jede Note außer 6 kannst du eine eigene Prozentgrenze festlegen. " +
        "Alle Leistungen unterhalb der niedrigsten Grenze erhalten die Note 6. Die Profile sind keine amtlichen Berliner Standards; maßgeblich sind die schulischen und fachkonferenzbezogenen Festlegungen.";
      cfgBoxSek1.appendChild(cfgTextSek1);

      const formSek1 = document.createElement("div");
      formSek1.className = "exam-config-grid";

      const maxWrapperSek1 = document.createElement("div");
      maxWrapperSek1.className = "exam-field";
      const maxLabelSek1 = document.createElement("label");
      maxLabelSek1.setAttribute("for", "exam-sek1-max-points");
      maxLabelSek1.textContent = "Maximalpunkte";
      const maxInputSek1 = document.createElement("input");
      maxInputSek1.id = "exam-sek1-max-points";
      maxInputSek1.type = "number";
      maxInputSek1.min = "1";
      maxInputSek1.step = "1";
      maxInputSek1.value = "50";
      maxWrapperSek1.appendChild(maxLabelSek1);
      maxWrapperSek1.appendChild(maxInputSek1);
      formSek1.appendChild(maxWrapperSek1);

      const thresholdsWrapperSek1 = document.createElement("div");
      thresholdsWrapperSek1.className = "exam-thresholds-body";

      const thresholdsDetailsSek1 = document.createElement("details");
      thresholdsDetailsSek1.className = "exam-thresholds";
      thresholdsDetailsSek1.open = false;
      const thresholdsSummarySek1 = document.createElement("summary");
      thresholdsSummarySek1.textContent = "Prozentgrenzen bearbeiten";
      thresholdsDetailsSek1.appendChild(thresholdsSummarySek1);

      const thLabelSek1 = document.createElement("div");
      thLabelSek1.style.fontSize = "0.8rem";
      thLabelSek1.style.marginBottom = "0.2rem";
      thLabelSek1.textContent = "Prozentgrenzen (ab … % gilt Note …):";
      thresholdsWrapperSek1.appendChild(thLabelSek1);

      const thTableSek1 = document.createElement("table");
      const thTheadSek1 = document.createElement("thead");
      const thTrSek1 = document.createElement('tr');
      ['Note','ab Prozent'].forEach(t => { const th = document.createElement('th'); th.setAttribute('scope', 'col'); th.textContent = t; thTrSek1.appendChild(th); });
      thTheadSek1.appendChild(thTrSek1);
      thTableSek1.appendChild(thTheadSek1);

      const thTbodySek1 = document.createElement("tbody");

      for (const g of gradeScaleSek1) {
        const tr = document.createElement("tr");

        const tdLabel = document.createElement("td");
        tdLabel.textContent = g.label;
        tr.appendChild(tdLabel);

        const tdInput = document.createElement("td");

        if (g.label === "6") {
          const span = document.createElement("span");
          span.className = "text-muted";
          span.style.fontSize = "0.85rem";
          span.textContent = "Rest (< niedrigste Grenze)";
          tdInput.appendChild(span);
        } else {
          const inp = document.createElement("input");
          inp.type = "number";
          inp.step = "0.1";
          inp.min = "0";
          inp.max = "100";
          inp.value = String(g.defaultPct);
          inp.setAttribute("aria-label", "Prozentgrenze für Note " + g.label + " in Sek I");
          tdInput.appendChild(inp);
          gradeInputsSek1.set(g.label, inp);
        }

        tr.appendChild(tdInput);
        thTbodySek1.appendChild(tr);
      }

      thTableSek1.appendChild(thTbodySek1);
      thresholdsWrapperSek1.appendChild(thTableSek1);
      thresholdsDetailsSek1.appendChild(thresholdsWrapperSek1);

      // Presets für Sek I (wie zuvor)
      const presetRowSek1 = document.createElement("div");
      presetRowSek1.className = "exam-field exam-profile-field";

      const presetLabelSek1 = document.createElement("label");
      presetLabelSek1.setAttribute("for", "exam-sek1-profile");
      presetLabelSek1.textContent = "Profil";
      presetRowSek1.appendChild(presetLabelSek1);

      const presetSelectSek1 = document.createElement("select");
      presetSelectSek1.id = "exam-sek1-profile";

      const presetDefsSek1 = [
        { id: "custom",      name: "Benutzerdefiniert (unverändert)" },
        { id: "standard",    name: "Schulinternes Beispiel (relativ streng)" },
        { id: "grosszuegig", name: "Schulinternes Beispiel (großzügiger)" }
      ];

      for (const p of presetDefsSek1) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        presetSelectSek1.appendChild(opt);
      }
      presetSelectSek1.value = "custom";
      presetRowSek1.appendChild(presetSelectSek1);

      const presetThresholdsSek1 = {
        standard: {
          "1+": 100, "1": 95,  "1-": 90,
          "2+": 85,  "2": 80,  "2-": 75,
          "3+": 70,  "3": 65,  "3-": 60,
          "4+": 55,  "4": 50,  "4-": 45,
          "5+": 35,  "5": 30,  "5-": 25
        },
        grosszuegig: {
          "1+": 98,  "1": 93,  "1-": 88,
          "2+": 83,  "2": 78,  "2-": 73,
          "3+": 68,  "3": 63,  "3-": 58,
          "4+": 53,  "4": 48,  "4-": 43,
          "5+": 33,  "5": 28,  "5-": 23
        }
      };

      const applyPresetBtnSek1 = document.createElement("button");
      applyPresetBtnSek1.type = "button";
      applyPresetBtnSek1.textContent = "Preset anwenden";
      applyPresetBtnSek1.addEventListener("click", function () {
        const chosen = presetSelectSek1.value;
        if (chosen === "custom") return;
        const map = presetThresholdsSek1[chosen];
        if (!map) return;
        for (const g of gradeScaleSek1) {
          if (g.label === "6") continue;
          const inp = gradeInputsSek1.get(g.label);
          if (!inp) continue;
          const val = map[g.label];
          if (typeof val === "number") {
            inp.value = String(val);
          }
        }
      });
      presetRowSek1.appendChild(applyPresetBtnSek1);

      formSek1.appendChild(presetRowSek1);
      formSek1.appendChild(thresholdsDetailsSek1);
      cfgBoxSek1.appendChild(formSek1);

      const buttonRowSek1 = document.createElement("div");
      buttonRowSek1.className = "exam-actions";

      const calcBtnSek1 = document.createElement("button");
      calcBtnSek1.type = "button";
      calcBtnSek1.className = "exam-action-primary";
      calcBtnSek1.textContent = "Tabelle berechnen (Sek I)";

      const exportCsvBtnSek1 = document.createElement("button");
      exportCsvBtnSek1.type = "button";
      exportCsvBtnSek1.className = "exam-action-secondary";
      exportCsvBtnSek1.textContent = "Als CSV herunterladen (Sek I)";

      buttonRowSek1.appendChild(calcBtnSek1);
      buttonRowSek1.appendChild(exportCsvBtnSek1);
      cfgBoxSek1.appendChild(buttonRowSek1);

      section.appendChild(cfgBoxSek1);

      const resultBoxSek1 = document.createElement("div");
      resultBoxSek1.id = "exam-sek1-result";
      resultBoxSek1.className = "exam-results";
      resultBoxSek1.setAttribute("role", "region");
      resultBoxSek1.setAttribute("aria-label", "Ergebnis Sek I");
      const emptyResultSek1 = document.createElement("p");
      emptyResultSek1.className = "exam-results-empty text-muted";
      emptyResultSek1.textContent = "Noch keine Tabelle berechnet.";
      resultBoxSek1.appendChild(emptyResultSek1);
      section.appendChild(resultBoxSek1);

      function readThresholdsSek1() {
        const thr = {};
        for (const g of gradeScaleSek1) {
          if (g.label === "6") {
            thr[g.label] = 0;
            continue;
          }
          const inp = gradeInputsSek1.get(g.label);
          if (!inp) {
            thr[g.label] = g.defaultPct;
            continue;
          }
          const rawValue = String(inp.value).trim().replace(",", ".");
          thr[g.label] = rawValue ? Number(rawValue) : NaN;
        }
        return thr;
      }

      function gradeForPointsSek1(points, maxPoints, thr) {
        const ordered = gradeScaleSek1
          .map(g => ({
            label: g.label,
            threshold: (thr[g.label] != null ? thr[g.label] : g.defaultPct)
          }))
          .sort((a, b) => b.threshold - a.threshold);

        for (const g of ordered) {
          if (pointsReachPercentageThreshold(points, maxPoints, g.threshold)) {
            return g.label;
          }
        }
        return "6";
      }

      function renderTableSek1() {
        while (resultBoxSek1.firstChild) { resultBoxSek1.removeChild(resultBoxSek1.firstChild); }

        const maxPoints = parseInt(maxInputSek1.value, 10);
        if (!Number.isFinite(maxPoints) || maxPoints <= 0) {
          const msg = document.createElement("div");
          msg.className = "text-muted";
          msg.textContent = "Bitte eine gültige Maximalpunktzahl (> 0) eingeben.";
          resultBoxSek1.appendChild(msg);
          lastGeneratedSek1 = null;
          return;
        }

        const thr = readThresholdsSek1();
        const validation = GradingLogic.validatePercentageThresholds(gradeScaleSek1, thr, "6");
        if (!validation.ok) {
          const msg = document.createElement("div");
          msg.style.color = "#c62828";
          msg.textContent = validation.message;
          resultBoxSek1.appendChild(msg);
          lastGeneratedSek1 = null;
          return;
        }

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "0.3rem";
        title.textContent =
          "Sek I – Notentabelle für " + maxPoints + " Punkte (fein abgestufte Noten)";
        resultBoxSek1.appendChild(title);

        const small = document.createElement("div");
        small.className = "text-muted";
        small.style.fontSize = "0.8rem";
        small.style.marginBottom = "0.3rem";

        const nonFail = gradeScaleSek1.filter(g => g.label !== "6");
        const parts = [];
        for (const g of nonFail) {
          const t = (thr[g.label] != null ? thr[g.label] : g.defaultPct);
          parts.push("ab " + t + "% = " + g.label);
        }
        const lowest = nonFail[nonFail.length - 1];
        const lowestThr = (thr[lowest.label] != null ? thr[lowest.label] : lowest.defaultPct);
        small.textContent =
          parts.join(", ") + ", unter " + lowestThr + "% = 6.";
        resultBoxSek1.appendChild(small);

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const theadTr = document.createElement('tr');
        ['Punkte','Prozent','Note'].forEach(t => { const th = document.createElement('th'); th.textContent = t; theadTr.appendChild(th); });
        thead.appendChild(theadTr);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const rows = [];

        for (let pts = maxPoints; pts >= 0; pts--) {
          const pct = (pts / maxPoints) * 100;
          const grade = gradeForPointsSek1(pts, maxPoints, thr);

          const tr = document.createElement("tr");
          const tdPts = document.createElement("td");
          tdPts.textContent = String(pts);
          const tdPct = document.createElement("td");
          tdPct.textContent = formatLegacyPercent(pct, { digits: 1, spaceBeforeSymbol: true });
          const tdGrade = document.createElement("td");
          tdGrade.textContent = grade;

          tr.appendChild(tdPts);
          tr.appendChild(tdPct);
          tr.appendChild(tdGrade);
          tbody.appendChild(tr);

          rows.push({ points: pts, percent: pct, grade: grade });
        }

        table.appendChild(tbody);
        resultBoxSek1.appendChild(table);

        lastGeneratedSek1 = {
          maxPoints: maxPoints,
          thresholds: thr,
          rows: rows
        };
      }

      function exportCsvSek1() {
        const currentMaxPoints = parseInt(maxInputSek1.value, 10);
        const currentThresholds = readThresholdsSek1();
        const validation = GradingLogic.validatePercentageThresholds(gradeScaleSek1, currentThresholds, "6");
        if (!validation.ok) {
          window.alert(validation.message);
          return;
        }
        if (!lastGeneratedSek1) {
          window.alert("Bitte zuerst eine Tabelle (Sek I) berechnen.");
          return;
        }
        if (
          currentMaxPoints !== lastGeneratedSek1.maxPoints ||
          JSON.stringify(currentThresholds) !== JSON.stringify(lastGeneratedSek1.thresholds)
        ) {
          window.alert("Die Maximalpunktzahl oder Prozentgrenzen wurden seit der letzten Berechnung geändert. Bitte die Tabelle vor dem Export neu berechnen.");
          return;
        }
        const rows = lastGeneratedSek1.rows;
        const lines = [];
        lines.push("Punkte;Prozent;Note");
        for (const r of rows) {
          const pctStr = formatDecimalComma(r.percent, { digits: 1, trimTrailingZeros: false });
          lines.push(r.points + ";" + pctStr + ";" + r.grade);
        }
        const csvContent = "\ufeff" + lines.join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const date = formatUtcDateStamp(new Date());
        a.href = url;
        a.download =
          "klausurtabelle_sek1_" + lastGeneratedSek1.maxPoints + "pkt_" + date + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      calcBtnSek1.addEventListener("click", renderTableSek1);
      exportCsvBtnSek1.addEventListener("click", exportCsvSek1);

      // -----------------------------
      // Sek II: 0–15 Punkte
      // -----------------------------
      // Amtlicher Schlüssel für Abiturprüfungen 2024–2029; kein allgemeiner
      // Schlüssel für reguläre Oberstufenklausuren.
      const gradeScaleSek2 = [
        { label: "15", defaultPct: 95 },
        { label: "14", defaultPct: 90 },
        { label: "13", defaultPct: 85 },
        { label: "12", defaultPct: 80 },
        { label: "11", defaultPct: 75 },
        { label: "10", defaultPct: 70 },
        { label: "9",  defaultPct: 65 },
        { label: "8",  defaultPct: 60 },
        { label: "7",  defaultPct: 55 },
        { label: "6",  defaultPct: 50 },
        { label: "5",  defaultPct: 45 },
        { label: "4",  defaultPct: 40 },
        { label: "3",  defaultPct: 33 },
        { label: "2",  defaultPct: 27 },
        { label: "1",  defaultPct: 20 },
        { label: "0",  defaultPct: 0 } // Rest
      ];

      const gradeInputsSek2 = new Map();

      const cfgBoxSek2 = document.createElement("div");
      cfgBoxSek2.className = "exam-stage-card";
      cfgBoxSek2.setAttribute("data-exam-stage", MODE_SEK2);
      cfgBoxSek2.setAttribute("aria-labelledby", "exam-sek2-title");

      const cfgTitleSek2 = document.createElement("h3");
      cfgTitleSek2.id = "exam-sek2-title";
      cfgTitleSek2.textContent = "Sek II – 0–15 Punkte";
      cfgBoxSek2.appendChild(cfgTitleSek2);

      const cfgTextSek2 = document.createElement("div");
      cfgTextSek2.className = "exam-stage-note";
      cfgTextSek2.textContent =
        "Achtung: Das Preset „Abiturprüfung Berlin 2024–2029 (AV Prüfungen)“ gilt für Abiturprüfungen und nicht allgemein für normale Oberstufenklausuren. " +
        "Für reguläre Klausuren ist ein von Schule bzw. Fachkonferenz beschlossenes benutzerdefiniertes Profil zu verwenden.";
      cfgBoxSek2.appendChild(cfgTextSek2);

      const pointsInfoSek2 = document.createElement("div");
      pointsInfoSek2.className = "exam-stage-note text-muted";
      pointsInfoSek2.textContent =
        "Feste Zuordnung (nur Information): 15/14/13 = 1+/1/1-, 12/11/10 = 2+/2/2-, 9/8/7 = 3+/3/3-, 6/5/4 = 4+/4/4-, 3/2/1 = 5+/5/5-, 0 = 6. Rechnerische Mittelwerte sind Zwischenwerte und keine automatisch festgesetzten Zeugnis- oder Kursnoten.";
      cfgBoxSek2.appendChild(pointsInfoSek2);

      const formSek2 = document.createElement("div");
      formSek2.className = "exam-config-grid";

      const maxWrapperSek2 = document.createElement("div");
      maxWrapperSek2.className = "exam-field";
      const maxLabelSek2 = document.createElement("label");
      maxLabelSek2.setAttribute("for", "exam-sek2-max-points");
      maxLabelSek2.textContent = "Maximalpunkte";
      const maxInputSek2 = document.createElement("input");
      maxInputSek2.id = "exam-sek2-max-points";
      maxInputSek2.type = "number";
      maxInputSek2.min = "1";
      maxInputSek2.step = "1";
      maxInputSek2.value = "50";
      maxWrapperSek2.appendChild(maxLabelSek2);
      maxWrapperSek2.appendChild(maxInputSek2);
      formSek2.appendChild(maxWrapperSek2);

      const thresholdsWrapperSek2 = document.createElement("div");
      thresholdsWrapperSek2.className = "exam-thresholds-body";

      const thresholdsDetailsSek2 = document.createElement("details");
      thresholdsDetailsSek2.className = "exam-thresholds";
      thresholdsDetailsSek2.open = false;
      const thresholdsSummarySek2 = document.createElement("summary");
      thresholdsSummarySek2.textContent = "Prozentgrenzen bearbeiten";
      thresholdsDetailsSek2.appendChild(thresholdsSummarySek2);

      const thLabelSek2 = document.createElement("div");
      thLabelSek2.style.fontSize = "0.8rem";
      thLabelSek2.style.marginBottom = "0.2rem";
      thLabelSek2.textContent = "Prozentgrenzen (ab … % gilt Punktzahl …):";
      thresholdsWrapperSek2.appendChild(thLabelSek2);

      const thTableSek2 = document.createElement("table");
      const thTheadSek2 = document.createElement("thead");
      const thTrSek2 = document.createElement('tr');
      ['Punkte (Oberstufe)','ab Prozent'].forEach(t => { const th = document.createElement('th'); th.setAttribute('scope', 'col'); th.textContent = t; thTrSek2.appendChild(th); });
      thTheadSek2.appendChild(thTrSek2);
      thTableSek2.appendChild(thTheadSek2);

      const thTbodySek2 = document.createElement("tbody");

      for (const g of gradeScaleSek2) {
        const tr = document.createElement("tr");

        const tdLabel = document.createElement("td");
        tdLabel.textContent = g.label;
        tr.appendChild(tdLabel);

        const tdInput = document.createElement("td");

        if (g.label === "0") {
          const span = document.createElement("span");
          span.className = "text-muted";
          span.style.fontSize = "0.85rem";
          span.textContent = "Rest (< niedrigste Grenze)";
          tdInput.appendChild(span);
        } else {
          const inp = document.createElement("input");
          inp.type = "number";
          inp.step = "0.1";
          inp.min = "0";
          inp.max = "100";
          inp.value = String(g.defaultPct);
          inp.setAttribute("aria-label", "Prozentgrenze für " + g.label + " Punkte in Sek II");
          tdInput.appendChild(inp);
          gradeInputsSek2.set(g.label, inp);
        }

        tr.appendChild(tdInput);
        thTbodySek2.appendChild(tr);
      }

      thTableSek2.appendChild(thTbodySek2);
      thresholdsWrapperSek2.appendChild(thTableSek2);
      thresholdsDetailsSek2.appendChild(thresholdsWrapperSek2);

      const presetRowSek2 = document.createElement("div");
      presetRowSek2.className = "exam-field exam-profile-field";
      const presetLabelSek2 = document.createElement("label");
      presetLabelSek2.setAttribute("for", "exam-sek2-profile");
      presetLabelSek2.textContent = "Profil";
      const presetSelectSek2 = document.createElement("select");
      presetSelectSek2.id = "exam-sek2-profile";
      const customOptionSek2 = document.createElement("option");
      customOptionSek2.value = "custom";
      customOptionSek2.textContent = "Benutzerdefiniertes Fachkonferenzprofil";
      const abiturOptionSek2 = document.createElement("option");
      abiturOptionSek2.value = "abitur-berlin-2024-2029";
      abiturOptionSek2.textContent = "Abiturprüfung Berlin 2024–2029 (AV Prüfungen)";
      presetSelectSek2.appendChild(customOptionSek2);
      presetSelectSek2.appendChild(abiturOptionSek2);
      presetSelectSek2.value = "abitur-berlin-2024-2029";
      const applyPresetBtnSek2 = document.createElement("button");
      applyPresetBtnSek2.type = "button";
      applyPresetBtnSek2.textContent = "Preset anwenden";
      applyPresetBtnSek2.addEventListener("click", function () {
        if (presetSelectSek2.value !== "abitur-berlin-2024-2029") return;
        for (const item of gradeScaleSek2) {
          if (item.label === "0") continue;
          const input = gradeInputsSek2.get(item.label);
          if (input) input.value = String(item.defaultPct);
        }
      });
      presetRowSek2.appendChild(presetLabelSek2);
      presetRowSek2.appendChild(presetSelectSek2);
      presetRowSek2.appendChild(applyPresetBtnSek2);
      formSek2.appendChild(presetRowSek2);
      formSek2.appendChild(thresholdsDetailsSek2);
      cfgBoxSek2.appendChild(formSek2);

      const buttonRowSek2 = document.createElement("div");
      buttonRowSek2.className = "exam-actions";

      const calcBtnSek2 = document.createElement("button");
      calcBtnSek2.type = "button";
      calcBtnSek2.className = "exam-action-primary";
      calcBtnSek2.textContent = "Tabelle berechnen (Sek II)";

      const exportCsvBtnSek2 = document.createElement("button");
      exportCsvBtnSek2.type = "button";
      exportCsvBtnSek2.className = "exam-action-secondary";
      exportCsvBtnSek2.textContent = "Als CSV herunterladen (Sek II)";

      buttonRowSek2.appendChild(calcBtnSek2);
      buttonRowSek2.appendChild(exportCsvBtnSek2);
      cfgBoxSek2.appendChild(buttonRowSek2);

      // Integrationstests automatisch starten, wenn Parameter vorhanden sind: ?runPrevTest=1 und/oder ?createPersistTest=1
      // SICHERHEIT: Nur aktivieren wenn Debug-Modus explizit in localStorage gesetzt wurde
      try {
        if (typeof window !== 'undefined' && window.location && window.location.search && localStorage.getItem('__debugMode') === '1') {
          const params = new URLSearchParams(window.location.search);

          // Hilfsfunktion: wartet auf eine benannte Funktion am window und ruft sie dann auf (mit Timeout)
          function waitForAndCall(fnName, delay = 100, maxWait = 3000) {
            const start = Date.now();
            try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Waiting for ' + fnName); } catch (e) {}
            return new Promise((resolve) => {
              function check() {
                if (typeof window[fnName] === 'function') {
                  try {
                    try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting ' + fnName); } catch (e) {}
                    window[fnName]();
                    try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus(fnName + ' started'); } catch (e) {}
                    resolve(true);
                  } catch (e) { console.error('Auto-run ' + fnName + ' failed', e); alert('Auto-run ' + fnName + ' failed: ' + (e && e.message)); try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus(fnName + ' failed'); } catch (e2) {} resolve(false); }
                } else if (Date.now() - start > maxWait) {
                  console.warn(fnName + ' not available after timeout');
                  try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus(fnName + ' not available (timeout)'); } catch (e) {}
                  resolve(false);
                } else {
                  setTimeout(check, delay);
                }
              }
              check();
            });
          }

          // Record autorun params so deferred handlers can pick them up if functions are defined later
          window.__autorunParams = {
            runPrevTest: params.get('runPrevTest') === '1',
            createPersistTest: params.get('createPersistTest') === '1',
            fixPersistTest: params.get('fixPersistTest') === '1'
          };

          if (window.__autorunParams.runPrevTest) {
            console.log('Auto-running PrevTerm integration test (runPrevTest=1) — waiting for test function');
            waitForAndCall('runPrevTermIntegrationTest', 100, 5000).then(ok => { if (!ok) console.warn('runPrevTermIntegrationTest could not be started (not defined)'); });
          }
          if (window.__autorunParams.createPersistTest) {
            console.log('Auto-creating persistent Oberstufen test course (createPersistTest=1) — waiting for function');
            waitForAndCall('runCreatePersistentUpperSecTestCourse', 100, 5000).then(ok => { if (!ok) console.warn('runCreatePersistentUpperSecTestCourse could not be started (not defined)'); });
          }
          if (window.__autorunParams.fixPersistTest) {
            console.log('Auto-fixing persistent test course (fixPersistTest=1)');
            setTimeout(function () {
              try {
                const NAME = 'Oberstufe Test (persistent)';
                const existing = (state.courses || []).find(c => c.name === NAME);
                if (existing) {
                  existing.includePrevTermGrades = false;
                  currentCourseId = existing.id;
                  persistDiagnosticState();
                  try { render(); } catch (e) {}
                }
              } catch (e) { console.error('Auto-fix failed', e); }
            }, 450);
          }
        }
      } catch (e) { /* ignore in non-browser env */ }

      section.appendChild(cfgBoxSek2);

      const resultBoxSek2 = document.createElement("div");
      resultBoxSek2.id = "exam-sek2-result";
      resultBoxSek2.className = "exam-results";
      resultBoxSek2.setAttribute("role", "region");
      resultBoxSek2.setAttribute("aria-label", "Ergebnis Sek II");
      const emptyResultSek2 = document.createElement("p");
      emptyResultSek2.className = "exam-results-empty text-muted";
      emptyResultSek2.textContent = "Noch keine Tabelle berechnet.";
      resultBoxSek2.appendChild(emptyResultSek2);
      section.appendChild(resultBoxSek2);

      function readThresholdsSek2() {
        const thr = {};
        for (const g of gradeScaleSek2) {
          if (g.label === "0") {
            thr[g.label] = 0;
            continue;
          }
          const inp = gradeInputsSek2.get(g.label);
          if (!inp) {
            thr[g.label] = g.defaultPct;
            continue;
          }
          const rawValue = String(inp.value).trim().replace(",", ".");
          thr[g.label] = rawValue ? Number(rawValue) : NaN;
        }
        return thr;
      }

      function gradeForPointsSek2(points, maxPoints, thr) {
        const ordered = gradeScaleSek2
          .map(g => ({
            label: g.label,
            threshold: (thr[g.label] != null ? thr[g.label] : g.defaultPct)
          }))
          .sort((a, b) => b.threshold - a.threshold);

        for (const g of ordered) {
          if (pointsReachPercentageThreshold(points, maxPoints, g.threshold)) {
            return g.label;
          }
        }
        return "0";
      }

      function renderTableSek2() {
        while (resultBoxSek2.firstChild) { resultBoxSek2.removeChild(resultBoxSek2.firstChild); }

        const maxPoints = parseInt(maxInputSek2.value, 10);
        if (!Number.isFinite(maxPoints) || maxPoints <= 0) {
          const msg = document.createElement("div");
          msg.className = "text-muted";
          msg.textContent = "Bitte eine gültige Maximalpunktzahl (> 0) eingeben.";
          resultBoxSek2.appendChild(msg);
          lastGeneratedSek2 = null;
          return;
        }

        const thr = readThresholdsSek2();
        const validation = GradingLogic.validatePercentageThresholds(gradeScaleSek2, thr, "0");
        if (!validation.ok) {
          const msg = document.createElement("div");
          msg.style.color = "#c62828";
          msg.textContent = validation.message;
          resultBoxSek2.appendChild(msg);
          lastGeneratedSek2 = null;
          return;
        }

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "0.3rem";
        title.textContent =
          "Sek II – Notentabelle für " + maxPoints + " Punkte (Oberstufenpunkte 0–15)";
        resultBoxSek2.appendChild(title);

        const small = document.createElement("div");
        small.className = "text-muted";
        small.style.fontSize = "0.8rem";
        small.style.marginBottom = "0.3rem";

        const nonZero = gradeScaleSek2.filter(g => g.label !== "0");
        const parts = [];
        for (const g of nonZero) {
          const t = (thr[g.label] != null ? thr[g.label] : g.defaultPct);
          parts.push("ab " + t + "% = " + g.label + " P");
        }
        const lowest = nonZero[nonZero.length - 1];
        const lowestThr = (thr[lowest.label] != null ? thr[lowest.label] : lowest.defaultPct);
        small.textContent =
          parts.join(", ") + ", unter " + lowestThr + "% = 0 Punkte.";
        resultBoxSek2.appendChild(small);

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const theadTrK = document.createElement('tr');
        ['Punkte (Klausur)','Prozent','Oberstufenpunkte'].forEach(t => { const th = document.createElement('th'); th.textContent = t; theadTrK.appendChild(th); });
        thead.appendChild(theadTrK);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const rows = [];

        for (let pts = maxPoints; pts >= 0; pts--) {
          const pct = (pts / maxPoints) * 100;
          const grade = gradeForPointsSek2(pts, maxPoints, thr);

          const tr = document.createElement("tr");
          const tdPts = document.createElement("td");
          tdPts.textContent = String(pts);
          const tdPct = document.createElement("td");
          tdPct.textContent = formatLegacyPercent(pct, { digits: 1, spaceBeforeSymbol: true });
          const tdGrade = document.createElement("td");
          tdGrade.textContent = grade;

          tr.appendChild(tdPts);
          tr.appendChild(tdPct);
          tr.appendChild(tdGrade);
          tbody.appendChild(tr);

          rows.push({ points: pts, percent: pct, grade: grade });
        }

        table.appendChild(tbody);
        resultBoxSek2.appendChild(table);

        lastGeneratedSek2 = {
          maxPoints: maxPoints,
          thresholds: thr,
          rows: rows
        };
      }

      function exportCsvSek2() {
        const currentMaxPoints = parseInt(maxInputSek2.value, 10);
        const currentThresholds = readThresholdsSek2();
        const validation = GradingLogic.validatePercentageThresholds(gradeScaleSek2, currentThresholds, "0");
        if (!validation.ok) {
          window.alert(validation.message);
          return;
        }
        if (!lastGeneratedSek2) {
          window.alert("Bitte zuerst eine Tabelle (Sek II) berechnen.");
          return;
        }
        if (
          currentMaxPoints !== lastGeneratedSek2.maxPoints ||
          JSON.stringify(currentThresholds) !== JSON.stringify(lastGeneratedSek2.thresholds)
        ) {
          window.alert("Die Maximalpunktzahl oder Prozentgrenzen wurden seit der letzten Berechnung geändert. Bitte die Tabelle vor dem Export neu berechnen.");
          return;
        }
        const rows = lastGeneratedSek2.rows;
        const lines = [];
        lines.push("Punkte_Klausur;Prozent;Oberstufenpunkte");
        for (const r of rows) {
          const pctStr = formatDecimalComma(r.percent, { digits: 1, trimTrailingZeros: false });
          lines.push(r.points + ";" + pctStr + ";" + r.grade);
        }
        const csvContent = "\ufeff" + lines.join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const date = formatUtcDateStamp(new Date());
        a.href = url;
        a.download =
          "klausurtabelle_sek2_" + lastGeneratedSek2.maxPoints + "pkt_" + date + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      calcBtnSek2.addEventListener("click", renderTableSek2);
      exportCsvBtnSek2.addEventListener("click", exportCsvSek2);

      // -----------------------------
      // Modus-Umschalter (zeigen/verstecken)
      // -----------------------------
      function updateModeVisibility() {
        if (currentMode === MODE_SEK1) {
          cfgBoxSek1.style.display = "";
          resultBoxSek1.style.display = "";
          cfgBoxSek2.style.display = "none";
          resultBoxSek2.style.display = "none";
        } else {
          cfgBoxSek1.style.display = "none";
          resultBoxSek1.style.display = "none";
          cfgBoxSek2.style.display = "";
          resultBoxSek2.style.display = "";
        }
      }

      modeSelect.addEventListener("change", function () {
        currentMode = this.value === MODE_SEK2 ? MODE_SEK2 : MODE_SEK1;
        updateModeVisibility();
      });

      // Initial: Sek I anzeigen
      currentMode = MODE_SEK1;
      updateModeVisibility();

      container.appendChild(section);
    }



        // Rendert die komplette Benutzeroberfläche basierend auf dem aktuellen Zustand
        // und der gewählten Sektion. Blockiert die UI bei aktivierter Verschlüsselung,
        // falls kein Sitzungspasswort vorhanden ist.
        function render() {
          const isLocked = sessionCoordinator.getStatus() !== 'held' || (Storage.isEncrypted() && !Storage.hasSessionPassword());
          if (isLocked) persistenceBoundary.invalidate();
          const schoolName = isLocked ? '' : getSchoolProfile().name;
          document.title = 'Notenverwaltung' + (schoolName ? ' · ' + schoolName : '') + ' · Version ' + APP_RELEASE.version;
          stopAppearanceEffects();
          disposeDashboard();
          dashboardTransition.invalidate();
          clearActiveGradesheetEditors();
          // Falls verschlüsselter Speicher aktiv ist, aber kein Sitzungspasswort vorliegt,
          // die UI blockieren und den Benutzer zum Entsperren (Passwort eingeben) auffordern.
          try {
            if (sessionCoordinator.getStatus() !== 'held' || (Storage.isEncrypted() && !Storage.hasSessionPassword())) {
              removeSessionSensitiveOverlays();
              navigationMenuOpen = false;
              navigationMenuElement = null;
              navigationMenuToggle = null;
              appearanceControlElements = null;
              appearanceFeedbackElement = null;
              pendingGradesheetNavigation = null;
              gradesheetView = 'entry';
              courseEditorOpenForId = null;
              courseEditorActiveTab = 'general';
              courseEditorTabCourseId = null;
              settingsActiveArea = 'periods';
              settingsActiveStage = 'seckI';
              settingsPeriodDrafts = null;
              schoolProfileDraft = null;
              schoolLogoReadId += 1;
              lastNavigationFocusTarget = null;
              while (root.firstChild) { root.removeChild(root.firstChild); }
              root.hidden = false;
              root.inert = false;
              const block = document.createElement('section');
              block.className = 'lock-screen';
              block.setAttribute('aria-labelledby', 'lock-screen-title');

              const dialog = document.createElement('div');
              dialog.className = 'lock-card';

              try {
                const lockSymbol = document.createElement('div');
                lockSymbol.className = 'lock-card__symbol';
                lockSymbol.appendChild(createUiIcon('lock'));
                dialog.appendChild(lockSymbol);
              } catch (e) {}

              const identity = document.createElement('div');
              identity.className = 'lock-card__identity';
              identity.textContent = 'NOTENVERWALTUNG';
              dialog.appendChild(identity);

              const heading = document.createElement('h1');
              heading.id = 'lock-screen-title';
              heading.textContent = 'Anwendung gesperrt';
              dialog.appendChild(heading);

              const msg = document.createElement('p');
              msg.className = 'lock-card__message';
              msg.textContent = pendingLockNotice
                ? LOST_INPUT_NOTICE
                : 'Zum Weiterarbeiten öffnet „Entsperren“ die Passwortabfrage. Bis dahin bleiben Kurse und Noten ausgeblendet.';
              pendingLockNotice = false;
              dialog.appendChild(msg);

              const btnRow = document.createElement('div');
              btnRow.className = 'lock-card__actions';

              const unlockBtn = document.createElement('button');
              unlockBtn.type = 'button';
              unlockBtn.className = 'lock-card__primary';
              unlockBtn.textContent = 'Entsperren';
              let unlockInFlight = false;
              unlockBtn.addEventListener('click', async function () {
                if (unlockInFlight) return;
                unlockInFlight = true;
                unlockBtn.disabled = true;
                invalidateUiStateEpoch();
                try {
                  await init(rootElementId);
                } catch (err) {
                  try { window.alert('Entsperren fehlgeschlagen. Bitte erneut versuchen.'); } catch (e) {}
                } finally {
                  unlockInFlight = false;
                  if (unlockBtn.isConnected) unlockBtn.disabled = false;
                }
              });

              const cancelBtn = document.createElement('button');
              cancelBtn.type = 'button';
              cancelBtn.textContent = 'Gesperrt bleiben';
              cancelBtn.className = 'lock-card__secondary';
              cancelBtn.addEventListener('click', function () {
                // Weiter blockiert lassen, aber dem Benutzer erlauben, in die Einstellungen
                // zu wechseln, um das Verhalten zu ändern
                try { setSection('settings'); render(); } catch (e) {}
              });

              btnRow.appendChild(unlockBtn);
              btnRow.appendChild(cancelBtn);
              dialog.appendChild(btnRow);
              block.appendChild(dialog);
              root.appendChild(block);
              try { unlockBtn.focus(); } catch (e) {}
              return;
            }
          } catch (e) {}

          while (root.firstChild) { root.removeChild(root.firstChild); }

          const frame = document.createElement('div');
          frame.className = 'app-frame';
          const sidebar = document.createElement('aside');
          sidebar.className = 'app-sidebar';
          sidebar.setAttribute('aria-label', 'Seitennavigation');

          renderHeader(frame);
          renderDesignBar(frame);
          renderNav(sidebar);

          const main = document.createElement("main");
          main.className = "app-main";

          switch (currentSection) {
            case "dashboard":
              renderDashboardSection(main);
              break;
            case "courses":
              renderCoursesSection(main);
              break;
            case "students":
              renderStudentsSection(main);
              break;
            case "gradesheet":
              renderGradesheetSection(main, gradesheetTransition);
              if (gradesheetView === 'entry') recordGradesheetVisit(currentCourseId);
              break;
            case "stats":
              renderStatsSection(main);
              break;
            case "settings":
              renderSettingsSection(main);
              break;
            case "import":
              renderImportSection(main);
              break;
            case "exam":
              renderExamSection(main);
              break;
            default:
              renderCoursesSection(main);
          }

          frame.appendChild(sidebar);
          frame.appendChild(main);
          root.appendChild(frame);
          if (captureBusy) freezeCaptureControls();
          if (focusTargetHeading) {
            const heading = main.querySelector('h2');
            if (heading) {
              heading.setAttribute('tabindex', '-1');
              heading.focus();
            }
            focusTargetHeading = false;
          }
        }

        function escapeHtml(str) {
          return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        }

        render();
        _replaceColorSchemeListener(systemColorScheme, updateSystemAppearance);
        _replaceReducedMotionListener(systemReducedMotion, updateSystemMotion);
        replaceAuroraInteractionListeners();
        // Erst ein vollstaendig erfolgreicher Initial-Render wird fuer das
        // stabile sessionCleared-Event aktiv. Ein fehlgeschlagenes init
        // hinterlaesst dadurch keine aufrufbare alte render-Closure.
        _activeSessionClearedRender = function () {
          const lost = pendingLockNotice || hasUnsavedInput();
          if (manualLock && !manualLock.ending) {
            manualLock.ending = true;
            if (manualLock.watchdog !== null) clearTimeout(manualLock.watchdog);
          }
          pendingLockNotice = lost;
          invalidateUiStateEpoch();
          render();
          clearPrivateBodyOverlays();
          removePrivacyLockOverlay();
        };
        observeUnsavedBeforeExit = hasUnsavedInput;
        maskBeforeHardBoundary = maskPrivateRoot;

        // Debug-API: Nur im Debug-Modus exponieren (SICHERHEIT: verhindert unkontrollierten Zugriff auf State)
        async function runLoadSecurityRegressionTests() {
          const cases = [];
          const metrics = {};
          function record(name, passed, detail = "") {
            cases.push({ name, passed: !!passed, detail: String(detail || "") });
          }
          async function rejects(action) {
            try { await action(); return false; } catch (error) { return true; }
          }

          const legacyState = DomainModel.createEmptyState();
          const legacyCourse = DomainModel.createCourse({ id: "course_legacy_archive_metadata", name: "Synthetischer Altkurs", subject: "Testfach", classLabel: "T1" });
          delete legacyCourse.archiveRetentionUntil;
          delete legacyCourse.archiveNote;
          legacyState.courses.push(legacyCourse);
          const migratedLegacy = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(legacyState)));
          record("Altdaten ohne neue Archivfelder", migratedLegacy.courses[0].archiveRetentionUntil === null && migratedLegacy.courses[0].archiveNote === null);

          const wave3aState = DomainModel.createEmptyState();
          const wave3aCourse = DomainModel.createCourse({ id: "course_wave3a_valid", name: "Synthetischer Migrationskurs", subject: "Testfach", classLabel: "T3A" });
          wave3aState.courses.push(wave3aCourse, null);
          const wave3aOralId = wave3aState.settings.categories[0].id;
          const wave3aWrittenId = wave3aState.settings.categories[1].id;
          wave3aState.settings.categories[0].name = "Praxis";
          wave3aState.settings.categories[1].name = "Theorie";
          wave3aState.settings.weightTemplates = [{
            id: "wt_wave3a_legacy",
            name: "Standard Sek I (67/33)",
            items: [
              { categoryId: wave3aOralId, weightPercent: 67 },
              { categoryId: wave3aWrittenId, weightPercent: 33 }
            ]
          }];
          wave3aState.settings.halfYearSettings = {
            seckI: { schoolYearStartYear: 2030 },
            seckII: { schoolYearStartYear: 2034 }
          };
          wave3aState.settings.halfYearNames = [];
          wave3aState.settings.termCutoffs = [];
          const migratedWave3a = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(wave3aState)));
          record(
            "Wave 3A: beschädigte Listeneinträge werden entfernt",
            migratedWave3a.courses.length === 1 && migratedWave3a.courses[0].id === wave3aCourse.id
          );
          record(
            "Wave 3A: Einstellungen bleiben JSON-serialisierbare Objekte",
            !!migratedWave3a.settings.halfYearNames && !Array.isArray(migratedWave3a.settings.halfYearNames) &&
              !!migratedWave3a.settings.termCutoffs && !Array.isArray(migratedWave3a.settings.termCutoffs)
          );
          record(
            "Wave 3A: H1 endet im Folgejahr",
            migratedWave3a.settings.halfYearSettings.seckI.h1EndYear === 2031 &&
              migratedWave3a.settings.halfYearSettings.seckII.h1EndYear === 2035
          );
          const wave3aRecommendedIds = [
            "wt_berlin_seki_50_50_example",
            "wt_berlin_sekii_one_exam",
            "wt_berlin_sekii_two_exams"
          ];
          record(
            "Wave 3A: Berliner Profile nutzen belegte Alt-IDs genau einmal",
            wave3aRecommendedIds.every(id => migratedWave3a.settings.weightTemplates.filter(template => template.id === id).length === 1) &&
              migratedWave3a.settings.weightTemplates
                .filter(template => wave3aRecommendedIds.includes(template.id))
                .every(template => template.items.some(item => item.categoryId === wave3aOralId) && template.items.some(item => item.categoryId === wave3aWrittenId))
          );

          const wave3bState = DomainModel.createEmptyState();
          const wave3bCategories = wave3bState.settings.categories;
          wave3bState.settings.weightTemplates.push({
            id: "wt_wave3b_regression",
            name: "Wave-3B-Regressionsgewichtung",
            items: [
              { categoryId: wave3bCategories[0].id, weightPercent: 50 },
              { categoryId: wave3bCategories[1].id, weightPercent: 40 },
              { categoryId: wave3bCategories[2].id, weightPercent: 10 }
            ]
          });
          const wave3bStudent = DomainModel.createStudent({ id: "student_wave3b", lastName: "Regression", firstName: "Wave 3B" });
          const wave3bCourse = DomainModel.createCourse({
            id: "course_wave3b",
            name: "Wave-3B-Regressionskurs",
            schemaMode: DomainModel.SCHEMA_MODES.GRADES,
            weightTemplateId: "wt_wave3b_regression"
          });
          wave3bState.students.push(wave3bStudent);
          wave3bState.courses.push(wave3bCourse);
          DomainModel.enrollStudentInCourse(wave3bState, wave3bCourse.id, wave3bStudent.id);
          const wave3bAssessments = [
            { category: wave3bCategories[0], title: "Schriftlich", value: "1", weight: 1 },
            { category: wave3bCategories[1], title: "Mündlich", value: "4", weight: 1 },
            { category: wave3bCategories[2], title: "Sonstiges", value: "4", weight: 1 }
          ].map(spec => {
            const assessment = DomainModel.createAssessment({
              id: "asm_wave3b_" + spec.title,
              courseId: wave3bCourse.id,
              categoryId: spec.category.id,
              title: spec.title,
              weight: spec.weight
            });
            assessment.scores[wave3bStudent.id] = DomainModel.createScoreEntry({ valueRaw: spec.value });
            wave3bState.assessments.push(assessment);
            return assessment;
          });
          wave3bCategories[2].active = false;
          const wave3bOverall = GradingLogic.computeOverallGrade(wave3bCourse, wave3bStudent.id, wave3bState);
          record("Wave 3B M1: inaktive Kategorie wird renormalisiert ausgeschlossen", Math.abs(wave3bOverall - 210 / 90) < 1e-9, wave3bOverall);

          wave3bAssessments[1].weight = 0;
          const wave3bCategoryAverage = GradingLogic.computeCategoryAverage(
            wave3bAssessments,
            wave3bCourse,
            wave3bStudent.id,
            wave3bCategories[1].id,
            wave3bState.settings
          );
          record(
            "Wave 3B M2: Gewicht 0 bleibt erhalten und wird ausgeschlossen",
            DomainModel.createAssessment({ courseId: wave3bCourse.id, categoryId: wave3bCategories[1].id, title: "Nullgewicht", weight: 0 }).weight === 0 &&
              wave3bCategoryAverage === null
          );

          const wave3bStatsState = DomainModel.createEmptyState();
          const wave3bStatsStudent = DomainModel.createStudent({ id: "student_wave3b_stats", lastName: "Verteilung", firstName: "Wave 3B" });
          const wave3bStatsCourse = DomainModel.createCourse({ id: "course_wave3b_stats", name: "Wave-3B-Verteilung" });
          wave3bStatsState.students.push(wave3bStatsStudent);
          wave3bStatsState.courses.push(wave3bStatsCourse);
          DomainModel.enrollStudentInCourse(wave3bStatsState, wave3bStatsCourse.id, wave3bStatsStudent.id);
          ["1-", "2-", "2-"].forEach((value, index) => {
            const assessment = DomainModel.createAssessment({
              id: "asm_wave3b_stats_" + index,
              courseId: wave3bStatsCourse.id,
              categoryId: wave3bStatsState.settings.categories[0].id,
              title: "Verteilung " + index
            });
            assessment.scores[wave3bStatsStudent.id] = DomainModel.createScoreEntry({ valueRaw: value });
            wave3bStatsState.assessments.push(assessment);
          });
          const wave3bStatistics = GradingLogic.computeCourseStatistics(wave3bStatsCourse, wave3bStatsState);
          record(
            "Wave 3B H6: Randwerte fallen lückenlos in genau einen Bereich",
            wave3bStatistics.count === 1 &&
              wave3bStatistics.distribution.reduce((sum, bucket) => sum + bucket.count, 0) === wave3bStatistics.count,
            wave3bStatistics.mean
          );

          const wave4aState = DomainModel.createEmptyState();
          const wave4aCategory = wave4aState.settings.categories[0];
          wave4aCategory.subcategories = [
            { id: "subcat_wave4a_valid", name: "Gewichtet", weightPercent: 60 },
            { id: "subcat_wave4a_pending", name: "Noch offen", weightPercent: 0 }
          ];
          const wave4aStudent = DomainModel.createStudent({ id: "student_wave4a", lastName: "Regression", firstName: "Wave 4A" });
          const wave4aCourse = DomainModel.createCourse({ id: "course_wave4a", name: "Wave-4A-Regressionskurs" });
          wave4aState.students.push(wave4aStudent);
          wave4aState.courses.push(wave4aCourse);
          const wave4aAssessments = [
            { id: "asm_wave4a_valid", subcategoryId: "subcat_wave4a_valid", value: "1" },
            { id: "asm_wave4a_pending", subcategoryId: "subcat_wave4a_pending", value: "5" }
          ].map(spec => {
            const assessment = DomainModel.createAssessment({
              id: spec.id,
              courseId: wave4aCourse.id,
              categoryId: wave4aCategory.id,
              subcategoryId: spec.subcategoryId,
              title: spec.id
            });
            assessment.scores[wave4aStudent.id] = DomainModel.createScoreEntry({ valueRaw: spec.value });
            wave4aState.assessments.push(assessment);
            return assessment;
          });
          const wave4aPendingAverage = GradingLogic.computeCategoryAverage(
            wave4aAssessments,
            wave4aCourse,
            wave4aStudent.id,
            wave4aCategory.id,
            wave4aState.settings
          );
          record(
            "Wave 4A H2: unvollständige Gewichte bleiben in flacher Berechnung",
            DomainModel.getDefaultSubcategoryWeight({ subcategories: [] }) === 100 &&
              DomainModel.getDefaultSubcategoryWeight({ subcategories: [{}] }) === 0 &&
              wave4aPendingAverage === 3,
            wave4aPendingAverage
          );

          wave4aAssessments[1].subcategoryId = "subcat_wave4a_deleted";
          const wave4aOrphanAverage = GradingLogic.computeCategoryAverage(
            wave4aAssessments,
            wave4aCourse,
            wave4aStudent.id,
            wave4aCategory.id,
            wave4aState.settings
          );
          record(
            "Wave 4A H3: gelöschte Zuordnung bleibt in flacher Berechnung",
            wave4aOrphanAverage === 3,
            wave4aOrphanAverage
          );

          const wave6aState = DomainModel.createEmptyState();
          const wave6aWrittenCategory = wave6aState.settings.categories.find(category => category.name === "Schriftlich");
          const wave6aOtherCategory = wave6aState.settings.categories.find(category => category.name === "Sonstiges");
          const wave6aStudentId = "student_wave6a_m33";
          const wave6aCourse = DomainModel.createCourse({ id: "course_wave6a_m33", name: "Wave-6A-M33" });
          wave6aCourse.weightTemplateId = wave6aState.settings.weightTemplates[0].id;
          wave6aOtherCategory.active = false;
          const wave6aWrittenAssessment = DomainModel.createAssessment({
            id: "asm_wave6a_written",
            courseId: wave6aCourse.id,
            categoryId: wave6aWrittenCategory.id,
            title: "Aktive Kategorie"
          });
          const wave6aOtherAssessment = DomainModel.createAssessment({
            id: "asm_wave6a_other",
            courseId: wave6aCourse.id,
            categoryId: wave6aOtherCategory.id,
            title: "Deaktivierte Kategorie"
          });
          wave6aWrittenAssessment.scores[wave6aStudentId] = DomainModel.createScoreEntry({ valueRaw: "1" });
          wave6aOtherAssessment.scores[wave6aStudentId] = DomainModel.createScoreEntry({ valueRaw: "6" });
          const wave6aOverall = GradingLogic.computeWeightedOverallForAssessments(
            [wave6aWrittenAssessment, wave6aOtherAssessment],
            wave6aCourse,
            wave6aStudentId,
            wave6aState.settings
          );
          record(
            "Wave 6A M33: deaktivierte Vorlagenkategorie bleibt in allen Teilmengen ohne Einfluss",
            wave6aOverall === 1,
            wave6aOverall
          );
          const wave6aSplitCell = document.createElement("td");
          wave6aSplitCell.className = "gradesheet-avg term-current";
          const wave6aSplitOverall = renderWeightedOverallCell(
            wave6aSplitCell,
            [wave6aWrittenAssessment, wave6aOtherAssessment],
            wave6aCourse,
            wave6aStudentId,
            wave6aState.settings
          );
          record(
            "Wave 6A M33: getrennte Halbjahrestabelle zeigt nur aktive Kategorien",
            wave6aSplitOverall === 1 && wave6aSplitCell.textContent === "1.00",
            { overall: wave6aSplitOverall, text: wave6aSplitCell.textContent }
          );
          const wave6aCombinedCell = document.createElement("td");
          wave6aCombinedCell.className = "gradesheet-avg";
          const wave6aCombinedOverall = renderWeightedOverallCell(
            wave6aCombinedCell,
            [wave6aWrittenAssessment, wave6aOtherAssessment],
            wave6aCourse,
            wave6aStudentId,
            wave6aState.settings
          );
          record(
            "Wave 6A M33: kombinierte Notentabelle zeigt nur aktive Kategorien",
            wave6aCombinedOverall === 1 && wave6aCombinedCell.textContent === "1.00",
            { overall: wave6aCombinedOverall, text: wave6aCombinedCell.textContent }
          );

          const wave7State = DomainModel.createEmptyState();
          const wave7Category = wave7State.settings.categories.find(category => category.name === "Schriftlich");
          const wave7StudentId = "student_wave7_h11";
          const wave7Course = DomainModel.createCourse({ id: "course_wave7_h11", name: "Wave-7-H11" });
          wave7Course.weightTemplateId = wave7State.settings.weightTemplates[0].id;
          const wave7VisibleAssessment = DomainModel.createAssessment({
            id: "asm_wave7_visible",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Im PDF sichtbar",
            term: "2025-H1",
            visible: true
          });
          const wave7HiddenAssessment = DomainModel.createAssessment({
            id: "asm_wave7_hidden",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Nur intern",
            term: "2025-H1",
            visible: false
          });
          wave7VisibleAssessment.scores[wave7StudentId] = DomainModel.createScoreEntry({ valueRaw: "1" });
          wave7HiddenAssessment.scores[wave7StudentId] = DomainModel.createScoreEntry({ valueRaw: "5" });
          const wave7Assessments = [wave7VisibleAssessment, wave7HiddenAssessment];
          const wave7PdfAssessments = filterPdfAssessments(wave7Assessments, wave7Course, "2025-H1", "2025-H1");
          record(
            "Wave 7 H11: PDF-Berichte schließen intern markierte Leistung aus",
            wave7PdfAssessments.length === 1 && wave7PdfAssessments[0].id === wave7VisibleAssessment.id,
            wave7PdfAssessments.map(assessment => assessment.id).join(",")
          );
          const wave7InternalOverall = GradingLogic.computeWeightedOverallForAssessments(
            wave7Assessments,
            wave7Course,
            wave7StudentId,
            wave7State.settings
          );
          const wave7PdfOverall = GradingLogic.computeWeightedOverallForAssessments(
            wave7PdfAssessments,
            wave7Course,
            wave7StudentId,
            wave7State.settings
          );
          record(
            "Wave 7 H11: PDF-Sichtbarkeit verändert interne Berechnung nicht",
            wave7InternalOverall === 3 && wave7PdfOverall === 1,
            { internal: wave7InternalOverall, pdf: wave7PdfOverall }
          );

          const wave7DateOnlyAssessment = DomainModel.createAssessment({
            id: "asm_wave7_date_only",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Datum ohne gespeicherten Term",
            date: "2025-10-15",
            visible: true
          });
          delete wave7DateOnlyAssessment.term;
          const wave7DateOnlyPdf = filterPdfAssessments(
            [wave7DateOnlyAssessment],
            wave7Course,
            "2025-H1",
            "2025-H2",
            () => "2025-H1"
          );
          record(
            "Wave 7 H11: PDF-Termfilter verarbeitet Leistung nur mit Datum",
            wave7DateOnlyPdf.length === 1 && wave7DateOnlyPdf[0].id === wave7DateOnlyAssessment.id,
            wave7DateOnlyPdf.map(assessment => assessment.id).join(",")
          );

          wave7Course.includePrevTermGrades = true;
          const wave7CurrentAssessment = DomainModel.createAssessment({
            id: "asm_wave7_current",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Aktuelles Halbjahr",
            term: "2025-H2",
            visible: true
          });
          const wave7PreviousAssessment = DomainModel.createAssessment({
            id: "asm_wave7_previous",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Vorhalbjahr",
            term: "2025-H1",
            visible: true
          });
          const wave7HiddenPreviousAssessment = DomainModel.createAssessment({
            id: "asm_wave7_previous_hidden",
            courseId: wave7Course.id,
            categoryId: wave7Category.id,
            title: "Vorhalbjahr nur intern",
            term: "2025-H1",
            visible: false
          });
          const wave7OverallPdf = filterPdfOverallAssessments(
            [wave7CurrentAssessment, wave7PreviousAssessment, wave7HiddenPreviousAssessment],
            wave7Course,
            "2025-H2",
            "2025-H2"
          );
          record(
            "Wave 7 H11: PDF-Gesamtnote bezieht nur sichtbares Vorhalbjahr ein",
            wave7OverallPdf.length === 2 &&
              wave7OverallPdf[0].id === wave7CurrentAssessment.id &&
              wave7OverallPdf[1].id === wave7PreviousAssessment.id,
            wave7OverallPdf.map(assessment => assessment.id).join(",")
          );

          const wave5ArchiveState = DomainModel.createEmptyState();
          const wave5ArchiveCategory = wave5ArchiveState.settings.categories[1];
          const wave5ArchiveStudent = DomainModel.createStudent({ id: "student_wave5_archive", lastName: "Regression", firstName: "Wave 5" });
          const wave5ArchiveCourse = DomainModel.createCourse({ id: "course_wave5_archive", name: "Wave-5-Archivkurs" });
          wave5ArchiveState.students.push(wave5ArchiveStudent);
          wave5ArchiveState.courses.push(wave5ArchiveCourse);
          [
            { id: "asm_wave5_archive_h1", term: "2020-H1", value: "4" },
            { id: "asm_wave5_archive_h2", term: "2020-H2", value: "2" }
          ].forEach(spec => {
            const assessment = DomainModel.createAssessment({
              id: spec.id,
              courseId: wave5ArchiveCourse.id,
              categoryId: wave5ArchiveCategory.id,
              title: spec.id,
              term: spec.term
            });
            assessment.scores[wave5ArchiveStudent.id] = DomainModel.createScoreEntry({ valueRaw: spec.value });
            wave5ArchiveState.assessments.push(assessment);
          });
          DomainModel.archiveCourse(wave5ArchiveState, wave5ArchiveCourse.id, "manual", {});
          const wave5ArchiveOverall = GradingLogic.computeOverallGrade(wave5ArchiveCourse, wave5ArchiveStudent.id, wave5ArchiveState);
          record(
            "Wave 5 K2/M31: Archivkurs erkennt H2 und wertet in Sek I H1 und H2 gemeinsam",
            wave5ArchiveOverall === 3,
            wave5ArchiveOverall
          );

          const wave5SaveAssessment = {
            scores: {
              student_wave5_save: { status: DomainModel.SCORE_STATUS.VALID, valueRaw: "2", valueNumeric: 2 }
            }
          };
          const wave5SaveQueue = createSerializedTransactionQueue();
          const wave5SaveRejected = await rejects(function () {
            return persistScoreEntryWithRollback(
              wave5SaveAssessment,
              "student_wave5_save",
              { status: DomainModel.SCORE_STATUS.VALID, valueRaw: "5", valueNumeric: 5 },
              function () { return Promise.reject(new Error("Synthetischer Speicherfehler")); },
              wave5SaveQueue
            );
          });
          record(
            "Wave 5 K4: Speicherfehler stellt den vorherigen Noteneintrag wieder her",
            wave5SaveRejected && wave5SaveAssessment.scores.student_wave5_save.valueRaw === "2"
          );

          const wave5RaceAssessment = {
            scores: {
              student_wave5_race: { status: DomainModel.SCORE_STATUS.VALID, valueRaw: "2", valueNumeric: 2 }
            }
          };
          const wave5RaceQueue = createSerializedTransactionQueue();
          const wave5RaceOrder = [];
          let releaseWave5FirstSave;
          const wave5FirstGate = new Promise(function (resolve) { releaseWave5FirstSave = resolve; });
          const wave5FirstSave = persistScoreEntryWithRollback(
            wave5RaceAssessment,
            "student_wave5_race",
            { status: DomainModel.SCORE_STATUS.VALID, valueRaw: "4", valueNumeric: 4 },
            function () { wave5RaceOrder.push("first"); return wave5FirstGate; },
            wave5RaceQueue
          );
          const wave5SecondSave = persistScoreEntryWithRollback(
            wave5RaceAssessment,
            "student_wave5_race",
            { status: DomainModel.SCORE_STATUS.VALID, valueRaw: "1", valueNumeric: 1 },
            function () { wave5RaceOrder.push("second"); return Promise.resolve(); },
            wave5RaceQueue
          );
          await Promise.resolve();
          await Promise.resolve();
          const wave5SecondWasQueued = wave5RaceOrder.join(",") === "first";
          releaseWave5FirstSave();
          await wave5FirstSave;
          await wave5SecondSave;
          record(
            "Wave 5 K4: schnelle Folgeänderungen werden serialisiert gespeichert",
            wave5SecondWasQueued && wave5RaceOrder.join(",") === "first,second" &&
              wave5RaceAssessment.scores.student_wave5_race.valueRaw === "1"
          );
          const wave5BeginInteraction = createLatestInteractionGuard();
          const wave5FirstUiCompletion = wave5BeginInteraction();
          const wave5LatestUiCompletion = wave5BeginInteraction();
          record(
            "Wave 5 K4: nur die jüngste Folgeänderung darf sichtbares Feedback setzen",
            !wave5FirstUiCompletion() && wave5LatestUiCompletion()
          );

          const archiveState = DomainModel.createEmptyState();
          const archiveCourse = DomainModel.createCourse({ id: "course_archive_metadata", name: "Synthetischer Archivkurs", subject: "Testfach", classLabel: "T2" });
          archiveState.courses.push(archiveCourse);
          DomainModel.archiveCourse(archiveState, archiveCourse.id, "manual", { archiveRetentionUntil: "2031-07-31", archiveNote: "Synthetische Aufbewahrungsnotiz" });
          const archiveRoundTrip = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(archiveState)));
          record("Archivmetadaten JSON-Rundlauf", archiveRoundTrip.courses[0].archiveRetentionUntil === "2031-07-31" && archiveRoundTrip.courses[0].archiveNote === "Synthetische Aufbewahrungsnotiz");
          DomainModel.restoreCourse(archiveRoundTrip, archiveCourse.id);
          record("Wiederherstellen entfernt Archivmetadaten", archiveRoundTrip.courses[0].archiveRetentionUntil === null && archiveRoundTrip.courses[0].archiveNote === null);
          record("Ungültiges Aufbewahrungsdatum wird verworfen", DomainModel.normalizeArchiveRetentionUntil("2031-02-30") === null);
          record("Archivnotiz wird begrenzt", DomainModel.normalizeArchiveNote("x".repeat(1100)).length === 1000);

          const largeState = DomainModel.createEmptyState();
          const largeCategoryId = largeState.settings.categories[0].id;
          for (let studentIndex = 0; studentIndex < 240; studentIndex++) {
            largeState.students.push(DomainModel.createStudent({
              id: "stu_load_" + studentIndex,
              lastName: "Testnachname " + studentIndex,
              firstName: "Synthetisch " + studentIndex,
              homeClass: "T" + (studentIndex % 8)
            }));
          }
          for (let courseIndex = 0; courseIndex < 10; courseIndex++) {
            const course = DomainModel.createCourse({ id: "course_load_" + courseIndex, name: "Belastungskurs " + courseIndex, subject: "Testfach", classLabel: "T" + courseIndex });
            course.enrollments = largeState.students.map(student => ({ studentId: student.id, subgroup: null, homeClassAtEnrollment: student.homeClass }));
            largeState.courses.push(course);
            for (let assessmentIndex = 0; assessmentIndex < 18; assessmentIndex++) {
              const assessment = DomainModel.createAssessment({
                id: "asm_load_" + courseIndex + "_" + assessmentIndex,
                courseId: course.id,
                categoryId: largeCategoryId,
                title: "Synthetische Leistung " + assessmentIndex,
                date: "2026-01-15",
                term: "2025-H1"
              });
              for (const student of largeState.students) {
                assessment.scores[student.id] = DomainModel.createScoreEntry({ valueRaw: "2", status: DomainModel.SCORE_STATUS.VALID, valueNumeric: 2 });
              }
              largeState.assessments.push(assessment);
            }
          }
          const loadJson = JSON.stringify(largeState);
          const loadStarted = performance.now();
          const normalizedLarge = DomainModel.ensureStateShape(JSON.parse(loadJson));
          metrics.largeStateBytes = loadJson.length;
          metrics.largeStateNormalizeMs = Math.round((performance.now() - loadStarted) * 10) / 10;
          metrics.largeStateStudents = normalizedLarge.students.length;
          metrics.largeStateCourses = normalizedLarge.courses.length;
          metrics.largeStateAssessments = normalizedLarge.assessments.length;
          metrics.largeStateScores = normalizedLarge.assessments.reduce((sum, assessment) => sum + Object.keys(assessment.scores || {}).length, 0);
          record("Großer synthetischer Bestand", metrics.largeStateStudents === 240 && metrics.largeStateCourses === 10 && metrics.largeStateAssessments === 180 && metrics.largeStateScores === 43200, metrics.largeStateNormalizeMs + " ms");

          const rolloverState = DomainModel.createEmptyState();
          rolloverState.settings.halfYearSettings.seckI.schoolYearStartYear = 2024;
          const rolloverCategoryId = rolloverState.settings.categories[0].id;
          for (let courseIndex = 0; courseIndex < 4; courseIndex++) {
            const course = DomainModel.createCourse({ id: "course_roll_0_" + courseIndex, name: "Wechselkurs " + courseIndex, subject: "Testfach", classLabel: "T" + courseIndex, schoolYearStartYear: 2024 });
            rolloverState.courses.push(course);
            rolloverState.assessments.push(DomainModel.createAssessment({ id: "asm_roll_" + courseIndex, courseId: course.id, categoryId: rolloverCategoryId, title: "Historische Leistung", date: "2025-01-15", term: "2024-H1" }));
          }
          for (let cycle = 1; cycle <= 5; cycle++) {
            const activeCourses = DomainModel.listActiveCourses(rolloverState);
            for (const oldCourse of activeCourses) {
              DomainModel.archiveCourse(rolloverState, oldCourse.id, "school-year-change", { archiveRetentionUntil: "2035-07-31", archiveNote: "Synthetischer Mehrfachwechsel" });
              rolloverState.courses.push(DomainModel.createCourse({
                id: "course_roll_" + cycle + "_" + oldCourse.id.split("_").pop(),
                name: oldCourse.name,
                subject: oldCourse.subject,
                classLabel: oldCourse.classLabel,
                schemaMode: oldCourse.schemaMode,
                schoolYearStartYear: 2024 + cycle,
                carriedForwardFromCourseId: oldCourse.id
              }));
            }
            rolloverState.settings.halfYearSettings.seckI.schoolYearStartYear = 2024 + cycle;
          }
          const rolloverActive = DomainModel.listActiveCourses(rolloverState);
          const rolloverArchived = DomainModel.listArchivedCourses(rolloverState);
          metrics.rolloverCycles = 5;
          metrics.rolloverActiveCourses = rolloverActive.length;
          metrics.rolloverArchivedCourses = rolloverArchived.length;
          record("Fünf wiederholte Schuljahreswechsel", rolloverActive.length === 4 && rolloverArchived.length === 20 && rolloverState.courses.length === 24 && rolloverState.assessments.length === 4 && rolloverActive.every(course => !!course.carriedForwardFromCourseId));

          const backupState = DomainModel.createEmptyState();
          const backupCourse = DomainModel.createCourse({ id: "course_backup_test", name: "Synthetischer Backupkurs", subject: "Testfach", classLabel: "TB" });
          backupState.courses.push(backupCourse);
          DomainModel.archiveCourse(backupState, backupCourse.id, "manual", { archiveRetentionUntil: "2032-12-31", archiveNote: "Synthetischer Backuptest" });
          const testPassword = "Synthetisches-Testpasswort-2026";
          const structuredBackup = await Storage.exportStateEncrypted(testPassword, backupState);
          const importedBackup = DomainModel.ensureStateShape(await Storage.importStateEncryptedFromText(structuredBackup, testPassword));
          record("Verschlüsselter Backup-Rundlauf", importedBackup.courses[0].archiveRetentionUntil === "2032-12-31" && importedBackup.courses[0].archiveNote === "Synthetischer Backuptest");
          record("Falsches Backup-Passwort wird abgelehnt", await rejects(() => Storage.importStateEncryptedFromText(structuredBackup, "Falsches-Synthetisches-Passwort")));
          record("Beschädigtes JSON wird abgelehnt", await rejects(() => Storage.importStateEncryptedFromText("{unvollstaendig", testPassword)));
          const tamperedBackupObject = JSON.parse(structuredBackup);
          tamperedBackupObject.payload = tamperedBackupObject.payload.slice(0, -1) + (tamperedBackupObject.payload.endsWith("A") ? "B" : "A");
          record("Manipulierter Ciphertext wird abgelehnt", await rejects(() => Storage.importStateEncryptedFromText(JSON.stringify(tamperedBackupObject), testPassword)));
          const unknownFormatObject = JSON.parse(structuredBackup);
          unknownFormatObject.format = "unbekanntes_testformat";
          record("Unbekanntes Backupformat wird abgelehnt", await rejects(() => Storage.importStateEncryptedFromText(JSON.stringify(unknownFormatObject), testPassword)));
          const rawPortableBackup = await Storage._encryptJsonWithSalt(JSON.stringify(backupState), testPassword);
          const rawPortableRoundTrip = DomainModel.ensureStateShape(JSON.parse(await Storage._decryptPayload(rawPortableBackup, testPassword)));
          record("Portables Raw-Backup mit Salt", rawPortableRoundTrip.courses[0].archiveRetentionUntil === "2032-12-31");
          record("Falsches Passwort beim Raw-Backup wird abgelehnt", await rejects(() => Storage._decryptPayload(rawPortableBackup, "Falsches-Synthetisches-Passwort")));

          const wave8State = DomainModel.createEmptyState();
          const wave8Student = DomainModel.createStudent({
            id: "stu_wave8_m32", lastName: "Regression", firstName: "M32"
          });
          const wave8Course = DomainModel.createCourse({
            id: "course_wave8_m32", name: "Wave-8-Sek-II", subject: "Testfach", classLabel: "QX",
            schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
          });
          wave8State.students.push(wave8Student);
          wave8State.courses.push(wave8Course);
          DomainModel.enrollStudentInCourse(wave8State, wave8Course.id, wave8Student.id);
          record(
            "Wave 8 M32: ohne Festsetzung bleibt die Punktzahl leer",
            DomainModel.getTermResult(wave8Course, wave8Student.id, "2025-H1") === null
          );
          const wave8Zero = DomainModel.setTermResult(wave8State, wave8Course.id, wave8Student.id, "2025-H1", 0);
          const wave8Fifteen = DomainModel.setTermResult(wave8State, wave8Course.id, wave8Student.id, "2025-H1", 15);
          record(
            "Wave 8 M32: die Grenzen 0 und 15 werden gesetzt und gelesen",
            wave8Zero === 0 && wave8Fifteen === 15 &&
              DomainModel.getTermResult(wave8Course, wave8Student.id, "2025-H1") === 15
          );
          DomainModel.setTermResult(wave8State, wave8Course.id, wave8Student.id, "2025-H1", 12);
          const wave8FinalizedPresentation = buildUpperSecResultPresentation(
            wave8Course, wave8Student.id, "2025-H1", 11.50
          );
          const wave8MissingPresentation = buildUpperSecResultPresentation(
            wave8Course, wave8Student.id, "2025-H2", 10.25
          );
          record(
            "Wave 8 M32: Rechenwert 11.50 bleibt neben Festsetzung 12 unverändert",
            wave8FinalizedPresentation.calculatedText === "11.50" && wave8FinalizedPresentation.finalizedPoints === 12
          );
          record(
            "Wave 8 M32: Darstellung trennt vorhandene Festsetzung und blendet fehlende aus",
            wave8FinalizedPresentation.calculatedLabel === "Rechenwert" &&
              wave8FinalizedPresentation.finalizedLabel === "Festgesetzte Punktzahl" &&
              wave8FinalizedPresentation.finalizedPoints === 12 && wave8MissingPresentation.finalizedPoints === null
          );
          DomainModel.archiveCourse(wave8State, wave8Course.id, "manual", {});
          record(
            "Wave 8 M32: Archiv bewahrt 12 und weist Schreibversuche ab",
            DomainModel.getTermResult(wave8Course, wave8Student.id, "2025-H1") === 12 &&
              await rejects(() => Promise.resolve(DomainModel.setTermResult(
                wave8State, wave8Course.id, wave8Student.id, "2025-H1", 13
              )))
          );
          const wave8LegacyState = DomainModel.createEmptyState();
          const wave8LegacyCourse = DomainModel.createCourse({
            id: "course_wave8_legacy", name: "Wave-8-Altkurs", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
          });
          delete wave8LegacyCourse.termResults;
          wave8LegacyState.courses.push(wave8LegacyCourse);
          const wave8MigratedState = DomainModel.ensureStateShape(JSON.parse(JSON.stringify(wave8LegacyState)));
          record(
            "Wave 8 M32: Migration ergänzt termResults für Altkurse",
            Array.isArray(wave8MigratedState.courses[0].termResults) && wave8MigratedState.courses[0].termResults.length === 0
          );
          const wave8PersistenceState = DomainModel.createEmptyState();
          const wave8PersistenceStudent = DomainModel.createStudent({
            id: "stu_wave8_m32_persist", lastName: "Rundlauf", firstName: "M32"
          });
          const wave8PersistenceCourse = DomainModel.createCourse({
            id: "course_wave8_m32_persist", name: "Wave-8-Rundlauf", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
          });
          wave8PersistenceState.students.push(wave8PersistenceStudent);
          wave8PersistenceState.courses.push(wave8PersistenceCourse);
          DomainModel.enrollStudentInCourse(
            wave8PersistenceState, wave8PersistenceCourse.id, wave8PersistenceStudent.id
          );
          DomainModel.setTermResult(
            wave8PersistenceState, wave8PersistenceCourse.id, wave8PersistenceStudent.id, "2025-H1", 0
          );
          const wave8ReadsZeroBeforePersistence = DomainModel.getTermResult(
            wave8PersistenceCourse, wave8PersistenceStudent.id, "2025-H1"
          ) === 0;
          const wave8SetBackup = await Storage.exportStateEncrypted(testPassword, wave8PersistenceState);
          const wave8ReloadedSetState = DomainModel.ensureStateShape(
            await Storage.importStateEncryptedFromText(wave8SetBackup, testPassword)
          );
          const wave8ReloadedSetCourse = DomainModel.findCourseById(
            wave8ReloadedSetState, wave8PersistenceCourse.id
          );
          const wave8ReadsZeroAfterReload = DomainModel.getTermResult(
            wave8ReloadedSetCourse, wave8PersistenceStudent.id, "2025-H1"
          ) === 0;
          DomainModel.setTermResult(
            wave8ReloadedSetState, wave8ReloadedSetCourse.id, wave8PersistenceStudent.id, "2025-H1", null
          );
          const wave8ClearedBackup = await Storage.exportStateEncrypted(testPassword, wave8ReloadedSetState);
          const wave8ReloadedClearedState = DomainModel.ensureStateShape(
            await Storage.importStateEncryptedFromText(wave8ClearedBackup, testPassword)
          );
          const wave8ReloadedClearedCourse = DomainModel.findCourseById(
            wave8ReloadedClearedState, wave8PersistenceCourse.id
          );
          record(
            "Wave 8 M32: 0 und bewusstes Leeren überstehen jeweils einen verschlüsselten Rundlauf",
            wave8ReadsZeroBeforePersistence && wave8ReadsZeroAfterReload &&
              DomainModel.getTermResult(wave8ReloadedClearedCourse, wave8PersistenceStudent.id, "2025-H1") === null
          );

          // Wave 11 / M31: Alle Daten dieses Blocks bleiben lokal in diesem
          // Testlauf. Es wird weder der aktive Zustand noch localStorage verändert.
          const wave11State = DomainModel.createEmptyState();
          const wave11WrittenCategory = wave11State.settings.categories.find(category => category.name === "Schriftlich");
          const wave11GeneralCategory = wave11State.settings.categories.find(category => category.name === "Mündlich") || wave11State.settings.categories[0];
          const wave11StudentWritten = DomainModel.createStudent({ id: "stu_wave11_written", lastName: "Regression", firstName: "Klausur" });
          const wave11StudentGeneral = DomainModel.createStudent({ id: "stu_wave11_general", lastName: "Regression", firstName: "Allgemein" });
          wave11State.students.push(wave11StudentWritten, wave11StudentGeneral);

          const wave11LegacyCourse = DomainModel.createCourse({
            id: "course_wave11_legacy", name: "Wave-11-Altkurs", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC
          });
          delete wave11LegacyCourse.upperSecContext;
          wave11LegacyCourse.enrollments = [{ studentId: wave11StudentWritten.id, subgroup: null, homeClassAtEnrollment: null }];
          const wave11MigratedLegacy = DomainModel.ensureStateShape({
            ...wave11State, courses: [wave11LegacyCourse]
          });
          record(
            "Wave 11 M31: alter Sek-II-Kurs bleibt ohne geratenen Kontext migrierbar",
            wave11MigratedLegacy.courses[0].upperSecContext === null &&
              wave11MigratedLegacy.courses[0].enrollments[0].writtenExamSubjectQ4 === false
          );

          const wave11GkCourse = DomainModel.createCourse({
            id: "course_wave11_gk", name: "Wave-11-GK", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            weightTemplateId: DomainModel.RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
            upperSecContext: { courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4, weightingDeviationReason: "Synthetische Abweichungsnotiz" }
          });
          wave11State.courses.push(wave11GkCourse);
          DomainModel.enrollStudentInCourse(wave11State, wave11GkCourse.id, wave11StudentWritten.id);
          DomainModel.enrollStudentInCourse(wave11State, wave11GkCourse.id, wave11StudentGeneral.id);
          DomainModel.setWrittenExamSubjectQ4(wave11State, wave11GkCourse.id, wave11StudentWritten.id, true);
          const wave11Q3Context = GradingLogic.resolveUpperSecGradingContext(wave11GkCourse, wave11StudentGeneral.id, "2025-H1", wave11State.settings);
          const wave11Q4WrittenContext = GradingLogic.resolveUpperSecGradingContext(wave11GkCourse, wave11StudentWritten.id, "2025-H2", wave11State.settings);
          const wave11Q4GeneralContext = GradingLogic.resolveUpperSecGradingContext(wave11GkCourse, wave11StudentGeneral.id, "2025-H2", wave11State.settings);
          record(
            "Wave 11 M31: GK Q3 und gemischtes Q4 lösen Klausurpflicht personenspezifisch auf",
            wave11Q3Context.qualificationPhase === "Q3" && wave11Q3Context.expectedExamCount === 1 &&
              wave11Q4WrittenContext.qualificationPhase === "Q4" && wave11Q4WrittenContext.expectedExamCount === 1 &&
              wave11Q4GeneralContext.status === "general-only" && wave11Q4GeneralContext.expectedExamCount === 0
          );
          const wave11Q4WrittenAssessment = DomainModel.createAssessment({
            id: "asm_wave11_q4_written", courseId: wave11GkCourse.id, categoryId: wave11WrittenCategory.id,
            title: "Q4-Klausur", term: "2025-H2"
          });
          wave11Q4WrittenAssessment.scores[wave11StudentWritten.id] = DomainModel.createScoreEntry({ valueRaw: "13" });
          wave11Q4WrittenAssessment.scores[wave11StudentGeneral.id] = DomainModel.createScoreEntry({ valueRaw: "4" });
          const wave11Q4GeneralAssessment = DomainModel.createAssessment({
            id: "asm_wave11_q4_general", courseId: wave11GkCourse.id, categoryId: wave11GeneralCategory.id,
            title: "Q4-allgemeiner Teil", term: "2025-H2"
          });
          wave11Q4GeneralAssessment.scores[wave11StudentWritten.id] = DomainModel.createScoreEntry({ valueRaw: "10" });
          wave11Q4GeneralAssessment.scores[wave11StudentGeneral.id] = DomainModel.createScoreEntry({ valueRaw: "11" });
          wave11State.assessments.push(wave11Q4WrittenAssessment, wave11Q4GeneralAssessment);
          const wave11GeneralOnlyValue = GradingLogic.computeWeightedOverallForAssessments(
            [wave11Q4WrittenAssessment, wave11Q4GeneralAssessment], wave11GkCourse, wave11StudentGeneral.id, wave11State.settings, "2025-H2"
          );
          record(
            "Wave 11 M31: nicht vorgesehene Q4-Klausurzelle ist gesperrt und bleibt ungewertet",
            isAssessmentNotScheduledForStudent(wave11GkCourse, wave11Q4WrittenAssessment, wave11StudentGeneral.id, wave11State.settings) &&
              !isAssessmentNotScheduledForStudent(wave11GkCourse, wave11Q4WrittenAssessment, wave11StudentWritten.id, wave11State.settings) &&
              wave11GeneralOnlyValue === 11
          );
          const wave11CheckboxBackup = await Storage.exportStateEncrypted(testPassword, wave11State);
          const wave11CheckboxReloaded = DomainModel.ensureStateShape(
            await Storage.importStateEncryptedFromText(wave11CheckboxBackup, testPassword)
          );
          const wave11ReloadedGk = DomainModel.findCourseById(wave11CheckboxReloaded, wave11GkCourse.id);
          record(
            "Wave 11 M31: Kontext, Begründung und Q4-Checkbox überstehen den verschlüsselten Rundlauf",
            wave11ReloadedGk.upperSecContext.weightingDeviationReason === "Synthetische Abweichungsnotiz" &&
              DomainModel.findEnrollment(wave11ReloadedGk, wave11StudentWritten.id).writtenExamSubjectQ4 === true &&
              DomainModel.findEnrollment(wave11ReloadedGk, wave11StudentGeneral.id).writtenExamSubjectQ4 === false
          );

          const wave11LkQ12 = DomainModel.createCourse({
            id: "course_wave11_lk_q12", name: "Wave-11-LK-Q12", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            upperSecContext: { courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED, qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2 }
          });
          const wave11LkQ34 = DomainModel.createCourse({
            id: "course_wave11_lk_q34", name: "Wave-11-LK-Q34", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            upperSecContext: { courseType: DomainModel.UPPERSEC_COURSE_TYPES.ADVANCED, qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4 }
          });
          const wave11LkContexts = [
            GradingLogic.resolveUpperSecGradingContext(wave11LkQ12, wave11StudentWritten.id, "2025-H1", wave11State.settings),
            GradingLogic.resolveUpperSecGradingContext(wave11LkQ12, wave11StudentWritten.id, "2025-H2", wave11State.settings),
            GradingLogic.resolveUpperSecGradingContext(wave11LkQ34, wave11StudentWritten.id, "2025-H1", wave11State.settings),
            GradingLogic.resolveUpperSecGradingContext(wave11LkQ34, wave11StudentWritten.id, "2025-H2", wave11State.settings)
          ];
          record(
            "Wave 11 M31: LK Q1 bis Q4 verwendet die zentrale Klausurmatrix",
            wave11LkContexts.map(context => context.qualificationPhase).join(",") === "Q1,Q2,Q3,Q4" &&
              wave11LkContexts.map(context => context.expectedExamCount).join(",") === "2,2,2,1"
          );
          const wave11SekICourse = DomainModel.createCourse({ id: "course_wave11_seki", name: "Wave-11-Sek-I" });
          record(
            "Wave 11 M31: Sek-II-Termine bleiben getrennt, Sek-I-H2 wertet das Schuljahr gemeinsam",
            GradingLogic.resolveAssessmentTermsForResult(wave11GkCourse, "2025-H2").join(",") === "2025-H2" &&
              GradingLogic.resolveAssessmentTermsForResult(wave11SekICourse, "2025-H2").sort().join(",") === "2025-H1,2025-H2"
          );
          const wave11Q12Plan = DomainModel.planCourseSuccessor(wave11LkQ12, 2026);
          const wave11Q34Plan = DomainModel.planCourseSuccessor(wave11LkQ34, 2026);
          const wave11PromotionCourse = DomainModel.createCourse({
            id: "course_wave11_promotion", name: "Wave-11-Fortführung", schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
            upperSecContext: { courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC, qualificationYear: DomainModel.QUALIFICATION_YEARS.Q1_Q2 }
          });
          wave11PromotionCourse.enrollments = [
            DomainModel.createEnrollment({ studentId: wave11StudentWritten.id, writtenExamSubjectQ4: true })
          ];
          const wave11Successor = DomainModel.createSuccessorCourseCandidate(wave11PromotionCourse, 2026);
          record(
            "Wave 11 M31: Schuljahreswechsel führt Q1/Q2 fort und beendet Q3/Q4",
            wave11Q12Plan.action === "continue" && wave11Q12Plan.targetQualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4 &&
              wave11Q34Plan.action === "end" && wave11Successor.upperSecContext.qualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4 &&
              wave11Successor.enrollments.every(enrollment => enrollment.writtenExamSubjectQ4 === false)
          );
          DomainModel.archiveCourse(wave11State, wave11GkCourse.id, "manual", {});
          const wave11ArchivePresentation = buildUpperSecContextPresentation(wave11GkCourse, wave11StudentGeneral.id, "2025-H2", wave11State);
          record(
            "Wave 11 M31: Archiv-Snapshot bewahrt Kontext und Q4-allgemeinen Teil",
            wave11GkCourse.archiveSnapshot.upperSecContext.qualificationYear === DomainModel.QUALIFICATION_YEARS.Q3_Q4 &&
              wave11ArchivePresentation.qualificationPhase === "Q4" && wave11ArchivePresentation.examRequirementLabel === "nur allgemeiner Teil"
          );

          return {
            passed: cases.filter(testCase => testCase.passed).length,
            failed: cases.filter(testCase => !testCase.passed).length,
            cases,
            metrics,
            notPracticallyTested: ["Legacy-Raw-Backup iv:ciphertext mit bereits vorhandenem lokalem Salt"]
          };
        }

        try {
          const syntheticTestMode = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get("syntheticRegression") === "1";
          if (syntheticTestMode) {
            const testPanel = document.createElement("section");
            testPanel.id = "synthetic-regression-panel";
            testPanel.style.cssText = "position:fixed;right:.75rem;bottom:.75rem;z-index:100600;width:min(520px,calc(100vw - 1.5rem));max-height:70vh;overflow:auto;padding:.75rem;background:#fff;color:#111;border:2px solid #334155;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.3)";
            const testTitle = document.createElement("strong");
            testTitle.textContent = "Synthetische Belastungs- und Sicherheitstests";
            const testButton = document.createElement("button");
            testButton.type = "button";
            testButton.textContent = "Tests ausführen";
            testButton.style.marginLeft = ".75rem";
            const testOutput = document.createElement("pre");
            testOutput.id = "synthetic-regression-output";
            testOutput.style.cssText = "white-space:pre-wrap;font-size:.75rem;margin:.75rem 0 0";
            testButton.addEventListener("click", async () => {
              testButton.disabled = true;
              testOutput.textContent = "Tests laufen …";
              try {
                testOutput.textContent = JSON.stringify(await runLoadSecurityRegressionTests(), null, 2);
              } catch (error) {
                testOutput.textContent = JSON.stringify({ passed: 0, failed: 1, error: String(error && error.message ? error.message : error) }, null, 2);
              } finally {
                testButton.disabled = false;
              }
            });
            testPanel.appendChild(testTitle);
            testPanel.appendChild(testButton);
            testPanel.appendChild(testOutput);
            document.body.appendChild(testPanel);
          }
        } catch (e) { /* synthetischer Testmodus ist optional */ }

        try {
          if (localStorage.getItem('__debugMode') === '1') {
            window.__notenverwaltung = {
              getState: function () {
                try {
                  const redacted = JSON.parse(JSON.stringify(state));
                  if (Array.isArray(redacted.students)) {
                    redacted.students.forEach(s => { if (s && s.birthDate) delete s.birthDate; });
                  }
                  return redacted;
                } catch (err) {
                  return null;
                }
              },
              setSection: setSection,
              setCurrentCourse: setCurrentCourse,
              runLoadSecurityRegressionTests
            };
          }
        } catch(e) { /* localStorage ggf. nicht verfügbar */ }

        // Global Auto-run hook: läuft unmittelbar nach Initialisierung und Render
        // SICHERHEIT: Nur aktivieren wenn Debug-Modus explizit in localStorage gesetzt wurde
        try {
          if (typeof window !== 'undefined' && window.location && window.location.search && localStorage.getItem('__debugMode') === '1') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('runPrevTest') === '1') {
              console.log('Auto-running PrevTerm integration test (global hook)');
              setTimeout(function () { try { if (typeof window.runPrevTermIntegrationTest === 'function') window.runPrevTermIntegrationTest(); else console.warn('runPrevTermIntegrationTest not available yet'); } catch (e) { console.error('Auto-test failed', e); alert('Auto-test failed: ' + (e && e.message)); } }, 250);
            }
            if (params.get('createPersistTest') === '1') {
              console.log('Auto-creating persistent Oberstufen test course (global hook)');
              setTimeout(function () { try { if (typeof window.runCreatePersistentUpperSecTestCourse === 'function') window.runCreatePersistentUpperSecTestCourse(); else console.warn('runCreatePersistentUpperSecTestCourse not available yet'); } catch (e) { console.error('Auto-create failed', e); alert('Auto-create failed: ' + (e && e.message)); } }, 350);
            }
            if (params.get('fixPersistTest') === '1') {
              console.log('Auto-fixing persistent test course (global hook)');
              setTimeout(function () {
                try {
                  const NAME = 'Oberstufe Test (persistent)';
                  const existing = (state.courses || []).find(c => c.name === NAME);
                  if (existing) {
                    existing.includePrevTermGrades = false;
                    currentCourseId = existing.id;
                    persistDiagnosticState();
                    try { render(); } catch (e) {}
                  }
                } catch (e) { console.error('Auto-fix failed', e); }
              }, 450);
            }
          }
        } catch (e) { /* ignore in non-browser env */ }

      }

      return {
        init
      };
    })();


    function renderStartupFailure(rootElementId, safeMessage) {
      let root = document.getElementById(rootElementId);
      if (!root) {
        try {
          if (!document.body) return;
          root = document.createElement('div');
          root.id = rootElementId;
          root.className = 'app-root';
          document.body.appendChild(root);
        } catch (err) {
          return;
        }
      }
      try {
        const panel = document.createElement('section');
        panel.className = 'section info-box';
        panel.style.maxWidth = '36rem';
        panel.style.margin = '2rem auto';

        const title = document.createElement('h2');
        title.textContent = 'Anwendung konnte nicht gestartet werden';
        panel.appendChild(title);

        const message = document.createElement('p');
        message.textContent = safeMessage || 'Die Anwendung konnte lokal nicht vollständig geladen werden. Bitte versuche den Start erneut.';
        panel.appendChild(message);

        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.textContent = 'Erneut versuchen';
        retryButton.addEventListener('click', function () {
          retryButton.disabled = true;
          retryButton.textContent = 'Start wird erneut versucht …';
          return startApplication(rootElementId);
        });
        panel.appendChild(retryButton);
        while (root.firstChild) root.removeChild(root.firstChild);
        root.appendChild(panel);
      } catch (err) {
        root.textContent = 'Die Anwendung konnte lokal nicht vollständig geladen werden. Bitte lade die Seite neu.';
      }
    }

    async function startApplication(rootElementId) {
      try {
        document.title = "Notenverwaltung · Version " + APP_RELEASE.version;
        await UiShell.init(rootElementId);
      } catch (err) {
        console.error('[Start] Anwendung konnte nicht initialisiert werden.');
        const invalidStateMessage = 'Die gespeicherten Daten konnten nicht gelesen werden. Die gespeicherten Originaldaten wurden nicht verändert.';
        let safeMessage = 'Die Anwendung konnte lokal nicht vollständig geladen werden. Bitte versuche den Start erneut.';
        if (err && err.code === 'STATE_CONTENT_INVALID') {
          safeMessage = invalidStateMessage;
          const archiveMessagePrefix = 'Die gespeicherten Daten konnten nicht gelesen werden. Die Originaldaten wurden nicht verändert. Der Archiv-Snapshot für Kurs ';
          const archiveMessageSuffix = 'Bitte verwenden Sie ein intaktes Backup oder bewahren Sie den Originalbestand für eine Reparatur auf.';
          if (typeof err.message === 'string' && err.message.startsWith(archiveMessagePrefix) &&
              err.message.endsWith(archiveMessageSuffix)) {
            safeMessage = err.message;
          }
        }
        renderStartupFailure(rootElementId, safeMessage);
      }
    }

    document.addEventListener("DOMContentLoaded", async function () {
      await startApplication("app");
    });

    // Globaler Fallback-Poll: Falls Autorun-Parameter gesetzt sind, aber Tests/Funktionen noch nicht verfügbar,
    // kurz pollen und starten, sobald sie auftauchen. Aktualisiert den Debug-Status währenddessen.
    // SICHERHEIT: Nur aktivieren wenn Debug-Modus explizit in localStorage gesetzt wurde
    (function(){
      try { if (localStorage.getItem('__debugMode') !== '1') return; } catch(e) { return; }
      if (!window.__autorunParams) return;
      const start = Date.now();
      const maxWait = 8000; // ms
      const interval = 200;
      const timer = setInterval(function() {
        try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Polling for test functions'); } catch (e) {}

        if (!window.__autorunParams) { clearInterval(timer); return; }

        if (window.__autorunParams.runPrevTest && typeof window.runPrevTermIntegrationTest === 'function') {
          clearInterval(timer);
          try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting runPrevTermIntegrationTest (poll)'); } catch (e) {}
          try { window.runPrevTermIntegrationTest(); } catch (e) { console.error('Poll-run runPrevTermIntegrationTest failed', e); }
          window.__autorunParams.runPrevTest = false;
        }

        if (window.__autorunParams.createPersistTest && typeof window.runCreatePersistentUpperSecTestCourse === 'function') {
          clearInterval(timer);
          try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting runCreatePersistentUpperSecTestCourse (poll)'); } catch (e) {}
          try { window.runCreatePersistentUpperSecTestCourse(); } catch (e) { console.error('Poll-run runCreatePersistentUpperSecTestCourse failed', e); }
          window.__autorunParams.createPersistTest = false;
        }

        if (Date.now() - start > maxWait) {
          try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Poll timeout'); } catch (e) {}
          clearInterval(timer);
        }
      }, interval);
    })();
