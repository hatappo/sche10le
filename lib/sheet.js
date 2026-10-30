import themeCss from "./theme.css?inline";
import sheetCss from "./sheet.css?inline";
import { applyTheme, resolveTheme } from "./themes.js";
import { extractStructuredEvents, extractTextEvents, mergeCandidates } from "./extract.js";
import { candidateOptions, calendarUrl, composeDetails, registrationSummary } from "./calendar.js";
import { candidateMarker } from "./candidate-marker.js";
import { orderCandidates } from "./candidate-order.js";
import { dateRangeLabel, timeRange } from "./dates.js";
import { FIELD_LABELS, PICK_FIELDS } from "./draft.js";
import { DEFAULT_TITLE_FORMAT, formatTitle } from "./title-format.js";
import { createSourceHighlight } from "./source-highlight.js";
import { button, iconButton, select } from "./sheet-elements.js";
import { renderSheetSettings } from "./sheet-settings.js";
import { createSheetInteractions } from "./sheet-interactions.js";
import { createSheetState, transitionSheet } from "./sheet-state.js";
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
  const selectionAction = document.createElement("div");
  selectionAction.className = "selection-action";
  selectionAction.hidden = true;
  const selectionPreview = document.createElement("span");
  selectionPreview.id = "selection-preview";
  const selectionButton = button("この範囲を使う", () => {}, "selection-confirm");
  selectionButton.setAttribute("aria-describedby", selectionPreview.id);
  selectionAction.append(selectionPreview, selectionButton);
  const footer = document.createElement("footer");
  const outline = document.createElement("div");
  outline.className = "outline";
  outline.hidden = true;
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const settings = iconButton("設定", "M9 3h6l.6 3 2.4 1.4 2.9-1 3 5.2-2.3 2v2.8l2.3 2-3 5.2-2.9-1-2.4 1.4L15 27H9l-.6-3-2.4-1.4-2.9 1-3-5.2 2.3-2v-2.8l-2.3-2 3-5.2 2.9 1L8.4 6Z M16 15a4 4 0 1 0-8 0 4 4 0 0 0 8 0", () => {
    stopCue(); transition({ type: "settings" }); highlight.clear(); render();
  });
  // Use a compact, symmetric 24px gear inside the shared 44px hit target.
  settings.querySelector("svg")?.setAttribute("viewBox", "-2 0 28 30");
  const expand = iconButton("内容を確認", "m6 14 6-6 6 6 M6 20l6-6 6 6", () => { transition({ type: "review" }); render(); });
  const back = button("戻る", () => { transition({ type: "back" }); render(); }, "header-back");
  headerActions.append(expand, settings, back, close);
  heading.append(title, headerActions);
  sheet.append(heading, status, content, controls, selectionAction, footer);
  shadow.append(style, outline, sheet);
  const highlight = createSourceHighlight(() => sheet.getBoundingClientRect());
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let state = createSheetState();
  /** @param {import('./sheet-state.js').SheetAction} action */
  function transition(action) { interactions.clearSelection(); state = transitionSheet(state, action); }
  /** @type {ReturnType<typeof renderSheetSettings> | undefined} */
  let themeSelector;
  /** @type {import('./extract.js').Candidate[]} */
  let candidates = [];
  /** @type {Map<string, string>} */
  let candidateMarkers = new Map();
  let chosenMarker = "";
  let text = "";
  let scanned = false;
  let rendering = false;
  let scanning = false;
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
    themeSelector?.setValue(themeId);
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
    if (host.hidden || state.mode !== "review" || !state.complete.every(Boolean) || cues >= 3 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const action = footer.querySelector(".primary");
    action?.classList.remove("ready-cue");
    // A new class cycle only when the spaced cue actually runs, never on a general render.
    if (action instanceof HTMLElement) void action.offsetWidth;
    action?.classList.add("ready-cue");
    cues++;
    cueTimer = window.setTimeout(cue, 11_200);
  }
  function hide() {
    revision++;
    stopCue();
    interactions.stopDrag();
    clearTimeout(hoverTimer);
    host.hidden = true;
    outline.hidden = true;
    highlight.clear();
    transition({ type: "hide" });
    restoreFocus?.focus({ preventScroll: true });
  }
  function reset() {
    hide();
    transition({ type: "reset" });
    candidates = [];
    candidateMarkers.clear();
    chosenMarker = "";
    text = "";
    scanned = false;
    expanded = "";
    interactions.setLift(0);
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
    transition({ type: "reset" });
    expanded = "";
    // Our host is outside body, so neither this UI nor its displayed dates are scanned.
    text = (document.body?.innerText ?? "").slice(0, 100_000);
    const json = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .slice(0, 50).map((node) => (node.textContent ?? "").slice(0, 200_001));
    candidates = mergeCandidates(extractStructuredEvents(json), extractTextEvents(text));
    candidateMarkers = new Map(candidateOptions(orderCandidates(candidates, "page", text), travelMinutes)
      .map((option, index) => [option.candidate.id, candidateMarker(index)]));
    chosenMarker = "";
    highlight.clear();
    highlight.capture();
    scanned = true;
    scanning = false;
    render();
  }
  /** @param {number} step */
  function startPicking(step) {
    if (!state.draft) return;
    transition({ type: "pick", step });
    stopCue();
    interactions.resetContact();
    highlight.clear();
    render();
  }
  /** @param {string} value */
  function accept(value) {
    if (!state.draft) return;
    const step = state.draft.step;
    const previous = state;
    transition({ type: "accept", value });
    if (state === previous) return;
    shine = step;
    outline.hidden = true;
    render();
    if (state.mode === "review") {
      /** @type {HTMLButtonElement | null} */ (footer.querySelector(".primary"))?.focus({ preventScroll: true });
      cues = 0; cue();
    }
  }
  function render() {
    rendering = true;
    const changedMode = sheet.dataset.mode !== state.mode;
    const focused = shadow.activeElement;
    const replacingFocus = focused && (focused === back || [content, controls, footer, headerActions].some((region) => region.contains(focused)));
    const focusedLabel = focused?.getAttribute("aria-label") || focused?.textContent;
    sheet.dataset.mode = state.mode;
    settings.hidden = state.mode === "settings";
    expand.hidden = state.mode !== "pick";
    back.hidden = state.mode !== "settings";
    footer.hidden = state.mode !== "review";
    notice("");
    title.textContent = state.mode === "list" ? "日時を選ぶ" : state.mode === "settings" ? "設定" :
      state.mode === "pick" ? `${FIELD_LABELS[state.draft?.step ?? 0]}を選択` : "内容を確認";
    themeSelector = undefined;
    content.replaceChildren();
    controls.replaceChildren();
    footer.replaceChildren();
    outline.hidden = true;
    if (state.mode === "list") renderList();
    if (state.mode === "pick") renderPicker();
    if (state.mode === "review") renderReview();
    if (state.mode === "settings") renderSettings();
    if (saveFailed) saveFeedback();
    if (changedMode) content.scrollTop = 0;
    rendering = false;
    if (replacingFocus && !host.hidden) {
      const same = [...sheet.querySelectorAll("button")].find((node) =>
        !node.disabled && node.checkVisibility() && (node.getAttribute("aria-label") || node.textContent) === focusedLabel);
      const next = same ?? sheet.querySelector(state.mode === "settings" ? "input" : state.mode === "pick" ? '[aria-current="step"]' : state.mode === "review" ? ".primary" : "select");
      if (next instanceof HTMLElement && next.checkVisibility()) next.focus({ preventScroll: true });
      else close.focus({ preventScroll: true });
    }
    requestAnimationFrame(() => interactions.clamp());
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
        if (expanded) highlight.reveal(option.candidate.locator, candidateMarkers.get(option.candidate.id));
        else highlight.clear();
        render();
        content.querySelector(`[data-id="${CSS.escape(option.candidate.id)}"]`)?.scrollIntoView({ block: "nearest" });
      }, "candidate-toggle");
      toggle.prepend(marker(candidateMarkers.get(option.candidate.id) ?? ""), " ");
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
            chosenMarker = candidateMarkers.get(option.candidate.id) ?? "";
            transition({ type: "choose", variant: choice, title: document.title, url: location.href });
            interactions.setLift(0);
            cues = 0;
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
    transition({ type: "reset" }); expanded = ""; chosenMarker = "";
    render();
  }
  /** @param {string} value */
  function marker(value) {
    const badge = document.createElement("span");
    badge.className = "candidate-marker";
    badge.textContent = value;
    return badge;
  }
  function selectionSummary() {
    const summary = document.createElement("p");
    summary.className = "summary";
    if (state.variant) summary.textContent = `${dateRangeLabel(state.variant.date, state.variant.endDate)} · ${state.variant.label}${state.variant.start ? ` ${timeRange(state.variant.start, state.variant.end ?? state.variant.start)}` : ""}${state.variant.note ? `（${state.variant.note}）` : ""}`;
    if (chosenMarker) summary.prepend(marker(chosenMarker), " ");
    return summary;
  }
  function renderPicker() {
    if (!state.draft) return;
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
      name.textContent = `${index + 1} ${label}${state.complete[index] ? " ✓" : ""}`;
      const preview = document.createElement("span");
      preview.className = "step-value";
      const field = PICK_FIELDS[index];
      const value = fieldValue(field);
      step.title = value;
      preview.id = `preview-${field}`;
      step.setAttribute("aria-describedby", preview.id);
      if (field === "details" && value === state.draft?.url && value.length > 32) {
        preview.classList.add("url-preview");
        preview.setAttribute("aria-label", value);
        const start = document.createElement("span");
        start.className = "url-start"; start.textContent = value.slice(0, -8);
        const end = document.createElement("span");
        end.className = "url-end"; end.textContent = value.slice(-8);
        preview.append(start, end);
      } else preview.textContent = value;
      if (state.draft?.step === index) step.setAttribute("aria-current", "step");
      step.classList.toggle("done", state.complete[index]);
      name.classList.toggle("just-completed", shine === index);
      step.append(name, preview);
      steps.append(step);
    });
    controls.append(steps);
    shine = -1;
  }
  /** @param {'title'|'location'|'details'} field */
  function fieldValue(field) {
    if (!state.draft || !state.variant) return "未設定";
    if (field === "title") return formatTitle(titleFormat, state.draft.title, state.variant) || "未設定";
    if (field === "details") return composeDetails(state.draft, state.variant);
    return state.draft[field] || "未設定";
  }
  function renderReview() {
    if (!state.draft || !state.variant) return;
    const summaryRow = document.createElement("div");
    summaryRow.className = "row review-heading";
    summaryRow.append(selectionSummary(), button("選び直す", chooseAgain, "text-button"));
    content.append(summaryRow);
    PICK_FIELDS.forEach((field, index) => {
      const row = button("", () => startPicking(index), "field");
      const label = document.createElement("span");
      label.className = `field-label${shine === index ? " just-completed" : ""}`;
      label.textContent = `${index + 1} ${FIELD_LABELS[index]}${state.complete[index] ? " ✓" : ""}`;
      const value = document.createElement("span");
      value.textContent = fieldValue(field);
      row.classList.toggle("done", state.complete[index]);
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
  function renderSettings() {
    themeSelector = renderSheetSettings(content, {
      preferences, draft: state.draft, variant: state.variant, quote, notice,
      change(values) {
        if (values.travelMinutes !== undefined) travelMinutes = values.travelMinutes;
        if (values.titleFormat !== undefined) titleFormat = values.titleFormat;
        if (values.themeId !== undefined) { themeId = values.themeId; paintTheme(); }
        save();
      },
    });
  }
  async function openCalendar() {
    if (!state.draft || !state.variant || opening) return;
    stopCue();
    opening = true;
    const operation = revision;
    render();
    try {
      await api.openCalendar(calendarUrl(state.variant, state.draft, titleFormat));
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
    if (!state.draft || !state.variant) return;
    stopCue();
    try {
    const url = URL.createObjectURL(new Blob([calendarFile(state.variant, state.draft, titleFormat)], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `sche10le-${state.variant.date}.ics`;
    shadow.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { notice("予定をダウンロードできませんでした。もう一度お試しください。", true); }
  }
  const interactions = createSheetInteractions({
    host, sheet, title, outline, events, selectionButton,
    onSelection(value) {
      selectionAction.hidden = !value;
      sheet.classList.toggle("has-selection", Boolean(value));
      selectionPreview.textContent = value.length > 100 ? `${value.slice(0, 70)}…${value.slice(-20)}` : value;
      selectionPreview.title = value;
      requestAnimationFrame(() => interactions.clamp());
    },
    isPicking: () => !host.hidden && state.mode === "pick",
    accept,
  });
  document.addEventListener("keydown", (event) => {
    if (!host.hidden && event.key === "Escape") { event.preventDefault(); hide(); }
  }, events);
  async function show() {
    const operation = ++revision;
    if (document.activeElement !== host) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = false;
    paintTheme();
    interactions.viewport();
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
