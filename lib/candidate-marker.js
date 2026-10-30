/** Stable display markers are allocated in page order after duplicate filtering.
 * @param {number} index Zero-based position. @returns {string}
 */
export function candidateMarker(index) {
  let value = index + 1;
  let marker = "";
  while (value > 0) {
    value--;
    marker = String.fromCharCode(65 + value % 26) + marker;
    value = Math.floor(value / 26);
  }
  return marker;
}
