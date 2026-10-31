import { THEMES, resolveTheme } from "./themes.js";

/** A disclosure with native buttons keeps swatches consistent across browsers.
 * @param {unknown} initial
 * @param {(id: string) => void} choose
 */
export function createThemeSelector(initial, choose) {
  const element = document.createElement("details");
  element.className = "theme-selector";
  const summary = document.createElement("summary");
  summary.setAttribute("aria-label", "カラーテーマ");
  const options = document.createElement("div");
  options.className = "theme-options";
  options.setAttribute("role", "group");
  options.setAttribute("aria-label", "カラーテーマの選択肢");
  /** @type {HTMLButtonElement[]} */
  const buttons = [];

  /** @param {typeof THEMES[number]} theme */
  function caption(theme) {
    const fragment = document.createDocumentFragment();
    const swatch = document.createElement("span");
    swatch.className = "theme-swatch";
    swatch.dataset.themePreview = theme.id;
    swatch.setAttribute("aria-hidden", "true");
    const accent = document.createElement("span");
    accent.textContent = "Aa";
    swatch.append(accent);
    const text = document.createElement("span");
    text.className = "theme-caption";
    const name = document.createElement("span");
    name.textContent = theme.name;
    const reading = document.createElement("small");
    reading.textContent = `${theme.reading}${theme.note ? ` · ${theme.note}` : ""}`;
    text.append(name, reading);
    fragment.append(swatch, text);
    return fragment;
  }
  /** @param {unknown} value */
  function setValue(value) {
    const id = resolveTheme(value);
    const theme = THEMES.find((theme) => theme.id === id) ?? THEMES[0];
    summary.replaceChildren(caption(theme));
    summary.setAttribute("aria-label", `カラーテーマ：${theme.name}`);
    summary.title = `${theme.name}（${theme.reading}）`;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.value === id));
  }
  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.value = theme.id;
    button.setAttribute("aria-label", theme.name);
    button.append(caption(theme));
    button.addEventListener("click", () => {
      setValue(theme.id);
      element.open = false;
      summary.focus({ preventScroll: true });
      choose(theme.id);
    });
    buttons.push(button);
    options.append(button);
  }
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && element.open) {
      event.preventDefault(); event.stopPropagation();
      element.open = false; summary.focus({ preventScroll: true });
      return;
    }
    const index = buttons.indexOf(/** @type {HTMLButtonElement} */ (event.target));
    if (index < 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  element.addEventListener("toggle", () => {
    if (element.open) element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  });
  element.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && !element.contains(event.relatedTarget)) element.open = false;
  });
  element.append(summary, options);
  setValue(initial);
  return { element, setValue };
}
