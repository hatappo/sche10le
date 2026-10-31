import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = new URL("../native/safari/Shared (App)/", import.meta.url);
const icons = new URL("../public/icons/", import.meta.url);
function dimensions(png, size) {
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
test("拡張とSafariアプリの全アイコンが規定寸法で、iOS用はアルファを持たない", async () => {
  for (const size of [16, 32, 48, 128]) dimensions(await readFile(new URL(`${size}.png`, icons)), size);
  const directory = new URL("Assets.xcassets/AppIcon.appiconset/", app);
  const catalog = JSON.parse(await readFile(new URL("Contents.json", directory), "utf8"));
  for (const image of catalog.images) {
    const png = await readFile(new URL(image.filename, directory));
    const size = Number(image.size.split("x")[0]) * Number((image.scale ?? "1x").replace("x", ""));
    dimensions(png, size);
    if (image.platform === "ios") assert.equal(png[25], 2, "iOSはRGB形式");
    if (image.idiom === "mac" && [16, 32, 128].includes(size)) assert.deepEqual(png, await readFile(new URL(`${size}.png`, icons)));
  }
  const shared = await readFile(new URL("128.png", icons));
  assert.deepEqual(await readFile(new URL("Resources/Icon.png", app)), shared);
  assert.deepEqual(await readFile(new URL("Assets.xcassets/LargeIcon.imageset/128.png", app)), shared);
});
