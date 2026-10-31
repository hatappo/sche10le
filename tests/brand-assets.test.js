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

test("全テーマの代替アイコンと設定の見本を同梱し、iOSのDebug・Releaseに登録する", async () => {
  const { THEMES, DEFAULT_THEME } = await import("../lib/themes.js");
  const { runInNewContext } = await import("node:vm");
  const sandbox = {};
  runInNewContext(await readFile(new URL("Resources/AppIcons.js", app), "utf8"), sandbox);
  const choices = sandbox.APP_ICONS;
  assert.deepEqual(Array.from(choices, icon => icon.theme), THEMES.map(theme => theme.id));
  const project = await readFile(new URL("../native/safari/Sche10le.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  const settings = [...project.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]+)";/g)];
  assert.equal(settings.length, 2);
  for (const choice of choices) {
    const preview = Buffer.from(choice.image.split(",")[1], "base64");
    dimensions(preview, 128);
    assert.equal(preview[25], 2);
    if (choice.theme === DEFAULT_THEME) { assert.equal(choice.id, "AppIcon"); continue; }
    for (const setting of settings) assert.ok(setting[1].split(" ").includes(choice.id));
    const directory = new URL(`Assets.xcassets/${choice.id}.appiconset/`, app);
    const catalog = JSON.parse(await readFile(new URL("Contents.json", directory), "utf8"));
    const png = await readFile(new URL(catalog.images[0].filename, directory));
    dimensions(png, 1024);
    assert.equal(png[25], 2);
  }
});
