import {
  addDays,
  localTime,
  pad,
  parseISO,
  validDay,
} from "./dates.js";
import { sourceLocator } from "./source-locator.js";
import { findDateTokens } from "./text-date-formats.js";

/** @typedef {{id: string, date: string, endDate?: string, start?: string, end?: string, source: 'text'|'structured', evidence: string, locator?: import('./source-locator.js').SourceLocator, inferredYear?: boolean, assumedEnd?: boolean}} Candidate */

const TIME_PATTERN =
  /(?<![\d:])(?:(午前|午後)\s*)?(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?|(?=\s*(?:[ap]\.?m\.?|[〜～~–—−-]|to\b)))[ \t]*([ap]\.?m\.?(?![a-z]))?(?:\s*(?:[〜～~–—−-]|から|to\b)\s*(?:(午前|午後)\s*)?(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?|(?=\s*[ap]\.?m\.?))[ \t]*([ap]\.?m\.?(?![a-z]))?)?/gi;

// Detect explicit zones only in the bounded context of this date. Do not treat
// a timezone-free date elsewhere on the page as belonging to the same zone.
const TIME_ZONE_PATTERN =
  /\b(?:UTC|GMT|[ECMPAH][DS]T|JST|KST|CET|CEST|EET|EEST|BST|IST|HKT|SGT|AEST|AEDT|ACST|ACDT|AWST|NZST|NZDT)\b|\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[a-z_+-]+(?:\/[a-z_+-]+)?|日本(?:標準)?時間?|協定世界時|[+]\d{2}:?\d{2}(?!\d)|-\d{4}(?!\d)|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?-\d{2}:\d{2}|\d{2}:\d{2}(?::\d{2})?Z\b/i;

/** @param {string} hour @param {string | undefined} meridiem @param {string | undefined} [japanese] */
function clockHour(hour, meridiem, japanese) {
  const value = +hour;
  if (japanese) {
    if (meridiem || value > 12) return null;
    return (value % 12) + (japanese === "午後" ? 12 : 0);
  }
  if (!meridiem) return value <= 23 ? value : null;
  if (value < 1 || value > 12) return null;
  return (value % 12) + (meridiem.toLowerCase().startsWith("p") ? 12 : 0);
}

/** @param {Omit<Candidate, 'id'>} event @returns {Candidate} */
export function identify(event) {
  return {
    ...event,
    id: `${event.date}/${event.endDate ?? event.date}/${event.start ?? ""}/${event.end ?? ""}`,
  };
}

/** @param {string} text @param {Date} [now] @returns {Candidate[]} */
export function extractTextEvents(text, now = new Date()) {
  const normalized = text.slice(0, 100_000).normalize("NFKC");
  const dates = findDateTokens(normalized);
  /** @type {Candidate[]} */
  const events = [];
  for (let i = 0; i < dates.length && events.length < 100; i++) {
    const match = dates[i];
    const year = match.year ?? now.getFullYear();
    const { month, day } = match;
    if (!match.valid || !validDay(year, month, day)) continue;
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const next = dates[i + 1];
    const afterDate = match.index + match.text.length;
    const tail = normalized
      .slice(afterDate, next?.index ?? normalized.length)
      .slice(0, 180);
    const base = {
      date,
      source: /** @type {const} */ ("text"),
      inferredYear: match.year === undefined,
      evidence: `${match.text}${tail}`.trim().slice(0, 160),
    };
    // A date-to-date range is one all-day candidate, with an inclusive last day.
    if (next?.valid && /^\s*(?:[〜～~–—−-]|から|to)\s*$/i.test(tail)) {
      const endYear = next.year ?? year + (next.month < month ? 1 : 0);
      if (validDay(endYear, next.month, next.day)) {
        const endDate = `${endYear}-${pad(next.month)}-${pad(next.day)}`;
        if (endDate >= date) {
          events.push(
            identify({
              ...base,
              endDate,
              evidence: `${match.text}${tail}${next.text}`,
              locator: sourceLocator(
                normalized,
                match.index,
                next.index + next.text.length,
              ),
            }),
          );
          i++;
          continue;
        }
      }
    }
    // Only read nearby lines; a time in unrelated prose should not be attached.
    const nearby = tail.split("\n").slice(0, 3).join("\n");
    const previousDate = dates[i - 1];
    const before = normalized
      .slice(
        Math.max(
          match.index - 100,
          previousDate ? previousDate.index + previousDate.text.length : 0,
        ),
        match.index,
      )
      .split("\n")
      .at(-1);
    if (TIME_ZONE_PATTERN.test(`${before}${match.text}${nearby}`)) continue;
    const times = [...nearby.matchAll(TIME_PATTERN)].filter(
      (time) =>
        time[3] !== undefined ||
        time[0].includes(`${time[2]}時`) ||
        time[5] !== undefined ||
        time[10] !== undefined,
    );
    // A suffix after a complete range (14:00–16:00 -08:00) is an offset,
    // whereas an ordinary 14:00-16:00 range must remain supported.
    if (
      times.some((time) =>
        /^\s*[+-]\d{2}:?\d{2}(?!\d)/.test(
          nearby.slice(time.index + time[0].length),
        ),
      )
    )
      continue;
    if (times.length === 0) {
      // A bare month/day can be a fraction or other prose, not an event.
      if (match.year !== undefined)
        events.push(
          identify({
            ...base,
            locator: sourceLocator(normalized, match.index, afterDate),
          }),
        );
      continue;
    }
    for (const time of times) {
      const [
        ,
        startPeriod,
        hour,
        minute,
        japaneseMinute,
        startAMPM,
        endPeriod,
        lastHour,
        lastMinute,
        lastJapaneseMinute,
        endAMPM,
      ] = time;
      // Missing one AM/PM marker in a range is ambiguous; never guess it.
      if (lastHour && Boolean(startAMPM) !== Boolean(endAMPM)) continue;
      if (lastHour && endPeriod && !startPeriod) continue;
      if (
        !lastHour &&
        /^\s*(?:[〜～~–—−-]|から|to\b)\s*(?:(?:午前|午後)\s*)?\d/i.test(
          nearby.slice(time.index + time[0].length),
        )
      )
        continue;
      const startHour = clockHour(hour, startAMPM, startPeriod);
      const endHour = lastHour
        ? clockHour(lastHour, endAMPM, endPeriod || startPeriod)
        : null;
      if (startHour === null || (lastHour && endHour === null)) continue;
      const start = localTime(
        date,
        startHour,
        +(minute ?? japaneseMinute ?? 0),
      );
      if (!start) continue;
      let end = lastHour
        ? localTime(
            date,
            /** @type {number} */ (endHour),
            +(lastMinute ?? lastJapaneseMinute ?? 0),
          )
        : new Date(Date.parse(start) + 3_600_000).toISOString();
      if (!end) continue;
      if (end === start) continue;
      // Inherit 午前/午後 only within the same increasing half-day range.
      if (lastHour && startPeriod && !endPeriod && end < start) continue;
      if (end < start)
        end = localTime(
          addDays(date),
          /** @type {number} */ (endHour),
          +(lastMinute ?? lastJapaneseMinute ?? 0),
        );
      if (end)
        events.push(
          identify({
            ...base,
            start,
            end,
            assumedEnd: !lastHour,
            locator: sourceLocator(
              normalized,
              match.index,
              afterDate + time.index + time[0].length,
            ),
          }),
        );
    }
  }
  return mergeCandidates(events);
}

/** @param {string[]} jsonTexts @returns {Candidate[]} */
export function extractStructuredEvents(jsonTexts) {
  /** @type {Candidate[]} */
  const events = [];
  let visited = 0;
  /** @param {unknown} value @param {number} depth */
  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > 20 || visited++ > 5000)
      return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const object = /** @type {Record<string, unknown>} */ (value);
    const types = Array.isArray(object["@type"])
      ? object["@type"]
      : [object["@type"]];
    if (
      types.some(
        (type) =>
          typeof type === "string" &&
          /(?:^|[/#])(?:Event|\w+Event)$/.test(type),
      )
    ) {
      const start = parseISO(object.startDate);
      const end = parseISO(object.endDate);
      if (
        start &&
        (object.endDate === undefined ||
          object.endDate === null ||
          (end && Boolean(start.time) === Boolean(end.time)))
      ) {
        const evidence = `${String(object.startDate)}${end ? ` – ${String(object.endDate)}` : ""}`;
        if (start.time) {
          const endTime =
            end?.time ??
            new Date(Date.parse(start.time) + 3_600_000).toISOString();
          if (endTime > start.time)
            events.push(
              identify({
                date: start.date,
                start: start.time,
                end: endTime,
                source: "structured",
                evidence,
                assumedEnd: !end?.time,
              }),
            );
        } else if (!end || end.date >= start.date) {
          events.push(
            identify({
              date: start.date,
              endDate: end?.date,
              source: "structured",
              evidence,
            }),
          );
        }
      }
    }
    Object.values(object).forEach((child) => visit(child, depth + 1));
  }
  for (const text of jsonTexts.slice(0, 50)) {
    if (text.length > 200_000) continue;
    try {
      visit(JSON.parse(text), 0);
    } catch {
      /* Malformed publisher data must not stop other candidates. */
    }
  }
  return mergeCandidates(events);
}

/** @param {...Candidate[]} groups @returns {Candidate[]} */
export function mergeCandidates(...groups) {
  const unique = new Map();
  for (const event of groups.flat()) {
    const existing = unique.get(event.id);
    if (existing && !existing.locator && event.locator)
      unique.set(event.id, { ...existing, locator: event.locator });
    else if (!existing && unique.size < 100) unique.set(event.id, event);
  }
  return [...unique.values()];
}
