// Render the sidebar's actual CSS mark. No extra runtime or build dependencies.
// Run on macOS with Georgia installed to match the approved brand typography.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

if (process.platform !== "darwin") {
  throw new Error("アイコン生成はGeorgiaを使用できるmacOSで実行してください");
}

const directory = new URL("../public/icons/", import.meta.url);
const theme = await readFile(
  new URL("../lib/theme.css", import.meta.url),
  "utf8",
);
const sidebar = await readFile(
  new URL("../entrypoints/sidepanel/style.css", import.meta.url),
  "utf8",
);
// Include both .brand-mark declarations and its decorative pseudo-element.
const mark = sidebar.match(/\.brand-mark(?::before)?\s*\{[^}]*\}/g);
if (mark?.length !== 3)
  throw new Error("ブランドのアイコンCSSを確認してください");

await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const size of [16, 32, 48, 128]) {
    // Fresh viewports avoid stale compositor tiles after resizing tiny pages.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<span class="brand-mark" aria-hidden="true">10</span>',
    );
    await page.addStyleTag({
      content: `${theme}\n${mark.join("\n")}\n
        * { box-sizing: border-box; }
        html, body { margin: 0; background: transparent; }
        .brand-mark { position: absolute; transform-origin: top left; }
      `,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".brand-mark").evaluate((element, size) => {
      // Keep the mark's 30:32 aspect ratio with transparent outer padding.
      const scale = (size * 0.875) / 32;
      element.style.transform = `scale(${scale})`;
      element.style.left = `${(size - 30 * scale) / 2}px`;
      element.style.top = `${size * 0.0625}px`;
    }, size);
    const png = await page.screenshot({ omitBackground: true });
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
      throw new Error(`PNGのサイズが正しくありません: ${size}`);
    }
    await writeFile(new URL(`${size}.png`, directory), png);
    await page.close();
  }
} finally {
  await browser.close();
}
