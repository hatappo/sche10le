import themeCss from "./theme.css?inline";
import sheetCss from "./safari-sheet.css?inline";
import { THEMES, applyTheme, resolveTheme } from "./themes.js";
import { extractStructuredEvents, extractTextEvents, mergeCandidates } from "./extract.js";
import { candidateOptions, calendarUrl, composeDetails } from "./calendar.js";
import { orderCandidates } from "./candidate-order.js";
import { dateRangeLabel, timeRange } from "./dates.js";
import { createDraft, pickField, skipField, FIELD_LABELS, PICK_FIELDS } from "./draft.js";
import { DEFAULT_TITLE_FORMAT, formatTitle, validateTitleFormat } from "./title-format.js";
import { createSourceHighlight } from "./source-highlight.js";
import { calendarFile } from "./ical.js";

/** The sheet owns page-local state; background/popup lifetimes do not own a draft.
 * @param {{load: () => Promise<Record<string, unknown>>, save: (values: Record<string, unknown>) => Promise<void>, openCalendar: (url: string) => Promise<void>}} api
 */
export function createSafariSheet(api) {
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
  heading.append(title, close);
  sheet.append(heading, status, content, controls, footer);
  shadow.append(style, outline, sheet);
  const highlight = createSourceHighlight();
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  /** @type {'list'|'pick'|'review'|'settings'} */
  let mode = "list";
  /** @type {import('./draft.js').Draft | null} */
  let draft = null;
  /** @type {import('./calendar.js').Variant | null} */
  let variant = null;
  /** @type {import('./extract.js').Candidate[]} */
  let candidates = [];
  let text = "";
  let scanned = false;
  let expanded = "";
  let complete = [false, false, false];
  let themeId = resolveTheme(undefined);
  let travelMinutes = 30;
  let titleFormat = DEFAULT_TITLE_FORMAT;
  /** @type {import('./candidate-order.js').CandidateOrder} */
  let order = "page";
  let revision = 0;
  let opening = false;
  /** @type {Promise<void> | undefined} */
  let loading;
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
  /** @param {string} text @param {boolean} [error] */
  function notice(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }
  function paintTheme() {
    applyTheme(host, themeId);
    highlight.setTheme(themeId);
  }
  /** @param {Record<string, unknown>} values */
  function save(values) {
    const operation = ++saveRevision;
    const report = (/** @type {string} */ text, error = false) => {
      if (operation === saveRevision && mode === "settings") notice(text, error);
    };
    report("保存しています…");
    // Serialize writes so rapid edits cannot restore an older preference.
    saves = saves.then(() => api.save(values)).then(
      () => report("自動保存しました"),
      () => report("設定を保存できませんでした。もう一度変更してお試しください。", true),
    );
  }
  function viewport() {
    const view = window.visualViewport;
    host.style.setProperty("--view-height", `${view?.height ?? innerHeight}px`);
    host.style.setProperty("--view-width", `${view?.width ?? innerWidth}px`);
    host.style.setProperty("--view-left", `${view?.offsetLeft ?? 0}px`);
    host.style.setProperty("--view-bottom", `${Math.max(0, innerHeight - (view?.height ?? innerHeight) - (view?.offsetTop ?? 0))}px`);
    outline.hidden = true;
  }
  function hide() {
    revision++;
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
    render();
  }
  function scan() {
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
    render();
  }
  /** @param {number} step */
  function startPicking(step) {
    if (!draft) return;
    draft = { ...draft, step };
    mode = "pick";
    contact = null;
    highlight.clear();
    render();
  }
  /** @param {boolean} skip @param {string} [value] */
  function accept(skip, value = "") {
    if (!draft) return;
    const step = draft.step;
    const next = skip ? skipField(draft) : pickField(draft, value);
    if (next === draft) return;
    draft = next;
    complete[step] = true;
    outline.hidden = true;
    mode = draft.step >= 3 ? "review" : "pick";
    render();
    if (mode === "review") footer.querySelector("button")?.focus({ preventScroll: true });
  }
  function render() {
    sheet.dataset.mode = mode;
    notice("");
    title.textContent = mode === "list" ? "日時を選ぶ" : mode === "settings" ? "設定" :
      mode === "pick" ? `${FIELD_LABELS[draft?.step ?? 0]}をページから選択` : "内容を確認";
    content.replaceChildren();
    controls.replaceChildren();
    footer.replaceChildren();
    outline.hidden = true;
    if (mode === "list") renderList();
    if (mode === "pick") renderPicker();
    if (mode === "review") renderReview();
    if (mode === "settings") renderSettings();
  }
  function renderList() {
    const options = candidateOptions(orderCandidates(candidates, order, text), travelMinutes);
    const toolbar = document.createElement("div");
    toolbar.className = "row";
    const count = document.createElement("span");
    count.textContent = `スキャン済み · ${options.length}件`;
    const sorting = select([["page", "登場順"], ["date", "日時順"]], order);
    sorting.setAttribute("aria-label", "日程の並び順");
    sorting.onchange = () => {
      order = sorting.value === "date" ? "date" : "page";
      save({ candidateOrder: order });
      render();
    };
    toolbar.append(count, sorting);
    content.append(toolbar);
    for (const option of options) {
      const card = document.createElement("article");
      card.className = "candidate";
      const label = `${dateRangeLabel(option.candidate.date, option.candidate.endDate ?? option.candidate.date)} ${option.candidate.start ? timeRange(option.candidate.start, option.candidate.end ?? option.candidate.start) : "終日"}`;
      const toggle = button(label, () => {
        expanded = expanded === option.candidate.id ? "" : option.candidate.id;
        if (expanded) highlight.reveal(option.candidate.locator);
        else highlight.clear();
        render();
        content.querySelector(`[data-id="${CSS.escape(option.candidate.id)}"]`)?.scrollIntoView({ block: "nearest" });
      }, "candidate-toggle");
      toggle.dataset.id = option.candidate.id;
      toggle.setAttribute("aria-expanded", String(expanded === option.candidate.id));
      card.append(toggle);
      if (expanded === option.candidate.id) {
        const variants = document.createElement("div");
        variants.className = "variants";
        for (const choice of option.variants) {
          variants.append(button(`${choice.label}${choice.start ? `  ${timeRange(choice.start, choice.end ?? choice.start)}` : ""}`, () => {
            variant = choice;
            draft = createDraft(document.title, location.href);
            startPicking(0);
          }, "variant"));
        }
        card.append(variants);
      }
      content.append(card);
    }
    if (!options.length) {
      const empty = document.createElement("p");
      empty.textContent = "このページでは日程が見つかりませんでした。";
      content.append(empty);
    }
    footer.className = "row";
    footer.append(button("再スキャン", scan, "text-button"), button("設定", () => {
      mode = "settings";
      highlight.clear();
      render();
    }, "text-button"));
  }
  function renderPicker() {
    if (!draft) return;
    const steps = document.createElement("div");
    steps.className = "steps";
    FIELD_LABELS.forEach((label, index) => {
      const step = button(`${index + 1} ${label}${complete[index] ? " ✓" : ""}`, () => startPicking(index));
      if (draft?.step === index) step.setAttribute("aria-current", "step");
      step.classList.toggle("done", complete[index]);
      steps.append(step);
    });
    const row = document.createElement("div");
    row.className = "row";
    const back = button("戻る", () => startPicking(Math.max(0, (draft?.step ?? 0) - 1)), "text-button");
    back.disabled = draft.step === 0;
    row.append(back, button("内容を確認", () => { mode = "review"; render(); }, "text-button"),
      button(draft.step === 2 ? "完了" : "スキップ", () => accept(true), "text-button"));
    controls.append(steps, row);
  }
  function renderReview() {
    if (!draft || !variant) return;
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = `${dateRangeLabel(variant.date, variant.endDate)} · ${variant.label}${variant.start ? ` ${timeRange(variant.start, variant.end ?? variant.start)}` : ""}`;
    content.append(summary);
    const currentDraft = draft;
    const currentVariant = variant;
    PICK_FIELDS.forEach((field, index) => {
      const row = button("", () => startPicking(index), "field");
      const label = document.createElement("span");
      label.className = "field-label";
      label.textContent = `${index + 1} ${FIELD_LABELS[index]}${complete[index] ? " ✓" : ""}`;
      const value = document.createElement("span");
      value.textContent = field === "title" ? formatTitle(titleFormat, currentDraft.title, currentVariant) :
        field === "details" ? composeDetails(currentDraft, currentVariant) : currentDraft[field] || "未設定";
      row.classList.toggle("done", complete[index]);
      row.append(label, value);
      content.append(row);
    });
    content.append(button("選び直す", () => {
      draft = null; variant = null; complete = [false, false, false]; expanded = "";
      mode = "list"; render();
    }, "text-button"));
    footer.className = "actions";
    const open = button("Googleカレンダーで開く ↗", () => void openCalendar(), "primary");
    open.disabled = opening;
    const download = button("↓", downloadCalendar, "download");
    download.setAttribute("aria-label", "予定をダウンロード（.ics）");
    footer.append(open, download);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "内容の取得は途中でもOK。保存はGoogleカレンダーで。";
    footer.append(hint);
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
      travelMinutes = value; save({ travelMinutes });
    };
    const format = document.createElement("input");
    format.value = titleFormat; format.maxLength = 200;
    format.onchange = () => {
      const value = format.value.trim();
      const error = validateTitleFormat(value);
      format.setAttribute("aria-invalid", String(Boolean(error)));
      if (error) { notice(error, true); return; }
      titleFormat = value; save({ titleFormat });
    };
    const themes = select(THEMES.map((theme) => [theme.id, `${theme.name}（${theme.reading}）`]), themeId);
    themes.onchange = () => { themeId = resolveTheme(themes.value); paintTheme(); save({ themeId }); };
    for (const [label, input] of /** @type {[string, HTMLElement][]} */ ([
      ["前後の移動時間（片道・分）", travel], ["タイトルの書式", format], ["カラーテーマ", themes],
    ])) {
      const field = document.createElement("label");
      field.textContent = label; field.append(input); content.append(field);
    }
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "変更は自動保存されます。書式の例：{from:HHmm} {title}";
    content.append(hint);
    footer.className = "row";
    footer.append(button("戻る", () => { mode = draft ? "review" : "list"; render(); }, "text-button"));
  }
  async function openCalendar() {
    if (!draft || !variant || opening) return;
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
      const action = footer.querySelector("button");
      if (action) action.disabled = false;
    }
  }
  function downloadCalendar() {
    if (!draft || !variant) return;
    const url = URL.createObjectURL(new Blob([calendarFile(variant, draft, titleFormat)], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `sche10le-${variant.date}.ics`;
    shadow.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
    accept(false, value);
    contact = null;
  }, { ...events, capture: true });
  document.addEventListener("keydown", (event) => {
    if (!host.hidden && event.key === "Escape") { event.preventDefault(); hide(); }
  }, events);
  window.visualViewport?.addEventListener("resize", viewport, events);
  window.visualViewport?.addEventListener("scroll", viewport, events);
  window.addEventListener("resize", viewport, events);
  window.addEventListener("scroll", () => { outline.hidden = true; }, { ...events, passive: true });
  async function show() {
    const operation = ++revision;
    if (document.activeElement !== host) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = false;
    paintTheme();
    viewport();
    notice("設定を読み込んでいます…");
    loading ??= api.load().then((saved) => {
      themeId = resolveTheme(saved.themeId);
      if (typeof saved.travelMinutes === "number" && Number.isInteger(saved.travelMinutes) && saved.travelMinutes >= 0 && saved.travelMinutes <= 180) travelMinutes = saved.travelMinutes;
      if (typeof saved.titleFormat === "string" && !validateTitleFormat(saved.titleFormat)) titleFormat = saved.titleFormat;
      order = saved.candidateOrder === "date" ? "date" : "page";
    });
    let failed = false;
    try { await loading; } catch { loading = undefined; failed = true; }
    if (operation !== revision) return;
    paintTheme();
    if (!scanned) scan();
    else render();
    if (failed) notice("設定を読み込めなかったため標準設定を使います。", true);
    close.focus({ preventScroll: true });
  }
  return {
    show, reset,
    destroy() { reset(); lifecycle.abort(); highlight.destroy(); host.remove(); },
  };
}
