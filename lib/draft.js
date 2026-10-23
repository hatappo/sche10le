/** @typedef {{title: string, location: string, details: string, url: string, step: number}} Draft */
export const PICK_FIELDS = /** @type {const} */ ([
  "title",
  "location",
  "details",
]);
export const FIELD_LABELS = ["タイトル", "場所", "詳細"];

/** @param {string} title @param {string} url @returns {Draft} */
export function createDraft(title, url) {
  return { title: title.trim(), location: "", details: "", url, step: 0 };
}

/** @param {Draft} draft @param {string} value @returns {Draft} */
export function pickField(draft, value) {
  const field = PICK_FIELDS[draft.step];
  if (!field || !value.trim()) return draft;
  return {
    ...draft,
    [field]: value.trim().slice(0, field === "details" ? 4000 : 500),
    step: draft.step + 1,
  };
}

/** @param {Draft} draft */
export const skipField = (draft) => ({
  ...draft,
  step: Math.min(3, draft.step + 1),
});
/** @param {Draft} draft */
export const previousField = (draft) => ({
  ...draft,
  step: Math.max(0, draft.step - 1),
});
