import themeCss from "./theme.css?inline";
import sheetCss from "./sheet.css?inline";
import { THEMES, applyTheme, resolveTheme } from "./themes.js";
import { extractStructuredEvents, extractTextEvents, mergeCandidates } from "./extract.js";
import { candidateOptions, calendarUrl, composeDetails, registrationSummary } from "./calendar.js";
import { orderCandidates } from "./candidate-order.js";
import { dateRangeLabel, timeRange } from "./dates.js";
import { createDraft, pickField, FIELD_LABELS, PICK_FIELDS } from "./draft.js";
import { DEFAULT_TITLE_FORMAT, formatTitle, validateTitleFormat } from "./title-format.js";
import { createSourceHighlight } from "./source-highlight.js";
import { normalizePreferences } from "./preferences.js";
import { pickFooterQuote } from "./footer-quotes.js";
import { calendarFile } from "./ical.js";

/** The sheet owns page-local state; background/popup lifetimes do not own a draft.
 * @param {{load: () => Promise<Record<string, unknown>>, save: (values: Record<string, unknown>) => Promise<void>, openCalendar: (url: string) => Promise<void>}} api
 */
export function createSheet(api) {
  const host = document.createElement("sche10le-sheet");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `${themeCss}\n${sheetCss}`;
  const sheet = document.createElement("section");
  sheet.className = "sheet";
  sheet.setAttribute("role", "region");
  sheet.setAttribute("aria-label", "Sche10le");
  const heading = document.createElement("header");
  const title = document.createElement("h2");
  const close = button("×", () => hide(), "icon-button");
  close.setAttribute("aria-label", "Sche10leを閉じる");
  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  const content = document.createElement("div");
  content.className = "content";
  const controls = document.createElement("div");
  controls.className = "pick-controls";
  const footer = document.createElement("footer");
  const outline = document.createElement("div");
  outline.className = "outline";
  outline.hidden = true;
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const settings = iconButton("設定", "M9 3h6l.6 3 2.4 1.4 2.9-1 3 5.2-2.3 2v2.8l2.3 2-3 5.2-2.9-1-2.4 1.4L15 27H9l-.6-3-2.4-1.4-2.9 1-3-5.2 2.3-2v-2.8l-2.3-2 3-5.2 2.9 1L8.4 6Z M16 15a4 4 0 1 0-8 0 4 4 0 0 0 8 0", () => {
    if (mode !== "settings") settingsOrigin = mode;
    stopCue(); mode = "settings"; highlight.clear(); render();
  });
  // Use a compact, symmetric 24px gear inside the shared 44px hit target.
  settings.querySelector("svg")?.setAttribute("viewBox", "-2 0 28 30");
  const expand = iconButton("内容を確認", "m6 14 6-6 6 6 M6 20l6-6 6 6", () => { mode = "review"; render(); });
  const back = button("戻る", () => { mode = settingsOrigin; render(); }, "header-back");
  headerActions.append(settings, expand, close);
  heading.append(back, title, headerActions);
  sheet.append(heading, status, content, controls, footer);
  shadow.append(style, outline, sheet);
  const highlight = createSourceHighlight(() => sheet.getBoundingClientRect());
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  /** @type {'list'|'pick'|'review'|'settings'} */
  let mode = "list";
  /** @type {"list"|"pick"|"review"} */
  let settingsOrigin = "list";
  /** @type {import('./draft.js').Draft | null} */
  let draft = null;
  /** @type {import('./calendar.js').Variant | null} */
  let variant = null;
  /** @type {import('./extract.js').Candidate[]} */
  let candidates = [];
  let text = "";
  let scanned = false;
  let rendering = false;
  let scanning = false;
  let lift = 0;
  const quote = pickFooterQuote();
  let saveMessage = "";
  let saveFailed = false;
  let pendingSaves = 0;
  /** @type {number | undefined} */
  let hoverTimer;
  /** @type {number | undefined} */
  let cueTimer;
  let cues = 0;
  let shine = -1;
  let expanded = "";
  let complete = [false, false, false];
  let themeId = resolveTheme(undefined);
  let travelMinutes = 30;
  let titleFormat = DEFAULT_TITLE_FORMAT;
  /** @type {import('./candidate-order.js').CandidateOrder} */
  let order = "page";
  let revision = 0;
  let opening = false;
  let saves = Promise.resolve();
  let saveRevision = 0;
  /** @type {HTMLElement | null} */
  let restoreFocus = null;
  /** @type {{x: number, y: number, scrollX: number, scrollY: number, moved: boolean} | null} */
  let contact = null;

  /** @param {string} text @param {() => void} action @param {string} [className] */
  function button(text, action, className = "") {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = text;
    node.addEventListener("click", action);
    return node;
  }
  /** @param {string} label @param {string} path @param {() => void} action */
  function iconButton(label, path, action) {
    const node = button("", action, "icon-button");
    node.title = label;
    node.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", path);
    svg.append(shape); node.append(svg);
    return node;
  }
  /** @param {string} text @param {boolean} [error] */
  function notice(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }
  function paintTheme() {
    applyTheme(host, themeId);
    highlight.setTheme(themeId);
  }
  function preferences() { return { themeId, travelMinutes, titleFormat, candidateOrder: order }; }
  /** @param {Record<string, unknown>} values */
  function updatePreferences(values) {
    // Local edits (including a failed save) win over delayed storage notifications.
    if (pendingSaves || saveFailed) return;
    const saved = normalizePreferences({ ...preferences(), ...values });
    themeId = saved.themeId;
    travelMinutes = saved.travelMinutes;
    titleFormat = saved.titleFormat;
    order = saved.candidateOrder;
    paintTheme();
  }
  function saveFeedback() {
    if (!saveMessage) return;
    notice(saveMessage, saveFailed);
    if (saveFailed) status.append(button("再試行", () => save(), "text-button"));
  }
  function save() {
    const values = preferences();
    const operation = ++saveRevision;
    pendingSaves++;
    saveFailed = false;
    saveMessage = "保存しています…";
    saveFeedback();
    // Write a complete settings snapshot in order; retry also preserves other failed fields.
    saves = saves.then(() => api.save(values)).then(() => {
      if (operation === saveRevision) { saveMessage = "自動保存しました"; saveFailed = false; }
    }, () => {
      if (operation === saveRevision) { saveMessage = "設定を保存できませんでした。"; saveFailed = true; }
    }).finally(() => {
      pendingSaves--;
      if (operation === saveRevision && !host.hidden) saveFeedback();
    });
  }
  function stopCue() { clearTimeout(cueTimer); sheet.querySelector(".primary")?.classList.remove("ready-cue"); }
  function cue() {
    if (host.hidden || mode !== "review" || !complete.every(Boolean) || cues >= 3 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const action = footer.querySelector(".primary");
    action?.classList.remove("ready-cue");
    // A new class cycle only when the spaced cue actually runs, never on a general render.
    if (action instanceof HTMLElement) void action.offsetWidth;
    action?.classList.add("ready-cue");
    cues++;
    cueTimer = window.setTimeout(cue, 11_200);
  }
  /** @param {number} value */
  function setLift(value) {
    const height = window.visualViewport?.height ?? innerHeight;
    lift = Math.max(0, Math.min(value, height - sheet.offsetHeight - 32));
    host.style.setProperty("--sheet-lift", `${lift}px`);
  }
  function viewport() {
    const view = window.visualViewport;
    host.style.setProperty("--view-height", `${view?.height ?? innerHeight}px`);
    host.style.setProperty("--view-width", `${view?.width ?? innerWidth}px`);
    host.style.setProperty("--view-left", `${view?.offsetLeft ?? 0}px`);
    host.style.setProperty("--view-bottom", `${Math.max(0, innerHeight - (view?.height ?? innerHeight) - (view?.offsetTop ?? 0))}px`);
    outline.hidden = true;
    setLift(lift);
  }
  function hide() {
    revision++;
    stopCue();
    drag = null; sheet.classList.remove("dragging");
    clearTimeout(hoverTimer);
    host.hidden = true;
    outline.hidden = true;
    highlight.clear();
    if (mode === "pick") mode = "review";
    restoreFocus?.focus({ preventScroll: true });
  }
  function reset() {
    hide();
    draft = null;
    variant = null;
    candidates = [];
    text = "";
    scanned = false;
    complete = [false, false, false];
    mode = "list";
    expanded = "";
    lift = 0;
    render();
  }
  async function scan() {
    if (scanning) return;
    const operation = ++revision;
    scanning = true;
    stopCue();
    render();
    notice("スキャンしています…");
    await new Promise((resolve) => window.setTimeout(resolve, 32));
    if (operation !== revision) { scanning = false; return; }
    draft = null;
    variant = null;
    expanded = "";
    complete = [false, false, false];
    mode = "list";
    // Our host is outside body, so neither this UI nor its displayed dates are scanned.
    text = (document.body?.innerText ?? "").slice(0, 100_000);
    const json = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .slice(0, 50).map((node) => (node.textContent ?? "").slice(0, 200_001));
    candidates = mergeCandidates(extractStructuredEvents(json), extractTextEvents(text));
    highlight.clear();
    highlight.capture();
    scanned = true;
    scanning = false;
    render();
  }
  /** @param {number} step */
  function startPicking(step) {
    if (!draft) return;
    draft = { ...draft, step };
    mode = "pick";
    stopCue();
    contact = null;
    highlight.clear();
    render();
  }
  /** @param {string} value */
  function accept(value) {
    if (!draft) return;
    const step = draft.step;
    const next = pickField(draft, value);
    if (next === draft) return;
    draft = next;
    complete[step] = true;
    shine = step;
    outline.hidden = true;
    mode = draft.step >= 3 ? "review" : "pick";
    render();
    if (mode === "review") {
      /** @type {HTMLButtonElement | null} */ (footer.querySelector(".primary"))?.focus({ preventScroll: true });
      cues = 0; cue();
    }
  }
  function render() {
    rendering = true;
    const changedMode = sheet.dataset.mode !== mode;
    const focused = shadow.activeElement;
    const replacingFocus = focused && (focused === back || [content, controls, footer, headerActions].some((region) => region.contains(focused)));
    const focusedLabel = focused?.getAttribute("aria-label") || focused?.textContent;
    sheet.dataset.mode = mode;
    settings.hidden = mode === "settings";
    expand.hidden = mode !== "pick";
    back.hidden = mode !== "settings";
    footer.hidden = mode !== "review";
    notice("");
    title.textContent = mode === "list" ? "日時を選ぶ" : mode === "settings" ? "設定" :
      mode === "pick" ? `${FIELD_LABELS[draft?.step ?? 0]}を選択` : "内容を確認";
    content.replaceChildren();
    controls.replaceChildren();
    footer.replaceChildren();
    outline.hidden = true;
    if (mode === "list") renderList();
    if (mode === "pick") renderPicker();
    if (mode === "review") renderReview();
    if (mode === "settings") renderSettings();
    if (saveFailed) saveFeedback();
    if (changedMode) content.scrollTop = 0;
    rendering = false;
    if (replacingFocus && !host.hidden) {
      const same = [...sheet.querySelectorAll("button")].find((node) =>
        !node.disabled && node.checkVisibility() && (node.getAttribute("aria-label") || node.textContent) === focusedLabel);
      const next = same ?? sheet.querySelector(mode === "settings" ? "input" : mode === "pick" ? '[aria-current="step"]' : mode === "review" ? ".primary" : "select");
      if (next instanceof HTMLElement && next.checkVisibility()) next.focus({ preventScroll: true });
      else close.focus({ preventScroll: true });
    }
    requestAnimationFrame(() => setLift(lift));
  }
  function renderList() {
    const options = scanning ? [] : candidateOptions(orderCandidates(candidates, order, text), travelMinutes);
    const toolbar = document.createElement("div");
    toolbar.className = "row scan-toolbar";
    const count = document.createElement("span");
    count.textContent = `スキャン済み ✓ · ${options.length}件`;
    count.hidden = scanning;
    const sorting = select([["page", "登場順"], ["date", "日時順"]], order);
    sorting.setAttribute("aria-label", "日程の並び順");
    sorting.onchange = () => {
      order = sorting.value === "date" ? "date" : "page";
      save();
      render();
    };
    const rescan = button(scanning ? "スキャン中…" : "再スキャン", () => void scan(), "text-button");
    rescan.disabled = scanning;
    rescan.classList.toggle("scanning", scanning);
    sorting.hidden = scanning;
    toolbar.append(count, rescan, sorting);
    content.append(toolbar);
    for (const option of options) {
      const card = document.createElement("article");
      card.className = "candidate";
      card.dataset.candidateId = option.candidate.id;
      card.title = `${option.candidate.evidence}${option.candidate.inferredYear ? "（年を補っています）" : ""}`;
      const label = `${dateRangeLabel(option.candidate.date, option.candidate.endDate ?? option.candidate.date)} ${option.candidate.start ? timeRange(option.candidate.start, option.candidate.end ?? option.candidate.start) : "終日"}`;
      const toggle = button(label, () => {
        expanded = option.candidate.id;
        if (expanded) highlight.reveal(option.candidate.locator);
        else highlight.clear();
        render();
        content.querySelector(`[data-id="${CSS.escape(option.candidate.id)}"]`)?.scrollIntoView({ block: "nearest" });
      }, "candidate-toggle");
      toggle.dataset.id = option.candidate.id;
      toggle.setAttribute("aria-expanded", String(expanded === option.candidate.id));
      card.append(toggle);
      // Mouse/keyboard open automatically. Touch uses an explicit tap; a repeat tap stays open.
      toggle.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse" || expanded === option.candidate.id) return;
        clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => toggle.click(), 180);
      });
      const collapse = () => {
        if (rendering || !card.isConnected || expanded !== option.candidate.id) return;
        expanded = "";
        toggle.setAttribute("aria-expanded", "false");
        const variants = /** @type {HTMLElement | null} */ (card.querySelector(".variants"));
        if (variants) variants.hidden = true;
        highlight.clear();
      };
      card.addEventListener("pointerleave", (event) => {
        clearTimeout(hoverTimer);
        if (event.pointerType === "mouse" && !card.contains(shadow.activeElement)) collapse();
      });
      card.addEventListener("focusout", (event) => {
        if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) collapse();
      });
      toggle.addEventListener("focus", () => {
        if (toggle.matches(":focus-visible") && expanded !== option.candidate.id) {
          toggle.click();
          /** @type {HTMLElement | null} */ (content.querySelector(`[data-id="${CSS.escape(option.candidate.id)}"]`))?.focus({ preventScroll: true });
        }
      });
      if (expanded === option.candidate.id) {
        const variants = document.createElement("div");
        variants.className = "variants";
        for (const choice of option.variants) {
          variants.append(button(registrationSummary(choice, option.candidate), () => {
            revision++;
            variant = choice;
            lift = 0; setLift(0);
            cues = 0;
            draft = createDraft(document.title, location.href);
            startPicking(0);
          }, "variant"));
        }
        card.append(variants);
      }
      content.append(card);
    }
    if (!scanning && !options.length) {
      const empty = document.createElement("p");
      empty.textContent = "このページでは日程が見つかりませんでした。";
      content.append(empty);
    }
  }
  sheet.addEventListener("pointerdown", () => stopCue(), events);
  sheet.addEventListener("keydown", () => stopCue(), events);
  function chooseAgain() {
    stopCue();
    revision++;
    draft = null; variant = null; complete = [false, false, false]; expanded = "";
    mode = "list"; render();
  }
  function selectionSummary() {
    const summary = document.createElement("p");
    summary.className = "summary";
    if (variant) summary.textContent = `${dateRangeLabel(variant.date, variant.endDate)} · ${variant.label}${variant.start ? ` ${timeRange(variant.start, variant.end ?? variant.start)}` : ""}${variant.note ? `（${variant.note}）` : ""}`;
    return summary;
  }
  function renderPicker() {
    if (!draft) return;
    const summaryRow = document.createElement("div");
    summaryRow.className = "row pick-summary";
    summaryRow.append(selectionSummary(), button("選び直す", chooseAgain, "text-button"));
    controls.append(summaryRow);
    const steps = document.createElement("div");
    steps.className = "steps";
    FIELD_LABELS.forEach((label, index) => {
      const step = button("", () => startPicking(index));
      step.setAttribute("aria-label", `${index + 1} ${label}`);
      const name = document.createElement("span");
      name.className = "step-label";
      name.textContent = `${index + 1} ${label}${complete[index] ? " ✓" : ""}`;
      const preview = document.createElement("span");
      preview.className = "step-value";
      const field = PICK_FIELDS[index];
      const value = fieldValue(field);
      step.title = value;
      preview.id = `preview-${field}`;
      step.setAttribute("aria-describedby", preview.id);
      if (field === "details" && value === draft?.url && value.length > 32) {
        preview.classList.add("url-preview");
        preview.setAttribute("aria-label", value);
        const start = document.createElement("span");
        start.className = "url-start"; start.textContent = value.slice(0, -8);
        const end = document.createElement("span");
        end.className = "url-end"; end.textContent = value.slice(-8);
        preview.append(start, end);
      } else preview.textContent = value;
      if (draft?.step === index) step.setAttribute("aria-current", "step");
      step.classList.toggle("done", complete[index]);
      name.classList.toggle("just-completed", shine === index);
      step.append(name, preview);
      steps.append(step);
    });
    controls.append(steps);
    shine = -1;
  }
  /** @param {'title'|'location'|'details'} field */
  function fieldValue(field) {
    if (!draft || !variant) return "未設定";
    if (field === "title") return formatTitle(titleFormat, draft.title, variant) || "未設定";
    if (field === "details") return composeDetails(draft, variant);
    return draft[field] || "未設定";
  }
  function renderReview() {
    if (!draft || !variant) return;
    const summaryRow = document.createElement("div");
    summaryRow.className = "row review-heading";
    summaryRow.append(selectionSummary(), button("選び直す", chooseAgain, "text-button"));
    content.append(summaryRow);
    PICK_FIELDS.forEach((field, index) => {
      const row = button("", () => startPicking(index), "field");
      const label = document.createElement("span");
      label.className = `field-label${shine === index ? " just-completed" : ""}`;
      label.textContent = `${index + 1} ${FIELD_LABELS[index]}${complete[index] ? " ✓" : ""}`;
      const value = document.createElement("span");
      value.textContent = fieldValue(field);
      row.classList.toggle("done", complete[index]);
      row.append(label, value);
      content.append(row);
    });
    shine = -1;
    footer.className = "actions";
    const open = button("Googleカレンダーで開く ↗", () => void openCalendar(), "primary");
    open.disabled = opening;
    const download = button("↓", downloadCalendar, "download");
    download.setAttribute("aria-label", "予定をダウンロード（.ics）");
    footer.append(open, download);
  }
  /** @param {string[][]} options @param {string} value */
  function select(options, value) {
    const node = document.createElement("select");
    for (const [id, label] of options) {
      const option = document.createElement("option");
      option.value = id; option.textContent = label; node.append(option);
    }
    node.value = value;
    return node;
  }
  function renderSettings() {
    const travel = document.createElement("input");
    travel.type = "number"; travel.min = "0"; travel.max = "180"; travel.step = "5";
    travel.value = String(travelMinutes);
    travel.onchange = () => {
      const value = Number(travel.value);
      if (!travel.value || !Number.isInteger(value) || value < 0 || value > 180) {
        notice("移動時間は0〜180分で指定してください。", true); return;
      }
      travelMinutes = value; save();
    };
    const format = document.createElement("input");
    format.value = titleFormat; format.maxLength = 200;
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
      if (persist && !error && titleFormat !== value) { titleFormat = value; save(); }
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
    const themes = select(THEMES.map((theme) => [theme.id, `${theme.name}（${theme.reading}）`]), themeId);
    themes.onchange = () => { themeId = resolveTheme(themes.value); paintTheme(); save(); };
    for (const [label, input] of /** @type {[string, HTMLElement][]} */ ([
      ["前後の移動時間（片道・分）", travel], ["タイトルの書式", format], ["カラーテーマ", themes],
    ])) {
      const field = document.createElement("label");
      field.textContent = label; field.append(input); content.append(field);
      if (input === format) {
        const help = document.createElement("p");
        help.className = "hint";
        help.textContent = "開始・終了は移動時間を含まない開催時刻。終日では空欄になります。";
        content.append(tokens, preview, resetFormat, help);
      }
    }
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "変更は自動保存されます。書式の例：{from:HHmm} {title}";
    content.append(hint);
    const words = document.createElement("p");
    words.className = "quote";
    words.textContent = quote.text;
    words.title = `${quote.original} — ${quote.attribution}`;
    content.append(words);

  }
  async function openCalendar() {
    if (!draft || !variant || opening) return;
    stopCue();
    opening = true;
    const operation = revision;
    render();
    try {
      await api.openCalendar(calendarUrl(variant, draft, titleFormat));
      if (operation === revision) notice("カレンダーを開きました。内容はここにも残っています。");
    } catch {
      if (operation === revision) notice("カレンダーを開けませんでした。もう一度お試しください。", true);
    } finally {
      opening = false;
      const action = /** @type {HTMLButtonElement | null} */ (footer.querySelector(".primary"));
      if (action) action.disabled = false;
    }
  }
  function downloadCalendar() {
    if (!draft || !variant) return;
    stopCue();
    try {
    const url = URL.createObjectURL(new Blob([calendarFile(variant, draft, titleFormat)], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `sche10le-${variant.date}.ics`;
    shadow.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { notice("予定をダウンロードできませんでした。もう一度お試しください。", true); }
  }
  /** @param {EventTarget | null} target */
  function pickable(target) {
    if (!(target instanceof HTMLElement) || target === document.body || target === document.documentElement ||
      target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),iframe,script,style')) return null;
    return target.innerText?.trim() ? target : null;
  }
  /** @param {Event} event */
  const picking = (event) => !host.hidden && mode === "pick" && !event.composedPath().includes(host);
  document.addEventListener("pointerdown", (event) => {
    if (!picking(event)) return;
    contact = { x: event.clientX, y: event.clientY, scrollX, scrollY, moved: !event.isPrimary || event.button !== 0 };
  }, { ...events, capture: true });
  document.addEventListener("pointermove", (event) => {
    if (!picking(event)) return;
    if (contact && Math.hypot(event.clientX - contact.x, event.clientY - contact.y) > 8) contact.moved = true;
    if (event.pointerType !== "mouse") return;
    const element = pickable(event.target);
    outline.hidden = !element;
    if (element) {
      const rect = element.getBoundingClientRect();
      Object.assign(outline.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
  }, { ...events, capture: true, passive: true });
  document.addEventListener("pointercancel", () => { if (contact) contact.moved = true; }, events);
  document.addEventListener("click", (event) => {
    if (!picking(event)) return;
    const element = pickable(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail !== 0 && contact && (contact.moved || Math.abs(scrollY - contact.scrollY) > 8 || Math.abs(scrollX - contact.scrollX) > 8)) return;
    const selection = getSelection();
    const value = selection?.anchorNode && element.contains(selection.anchorNode) && selection.toString().trim()
      ? selection.toString() : element.innerText;
    accept(value);
    contact = null;
  }, { ...events, capture: true });
  document.addEventListener("keydown", (event) => {
    if (!host.hidden && event.key === "Escape") { event.preventDefault(); hide(); }
  }, events);
  window.visualViewport?.addEventListener("resize", viewport, events);
  window.visualViewport?.addEventListener("scroll", viewport, events);
  window.addEventListener("resize", viewport, events);
  window.addEventListener("scroll", () => { outline.hidden = true; }, { ...events, passive: true });
  // The heading is a vertical handle; scrolling in the content remains a native gesture.
  title.tabIndex = 0;
  title.setAttribute("role", "button");
  title.setAttribute("aria-label", "表示位置を移動");
  title.title = "ドラッグで上下に移動。矢印キーでも移動できます（Endで元の位置）";
  /** @type {{id: number, y: number, lift: number} | null} */
  let drag = null;
  title.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, lift };
    title.setPointerCapture(event.pointerId);
    sheet.classList.add("dragging");
    event.preventDefault();
  }, events);
  title.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) setLift(drag.lift + drag.y - event.clientY);
  }, events);
  const endDrag = () => { drag = null; sheet.classList.remove("dragging"); };
  title.addEventListener("pointerup", endDrag, events);
  title.addEventListener("lostpointercapture", endDrag, events);
  title.addEventListener("pointercancel", endDrag, events);
  title.addEventListener("keydown", (event) => {
    const amount = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowUp") setLift(lift + amount);
    else if (event.key === "ArrowDown") setLift(lift - amount);
    else if (event.key === "Home") setLift(innerHeight);
    else if (event.key === "End") setLift(0);
    else return;
    event.preventDefault();
  }, events);
  sheet.addEventListener("transitionend", () => setLift(lift), events);
  async function show() {
    const operation = ++revision;
    if (document.activeElement !== host) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = false;
    paintTheme();
    viewport();
    notice("設定を読み込んでいます…");
    let failed = false;
    try { updatePreferences(await api.load()); } catch { failed = true; }
    if (operation !== revision) return;
    paintTheme();
    if (!scanned) await scan();
    else render();
    if (failed) notice("設定を読み込めなかったため標準設定を使います。", true);
    if (!host.hidden) close.focus({ preventScroll: true });
  }
  return {
    show, reset, updatePreferences,
    destroy() { reset(); lifecycle.abort(); highlight.destroy(); host.remove(); },
  };
}
