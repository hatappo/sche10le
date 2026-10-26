import { calendarEvent } from "./calendar.js";

/** RFC 5545 TEXT values: keep page text inside its property, never as new lines.
 * @param {string} value
 */
function escapeText(value) {
  return Array.from(value.replace(/\r\n|\r/g, "\n"))
    .filter(
      (char) =>
        char === "\n" ||
        char === "\t" ||
        (char.charCodeAt(0) >= 32 && char !== "\x7f"),
    )
    .join("")
    .replace(/[\\,;]/g, "\\$&")
    .replace(/\n/g, "\\n");
}

/** Fold at 75 UTF-8 octets, counting the continuation space, without splitting a character.
 * @param {string} line
 */
function foldLine(line) {
  const encoder = new TextEncoder();
  let result = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}

/** One portable VEVENT, generated locally; the importing calendar chooses its display zone.
 * @param {import('./calendar.js').Variant} variant
 * @param {import('./draft.js').Draft} draft
 * @param {string} [titleFormat]
 */
export function calendarFile(variant, draft, titleFormat) {
  const event = calendarEvent(variant, draft, titleFormat);
  const dateType = event.allDay ? ";VALUE=DATE" : "";
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Sche10le//Calendar Export//JA",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${crypto.randomUUID()}@sche10le`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")}`,
      `DTSTART${dateType}:${event.start}`,
      `DTEND${dateType}:${event.end}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.details)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldLine)
      .join("\r\n") + "\r\n"
  );
}
