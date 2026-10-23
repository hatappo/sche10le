import { test, expect, chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";

let context;
let server;
let workspace;
let baseUrl;
let extensionId;

test.beforeAll(async () => {
  const fixture = await readFile(
    new URL("../fixtures/events.html", import.meta.url),
  );
  server = createServer((_req, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  workspace = await mkdtemp(path.join(tmpdir(), "sche10le-e2e-"));
  const extension = path.join(workspace, "extension");
  await cp(path.resolve(".output/chrome-mv3"), extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.permissions.sort()).toEqual(
    ["activeTab", "scripting", "sidePanel", "storage"].sort(),
  );
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  // Playwright cannot click Chrome's toolbar to grant activeTab. Only this temporary
  // test copy gets access to the local fixture; the shipping manifest stays minimal.
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(
    path.join(workspace, "profile"),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      viewport: { width: 1000, height: 850 },
      timezoneId: "Asia/Tokyo",
    },
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function open() {
  const source = await context.newPage();
  await source.goto(baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("button", { name: "再スキャン" })).toBeEnabled();
  await source.bringToFront();
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  // Browser-initiated tabs.create navigation can bypass Playwright's first-request
  // interception. Capture the real handoff URL at the API boundary and open a blank tab.
  await panel.evaluate(() => {
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (properties) => {
      window.__calendarRequest = properties.url;
      return create({ ...properties, url: "about:blank" });
    };
  });
  return { source, panel };
}

async function select(panel, label = "時間どおり") {
  const card = panel.locator(".candidate").first();
  await card.hover();
  await card.getByRole("button", { name: new RegExp(label) }).click();
  await expect(panel.locator("#selection")).toBeVisible();
}

// Resolve a real button inside the closed shadow root, then click its screen position.
async function clickOverlay(source, name) {
  const session = await context.newCDPSession(source);
  try {
    const { root } = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(node) {
      const attributes = node.attributes ?? [];
      const index = attributes.indexOf("aria-label");
      if (
        node.nodeName === "BUTTON" &&
        index >= 0 &&
        attributes[index + 1] === name
      )
        return node;
      for (const child of [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
      ]) {
        const found = find(child);
        if (found) return found;
      }
    }
    const target = find(root);
    expect(target, `overlay button: ${name}`).toBeTruthy();
    const { model } = await session.send("DOM.getBoxModel", {
      nodeId: target.nodeId,
    });
    await source.mouse.click(
      (model.content[0] + model.content[4]) / 2,
      (model.content[1] + model.content[5]) / 2,
    );
  } finally {
    await session.detach();
  }
}

test("候補→パターン→ページから順次取得→カレンダーへのURL", async () => {
  const { source, panel } = await open();
  const errors = [];
  await expect(panel.locator(".intro")).toHaveCount(0);
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.screenshot({
    path: "test-results/panel-candidates.png",
    animations: "disabled",
  });
  await panel.locator(".candidate").first().hover();
  await panel.screenshot({
    path: "test-results/panel-variants.png",
    animations: "disabled",
  });
  await select(panel, "移動込み");
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await source.screenshot({
    path: "test-results/page-picker.png",
    animations: "disabled",
  });
  await expect(panel.locator("#picked-title")).toHaveText(
    "週末のデザイン散歩 | TOKYO FIELD NOTES",
  );
  await expect(panel.locator("#picked-details")).toHaveText(`${baseUrl}/`);
  await source.locator("#event-title").click();
  await expect(panel.locator("#field-title .picked-confirmation")).toHaveText(
    "✓",
  );
  await expect(panel.locator("#pick-title")).toHaveText(
    "ページ上の場所をクリック",
  );
  await source.locator("#venue").click();
  await expect(panel.locator("#pick-title")).toHaveText(
    "ページ上の詳細をクリック",
  );
  await source.locator("#description").click();
  await expect(panel.locator("#pick-title")).toHaveText("カレンダーへ進めます");
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await expect(panel.locator("#picked-details")).toHaveText(
    `受付は開始30分前から。入口でチケットを提示してください。\n\n${baseUrl}/`,
  );
  await panel.screenshot({ path: "test-results/panel-picked.png" });
  await source.screenshot({ path: "test-results/page-picker-complete.png" });
  // Completing all three fields keeps the guide, but ordinary page clicks no longer pick.
  await source.locator("#event-title").click();
  await expect(panel.locator("#pick-title")).toHaveText("カレンダーへ進めます");
  await clickOverlay(source, "戻る");
  await expect(panel.locator("#pick-title")).toContainText("詳細");
  await source.locator("#venue").click();
  await expect(panel.locator("#picked-details")).toHaveText(
    `東京都台東区蔵前3丁目 アトリエ蔵前\n\n${baseUrl}/`,
  );
  await clickOverlay(source, "詳細を選び直す");
  await source.locator("#description").click();
  await expect(panel.locator("#picked-details")).toHaveText(
    `受付は開始30分前から。入口でチケットを提示してください。\n\n${baseUrl}/`,
  );
  await clickOverlay(source, "タイトルを選び直す");
  await expect(panel.locator('#steps button[aria-current="step"]')).toHaveText(
    "タイトル",
  );
  await source.locator("#event-title").click();
  const opened = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Googleカレンダーで開く" }).click();
  const calendar = await opened;
  const url = new URL(await panel.evaluate(() => window.__calendarRequest));
  expect(url.searchParams.get("text")).toBe("蔵前の活版印刷ワークショップ");
  expect(url.searchParams.get("location")).toContain("アトリエ蔵前");
  expect(url.searchParams.get("dates")).toBe(
    "20261108T043000Z/20261108T073000Z",
  );
  expect(url.searchParams.get("details")).toContain("開催日時:");
  expect(url.searchParams.get("details").endsWith(`${baseUrl}/`)).toBe(true);
  expect(errors).toEqual([]);
  await calendar.close();
  await panel.close();
  await source.close();
});

test("未取得で開く・スキップ・戻る・選び直しとEscape", async () => {
  const { source, panel } = await open();
  await select(panel, "終日で確保");
  await panel.getByRole("button", { name: "スキップ" }).click();
  await expect(panel.locator("#pick-title")).toContainText("場所");
  await panel.getByRole("button", { name: "← 戻る" }).click();
  await expect(panel.locator("#pick-title")).toContainText("タイトル");
  await source.keyboard.press("Escape");
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "ページから取得を再開" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "ページから取得を再開" }).click();
  await source.locator("#event-link").click();
  expect(source.url()).toBe(`${baseUrl}/`);
  await expect(panel.locator("#picked-title")).toHaveText(
    "活版印刷について詳しく",
  );
  await panel.getByRole("button", { name: "選び直す" }).click();
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await select(panel, "終日で確保");
  const opened = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Googleカレンダーで開く" }).click();
  const calendar = await opened;
  const url = new URL(await panel.evaluate(() => window.__calendarRequest));
  expect(url.searchParams.get("dates")).toBe("20261108/20261109");
  expect(url.searchParams.get("text")).toBe(
    "週末のデザイン散歩 | TOKYO FIELD NOTES",
  );
  expect(url.searchParams.get("location")).toBe("");
  expect(url.searchParams.get("details")).toBe(`${baseUrl}/`);
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await calendar.close();
  await panel.close();
  await source.close();
});

test("移動時間を保存でき、ページ遷移・パネル終了で選択を解除する", async () => {
  const { source, panel } = await open();
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await panel.locator("#travel").fill("30");
  await panel.locator("#travel").press("ArrowUp");
  await expect(panel.locator("#travel")).toHaveValue("35");
  await panel.locator("#travel").press("ArrowDown");
  await expect(panel.locator("#travel")).toHaveValue("30");
  await panel.locator("#travel").fill("45");
  await expect(panel.locator("#settings-status")).toContainText("保存しました");
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  await select(panel, "移動込み");
  await expect(panel.locator("#selected-time")).toContainText("13:15–16:45");
  await source.locator("#spa").click();
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(panel.locator("#selection")).toBeHidden();
  await expect(panel.locator(".candidate")).toHaveCount(0);
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  await select(panel);
  await panel.close();
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await source.close();
});

test("タイトル書式をプレビュー・保存し、選び直しと再表示でも維持する", async () => {
  const { source, panel } = await open();
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await panel.locator("#title-format").fill("{unknown}");
  await expect(panel.locator("#title-format")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(panel.locator("#format-preview-label")).toHaveText(
    "書式エラー・適用できません",
  );
  await expect(panel.locator(".format-preview")).toHaveClass(/error/);
  await expect(panel.locator("#format-preview")).toHaveCSS(
    "color",
    "rgb(151, 45, 40)",
  );
  await panel.screenshot({ path: "test-results/panel-format-error.png" });
  await panel.locator("#title-format").fill("{from:hhmm} {title} あいうえお");
  await expect(panel.locator("#format-preview")).toHaveText(
    "1730 勉強会 あいうえお",
  );
  // Valid input is applied and persisted without an extra save action.
  await expect(panel.locator("#format-status")).toContainText("保存しました");
  await panel.screenshot({
    path: "test-results/panel-title-settings.png",
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  await select(panel);
  await source.locator("#event-title").click();
  await expect(panel.locator("#picked-title")).toHaveText(
    "1400 蔵前の活版印刷ワークショップ あいうえお",
  );
  const titleStep = panel.locator("#steps li").first();
  const bounds = await titleStep.boundingBox();
  // Click the actual pill's edge, outside the label and number.
  await panel.mouse.click(bounds.x + 3, bounds.y + 3);
  await expect(panel.locator('#steps button[data-step="0"]')).toHaveAttribute(
    "aria-current",
    "step",
  );
  await source.locator("#event-link").click();
  await expect(panel.locator("#picked-title")).toHaveText(
    "1400 活版印刷について詳しく あいうえお",
  );
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await panel.locator("#title-format").fill("{title} 一時的な編集");
  await expect(panel.locator("#picked-title")).toHaveText(
    "活版印刷について詳しく 一時的な編集",
  );
  await panel.locator("#title-format").fill("{from:hhmm} {title} あいうえお");
  await expect(panel.locator("#format-status")).toContainText(
    "自動保存しました",
  );
  await panel.locator("#title-format").fill("{unsupported}");
  await expect(panel.locator("#format-status")).toContainText(
    "適用・保存されません",
  );
  await expect(panel.locator("#picked-title")).toHaveText(
    "1400 活版印刷について詳しく あいうえお",
  );
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  const opened = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Googleカレンダーで開く" }).click();
  const calendar = await opened;
  const url = new URL(await panel.evaluate(() => window.__calendarRequest));
  expect(url.searchParams.get("text")).toBe(
    "1400 活版印刷について詳しく あいうえお",
  );
  await calendar.close();
  await panel.close();
  await source.close();
  const next = await open();
  await select(next.panel, "終日で確保");
  await expect(next.panel.locator("#picked-title")).toHaveText(
    "週末のデザイン散歩 | TOKYO FIELD NOTES あいうえお",
  );
  await next.panel.close();
  await next.source.close();
});

test("狭い幅・キーボード操作・再走査時のリスナー重複を確認する", async () => {
  const { source, panel } = await open();
  await panel.setViewportSize({ width: 300, height: 700 });
  await panel.emulateMedia({ reducedMotion: "reduce" });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  const first = panel.locator(".candidate-heading").first();
  await first.focus();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await panel.keyboard.press("Tab");
  await expect(panel.locator(".variant").first()).toBeFocused();
  await panel.keyboard.press("Enter");
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await source.locator("#event-title").focus();
  await source.keyboard.press("Enter");
  await expect(panel.locator("#pick-title")).toContainText("場所");
  await expect(panel.locator("#picked-location")).toHaveText("未設定");
  await expect(panel.locator(".variant-region").first()).toBeHidden();
  expect(
    await panel.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: "test-results/panel-narrow.png",
    animations: "disabled",
  });
  await panel.close();
  await source.close();
});

test("候補のホバー・フォーカスで元の日時へスクロールし、離脱・選択で強調を解除する", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    document.querySelector("main").style.paddingTop = "1600px";
    document.querySelector(".date").innerHTML =
      "<span>２０２６年１１月８日</span>（日）<strong>１４：００〜１６：００</strong>";
    document.querySelector(".date").style.fontSize = "10px";
    document.querySelector(".date").style.width = "120px";
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  const target = source.locator(".date").first();
  await expect(target).not.toBeInViewport();
  const first = panel.locator(".candidate").first();
  await first.hover();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(1);
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      target.locator("span").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
      }),
    )
    .toBeLessThan(2);
  expect(
    await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.left + 5, rect.top + 5),
      );
    }),
  ).toBe(true);
  await source.screenshot({ path: "test-results/page-source-highlight.png" });
  // The page's original text and inline markup remain intact.
  await expect(target.locator("strong")).toHaveText("１４：００〜１６：００");
  await panel.locator(".header").hover();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  await source.emulateMedia({ reducedMotion: "reduce" });
  await source.evaluate(() => window.scrollTo(0, 0));
  await first.locator(".candidate-heading").focus();
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(1);
  await first.getByRole("button", { name: /時間どおり/ }).click();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  await panel.getByRole("button", { name: "選び直す" }).click();
  // Changed text after the scan must not be highlighted using stale offsets.
  await target.evaluate((element) => {
    element.textContent = "開催日調整中";
  });
  await first.hover();
  await panel.waitForTimeout(250);
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  await panel.locator(".candidate").last().hover();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(1);
  await panel.close();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  await source.close();
});

test("設定を独立表示し、3項目を自動保存・失敗時だけ共通の再試行にする", async () => {
  const { source, panel } = await open();
  await select(panel);
  await source.locator("#event-title").click();
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await expect(panel.locator("main")).toBeHidden();
  await expect(panel.locator("#footer")).toBeHidden();
  await expect(panel.locator("#settings")).toContainText(
    "変更は自動保存されます",
  );
  await expect(panel.getByRole("button", { name: /保存|再試行/ })).toHaveCount(
    0,
  );
  await panel.locator("#travel").fill("181");
  await expect(panel.locator("#travel")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(panel.locator("#settings-status")).toHaveClass(/error/);
  await panel.locator("#travel").fill("35");
  await expect(panel.locator("#settings-status")).toHaveText(
    "自動保存しました",
  );
  await panel.locator("#ai-enabled").check();
  await expect(panel.locator("#ai-settings-status")).toHaveText(
    "自動保存しました",
  );
  await panel.locator("#ai-enabled").uncheck();
  await expect(panel.locator("#ai-settings-status")).toHaveText(
    "自動保存しました",
  );
  // All settings use the same failure feedback and retry interaction.
  await panel.evaluate(() => {
    window.__saveSettings = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async () => {
      throw new Error("test storage failure");
    };
  });
  for (const [inputId, value, statusId, retryId] of [
    ["travel", "40", "settings-status", "retry-travel"],
    ["title-format", "{title} テスト", "format-status", "retry-format"],
    ["ai-enabled", true, "ai-settings-status", "retry-ai"],
  ]) {
    if (typeof value === "boolean") await panel.locator(`#${inputId}`).check();
    else await panel.locator(`#${inputId}`).fill(value);
    await expect(panel.locator(`#${statusId}`)).toHaveClass(/error/);
    await expect(panel.locator(`#${retryId}`)).toBeVisible();
    await expect(panel.locator(`#${retryId}`)).toHaveText("再試行");
  }
  await panel.evaluate(() => {
    chrome.storage.local.set = window.__saveSettings;
  });
  for (const id of ["retry-travel", "retry-format", "retry-ai"]) {
    await panel.locator(`#${id}`).click();
    await expect(panel.locator(`#${id}`)).toBeHidden();
  }
  await expect
    .poll(() =>
      panel.evaluate(() =>
        chrome.storage.local.get(["travelMinutes", "titleFormat", "aiEnabled"]),
      ),
    )
    .toEqual({
      travelMinutes: 40,
      titleFormat: "{title} テスト",
      aiEnabled: true,
    });
  await panel.setViewportSize({ width: 300, height: 700 });
  await panel.screenshot({
    path: "test-results/settings-unified.png",
    fullPage: true,
  });
  expect(
    await panel.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(panel.locator("#picked-title")).toHaveText(
    "蔵前の活版印刷ワークショップ テスト",
  );
  await expect(panel.locator("#footer")).toBeVisible();
  await panel.close();
  await source.close();
});

test("同日の異なる時刻は残し、重複する終日の選択肢と空になる候補を除く", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    const extra = document.createElement("section");
    extra.innerHTML = "<p>2026年11月8日 18:00〜20:00</p><p>2026年11月8日</p>";
    document.querySelector("main").append(extra);
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(4);
  await expect(panel.locator("#count")).toHaveText("4");
  await expect(
    panel.locator(".variant-label").filter({ hasText: "終日で確保" }),
  ).toHaveCount(3);
  const later = panel.locator(".candidate").last();
  await later.hover();
  await expect(later.getByRole("button", { name: /時間どおり/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /移動込み/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /終日で確保/ })).toHaveCount(
    0,
  );
  await later.getByRole("button", { name: /時間どおり/ }).click();
  await expect(panel.locator("#selected-time")).toContainText("18:00–20:00");
  await panel.getByRole("button", { name: "選び直す" }).click();
  await select(panel, "終日で確保");
  await expect(panel.locator("#selected-time")).toContainText("終日");
  await panel.close();
  await source.close();
});
