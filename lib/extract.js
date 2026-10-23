import {
  addDays,
  localDay,
  localTime,
  pad,
  parseISO,
  validDay,
} from "./dates.js";
import { sourceLocator } from "./source-locator.js";
import { findDateTokens } from "./text-date-formats.js";

/** @typedef {{id: string, date: string, endDate?: string, start?: string, end?: string, source: 'text'|'structured'|'ai', evidence: string, locator?: import('./source-locator.js').SourceLocator, inferredYear?: boolean, assumedEnd?: boolean}} Candidate */

const TIME_PATTERN =
  /(?<![\d:])(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?|(?=\s*(?:[ap]\.?m\.?|[〜～~–—−-]|to\b)))[ \t]*([ap]\.?m\.?(?![a-z]))?(?:\s*(?:[〜～~–—−-]|から|to\b)\s*(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?|(?=\s*[ap]\.?m\.?))[ \t]*([ap]\.?m\.?(?![a-z]))?)?/gi;

/** @param {string} hour @param {string | undefined} meridiem */
function clockHour(hour, meridiem) {
  const value = +hour;
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
    const times = [...nearby.matchAll(TIME_PATTERN)].filter(
      (time) =>
        time[2] !== undefined ||
        time[0].startsWith(`${time[1]}時`) ||
        time[4] !== undefined ||
        time[8] !== undefined,
    );
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
      // Missing one AM/PM marker in a range is ambiguous; never guess it.
      if (time[5] && Boolean(time[4]) !== Boolean(time[8])) continue;
      if (
        !time[5] &&
        /^\s*(?:[〜～~–—−-]|から|to\b)\s*\d/i.test(
          nearby.slice(time.index + time[0].length),
        )
      )
        continue;
      const startHour = clockHour(time[1], time[4]);
      const endHour = time[5] ? clockHour(time[5], time[8]) : null;
      if (startHour === null || (time[5] && endHour === null)) continue;
      const start = localTime(date, startHour, +(time[2] ?? time[3] ?? 0));
      if (!start) continue;
      let end = time[5]
        ? localTime(
            date,
            /** @type {number} */ (endHour),
            +(time[6] ?? time[7] ?? 0),
          )
        : new Date(Date.parse(start) + 3_600_000).toISOString();
      if (!end) continue;
      if (end === start) continue;
      if (end < start)
        end = localTime(
          addDays(date),
          /** @type {number} */ (endHour),
          +(time[6] ?? time[7] ?? 0),
        );
      if (end)
        events.push(
          identify({
            ...base,
            start,
            end,
            assumedEnd: !time[5],
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

/** Convert validated AI output without trusting invented dates or raw HTML.
 * @param {unknown} data @param {string} pageText @returns {Candidate[]}
 */
export function aiCandidates(data, pageText) {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 30).flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.evidence !== "string" ||
      !item.evidence.trim() ||
      !pageText.includes(item.evidence)
    )
      return [];
    const start = parseISO(item.start);
    const end = parseISO(item.end);
    if (!start) return [];
    if (
      item.end !== undefined &&
      item.end !== null &&
      (!end || Boolean(start.time) !== Boolean(end.time))
    )
      return [];
    if (end && end.date < start.date) return [];
    const base = {
      date: start.date,
      evidence: item.evidence.slice(0, 160),
      source: /** @type {const} */ ("ai"),
      locator: sourceLocator(
        pageText,
        pageText.indexOf(item.evidence),
        pageText.indexOf(item.evidence) + item.evidence.slice(0, 160).length,
      ),
    };
    if (!start.time)
      return [
        identify({
          ...base,
          endDate: end && end.date >= start.date ? end.date : undefined,
        }),
      ];
    const endTime =
      end?.time ?? new Date(Date.parse(start.time) + 3_600_000).toISOString();
    if (
      endTime <= start.time ||
      localDay(new Date(endTime)) > addDays(start.date, 30)
    )
      return [];
    return [
      identify({
        ...base,
        start: start.time,
        end: endTime,
        assumedEnd: !end?.time,
      }),
    ];
  });
}
