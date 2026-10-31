import { chooseTheme } from "../support/sheet.js";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createSheetPreviewServer } from "../../scripts/preview-sheet.js";

let server;
let url;
test.beforeAll(async () => {
  server = await createSheetPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  // Test-only observation of the real sheet; the production bundle uses closed roots.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: "open" }); };
  });
});

test("ネイティブ検証用ページには模擬APIも拡張の自動起動も含めない", async ({ page, request }) => {
  const nativeServer = await createSheetPreviewServer({ native: true });
  await new Promise((resolve) => nativeServer.listen(0, "127.0.0.1", resolve));
  const nativeUrl = `http://127.0.0.1:${nativeServer.address().port}/`;
  try {
    await page.goto(nativeUrl);
    await expect(page.locator("#event-title")).toBeVisible();
    await expect(page.locator("sche10le-sheet, #preview-launch")).toHaveCount(0);
    expect(await page.evaluate(() => window.__sheetPreview)).toBeUndefined();
    for (const path of ["preview-api.js", "extension.js", "launch.js"]) {
      expect((await request.get(nativeUrl + path)).status()).toBe(404);
    }
  } finally {
    await new Promise((resolve) => nativeServer.close(resolve));
  }
});

async function start(page) {
  await page.goto(url);
  const sheet = page.locator("sche10le-sheet .sheet");
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  return sheet;
}
async function pickDate(sheet, name = /^時間どおり/) {
  await sheet.locator(".candidate-toggle").first().tap();
  await sheet.getByRole("button", { name }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "pick");
}

test("SafariパッケージからChrome専用UI・AI・不要な権限を除外する", async () => {
  const manifest = JSON.parse(await readFile(".output/safari-mv3/manifest.json", "utf8"));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions.sort()).toEqual(["activeTab", "scripting", "storage"].sort());
  expect(manifest.background.service_worker).toBe("background.js");
  for (const key of ["side_panel", "minimum_chrome_version", "content_scripts", "host_permissions"]) expect(manifest[key]).toBeUndefined();
  const content = await readFile(".output/safari-mv3/content-scripts/sheet.js", "utf8");
  expect(content).not.toMatch(/LanguageModel|AIで日程を補完|AIを準備する|__sheetPreview/);
});

test("起動時だけトップフレームへ注入し、背景処理のURLと送信元を検証する", async () => {
  let activate;
  let receive;
  const injected = [], sent = [], opened = [];
  const saved = { aiEnabled: true, themeId: "shikon", futureSetting: 123 };
  const api = {
    storage: { local: { async remove(keys) { for (const key of keys) delete saved[key]; } } },
    action: { onClicked: { addListener(fn) { activate = fn; } } },
    scripting: { async executeScript(request) { injected.push(request); } },
    tabs: {
      async sendMessage(...args) { sent.push(args); if (!injected.length) throw new Error("No receiver"); return { ok: true }; },
      async create(request) { opened.push(request); return { id: 10 }; },
    },
    runtime: { id: "test-extension", getURL: (path) => `safari-web-extension://test${path}`, onMessage: { addListener(fn) { receive = fn; } } },
  };
  runInNewContext(await readFile(".output/safari-mv3/background.js", "utf8"), { chrome: api, URL, console });
  expect(saved).toEqual({ themeId: "shikon", futureSetting: 123 });
  expect(injected).toHaveLength(0);
  await activate({ id: 4, url: "https://example.com/event" });
  expect(injected).toEqual([{ target: { tabId: 4, frameIds: [0] }, files: ["/content-scripts/sheet.js"] }]);
  expect(sent).toEqual([[4, { type: "sheet-show" }, { frameId: 0 }], [4, { type: "sheet-show" }, { frameId: 0 }]]);
  await activate({ id: 4, url: "https://example.com/event" });
  expect(injected).toHaveLength(1);
  const message = { type: "open-calendar", url: "https://calendar.google.com/calendar/render?action=TEMPLATE" };
  const sender = { id: "test-extension", tab: { id: 4 }, frameId: 0 };
  const dispatch = (message, sender) => new Promise((resolve) => receive(message, sender, resolve));
  expect(await dispatch(message, sender)).toEqual({ ok: true });
  expect(opened).toHaveLength(1);
  for (const invalid of [{ ...sender, id: "other" }, { ...sender, frameId: 1 }, { id: sender.id }]) {
    expect(await dispatch(message, invalid)).toEqual({ ok: false });
  }
  expect(await dispatch({ ...message, url: "https://example.com/" }, sender)).toEqual({ ok: false });
  expect(opened).toHaveLength(1);
  api.tabs.sendMessage = async () => { throw new Error("No receiver"); };
  api.scripting.executeScript = async () => { throw new Error("Cannot access contents of url"); };
  await activate({ id: 4, url: "https://example.com/event" });
  expect(opened[1].url).toMatch(/^safari-web-extension:\/\/test\/help.html/);
});

test("タップで日時を選び、同じシートを畳んで3項目を取得し、カレンダーとICSへ渡す", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sheet = await start(page);
  const initialHeight = (await sheet.boundingBox()).height;
  await page.screenshot({ path: `test-results/safari-${info.project.name}-list.png` });
  await pickDate(sheet);
  await expect.poll(async () => (await sheet.boundingBox()).height).toBeLessThan(initialHeight - 100);
  await page.locator("#event-title").tap();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await page.screenshot({ path: `test-results/safari-${info.project.name}-pick.png` });
  await page.locator("address").first().tap();
  await expect(sheet.locator("h2")).toHaveText("詳細を選択");
  await page.locator("article p").filter({ hasText: "受付は開始30分前" }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
  await expect(sheet.locator(".field").nth(2)).toContainText(url);
  await expect.poll(async () => (await sheet.boundingBox()).height).toBeCloseTo(844 * .72, 0);
  await page.screenshot({ path: `test-results/safari-${info.project.name}-review.png` });
  await sheet.getByRole("button", { name: /Googleカレンダーで開く/ }).tap();
  await expect(sheet.locator(".status")).toContainText("カレンダーを開きました");
  const handoff = new URL(await page.evaluate(() => window.__sheetPreview.lastCalendar));
  expect(handoff.searchParams.get("text")).toBe("蔵前の活版印刷ワークショップ");
  expect(handoff.searchParams.get("location")).toContain("アトリエ蔵前");
  expect(handoff.searchParams.get("details")).toContain("受付は開始30分前");
  expect(handoff.searchParams.get("details")).toContain(url);
  await expect(sheet.locator(".download")).toHaveText("ICS");
  const downloaded = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "予定をダウンロード（.ics）" }).tap();
  const download = await downloaded;
  expect(await readFile(await download.path(), "utf8")).toContain("BEGIN:VEVENT");
  expect(errors).toEqual([]);
});

test("スクロールやフォームを取得せず、閉じる・再表示・項目移動・選び直しで状態を保つ", async ({ page }) => {
  const sheet = await start(page);
  await pickDate(sheet);
  await page.locator("#event-title").evaluate((node) => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 1, clientX: 10, clientY: 100 }));
    node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 10, clientY: 60 }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect(sheet.locator("h2")).toHaveText("タイトルを選択");
  await page.locator("article").first().evaluate((node) => {
    const input = document.createElement("input");
    input.id = "page-form";
    node.prepend(input);
  });
  await page.locator("#page-form").fill("入力中の内容");
  await page.locator("#page-form").tap();
  await expect(sheet.locator("h2")).toHaveText("タイトルを選択");
  await page.locator("#event-title").tap();
  await sheet.getByRole("button", { name: "Sche10leを閉じる", exact: true }).tap();
  await expect(sheet).toBeHidden();
  await page.locator("#preview-launch").tap();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
  await sheet.locator(".field").nth(1).tap();
  await sheet.getByRole("button", { name: "3 詳細", exact: true }).tap();
  await sheet.getByRole("button", { name: "内容を確認", exact: true }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await sheet.getByRole("button", { name: "選び直す", exact: true }).tap();
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  await expect(sheet.locator('[aria-expanded="true"]')).toHaveCount(0);
  await sheet.getByRole("button", { name: "再スキャン", exact: true }).tap();
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  // A second injection must not create a second sheet or duplicate handlers.
  await page.addScriptTag({ url: `${url}extension.js` });
  await page.evaluate(() => window.__sheetPreview.show());
  await expect(page.locator("sche10le-sheet")).toHaveCount(1);
  await page.evaluate(() => history.pushState({}, "", "/?new-page=1"));
  await expect(sheet).toBeHidden();
  await page.locator("#preview-launch").tap();
  await expect(sheet).toHaveAttribute("data-mode", "list");
});

test("テーマと書式を保存・復元し、カレンダーの失敗時も取得した内容を保持する", async ({ page }, info) => {
  const sheet = await start(page);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await page.screenshot({ path: `test-results/settings-groups-${info.project.name}.png`, animations: "disabled" });
  await chooseTheme(sheet, "shikon");
  await expect(page.locator("sche10le-sheet")).toHaveAttribute("data-theme", "shikon");
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).fill("{unknown}");
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).blur();
  await expect(sheet.locator(".format-preview")).toHaveClass(/error/);
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).fill("{from:HHmm} {title}");
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).blur();
  await expect(sheet.locator(".status")).toHaveText("自動保存しました");
  await page.reload();
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  await expect(page.locator("sche10le-sheet")).toHaveAttribute("data-theme", "shikon");
  await pickDate(sheet, /^移動込み/);
  await page.locator("#event-title").tap();
  await sheet.getByRole("button", { name: "内容を確認" }).tap();
  await expect(sheet.locator(".field").first()).toContainText("1400 蔵前の活版印刷ワークショップ");
  await page.evaluate(() => { window.__sheetPreview.failOpen = true; });
  await sheet.getByRole("button", { name: /Googleカレンダーで開く/ }).tap();
  await expect(sheet.locator(".status")).toHaveClass(/error/);
  await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(async () => (await sheet.boundingBox()).width).toBe(360);
  await expect.poll(async () => (await sheet.boundingBox()).height).toBe(720);
  await page.screenshot({ path: `test-results/safari-${info.project.name}-desktop.png` });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await sheet.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(async () => {
    const box = await sheet.boundingBox();
    return box.x >= 0 && box.x + box.width <= 320;
  }).toBe(true);
  expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("設定のエラーを赤く示し、失敗した複数の変更を再試行でまとめて保存する", async ({ page }) => {
  const sheet = await start(page);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  const format = sheet.getByRole("textbox", { name: "タイトルの書式", exact: true });
  await expect(sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true })).toHaveAttribute("step", "5");
  await format.fill("{title} ");
  await sheet.getByRole("button", { name: "開始時刻", exact: true }).tap();
  await expect(format).toHaveValue("{title} {from:HHmm}");
  await expect(sheet.locator(".format-preview")).toContainText("1400");
  await expect(sheet.getByRole("button", { name: "開始時刻", exact: true })).toHaveAttribute("title", "{from:HHmm}");
  await format.fill("{invalid}");
  await expect(format).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.locator(".format-preview")).toHaveClass(/error/);
  await page.evaluate(() => { window.__sheetPreview.failSave = true; });
  await sheet.getByRole("button", { name: "初期値に戻す" }).tap();
  await chooseTheme(sheet, "aitetsu");
  await expect(sheet.locator(".status")).toHaveClass(/error/);
  await sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true }).fill("55");
  await sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true }).blur();
  await expect(sheet.getByRole("button", { name: "再試行", exact: true })).toBeVisible();
  await page.evaluate(() => { window.__sheetPreview.failSave = false; });
  await sheet.getByRole("button", { name: "再試行", exact: true }).tap();
  await expect(sheet.locator(".status")).toHaveText("自動保存しました");
  await page.reload();
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await expect(sheet.locator(".theme-selector summary")).toContainText("藍鉄");
  await expect(sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true })).toHaveValue("55");
  await expect(format).toHaveValue("{title}");
});

test("取得途中の確認画面から設定へ進み、6テーマでも狭幅と選択内容を保つ", async ({ page }) => {
  const sheet = await start(page);
  await pickDate(sheet);
  await expect(sheet.locator(".summary")).toContainText("14:00");
  await page.locator("#event-title").tap();
  await sheet.getByRole("button", { name: "内容を確認" }).tap();
  await expect(sheet.locator(".review-heading").getByRole("button", { name: "選び直す" })).toBeVisible();
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await page.setViewportSize({ width: 320, height: 568 });
  for (const theme of ["chitosemidori", "ginnezu", "mizuasagi", "aitetsu", "kurocha", "shikon"]) {
    await chooseTheme(sheet, theme);
    await expect(page.locator("sche10le-sheet")).toHaveAttribute("data-theme", theme);
    expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await sheet.getByRole("button", { name: "戻る", exact: true }).tap();
  await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
  await sheet.locator(".field").first().tap();
  await expect(sheet.locator(".steps button").first()).toHaveAttribute("aria-current", "step");
});

test("取得バーで内容を確認でき、直接の項目移動・途中確認・日時の選び直しができる", async ({ page }, info) => {
  const sheet = await start(page);
  await expect(sheet.locator("header").getByRole("button", { name: "設定", exact: true })).toBeVisible();
  await expect(sheet.locator(".scan-toolbar").getByRole("button", { name: "再スキャン", exact: true })).toBeVisible();
  await expect(sheet.locator("footer")).toBeHidden();
  await pickDate(sheet);
  await expect(sheet.locator(".pick-controls .row")).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: /^(戻る|スキップ|完了)$/ })).toHaveCount(0);
  const title = sheet.getByRole("button", { name: "1 タイトル", exact: true });
  await expect(title.locator(".step-value")).toContainText("週末のデザイン散歩");
  await expect(sheet.getByRole("button", { name: "2 場所", exact: true }).locator(".step-value")).toHaveText("未設定");
  await expect(sheet.getByRole("button", { name: "3 詳細", exact: true }).locator(".step-value")).toContainText("http://");
  await page.locator("#event-title").tap();
  await expect(title.locator(".step-value")).toContainText("蔵前の活版印刷ワークショップ");
  await expect(title).toHaveClass(/done/);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await expect(sheet.locator("footer")).toBeHidden();
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).fill("{from:HHmm} {title}");
  await sheet.getByRole("button", { name: "戻る", exact: true }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "pick");
  await expect(sheet.getByRole("button", { name: "2 場所", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(title.locator(".step-value")).toContainText("1400 蔵前");
  await sheet.locator("header").getByRole("button", { name: "内容を確認", exact: true }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field").first()).toContainText("1400 蔵前");
  await expect(sheet.locator("footer .hint, footer .review-utility")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /Googleカレンダーで開く/ })).toBeVisible();
  await sheet.locator(".field").nth(2).tap();
  await page.locator("article p").filter({ hasText: "受付は開始30分前" }).tap();
  // Selecting details advances automatically, even if location was left blank.
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field").nth(1)).toContainText("未設定");
  await sheet.locator(".field").first().tap();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(async () => (await sheet.boundingBox()).height).toBe(212);
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await sheet.locator(".pick-controls").evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
  expect(await title.locator(".step-value").evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe("2");
  await page.screenshot({ path: `test-results/picker-preview-${info.project.name}.png` });
  await sheet.getByRole("button", { name: "選び直す", exact: true }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "list");
  await expect(sheet.locator('[aria-expanded="true"]')).toHaveCount(0);
});

test("設定と戻るが同じ位置で切り替わり、色見本はテーマの実色とキーボード操作に対応する", async ({ page }, info) => {
  const sheet = await start(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator("sche10le-sheet")).toHaveCSS("--view-width", "320px");
  const gear = sheet.getByRole("button", { name: "設定", exact: true });
  const gearBox = await gear.boundingBox();
  await gear.click();
  const back = sheet.getByRole("button", { name: "戻る", exact: true });
  const backBox = await back.boundingBox();
  expect(backBox.x).toBeCloseTo(gearBox.x, 0);
  expect(backBox.width).toBe(gearBox.width);
  const selector = sheet.locator(".theme-selector");
  const summary = selector.locator("summary");
  const sourceScroll = await page.evaluate(() => scrollY);
  await summary.focus();
  await summary.press("Enter");
  await expect(selector).toHaveJSProperty("open", true);
  await expect(selector.locator(".theme-options button")).toHaveCount(6);
  await expect(selector.getByRole("button", { name: "紫紺", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(sourceScroll);
  const colors = await selector.locator(".theme-options .theme-swatch").evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.themePreview, paper: getComputedStyle(node).backgroundColor,
    ink: getComputedStyle(node).color, accent: getComputedStyle(node).boxShadow,
  })));
  expect(new Set(colors.map(color => color.paper)).size).toBe(6);
  expect(new Set(colors.map(color => color.accent)).size).toBe(6);
  expect(await selector.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/theme-swatches-${info.project.name}.png` });
  await selector.getByRole("button", { name: "千歳緑", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(selector.getByRole("button", { name: "紫紺", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selector).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("紫紺");
  await expect(page.locator("sche10le-sheet")).toHaveAttribute("data-theme", "shikon");
  await summary.press("Enter");
  await summary.press("Escape");
  await expect(selector).toHaveJSProperty("open", false);
  await expect(sheet).toBeVisible();
  await back.click();
  await pickDate(sheet);
  const pickingGear = await gear.boundingBox();
  await gear.click();
  expect((await back.boundingBox()).x).toBeCloseTo(pickingGear.x, 0);
  await back.click();
  await expect(sheet).toHaveAttribute("data-mode", "pick");
});

test("取得途中の設定を閉じて再開しても、戻る先と内容を保ち、再選択だけを反映する", async ({ page }) => {
  const sheet = await start(page);
  await pickDate(sheet);
  await page.locator("#event-title").tap();
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await sheet.getByRole("button", { name: "Sche10leを閉じる", exact: true }).tap();
  await expect(sheet).toBeHidden();
  await page.locator("#preview-launch").tap();
  await expect(sheet).toHaveAttribute("data-mode", "settings");
  await sheet.getByRole("button", { name: "戻る", exact: true }).tap();
  await expect(sheet.getByRole("button", { name: "2 場所", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(sheet.getByRole("button", { name: "1 タイトル", exact: true })).toHaveClass(/done/);
  await sheet.getByRole("button", { name: "3 詳細", exact: true }).tap();
  await page.locator("article p").filter({ hasText: "受付は開始30分前" }).tap();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field").nth(1)).not.toHaveClass(/done/);
  await sheet.locator(".field").first().tap();
  await page.locator("address").first().tap();
  await sheet.getByRole("button", { name: "内容を確認", exact: true }).tap();
  await expect(sheet.locator(".field").first()).toContainText("アトリエ蔵前");
  await expect(sheet.locator(".field").nth(2)).toContainText("受付は開始30分前");
  await sheet.getByRole("button", { name: "選び直す", exact: true }).tap();
  await pickDate(sheet);
  await expect(sheet.locator(".steps .done")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "1 タイトル", exact: true })).toContainText("週末のデザイン散歩");
});

// Programmatic ranges exercise Selection integration. Native iOS long-press handles
// and its context menu still require a physical-device check.
async function selectRange(page, selector, start, end) {
  await page.locator(selector).evaluate((node, [start, end]) => {
    const range = document.createRange();
    range.setStart(node.firstChild, start);
    range.setEnd(node.firstChild, end);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, [start, end]);
}

test("範囲を調整してから明示的に取得し、項目移動・解除時に古い範囲を残さない", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  await pickDate(sheet);
  await selectRange(page, "#event-title", 0, 3);
  const confirm = sheet.getByRole("button", { name: "この範囲を使う", exact: true });
  await expect(confirm).toBeVisible();
  await expect(sheet.locator("h2")).toHaveText("タイトルを選択");
  await selectRange(page, "#event-title", 3, 7);
  await expect(sheet.locator("#selection-preview")).toHaveText("活版印刷");
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => {
    const box = await sheet.boundingBox();
    return Math.round(box.y + box.height);
  }).toBeLessThanOrEqual(568);
  await page.screenshot({ path: `test-results/range-pick-${info.project.name}.png`, animations: "disabled" });
  await confirm.tap();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await expect(sheet.locator(".steps button").first()).toContainText("活版印刷");
  await expect(confirm).toBeHidden();
  expect(await page.evaluate(() => getSelection().toString())).toBe("");
  await selectRange(page, "#event-title", 0, 3);
  await expect(confirm).toBeVisible();
  await sheet.getByRole("button", { name: "3 詳細", exact: true }).tap();
  await expect(confirm).toBeHidden();
  await selectRange(page, "#event-title", 0, 3);
  await expect(confirm).toBeVisible();
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(confirm).toBeHidden();
  await page.locator("article").first().evaluate(node => {
    const form = document.createElement("div");
    form.contentEditable = "true";
    form.id = "range-form";
    form.textContent = "取得しない入力内容";
    node.prepend(form);
  });
  await selectRange(page, "#range-form", 0, 4);
  await expect(confirm).toBeHidden();
});

test("PCのドラッグ範囲を要素境界を越えて取得し、移動だけでは取得しない", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  await page.setViewportSize({ width: 1100, height: 850 });
  await pickDate(sheet);
  await page.locator("#event-title").evaluate(node => {
    node.innerHTML = '<span>選びたい</span><span>範囲だけ</span><span>残す文字</span>';
    node.style.cssText = "font:20px monospace;white-space:nowrap;";
    node.scrollIntoView({ block: "center" });
  });
  const points = await page.locator("#event-title").evaluate(node => {
    const a = node.children[0].getBoundingClientRect();
    const b = node.children[1].getBoundingClientRect();
    return { x1: a.left + 1, x2: b.right - 1, y: a.top + a.height / 2 };
  });
  await page.mouse.move(points.x1, points.y);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y, { steps: 12 });
  await page.mouse.up();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await expect(sheet.locator(".steps button").first().locator(".step-value")).toHaveText("選びたい範囲だけ");
  await expect(sheet.getByRole("button", { name: "この範囲を使う" })).toBeHidden();
  await page.locator("#event-title").evaluate(node => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true, clientY: 100 }));
    node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientY: 40 }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
});

test("候補の目印をソート・強調表示・登録方法・選び直しでも維持する", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  // Change page order independently of date order before rescanning.
  await page.locator("article").first().evaluate(node => node.before(node.nextElementSibling));
  await sheet.getByRole("button", { name: "再スキャン", exact: true }).tap();
  await expect(sheet.locator(".candidate-marker")).toHaveText(["A", "B", "C"]);
  const before = await sheet.locator(".candidate").evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.candidateId, marker: node.querySelector(".candidate-marker").textContent,
  })));
  await sheet.getByRole("combobox", { name: "日程の並び順" }).selectOption("date");
  const after = await sheet.locator(".candidate").evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.candidateId, marker: node.querySelector(".candidate-marker").textContent,
  })));
  expect(after).not.toEqual(before);
  expect(after.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(before.toSorted((a, b) => a.id.localeCompare(b.id)));
  await sheet.locator(".candidate-toggle").first().tap();
  const selected = after[0].marker;
  await expect(page.locator("sche10le-source-highlight .source-marker:not(.candidate-source-marker)")).toHaveText(selected);
  const sourceMarker = page.locator("sche10le-source-highlight .source-marker:not(.candidate-source-marker)");
  await expect(sourceMarker).toBeInViewport({ ratio: 1 });
  expect((await sourceMarker.boundingBox()).y + (await sourceMarker.boundingBox()).height).toBeLessThan((await sheet.boundingBox()).y);
  await page.screenshot({ path: `test-results/candidate-marker-${info.project.name}.png`, animations: "disabled" });
  await sheet.getByRole("button", { name: /^移動込み/ }).tap();
  await expect(sheet.locator(".summary .candidate-marker")).toHaveText(selected);
  await sheet.getByRole("button", { name: "内容を確認", exact: true }).tap();
  await expect(sheet.locator(".summary .candidate-marker")).toHaveText(selected);
  await sheet.getByRole("button", { name: "選び直す", exact: true }).tap();
  await expect(sheet.locator(".candidate-marker")).toHaveText(after.map(item => item.marker));
});

test("別の日付候補へタップで切り替えると登録方法が開く", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  for (const index of [0, 1, 0, 2, 1]) {
    await sheet.locator(".candidate-toggle").nth(index).tap();
    await expect(sheet.locator(".candidate-toggle").nth(index)).toHaveAttribute("aria-expanded", "true");
    await expect(sheet.locator(".candidate").nth(index).locator(".variants")).toBeVisible();
    await expect(sheet.locator('[aria-expanded="true"]')).toHaveCount(1);
  }
  // Safari may leave focus on the previous card when another is tapped.
  await sheet.locator(".candidate-toggle").first().focus();
  await sheet.locator(".candidate-toggle").nth(1).tap();
  await expect(sheet.locator(".candidate-toggle").nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.locator(".candidate").nth(1).locator(".variants")).toBeVisible();
});

test("範囲のプレビューだけで取得内容を変更せず、近くのボタンで確定する", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sourceUrl = `${url}?event=long-source-for-selection-preview`;
  await page.goto(sourceUrl);
  const sheet = page.locator("sche10le-sheet .sheet");
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await sheet.getByRole("textbox", { name: "タイトルの書式", exact: true }).fill("{from:HHmm} {title}");
  await sheet.getByRole("button", { name: "戻る", exact: true }).tap();
  await pickDate(sheet);
  await page.locator("#event-title").evaluate(node => node.scrollIntoView({ block: "center" }));
  const title = sheet.getByRole("button", { name: "1 タイトル", exact: true });
  const original = await title.locator(".step-value").innerText();
  const nearby = page.locator('sche10le-sheet .nearby-selection[data-placement="below"]');
  await selectRange(page, "#event-title", 0, 3);
  await expect(title.locator(".step-value")).toHaveText("1400 蔵前の");
  await expect(title).not.toHaveClass(/done/);
  await selectRange(page, "#event-title", 3, 7);
  await expect(title.locator(".step-value")).toHaveText("1400 活版印刷");
  await expect(nearby).toBeVisible();
  await expect(nearby).toBeInViewport({ ratio: 1 });
  const action = await nearby.boundingBox();
  const source = await page.evaluate(() => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    return { bottom: rect.bottom, top: rect.top };
  });
  expect(action.y).toBeGreaterThan(source.bottom);
  expect(action.y + action.height).toBeLessThan((await sheet.boundingBox()).y);
  await page.screenshot({ path: `test-results/nearby-range-${info.project.name}.png`, animations: "disabled" });
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(title.locator(".step-value")).toHaveText(original);
  await expect(nearby).toBeHidden();
  // Leaving without confirming must not persist the transient title.
  await selectRange(page, "#event-title", 3, 7);
  await sheet.getByRole("button", { name: "内容を確認", exact: true }).tap();
  await expect(sheet.locator(".field").first()).toContainText(original);
  await expect(nearby).toBeHidden();
  await sheet.locator(".field").first().tap();
  await page.locator("#event-title").evaluate(node => node.scrollIntoView({ block: "center" }));
  await selectRange(page, "#event-title", 3, 7);
  await nearby.tap();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await expect(title.locator(".step-value")).toHaveText("1400 活版印刷");
  await expect(title).toHaveClass(/done/);
  await expect(nearby).toBeHidden();
  // Location and details follow the same preview rules, including the source URL.
  await selectRange(page, "#event-title", 0, 3);
  const location = sheet.getByRole("button", { name: "2 場所", exact: true });
  await expect(location.locator(".step-value")).toHaveText("蔵前の");
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(location.locator(".step-value")).toHaveText("未設定");
  await sheet.getByRole("button", { name: "3 詳細", exact: true }).tap();
  await selectRange(page, "#event-title", 3, 7);
  const details = sheet.getByRole("button", { name: "3 詳細", exact: true });
  await expect(details.locator(".step-value")).toContainText("活版印刷");
  await expect(details.locator(".step-value")).toContainText(sourceUrl);
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(details.locator(".step-value")).toHaveText(sourceUrl);
  await expect(details.locator(".url-start")).toHaveCount(1);
});

test("範囲の近くに余白がない時はバーから確定でき、スクロールで表示を追従する", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  // Leave room above the source so scrolling can move it toward the bar.
  await page.locator("main").evaluate(node => { node.style.paddingTop = "500px"; });
  await pickDate(sheet);
  const nearby = page.locator('sche10le-sheet .nearby-selection[data-placement="below"]');
  await page.locator("#event-title").evaluate(node => node.scrollIntoView({ block: "center" }));
  await selectRange(page, "#event-title", 3, 7);
  await expect(nearby).toBeVisible();
  const before = await nearby.boundingBox();
  await page.evaluate(() => scrollBy(0, 30));
  await expect.poll(async () => (await nearby.boundingBox()).y).toBeCloseTo(before.y - 30, 0);
  // Place the selection just above the bar, leaving no room for a separate action.
  const sheetTop = (await sheet.boundingBox()).y;
  await page.evaluate(top => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    scrollBy(0, rect.bottom - (top - 12));
  }, sheetTop);
  await expect(nearby).toBeHidden();
  await expect(sheet.getByRole("button", { name: "この範囲を使う", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "この範囲を使う", exact: true }).tap();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await expect(sheet.getByRole("button", { name: "1 タイトル", exact: true }).locator(".step-value")).toHaveText("活版印刷");
});

test("範囲の上下に独立して確定ボタンを表示し、上からも取得できる", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  await pickDate(sheet);
  await page.locator("main").evaluate(node => { node.style.paddingTop = "500px"; });
  await page.locator("#event-title").evaluate(node => node.scrollIntoView({ block: "center" }));
  await selectRange(page, "#event-title", 3, 7);
  const above = page.locator('sche10le-sheet .nearby-selection[data-placement="above"]');
  const below = page.locator('sche10le-sheet .nearby-selection[data-placement="below"]');
  await expect(above).toBeVisible();
  await expect(below).toBeVisible();
  const source = await page.evaluate(() => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  const top = await above.boundingBox();
  expect(top.y + top.height).toBeLessThan(source.top);
  expect((await below.boundingBox()).y).toBeGreaterThan(source.bottom);
  await page.screenshot({ path: `test-results/range-both-${info.project.name}.png`, animations: "disabled" });
  // Near the viewport top only the lower action has space.
  await page.evaluate(() => scrollBy(0, getSelection().getRangeAt(0).getBoundingClientRect().top - 12));
  await expect(above).toBeHidden();
  await expect(below).toBeVisible();
  await page.locator("#event-title").evaluate(node => node.scrollIntoView({ block: "center" }));
  await expect(above).toBeVisible();
  await above.tap();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await expect(sheet.getByRole("button", { name: "1 タイトル", exact: true }).locator(".step-value")).toHaveText("活版印刷");
  await expect(above).toBeHidden();
  await expect(below).toBeHidden();
});


test("日程を選ぶ間だけ全候補の目印を保持し、スクロールに追従する", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await start(page);
  const badges = page.locator("sche10le-source-highlight .candidate-source-marker");
  await expect(badges).toHaveText(["A", "B", "C"]);
  await expect(page.locator("sche10le-source-highlight .shade")).toBeHidden();
  await page.locator(".date").nth(1).evaluate(node => node.scrollIntoView({block: "start"}));
  await expect(badges.nth(1)).toBeVisible();
  await expect(badges.nth(1)).toBeInViewport();
  await pickDate(sheet);
  await expect(badges).toHaveCount(0);
  await sheet.getByRole("button", { name: "選び直す", exact: true }).tap();
  await expect(badges).toHaveText(["A", "B", "C"]);
  await sheet.getByRole("button", { name: "設定", exact: true }).tap();
  await expect(badges).toHaveCount(0);
  await sheet.getByRole("button", { name: "戻る", exact: true }).tap();
  await expect(badges).toHaveCount(3);
  await sheet.getByRole("button", { name: "Sche10leを閉じる", exact: true }).tap();
  await expect(page.locator("sche10le-source-highlight")).toHaveCount(0);
});

test("旧設定の削除失敗は起動を妨げず、次の背景起動で再試行する", async () => {
  const bundle = await readFile(".output/safari-mv3/background.js", "utf8");
  let attempts = 0, registered = 0;
  const saved = { aiEnabled: false, travelMinutes: 45, titleFormat: "{title}", candidateOrder: "date" };
  const api = {
    storage: {local: {async remove(keys) {
      attempts++;
      if (attempts === 1) throw new Error("Storage unavailable");
      for (const key of keys) delete saved[key];
    }}},
    action: {onClicked: {addListener() { registered++; }}},
    runtime: {onMessage: {addListener() {}}},
  };
  for (let i = 0; i < 3; i++) {
    runInNewContext(bundle, {chrome: api, URL, console: {warn() {}}});
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  expect(registered).toBe(3);
  expect(attempts).toBe(3);
  expect(saved).toEqual({travelMinutes: 45, titleFormat: "{title}", candidateOrder: "date"});
});
