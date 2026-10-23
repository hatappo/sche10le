import "./style.css";
import {
  extractStructuredEvents,
  extractTextEvents,
  mergeCandidates,
} from "../../lib/extract.js";
import { calendarUrl, candidateOptions } from "../../lib/calendar.js";
import { orderCandidates } from "../../lib/candidate-order.js";
import { pickFooterQuote } from "../../lib/footer-quotes.js";
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
let opening = false;
let scanTimer = 0;
let travelMinutes = 30;
let aiEnabled = false;
let titleFormat = DEFAULT_TITLE_FORMAT;
const settingStates = {
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
  clearTimeout(scanTimer);
  scanning = false;
  button("rescan").disabled = false;
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
  el("idle-footer").hidden = false;
}

function pageChanged() {
  stopConnection();
  resetSelection();
  candidates = [];
  pageText = "";
  pageUrl = "";
  sourceTabId = undefined;
  showSource("ページが切り替わりました");
  el("ai-area").hidden = true;
  renderCandidates();
  notice("このページを調べるには、拡張アイコンを押してください。");
  el("scan-state").textContent = "待機中";
  el("scan-state").classList.remove("busy");
}

async function scan() {
  if (scanning) return;
  stopConnection();
  resetSelection();
  const run = generation;
  scanning = true;
  button("rescan").disabled = true;
  showSource("ページを確認中");
  candidates = [];
  renderCandidates();
  el("empty").hidden = true;
  el("ai-area").hidden = true;
  notice("このページの日程を探しています…");
  el("scan-state").textContent = "スキャン中";
  el("scan-state").classList.add("busy");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (run !== generation) return;
    if (!tab?.id) throw new Error("ページがありません");
    sourceTabId = tab.id;
    windowId = tab.windowId;
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
    connection.postMessage({ type: "scan" });
  } catch {
    if (run === generation) scanFailed();
  }
}

function scanFailed() {
  stopConnection();
  sourceTabId = undefined;
  pageUrl = "";
  pageText = "";
  showSource("ページにアクセスできません");
  el("scan-state").textContent = "未接続";
  el("scan-state").classList.remove("busy");
  renderCandidates();
  notice(
    "対象ページで拡張アイコンを押してください。Chromeの設定画面など、読み取れないページもあります。",
    true,
  );
}

/** @param {Record<string, any>} message @param {number} run */
function receive(message, run) {
  if (message.type === "snapshot") {
    clearTimeout(scanTimer);
    scanning = false;
    button("rescan").disabled = false;
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
    el("scan-state").textContent = "スキャン完了";
    el("scan-state").classList.remove("busy");
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
    if (draft.step !== pickedStep) flashPickedField(pickedStep);
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
  el("empty").hidden = candidates.length > 0 || scanning;
  el("empty-title").textContent = pageUrl
    ? "日程が見つかりませんでした"
    : "日程はまだ見つかっていません";
  el("empty-description").textContent = pageUrl
    ? "画像内の文字は対象外です。日付がテキストで書かれたページをお試しください。"
    : "日程のあるページを開いて、拡張アイコンを押してください。";
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
    else list.querySelector("button")?.focus({ preventScroll: true });
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
  const heading = document.createElement("button");
  heading.type = "button";
  heading.className = "candidate-heading";
  heading.setAttribute("aria-expanded", "false");
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
  const source =
    candidate.source === "structured"
      ? "構造化データ"
      : candidate.source === "ai"
        ? "AI補完・内容をご確認ください"
        : candidate.inferredYear
          ? `${candidate.date.slice(0, 4)}年として解釈`
          : "ページ内の日付";
  const evidence = node("span", "candidate-source", source);
  evidence.title = candidate.evidence;
  content.append(evidence);
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
  let pinned = false;
  const expand = (/** @type {boolean} */ expanded) => {
    // Picking fields has its own screen; pointer movement must not reopen variants.
    expanded = expanded && !draft;
    card.classList.toggle("expanded", expanded);
    heading.setAttribute("aria-expanded", String(expanded));
    region.inert = !expanded;
  };
  card.addEventListener("pointerenter", () => {
    if (waitForMovement) return;
    expand(true);
    revealSource(candidate);
  });
  card.addEventListener("pointermove", (event) => {
    // A rebuilt list can appear beneath a stationary pointer. Resume only on
    // actual movement, while focus/click remains available immediately.
    if (!waitForMovement || (!event.movementX && !event.movementY)) return;
    waitForMovement = false;
    expand(true);
    revealSource(candidate);
  });
  card.addEventListener("pointerleave", () => {
    if (!pinned && !card.contains(document.activeElement)) expand(false);
    if (!card.contains(document.activeElement) && revealedId === candidate.id)
      clearSource();
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
    if (!pinned && !card.contains(next) && !card.matches(":hover"))
      expand(false);
    if (
      !card.contains(next) &&
      !card.matches(":hover") &&
      revealedId === candidate.id
    )
      clearSource();
  });
  heading.addEventListener("click", () => {
    pinned = !pinned;
    expand(pinned);
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
    card.querySelector("button")?.setAttribute("aria-expanded", "false");
    const heading = card.querySelector("button");
    if (heading) heading.disabled = true;
    const region = /** @type {HTMLElement | null} */ (
      card.querySelector(".variant-region")
    );
    if (region) region.inert = true;
  }
  document.body.classList.add("is-selected");
  el("selection").hidden = false;
  el("open-area").hidden = false;
  el("idle-footer").hidden = true;
  el("selected-date").textContent = dateRangeLabel(
    variant.date,
    variant.endDate,
  );
  el("selected-time").textContent =
    `${variant.label} · ${variant.start && variant.end ? timeRange(variant.start, variant.end) : "終日"}${variant.note ? `（${variant.note}）` : ""}`;
  syncPicker();
  button("open-calendar").focus({ preventScroll: true });
}

function renderDraft() {
  if (!draft) return;
  const complete = draft.step >= 3;
  PICK_FIELDS.forEach((field, index) => {
    const row = el(`field-${field}`);
    const active = !paused && index === draft?.step;
    row.querySelector(".field-status")?.toggleAttribute("hidden", !active);
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
function flashPickedField(index) {
  const row = el(`field-${PICK_FIELDS[index]}`);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.getAnimations().forEach((animation) => animation.cancel());
  row.querySelector(".picked-confirmation")?.remove();
  const check = node("span", "picked-confirmation", "✓");
  check.setAttribute("aria-hidden", "true");
  row.append(check);
  row.scrollIntoView({
    block: "nearest",
    behavior: reduced ? "instant" : "smooth",
  });
  row.animate(
    [
      { backgroundColor: "#d6ead1", boxShadow: "0 0 0 3px #b9d9b4" },
      { backgroundColor: "transparent", boxShadow: "0 0 0 0 #b9d9b400" },
    ],
    { duration: reduced ? 0 : 800, easing: "ease-out" },
  );
  const animation = check.animate(
    reduced
      ? [{ opacity: 1 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateY(5px) scale(.75)" },
          { opacity: 1, transform: "translateY(0) scale(1.1)", offset: 0.25 },
          { opacity: 1, transform: "translateY(0) scale(1)", offset: 0.75 },
          { opacity: 0, transform: "translateY(-5px) scale(1)" },
        ],
    { duration: 900, easing: "ease-out" },
  );
  void animation.finished.then(
    () => check.remove(),
    () => check.remove(),
  );
}

function syncPicker() {
  if (!draft) return;
  paused = false;
  // Rotate the token after every step so delayed clicks cannot advance twice.
  selectionToken = crypto.randomUUID();
  send({ type: "pick", step: draft.step, token: selectionToken });
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

/** @param {number} run */
async function prepareAI(run) {
  if (!aiEnabled) return;
  const status = await aiAvailability(window.LanguageModel);
  if (run !== generation || !aiEnabled) return;
  el("ai-area").hidden = false;
  el("ai-download").hidden = status !== "downloadable";
  if (status === "available") {
    await runAI(run);
    return;
  }
  el("ai-status").textContent =
    status === "downloadable"
      ? "AIを使うにはモデルのダウンロードが必要です。"
      : status === "downloading"
        ? "AIモデルを準備中です。通常の抽出は利用できます。"
        : "この環境では通常の抽出を利用します。";
}

/** @param {number} run */
async function runAI(run) {
  if (!window.LanguageModel || !pageText || !aiEnabled) return;
  aiController?.abort();
  const controller = new AbortController();
  aiController = controller;
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  el("ai-area").hidden = false;
  el("ai-download").hidden = true;
  el("ai-status").textContent =
    "AIで日程を補完しています。今ある候補は選べます。";
  try {
    const additions = await enhanceDates(
      window.LanguageModel,
      pageText,
      controller.signal,
    );
    if (run !== generation || !aiEnabled || controller.signal.aborted) return;
    candidates = mergeCandidates(candidates, additions);
    // Keep the selected card and draft stable until the user returns to the list.
    if (!draft) reconcileCandidates(visibleOptions());
    el("ai-status").textContent = "AIの補完が完了しました。";
  } catch {
    if (run === generation && aiEnabled && aiController === controller) {
      el("ai-status").textContent =
        "AIの補完はできませんでした。通常の抽出を利用できます。";
      el("ai-download").hidden = false;
      el("ai-download").textContent = "もう一度試す";
    }
  } finally {
    clearTimeout(timeout);
  }
}

button("rescan").addEventListener("click", () => void scan());
el("candidate-order").addEventListener("change", (event) => {
  const value = /** @type {HTMLSelectElement} */ (event.target).value;
  candidateOrder = value === "date" ? "date" : "page";
  clearSource();
  if (!draft) renderCandidates();
  saveSetting("order", candidateOrder);
});
button("open-calendar").addEventListener("click", () => void openCalendar());
button("resume").addEventListener("click", syncPicker);
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
document.querySelector(".brand")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!el("settings").hidden) toggleSettings();
  resetSelection();
  renderCandidates();
  window.scrollTo({ top: 0 });
});
button("ai-download").addEventListener("click", () => void runAI(generation));
function toggleSettings() {
  const settings = el("settings");
  if (settings.hidden) panelScroll = window.scrollY;
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
  else button("settings-toggle").focus({ preventScroll: true });
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
}

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
  if (aiEnabled && pageText) void prepareAI(generation);
  else el("ai-area").hidden = true;
  saveSetting("ai", aiEnabled);
}
button("settings-toggle").addEventListener("click", toggleSettings);
button("settings-close").addEventListener("click", toggleSettings);
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
});
window.addEventListener("pagehide", stopConnection);

async function initialize() {
  const quote = pickFooterQuote();
  el("footer-quote").textContent = quote.text;
  el("footer-quote").title = quote.attribution;
  try {
    const saved = await chrome.storage.local.get([
      "travelMinutes",
      "aiEnabled",
      "titleFormat",
      "candidateOrder",
    ]);
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
