import { DEFAULT_TITLE_FORMAT, validateTitleFormat } from "./title-format.js";
import { resolveTheme } from "./themes.js";

// Keep the v0.5 storage keys. Retired AI preferences are removed by the background on startup.
export const PREFERENCE_KEYS = ["themeId", "travelMinutes", "titleFormat", "candidateOrder"];

/** @param {Record<string, unknown>} saved */
export function normalizePreferences(saved) {
  return {
    themeId: resolveTheme(saved.themeId),
    travelMinutes: typeof saved.travelMinutes === "number" && Number.isInteger(saved.travelMinutes) &&
      saved.travelMinutes >= 0 && saved.travelMinutes <= 180 ? saved.travelMinutes : 30,
    titleFormat: typeof saved.titleFormat === "string" && !validateTitleFormat(saved.titleFormat)
      ? saved.titleFormat : DEFAULT_TITLE_FORMAT,
    candidateOrder: /** @type {'page'|'date'} */ (saved.candidateOrder === "date" ? "date" : "page"),
  };
}
