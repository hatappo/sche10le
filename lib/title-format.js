import { localDay, pad } from "./dates.js";

export const DEFAULT_TITLE_FORMAT = "{title}";
const TIME_FORMATS = ["HHmm", "HH:mm", "hhmm"];
const DATE_FORMATS = ["YYYY-MM-DD", "YYYY/MM/DD", "MM/DD", "M/D"];

/** Return a user-facing error, or null. The syntax is deliberately small: no eval.
 * @param {string} template
 */
export function validateTitleFormat(template) {
  if (!template.trim()) return "タイトルの書式を入力してください。";
  if (template.length > 200 || /[\r\n]/.test(template))
    return "書式は200文字以内の1行で入力してください。";
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const [name, format] = match[1].split(":");
    // HH:mm contains a colon, so read the format from the first separator only.
    const fullFormat = match[1].slice(name.length + 1);
    const valid =
      name === "title"
        ? format === undefined
        : name === "from" || name === "to"
          ? format === undefined || TIME_FORMATS.includes(fullFormat)
          : name === "date"
            ? format === undefined || DATE_FORMATS.includes(fullFormat)
            : false;
    if (!valid) return `未対応の指定です: ${match[0]}`;
  }
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, "")))
    return "変数は {title} のように { } で囲んでください。";
  return null;
}

/** @param {string} template @param {string} title @param {import('./calendar.js').Variant} variant */
export function formatTitle(template, title, variant) {
  const error = validateTitleFormat(template);
  if (error) throw new Error(error);
  if (template === DEFAULT_TITLE_FORMAT) return title;
  return template
    .replace(/\{([^{}]*)\}/g, (_match, rawToken) => {
      const token = String(rawToken);
      if (token === "title") return title;
      const separator = token.indexOf(":");
      const name = separator < 0 ? token : token.slice(0, separator);
      const format = separator < 0 ? undefined : token.slice(separator + 1);
      if (name === "date") {
        const date = variant.start
          ? localDay(new Date(variant.start))
          : variant.date;
        const [year, month, day] = date.split("-");
        const parts = /** @type {Record<string, string>} */ ({
          YYYY: year,
          MM: month,
          DD: day,
          M: String(+month),
          D: String(+day),
        });
        return (format ?? "YYYY-MM-DD").replace(
          /YYYY|MM|DD|M|D/g,
          (part) => parts[part] ?? "",
        );
      }
      const value =
        name === "from"
          ? (variant.originalStart ?? variant.start)
          : (variant.originalEnd ?? variant.end);
      if (!value) return "";
      const date = new Date(value);
      const hh = pad(date.getHours());
      const mm = pad(date.getMinutes());
      return format === "HHmm" || format === "hhmm"
        ? `${hh}${mm}`
        : `${hh}:${mm}`;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
