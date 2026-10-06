const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/i;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function hasValidInstantComponents(value) {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = Number(match[6] ?? 0);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}

function normalizeCalendarDate(value) {
  if (!value || typeof value !== 'object') return null;
  const { year, month, day } = value;
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

export function parseCalendarDate(value) {
  const match = CALENDAR_DATE_PATTERN.exec(String(value ?? '').trim());
  return match ? normalizeCalendarDate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }) : null;
}

export function calendarDateToLocalDate(value) {
  const normalized = normalizeCalendarDate(value);
  return normalized ? new Date(normalized.year, normalized.month - 1, normalized.day) : null;
}

export function formatCalendarDate(value, { locale = 'de-DE' } = {}) {
  const parsed = typeof value === 'string' ? parseCalendarDate(value) : normalizeCalendarDate(value);
  const date = parsed && calendarDateToLocalDate(parsed);
  return date ? date.toLocaleDateString(locale) : null;
}

export function parseInstant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value !== 'string' || !hasValidInstantComponents(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatInstant(value, { locale = 'de-DE', timeZone, includeTime = false } = {}) {
  if (!timeZone) throw new TypeError('timeZone ist erforderlich');
  const date = parseInstant(value);
  if (!date) return null;
  return includeTime
    ? date.toLocaleString(locale, { timeZone })
    : date.toLocaleDateString(locale, { timeZone });
}

export function formatUtcDateStamp(value) {
  const date = parseInstant(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

export function formatUtcFileTimestamp(value) {
  const date = parseInstant(value);
  return date ? date.toISOString().slice(0, 19).replace(/:/g, '-') : null;
}
