import { test, expect, chromium } from "@playwright/test";
import { FOOTER_QUOTES } from "../../lib/footer-quotes.js";
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

async function open(footerRandom) {
  const source = await context.newPage();
  await source.goto(baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 900 });
  if (footerRandom !== undefined)
    await panel.addInitScript((value) => {
      Math.random = () => value;
    }, footerRandom);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("button", { name: "再スキャン" })).toBeEnabled();
  await source.bringToFront();
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  await expect(panel.locator("#scan-state")).toHaveText("スキャン完了");
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

async function expectPickerActionsOnly(source, step = 0) {
  const session = await context.newCDPSession(source);
  try {
    const { root } = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const labels = [];
    const visibleLabels = [];
    const disabledLabels = [];
    const actionNodes = [];
    let guide;
    function visit(node) {
      const attributes = node.attributes ?? [];
      const index = attributes.indexOf("aria-label");
      if (
        attributes[attributes.indexOf("class") + 1]
          ?.split(" ")
          .includes("guide")
      )
        guide = node;
      if (node.nodeName === "BUTTON" && index >= 0) {
        labels.push(attributes[index + 1]);
        if (attributes.includes("disabled"))
          disabledLabels.push(attributes[index + 1]);
        if (["戻る", "スキップ", "閉じる"].includes(attributes[index + 1]))
          actionNodes.push(node);
        if (!attributes.includes("hidden"))
          visibleLabels.push(attributes[index + 1]);
      }
      for (const child of [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
      ])
        visit(child);
    }
    visit(root);
    expect(labels).toEqual(
      expect.arrayContaining([
        "タイトルを選び直す",
        "場所を選び直す",
        "詳細を選び直す",
        "戻る",
        "スキップ",
      ]),
    );
    expect(labels).not.toContain("Googleカレンダーで開く");
    expect(labels).not.toContain("一時停止");
    expect(visibleLabels).toContain("閉じる");
    expect(visibleLabels).toEqual(expect.arrayContaining(["戻る", "スキップ"]));
    expect(disabledLabels.includes("戻る")).toBe(step === 0);
    expect(disabledLabels.includes("スキップ")).toBe(step === 3);
    const { model } = await session.send("DOM.getBoxModel", {
      nodeId: guide.nodeId,
    });
    const positions = [];
    for (const node of actionNodes) {
      const { model: button } = await session.send("DOM.getBoxModel", {
        nodeId: node.nodeId,
      });
      positions.push(button.border);
    }
    return { width: model.width, height: model.height, positions };
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
  await expectPickerActionsOnly(source);
  await expect(
    panel.locator("#steps, #previous, #skip, .pick-instruction"),
  ).toHaveCount(0);
  const primaryColor = await panel
    .locator("#open-calendar")
    .evaluate((button) => getComputedStyle(button).backgroundColor);
  const activeColor = await panel
    .locator('.field-row[aria-current="step"]')
    .evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(activeColor).not.toBe(primaryColor);
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
  await expect(panel.locator("#pick-status")).toHaveText(
    "ページ上の場所をクリック",
  );
  await expect(panel.locator("#field-title .field-status")).toBeHidden();
  await expect(panel.locator("#field-location .field-status")).toBeVisible();
  await panel.screenshot({ path: "test-results/panel-picking.png" });
  await source.screenshot({ path: "test-results/page-picker-progress.png" });
  await source.locator("#venue").click();
  await expect(panel.locator("#pick-status")).toHaveText(
    "ページ上の詳細をクリック",
  );
  await expectPickerActionsOnly(source, 2);
  await source.locator("#description").click();
  await expect(panel.locator("#pick-status")).toHaveText(
    "カレンダーへ進めます",
  );
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await expectPickerActionsOnly(source, 3);
  await expect(panel.locator("#picked-details")).toHaveText(
    `受付は開始30分前から。入口でチケットを提示してください。\n\n${baseUrl}/`,
  );
  await panel.screenshot({ path: "test-results/panel-picked.png" });
  await source.screenshot({ path: "test-results/page-picker-complete.png" });
  // Completing all three fields keeps the guide, but ordinary page clicks no longer pick.
  await source.locator("#event-title").click();
  await expect(panel.locator("#pick-status")).toHaveText(
    "カレンダーへ進めます",
  );
  await clickOverlay(source, "戻る");
  await expect(panel.locator("#pick-status")).toContainText("詳細");
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
  await expect(panel.locator("#field-title")).toHaveAttribute(
    "aria-current",
    "step",
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
  await clickOverlay(source, "スキップ");
  await expect(panel.locator("#pick-status")).toContainText("場所");
  await clickOverlay(source, "戻る");
  await expect(panel.locator("#pick-status")).toContainText("タイトル");
  await expectPickerActionsOnly(source);
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
  await panel.getByRole("button", { name: "選び直す", exact: true }).click();
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(panel.locator("#candidates-title")).toBeFocused();
  await expect(
    panel.locator(".candidate.selected, .candidate.expanded"),
  ).toHaveCount(0);
  await expect(panel.locator('.candidate [aria-expanded="true"]')).toHaveCount(
    0,
  );
  // Wait beyond source reveal's delay; reset must not re-highlight a candidate.
  await panel.waitForTimeout(250);
  await expect(
    panel.locator(".candidate.selected, .candidate.expanded"),
  ).toHaveCount(0);
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  await panel.keyboard.press("Tab");
  await expect(panel.locator("#candidate-order")).toBeFocused();
  await panel.keyboard.press("Tab");
  await expect(panel.locator(".candidate").first()).toHaveClass(/expanded/);
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
  const titleStep = panel.locator("#field-title");
  const bounds = await titleStep.boundingBox();
  // The whole summary row is clickable, including its padding.
  await panel.mouse.click(bounds.x + 3, bounds.y + 3);
  await expect(panel.locator("#field-title")).toHaveAttribute(
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

test("狭い幅・キーボード操作・再スキャン時のリスナー重複を確認する", async () => {
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
  await expect(panel.locator("#pick-status")).toContainText("場所");
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
  await panel.getByRole("button", { name: "選び直す", exact: true }).click();
  // Changed text after the scan must not be highlighted using stale offsets.
  await target.evaluate((element) => {
    element.textContent = "開催日調整中";
  });
  await first.hover();
  await panel.waitForTimeout(250);
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(0);
  // Reset no longer pins the first card via focus. Leave it before targeting
  // another card so its collapsing region cannot move that target mid-hover.
  await panel.locator(".header").hover();
  await panel
    .locator(".candidate")
    .last()
    .locator(".candidate-heading")
    .hover();
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

test("同日の終日カードだけ除き、各時刻の終日パターンを維持する", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    const extra = document.createElement("section");
    extra.innerHTML = "<p>2026年11月8日</p><p>2026年11月8日 18:00〜20:00</p>";
    document.querySelector("main").append(extra);
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(4);
  await expect(panel.locator("#count")).toHaveText("4");
  await expect(
    panel.locator(".variant-label").filter({ hasText: "終日で確保" }),
  ).toHaveCount(4);
  const later = panel.locator(".candidate").last();
  await later.hover();
  await expect(later.getByRole("button", { name: /時間どおり/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /移動込み/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /終日で確保/ })).toBeVisible();
  await later.getByRole("button", { name: /時間どおり/ }).click();
  await expect(panel.locator("#selected-time")).toContainText("18:00–20:00");
  await panel.getByRole("button", { name: "選び直す", exact: true }).click();
  await later.hover();
  await later.getByRole("button", { name: /終日で確保/ }).click();
  await expect(panel.locator("#selected-time")).toContainText("終日");
  await panel.close();
  await source.close();
});

test("令和・英語の日付をスキャンし、出典の強調から正しい日時をカレンダーへ渡す", async () => {
  for (const text of [
    "令和８年１１月８日 14:00〜16:00",
    "November 8, 2026 2 PM–4 PM",
  ]) {
    const { source, panel } = await open();
    await source
      .locator(".date")
      .first()
      .evaluate((element, value) => {
        element.textContent = value;
      }, text);
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".candidate")).toHaveCount(3);
    await panel.locator(".candidate").first().hover();
    await expect(source.locator("sche10le-source-highlight")).toHaveCount(1);
    await select(panel);
    await expect(panel.locator("#selected-time")).toContainText("14:00–16:00");
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "Googleカレンダーで開く" }).click();
    const calendar = await opened;
    const url = new URL(await panel.evaluate(() => window.__calendarRequest));
    expect(url.searchParams.get("dates")).toBe(
      "20261108T050000Z/20261108T070000Z",
    );
    await calendar.close();
    await panel.close();
    await source.close();
  }
});

test("年と時刻のない単独の月日は一覧に出さず、年付き・期間・時間付きは残す", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    document.querySelector("main").innerHTML =
      "<p>分数 2/3</p><p>11月8日</p><p>Nov 8</p><p>2026年12月1日</p><p>12/2〜12/3</p><p>12/4 14:00〜16:00</p>";
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((script) => script.remove());
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(3);
  await expect(panel.locator("#count")).toHaveText("3");
  await expect(panel.locator(".candidate .day")).toHaveText(["1", "2", "4"]);
  await expect(panel.locator(".candidate-time")).toHaveText([
    "終日",
    "終日",
    "14:00–16:00",
  ]);
  await panel.close();
  await source.close();
});

for (const selected of [false, true]) {
  test(`AI補完で終日カードを整理し、${selected ? "選択中の予定を保つ" : "既存カードのフォーカスを保つ"}`, async () => {
    const { source, panel } = await open();
    await panel.evaluate(() => {
      const checkbox = document.querySelector("#ai-enabled");
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            prompt: () =>
              new Promise((resolve) => {
                window.__finishAI = resolve;
              }),
            destroy() {},
          }),
        },
      });
    });
    await source.evaluate(() => {
      const date = document.createElement("p");
      date.textContent = "2026年12月1日 お昼の集まり";
      document.querySelector("main").append(date);
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".candidate")).toHaveCount(4);
    await panel.locator("#settings-toggle").click();
    await panel.locator("#ai-enabled").check();
    await panel.locator("#settings-close").click();
    await expect
      .poll(() => panel.evaluate(() => typeof window.__finishAI))
      .toBe("function");
    if (selected) {
      const card = panel.locator(".candidate").last();
      await card.hover();
      await card.getByRole("button", { name: /終日で確保/ }).click();
      await source.locator("#event-title").click();
      await expect(panel.locator("#picked-title")).toContainText(
        "蔵前の活版印刷ワークショップ",
      );
    } else {
      await panel.locator(".candidate-heading").first().focus();
    }
    await panel.evaluate(() =>
      window.__finishAI(
        JSON.stringify([
          {
            start: "2026-12-01T12:00:00+09:00",
            end: "2026-12-01T13:00:00+09:00",
            evidence: "2026年12月1日 お昼の集まり",
          },
        ]),
      ),
    );
    await expect(panel.locator("#ai-status")).toHaveText(
      "AIの補完が完了しました。",
    );
    if (selected) {
      await expect(
        panel.locator(".candidate.selected .candidate-time"),
      ).toHaveText("終日");
      await expect(panel.locator("#picked-title")).toContainText(
        "蔵前の活版印刷ワークショップ",
      );
      await panel
        .getByRole("button", { name: "選び直す", exact: true })
        .click();
    } else {
      await expect(panel.locator(".candidate-heading").first()).toBeFocused();
    }
    await expect(panel.locator(".candidate")).toHaveCount(4);
    await expect(panel.locator("#count")).toHaveText("4");
    await expect(panel.locator(".candidate-time").last()).toHaveText(
      "12:00–13:00",
    );
    await panel.close();
    await source.close();
  });
}

test("登場順と日時順を切り替え、構造化データの位置・同日時刻・再スキャン・選択を保つ", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    document.querySelector("main").innerHTML =
      "<h1>日程一覧</h1><p>2026年12月8日 18:00〜20:00</p><p>2026年11月8日 16:00〜17:00</p><p>2026年11月8日 10:00〜12:00</p><p>2026年11月7日</p>";
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify([
      {
        "@type": "Event",
        startDate: "2026-11-08T10:00:00+09:00",
        endDate: "2026-11-08T12:00:00+09:00",
      },
      { "@type": "Event", startDate: "2026-10-01" },
    ]);
    document.head.append(script);
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  const order = panel.getByRole("combobox", { name: "日程の並び順" });
  await expect(order).toHaveValue("page");
  await expect(panel.locator(".candidate .day")).toHaveText([
    "8",
    "8",
    "8",
    "7",
    "1",
  ]);
  await expect(panel.locator(".candidate-time")).toHaveText([
    "18:00–20:00",
    "16:00–17:00",
    "10:00–12:00",
    "終日",
    "終日",
  ]);
  await panel.screenshot({
    path: "test-results/panel-sort-page.png",
    animations: "disabled",
  });
  await order.selectOption("date");
  await expect(panel.locator(".candidate .day")).toHaveText([
    "1",
    "7",
    "8",
    "8",
    "8",
  ]);
  await expect(panel.locator(".candidate-time")).toHaveText([
    "終日",
    "終日",
    "10:00–12:00",
    "16:00–17:00",
    "18:00–20:00",
  ]);
  await panel.setViewportSize({ width: 280, height: 850 });
  expect(
    await panel.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: "test-results/panel-sort-narrow.png",
    animations: "disabled",
  });
  const card = panel.locator(".candidate").nth(2);
  await card.hover();
  await expect(source.locator("sche10le-source-highlight")).toHaveCount(1);
  await card.getByRole("button", { name: /時間どおり/ }).click();
  await expect(panel.locator("#selected-time")).toContainText("10:00–12:00");
  await panel.getByRole("button", { name: "選び直す", exact: true }).click();
  await expect(order).toHaveValue("date");
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(order).toBeEnabled();
  await expect(order).toHaveValue("date");
  await order.focus();
  await expect(order).toBeFocused();
  // Headless Chromium on macOS cannot drive the native select popup with keys.
  // Use Playwright's selection API and verify the control keeps focus afterward.
  await order.selectOption("page");
  await expect(order).toHaveValue("page");
  await expect(order).toBeFocused();
  await expect(panel.locator(".candidate-time").first()).toHaveText(
    "18:00–20:00",
  );
  await panel.close();
  await source.close();
});

test("日時順のAI追加を正しい位置に挿入し、移動するカードのフォーカスを維持する", async () => {
  const { source, panel } = await open();
  await panel
    .getByRole("combobox", { name: "日程の並び順" })
    .selectOption("date");
  await panel.evaluate(() => {
    const checkbox = document.querySelector("#ai-enabled");
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: {
        availability: async () => "available",
        create: async () => ({
          prompt: () =>
            new Promise((resolve) => {
              window.__finishAI = resolve;
            }),
          destroy() {},
        }),
      },
    });
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
  });
  await expect
    .poll(() => panel.evaluate(() => typeof window.__finishAI))
    .toBe("function");
  const focused = await panel
    .locator(".candidate-heading")
    .first()
    .elementHandle();
  await focused.focus();
  await panel.evaluate(() =>
    window.__finishAI(
      JSON.stringify([
        {
          start: "2026-11-01T12:00:00+09:00",
          end: "2026-11-01T13:00:00+09:00",
          evidence: "秋のオープンスタジオ。",
        },
      ]),
    ),
  );
  await expect(panel.locator("#ai-status")).toHaveText(
    "AIの補完が完了しました。",
  );
  await expect(panel.locator(".candidate .day")).toHaveText([
    "1",
    "8",
    "15",
    "21",
  ]);
  expect(
    await focused.evaluate((element) => element === document.activeElement),
  ).toBe(true);
  await panel
    .getByRole("combobox", { name: "日程の並び順" })
    .selectOption("page");
  await expect(panel.locator(".candidate .day")).toHaveText([
    "1",
    "8",
    "15",
    "21",
  ]);
  await panel.close();
  await source.close();
});

test("並び順は初回のみ登場順になり、パネルを閉じても最後の選択を復元する", async () => {
  const initial = await open();
  await initial.panel.evaluate(() =>
    chrome.storage.local.remove("candidateOrder"),
  );
  await initial.panel.close();
  await initial.source.close();
  for (const [expected, next] of [
    ["page", "date"],
    ["date", "page"],
    ["page", null],
  ]) {
    const { source, panel } = await open();
    const order = panel.getByRole("combobox", { name: "日程の並び順" });
    await expect(order).toHaveValue(expected);
    await source.evaluate(() => {
      const main = document.querySelector("main");
      [...main.querySelectorAll("article")]
        .reverse()
        .forEach((article) => main.append(article));
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".candidate .day")).toHaveText(
      expected === "page" ? ["21", "15", "8"] : ["8", "15", "21"],
    );
    await expect(panel.locator("#order-feedback")).toBeHidden();
    await expect(panel.locator("#source-domain")).toHaveText("127.0.0.1");
    await expect(panel.locator("#source-domain")).toHaveAttribute(
      "title",
      "週末のデザイン散歩 | TOKYO FIELD NOTES",
    );
    await expect(panel.getByRole("button", { name: "再スキャン" })).toHaveText(
      "再スキャン",
    );
    if (next) {
      await order.selectOption(next);
      await expect
        .poll(() =>
          panel.evaluate(
            async () =>
              (await chrome.storage.local.get("candidateOrder")).candidateOrder,
          ),
        )
        .toBe(next);
    } else {
      await panel.evaluate(() =>
        chrome.storage.local.set({ candidateOrder: "invalid-value" }),
      );
    }
    await panel.close();
    await source.close();
  }
  const fallback = await open();
  await expect(
    fallback.panel.getByRole("combobox", { name: "日程の並び順" }),
  ).toHaveValue("page");
  await fallback.panel.close();
  await fallback.source.close();
});

test("並び順の保存失敗は再試行でき、連続変更でも最後の選択を保存する", async () => {
  const { source, panel } = await open();
  const order = panel.getByRole("combobox", { name: "日程の並び順" });
  await panel.evaluate(() => {
    window.__saveOrder = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async () => {
      throw new Error("test failure");
    };
  });
  await order.selectOption("date");
  await expect(order).toHaveValue("date");
  await expect(panel.locator("#order-status")).toHaveClass(/error/);
  await expect(panel.locator("#order-status")).toContainText(
    "保存できませんでした",
  );
  await expect(panel.locator("#retry-order")).toBeVisible();
  await panel.evaluate(() => {
    chrome.storage.local.set = window.__saveOrder;
  });
  await panel.locator("#retry-order").click();
  await expect
    .poll(() =>
      panel.evaluate(
        async () =>
          (await chrome.storage.local.get("candidateOrder")).candidateOrder,
      ),
    )
    .toBe("date");
  await expect(panel.locator("#order-feedback")).toBeHidden();
  await panel.evaluate(() => {
    let first = true;
    window.__orderWrites = [];
    chrome.storage.local.set = async (values) => {
      if (first) {
        first = false;
        await new Promise((resolve) => {
          window.__releaseOrderSave = resolve;
        });
      }
      await window.__saveOrder(values);
      window.__orderWrites.push(values.candidateOrder);
    };
  });
  await order.selectOption("page");
  await expect
    .poll(() => panel.evaluate(() => typeof window.__releaseOrderSave))
    .toBe("function");
  await order.selectOption("date");
  await panel.evaluate(() => window.__releaseOrderSave());
  await expect
    .poll(() => panel.evaluate(() => window.__orderWrites))
    .toEqual(["page", "date"]);
  await expect
    .poll(() =>
      panel.evaluate(
        async () =>
          (await chrome.storage.local.get("candidateOrder")).candidateOrder,
      ),
    )
    .toBe("date");
  await expect(panel.locator("#order-feedback")).toBeHidden();
  await panel.close();
  await source.close();
});

test("フッターのことばを起動時に選び、再スキャンや選び直しでは変えない", async () => {
  for (const [random, quote] of [
    [0, FOOTER_QUOTES[0]],
    [0.999, FOOTER_QUOTES.at(-1)],
  ]) {
    const { source, panel } = await open(random);
    const footer = panel.locator("#footer-quote");
    await expect(footer).toHaveText(quote.text);
    await expect(footer).toHaveAttribute("title", quote.attribution);
    await expect(panel.locator("#list-hint")).toHaveCount(0);
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".candidate")).toHaveCount(3);
    await expect(footer).toHaveText(quote.text);
    await select(panel);
    await expect(panel.locator("#idle-footer")).toBeHidden();
    await expect(
      panel.getByRole("button", { name: "Googleカレンダーで開く" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "選び直す", exact: true }).click();
    await expect(footer).toBeVisible();
    await expect(footer).toHaveText(quote.text);
    await panel.setViewportSize({ width: 280, height: 700 });
    expect(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: `test-results/footer-quote-${random}.png`,
      animations: "disabled",
    });
    await panel.close();
    await source.close();
  }
});

test("移動込みの書式は元の開催時刻を保ち、カレンダーは移動時間を確保する", async () => {
  const { source, panel } = await open();
  await panel.getByRole("button", { name: "設定", exact: true }).click();
  await panel.locator("#travel").fill("30");
  await panel.locator("#title-format").fill("{from:HHmm} {title} {to:HHmm}");
  await expect(panel.locator("#settings-status")).toContainText("保存しました");
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  await select(panel, "移動込み");
  await expect(panel.locator("#selected-time")).toContainText("13:30–16:30");
  await expect(panel.locator("#picked-title")).toHaveText(
    "1400 週末のデザイン散歩 | TOKYO FIELD NOTES 1600",
  );
  await source.locator("#event-title").click();
  await expect(panel.locator("#picked-title")).toHaveText(
    "1400 蔵前の活版印刷ワークショップ 1600",
  );
  const opened = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Googleカレンダーで開く" }).click();
  const calendar = await opened;
  const url = new URL(await panel.evaluate(() => window.__calendarRequest));
  expect(url.searchParams.get("text")).toBe(
    "1400 蔵前の活版印刷ワークショップ 1600",
  );
  expect(url.searchParams.get("dates")).toBe(
    "20261108T043000Z/20261108T073000Z",
  );
  await calendar.close();
  await panel.close();
  await source.close();
});

test("取得結果の行からクリック・キーボードで選び直し、中断からも再開できる", async () => {
  const { source, panel } = await open();
  await select(panel);
  await source.locator("#event-title").click();
  await source.locator("#venue").click();
  await source.locator("#description").click();
  await expect(panel.locator('.field-row[aria-current="step"]')).toHaveCount(0);
  await expect(panel.locator(".field-status:visible")).toHaveCount(0);
  await panel.locator("#field-location").focus();
  await panel.keyboard.press("Tab");
  await expect(panel.locator("#field-details")).toBeFocused();
  await expect(panel.locator("#field-details .field-edit")).toHaveCSS(
    "opacity",
    "1",
  );
  await panel.keyboard.press("Enter");
  await expect(panel.locator("#field-details")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expectPickerActionsOnly(source, 2);
  await source.locator("#venue").click();
  await expect(panel.locator("#picked-details")).toHaveText(
    `東京都台東区蔵前3丁目 アトリエ蔵前\n\n${baseUrl}/`,
  );
  await panel.locator("#field-location").click();
  await expect(panel.locator("#field-location")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await source.keyboard.press("Escape");
  await expect(panel.locator("#resume")).toBeVisible();
  await expect(panel.locator(".field-status:visible")).toHaveCount(0);
  await panel.locator("#field-location").focus();
  await panel.keyboard.press("Space");
  await expect(panel.locator("#resume")).toBeHidden();
  await expect(panel.locator("#field-location .field-status")).toBeVisible();
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await source.locator("#venue").click();
  await expect(panel.locator("#field-details .field-status")).toBeVisible();
  await panel.close();
  await source.close();
});

test("操作バーは手順間で大きさとボタン位置を保ち、閉じる操作でページ操作へ戻れる", async () => {
  const { source, panel } = await open();
  await source.emulateMedia({ reducedMotion: "reduce" });
  await select(panel);
  for (const width of [1000, 390, 320]) {
    await source.setViewportSize({ width, height: 850 });
    await clickOverlay(source, "タイトルを選び直す");
    await expect(panel.locator("#field-title")).toHaveAttribute(
      "aria-current",
      "step",
    );
    const initial = await expectPickerActionsOnly(source, 0);
    // Disabled controls remain present and cannot change the current step.
    await clickOverlay(source, "戻る");
    await expect(panel.locator("#field-title")).toHaveAttribute(
      "aria-current",
      "step",
    );
    for (let step = 1; step <= 3; step++) {
      await clickOverlay(source, "スキップ");
      await expect(panel.locator("#pick-status")).toHaveText(
        step === 3
          ? "カレンダーへ進めます"
          : `ページ上の${step === 1 ? "場所" : "詳細"}をクリック`,
      );
      expect(await expectPickerActionsOnly(source, step)).toEqual(initial);
    }
    await clickOverlay(source, "スキップ");
    await expect(panel.locator("#pick-status")).toHaveText(
      "カレンダーへ進めます",
    );
    await source.screenshot({
      path: `test-results/picker-stable-${width}.png`,
      animations: "disabled",
    });
  }
  await source.setViewportSize({ width: 1000, height: 850 });
  await clickOverlay(source, "タイトルを選び直す");
  await source.locator("#event-title").click();
  const title = await panel.locator("#picked-title").textContent();
  await clickOverlay(source, "閉じる");
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(panel.locator("#resume")).toBeVisible();
  await source.evaluate(() => {
    document.querySelector("#event-link").addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        window.__ordinaryLinkClicked = true;
      },
      { once: true },
    );
  });
  await source.locator("#event-link").click();
  expect(await source.evaluate(() => window.__ordinaryLinkClicked)).toBe(true);
  await expect(panel.locator("#picked-title")).toHaveText(title);
  await panel.locator("#resume").click();
  await expect(panel.locator("#field-location")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await panel.close();
  await source.close();
});
