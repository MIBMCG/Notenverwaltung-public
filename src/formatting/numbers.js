function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function checkedDigits(digits) {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) {
    throw new RangeError('digits muss eine ganze Zahl von 0 bis 100 sein');
  }
  return digits;
}

export function formatNumber(value, {
  locale = 'de-DE', minimumFractionDigits = 0, maximumFractionDigits = 3
} = {}) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(number);
}

export function formatLegacyFixed(value, digits) {
  const number = finiteNumber(value);
  return number === null ? null : number.toFixed(checkedDigits(digits));
}

export function formatLegacyPercent(value, { digits = 1, spaceBeforeSymbol = true } = {}) {
  const fixed = formatLegacyFixed(value, digits);
  return fixed === null ? null : fixed + (spaceBeforeSymbol ? ' %' : '%');
}

export function formatDecimalComma(value, { digits = 2, trimTrailingZeros = false } = {}) {
  const number = finiteNumber(value);
  if (number === null) return null;
  checkedDigits(digits);
  const text = trimTrailingZeros
    ? (() => {
      const factor = 10 ** digits;
      const scaled = number * factor;
      return String(Number.isFinite(scaled) ? Math.round(scaled) / factor : number);
    })()
    : number.toFixed(digits);
  return text.replace('.', ',');
}

export function parseDecimalInput(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
