import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = new URL("../", import.meta.url);
const html = new URL("docs/design/design-system.html", root).href;
const expectedMarkdown = await readFile(
  new URL("docs/design/design-system.md", root),
  "utf8",
);
const output = new URL("test-results/design-system/", root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    offline: true,
  });
  const page = await context.newPage();
  const errors = [];
  const remoteRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await page.goto(html);
  assert.equal(
    await page.locator("#markdown-source").textContent(),
    expectedMarkdown,
  );
  await expect(page.locator(".swatch")).toHaveCount(7);
  assert.ok(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every((img) => img.complete && img.naturalWidth > 0),
      ),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: fileURLToPath(new URL("desktop.png", output)),
  });
  const frame = page.frameLocator("#panel-demo");
  assert.ok(
    await frame
      .locator(".brand img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  await expect(frame.locator("header, a.brand")).toHaveCount(0);
  await expect(frame.locator(".footer .settings-button")).toBeVisible();
  await page.locator("#panel-demo").scrollIntoViewIfNeeded();
  await frame.locator(".candidate-heading").focus();
  await expect(frame.locator(".candidate")).toHaveClass(/expanded/);
  await frame.getByRole("button", { name: /移動込み/ }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-demo", "pick");
  await expect(page.locator('[data-view="pick"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(frame.locator("#variant-label")).toContainText("13:30–16:30");
  await page.getByRole("button", { name: "書式エラー", exact: true }).click();
  await expect(frame.locator("#format")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(frame.locator(".format-preview")).toHaveClass(/error/);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(frame.locator(".format-preview")).not.toHaveClass(/error/);
  await page.getByRole("button", { name: "取得中", exact: true }).click();
  await page.locator("#components").screenshot({
    animations: "disabled",
    path: fileURLToPath(new URL("components.png", output)),
  });
  await page.getByRole("button", { name: "取得完了を再生" }).click();
  await expect(page.locator(".motion-check")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "取得完了を再生" }).click();
  const transforms = await page.locator(".motion-check").evaluate((el) =>
    el
      .getAnimations()
      .flatMap((animation) => animation.effect.getKeyframes())
      .map((frame) => frame.transform),
  );
  assert.ok(transforms.every((value) => value === undefined));
  for (const [index, button] of (
    await page.locator("[data-download]").all()
  ).entries()) {
    const waiting = page.waitForEvent("download");
    await button.click();
    const download = await waiting;
    assert.equal(download.suggestedFilename(), "sche10le-design-system.md");
    const path = fileURLToPath(new URL(`download-${index}.md`, output));
    await download.saveAs(path);
    assert.equal(await readFile(path, "utf8"), expectedMarkdown);
  }
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole("button", { name: "コピー", exact: true }).click();
  await expect(page.locator("#action-status")).toContainText("全文を選択");
  assert.equal(
    await page.evaluate(() => getSelection().toString()),
    expectedMarkdown.trimEnd(),
  );
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${width}pxの横方向のはみ出し`,
    );
    await page.screenshot({
      animations: "disabled",
      path: fileURLToPath(new URL(`mobile-${width}.png`, output)),
    });
    await page.locator("#components").screenshot({
      animations: "disabled",
      path: fileURLToPath(new URL(`components-${width}.png`, output)),
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  console.log(
    "PASS: オフライン表示、画像、UI状態、キーボード、動きを減らす設定、2つのDLボタンの内容一致、コピー失敗時、1440/390/320px表示",
  );
  await context.close();
} finally {
  await browser.close();
}
