// Typography and vector artwork are rendered locally; no network or new packages.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

if (process.platform !== "darwin") {
  throw new Error(
    "ストア画像はGeorgia・ヒラギノを使用できるmacOSで生成してください",
  );
}
const directory = new URL("../store/promotional/", import.meta.url);
const html = await readFile(new URL("tiles.html", directory), "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const [name, width, height] of [
    ["small-440x280.png", 440, 280],
    ["marquee-1400x560.png", 1400, 560],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground: false });
    // PNG IHDR: dimensions, 8 bits per channel, truecolor RGB (no alpha).
    if (
      png.readUInt32BE(16) !== width ||
      png.readUInt32BE(20) !== height ||
      png[24] !== 8 ||
      png[25] !== 2
    )
      throw new Error(`24ビットRGB・指定サイズのPNGではありません: ${name}`);
    await writeFile(new URL(name, directory), png);
    await page.close();
    console.log(`${name}: ${width}×${height}, 24-bit RGB, no alpha`);
  }
} finally {
  await browser.close();
}
