export function createPersistenceBoundary({ listEditors, isCurrent, drain, readState, setBusy }) {
  let epoch = 0;
  let activeCapture = null;

  function current(captureEpoch) {
    return epoch === captureEpoch && isCurrent();
  }

  function invalidate() {
    epoch += 1;
    if (activeCapture !== null) {
      activeCapture = null;
      setBusy(false);
    }
  }

  function capture() {
    if (activeCapture !== null || !isCurrent()) {
      return Promise.resolve({ ok: false, reason: 'stale' });
    }

    const captureEpoch = epoch;
    activeCapture = captureEpoch;
    try {
      setBusy(true);
    } catch (error) {
      activeCapture = null;
      return Promise.resolve({ ok: false, reason: 'save-failed' });
    }

    return (async function () {
      let editorToFocus = null;
      try {
        while (current(captureEpoch)) {
          for (const editor of listEditors()) {
            if (!current(captureEpoch)) return { ok: false, reason: 'stale' };
            try {
              if (await editor.finish() === false) {
                if (current(captureEpoch)) editorToFocus = editor;
                return { ok: false, reason: 'invalid' };
              }
            } catch (error) {
              if (current(captureEpoch)) editorToFocus = editor;
              return { ok: false, reason: current(captureEpoch) ? 'save-failed' : 'stale' };
            }
          }

          if (!current(captureEpoch)) return { ok: false, reason: 'stale' };
          let unfinished;
          try {
            unfinished = listEditors().find(editor => typeof editor.isClean === 'function' && !editor.isClean());
          } catch (error) {
            return { ok: false, reason: 'save-failed' };
          }
          if (!unfinished) break;
        }

        if (!current(captureEpoch)) return { ok: false, reason: 'stale' };
        try {
          await drain();
        } catch (error) {
          return { ok: false, reason: current(captureEpoch) ? 'save-failed' : 'stale' };
        }
        if (!current(captureEpoch)) return { ok: false, reason: 'stale' };

        const unfinished = listEditors().find(editor => typeof editor.isClean === 'function' && !editor.isClean());
        if (unfinished) {
          editorToFocus = unfinished;
          return { ok: false, reason: 'invalid' };
        }
        const snapshot = JSON.parse(JSON.stringify(readState()));
        if (!current(captureEpoch)) return { ok: false, reason: 'stale' };
        return { ok: true, snapshot };
      } catch (error) {
        return { ok: false, reason: current(captureEpoch) ? 'save-failed' : 'stale' };
      } finally {
        if (activeCapture === captureEpoch) {
          activeCapture = null;
          setBusy(false);
          if (editorToFocus && current(captureEpoch)) {
            try { editorToFocus.focus(); } catch (error) { /* preserve capture failure */ }
          }
        }
      }
    })();
  }

  return { capture, invalidate };
}
