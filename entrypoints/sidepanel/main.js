import "./style.css";
import {
  THEMES,
  DEFAULT_THEME,
  resolveTheme,
  applyTheme,
} from "../../lib/themes.js";
import {
  extractStructuredEvents,
  extractTextEvents,
  mergeCandidates,
} from "../../lib/extract.js";
import {
  calendarUrl,
  candidateOptions,
  registrationSummary,
} from "../../lib/calendar.js";
import { orderCandidates } from "../../lib/candidate-order.js";
import { pickFooterQuote } from "../../lib/footer-quotes.js";
import { calendarFile } from "../../lib/ical.js";
import { accessFailure, unsupportedPage } from "../../lib/page-access.js";
import {
  createDraft,
  FIELD_LABELS,
  PICK_FIELDS,
  pickField,
  previousField,
  skipField,
} from "../../lib/draft.js";
import { dateRangeLabel, timeRange } from "../../lib/dates.js";
import { aiAvailability, enhanceDates } from "../../lib/ai.js";
import {
  DEFAULT_TITLE_FORMAT,
  formatTitle,
  validateTitleFormat,
} from "../../lib/title-format.js";

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}
/** @param {string} id @returns {HTMLButtonElement} */
const button = (id) => /** @type {HTMLButtonElement} */ (el(id));
/** @param {string} id @returns {HTMLInputElement} */
const input = (id) => /** @type {HTMLInputElement} */ (el(id));
/** @param {string} tag @param {string} className @param {string} [text] */
function node(tag, className, text = "") {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

/** @type {import('../../lib/extract.js').Candidate[]} */
let candidates = [];
/** @type {import('../../lib/candidate-order.js').CandidateOrder} */
let candidateOrder = "page";
/** @type {import('../../lib/draft.js').Draft | null} */
let draft = null;
/** @type {import('../../lib/calendar.js').Variant | null} */
let selectedVariant = null;
let selectedId = "";
let selectionToken = "";
let paused = false;
let pageTitle = "";
let pageUrl = "";
let pageText = "";
/** @type {number | undefined} */
let sourceTabId;
/** @type {number | undefined} */
let windowId;
/** @type {chrome.runtime.Port | undefined} */
let port;
let generation = 0;
let scanning = false;
/** @type {"checking" | "blocked" | "unsupported" | "ready" | "scanning" | "complete" | "error"} */
let scanState = "checking";
let opening = false;
let scanTimer = 0;
let travelMinutes = 30;
let aiEnabled = false;
let titleFormat = DEFAULT_TITLE_FORMAT;
let themeId = DEFAULT_THEME;
let themeRevision = 0;
let pendingThemeSaves = 0;
const settingStates = {
  theme: {
    key: "themeId",
    status: "theme-status",
    retry: "retry-theme",
    revision: 0,
  },
  travel: {
    key: "travelMinutes",
    status: "settings-status",
    retry: "retry-travel",
    revision: 0,
  },
  format: {
    key: "titleFormat",
    status: "format-status",
    retry: "retry-format",
    revision: 0,
  },
  ai: {
    key: "aiEnabled",
    status: "ai-settings-status",
    retry: "retry-ai",
    revision: 0,
  },
  order: {
    key: "candidateOrder",
    status: "order-status",
    retry: "retry-order",
    revision: 0,
  },
};
let settingSave = Promise.resolve();
let panelScroll = 0;
let sourceTimer = 0;
let revealedId = "";
/** @type {AbortController | undefined} */
let aiController;
let aiRevision = 0;
let settingsReturnTarget = "settings-toggle";

/** @param {string} text @param {boolean} [error] */
function notice(text, error = false) {
  el("notice").textContent = text;
  el("notice").classList.toggle("error", error);
}

/** @param {string} label @param {string} [title] */
function showSource(label, title = "") {
  el("source-domain").textContent = label;
  el("source-domain").title = title;
}

/** @param {Element | null} label @param {boolean} complete @param {boolean} wasComplete */
function updateCompletionEffect(label, complete, wasComplete) {
  if (!complete) label?.classList.remove("is-completing");
  else if (
    !wasComplete &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    label?.classList.add("is-completing");
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let calendarCueTimer;
let calendarCueRepeats = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function stopCalendarCue() {
  clearTimeout(calendarCueTimer);
  calendarCueTimer = undefined;
  calendarCueRepeats = 0;
  button("open-calendar").classList.remove("calendar-ready", "calendar-repeat");
}

function startCalendarCue() {
  stopCalendarCue();
  if (reducedMotion.matches) return;
  calendarCueRepeats = 2;
  button("open-calendar").classList.add("calendar-ready");
}

/** Reflect the existing workflow without introducing another progress state. */
function renderSectionProgress() {
  /** @type {Array<[string, 'active' | 'complete' | 'waiting']>} */
  const sections = [
    ["scan-title", scanState === "complete" ? "complete" : "active"],
    [
      "candidates-title",
      draft ? "complete" : scanState === "complete" ? "active" : "waiting",
    ],
    [
      "content-title",
      draft ? (draft.step >= 3 ? "complete" : "active") : "waiting",
    ],
  ];
  for (const [id, state] of sections) {
    const heading = el(id);
    if (id === "content-title") {
      const complete = state === "complete";
      if (!complete) stopCalendarCue();
      else if (heading.dataset.state !== "complete") startCalendarCue();
      el("calendar-hint").textContent = complete
        ? "Google カレンダーで修正してから保存できます。"
        : "情報の取得は途中でもOK。保存は Google カレンダーで。";
    }
    updateCompletionEffect(
      heading.querySelector(".stage-label"),
      state === "complete",
      !heading.dataset.state || heading.dataset.state === "complete",
    );
    heading.dataset.state = state;
    if (state === "active") heading.setAttribute("aria-current", "step");
    else heading.removeAttribute("aria-current");
    const status = heading.querySelector("[data-stage-status]");
    if (status)
      status.textContent =
        state === "complete" ? "：完了" : state === "active" ? "：操作中" : "";
  }
}

/** @param {typeof scanState} state
 * @param {boolean} [repeat]
 */
function setScanState(state, repeat = false) {
  scanState = state;
  const labels = {
    checking: "確認中",
    blocked: "待機中",
    unsupported: "対象外",
    ready: "未スキャン",
    scanning: "スキャン中",
    complete: "スキャン完了",
    error: "スキャンできませんでした",
  };
  const label =
    state === "complete"
      ? "再スキャン"
      : state === "error"
        ? "再試行"
        : state === "scanning"
          ? "スキャン中…"
          : "スキャン";
  const control = button("rescan");
  control.classList.toggle("rescan-link", state === "complete" || repeat);
  control.setAttribute("aria-busy", String(state === "scanning"));
  el("scan-spinner").hidden = state !== "scanning";
  control.hidden = ["checking", "blocked", "unsupported"].includes(state);
  control.disabled = control.hidden || state === "scanning";
  control.setAttribute("aria-label", label);
  control.title = label;
  el("rescan-label").textContent = label;
  el("scan-state").textContent = labels[state];
  el("scan-state").classList.toggle("busy", state === "scanning");
  el("scan-state").classList.toggle("sr-only", state === "complete");
  el("scan-result").hidden = state !== "complete";
  el("source-section").hidden = state === "blocked";
  el("results-controls").hidden = state !== "complete";
  el("access-guide").hidden = state !== "blocked";
  el("empty").hidden = state !== "complete" || candidates.length > 0;
  renderSectionProgress();
}

/** Check access without reading page content or adding a content script.
 * @param {number} run
 */
async function checkAccess(run) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (run !== generation) return;
    if (!tab?.id) throw new Error("ページがありません");
    sourceTabId = tab.id;
    windowId = tab.windowId;
    if (unsupportedPage(tab.url)) {
      setScanState("unsupported");
      showSource("スキャン対象外のページ");
      notice(
        "このページではスキャンできません。日程のあるWebページを開いてください。",
      );
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => true,
    });
    if (run !== generation) return;
    showSource(tab.url ? new URL(tab.url).hostname : "現在のページ");
    if (!scanning) setScanState("ready");
    notice("");
    return tab;
  } catch (error) {
    if (run === generation) scanFailed(error);
  }
}

/** @param {object} message */
function send(message) {
  try {
    port?.postMessage(message);
  } catch {
    port = undefined;
    paused = true;
    renderDraft();
  }
}

function stopConnection() {
  clearSource();
  generation++;
  aiController?.abort();
  aiRevision++;
  el("ai-spinner").hidden = true;
  clearTimeout(scanTimer);
  scanning = false;
  const previous = port;
  port = undefined;
  previous?.disconnect();
}

function resetSelection() {
  clearSource();
  send({ type: "stop" });
  draft = null;
  selectedVariant = null;
  selectedId = "";
  selectionToken = "";
  document.body.classList.remove("is-selected");
  el("selection").hidden = true;
  el("open-area").hidden = true;
  renderSectionProgress();
}

function pageChanged() {
  stopConnection();
  resetSelection();
  candidates = [];
  pageText = "";
  pageUrl = "";
  sourceTabId = undefined;
  setScanState("checking");
  showSource("ページを確認中");
  el("ai-area").hidden = true;
  renderCandidates();
  notice("");
  void checkAccess(generation);
}

async function scan() {
  if (scanning) return;
  const repeat = scanState === "complete";
  stopConnection();
  resetSelection();
  const run = generation;
  scanning = true;
  setScanState("scanning", repeat);
  showSource("ページを確認中");
  candidates = [];
  pageUrl = "";
  pageText = "";
  renderCandidates();
  el("empty").hidden = true;
  el("ai-area").hidden = true;
  notice("");
  try {
    const tab = await checkAccess(run);
    if (run !== generation) return;
    if (!tab?.id) {
      scanning = false;
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/content-scripts/page.js"],
    });
    if (run !== generation) return;
    const connection = chrome.tabs.connect(tab.id, {
      name: "sche10le",
      frameId: 0,
    });
    port = connection;
    connection.onMessage.addListener((message) => {
      if (run === generation) receive(message, run);
    });
    connection.onDisconnect.addListener(() => {
      if (port !== connection) return;
      port = undefined;
      if (scanning) scanFailed();
      else pageChanged();
    });
    scanTimer = window.setTimeout(() => {
      if (scanning && run === generation) scanFailed();
    }, 8000);
    connection.postMessage({ type: "theme", id: themeId });
    connection.postMessage({ type: "scan" });
  } catch (error) {
    if (run === generation) scanFailed(error);
  }
}

/** @param {unknown} [error] */
function scanFailed(error) {
  stopConnection();
  pageUrl = "";
  pageText = "";
  candidates = [];
  const state = accessFailure(error);
  setScanState(state);
  showSource(
    state === "unsupported" ? "スキャン対象外のページ" : "現在のページ",
  );
  renderCandidates();
  notice(
    state === "blocked"
      ? ""
      : state === "unsupported"
        ? "このページではスキャンできません。日程のあるWebページを開いてください。"
        : "ページとの接続を確認できませんでした。読み込みが終わってから再試行してください。",
    state === "error",
  );
}

/** @param {Record<string, any>} message @param {number} run */
function receive(message, run) {
  if (message.type === "snapshot") {
    clearTimeout(scanTimer);
    scanning = false;
    if (
      typeof message.text !== "string" ||
      typeof message.url !== "string" ||
      !/^https?:\/\//.test(message.url)
    ) {
      scanFailed();
      return;
    }
    pageTitle = String(message.title ?? "").slice(0, 500);
    pageUrl = message.url;
    pageText = message.text.slice(0, 100_000);
    const json = Array.isArray(message.json)
      ? message.json.filter(
          (/** @type {unknown} */ value) => typeof value === "string",
        )
      : [];
    candidates = mergeCandidates(
      extractStructuredEvents(json),
      extractTextEvents(pageText),
    );
    showSource(new URL(pageUrl).hostname, pageTitle || "タイトルのないページ");
    setScanState("complete");
    notice("");
    renderCandidates();
    void prepareAI(run);
    return;
  }
  if (message.type === "page-changed") {
    pageChanged();
    return;
  }
  if (!draft || message.token !== selectionToken || message.step !== draft.step)
    return;
  if (message.type === "picked" && typeof message.text === "string") {
    const pickedStep = draft.step;
    draft = pickField(draft, message.text);
    syncPicker();
    if (draft.step !== pickedStep) scrollToPickedField(pickedStep);
  } else if (message.type === "skip") advance();
  else if (message.type === "choose-field") chooseField(message.fieldIndex);
  else if (message.type === "back") back();
  else if (message.type === "open") void openCalendar();
  else if (message.type === "pause") pausePicking();
}

function visibleOptions() {
  return candidateOptions(
    orderCandidates(candidates, candidateOrder, pageText),
    travelMinutes,
  );
}

/** @param {boolean} [neutral] */
function renderCandidates(neutral = false) {
  const options = visibleOptions();
  el("count").textContent = String(options.length);
  el("empty").hidden = candidates.length > 0 || scanState !== "complete";
  const fragment = document.createDocumentFragment();
  for (const { candidate, variants } of options)
    fragment.append(candidateCard(candidate, variants, neutral));
  el("candidates").replaceChildren(fragment);
  updateOrderControl(options.length);
}

/** @param {number} count */
function updateOrderControl(count) {
  /** @type {HTMLSelectElement} */ (el("candidate-order")).disabled =
    scanning || count < 2;
}

/** Reconcile AI additions in the chosen order, preserving surviving cards and focus.
 * @param {ReturnType<typeof visibleOptions>} options
 */
function reconcileCandidates(options) {
  const list = el("candidates");
  const focused = document.activeElement;
  const hadFocus = list.contains(focused);
  const cards = new Map(
    [...list.querySelectorAll("article")].map((card) => [
      card.dataset.candidateId,
      card,
    ]),
  );
  const visibleIds = new Set(options.map(({ candidate }) => candidate.id));
  for (const [id, card] of cards) {
    if (visibleIds.has(id ?? "")) continue;
    if (id === revealedId) clearSource();
    card.remove();
  }
  options.forEach(({ candidate, variants }, index) => {
    const card = cards.get(candidate.id) ?? candidateCard(candidate, variants);
    const next = list.children[index] ?? null;
    if (next !== card) list.insertBefore(card, next);
  });
  if (
    hadFocus &&
    focused instanceof HTMLElement &&
    document.activeElement !== focused
  ) {
    if (focused.isConnected) focused.focus({ preventScroll: true });
    else
      /** @type {HTMLElement | null} */ (
        list.querySelector(".candidate-heading")
      )?.focus({ preventScroll: true });
  }
  el("count").textContent = String(options.length);
  el("empty").hidden = options.length > 0;
  updateOrderControl(options.length);
}

/** @param {import('../../lib/extract.js').Candidate} candidate */
function revealSource(candidate) {
  if (draft || revealedId === candidate.id) return;
  clearSource();
  revealedId = candidate.id;
  const run = generation;
  sourceTimer = window.setTimeout(() => {
    if (!draft && run === generation)
      send({ type: "reveal-source", locator: candidate.locator });
  }, 180);
}

function clearSource() {
  clearTimeout(sourceTimer);
  revealedId = "";
  send({ type: "clear-source" });
}

/** @param {import('../../lib/extract.js').Candidate} candidate @param {import('../../lib/calendar.js').Variant[]} variants @param {boolean} [waitForMovement] */
function candidateCard(candidate, variants, waitForMovement = false) {
  const card = node(
    "article",
    `candidate${candidate.id === selectedId ? " selected" : ""}`,
  );
  card.dataset.candidateId = candidate.id;
  const heading = document.createElement("div");
  heading.tabIndex = 0;
  heading.setAttribute("role", "group");
  heading.className = "candidate-heading";
  const badge = node("span", "date-badge");
  badge.setAttribute("aria-hidden", "true");
  badge.append(
    node("span", "month", `${Number(candidate.date.slice(5, 7))}月`),
    node("span", "day", String(Number(candidate.date.slice(8)))),
  );
  const content = node("span", "date-content");
  const dateText = dateRangeLabel(candidate.date, candidate.endDate);
  const timeText =
    candidate.start && candidate.end
      ? timeRange(candidate.start, candidate.end)
      : "終日";
  content.append(
    node("strong", "", dateText),
    node("span", "candidate-time", timeText),
  );
  const sourceDescription =
    candidate.source === "structured"
      ? "ページの構造化データから自動抽出"
      : candidate.source === "ai"
        ? "ローカルAIによる補完。内容をご確認ください"
        : "ページ本文の日付を自動抽出";
  heading.setAttribute(
    "aria-label",
    `${dateText} ${timeText}。${sourceDescription}`,
  );
  content.title = `${sourceDescription}\n${candidate.evidence}`;
  content.append(node("span", "sr-only", sourceDescription));
  if (candidate.source === "ai" || candidate.inferredYear) {
    const evidence = node("span", "candidate-source");
    if (candidate.source === "ai") {
      const sourceTag = node("span", "source-tag is-ai", "AI");
      sourceTag.setAttribute("aria-hidden", "true");
      evidence.append(sourceTag);
    }
    if (candidate.inferredYear)
      evidence.append(
        node(
          "span",
          "candidate-year",
          `${candidate.date.slice(0, 4)}年として解釈`,
        ),
      );
    content.append(evidence);
  }
  heading.append(badge, content, node("span", "candidate-arrow", "›"));
  const region = node("div", "variant-region");
  region.inert = true;
  const inner = node("div", "variant-inner");
  const list = node("div", "variant-list");
  for (const variant of variants) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "variant";
    const time =
      variant.start && variant.end
        ? timeRange(variant.start, variant.end)
        : "終日";
    option.append(
      node("span", "variant-label", variant.label),
      node("span", "variant-time", time),
      node("span", "variant-arrow", "↗"),
    );
    option.addEventListener("click", () => selectCandidate(candidate, variant));
    list.append(option);
  }
  if (candidate.assumedEnd)
    list.append(
      node(
        "p",
        "variant-note",
        "終了時刻は仮に1時間後。カレンダーで変更できます。",
      ),
    );
  inner.append(list);
  region.append(inner);
  card.append(heading, region);
  const hasKeyboardFocus = () =>
    card.contains(document.activeElement) &&
    document.activeElement?.matches(":focus-visible");
  const expand = (/** @type {boolean} */ expanded) => {
    // Picking fields has its own screen; pointer movement must not reopen variants.
    expanded = expanded && !draft;
    card.classList.toggle("expanded", expanded);
    region.inert = !expanded;
  };
  card.addEventListener("pointerenter", (event) => {
    if (waitForMovement || event.pointerType === "touch") return;
    expand(true);
    revealSource(candidate);
  });
  card.addEventListener("pointermove", (event) => {
    // A rebuilt list can appear beneath a stationary pointer. Resume only on
    // actual movement, while focus remains available immediately.
    if (
      event.pointerType === "touch" ||
      !waitForMovement ||
      (!event.movementX && !event.movementY)
    )
      return;
    waitForMovement = false;
    expand(true);
    revealSource(candidate);
  });
  card.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch" || hasKeyboardFocus()) return;
    expand(false);
    if (revealedId === candidate.id) clearSource();
  });
  card.addEventListener("focusin", () => {
    expand(true);
    revealSource(candidate);
  });
  card.addEventListener("focusout", (event) => {
    // activeElement may briefly be body between blur and focus. Use the intended
    // destination so options never become inert while Tab is entering them.
    const next =
      event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!card.contains(next) && !card.matches(":hover")) expand(false);
    if (
      !card.contains(next) &&
      !card.matches(":hover") &&
      revealedId === candidate.id
    )
      clearSource();
  });
  return card;
}

/** @param {import('../../lib/extract.js').Candidate} candidate @param {import('../../lib/calendar.js').Variant} variant */
function selectCandidate(candidate, variant) {
  clearSource();
  selectedId = candidate.id;
  selectedVariant = variant;
  draft = createDraft(pageTitle, pageUrl);
  selectionToken = crypto.randomUUID();
  paused = false;
  for (const card of el("candidates").children) {
    const chosen =
      /** @type {HTMLElement} */ (card).dataset.candidateId === selectedId;
    card.classList.toggle("selected", chosen);
    card.classList.remove("expanded");
    card.querySelector(".registration-summary")?.remove();
    if (chosen)
      card.append(
        node(
          "p",
          "registration-summary",
          registrationSummary(variant, candidate),
        ),
      );
    const heading = /** @type {HTMLElement | null} */ (
      card.querySelector(".candidate-heading")
    );
    if (heading) heading.tabIndex = -1;
    const region = /** @type {HTMLElement | null} */ (
      card.querySelector(".variant-region")
    );
    if (region) region.inert = true;
  }
  document.body.classList.add("is-selected");
  el("selection").hidden = false;
  el("open-area").hidden = false;
  syncPicker(true);
  button("open-calendar").focus({ preventScroll: true });
}

function renderDraft() {
  renderSectionProgress();
  if (!draft) return;
  const complete = draft.step >= 3;
  PICK_FIELDS.forEach((field, index) => {
    const row = el(`field-${field}`);
    const active = !paused && index === draft?.step;
    const done = index < (draft?.step ?? 0);
    updateCompletionEffect(
      row.querySelector(".field-label"),
      done,
      row.dataset.complete === "true",
    );
    row.dataset.complete = String(done);
    row.querySelector(".field-check")?.toggleAttribute("hidden", !done);
    el(`field-${field}-completion`).textContent = done ? "設定済み" : "";
    if (active) row.setAttribute("aria-current", "step");
    else row.removeAttribute("aria-current");
  });
  el("pick-status").textContent = complete
    ? "カレンダーへ進めます"
    : paused
      ? "ページからの取得を中断しました"
      : `ページ上の${FIELD_LABELS[draft.step]}をクリック`;
  button("resume").hidden = !paused || complete;
  el("picked-title").textContent =
    (selectedVariant
      ? formatTitle(titleFormat, draft.title, selectedVariant)
      : draft.title) || "未設定";
  el("picked-location").textContent = draft.location || "未設定";
  el("picked-location").classList.toggle("is-empty", !draft.location);
  el("picked-details").textContent = draft.details
    ? `${draft.details}\n\n${draft.url}`
    : draft.url;
  updateFormatPreview();
}

/** @param {number} index */
function chooseField(index) {
  if (!draft || !Number.isInteger(index) || index < 0 || index > 2) return;
  draft = { ...draft, step: index };
  syncPicker();
}

/** @param {number} index */
function scrollToPickedField(index) {
  const row = el(`field-${PICK_FIELDS[index]}`);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({
    block: "nearest",
    behavior: reduced ? "instant" : "smooth",
  });
}

function syncPicker(resetPosition = false) {
  if (!draft) return;
  paused = false;
  // Rotate the token after every step so delayed clicks cannot advance twice.
  selectionToken = crypto.randomUUID();
  send(
    draft.step >= PICK_FIELDS.length
      ? { type: "stop" }
      : {
          type: "pick",
          step: draft.step,
          token: selectionToken,
          resetPosition,
        },
  );
  renderDraft();
}
function advance() {
  if (draft) {
    draft = skipField(draft);
    syncPicker();
  }
}
function back() {
  if (draft) {
    draft = previousField(draft);
    syncPicker();
  }
}
function pausePicking() {
  paused = true;
  send({ type: "stop" });
  renderDraft();
}

async function openCalendar() {
  if (!draft || !selectedVariant || opening) return;
  stopCalendarCue();
  opening = true;
  button("open-calendar").disabled = true;
  const url = calendarUrl(selectedVariant, draft, titleFormat);
  send({ type: "stop" });
  try {
    await chrome.tabs.create({ url });
  } catch {
    notice("カレンダーを開けませんでした。もう一度お試しください。", true);
    pausePicking();
  } finally {
    opening = false;
    button("open-calendar").disabled = false;
  }
}

function downloadCalendar() {
  if (!draft || !selectedVariant) return;
  stopCalendarCue();
  const errorMessage =
    "予定ファイルを作成できませんでした。もう一度お試しください。";
  try {
    const file = new Blob([calendarFile(selectedVariant, draft, titleFormat)], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sche10le-${selectedVariant.date}.ics`;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
      if (el("notice").textContent === errorMessage) notice("");
    } finally {
      link.remove();
      // Let the browser consume the Blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  } catch {
    notice(errorMessage, true);
  }
}

/** Keep the settings link stable while status changes, including keyboard focus.
 * @param {string} prefix @param {string} message @param {boolean} [busy]
 */
function showAIStatus(prefix, message, busy = false) {
  el("ai-spinner").hidden = !busy;
  el("ai-settings-link").textContent = prefix;
  el("ai-message").textContent = message;
}

/** @param {number} run */
async function prepareAI(run) {
  if (!aiEnabled) return;
  const revision = ++aiRevision;
  const status = await aiAvailability(window.LanguageModel);
  if (run !== generation || !aiEnabled || revision !== aiRevision) return;
  el("ai-area").hidden = false;
  el("ai-download").hidden = status !== "downloadable";
  el("ai-download").textContent = "AIを準備する";
  if (status === "available") {
    await runAI(run);
    return;
  }
  if (status === "downloadable")
    showAIStatus("AIを使うには", "モデルのダウンロードが必要です。");
  else if (status === "downloading")
    showAIStatus("AIモデル", "を準備中です。通常の抽出は利用できます。", true);
  else
    showAIStatus(
      "AI補完",
      "はこの環境では利用できません。通常の抽出を利用します。",
    );
}

/** @param {number} run */
async function runAI(run) {
  if (!window.LanguageModel || !pageText || !aiEnabled) return;
  const revision = ++aiRevision;
  aiController?.abort();
  const controller = new AbortController();
  aiController = controller;
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  el("ai-area").hidden = false;
  el("ai-download").hidden = true;
  showAIStatus(
    "AIで日程を補完",
    "しています。表示されている候補は選べます。",
    true,
  );
  try {
    const additions = await enhanceDates(
      window.LanguageModel,
      pageText,
      controller.signal,
    );
    if (
      run !== generation ||
      !aiEnabled ||
      controller.signal.aborted ||
      aiController !== controller ||
      revision !== aiRevision
    )
      return;
    candidates = mergeCandidates(candidates, additions);
    // Keep the selected card and draft stable until the user returns to the list.
    if (!draft) reconcileCandidates(visibleOptions());
    showAIStatus("AIの補完", "が完了しました。");
  } catch {
    if (
      run === generation &&
      aiEnabled &&
      aiController === controller &&
      revision === aiRevision
    ) {
      showAIStatus(
        "AIの補完",
        "はできませんでした。通常の抽出を利用できます。",
      );
      el("ai-download").hidden = false;
      el("ai-download").textContent = "もう一度試す";
    }
  } finally {
    clearTimeout(timeout);
    if (aiController === controller && revision === aiRevision)
      el("ai-spinner").hidden = true;
  }
}

for (const label of document.querySelectorAll(".stage-label, .field-label")) {
  label.addEventListener("animationend", () => {
    label.classList.remove("is-completing");
  });
  label.addEventListener("animationcancel", () => {
    label.classList.remove("is-completing");
  });
}
button("rescan").addEventListener("click", () => void scan());
el("candidate-order").addEventListener("change", (event) => {
  const value = /** @type {HTMLSelectElement} */ (event.target).value;
  candidateOrder = value === "date" ? "date" : "page";
  clearSource();
  if (!draft) renderCandidates();
  saveSetting("order", candidateOrder);
});
button("open-calendar").addEventListener("animationend", (event) => {
  if (event.animationName !== "calendar-ready-glow") return;
  button("open-calendar").classList.remove("calendar-ready");
  if (calendarCueRepeats === 0) return;
  calendarCueTimer = setTimeout(() => {
    calendarCueTimer = undefined;
    if (reducedMotion.matches) {
      stopCalendarCue();
      return;
    }
    calendarCueRepeats -= 1;
    button("open-calendar").classList.add("calendar-ready", "calendar-repeat");
  }, 10_000);
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) stopCalendarCue();
});
button("open-calendar").addEventListener("click", () => void openCalendar());
button("download-calendar").addEventListener("click", downloadCalendar);
button("resume").addEventListener("click", () => syncPicker());
document
  .querySelector(".picked-values")
  ?.querySelectorAll("button")
  .forEach((control) => {
    control.addEventListener("click", () =>
      chooseField(Number(control.dataset.step)),
    );
  });
button("deselect").addEventListener("click", () => {
  resetSelection();
  renderCandidates(true);
  el("candidates-title").focus();
});
button("ai-download").addEventListener("click", () => void runAI(generation));
function toggleSettings() {
  const settings = el("settings");
  if (settings.hidden) {
    stopCalendarCue();
    panelScroll = window.scrollY;
    settingsReturnTarget = "settings-toggle";
  }
  settings.hidden = !settings.hidden;
  document.body.classList.toggle("settings-open", !settings.hidden);
  clearSource();
  button("settings-toggle").setAttribute(
    "aria-expanded",
    String(!settings.hidden),
  );
  window.scrollTo({
    top: settings.hidden ? panelScroll : 0,
    behavior: "instant",
  });
  if (!settings.hidden) input("travel").focus({ preventScroll: true });
  else
    button(
      settingsReturnTarget === "ai-settings-link" && !el("ai-area").hidden
        ? "ai-settings-link"
        : "settings-toggle",
    ).focus({ preventScroll: true });
  updateFormatPreview();
}

function updateFormatPreview() {
  const template = input("title-format").value;
  const error = validateTitleFormat(template);
  input("title-format").setAttribute("aria-invalid", String(Boolean(error)));
  el("format-preview").parentElement?.classList.toggle("error", Boolean(error));
  if (error) {
    el("format-preview-label").textContent = "書式エラー・適用できません";
    el("format-preview").textContent = error;
    return;
  }
  const sample = selectedVariant ?? {
    kind: /** @type {const} */ ("exact"),
    label: "例",
    date: "2026-11-08",
    endDate: "2026-11-08",
    start: new Date(2026, 10, 8, 17, 30).toISOString(),
    end: new Date(2026, 10, 8, 19).toISOString(),
  };
  el("format-preview-label").textContent = selectedVariant
    ? "選択中の予定"
    : "プレビュー（例）";
  el("format-preview").textContent = formatTitle(
    template,
    draft?.title || "勉強会",
    sample,
  );
}
/** @param {keyof typeof settingStates} name @param {string} text @param {boolean} [error] @param {boolean} [retry] */
function settingMessage(name, text, error = false, retry = false) {
  const state = settingStates[name];
  el(state.status).textContent = text;
  el(state.status).classList.toggle("error", error);
  button(state.retry).hidden = !retry;
  // Keep the compact list toolbar quiet unless persistence needs attention.
  if (name === "order") el("order-feedback").hidden = !error;
}

/** All settings apply immediately and use the same ordered persistence and feedback.
 * @param {keyof typeof settingStates} name @param {string | number | boolean} value
 */
function saveSetting(name, value) {
  const state = settingStates[name];
  const revision = ++state.revision;
  settingMessage(name, "保存中…");
  settingSave = settingSave.then(async () => {
    try {
      await chrome.storage.local.set({ [state.key]: value });
      if (revision === state.revision) settingMessage(name, "自動保存しました");
    } catch {
      if (revision === state.revision)
        settingMessage(
          name,
          "変更は反映済みですが、保存できませんでした。",
          true,
          true,
        );
    }
  });
  return settingSave;
}

/** @param {unknown} value */
function setTheme(value) {
  themeRevision++;
  themeId = resolveTheme(value);
  applyTheme(document.documentElement, themeId);
  for (const theme of THEMES)
    input(`theme-${theme.id}`).checked = theme.id === themeId;
  try {
    port?.postMessage({ type: "theme", id: themeId });
  } catch {
    // A closing page must not stop local settings from applying or saving.
  }
}

function saveTheme() {
  pendingThemeSaves++;
  void saveSetting("theme", themeId).finally(() => pendingThemeSaves--);
}

function renderThemes() {
  for (const theme of THEMES) {
    const choice = document.createElement("label");
    choice.className = "theme-choice";
    choice.htmlFor = `theme-${theme.id}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "theme";
    radio.id = choice.htmlFor;
    radio.value = theme.id;
    radio.className = "theme-radio sr-only";
    radio.setAttribute(
      "aria-label",
      `${theme.name}（${theme.reading}）${theme.note ? `・${theme.note}` : ""}`,
    );
    radio.checked = theme.id === themeId;
    const option = node("span", "theme-option");
    const preview = node("span", "theme-swatch");
    preview.dataset.themePreview = theme.id;
    preview.setAttribute("aria-hidden", "true");
    preview.append(node("i", ""), node("i", ""), node("i", ""));
    const heading = node("span", "theme-name", theme.name);
    const check = node("span", "theme-check", "✓");
    check.setAttribute("aria-hidden", "true");
    heading.append(check);
    const reading = node("span", "theme-reading", theme.reading);
    if (theme.note) reading.append(node("span", "theme-note", theme.note));
    option.append(preview, heading, reading);
    choice.append(radio, option);
    el("theme-options").append(choice);
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      setTheme(radio.value);
      saveTheme();
    });
  }
}
renderThemes();
button("retry-theme").addEventListener("click", saveTheme);
chrome.storage.onChanged.addListener((changes, area) => {
  // Ignore intermediate writes from our ordered save queue during rapid switching.
  if (area === "local" && changes.themeId && pendingThemeSaves === 0)
    setTheme(changes.themeId.newValue);
});

function applyTitleFormat() {
  const template = input("title-format").value.trim();
  const error = validateTitleFormat(template);
  updateFormatPreview();
  if (error) {
    settingStates.format.revision++;
    settingMessage(
      "format",
      "入力した書式は適用・保存されません。最後に適用できた書式を使います。",
      true,
    );
    return;
  }
  titleFormat = template;
  renderDraft();
  saveSetting("format", template);
}
input("title-format").addEventListener("input", applyTitleFormat);
el("format-tokens")
  .querySelectorAll("button")
  .forEach((control) => {
    control.addEventListener("click", () => {
      const field = input("title-format");
      const position = field.selectionStart ?? field.value.length;
      field.setRangeText(
        control.dataset.token ?? "",
        position,
        field.selectionEnd ?? position,
        "end",
      );
      field.focus();
      applyTitleFormat();
    });
  });
button("reset-title-format").addEventListener("click", () => {
  input("title-format").value = DEFAULT_TITLE_FORMAT;
  applyTitleFormat();
});
function applyTravel() {
  const minutes = input("travel").valueAsNumber;
  const invalid = !Number.isInteger(minutes) || minutes < 0 || minutes > 180;
  input("travel").setAttribute("aria-invalid", String(invalid));
  if (invalid) {
    settingStates.travel.revision++;
    settingMessage(
      "travel",
      "0〜180分の整数を入力してください。直前の設定を維持します。",
      true,
    );
    return;
  }
  travelMinutes = minutes;
  if (!draft) {
    clearSource();
    renderCandidates();
  }
  saveSetting("travel", minutes);
}
function applyAI() {
  aiEnabled = input("ai-enabled").checked;
  aiController?.abort();
  aiRevision++;
  el("ai-spinner").hidden = true;
  if (aiEnabled && pageText) void prepareAI(generation);
  else el("ai-area").hidden = true;
  saveSetting("ai", aiEnabled);
}
button("settings-toggle").addEventListener("click", toggleSettings);
button("settings-close").addEventListener("click", toggleSettings);
button("ai-settings-link").addEventListener("click", () => {
  if (el("settings").hidden) toggleSettings();
  settingsReturnTarget = "ai-settings-link";
  el("ai-settings-group").scrollIntoView({
    block: "center",
    behavior: "instant",
  });
  input("ai-enabled").focus({ preventScroll: true });
});
input("travel").addEventListener("input", applyTravel);
input("ai-enabled").addEventListener("change", applyAI);
button("retry-format").addEventListener("click", () =>
  saveSetting("format", titleFormat),
);
button("retry-travel").addEventListener("click", () =>
  saveSetting("travel", travelMinutes),
);
button("retry-ai").addEventListener("click", () =>
  saveSetting("ai", aiEnabled),
);
button("retry-order").addEventListener("click", () =>
  saveSetting("order", candidateOrder),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el("settings").hidden) {
    event.preventDefault();
    toggleSettings();
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (
    message.type === "scan-request" &&
    (windowId === undefined || message.windowId === windowId)
  )
    void scan();
});
chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId && info.tabId !== sourceTabId) pageChanged();
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === sourceTabId && (info.status === "loading" || info.url))
    pageChanged();
  else if (
    tabId === sourceTabId &&
    info.status === "complete" &&
    ["checking", "error"].includes(scanState)
  )
    pageChanged();
});
window.addEventListener("pagehide", stopConnection);

// Brave omits the browser-owned header. Keep Chrome's existing controls and
// older browsers unchanged; do not infer the browser from its Chrome-like UA.
async function initializePanelClose() {
  try {
    if (
      typeof chrome.sidePanel?.close === "function" &&
      (await navigator.brave?.isBrave()) === true
    )
      button("panel-close").hidden = false;
  } catch {
    /* Detection is optional and must never block scanning. */
  }
}

button("panel-close").addEventListener("click", async () => {
  const control = button("panel-close");
  control.disabled = true;
  el("panel-close-error").hidden = true;
  try {
    const current = await chrome.windows.getCurrent();
    if (current.id === undefined) throw new Error("No panel window");
    await chrome.sidePanel.close({ windowId: current.id });
    // Also release the picker if the browser retains this document while hidden.
    // A rejected close leaves the current selection and connection untouched.
    pageChanged();
    control.disabled = false;
  } catch {
    control.disabled = false;
    el("panel-close-error").hidden = false;
  }
});
void initializePanelClose();

// Reserve the actual fixed footer height, including wrapped text and zoom.
const footerResize = new ResizeObserver(() => {
  const height = el("footer").getBoundingClientRect().height;
  if (height > 0)
    document.documentElement.style.setProperty(
      "--footer-height",
      `${height}px`,
    );
});
footerResize.observe(el("footer"));

async function initialize() {
  const initialThemeRevision = themeRevision;
  const quote = pickFooterQuote();
  el("footer-quote").textContent = quote.text;
  el("footer-quote").title = `${quote.original}\n— ${quote.attribution}`;
  try {
    const saved = await chrome.storage.local.get([
      "travelMinutes",
      "aiEnabled",
      "titleFormat",
      "candidateOrder",
      "themeId",
    ]);
    if (themeRevision === initialThemeRevision) setTheme(saved.themeId);
    if (
      typeof saved.travelMinutes === "number" &&
      Number.isInteger(saved.travelMinutes) &&
      saved.travelMinutes >= 0 &&
      saved.travelMinutes <= 180
    )
      travelMinutes = saved.travelMinutes;
    aiEnabled = saved.aiEnabled === true;
    candidateOrder = saved.candidateOrder === "date" ? "date" : "page";
    if (
      typeof saved.titleFormat === "string" &&
      !validateTitleFormat(saved.titleFormat)
    )
      titleFormat = saved.titleFormat;
  } catch {
    /* Safe defaults also work if storage is temporarily unavailable. */
  }
  input("travel").value = String(travelMinutes);
  input("ai-enabled").checked = aiEnabled;
  input("title-format").value = titleFormat;
  /** @type {HTMLSelectElement} */ (el("candidate-order")).value =
    candidateOrder;
  updateFormatPreview();
  await scan();
}
void initialize();
