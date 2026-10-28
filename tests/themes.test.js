import assert from "node:assert/strict";
import { test } from "node:test";
import { THEMES, DEFAULT_THEME, resolveTheme } from "../lib/themes.js";

test("伝統色テーマは安定したASCII IDと日本語名を持ち、未知の設定は千歳緑に戻る", () => {
  assert.equal(DEFAULT_THEME, "chitosemidori");
  assert.deepEqual(THEMES.map((theme) => theme.name), ["千歳緑", "銀鼠", "水浅葱", "藍鉄", "黒茶", "紫紺"]);
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z]+$/);
    assert.ok(theme.reading);
    assert.equal(resolveTheme(theme.id), theme.id);
  }
  for (const invalid of [undefined, null, "", "dark", "__proto__", "toString", {}, 1, "aitetsu\";color:red"]) {
    assert.equal(resolveTheme(invalid), DEFAULT_THEME);
  }
});
