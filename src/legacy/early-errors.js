    (function() {
      // Erfasst die erste auftretende Exception / Promise-Rejection und speichert sie in window.__firstError
      window.__firstError = null;
      window.addEventListener('error', function (ev) {
        if (!window.__firstError) {
          window.__firstError = {
            message: ev.message || (ev.error && ev.error.message) || 'unknown error',
            filename: ev.filename || null,
            lineno: ev.lineno || null,
            colno: ev.colno || null,
            error: ev.error && ev.error.stack ? ev.error.stack : (ev.error ? String(ev.error) : null),
            time: new Date().toISOString()
          };
        }
        // Log bleibt in der Konsole sichtbar
        console.error('[Captured error]', ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
      }, true);

      window.addEventListener('unhandledrejection', function (ev) {
        if (!window.__firstError) {
          window.__firstError = {
            message: 'UnhandledRejection: ' + (ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason)),
            error: ev.reason && ev.reason.stack ? ev.reason.stack : (ev.reason ? String(ev.reason) : null),
            time: new Date().toISOString()
          };
        }
        console.error('[Captured rejection]', ev.reason);
      }, true);

      // Debug-Panel deaktiviert: Hooks bleiben, UI wird nicht gerendert
      // SICHERHEIT: Gesamte Debug-Infrastruktur nur im Debug-Modus aktivieren
      window.__showDebugPanel = function () {
        try { if (localStorage.getItem('__debugMode') !== '1') return; } catch(e) { return; }

        // Frühzeitiger Hook: Wenn Test-Funktionen später ans Window gebunden werden,
        // erkennt dieser Setter das und führt (falls autorun gewünscht) sofort die Tests aus.
        (function() {
          const watchNames = ['runPrevTermIntegrationTest','runCreatePersistentUpperSecTestCourse','runUpperSecPrevTermTest'];
          for (const name of watchNames) {
            if (Object.prototype.hasOwnProperty.call(window, name)) continue; // already defined
            try {
              Object.defineProperty(window, name, {
                configurable: true,
                enumerable: true,
                set: function (val) {
                  // Ersetze den Setter mit einer normalen Property, damit spätere Zuweisungen normal sind
                  Object.defineProperty(window, name, {
                    configurable: true,
                    writable: true,
                    enumerable: true,
                    value: val
                  });
                  try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus(name + ' attached'); } catch (e) {}
                  // Wenn Autorun-Parameter gesetzt sind, führe die jeweilige Funktion aus
                  try {
                    if (window.__autorunParams) {
                      if (name === 'runPrevTermIntegrationTest' && window.__autorunParams.runPrevTest) {
                        try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting deferred ' + name); } catch (e) {}
                        try { val(); } catch (e) { console.error('Deferred ' + name + ' failed', e); }
                        window.__autorunParams.runPrevTest = false;
                      }
                      if (name === 'runCreatePersistentUpperSecTestCourse' && window.__autorunParams.createPersistTest) {
                        try { if (typeof window.__setAutorunStatus === 'function') window.__setAutorunStatus('Starting deferred ' + name); } catch (e) {}
                        try { val(); } catch (e) { console.error('Deferred ' + name + ' failed', e); }
                        window.__autorunParams.createPersistTest = false;
                      }
                    }
                  } catch (e) { console.error('Deferred autorun handler failed', e); }
                },
                get: function() { return undefined; }
              });
            } catch (e) { /* ignore if defineProperty fails */ }
          }
        })();

        // Status-Setter bereitstellen, ohne die UI zu rendern
        window.__setAutorunStatus = function (text) {
          try { window.__autorunStatusText = String(text || ''); } catch (e) { /* ignore */ }
        };
        // Kein sichtbares Panel, nur Hooks für Autorun/Fehlererfassung.
      };

      // Automatisch Panel anzeigen sobald DOM verfügbar
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.__showDebugPanel);
      } else {
        setTimeout(window.__showDebugPanel, 20);
      }
    })();
