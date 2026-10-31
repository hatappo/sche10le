import { createDraft, pickField, PICK_FIELDS } from "./draft.js";

/** @typedef {'list'|'pick'|'review'|'settings'} SheetMode */
/** @typedef {Readonly<{mode: SheetMode, settingsOrigin: Exclude<SheetMode, 'settings'>, draft: import('./draft.js').Draft|null, variant: import('./calendar.js').Variant|null, complete: readonly boolean[]}>} SheetState */
/** @typedef {{type: 'reset'|'review'|'settings'|'back'|'hide'} | {type: 'choose', variant: import('./calendar.js').Variant, title: string, url: string} | {type: 'pick', step: number} | {type: 'accept', value: string}} SheetAction */

/** Page data lives only here; preferences, DOM, timers and visibility live outside.
 * @returns {SheetState}
 */
export function createSheetState() {
  return { mode: "list", settingsOrigin: "list", draft: null, variant: null, complete: [false, false, false] };
}

/** Pure transitions keep navigation from accidentally clearing selected content.
 * @param {SheetState} state @param {SheetAction} action @returns {SheetState}
 */
export function transitionSheet(state, action) {
  switch (action.type) {
    case "reset": return createSheetState();
    case "choose": return {
      ...createSheetState(), mode: "pick", variant: action.variant,
      draft: createDraft(action.title, action.url),
    };
    case "settings": return state.mode === "settings" ? state : { ...state, settingsOrigin: state.mode, mode: "settings" };
    case "back": return state.mode === "settings" ? { ...state, mode: state.settingsOrigin } : state;
    case "hide": return state.mode === "pick" ? { ...state, mode: "review" } : state;
    case "review": return state.draft ? { ...state, mode: "review" } : state;
    case "pick": return state.draft && Number.isInteger(action.step) && PICK_FIELDS[action.step]
      ? { ...state, mode: "pick", draft: { ...state.draft, step: action.step } } : state;
    case "accept": {
      if (state.mode !== "pick" || !state.draft) return state;
      const draft = pickField(state.draft, action.value);
      if (draft === state.draft) return state;
      const complete = state.complete.map((done, index) => index === state.draft?.step || done);
      return { ...state, draft, complete, mode: draft.step >= PICK_FIELDS.length ? "review" : "pick" };
    }
  }
}
