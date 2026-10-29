import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let server;
let origin;
const root = "native/safari/Shared (App)/Resources";
const routes = {
  "/Base.lproj/Main.html": [`${root}/Base.lproj/Main.html`, "text/html; charset=utf-8"],
  "/Style.css": [`${root}/Style.css`, "text/css"],
  "/Script.js": [`${root}/Script.js`, "text/javascript"],
  "/Icon.png": [`${root}/Icon.png`, "image/png"],
  "/theme.css": ["lib/theme.css", "text/css"],
};

test.beforeAll(async () => {
  const resources = new Map(await Promise.all(Object.entries(routes).map(async ([url, [file, type]]) => [url, { body: await readFile(file), type }])));
  server = createServer((req, res) => {
    const resource = resources.get(req.url);
    if (!resource) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": resource.type }); res.end(resource.body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

async function start(page, platform = "ios", enabled, modern = true) {
  await page.goto(`${origin}/Base.lproj/Main.html`);
  await page.evaluate(({ platform, enabled, modern }) => window.show(platform, enabled, modern), { platform, enabled, modern });
}

test("iPhoneの案内は有効化と起動を区別し、OSによって設定経路を切り替える", async ({ page }, info) => {
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await start(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["機能拡張をオンにする", "日程のあるページで起動する"]);
  await expect(page.locator(".ios-apps")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator("figure.platform-ios")).toBeVisible();
  expect(await page.locator("img").evaluateAll(nodes => nodes.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: `test-results/onboarding-${info.project.name}-ios.png`, fullPage: true });
  await page.evaluate(() => window.show("ios", undefined, false));
  await expect(page.locator(".ios-apps")).toBeHidden();
  expect(await page.locator(".path").innerText()).not.toContain("アプリ");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; document.body.style.fontSize = "24px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("footer")).toBeInViewport();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("footer")).toBeInViewport();
  expect(requests.every(url => url.startsWith(origin))).toBe(true);
  expect(errors).toEqual([]);
});

test("Macの設定への導線は状態・エラー・再試行を示し、外部へ自動遷移しない", async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 700 });
  await page.addInitScript(() => {
    window.__nativeMessages = [];
    window.webkit = { messageHandlers: { controller: { postMessage: value => window.__nativeMessages.push(value) } } };
  });
  await start(page, "mac");
  const button = page.getByRole("button", { name: "Safariの設定を開く" });
  await expect(page.locator("#extension-state")).toContainText("確認できます");
  await page.evaluate(() => window.show("mac", false, true));
  await expect(page.locator("#extension-state")).toContainText("まだ有効になっていません");
  await button.click();
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeMessages)).toEqual(["open-preferences"]);
  await page.evaluate(() => window.showSettingsResult(false));
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await page.evaluate(() => { window.showSettingsResult(true); window.show("mac", true, true); });
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("#extension-state")).toContainText("Sche10leは有効です");
  expect(page.url()).toBe(`${origin}/Base.lproj/Main.html`);
  await page.screenshot({ path: `test-results/onboarding-${info.project.name}-mac.png`, fullPage: true });
  await page.evaluate(() => window.show("mac", true, false));
  await expect(page.getByRole("button", { name: "Safariの環境設定を開く" })).toBeVisible();
  await page.evaluate(() => { delete window.webkit; });
  await page.getByRole("button", { name: "Safariの環境設定を開く" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button")).toBeEnabled();
});

test("案内画面も共通パレットでシステムの明暗に追従する", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await start(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chitosemidori");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aitetsu");
  expect(await page.locator("html").evaluate(node => getComputedStyle(node).colorScheme)).toBe("dark");
  await page.screenshot({ path: `test-results/onboarding-${info.project.name}-dark.png`, fullPage: true });
});
