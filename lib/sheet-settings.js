import { button } from "./sheet-elements.js";
import { createThemeSelector } from "./theme-selector.js";
import { resolveTheme } from "./themes.js";
import { DEFAULT_TITLE_FORMAT, formatTitle, validateTitleFormat } from "./title-format.js";

/** Render one settings visit. Persistence and errors belong to the sheet controller.
 * @param {HTMLElement} content
 * @param {{preferences: () => ReturnType<typeof import('./preferences.js').normalizePreferences>, draft: import('./draft.js').Draft|null, variant: import('./calendar.js').Variant|null, quote: {text: string, original: string, attribution: string}, change: (values: Partial<ReturnType<typeof import('./preferences.js').normalizePreferences>>) => void, notice: (text: string, error?: boolean) => void}} options
 */
export function renderSheetSettings(content, { preferences, draft, variant, quote, change, notice }) {
  const values = preferences();
  const travel = document.createElement("input");
  travel.type = "number"; travel.min = "0"; travel.max = "180"; travel.step = "5";
  travel.value = String(values.travelMinutes);
  travel.onchange = () => {
    const value = Number(travel.value);
    if (!travel.value || !Number.isInteger(value) || value < 0 || value > 180) {
      notice("移動時間は0〜180分で指定してください。", true); return;
    }
    change({ travelMinutes: value });
  };
  const format = document.createElement("input");
  format.value = values.titleFormat; format.maxLength = 200;
  format.id = "title-format";
  format.autocomplete = "off";
  format.spellcheck = false;
  const preview = document.createElement("output");
  preview.id = "format-preview";
  preview.className = "format-preview";
  preview.setAttribute("aria-live", "polite");
  format.setAttribute("aria-describedby", preview.id);
  const previewVariant = variant ?? { kind: "exact", label: "時間どおり", date: "2026-11-08", endDate: "2026-11-08", start: "2026-11-08T14:00:00", end: "2026-11-08T16:00:00" };
  const updateFormat = (persist = false) => {
    const value = format.value.trim();
    const error = validateTitleFormat(value);
    format.setAttribute("aria-invalid", String(Boolean(error)));
    preview.classList.toggle("error", Boolean(error));
    preview.textContent = error ?? formatTitle(value, draft?.title ?? "予定のタイトル", /** @type {import('./calendar.js').Variant} */ (previewVariant));
    if (persist && !error && preferences().titleFormat !== value) { change({ titleFormat: value }); }
  };
  format.oninput = () => updateFormat(true);
  updateFormat();
  const tokens = document.createElement("div");
  tokens.className = "format-tokens";
  for (const [label, token] of [["タイトル", "{title}"], ["開始時刻", "{from:HHmm}"], ["終了時刻", "{to:HHmm}"], ["日付", "{date:YYYY-MM-DD}"]]) {
    const insert = button(label, () => {
      format.setRangeText(token, format.selectionStart ?? format.value.length, format.selectionEnd ?? format.value.length, "end");
      format.focus({ preventScroll: true }); updateFormat(true);
    }, "text-button");
    insert.title = token;
    tokens.append(insert);
  }
  const resetFormat = button("初期値に戻す", () => { format.value = DEFAULT_TITLE_FORMAT; updateFormat(true); }, "text-button");
  const themeSelector = createThemeSelector(values.themeId, (value) => change({ themeId: resolveTheme(value) }));
  for (const [label, input] of /** @type {[string, HTMLElement][]} */ ([
    ["前後の移動時間（片道・分）", travel], ["タイトルの書式", format],
  ])) {
    const group = document.createElement("section");
    group.className = "setting-group";
    group.setAttribute("aria-label", label);
    const field = document.createElement("label");
    field.textContent = label; field.append(input); group.append(field);
    content.append(group);
    if (input === format) {
      const help = document.createElement("p");
      help.className = "hint";
      help.textContent = "例：{from:HHmm} {title}\n開始・終了は移動時間を含まない開催時刻。終日では空欄になります。";
      group.append(tokens, preview, resetFormat, help);
    }
  }
  const themeGroup = document.createElement("section");
  themeGroup.className = "setting-group theme-setting";
  themeGroup.setAttribute("aria-label", "カラーテーマ");
  const themeLabel = document.createElement("p");
  themeLabel.textContent = "カラーテーマ";
  themeGroup.append(themeLabel, themeSelector.element);
  content.append(themeGroup);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "変更は自動保存されます。";
  content.append(hint);
  const words = document.createElement("p");
  words.className = "quote";
  words.textContent = quote.text;
  words.title = `${quote.original} — ${quote.attribution}`;
  content.append(words);
  return themeSelector;
}
