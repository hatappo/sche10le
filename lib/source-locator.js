/** @typedef {{text: string, occurrence: number}} SourceLocator */

/** Ignore layout whitespace while preserving the text used to identify a source.
 * @param {string} text
 */
export function compactText(text) {
  return text.normalize("NFKC").replace(/\s/g, "");
}

/** @param {string} text @param {number} start @param {number} end @returns {SourceLocator} */
export function sourceLocator(text, start, end) {
  const quote = compactText(text.slice(start, end));
  const prefix = compactText(text.slice(0, start));
  let occurrence = 0;
  let position = 0;
  while (quote && (position = prefix.indexOf(quote, position)) !== -1) {
    occurrence++;
    position += quote.length;
  }
  return { text: quote, occurrence };
}
