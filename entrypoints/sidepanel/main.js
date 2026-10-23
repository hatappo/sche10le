import "./style.css";
import {
  extractStructuredEvents,
  extractTextEvents,
  mergeCandidates,
} from "../../lib/extract.js";
import { calendarUrl, createVariants } from "../../lib/calendar.js";
import {
  createDraft,
  FIELD_LABELS,
  pickField,
  previousField,
  skipField,
} from "../../lib/draft.js";
import { dateRangeLabel, timeRange } from "../../lib/dates.js";
import { aiAvailability, enhanceDates } from "../../lib/ai.js";

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
/** @type {AbortController | undefined} */
let aiController;

/** @param {string} text @param {boolean} [error] */
function notice(text, error = false) {
  el("notice").textContent = text;
  el("notice").classList.toggle("error", error);
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
  el("source-title").textContent = "ページが切り替わりました";
  el("source-domain").textContent = "";
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
  candidates = [];
  renderCandidates();
  el("empty").hidden = true;
  el("ai-area").hidden = true;
  notice("このページの日程を探しています…");
  el("scan-state").textContent = "走査中";
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
  el("source-title").textContent = "ページにアクセスできません";
  el("source-domain").textContent = "";
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
    el("source-title").textContent = pageTitle || "タイトルのないページ";
    el("source-title").title = pageTitle;
    el("source-domain").textContent = new URL(pageUrl).hostname;
    el("scan-state").textContent = "走査完了";
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
    draft = pickField(draft, message.text);
    syncPicker();
  } else if (message.type === "skip") advance();
  else if (message.type === "back") back();
  else if (message.type === "open") void openCalendar();
  else if (message.type === "pause") pausePicking();
}

function renderCandidates() {
  el("count").textContent = String(candidates.length);
  el("empty").hidden = candidates.length > 0 || scanning;
  el("empty-title").textContent = pageUrl
    ? "日程が見つかりませんでした"
    : "日程はまだ見つかっていません";
  el("empty-description").textContent = pageUrl
    ? "画像内の文字は対象外です。日付がテキストで書かれたページをお試しください。"
    : "日程のあるページを開いて、拡張アイコンを押してください。";
  el("list-hint").hidden = !candidates.length;
  const fragment = document.createDocumentFragment();
  for (const candidate of candidates) fragment.append(candidateCard(candidate));
  el("candidates").replaceChildren(fragment);
}

/** @param {import('../../lib/extract.js').Candidate} candidate */
function candidateCard(candidate) {
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
  for (const variant of createVariants(candidate, travelMinutes)) {
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
  card.addEventListener("pointerenter", () => expand(true));
  card.addEventListener("pointerleave", () => {
    if (!pinned && !card.contains(document.activeElement)) expand(false);
  });
  card.addEventListener("focusin", () => expand(true));
  card.addEventListener("focusout", (event) => {
    // activeElement may briefly be body between blur and focus. Use the intended
    // destination so options never become inert while Tab is entering them.
    const next =
      event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!pinned && !card.contains(next) && !card.matches(":hover"))
      expand(false);
  });
  heading.addEventListener("click", () => {
    pinned = !pinned;
    expand(pinned);
  });
  return card;
}

/** @param {import('../../lib/extract.js').Candidate} candidate @param {import('../../lib/calendar.js').Variant} variant */
function selectCandidate(candidate, variant) {
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
  [...el("steps").children].forEach((item, i) => {
    item.classList.toggle("active", !paused && i === draft?.step);
    item.classList.toggle("done", i < (draft?.step ?? 0));
  });
  el("pick-title").textContent = complete
    ? "カレンダーへ進めます"
    : paused
      ? "ページからの取得を中断しました"
      : `ページ上の${FIELD_LABELS[draft.step]}をクリック`;
  el("pick-help").textContent = complete
    ? "内容の調整・保存はGoogleカレンダーで。"
    : "選ばずに、下のボタンから進んでもOK。";
  button("previous").disabled = draft.step === 0;
  button("skip").hidden = complete || paused;
  button("resume").hidden = !paused || complete;
  el("picked-title").textContent = draft.title || "未設定";
  el("picked-location").textContent = draft.location || "未設定";
  el("picked-location").classList.toggle("is-empty", !draft.location);
  el("picked-details").textContent = draft.details
    ? `${draft.details}\n\n${draft.url}`
    : draft.url;
}

function syncPicker() {
  if (!draft) return;
  paused = false;
  // Rotate the token after every step so delayed clicks cannot advance twice.
  selectionToken = crypto.randomUUID();
  send(
    draft.step < 3
      ? { type: "pick", step: draft.step, token: selectionToken }
      : { type: "stop" },
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
  opening = true;
  button("open-calendar").disabled = true;
  const url = calendarUrl(selectedVariant, draft);
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
    const previousIds = new Set(candidates.map((candidate) => candidate.id));
    candidates = mergeCandidates(candidates, additions);
    for (const candidate of candidates)
      if (!previousIds.has(candidate.id))
        el("candidates").append(candidateCard(candidate));
    el("count").textContent = String(candidates.length);
    el("empty").hidden = candidates.length > 0;
    el("list-hint").hidden = !candidates.length;
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
button("open-calendar").addEventListener("click", () => void openCalendar());
button("skip").addEventListener("click", advance);
button("previous").addEventListener("click", back);
button("resume").addEventListener("click", syncPicker);
button("deselect").addEventListener("click", () => {
  resetSelection();
  renderCandidates();
  el("candidates").querySelector("button")?.focus();
});
document.querySelector(".brand")?.addEventListener("click", (event) => {
  event.preventDefault();
  resetSelection();
  renderCandidates();
  window.scrollTo({ top: 0 });
});
button("ai-download").addEventListener("click", () => void runAI(generation));
function toggleSettings() {
  const settings = el("settings");
  settings.hidden = !settings.hidden;
  button("settings-toggle").setAttribute(
    "aria-expanded",
    String(!settings.hidden),
  );
  if (!settings.hidden) input("travel").focus();
  else button("settings-toggle").focus();
}
button("settings-toggle").addEventListener("click", toggleSettings);
button("settings-close").addEventListener("click", toggleSettings);
button("save-settings").addEventListener("click", async () => {
  const minutes = input("travel").valueAsNumber;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) {
    el("settings-status").textContent = "0〜180分の整数を入力してください。";
    return;
  }
  try {
    await chrome.storage.local.set({ travelMinutes: minutes });
    travelMinutes = minutes;
    el("settings-status").textContent =
      "保存しました。次に選ぶ予定から適用されます。";
    if (!draft) renderCandidates();
  } catch {
    el("settings-status").textContent =
      "保存できませんでした。もう一度お試しください。";
  }
});
input("ai-enabled").addEventListener("change", async () => {
  const enabled = input("ai-enabled").checked;
  try {
    await chrome.storage.local.set({ aiEnabled: enabled });
    aiEnabled = enabled;
    if (enabled && pageText) void prepareAI(generation);
    else {
      aiController?.abort();
      el("ai-area").hidden = true;
    }
  } catch {
    input("ai-enabled").checked = aiEnabled;
    el("settings-status").textContent = "AI設定を保存できませんでした。";
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
  try {
    const saved = await chrome.storage.local.get([
      "travelMinutes",
      "aiEnabled",
    ]);
    if (
      typeof saved.travelMinutes === "number" &&
      Number.isInteger(saved.travelMinutes) &&
      saved.travelMinutes >= 0 &&
      saved.travelMinutes <= 180
    )
      travelMinutes = saved.travelMinutes;
    aiEnabled = saved.aiEnabled === true;
  } catch {
    /* Safe defaults also work if storage is temporarily unavailable. */
  }
  input("travel").value = String(travelMinutes);
  input("ai-enabled").checked = aiEnabled;
  await scan();
}
void initialize();
