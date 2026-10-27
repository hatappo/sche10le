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

async function open(footerRandom, panelInit) {
  const source = await context.newPage();
  await source.goto(baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 900 });
  if (panelInit) await panel.addInitScript(panelInit);
  if (footerRandom !== undefined)
    await panel.addInitScript((value) => {
      Math.random = () => value;
    }, footerRandom);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator("#scan-state")).toHaveText("対象外");
  await source.bringToFront();
  await panel.getByRole("button", { name: "スキャン", exact: true }).click();
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
  await card.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await expect(panel.locator("#selection")).toBeVisible();
}

// Resolve a real button inside the closed shadow root, then click its screen position.
async function clickOverlay(source, name, key) {
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
    if (key) {
      await session.send("DOM.focus", { nodeId: target.nodeId });
      await source.keyboard.press(key);
      return;
    }
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
        if (
          ["戻る", "スキップ", "選択モードを閉じる"].includes(
            attributes[index + 1],
          )
        )
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
    expect(visibleLabels).toContain("選択モードを閉じる");
    expect(labels).not.toContain("閉じる");
    const close = actionNodes.find((node) =>
      node.attributes.includes("選択モードを閉じる"),
    );
    expect(close.attributes[close.attributes.indexOf("title") + 1]).toBe(
      "選択モードを閉じる（Esc）",
    );
    expect(
      close.children.some((node) => node.nodeName.toLowerCase() === "svg"),
    ).toBe(true);
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
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toHaveText("移動込み 13:30–16:30");
  await expect(
    panel.locator("#selected-date, #selected-time, #selection .eyebrow"),
  ).toHaveCount(0);
  await expect(panel.locator(".registration-summary")).toHaveCount(1);
  await expect(panel.locator("#candidate-order")).toBeHidden();
  await expect(panel.locator("#candidates-title")).toBeVisible();
  await expect(panel.locator("#count")).toBeVisible();
  await expect(panel.locator("#scan-title .stage-check")).toBeVisible();
  await expect(panel.locator("#candidates-title .stage-check")).toBeVisible();
  await expect(panel.locator("#content-title")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(panel.locator("#deselect")).toBeVisible();
  const resetBounds = await panel.locator("#deselect").boundingBox();
  const selectedBounds = await panel
    .locator(".candidate.selected")
    .boundingBox();
  expect(resetBounds.y + resetBounds.height).toBeLessThanOrEqual(
    selectedBounds.y,
  );
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
  // Compare settled colors; the date card transitions its border on selection.
  await expect
    .poll(() =>
      panel.evaluate(() => {
        const field = getComputedStyle(
          document.querySelector('.field-row[aria-current="step"]'),
        );
        const card = getComputedStyle(
          document.querySelector(".candidate.selected"),
        );
        return (
          field.backgroundColor === card.backgroundColor &&
          field.borderTopColor === card.borderTopColor
        );
      }),
    )
    .toBe(true);
  await panel.screenshot({
    path: "test-results/panel-current-field.png",
    animations: "disabled",
  });
  await source.screenshot({
    path: "test-results/page-picker.png",
    animations: "disabled",
  });
  await expect(panel.locator("#picked-title")).toHaveText(
    "週末のデザイン散歩 | TOKYO FIELD NOTES",
  );
  await expect(panel.locator("#picked-details")).toHaveText(`${baseUrl}/`);
  await source.locator("#event-title").click();
  await expect(panel.locator("#field-title .field-check")).toHaveText("✓");
  await expect(panel.locator("#pick-status")).toHaveText(
    "ページ上の場所をクリック",
  );
  await expect(panel.locator("#field-title .field-label")).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(panel.locator(".field-status")).toHaveCount(0);
  await expect(panel.locator("#field-location .field-label")).toHaveCSS(
    "font-weight",
    "600",
  );
  await expect(panel.locator("#picked-location")).toHaveCSS(
    "font-weight",
    "400",
  );
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
  await expect(panel.locator("#content-title .stage-check")).toBeVisible();
  await expect(panel.locator(".stage-title[aria-current]")).toHaveCount(0);
  await panel.screenshot({ path: "test-results/panel-picked.png" });
  await source.screenshot({ path: "test-results/page-picker-complete.png" });
  // Completing all three fields keeps the guide, but ordinary page clicks no longer pick.
  await source.locator("#event-title").click();
  await expect(panel.locator("#pick-status")).toHaveText(
    "カレンダーへ進めます",
  );
  await clickOverlay(source, "戻る");
  await expect(panel.locator("#pick-status")).toContainText("詳細");
  await expect(panel.locator("#content-title")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(panel.locator("#content-title .stage-check")).toBeHidden();
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

test("工程見出しは完了時だけ一度光り、再描画や動きを減らす設定では繰り返さない", async () => {
  const { source, panel } = await open(undefined, () => {
    window.__stageShines = [];
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "stage-shine" &&
        event.target.matches(".stage-label")
      ) {
        window.__stageShines.push(event.target.closest(".stage-title").id);
        if (event.target.closest("#candidates-title")) {
          event.target.getAnimations()[0].pause();
        }
      }
    });
  });
  const shines = () => panel.evaluate(() => window.__stageShines);
  try {
    await expect.poll(shines).toEqual(["scan-title"]);
    await select(panel);
    await expect.poll(shines).toEqual(["scan-title", "candidates-title"]);
    const label = panel.locator("#candidates-title .stage-label");
    await label.evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 200;
    });
    await panel.screenshot({
      path: "test-results/section-completion-shine.png",
    });
    await label.evaluate((element) => element.getAnimations()[0].play());
    await source.locator("#event-title").click();
    await source.locator("#venue").click();
    await source.locator("#description").click();
    await expect
      .poll(shines)
      .toEqual(["scan-title", "candidates-title", "content-title"]);
    await expect(panel.locator(".stage-label.is-completing")).toHaveCount(0);
    await expect(label).toHaveCSS(
      "color",
      await panel
        .locator("#candidates-title")
        .evaluate((element) => getComputedStyle(element).color),
    );
    await panel.locator("#settings-toggle").click();
    await panel.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(panel.locator("#content-title .stage-check")).toBeVisible();
    expect(await shines()).toEqual([
      "scan-title",
      "candidates-title",
      "content-title",
    ]);

    await panel.locator("#field-details").click();
    await source.locator("#description").click();
    await expect
      .poll(shines)
      .toEqual([
        "scan-title",
        "candidates-title",
        "content-title",
        "content-title",
      ]);
    await expect(panel.locator(".stage-label.is-completing")).toHaveCount(0);
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await panel.locator("#field-details").click();
    await source.locator("#description").click();
    await expect(panel.locator("#content-title .stage-check")).toBeVisible();
    await expect(panel.locator(".stage-label.is-completing")).toHaveCount(0);
    expect(await shines()).toEqual([
      "scan-title",
      "candidates-title",
      "content-title",
      "content-title",
    ]);
  } finally {
    await panel.close();
    await source.close();
  }
});

test("内容の各ラベルは取得・スキップで光ってチェックを残し、選び直しとリセットに追従する", async () => {
  const { source, panel } = await open(undefined, () => {
    window.__fieldShines = [];
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "stage-shine" &&
        event.target.matches(".field-label")
      ) {
        window.__fieldShines.push(event.target.closest(".field-row").id);
      }
    });
  });
  const shines = () => panel.evaluate(() => window.__fieldShines);
  try {
    await select(panel);
    await expect(panel.locator(".field-check:visible")).toHaveCount(0);
    await source.locator("#event-title").click();
    await expect.poll(shines).toEqual(["field-title"]);
    await expect(panel.locator("#field-title .field-check")).toBeVisible();
    await expect(panel.locator("#field-title-completion")).toHaveText(
      "設定済み",
    );
    expect(
      await panel
        .locator("#field-title")
        .evaluate(
          (row) =>
            row
              .getAnimations()
              .filter((animation) => !(animation instanceof CSSTransition))
              .length,
        ),
    ).toBe(0);
    await expect(panel.locator(".picked-confirmation")).toHaveCount(0);
    await clickOverlay(source, "スキップ");
    await expect.poll(shines).toEqual(["field-title", "field-location"]);
    await expect(panel.locator("#field-location .field-check")).toBeVisible();
    await expect(panel.locator("#picked-location")).toHaveText("未設定");
    await source.locator("#description").click();
    await expect
      .poll(shines)
      .toEqual(["field-title", "field-location", "field-details"]);
    await expect(panel.locator(".field-label.is-completing")).toHaveCount(0);
    await expect(panel.locator(".field-check:visible")).toHaveCount(3);
    await panel.screenshot({ path: "test-results/fields-complete.png" });
    await panel.locator("#settings-toggle").click();
    await panel.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(panel.locator(".field-check:visible")).toHaveCount(3);
    expect(await shines()).toEqual([
      "field-title",
      "field-location",
      "field-details",
    ]);
    await panel.locator("#field-details").click();
    await expect(panel.locator("#field-details .field-check")).toBeHidden();
    await expect(panel.locator(".field-check:visible")).toHaveCount(2);
    await source.keyboard.press("Escape");
    await expect(panel.locator(".field-check:visible")).toHaveCount(2);
    await panel.locator("#resume").click();
    await source.locator("#description").click();
    await expect
      .poll(shines)
      .toEqual([
        "field-title",
        "field-location",
        "field-details",
        "field-details",
      ]);
    await expect(panel.locator(".field-label.is-completing")).toHaveCount(0);
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await panel.locator("#field-details").click();
    await clickOverlay(source, "スキップ");
    await expect(panel.locator(".field-check:visible")).toHaveCount(3);
    await expect(panel.locator(".field-label.is-completing")).toHaveCount(0);
    expect(await shines()).toEqual([
      "field-title",
      "field-location",
      "field-details",
      "field-details",
    ]);
    await panel.locator("#deselect").click();
    await select(panel);
    await expect(panel.locator(".field-check:visible")).toHaveCount(0);
  } finally {
    await panel.close();
    await source.close();
  }
});

test("内容完了後は補足文を切り替え、項目の光の後に主操作を案内する", async () => {
  const { source, panel } = await open(undefined, () => {
    window.__calendarCues = [];
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "stage-shine" &&
        event.target.closest("#field-details")
      ) {
        window.__detailsShineAt = performance.now();
      }
      if (event.animationName === "calendar-ready-glow") {
        window.__calendarCues.push(performance.now() - window.__detailsShineAt);
        event.target
          .getAnimations({ subtree: true })
          .find(
            (animation) => animation.animationName === "calendar-ready-glow",
          )
          .pause();
      }
    });
  });
  const primary = panel.locator("#open-calendar");
  const hint = panel.locator("#calendar-hint");
  const initialHint = "情報の取得は途中でもOK。保存は Google カレンダーで。";
  const completeHint = "Google カレンダーで修正してから保存できます。";
  try {
    await select(panel);
    await expect(hint).toHaveText(initialHint);
    await source.locator("#event-title").click();
    await source.locator("#venue").click();
    const bounds = await primary.boundingBox();
    // Completion must not move keyboard focus to the primary action.
    await panel.locator("#download-calendar").focus();
    await source.locator("#description").click();
    await expect(hint).toHaveText(completeHint);
    await expect
      .poll(() => panel.evaluate(() => window.__calendarCues.length))
      .toBe(1);
    expect(
      await panel.evaluate(() => window.__calendarCues[0]),
    ).toBeGreaterThanOrEqual(550);
    await expect(panel.locator("#download-calendar")).toBeFocused();
    expect(await primary.boundingBox()).toEqual(bounds);
    await primary.evaluate((button) => {
      button
        .getAnimations({ subtree: true })
        .find(
          (animation) => animation.animationName === "calendar-ready-glow",
        ).currentTime = 1300;
    });
    await panel.screenshot({ path: "test-results/calendar-ready-glow.png" });
    await primary.evaluate((button) =>
      button
        .getAnimations({ subtree: true })
        .find((animation) => animation.animationName === "calendar-ready-glow")
        .play(),
    );
    await expect(primary).not.toHaveClass(/calendar-ready/);
    await panel.locator("#settings-toggle").click();
    await panel.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(hint).toHaveText(completeHint);
    await expect(primary).not.toHaveClass(/calendar-ready/);
    expect(await panel.evaluate(() => window.__calendarCues.length)).toBe(1);

    await panel.locator("#field-details").click();
    await expect(hint).toHaveText(initialHint);
    await source.locator("#description").click();
    await expect(primary).toHaveClass(/calendar-ready/);
    await panel.locator("#field-details").click();
    await expect(primary).not.toHaveClass(/calendar-ready/);
    await expect(hint).toHaveText(initialHint);
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await clickOverlay(source, "スキップ");
    await expect(hint).toHaveText(completeHint);
    await expect(primary).not.toHaveClass(/calendar-ready/);
    expect(await panel.evaluate(() => window.__calendarCues.length)).toBe(1);
    await panel.locator("#deselect").click();
    await select(panel);
    await expect(hint).toHaveText(initialHint);
    await expect(primary).not.toHaveClass(/calendar-ready/);
  } finally {
    await panel.close();
    await source.close();
  }
});

test("完了の光は10秒の間隔で追加2回まで繰り返し、待機中の設定操作で止まる", async () => {
  const { source, panel } = await open(undefined, () => {
    window.__calendarCues = [];
    document.addEventListener("animationstart", (event) => {
      if (event.animationName !== "calendar-ready-glow") return;
      window.__calendarCues.push(performance.now());
      event.target
        .getAnimations({ subtree: true })
        .find((animation) => animation.animationName === "calendar-ready-glow")
        .pause();
    });
  });
  const primary = panel.locator("#open-calendar");
  const count = () => panel.evaluate(() => window.__calendarCues.length);
  async function finishGlow() {
    await primary.evaluate((button) =>
      button
        .getAnimations({ subtree: true })
        .find((animation) => animation.animationName === "calendar-ready-glow")
        .finish(),
    );
    await expect(primary).not.toHaveClass(/calendar-ready/);
  }
  try {
    await panel.clock.install();
    await panel.clock.pauseAt(new Date());
    await select(panel);
    await source.locator("#event-title").click();
    await source.locator("#venue").click();
    await source.locator("#description").click();
    await expect.poll(count).toBe(1);
    await finishGlow();
    for (const expected of [2, 3]) {
      await panel.clock.fastForward(9999);
      await expect(primary).not.toHaveClass(/calendar-ready/);
      expect(await count()).toBe(expected - 1);
      await panel.clock.fastForward(1);
      await expect.poll(count).toBe(expected);
      await finishGlow();
    }
    await panel.clock.fastForward(30_000);
    await expect(primary).not.toHaveClass(/calendar-ready/);
    expect(await count()).toBe(3);

    await panel.locator("#field-details").click();
    await source.locator("#description").click();
    await expect.poll(count).toBe(4);
    await finishGlow();
    await panel.locator("#settings-toggle").click();
    await panel.getByRole("button", { name: "閉じる", exact: true }).click();
    await panel.clock.fastForward(30_000);
    await expect(primary).not.toHaveClass(/calendar-ready/);
    expect(await count()).toBe(4);
  } finally {
    await panel.close();
    await source.close();
  }
});

test("未取得で開く・スキップ・戻る・選び直しとEscape", async () => {
  const { source, panel } = await open();
  await select(panel, "終日");
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
  await expect(panel.locator(".registration-summary")).toHaveCount(0);
  await expect(panel.locator("#deselect")).toBeHidden();
  for (const id of ["candidates-title", "count", "candidate-order"]) {
    await expect(panel.locator(`#${id}`)).toBeVisible();
  }
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(panel.locator("#candidates-title")).toBeFocused();
  await expect(panel.locator("#candidates-title")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(panel.locator("#candidates-title .stage-check")).toBeHidden();
  await expect(panel.locator("#content-title")).toBeHidden();
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
  await select(panel, "終日");
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
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toContainText("13:15–16:45");
  await source.locator("#spa").click();
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  await expect(panel.locator("#selection")).toBeHidden();
  await expect(panel.locator(".candidate")).toHaveCount(0);
  await panel.getByRole("button", { name: "スキャン", exact: true }).click();
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
  await select(next.panel, "終日");
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
  await expect(panel.locator(".candidate").first()).toHaveClass(/expanded/);
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
  await panel.locator(".footer-tools").hover();
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
  await panel.locator(".footer-tools").hover();
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
    panel.locator(".variant-label").filter({ hasText: "終日" }),
  ).toHaveCount(4);
  const later = panel.locator(".candidate").last();
  await later.hover();
  await expect(later.getByRole("button", { name: /時間どおり/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /移動込み/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /^終日/ })).toBeVisible();
  await later.getByRole("button", { name: /時間どおり/ }).click();
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toContainText("18:00–20:00");
  await panel.getByRole("button", { name: "選び直す", exact: true }).click();
  await later.hover();
  await later.getByRole("button", { name: /^終日/ }).click();
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toContainText("終日");
  await panel.close();
  await source.close();
});

test("令和・英語・午後の日付をスキャンし、出典の強調から正しい日時をカレンダーへ渡す", async () => {
  for (const text of [
    "令和８年１１月８日 14:00〜16:00",
    "November 8, 2026 2 PM–4 PM",
    "2026年11月8日 午後2時〜4時",
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
    await expect(
      panel.locator(".candidate.selected .registration-summary"),
    ).toContainText("14:00–16:00");
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

test("本文のタイムゾーン付き日時と曖昧な午後の範囲を候補にしない", async () => {
  const { source, panel } = await open();
  await source.evaluate(() => {
    document.querySelector("main").innerHTML =
      "<p>Nov 8, 2026 14:00–16:00 PST</p><p>2026年11月9日 午後11時〜1時</p><p>2026年11月10日 午後2時〜4時</p>";
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((script) => script.remove());
  });
  await panel.getByRole("button", { name: "再スキャン" }).click();
  await expect(panel.locator(".candidate")).toHaveCount(1);
  await expect(panel.locator(".candidate .day")).toHaveText(["10"]);
  await expect(panel.locator(".candidate-time")).toHaveText(["14:00–16:00"]);
  await panel.close();
  await source.close();
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
      await card.getByRole("button", { name: /^終日/ }).click();
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
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toContainText("10:00–12:00");
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

test("名言は設定画面だけに表示し、再スキャンや選び直しでは変えない", async () => {
  for (const [random, quote] of [
    [0, FOOTER_QUOTES[0]],
    [0.999, FOOTER_QUOTES.at(-1)],
  ]) {
    const { source, panel } = await open(random);
    const footer = panel.locator("#footer-quote");
    await expect(footer).toHaveText(quote.text);
    await expect(footer).toHaveAttribute(
      "title",
      `${quote.original}\n— ${quote.attribution}`,
    );
    await expect(panel.locator("#list-hint")).toHaveCount(0);
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".candidate")).toHaveCount(3);
    await expect(footer).toHaveText(quote.text);
    await select(panel);
    await expect(footer).toBeHidden();
    await expect(
      panel.getByRole("button", { name: "Googleカレンダーで開く" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "選び直す", exact: true }).click();
    await expect(footer).toBeHidden();
    await panel.getByRole("button", { name: "設定", exact: true }).click();
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
      fullPage: true,
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
  await expect(
    panel.locator(".candidate.selected .registration-summary"),
  ).toContainText("13:30–16:30");
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
  await expect(panel.locator('.field-row[aria-current="step"]')).toHaveCount(0);
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
  await expect(panel.locator('.field-row[aria-current="step"]')).toHaveCount(0);
  await panel.locator("#field-location").focus();
  await panel.keyboard.press("Space");
  await expect(panel.locator("#resume")).toBeHidden();
  await expect(panel.locator("#field-location .field-label")).toHaveCSS(
    "font-weight",
    "600",
  );
  await expect(panel.locator("#picked-location")).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(source.locator("sche10le-picker")).toHaveCount(1);
  await source.locator("#venue").click();
  await expect(panel.locator("#field-details .field-label")).toHaveCSS(
    "font-weight",
    "600",
  );
  await expect(panel.locator("#field-location .field-label")).toHaveCSS(
    "font-weight",
    "400",
  );
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
  await clickOverlay(source, "選択モードを閉じる");
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
  await source.locator("#venue").click();
  await source.locator("#description").click();
  const values = await panel.locator(".field-value").allTextContents();
  await clickOverlay(source, "選択モードを閉じる", "Enter");
  await expect(source.locator("sche10le-picker")).toHaveCount(0);
  expect(await panel.locator(".field-value").allTextContents()).toEqual(values);
  await panel.close();
  await source.close();
});

test("未許可ページでは案内だけを出し、対象外・未スキャン・0件を区別する", async () => {
  const { source, panel } = await open();
  await context.route("https://ungranted.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>2026年11月8日 14:00</h1>",
    }),
  );
  try {
    await source.goto("https://ungranted.example/events");
    await expect(panel.locator("#access-guide")).toBeVisible();
    await expect(panel.locator("#source-section")).toBeHidden();
    await expect(panel.locator("#content-title")).toBeHidden();
    await expect(panel.locator("#candidates-title")).toBeHidden();
    await expect(panel.locator("#count")).toBeHidden();
    await expect(panel.locator("#candidate-order")).toBeHidden();
    await expect(panel.locator("#access-guide strong")).toHaveCount(0);
    await expect(panel.locator("#access-guide p img")).toBeVisible();
    await expect(panel.locator("#access-guide small svg")).toBeVisible();
    expect(
      await panel
        .locator("#access-guide img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    await expect(panel.locator("#rescan")).toBeHidden();
    await expect(panel.locator("#rescan")).toBeDisabled();
    await expect(panel.locator("#empty")).toBeHidden();
    await expect(panel.locator(".candidate")).toHaveCount(0);
    await expect(panel.locator("#notice")).not.toHaveClass(/error/);
    await expect(panel.locator("#scan-state")).toHaveText("待機中");
    await panel.screenshot({ path: "test-results/scan-access-guidance.png" });
    await panel.setViewportSize({ width: 300, height: 700 });
    expect(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: "test-results/scan-access-guidance-narrow.png",
    });

    await source.goto("chrome://settings");
    await expect(panel.locator("#scan-state")).toHaveText("対象外");
    await expect(panel.locator("#rescan")).toBeHidden();
    await expect(panel.locator("#access-guide")).toBeHidden();
    await expect(panel.locator("#notice")).toContainText(
      "このページではスキャンできません",
    );

    await source.goto(baseUrl);
    await expect(
      panel.getByRole("button", { name: "スキャン", exact: true }),
    ).toBeEnabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "1px");
    await expect(panel.locator("#empty")).toBeHidden();
    await expect(panel.locator("#source-section")).toBeVisible();
    await expect(panel.locator("#results-controls")).toBeHidden();
    await expect(panel.locator("#scan-title")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(panel.locator("#scan-title .stage-check")).toBeHidden();
    await expect(panel.locator("#scan-result")).toBeHidden();
    await expect(panel.locator(".candidate")).toHaveCount(0);
    // The access probe must not inject the content script or extract candidates.
    // Simulate only the notification from an icon click: fixture access is already granted.
    await context.serviceWorkers()[0].evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.runtime.sendMessage({
        type: "scan-request",
        windowId: tab.windowId,
      });
    });
    await expect(panel.locator(".candidate")).toHaveCount(3);
    await expect(panel.locator("#results-controls")).toBeVisible();
    await expect(panel.locator("#count")).toHaveText("3");
    await expect(
      panel.getByRole("button", { name: "再スキャン" }),
    ).toBeEnabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "0px");
    await expect(panel.locator("#rescan")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await source.evaluate(() => {
      document.body.replaceChildren(
        document.createTextNode("日程のないページ"),
      );
      document
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((script) => script.remove());
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator("#empty-title")).toBeVisible();
    await expect(panel.locator("#candidates-title")).toBeVisible();
    await expect(panel.locator("#count")).toBeVisible();
    await expect(panel.locator("#count")).toHaveText("0");
    await expect(panel.locator("#candidate-order")).toBeVisible();
    await expect(panel.locator("#candidate-order")).toBeDisabled();
    await expect(panel.locator("#empty-title")).toHaveText(
      "日程が見つかりませんでした",
    );
    await expect(panel.locator("#access-guide")).toBeHidden();
  } finally {
    await context.unroute("https://ungranted.example/**");
    await panel.close();
    await source.close();
  }
});

test("一時的な接続失敗は再試行でき、遅れた権限判定は別タブの状態を上書きしない", async () => {
  const { source, panel } = await open();
  let other;
  try {
    await expect(panel.locator("#scan-spinner")).toBeHidden();
    await expect(panel.locator("#rescan .scan-icon")).toBeHidden();
    await panel.evaluate(() => {
      const execute = chrome.scripting.executeScript.bind(chrome.scripting);
      window.__execute = execute;
      chrome.scripting.executeScript = async (details) => {
        if (details.files) {
          chrome.scripting.executeScript = execute;
          await new Promise((resolve) => {
            window.__resumeInjection = resolve;
          });
          throw new Error("Frame with ID 0 was removed.");
        }
        return execute(details);
      };
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(
      panel.getByRole("button", { name: "スキャン中…", exact: true }),
    ).toBeDisabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "0px");
    await expect(panel.locator("#scan-spinner")).toBeVisible();
    await expect(panel.locator("#scan-spinner")).toHaveCSS(
      "animation-duration",
      "3s",
    );
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await expect(panel.locator("#scan-spinner")).toHaveCSS(
      "animation-name",
      "none",
    );
    await panel.emulateMedia({ reducedMotion: "no-preference" });
    await expect(panel.locator("#results-controls")).toBeHidden();
    await expect(panel.locator("#empty")).toBeHidden();
    await expect
      .poll(() => panel.evaluate(() => Boolean(window.__resumeInjection)))
      .toBe(true);
    await panel.evaluate(() => window.__resumeInjection());
    await expect(
      panel.getByRole("button", { name: "再試行", exact: true }),
    ).toBeEnabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "1px");
    await expect(panel.locator("#scan-spinner")).toBeHidden();
    await expect(panel.locator("#notice")).toHaveClass(/error/);
    await expect(panel.locator("#access-guide")).toBeHidden();
    await expect(panel.locator("#empty")).toBeHidden();
    await panel.evaluate(() => {
      chrome.scripting.executeScript = async (details) => {
        if (details.files) {
          chrome.scripting.executeScript = window.__execute;
          await new Promise((resolve) => {
            window.__resumeRetry = resolve;
          });
        }
        return window.__execute(details);
      };
    });
    await panel.getByRole("button", { name: "再試行", exact: true }).click();
    await expect(panel.locator("#scan-spinner")).toBeVisible();
    await expect(panel.locator("#rescan")).toBeDisabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "1px");
    await expect
      .poll(() => panel.evaluate(() => Boolean(window.__resumeRetry)))
      .toBe(true);
    await panel.evaluate(() => window.__resumeRetry());
    await expect(panel.locator(".candidate")).toHaveCount(3);
    await expect(panel.locator("#scan-spinner")).toBeHidden();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "0px");

    await panel.evaluate(() => {
      chrome.scripting.executeScript = (details) => {
        if (details.func) {
          chrome.scripting.executeScript = window.__execute;
          return new Promise((_resolve, reject) => {
            window.__rejectAccess = reject;
          });
        }
        return window.__execute(details);
      };
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect
      .poll(() => panel.evaluate(() => Boolean(window.__rejectAccess)))
      .toBe(true);
    await expect(panel.locator("#scan-spinner")).toBeVisible();
    await expect(panel.locator("#rescan")).toBeDisabled();
    await expect(panel.locator("#rescan")).toHaveCSS("border-top-width", "0px");
    other = await context.newPage();
    await other.goto("chrome://settings");
    await expect(panel.locator("#scan-state")).toHaveText("対象外");
    await panel.evaluate(() =>
      window.__rejectAccess(new Error("Cannot access contents of url")),
    );
    await expect(panel.locator("#scan-state")).toHaveText("対象外");
    await expect(panel.locator("#access-guide")).toBeHidden();
  } finally {
    await panel.close();
    await other?.close();
    await source.close();
  }
});

test("ブランドと設定を下部にまとめ、主操作と本文を隠さず選択を保つ", async () => {
  const { source, panel } = await open();
  try {
    await expect(panel.locator("#panel-close")).toBeHidden();
    await expect(panel.locator("header")).toHaveCount(0);
    await expect(panel.locator("a.brand, button.brand")).toHaveCount(0);
    await expect(panel.locator("#footer .brand")).toBeVisible();
    await expect(panel.locator("#settings-toggle")).toHaveAccessibleName(
      "設定",
    );
    await expect(panel.locator("#settings-toggle")).toHaveAttribute(
      "title",
      "設定",
    );
    await expect(panel.locator("#footer-quote")).toBeHidden();
    await panel.screenshot({ path: "test-results/footer-layout-list.png" });
    await select(panel);
    await source.locator("#event-title").click();
    const title = await panel.locator("#picked-title").textContent();
    await panel.locator(".brand").click();
    await expect(panel.locator("#selection")).toBeVisible();
    await expect(panel.locator("#picked-title")).toHaveText(title);
    for (const [width, height] of [
      [390, 900],
      [280, 500],
      [390, 400],
    ]) {
      await panel.setViewportSize({ width, height });
      await expect
        .poll(async () => {
          return panel.evaluate(() => {
            const footer = document
              .getElementById("footer")
              .getBoundingClientRect();
            const action = document
              .getElementById("open-calendar")
              .getBoundingClientRect();
            const download = document
              .getElementById("download-calendar")
              .getBoundingClientRect();
            const settings = document
              .getElementById("settings-toggle")
              .getBoundingClientRect();
            const main = document.querySelector("main");
            return (
              footer.bottom <= innerHeight &&
              action.bottom <= settings.top &&
              action.right <= download.left &&
              download.right <= footer.right &&
              download.top >= action.top &&
              download.bottom <= action.bottom &&
              parseFloat(getComputedStyle(main).paddingBottom) >=
                footer.height &&
              document.documentElement.scrollWidth <= innerWidth
            );
          });
        })
        .toBe(true);
      await panel.locator("#field-details").focus();
      await expect
        .poll(async () =>
          panel.evaluate(
            () =>
              document.getElementById("field-details").getBoundingClientRect()
                .bottom <=
              document.getElementById("footer").getBoundingClientRect().top,
          ),
        )
        .toBe(true);
      await panel.screenshot({
        path: `test-results/footer-layout-pick-${width}-${height}.png`,
        animations: "disabled",
      });
      await panel.getByRole("button", { name: "設定", exact: true }).click();
      await expect(panel.locator("#footer")).toBeHidden();
      await expect(panel.locator("#footer-quote")).toBeVisible();
      await expect(panel.locator("#travel")).toBeFocused();
      await panel.keyboard.press("Escape");
      await expect(panel.locator("#settings-toggle")).toBeFocused();
      await expect(panel.locator("#selection")).toBeVisible();
      await expect(panel.locator("#picked-title")).toHaveText(title);
    }
  } finally {
    await panel.close();
    await source.close();
  }
});

test("出典ラベルとAIスピナーを表示し、リンクからAI設定へ移動して選択を保って戻る", async () => {
  const { source, panel } = await open();
  try {
    await source.evaluate(() => {
      const paragraph = document.createElement("p");
      paragraph.textContent = "11/25 15:00〜16:00 夜の集まり";
      document.querySelector("main").append(paragraph);
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = JSON.stringify({
        "@type": "Event",
        startDate: "2026-12-02",
        name: "構造化イベント",
      });
      document.head.append(script);
    });
    await panel.getByRole("button", { name: "再スキャン" }).click();
    await expect(panel.locator(".source-tag")).toHaveCount(0);
    await expect(panel.locator(".candidate-source")).toHaveCount(1);
    await expect(
      panel.locator('.date-content[title^="ページ本文"]'),
    ).toHaveCount(4);
    await expect(
      panel.locator('.date-content[title^="ページの構造化データ"]'),
    ).toHaveCount(1);
    await expect(panel.locator(".candidate-year")).toContainText(
      "年として解釈",
    );
    await panel.evaluate(() => {
      const checkbox = document.getElementById("ai-enabled");
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            prompt: () =>
              new Promise((resolve) => {
                window.__completeAI = resolve;
              }),
            destroy() {},
          }),
        },
      });
    });
    await panel.getByRole("button", { name: "設定", exact: true }).click();
    await panel.locator("#ai-enabled").check();
    await panel.locator("#settings-close").click();
    await expect(panel.locator("#ai-status")).toHaveText(
      "AIで日程を補完しています。表示されている候補は選べます。",
    );
    await expect(panel.locator("#ai-spinner")).toBeVisible();
    expect(
      await panel
        .locator("#ai-spinner")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("ai-spin");
    await panel.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await panel
        .locator("#ai-spinner")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await panel.setViewportSize({ width: 300, height: 850 });
    await panel.locator("#ai-status").scrollIntoViewIfNeeded();
    expect(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({ path: "test-results/ai-busy-narrow.png" });
    await select(panel);
    await source.locator("#event-title").click();
    const title = await panel.locator("#picked-title").textContent();
    await panel
      .getByRole("button", { name: "AIで日程を補完", exact: true })
      .click();
    await expect(panel.locator("#ai-enabled")).toBeFocused();
    await expect(panel.locator("#ai-enabled")).toBeInViewport();
    await expect
      .poll(() => panel.evaluate(() => typeof window.__completeAI))
      .toBe("function");
    await panel.evaluate(() =>
      window.__completeAI(
        JSON.stringify([
          {
            start: "2026-12-03T18:00:00+09:00",
            end: "2026-12-03T19:00:00+09:00",
            evidence: "夜の集まり",
          },
        ]),
      ),
    );
    await expect(panel.locator("#ai-status")).toHaveText(
      "AIの補完が完了しました。",
    );
    await panel.keyboard.press("Escape");
    await expect(panel.locator("#ai-settings-link")).toBeFocused();
    await expect(panel.locator("#ai-spinner")).toBeHidden();
    await expect(panel.locator("#picked-title")).toHaveText(title);
    await panel.getByRole("button", { name: "選び直す", exact: true }).click();
    await expect(panel.locator(".source-tag.is-ai")).toHaveText("AI");
    await expect(
      panel.locator('.date-content[title^="ローカルAI"]'),
    ).toHaveAttribute("title", /内容をご確認ください\n夜の集まり/);
    await panel.screenshot({
      path: "test-results/ai-source-labels.png",
      fullPage: true,
    });
    await panel.locator("#ai-settings-link").click();
    await panel.locator("#ai-enabled").uncheck();
    await panel.locator("#settings-close").click();
    await expect(panel.locator("#ai-area")).toBeHidden();
    await expect(panel.locator("#settings-toggle")).toBeFocused();
  } finally {
    await panel.close();
    await source.close();
  }
});

test("AIの失敗・再試行・無効化でスピナーを更新し、古い処理は新しい状態を上書きしない", async () => {
  const { source, panel } = await open();
  try {
    await panel.evaluate(() => {
      const checkbox = document.getElementById("ai-enabled");
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
      window.__aiRequests = [];
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            prompt: () =>
              new Promise((resolve, reject) => {
                window.__aiRequests.push({ resolve, reject });
              }),
            destroy() {},
          }),
        },
      });
    });
    await panel.getByRole("button", { name: "設定", exact: true }).click();
    await panel.locator("#ai-enabled").check();
    await panel.locator("#settings-close").click();
    await expect
      .poll(() => panel.evaluate(() => window.__aiRequests.length))
      .toBe(1);
    await panel.evaluate(() =>
      window.__aiRequests[0].reject(new Error("test failure")),
    );
    await expect(panel.locator("#ai-spinner")).toBeHidden();
    await expect(panel.locator("#ai-status")).toContainText(
      "補完はできませんでした",
    );
    await panel
      .getByRole("button", { name: "もう一度試す", exact: true })
      .click();
    await expect(panel.locator("#ai-spinner")).toBeVisible();
    await expect
      .poll(() => panel.evaluate(() => window.__aiRequests.length))
      .toBe(2);
    await panel.locator("#ai-settings-link").click();
    await panel.locator("#ai-enabled").uncheck();
    await expect(panel.locator("#ai-spinner")).toBeHidden();
    await panel.locator("#ai-enabled").check();
    await expect
      .poll(() => panel.evaluate(() => window.__aiRequests.length))
      .toBe(3);
    await panel.locator("#settings-close").click();
    await panel.evaluate(() =>
      window.__aiRequests[1].reject(new Error("late failure")),
    );
    await expect(panel.locator("#ai-spinner")).toBeVisible();
    await expect(panel.locator("#ai-status")).toContainText(
      "表示されている候補は選べます",
    );
    await panel.evaluate(() => window.__aiRequests[2].resolve("[]"));
    await expect(panel.locator("#ai-status")).toHaveText(
      "AIの補完が完了しました。",
    );
    await expect(panel.locator("#ai-spinner")).toBeHidden();
    await expect(panel.locator(".candidate")).toHaveCount(3);
  } finally {
    await panel.close();
    await source.close();
  }
});

for (const mode of ["other-browser", "detection-error", "missing-api"]) {
  test(`閉じるボタンを出さず通常のスキャンを維持する: ${mode}`, async () => {
    const initializers = {
      "other-browser": () => {
        Object.defineProperty(navigator, "brave", {
          value: { isBrave: async () => false },
        });
      },
      "detection-error": () => {
        Object.defineProperty(navigator, "brave", {
          value: {
            isBrave: async () => {
              throw new Error("Unavailable");
            },
          },
        });
      },
      "missing-api": () => {
        Object.defineProperty(navigator, "brave", {
          value: { isBrave: async () => true },
        });
        chrome.sidePanel.close = undefined;
      },
    };
    const { source, panel } = await open(undefined, initializers[mode]);
    try {
      await expect(panel.locator("#panel-close")).toBeHidden();
      await select(panel);
      await source.locator("#event-title").click();
      await expect(panel.locator("#picked-title")).toContainText(
        "蔵前の活版印刷ワークショップ",
      );
    } finally {
      await panel.close();
      await source.close();
    }
  });
}

test("Brave用の閉じる操作は対象ウィンドウを指定し、失敗時の選択と再試行を保つ", async () => {
  const { source, panel } = await open(undefined, () => {
    Object.defineProperty(navigator, "brave", {
      value: { isBrave: async () => true },
    });
    window.__closeCalls = [];
    window.__failClose = true;
    chrome.sidePanel.close = async (options) => {
      window.__closeCalls.push(options);
      if (window.__failClose) throw new Error("Close failed");
      await new Promise((resolve) => {
        window.__resolveClose = resolve;
      });
    };
  });
  try {
    const close = panel.getByRole("button", {
      name: "サイドバーを閉じる",
      exact: true,
    });
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute("title", "サイドバーを閉じる");
    await panel.screenshot({
      path: "test-results/brave-panel-close.png",
      animations: "disabled",
    });
    const expectedWindow = await panel.evaluate(
      async () => (await chrome.windows.getCurrent()).id,
    );
    await select(panel);
    await source.locator("#event-title").click();
    const title = await panel.locator("#picked-title").textContent();
    await close.click();
    await expect(panel.locator("#panel-close-error")).toBeVisible();
    await expect(close).toBeEnabled();
    await expect(panel.locator("#picked-title")).toHaveText(title);
    // A failed close must leave the content-script connection and picker usable.
    await source.locator("#venue").click();
    await expect(panel.locator("#picked-location")).toContainText(
      "東京都台東区蔵前3丁目",
    );
    await expectPickerActionsOnly(source, 2);
    for (const width of [390, 280]) {
      await panel.setViewportSize({ width, height: 500 });
      await expect
        .poll(async () =>
          panel.evaluate(() => {
            const close = document
              .getElementById("panel-close")
              .getBoundingClientRect();
            const settings = document
              .getElementById("settings-toggle")
              .getBoundingClientRect();
            const footer = document
              .getElementById("footer")
              .getBoundingClientRect();
            return (
              close.width >= 36 &&
              close.height >= 36 &&
              settings.right <= close.left &&
              footer.bottom <= innerHeight &&
              document.documentElement.scrollWidth <= innerWidth &&
              parseFloat(
                getComputedStyle(document.querySelector("main")).paddingBottom,
              ) >= footer.height
            );
          }),
        )
        .toBe(true);
    }
    await panel.setViewportSize({ width: 390, height: 900 });
    await panel.evaluate(() => {
      window.__failClose = false;
    });
    await close.focus();
    await panel.keyboard.press("Enter");
    await expect(close).toBeDisabled();
    await expect(panel.locator("#panel-close-error")).toBeHidden();
    await expect
      .poll(() => panel.evaluate(() => window.__closeCalls))
      .toEqual([{ windowId: expectedWindow }, { windowId: expectedWindow }]);
    await panel.evaluate(() => window.__resolveClose());
    // Native panels are outside Playwright's page surface. Keep the document
    // alive after API success to exercise cleanup even if the browser caches it.
    await expect(source.locator("sche10le-picker")).toHaveCount(0);
    await expect(close).toBeEnabled();
    await expect(panel.locator("#selection")).toBeHidden();
  } finally {
    if (!panel.isClosed()) await panel.close();
    await source.close();
  }
});

test("日程カードは自動で開閉し、クリックやEnterでは切り替わらない", async () => {
  const { source, panel } = await open();
  try {
    const card = panel.locator(".candidate").first();
    const heading = card.locator(".candidate-heading");
    const region = card.locator(".variant-region");
    await card.hover();
    await expect(card).toHaveClass(/expanded/);
    // A heading is focusable context, not a manual toggle.
    await expect(heading).toHaveRole("group");
    await heading.click();
    await heading.click();
    await expect(card).toHaveClass(/expanded/);
    await expect(region).toHaveJSProperty("inert", false);
    await panel.locator(".brand").hover();
    await expect(card).not.toHaveClass(/expanded/);
    // The mouse click left focus on the heading. It must not keep later hovers open.
    await card.hover();
    await expect(card).toHaveClass(/expanded/);
    await panel.locator(".brand").hover();
    await expect(card).not.toHaveClass(/expanded/);
    // Keyboard focus still reveals options and keeps them reachable with Tab.
    await panel.locator("#candidate-order").focus();
    await panel.keyboard.press("Tab");
    await expect(heading).toBeFocused();
    await expect(card).toHaveClass(/expanded/);
    await panel.keyboard.press("Enter");
    await expect(card).toHaveClass(/expanded/);
    await panel.keyboard.press("Enter");
    await expect(card).toHaveClass(/expanded/);
    await panel.keyboard.press("Tab");
    await expect(card.locator(".variant").first()).toBeFocused();
    await expect(region).toHaveJSProperty("inert", false);
    await panel.locator("#settings-toggle").focus();
    await expect(card).not.toHaveClass(/expanded/);
  } finally {
    await panel.close();
    await source.close();
  }
});

test("タッチのフォーカス移動で日程カードが切り替わり、再タップでも閉じない", async () => {
  const { source, panel } = await open();
  const session = await context.newCDPSession(panel);
  try {
    await panel.mouse.move(0, 0);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const card = panel.locator(".candidate").first();
    const heading = card.locator(".candidate-heading");
    async function tap(locator) {
      await locator.scrollIntoViewIfNeeded();
      const rect = await locator.boundingBox();
      expect(rect).toBeTruthy();
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        ],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    await expect(card).not.toHaveClass(/expanded/);
    await tap(heading);
    await expect(card).toHaveClass(/expanded/);
    await tap(heading);
    await expect(card).toHaveClass(/expanded/);
    const next = panel.locator(".candidate").nth(1);
    await tap(next.locator(".candidate-heading"));
    await expect(next).toHaveClass(/expanded/);
    await expect(card).not.toHaveClass(/expanded/);
    await tap(heading);
    await expect(card).toHaveClass(/expanded/);
    // Let the unfolding region finish before deriving touch coordinates.
    await expect
      .poll(async () =>
        card
          .locator(".variant-region")
          .evaluate((element) => element.getAnimations().length),
      )
      .toBe(0);
    await tap(card.locator(".variant").first());
    await expect(panel.locator("#selection")).toBeVisible();
    await expect(source.locator("sche10le-picker")).toHaveCount(1);
  } finally {
    await session.detach();
    await panel.close();
    await source.close();
  }
});

test("ICSを取得途中でもダウンロードし、書式・移動時間を反映して選択と失敗後の再試行を保つ", async () => {
  const { source, panel } = await open();
  try {
    const downloadButton = panel.getByRole("button", {
      name: "予定をダウンロード（.ics）",
      exact: true,
    });
    await expect(downloadButton).toBeHidden();
    await panel.getByRole("button", { name: "設定", exact: true }).click();
    await panel.locator("#travel").fill("30");
    await panel.locator("#title-format").fill("{from:HHmm} {title} {to:HHmm}");
    await panel.getByRole("button", { name: "閉じる", exact: true }).click();
    await select(panel, "移動込み");
    await source.locator("#event-title").click();
    await source.locator("#venue").click();
    await expect(downloadButton).toHaveAttribute(
      "title",
      "予定をダウンロード（.ics）",
    );
    const downloadEvent = panel.waitForEvent("download");
    await downloadButton.focus();
    await panel.keyboard.press("Enter");
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("sche10le-2026-11-08.ics");
    const file = (await readFile(await download.path(), "utf8")).replace(
      /\r\n[ \t]/g,
      "",
    );
    expect(file).toContain(
      "SUMMARY:1400 蔵前の活版印刷ワークショップ 1600\r\n",
    );
    expect(file).toContain(
      "DTSTART:20261108T043000Z\r\nDTEND:20261108T073000Z\r\n",
    );
    expect(file).toContain("LOCATION:東京都台東区蔵前3丁目 アトリエ蔵前\r\n");
    expect(file).toContain(`${baseUrl}/\r\n`);
    await expect(panel.locator("#selection")).toBeVisible();
    await expect(source.locator("sche10le-picker")).toHaveCount(1);
    expect(
      await panel.evaluate(() => window.__calendarRequest),
    ).toBeUndefined();
    await panel.evaluate(() => {
      const create = URL.createObjectURL;
      URL.createObjectURL = (...args) => {
        URL.createObjectURL = create;
        throw new Error(`download failed: ${args.length}`);
      };
    });
    await downloadButton.click();
    await expect(panel.locator("#notice")).toContainText(
      "予定ファイルを作成できませんでした",
    );
    await expect(panel.locator("#selection")).toBeVisible();
    const retry = panel.waitForEvent("download");
    await downloadButton.click();
    expect(await (await retry).failure()).toBeNull();
    await expect(panel.locator("#notice")).toHaveText("");
    await panel.getByRole("button", { name: "選び直す", exact: true }).click();
    await select(panel, "終日");
    const allDayEvent = panel.waitForEvent("download");
    await downloadButton.click();
    const allDay = await allDayEvent;
    const allDayFile = (await readFile(await allDay.path(), "utf8")).replace(
      /\r\n[ \t]/g,
      "",
    );
    expect(allDayFile).toContain(
      "DTSTART;VALUE=DATE:20261108\r\nDTEND;VALUE=DATE:20261109\r\n",
    );
  } finally {
    await panel.close();
    await source.close();
  }
});
