/** @param {number} n */
export const pad = (n) => String(n).padStart(2, "0");

/** @param {Date} date */
export function localDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {number} year @param {number} month @param {number} day */
export function validDay(year, month, day) {
  const date = new Date(year, month - 1, day, 12);
  return (
    year >= 1900 &&
    year <= 2199 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** @param {string} day @param {number} [amount] */
export function addDays(day, amount = 1) {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + amount, 12));
}

/** @param {string} day @param {number} hour @param {number} minute */
export function localTime(day, hour, minute) {
  const [y, m, d] = day.split("-").map(Number);
  if (hour > 23 || minute > 59) return null;
  const result = new Date(y, m - 1, d, hour, minute);
  // Reject local times skipped by a daylight-saving transition.
  if (result.getHours() !== hour || result.getMinutes() !== minute) return null;
  return result.toISOString();
}

/** Strictly validate before letting Date interpret an ISO timestamp.
 * @param {unknown} value
 */
export function parseISO(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value,
    );
  if (!match || !validDay(+match[1], +match[2], +match[3])) return null;
  if (!match[4]) return { date: value, time: null };
  if (+match[4] > 23 || +match[5] > 59 || +(match[6] ?? 0) > 59) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return { date: localDay(timestamp), time: timestamp.toISOString() };
}

/** @param {string} iso */
export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** @param {string} day */
export function dayLabel(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

/** @param {string} start @param {string | undefined} end */
export function dateRangeLabel(start, end) {
  if (!end || start === end) return dayLabel(start);
  const date = new Date(`${end}T12:00:00`);
  const options = /** @type {Intl.DateTimeFormatOptions} */ ({
    day: "numeric",
    weekday: "short",
  });
  if (start.slice(0, 7) !== end.slice(0, 7)) options.month = "long";
  if (start.slice(0, 4) !== end.slice(0, 4)) options.year = "numeric";
  return `${dayLabel(start)}〜${date.toLocaleDateString("ja-JP", options)}`;
}

/** @param {string} start @param {string} end */
export function timeRange(start, end) {
  const nextDay = localDay(new Date(start)) !== localDay(new Date(end));
  return `${clockTime(start)}–${nextDay ? `${new Date(end).getMonth() + 1}/${new Date(end).getDate()} ` : ""}${clockTime(end)}`;
}
