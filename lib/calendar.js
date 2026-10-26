import { addDays, dayLabel, localDay, timeRange } from "./dates.js";
import { DEFAULT_TITLE_FORMAT, formatTitle } from "./title-format.js";

/** @typedef {{kind: 'exact'|'travel'|'all-day', label: string, date: string, endDate: string, start?: string, end?: string, originalStart?: string, originalEnd?: string, original?: string, note?: string}} Variant */

/** @param {import('./extract.js').Candidate} event @param {number} [travelMinutes] @returns {Variant[]} */
export function createVariants(event, travelMinutes = 30) {
  if (
    !Number.isInteger(travelMinutes) ||
    travelMinutes < 0 ||
    travelMinutes > 180
  )
    throw new RangeError("移動時間は0〜180分で指定してください");
  const lastDay = event.end
    ? localDay(new Date(Date.parse(event.end) - 1))
    : (event.endDate ?? event.date);
  const allDay = {
    kind: /** @type {const} */ ("all-day"),
    label: "終日",
    date: event.date,
    endDate: lastDay,
  };
  if (!event.start || !event.end) return [allDay];
  const exact = {
    kind: /** @type {const} */ ("exact"),
    label: "時間どおり",
    date: event.date,
    endDate: lastDay,
    start: event.start,
    end: event.end,
    note: event.assumedEnd ? "終了時刻は仮に1時間後" : undefined,
  };
  const travel = {
    ...exact,
    kind: /** @type {const} */ ("travel"),
    label: "移動込み",
    originalStart: event.start,
    originalEnd: event.end,
    start: new Date(
      Date.parse(event.start) - travelMinutes * 60_000,
    ).toISOString(),
    end: new Date(Date.parse(event.end) + travelMinutes * 60_000).toISOString(),
    original: `${dayLabel(event.date)} ${timeRange(event.start, event.end)}`,
  };
  return travelMinutes ? [exact, travel, allDay] : [exact, allDay];
}

/** Hide date-only cards covered by an identical timed range; keep every card's variants.
 * @param {import('./extract.js').Candidate[]} events
 * @param {number} [travelMinutes]
 */
export function candidateOptions(events, travelMinutes = 30) {
  const options = events.map((candidate) => ({
    candidate,
    variants: createVariants(candidate, travelMinutes),
  }));
  /** @param {Variant[]} variants */
  const rangeKey = (variants) => `${variants[0].date}/${variants[0].endDate}`;
  const timedRanges = new Set(
    options
      .filter(({ variants }) => variants.length > 1)
      .map(({ variants }) => rangeKey(variants)),
  );
  const allDays = new Set();
  return options.filter(({ variants }) => {
    if (variants.length > 1) return true;
    const key = rangeKey(variants);
    if (timedRanges.has(key) || allDays.has(key)) return false;
    allDays.add(key);
    return true;
  });
}

/** @param {import('./draft.js').Draft} draft @param {Variant} [variant] */
export function composeDetails(draft, variant) {
  const text = draft.details.split(draft.url).join("").trim();
  return [
    text,
    variant?.original
      ? `開催日時: ${variant.original}${variant.note ? `（${variant.note}）` : ""}`
      : "",
    draft.url,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** @param {Variant} variant @param {import('./draft.js').Draft} draft @param {string} [titleFormat] */
export function calendarUrl(
  variant,
  draft,
  titleFormat = DEFAULT_TITLE_FORMAT,
) {
  const url = new URL("https://calendar.google.com/calendar/render");
  /** @param {string} iso */
  const utc = (iso) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const dates =
    variant.start && variant.end
      ? `${utc(variant.start)}/${utc(variant.end)}`
      : `${variant.date.replaceAll("-", "")}/${addDays(variant.endDate).replaceAll("-", "")}`;
  url.search = new URLSearchParams({
    action: "TEMPLATE",
    text: formatTitle(titleFormat, draft.title, variant),
    dates,
    details: composeDetails(draft, variant),
    location: draft.location,
  }).toString();
  return url.href;
}
