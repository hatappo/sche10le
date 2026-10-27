import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { runLiveCase } from "../live/run-case.js";

// Match the live runner: tracing would try to snapshot the frozen-page fixture.
test.use({ trace: "off" });

let server;
let origin;
let manifestBefore;
let navigations = [];
const identity = "ライブ検証用イベント";
const expected = {
  start: "2026-11-05T20:00:00+09:00",
  end: "2026-11-05T21:00:00+09:00",
};

test.beforeAll(async () => {
  manifestBefore = await readFile(".output/chrome-mv3/manifest.json", "utf8");
  server = createServer((req, res) => {
    navigations.push(req.url);
    if (req.url === "/body-rendered") {
      res.writeHead(204);
      res.end();
      return;
    }
    const code = Number(req.url.slice(1));
    if ([403, 429, 404].includes(code)) {
      res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<title>Error</title>");
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, {
        Location: `http://localhost:${server.address().port}/unexpected`,
      });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (req.url === "/unresponsive") {
      res.end(`<title>${identity}</title><main>2026年11月5日 20:00〜21:00</main>
        <script>
          addEventListener('load', () => {
            const until = Date.now() + 15000;
            while (Date.now() < until) { /* Simulate a blocked renderer. */ }
          });
        </script>`);
      return;
    }
    if (req.url === "/delayed-body" || req.url === "/delayed-no-dates") {
      const content =
        req.url === "/delayed-body"
          ? "2026年11月5日 20:00〜21:00"
          : "開催内容は公開されていますが日時の記載はありません。";
      res.end(`<title>${identity}</title><header>イベントサイト</header>
        <main id="event-details" hidden></main><footer>ページ末尾</footer>
        <script>
          // Fetch/hydration can finish long after document.readyState is complete.
          setTimeout(() => {
            const details = document.querySelector('#event-details');
            details.textContent = ${JSON.stringify(content)};
            details.hidden = false;
            fetch('/body-rendered');
          }, 2500);
        </script>`);
    } else if (req.url === "/empty-details")
      res.end(`<title>${identity}</title><main id="event-details"></main>`);
    else if (req.url === "/hidden-details")
      res.end(
        `<title>${identity}</title><main id="event-details" style="visibility:hidden">2026年11月5日 20:00〜21:00</main>`,
      );
    else if (req.url === "/challenge")
      res.end("<title>Just a moment...</title><p>Verify you are human</p>");
    else if (req.url === "/changed")
      res.end("<title>別のイベント</title><p>2026年11月5日 20:00〜21:00</p>");
    else
      res.end(
        `<title>${identity}</title><main><h1>${identity}</h1><p>2026年11月5日 20:00〜21:00</p></main>`,
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test("ページが応答しなくても状態確認を打ち切り、検証段階を残す", async () => {
  test.setTimeout(10_000);
  navigations = [];
  const progress = [];
  const result = await runLiveCase(
    {
      id: "fixture",
      name: "テスト",
      url: `${origin}/unresponsive`,
      identity,
      expected,
    },
    {
      allowLocalhost: true,
      readinessTimeout: 500,
      onProgress: async (snapshot) => progress.push(snapshot),
    },
  );
  expect(result.status).toBe("failed");
  expect(result.category).toBe("PAGE_NOT_READY");
  expect(result.healthUnavailable).toBe(true);
  expect(result.httpStatus).toBe(200);
  expect(result.durationMs).toBeLessThan(8000);
  expect(progress.map((p) => p.phase)).toContain("readiness-health");
  expect(progress.at(-1).phase).toBe("cleanup");
  expect(navigations.filter((url) => url === "/unresponsive")).toHaveLength(1);
  expect(JSON.stringify(progress)).not.toMatch(/<main|ライブ検証用イベント/);
});

test.afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  expect(await readFile(".output/chrome-mv3/manifest.json", "utf8")).toBe(
    manifestBefore,
  );
});

for (const [route, category, dates] of [
  ["event", "PASS", expected],
  [
    "mismatch",
    "DATE_MISMATCH",
    { ...expected, end: "2026-11-05T22:00:00+09:00" },
  ],
  ["403", "ACCESS_BLOCKED", expected],
  ["429", "RATE_LIMITED", expected],
  ["404", "PAGE_MISSING", expected],
  ["challenge", "ACCESS_BLOCKED", expected],
  ["changed", "TARGET_CHANGED", expected],
  ["redirect", "TARGET_CHANGED", expected],
]) {
  test(`ライブ検証のローカル確認: ${route} → ${category}`, async () => {
    navigations = [];
    const result = await runLiveCase(
      {
        id: "fixture",
        name: "テスト",
        url: `${origin}/${route}`,
        identity,
        expected: dates,
      },
      { allowLocalhost: true, readinessTimeout: 2000 },
    );
    expect(result.category).toBe(category);
    expect(result.status).toBe(category === "PASS" ? "passed" : "failed");
    expect(navigations.filter((url) => url === `/${route}`)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(
      /<html|<main|<title|ライブ検証用イベント/,
    );
    if (category === "PASS") expect(result.candidates).toHaveLength(1);
  });
}

for (const [route, category] of [
  ["delayed-body", "PASS"],
  ["delayed-no-dates", "DATE_MISMATCH"],
  ["empty-details", "PAGE_NOT_READY"],
  ["hidden-details", "PAGE_NOT_READY"],
]) {
  test(`本文の描画待ち: ${route} → ${category}`, async () => {
    navigations = [];
    const result = await runLiveCase(
      {
        id: "fixture",
        name: "テスト",
        url: `${origin}/${route}`,
        identity,
        expected,
        readySelector: "#event-details",
      },
      { allowLocalhost: true, readinessTimeout: 5000 },
    );
    expect(result.category).toBe(category);
    expect(result.status).toBe(category === "PASS" ? "passed" : "failed");
    expect(navigations.filter((url) => url === `/${route}`)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/<main|イベントサイト/);
    if (route.startsWith("delayed-"))
      expect(navigations).toContain("/body-rendered");
  });
}
