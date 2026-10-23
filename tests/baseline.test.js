import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("実行時の追加パッケージを持たない", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});
