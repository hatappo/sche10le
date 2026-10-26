import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { runLiveCase } from "../live/run-case.js";

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
    if (req.url === "/challenge")
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
