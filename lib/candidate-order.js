import { compactText } from "./source-locator.js";

/** @typedef {'page'|'date'} CandidateOrder */

/** Sort without mutating extraction order or changing which source owns a candidate.
 * @param {import('./extract.js').Candidate[]} candidates
 * @param {CandidateOrder} order
 * @param {string} pageText
 */
export function orderCandidates(candidates, order, pageText) {
  const text = compactText(pageText);
  const positioned = candidates.map((candidate, index) => {
    const locator = candidate.locator;
    let position = -1;
    if (locator?.text) {
      let from = 0;
      for (let occurrence = 0; occurrence <= locator.occurrence; occurrence++) {
        position = text.indexOf(locator.text, from);
        if (position < 0) break;
        from = position + locator.text.length;
      }
    }
    return { candidate, index, position: position < 0 ? Infinity : position };
  });
  positioned.sort((a, b) => {
    if (order === "date") {
      const day = a.candidate.date.localeCompare(b.candidate.date);
      if (day) return day;
      // All-day events precede timed events on the same start date.
      const timeA = a.candidate.start
        ? Date.parse(a.candidate.start)
        : -Infinity;
      const timeB = b.candidate.start
        ? Date.parse(b.candidate.start)
        : -Infinity;
      if (timeA !== timeB) return timeA - timeB;
    }
    return a.position - b.position || a.index - b.index;
  });
  return positioned.map(({ candidate }) => candidate);
}
