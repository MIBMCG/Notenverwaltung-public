export function createDashboardTransition({ isAllowed, onReady, onFailure }) {
  const editors = new Set();
  let generation = 0;
  let runningRequest = null;

  function isCurrent(requestGeneration) {
    return requestGeneration === generation && isAllowed();
  }

  function register(editor) {
    editors.add(editor);
    return function unregister() {
      editors.delete(editor);
    };
  }

  function listEditors() {
    return Array.from(editors);
  }

  function invalidate() {
    generation += 1;
    runningRequest = null;
  }

  async function finishEditors(requestGeneration) {
      if (!isCurrent(requestGeneration)) return false;

      while (isCurrent(requestGeneration)) {
        for (const editor of listEditors()) {
          if (!isCurrent(requestGeneration)) return false;
          try {
            const finished = await editor.finish();
            if (!isCurrent(requestGeneration)) return false;
            if (finished === false) {
              editor.focus();
              return false;
            }
          } catch (error) {
            if (isCurrent(requestGeneration)) {
              onFailure(error, editor);
              editor.focus();
            }
            return false;
          }
        }

        if (!isCurrent(requestGeneration)) return false;
        try {
          const unfinishedEditor = listEditors().find(function (editor) {
            return typeof editor.isClean === 'function' && !editor.isClean();
          });
          if (unfinishedEditor) continue;
        } catch (error) {
          if (isCurrent(requestGeneration)) {
            onFailure(error);
          }
          return false;
        }

        if (!isCurrent(requestGeneration)) return false;
        return true;
      }

      return false;
  }

  function finishActiveEditors() {
    return finishEditors(generation);
  }

  function request() {
    if (runningRequest) return runningRequest;

    const requestGeneration = generation;
    const currentRequest = (async function () {
      if (!await finishEditors(requestGeneration)) return false;
      if (!isCurrent(requestGeneration)) return false;
      onReady();
      return true;
    })();

    runningRequest = currentRequest;
    currentRequest.then(
      () => { if (runningRequest === currentRequest) runningRequest = null; },
      () => { if (runningRequest === currentRequest) runningRequest = null; }
    );
    return currentRequest;
  }

  return { register, listEditors, finishActiveEditors, request, invalidate };
}
