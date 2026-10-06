export const STATE_COMMIT_ABORTED = 'STATE_COMMIT_ABORTED';

export class StateCommitAbortedError extends Error {
  constructor() {
    super('Die Zustandsänderung wurde verworfen, weil sich der aktive Bestand geändert hat.');
    this.name = 'StateCommitAbortedError';
    this.code = STATE_COMMIT_ABORTED;
  }
}

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} muss eine Funktion sein.`);
  }
  return value;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function isThenable(value) {
  return !!value && (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function';
}

export function createStateCommitter({
  readState,
  persistState,
  publishState,
  enqueue,
  readEpoch
}) {
  const readCurrentState = requireFunction(readState, 'readState');
  const persistCandidate = requireFunction(persistState, 'persistState');
  const publishCandidate = requireFunction(publishState, 'publishState');
  const enqueueTransaction = requireFunction(enqueue, 'enqueue');
  const readCurrentEpoch = requireFunction(readEpoch, 'readEpoch');

  return {
    commit(change) {
      if (typeof change !== 'function') {
        return Promise.reject(new TypeError('change muss eine Funktion sein.'));
      }
      const invocationEpoch = readCurrentEpoch();
      return enqueueTransaction(async () => {
        if (readCurrentEpoch() !== invocationEpoch) {
          throw new StateCommitAbortedError();
        }

        const candidate = cloneState(readCurrentState());
        const changeResult = change(candidate);
        if (isThenable(changeResult)) {
          Promise.resolve(changeResult).catch(() => {});
          throw new TypeError('change muss synchron ausgeführt werden.');
        }

        await persistCandidate(candidate);
        if (readCurrentEpoch() !== invocationEpoch) {
          throw new StateCommitAbortedError();
        }

        publishCandidate(candidate);
        return candidate;
      });
    }
  };
}
