import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  accessCategory,
  candidateFromId,
  matchesExpected,
  validateSites,
} from "./contract.js";

// Uses the real production build, content script, extraction, and sidepanel rendering.
// Only the disposable test copy receives host access; activeTab toolbar gestures
// themselves remain covered by manual release checks.
export async function runLiveCase(
  site,
  { allowLocalhost = false, readinessTimeout = 15_000 } = {},
) {
  validateSites([site], { allowLocalhost });
  const started = Date.now();
  const report = {
    id: site.id,
    name: site.name,
    url: site.url,
    checkedAt: new Date().toISOString(),
    expected: site.expected,
    status: "failed",
    category: "HARNESS_ERROR",
    phase: "setup",
    candidates: [],
  };
  let workspace;
  let context;
  try {
    workspace = await mkdtemp(path.join(tmpdir(), "sche10le-live-"));
    const extension = path.join(workspace, "extension");
    await cp(path.resolve(".output/chrome-mv3"), extension, {
      recursive: true,
    });
    const manifestPath = path.join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(
      [...manifest.permissions].sort(),
      ["activeTab", "scripting", "sidePanel", "storage"].sort(),
    );
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    const origin = new URL(site.url).origin;
    manifest.host_permissions = [`${origin}/*`];
    await writeFile(manifestPath, JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(
      path.join(workspace, "profile"),
      {
        channel: "chromium",
        headless: true,
        chromiumSandbox: process.env.LIVE_CHROMIUM_SANDBOX === "1",
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        viewport: { width: 1280, height: 900 },
        acceptDownloads: false,
      },
    );
    context.setDefaultTimeout(10_000);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    // Fresh profiles already default to disabled, but make AI independence explicit.
    await worker.evaluate(() => chrome.storage.local.clear());
    const source = await context.newPage();
    let unexpectedNavigation = false;
    // Redirected requests may bypass route handlers; record their origin as well.
    source.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === source.mainFrame() &&
        new URL(request.url()).origin !== origin
      )
        unexpectedNavigation = true;
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame() === source.mainFrame() &&
        new URL(request.url()).origin !== origin
      ) {
        unexpectedNavigation = true;
        return route.abort();
      }
      if (["image", "media", "font"].includes(request.resourceType()))
        return route.abort();
      return route.continue();
    });
    const health = () =>
      source
        .evaluate(() => ({
          title: document.title,
          lead: (document.body?.innerText ?? "").slice(0, 1000),
        }))
        .catch(() => ({ title: "", lead: "" }));
    let response;
    report.phase = "navigation";
    try {
      response = await source.goto(site.url, {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
    } catch {
      const state = await health();
      report.category = unexpectedNavigation
        ? "TARGET_CHANGED"
        : (accessCategory(null, state.title, state.lead, source.url()) ??
          "NETWORK_ERROR");
      return report;
    }
    report.httpStatus = response?.status() ?? null;
    const final = new URL(source.url());
    report.finalUrl = `${final.origin}${final.pathname}`;
    const httpFailure = accessCategory(report.httpStatus);
    if (httpFailure) {
      report.category = httpFailure;
      return report;
    }
    // Readiness uses event identity and settled rendered text, never the expected
    // dates or the extractor's output. A date mismatch must not become a timeout.
    report.phase = "readiness";
    try {
      await source.waitForFunction(
        ({ identity, readySelector }) => {
          const text = (document.body?.innerText ?? "").slice(0, 100_000);
          const json = [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
          ]
            .slice(0, 50)
            .map((el) => (el.textContent ?? "").slice(0, 200_001))
            .join("\n");
          const snapshot = text + json;
          const previous = window.__sche10leLiveReady;
          if (!previous || previous.snapshot !== snapshot) {
            window.__sche10leLiveReady = { snapshot, since: performance.now() };
            return false;
          }
          return (
            document.readyState === "complete" &&
            (document.title.includes(identity) || text.includes(identity)) &&
            (!readySelector || document.querySelector(readySelector)) &&
            performance.now() - previous.since >= 750
          );
        },
        { identity: site.identity, readySelector: site.readySelector },
        { timeout: readinessTimeout, polling: 250 },
      );
    } catch {
      const state = await health();
      report.category = unexpectedNavigation
        ? "TARGET_CHANGED"
        : (accessCategory(
            report.httpStatus,
            state.title,
            state.lead,
            source.url(),
          ) ??
          (state.title.includes(site.identity)
            ? "PAGE_NOT_READY"
            : "TARGET_CHANGED"));
      return report;
    }
    const state = await health();
    const blocked = accessCategory(
      report.httpStatus,
      state.title,
      state.lead,
      source.url(),
    );
    if (blocked || unexpectedNavigation) {
      report.category = blocked ?? "TARGET_CHANGED";
      return report;
    }
    const panel = await context.newPage();
    report.phase = "scan";
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.locator("#scan-state")).toHaveText("対象外");
    await source.bringToFront();
    await panel.getByRole("button", { name: "スキャン", exact: true }).click();
    await expect(panel.locator("#scan-state")).toHaveText("スキャン完了");
    const ids = await panel
      .locator(".candidate")
      .evaluateAll((cards) => cards.map((card) => card.dataset.candidateId));
    report.candidates = ids.map(candidateFromId);
    report.phase = "compare";
    report.category = matchesExpected(report.candidates, site.expected)
      ? "PASS"
      : "DATE_MISMATCH";
    report.status = report.category === "PASS" ? "passed" : "failed";
    return report;
  } catch {
    // Never attach Playwright DOM snapshots or site HTML to CI diagnostics.
    report.category = "HARNESS_ERROR";
    return report;
  } finally {
    try {
      await context?.close();
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true });
      report.durationMs = Date.now() - started;
    }
  }
}
