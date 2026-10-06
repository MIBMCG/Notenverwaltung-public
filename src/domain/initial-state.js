import { createEmptyState } from './state.js';

export function createInitialState(referenceDate) {
  if (!referenceDate || typeof referenceDate.getTime !== 'function' ||
      typeof referenceDate.getFullYear !== 'function' ||
      typeof referenceDate.getMonth !== 'function' ||
      !Number.isFinite(referenceDate.getTime())) {
    throw new TypeError('Ein gültiges Bezugsdatum ist erforderlich.');
  }
  const year = referenceDate.getFullYear() - (referenceDate.getMonth() < 7 ? 1 : 0);
  const halfYear = {
    schoolYearStartYear: year, schoolYearStartMonth: 8, schoolYearStartDay: 1,
    h1EndYear: year + 1, h1EndMonth: 1, h1EndDay: 31,
    h2StartYear: year + 1, h2StartMonth: 2, h2StartDay: 1
  };
  const state = createEmptyState();
  state.settings.halfYearSettings = { seckI: { ...halfYear }, seckII: { ...halfYear } };
  state.settings.termCutoffs = {
    schoolYearStartMonth: 8, h1EndMonth: 1, h1EndDay: 31, h2StartMonth: 2, h2StartDay: 1
  };
  return state;
}
