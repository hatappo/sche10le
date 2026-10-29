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

test("PRの回帰検証はローカルの3チェックを実行し、実サイト検証や書き込み権限を含めない", async () => {
  const workflow = await readFile(".github/workflows/regression.yml", "utf8");
  assert.ok(workflow.includes("pull_request:\n    branches: [main]"));
  assert.ok(workflow.includes("permissions:\n  contents: read"));
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|: write|npm run test:live|LIVE_SITES:/);
  for (const command of ["check", "test:e2e", "test:ui"]) {
    assert.ok(workflow.includes(`bash scripts/ci/run-playwright.sh npm run ${command}`));
  }
  const runner = await readFile("scripts/ci/run-playwright.sh", "utf8");
  assert.match(runner, /--env PLAYWRIGHT_CHROMIUM_SANDBOX=1/);
  assert.doesNotMatch(runner, /--privileged|seccomp=unconfined/);
});
