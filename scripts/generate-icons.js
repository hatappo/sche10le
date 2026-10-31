// Render the shared CSS mark with the existing browser, without new dependencies.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

if (process.platform !== "darwin") {
  throw new Error("アイコン生成はGeorgiaを使用できるmacOSで実行してください");
}
const root = new URL("../", import.meta.url);
const directory = new URL("public/icons/", root);
const theme = await readFile(new URL("lib/theme.css", root), "utf8");
const brand = await readFile(new URL("lib/brand.css", root), "utf8");
const appIcons = new URL("native/safari/Shared (App)/Assets.xcassets/AppIcon.appiconset/", root);
const catalog = JSON.parse(await readFile(new URL("Contents.json", appIcons), "utf8"));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const cache = new Map();
async function render(size, opaque = false) {
  const key = `${size}/${opaque}`;
  if (cache.has(key)) return cache.get(key);
  // Fresh viewports avoid stale compositor tiles after resizing tiny pages.
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  try {
    await page.setContent('<span class="brand-mark" aria-hidden="true">10</span>');
    await page.addStyleTag({ content: `${theme}\n${brand}\n
      * { box-sizing: border-box; }
      html, body { margin: 0; background: ${opaque ? "var(--accent)" : "transparent"}; }
      .brand-mark { position: absolute; transform-origin: top left; }
    ` });
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".brand-mark").evaluate((element, { size, opaque }) => {
      const scale = size * (opaque ? 0.78 : 0.875) / 32;
      element.style.transform = `scale(${scale})`;
      element.style.left = `${(size - 30 * scale) / 2}px`;
      element.style.top = `${(size - 32 * scale) / 2}px`;
    }, { size, opaque });
    const png = await page.screenshot({ omitBackground: !opaque });
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size || (opaque && png[25] !== 2)) {
      throw new Error(`PNGのサイズまたは不透明形式が正しくありません: ${key}`);
    }
    cache.set(key, png);
    return png;
  } finally { await page.close(); }
}
try {
  for (const size of [16, 32, 48, 128]) await writeFile(new URL(`${size}.png`, directory), await render(size));
  const written = new Set();
  for (const entry of catalog.images) {
    if (!entry.filename || written.has(entry.filename)) continue;
    const size = Number(entry.size.split("x")[0]) * Number((entry.scale ?? "1x").replace("x", ""));
    await writeFile(new URL(entry.filename, appIcons), await render(size, entry.platform === "ios"));
    written.add(entry.filename);
  }
  for (const path of ["native/safari/Shared (App)/Resources/Icon.png", "native/safari/Shared (App)/Assets.xcassets/LargeIcon.imageset/128.png"]) {
    await writeFile(new URL(path, root), await render(128));
  }
} finally { await browser.close(); }
