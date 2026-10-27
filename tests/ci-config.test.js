import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CIの公式イメージとインストールするPlaywrightのバージョンが一致する", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const image = (
    await readFile("scripts/ci/playwright-image.txt", "utf8")
  ).trim();
  const version = image.match(
    /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[a-f0-9]{64}$/,
  )?.[1];
  assert.ok(version, "公式イメージのバージョンとダイジェストを固定してください");
  assert.equal(version, pkg.devDependencies["@playwright/test"]);
  assert.equal(version, lock.packages["node_modules/playwright-core"].version);
});
