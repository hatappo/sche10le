// Palette values live in theme.css; these stable IDs are the only saved values.
export const DEFAULT_THEME = "chitosemidori";
export const THEMES = [
  { id: DEFAULT_THEME, name: "千歳緑", reading: "ちとせみどり", note: "標準" },
  { id: "ginnezu", name: "銀鼠", reading: "ぎんねず", note: "" },
  { id: "mizuasagi", name: "水浅葱", reading: "みずあさぎ", note: "" },
  { id: "aitetsu", name: "藍鉄", reading: "あいてつ", note: "ダーク" },
  { id: "kurocha", name: "黒茶", reading: "くろちゃ", note: "ダーク" },
  { id: "shikon", name: "紫紺", reading: "しこん", note: "ダーク" },
];

/** @param {unknown} value */
export function resolveTheme(value) {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME;
}

/** Change colors only: never recreate the picker, move focus, or reset a draft.
 * @param {HTMLElement} target @param {unknown} value
 */
export function applyTheme(target, value) {
  target.dataset.theme = resolveTheme(value);
}
