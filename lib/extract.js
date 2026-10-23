import {
  addDays,
  localDay,
  localTime,
  pad,
  parseISO,
  validDay,
} from "./dates.js";

/** @typedef {{id: string, date: string, endDate?: string, start?: string, end?: string, source: 'text'|'structured'|'ai', evidence: string, inferredYear?: boolean, assumedEnd?: boolean}} Candidate */

const DATE_PATTERN =
  /(?<![\d:/.-])(?:(\d{4})\s*(?:年|[/.-])\s*)?(\d{1,2})\s*(?:月|[/.-])\s*(\d{1,2})(?:日)?(?![\d:])/g;
const TIME_PATTERN =
  /(?<![\d:])(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?)(?:\s*(?:[〜～~–—−-]|から)\s*(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分?)?))?/g;

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
  const dates = [...normalized.matchAll(DATE_PATTERN)];
  /** @type {Candidate[]} */
  const events = [];
  for (let i = 0; i < dates.length && events.length < 100; i++) {
    const match = dates[i];
    const year = Number(match[1] || now.getFullYear());
    const month = +match[2];
    const day = +match[3];
    if (!validDay(year, month, day)) continue;
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const next = dates[i + 1];
    const afterDate = (match.index ?? 0) + match[0].length;
    const tail = normalized
      .slice(afterDate, next?.index ?? normalized.length)
      .slice(0, 180);
    const base = {
      date,
      source: /** @type {const} */ ("text"),
      inferredYear: !match[1],
      evidence: `${match[0]}${tail}`.trim().slice(0, 160),
    };
    // A date-to-date range is one all-day candidate, with an inclusive last day.
    if (next && /^\s*(?:[〜～~–—−-]|から)\s*$/.test(tail)) {
      const endYear = Number(next[1] || year + (+next[2] < month ? 1 : 0));
      if (validDay(endYear, +next[2], +next[3])) {
        const endDate = `${endYear}-${pad(+next[2])}-${pad(+next[3])}`;
        if (endDate >= date) {
          events.push(
            identify({
              ...base,
              endDate,
              evidence: `${match[0]}${tail}${next[0]}`,
            }),
          );
          i++;
          continue;
        }
      }
    }
    // Only read nearby lines; a time in unrelated prose should not be attached.
    const nearby = tail.split("\n").slice(0, 3).join("\n");
    const times = [...nearby.matchAll(TIME_PATTERN)];
    if (times.length === 0) {
      events.push(identify(base));
      continue;
    }
    for (const time of times) {
      const start = localTime(date, +time[1], +(time[2] ?? time[3] ?? 0));
      if (!start) continue;
      let end = time[4]
        ? localTime(date, +time[4], +(time[5] ?? time[6] ?? 0))
        : new Date(Date.parse(start) + 3_600_000).toISOString();
      if (!end) continue;
      if (end === start) continue;
      if (end < start)
        end = localTime(addDays(date), +time[4], +(time[5] ?? time[6] ?? 0));
      if (end)
        events.push(identify({ ...base, start, end, assumedEnd: !time[4] }));
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
    if (!unique.has(event.id)) unique.set(event.id, event);
    if (unique.size >= 100) break;
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
