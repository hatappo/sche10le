import { test, expect, chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSheetPreviewServer } from "../../scripts/preview-sheet.js";
import { showSheet, chooseTheme } from "../support/sheet.js";

let context, server, workspace, baseUrl, worker;
test.beforeAll(async () => {
  server = await createSheetPreviewServer({ native: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  workspace = await mkdtemp(path.join(tmpdir(), "sche10le-e2e-"));
  const extension = path.join(workspace, "extension");
  await cp(path.resolve(".output/chrome-mv3"), extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.permissions.sort()).toEqual(["activeTab", "scripting", "storage"].sort());
  expect(manifest.side_panel).toBeUndefined();
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  // Playwright cannot grant activeTab through the toolbar. Only this disposable
  // copy gets access to the local fixture; no production permissions are widened.
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(workspace, "profile"), {
    channel: "chromium", headless: true,
    chromiumSandbox: process.env.PLAYWRIGHT_CHROMIUM_SANDBOX === "1",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1000, height: 850 }, timezoneId: "Asia/Tokyo",
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  // Capture the real validated handoff; tests must not contact Google.
  await worker.evaluate(() => {
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (properties) => {
      globalThis.__calendarRequest = properties.url;
      return create({ ...properties, url: "about:blank" });
    };
  });
});
test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
test.beforeEach(async () => { await worker.evaluate(() => chrome.storage.local.clear()); });
async function open() {
  const page = await context.newPage();
  await page.goto(baseUrl);
  await expect(page.locator("sche10le-sheet")).toHaveCount(0);
  expect(await showSheet(worker, page)).toEqual({ ok: true });
  const sheet = page.locator("sche10le-sheet .sheet");
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  return { page, sheet };
}
async function select(sheet, label = /^時間どおり/) {
  await sheet.locator(".candidate-toggle").first().click();
  await sheet.getByRole("button", { name: label }).click();
  await expect(sheet).toHaveAttribute("data-mode", "pick");
}

test("共通ドロワーで取得・書式・移動時間・Google URL・ICSを一貫して扱う", async () => {
  // v0.5 settings must survive, including ignoring a previously enabled AI flag.
  await worker.evaluate(() => chrome.storage.local.set({ themeId: "shikon", titleFormat: "{from:HHmm} {title} {to:HHmm}", travelMinutes: 45, candidateOrder: "date", aiEnabled: true }));
  const { page, sheet } = await open();
  try {
    await expect(page.locator("sche10le-sheet")).toHaveAttribute("data-theme", "shikon");
    await expect(sheet.getByLabel("日程の並び順")).toHaveValue("date");
    await select(sheet, /^移動込み/);
    await expect(sheet.locator(".summary")).toContainText("13:15");
    await page.locator("#event-title").click();
    await page.locator("address").first().click();
    await page.locator("article p").filter({ hasText: "受付は開始30分前" }).click();
    await expect(sheet).toHaveAttribute("data-mode", "review");
    await expect(sheet.locator(".field").first()).toContainText("1400 蔵前の活版印刷ワークショップ 1600");
    const downloadEvent = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "予定をダウンロード（.ics）" }).click();
    const file = (await readFile(await (await downloadEvent).path(), "utf8")).replace(/\r\n /g, "");
    expect(file).toContain("SUMMARY:1400 蔵前の活版印刷ワークショップ 1600");
    expect(file).toContain("DTSTART:20261108T041500Z");
    expect(file).toContain(baseUrl);
    await sheet.getByRole("button", { name: /Googleカレンダーで開く/ }).click();
    await expect(sheet.locator(".status")).toContainText("カレンダーを開きました");
    const handoff = new URL(await worker.evaluate(() => globalThis.__calendarRequest));
    expect(handoff.searchParams.get("dates")).toBe("20261108T041500Z/20261108T074500Z");
    expect(handoff.searchParams.get("text")).toBe("1400 蔵前の活版印刷ワークショップ 1600");
    expect(handoff.searchParams.get("details")).toContain(baseUrl);
    expect(handoff.searchParams.get("location")).toContain("アトリエ蔵前");
    await expect(sheet.locator(".field.done")).toHaveCount(3);
  } finally { await page.close(); }
});

test("取得途中の確認・再選択・閉じる・再起動・二重注入・ページ遷移", async () => {
  const { page, sheet } = await open();
  try {
    await select(sheet);
    await page.locator("#event-title").click();
    await sheet.getByRole("button", { name: "内容を確認" }).click();
    await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
    await sheet.locator(".field").first().click();
    await sheet.getByRole("button", { name: "2 場所", exact: true }).click();
    await sheet.getByRole("button", { name: "Sche10leを閉じる" }).click();
    await expect(sheet).toBeHidden();
    await showSheet(worker, page);
    await expect(sheet).toHaveAttribute("data-mode", "review");
    await expect(sheet.locator(".field").first()).toContainText("蔵前の活版印刷ワークショップ");
    await expect(page.locator("sche10le-sheet")).toHaveCount(1);
    await sheet.getByRole("button", { name: "選び直す" }).click();
    await expect(sheet.locator('[aria-expanded="true"]')).toHaveCount(0);
    await select(sheet, /^終日/);
    await sheet.getByRole("button", { name: "内容を確認" }).click();
    await expect(sheet.locator(".field").first()).toContainText("週末のデザイン散歩 | TOKYO FIELD NOTES");
    await page.evaluate(() => history.pushState({}, "", "/?next=1"));
    await expect(sheet).toBeHidden();
    await showSheet(worker, page);
    await expect(sheet).toHaveAttribute("data-mode", "list");
  } finally { await page.close(); }
});

test("別タブへ設定を反映し、再スキャンも拡張自身の文字を候補に含めない", async () => {
  const first = await open(), second = await open();
  try {
    await first.sheet.getByRole("button", { name: "設定", exact: true }).click();
    await chooseTheme(first.sheet, "kurocha");
    await expect(second.page.locator("sche10le-sheet")).toHaveAttribute("data-theme", "kurocha");
    await first.sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true }).fill("10");
    await first.sheet.getByRole("spinbutton", { name: "前後の移動時間（片道・分）", exact: true }).blur();
    await first.sheet.getByRole("button", { name: "戻る", exact: true }).click();
    await first.sheet.getByLabel("日程の並び順").selectOption("date");
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get("candidateOrder")).candidateOrder)).toBe("date");
    await second.sheet.getByRole("button", { name: "再スキャン", exact: true }).click();
    await expect(second.sheet.locator(".candidate")).toHaveCount(3);
    await second.sheet.locator(".candidate-toggle").first().click();
    await expect(second.sheet.getByRole("button", { name: /^移動込み/ })).toContainText("13:50");
    expect(await first.page.locator("html").getAttribute("data-theme")).toBeNull();
  } finally { await first.page.close(); await second.page.close(); }
});

test("ソースを強調し、取得バーを上下に移動して元の位置へ戻せる", async () => {
  const { page, sheet } = await open();
  try {
    await sheet.locator(".candidate-toggle").first().hover();
    await expect(sheet.locator('[aria-expanded="true"]')).toHaveCount(1);
    await expect(page.locator("sche10le-source-highlight .mark").first()).toBeVisible();
    await sheet.getByRole("button", { name: /^時間どおり/ }).click();
    await expect(page.locator("sche10le-source-highlight")).toHaveCount(0);
    await expect.poll(async () => (await sheet.boundingBox()).height).toBe(212);
    const before = await sheet.boundingBox();
    const handle = sheet.getByRole("button", { name: "表示位置を移動" });
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    expect((await sheet.boundingBox()).y).toBeCloseTo(before.y - 16, 0);
    await page.keyboard.press("End");
    expect((await sheet.boundingBox()).y).toBeCloseTo(before.y, 0);
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y - 100, { steps: 5 });
    await page.mouse.up();
    expect((await sheet.boundingBox()).y).toBeLessThan(before.y - 100);
  } finally { await page.close(); }
});
