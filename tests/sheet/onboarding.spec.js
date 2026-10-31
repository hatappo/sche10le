import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let server;
let origin;
const root = "native/safari/Shared (App)/Resources";
const routes = {
  "/Base.lproj/Main.html": [`${root}/Base.lproj/Main.html`, "text/html; charset=utf-8"],
  "/Style.css": [`${root}/Style.css`, "text/css"],
  "/AppIcons.js": [`${root}/AppIcons.js`, "text/javascript"],
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
  await expect(page.getByRole("button", { name: "アプリの設定", exact: true })).toBeVisible();
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
  const policy = page.getByRole("link", { name: "プライバシーポリシー" });
  await expect(policy).toBeVisible();
  await expect(policy).toHaveAttribute("href", "https://github.com/hatappo/sche10le/blob/main/PRIVACY.md");
  expect((await policy.boundingBox()).height).toBeGreaterThanOrEqual(44);
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

test("iPhoneのアイコンは6色から選び、OSの成功・失敗・再起動後の状態を反映する", async ({ page }, info) => {
  await page.addInitScript(() => {
    window.__nativeMessages = [];
    window.webkit = { messageHandlers: { controller: { postMessage: value => window.__nativeMessages.push(value) } } };
  });
  await start(page);
  await page.evaluate(() => window.showIconState({ supported: true, current: "AppIcon", busy: false }));
  await page.getByRole("button", { name: "アプリの設定", exact: true }).click();
  await expect(page.locator(".guide")).toBeHidden();
  const choices = page.locator(".icon-choice");
  await expect(choices).toHaveCount(6);
  expect(await choices.locator("img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth === 128))).toBe(true);
  const primary = page.getByRole("button", { name: "千歳緑（ちとせみどり）", exact: true });
  const purple = page.getByRole("button", { name: "紫紺（しこん）", exact: true });
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await primary.click();
  expect(await page.evaluate(() => window.__nativeMessages)).toEqual(["get-icon-state"]);
  await purple.click();
  await expect(purple).toBeDisabled();
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#icon-status")).toHaveText("アイコンを変更しています。");
  expect(await page.evaluate(() => window.__nativeMessages.at(-1))).toEqual({ action: "set-icon", name: "AppIcon-shikon" });
  await page.evaluate(() => window.showIconState({ supported: true, current: "AppIcon", error: true }));
  await expect(page.locator("#icon-error")).toBeVisible();
  await expect(purple).toBeEnabled();
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await purple.click();
  await page.evaluate(() => window.showIconState({ supported: true, current: "AppIcon-shikon" }));
  await expect(purple).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#icon-error")).toBeHidden();
  await expect(page.locator("#icon-status")).toHaveText("現在のアイコン：紫紺");
  await page.screenshot({ path: `test-results/app-icons-${info.project.name}.png`, fullPage: true });
  await primary.click();
  expect(await page.evaluate(() => window.__nativeMessages.at(-1))).toEqual({ action: "set-icon", name: "AppIcon" });
  await page.evaluate(() => window.showIconState({ supported: true, current: "AppIcon" }));
  await page.getByRole("button", { name: "使い方に戻る", exact: true }).click();
  await expect(page.locator(".guide")).toBeVisible();
  await expect(page.getByRole("button", { name: "アプリの設定", exact: true })).toBeFocused();
  await page.reload();
  await page.evaluate(() => { window.show("ios"); window.showIconState({ supported: true, current: "AppIcon-shikon" }); });
  await page.getByRole("button", { name: "アプリの設定", exact: true }).click();
  await expect(purple).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("アイコン変更が非対応・通信失敗の場合を伝え、Macには設定を出さない", async ({ page }) => {
  await start(page, "mac");
  await expect(page.getByRole("button", { name: "アプリの設定", exact: true })).toBeHidden();
  await page.evaluate(() => window.show("ios"));
  await page.getByRole("button", { name: "アプリの設定", exact: true }).click();
  await expect(page.locator("#icon-error")).toBeVisible();
  await page.evaluate(() => window.showIconState({ supported: false, current: "AppIcon" }));
  await expect(page.locator("#icon-status")).toContainText("変更できません");
  for (const button of await page.locator(".icon-choice").all()) await expect(button).toBeDisabled();
  await page.evaluate(() => window.showIconState({ supported: true, current: "AppIcon" }));
  await page.getByRole("button", { name: "銀鼠（ぎんねず）", exact: true }).click();
  await expect(page.locator("#icon-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "銀鼠（ぎんねず）", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "千歳緑（ちとせみどり）", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("iPhone用アイコンの背景に色の段差がなく、拡大した横線が欠けていない", async ({ page }) => {
  const names = ["AppIcon", "AppIcon-ginnezu", "AppIcon-mizuasagi", "AppIcon-aitetsu", "AppIcon-kurocha", "AppIcon-shikon"];
  for (const name of names) {
    const file = name === "AppIcon" ? "universal-icon-1024@1x.png" : "icon.png";
    const bytes = await readFile(`native/safari/Shared (App)/Assets.xcassets/${name}.appiconset/${file}`);
    const pixels = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return [[0, 0], [20, 512], [512, 50], [100, 512], [512, 240]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    }, `data:image/png;base64,${bytes.toString("base64")}`);
    for (const pixel of pixels.slice(1, 4)) expect(pixel, name).toEqual(pixels[0]);
    expect(pixels[4], name).not.toEqual(pixels[0]);
    expect(pixels[4][3], name).toBe(255);
  }
});
