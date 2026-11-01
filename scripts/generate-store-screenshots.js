// Capture the real extension on the repository's local example page.
// The temporary copy alone gets local host access; production permissions stay unchanged.
import { chromium, expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSheetPreviewServer } from "./preview-sheet.js";
import { showSheet } from "../tests/support/sheet.js";

const workspace = await mkdtemp(path.join(tmpdir(), "sche10le-store-"));
const server = await createSheetPreviewServer({ native: true });
let context;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const extension = path.join(workspace, "extension");
  await cp(path.resolve(".output/chrome-mv3"), extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.host_permissions).toBeUndefined();
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(workspace, "profile"), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await showSheet(worker, page);
  const sheet = page.locator("sche10le-sheet .sheet");
  await expect(sheet.locator(".candidate")).toHaveCount(3);
  const capture = async (number) => {
    await page.mouse.move(10, 10);
    await page.screenshot({ path: `store/screenshots/sche10le-screenshot-${number}.png`, animations: "disabled" });
  };
  await capture(1);
  await sheet.locator(".candidate-toggle").first().click();
  await sheet.getByRole("button", { name: /^時間どおり/ }).click();
  await page.locator("#event-title").click();
  await expect(sheet.locator("h2")).toHaveText("場所を選択");
  await capture(2);
  await page.locator("address").first().click();
  await page.locator("#description").click();
  await expect(sheet).toHaveAttribute("data-mode", "review");
  await expect(sheet.locator(".field.done")).toHaveCount(3);
  await capture(3);
  await sheet.getByRole("button", { name: "設定", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-mode", "settings");
  await capture(4);
  console.log("Captured four 1280×800 screenshots from the Chrome extension.");
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}
