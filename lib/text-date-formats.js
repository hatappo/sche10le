import { validDay } from "./dates.js";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const YEAR = "(?:(?:\\s*,\\s*|\\s+)(\\d{4,8}))?";
const MONTH_FIRST = new RegExp(
  `^(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${YEAR}$`,
  "i",
);
const DAY_FIRST = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?${YEAR}$`,
  "i",
);
const NUMBER = "[\\d〇零一二三四五六七八九十百千]";
const JAPANESE = `(?:${NUMBER}{1,8}\\s*年\\s*)?${NUMBER}{1,4}\\s*月\\s*${NUMBER}{1,4}日?`;
const ERA = `(?:令和|平成|昭和|大正|明治)\\s*(?:元|${NUMBER}{1,8})\\s*年\\s*${NUMBER}{1,4}\\s*月\\s*${NUMBER}{1,4}日?`;
// Consume unsupported era/kanji/year-last dates as whole tokens too. Otherwise a
// failed parse could silently turn their month/day suffix into a different year.
const DATE_FORMS = [
  ERA,
  JAPANESE,
  "(?<![a-z])R\\d{1,3}[/.-]\\d{1,2}[/.-]\\d{1,2}",
  `(?<![a-z])${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?${YEAR}(?![a-z\\d])`,
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?${YEAR}(?![a-z\\d])`,
  "\\d{1,4}\\s*[/.-]\\s*\\d{1,2}(?:\\s*[/.-]\\s*\\d{1,4})?",
];
const DATE_PATTERN = new RegExp(
  `(?<![\\d:/.-])(?:${DATE_FORMS.join("|")})(?![\\d:/-]|\\.\\d)`,
  "gi",
);

/** @typedef {{index: number, text: string, year?: number, month: number, day: number, valid: boolean}} DateToken */

/** @param {string} text @returns {DateToken[]} */
export function findDateTokens(text) {
  return [...text.matchAll(DATE_PATTERN)].map((match) => {
    const raw = match[0];
    let year;
    let month = 0;
    let day = 0;
    let reiwa = false;
    const era =
      /^令和\s*(元|\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})日?$/.exec(raw);
    const japanese = /^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})日?$/.exec(
      raw,
    );
    const numeric =
      /^(?:(\d{4})\s*[/.-]\s*)?(\d{1,2})\s*[/.-]\s*(\d{1,2})$/.exec(raw);
    const monthFirst = MONTH_FIRST.exec(raw);
    const dayFirst = DAY_FIRST.exec(raw);
    if (era) {
      reiwa = true;
      year = 2018 + (era[1] === "元" ? 1 : Number(era[1]));
      month = +era[2];
      day = +era[3];
    } else if (japanese || numeric) {
      const parts = /** @type {RegExpExecArray} */ (japanese || numeric);
      year = parts[1] ? +parts[1] : undefined;
      month = +parts[2];
      day = +parts[3];
    } else if (monthFirst || dayFirst) {
      const parts = /** @type {RegExpExecArray} */ (monthFirst || dayFirst);
      year = parts[3] ? +parts[3] : undefined;
      month =
        MONTHS.indexOf(parts[monthFirst ? 1 : 2].slice(0, 3).toLowerCase()) + 1;
      day = +parts[monthFirst ? 2 : 1];
    }
    // A yearless Feb 29 can be valid when a date range inherits a leap year.
    // The caller validates again after resolving the actual year.
    const resolved = year ?? 2000;
    const invalidEnglishYear =
      (monthFirst || dayFirst) &&
      year === undefined &&
      /^\s*,\s*\d/.test(
        text.slice(match.index + raw.length, match.index + raw.length + 20),
      );
    const valid =
      !invalidEnglishYear &&
      validDay(resolved, month, day) &&
      (!reiwa || resolved > 2019 || (resolved === 2019 && month >= 5));
    return { index: match.index, text: raw, year, month, day, valid };
  });
}
