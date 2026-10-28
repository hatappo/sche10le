import test from "node:test";
import assert from "node:assert/strict";
import { sites } from "./live/sites.js";
import {
  accessCategory,
  candidateFromId,
  matchesExpected,
  reportOutcome,
  selectSites,
  summaryMarkdown,
  validateSites,
} from "./live/contract.js";
import LiveReporter from "./live/reporter.js";

const sample = sites[0];
test("CI標準だけこくちーずプロを除外し、全件・個別指定では対象に残す", () => {
  const selected = selectSites(sites, "ci");
  assert.equal(selected.length, sites.length - 1);
  assert.ok(selected.every((s) => s.id !== "kokuchpro"));
  assert.equal(selectSites(sites).length, sites.length);
  assert.equal(selectSites(sites, "all").length, sites.length);
  assert.deepEqual(selectSites(sites, "kokuchpro").map((s) => s.id), ["kokuchpro"]);
  assert.throws(() => selectSites([{ ...sample, ciExclusionReason: "対象外" }], "ci"));
  assert.throws(() => validateSites([{ ...sample, ciExclusionReason: " " }]));
  assert.throws(() => validateSites([{ ...sample, ciExclusionReason: true }]));
  assert.throws(() => validateSites([{ ...sample, id: "ci" }]));
  const newSite = { ...sample, id: "new-service" };
  assert.deepEqual(selectSites([newSite, { ...sample, ciExclusionReason: "対象外" }], "ci"), [newSite]);
});

test("CI標準の除外理由を未検証として表示し、実行結果や合格件数に混ぜない", () => {
  const reporter = new LiveReporter({ selection: "ci" });
  const selected = selectSites(sites, "ci");
  reporter.onBegin({}, { allTests: () => selected.map((s) => ({ title: s.id })) });
  assert.equal(reporter.results.size, selected.length);
  assert.equal(reporter.results.has("kokuchpro"), false);
  assert.deepEqual(reporter.excludedSites.map((s) => s.id), ["kokuchpro"]);
  assert.ok(reporter.excludedSites[0].reason.trim());
  const reports = [...reporter.results.values()].map((r) => ({ ...r, status: "passed", category: "PASS" }));
  const summary = summaryMarkdown(reports, "passed", reporter.excludedSites);
  assert.match(summary, /標準対象外（未検証）/);
  assert.match(summary, /kokuchpro/);
  assert.equal(reportOutcome(reports, "passed"), "passed");
  reports[0].status = "failed";
  assert.equal(reportOutcome(reports, "passed"), "failed");
  assert.equal(reportOutcome([], "passed"), "failed");
  for (const selection of ["all", "kokuchpro"]) {
    const explicit = new LiveReporter({ selection });
    explicit.onBegin({}, { allTests: () => selectSites(sites, selection).map((s) => ({ title: s.id })) });
    assert.deepEqual(explicit.excludedSites, []);
    assert.ok(explicit.results.has("kokuchpro"));
  }
});

test("ライブ対象は登録済みIDだけを選び、未知ID・重複・認証URL・曖昧な日時を拒否する", () => {
  assert.equal(validateSites(sites), sites);
  assert.deepEqual(selectSites(sites, "kokuchpro").map((s) => s.id), ["kokuchpro"]);
  assert.deepEqual(
    selectSites(sites, "peatix,connpass,peatix").map((s) => s.id),
    ["connpass", "peatix"],
  );
  assert.throws(() => selectSites(sites, "connpas"));
  assert.throws(() => selectSites(sites, ""));
  assert.throws(() => validateSites([sample, sample]));
  assert.throws(() =>
    validateSites([{ ...sample, url: "https://user:secret@example.com/" }]),
  );
  assert.throws(() =>
    validateSites([{ ...sample, url: "http://example.com/" }]),
  );
  for (const expected of [
    { start: "2026-10-29T21:00:00", end: "2026-10-29T23:00:00" },
    { start: "2026-02-30T21:00:00+09:00", end: "2026-03-01T23:00:00+09:00" },
    { start: sample.expected.end, end: sample.expected.start },
  ])
    assert.throws(() => validateSites([{ ...sample, expected }]));
});

test("ライブ判定は開催日時の両端を照合し、0件・別日時・終了だけ違う候補を合格にしない", () => {
  const expected = {
    start: "2026-11-05T20:00:00+09:00",
    end: "2026-11-05T21:00:00+09:00",
  };
  const actual = candidateFromId(
    "2026-11-05/2026-11-05/2026-11-05T11:00:00.000Z/2026-11-05T12:00:00.000Z",
  );
  assert.ok(matchesExpected([actual], expected));
  assert.equal(matchesExpected([], expected), false);
  assert.equal(
    matchesExpected([{ ...actual, end: "2026-11-05T13:00:00.000Z" }], expected),
    false,
  );
  assert.equal(
    matchesExpected([candidateFromId("2026-11-05/2026-11-05//")], expected),
    false,
  );
});

test("アクセス制限・消失・障害を区別し、通常ページのログイン案内はブロック扱いにしない", () => {
  for (const [status, category] of [
    [403, "ACCESS_BLOCKED"],
    [429, "RATE_LIMITED"],
    [404, "PAGE_MISSING"],
    [410, "PAGE_MISSING"],
    [503, "HTTP_ERROR"],
  ]) {
    assert.equal(accessCategory(status), category);
  }
  assert.equal(accessCategory(200, "Just a moment..."), "ACCESS_BLOCKED");
  assert.equal(
    accessCategory(
      202,
      "",
      "In order to continue, we need to verify that you're not a robot.",
    ),
    "ACCESS_BLOCKED",
  );
  assert.equal(
    accessCategory(200, "講座", "参加にはログインしてください。"),
    null,
  );
  assert.equal(
    accessCategory(200, "講座", "", "https://example.com/login?return=event"),
    "ACCESS_BLOCKED",
  );
});

test("レポートは実行されなかったサイトを残し、後処理の失敗も合格にしない", () => {
  const reporter = new LiveReporter();
  reporter.onBegin({}, { allTests: () => sites.map((s) => ({ title: s.id })) });
  assert.equal(reporter.results.size, sites.length);
  assert.equal(reporter.results.get("meetup").category, "NOT_RUN");
  reporter.onTestEnd(
    { title: sample.id },
    {
      status: "failed",
      attachments: [
        {
          name: "live-result",
          body: Buffer.from(
            JSON.stringify({ ...sample, status: "passed", category: "PASS" }),
          ),
        },
      ],
    },
  );
  assert.equal(reporter.results.get(sample.id).category, "HARNESS_ERROR");
  const summary = summaryMarkdown([...reporter.results.values()], "failed");
  assert.ok(summary.includes("NOT_RUN"));
  assert.ok(summary.includes("HARNESS_ERROR"));
  assert.equal(
    reportOutcome([...reporter.results.values()], "passed"),
    "failed",
  );
  assert.equal(reportOutcome([], "passed"), "failed");
  assert.equal(reportOutcome([{ status: "passed" }], "passed"), "passed");
  assert.equal(
    reportOutcome([{ status: "passed" }], "interrupted"),
    "interrupted",
  );
});

test("全体タイムアウトでも最後の段階・HTTP状態・経過時間を残す", () => {
  const reporter = new LiveReporter();
  reporter.onBegin({}, { allTests: () => sites.map((s) => ({ title: s.id })) });
  const snapshot = { id: sample.id, name: sample.name, url: sample.url,
    expected: sample.expected, status: "failed", category: "HARNESS_ERROR", candidates: [] };
  reporter.onTestEnd({ title: sample.id }, {
    status: "timedOut", duration: 75_000,
    attachments: [
      { name: "live-progress", body: Buffer.from(JSON.stringify({ ...snapshot, phase: "navigation", durationMs: 200 })) },
      { name: "live-progress", body: Buffer.from(JSON.stringify({ ...snapshot, httpStatus: 200, phase: "readiness-health", durationMs: 15_200 })) },
    ],
  });
  const result = reporter.results.get(sample.id);
  assert.equal(result.status, "failed");
  assert.equal(result.category, "TEST_TIMEOUT");
  assert.equal(result.phase, "readiness-health");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.durationMs, 75_000);
  assert.deepEqual(result.phaseHistory, [
    { phase: "navigation", elapsedMs: 200 },
    { phase: "readiness-health", elapsedMs: 15_200 },
  ]);
  assert.equal(reporter.results.get("meetup").category, "NOT_RUN");
  const summary = summaryMarkdown([result], "failed");
  assert.ok(summary.includes("readiness-health"));
  assert.ok(summary.includes("TEST_TIMEOUT"));
});

test("終了処理でタイムアウトしても途中のPASSを採用せず、開始前のタイムアウトも区別する", () => {
  for (const attachments of [[], [{ name: "live-progress", body: Buffer.from(JSON.stringify({
    ...sample, status: "passed", category: "PASS", phase: "cleanup", durationMs: 70_000, candidates: [],
  })) }]]) {
    const reporter = new LiveReporter();
    reporter.onBegin({}, { allTests: () => [{ title: sample.id }] });
    reporter.onTestEnd({ title: sample.id }, { status: "timedOut", duration: 75_000, attachments });
    assert.equal(reporter.results.get(sample.id).category, "TEST_TIMEOUT");
    assert.equal(reporter.results.get(sample.id).status, "failed");
  }
});

test("時間切れ後のcleanupで実際の停止段階を上書きしない", () => {
  const reporter = new LiveReporter();
  reporter.onBegin({}, { allTests: () => [{ title: sample.id }] });
  const snapshot = {
    ...sample, status: "failed", category: "HARNESS_ERROR", candidates: [],
    checkedAt: "2026-10-28T00:00:00.500Z", httpStatus: 200,
  };
  reporter.onTestEnd({ title: sample.id }, {
    status: "timedOut", duration: 1500, startTime: new Date("2026-10-28T00:00:00.000Z"),
    attachments: [
      { name: "live-progress", body: Buffer.from(JSON.stringify({ ...snapshot, phase: "readiness-health", durationMs: 500 })) },
      { name: "live-progress", body: Buffer.from(JSON.stringify({ ...snapshot, phase: "cleanup", durationMs: 1100 })) },
      { name: "live-result", body: Buffer.from(JSON.stringify({ ...snapshot, phase: "cleanup", durationMs: 1200 })) },
    ],
  });
  const result = reporter.results.get(sample.id);
  assert.equal(result.category, "TEST_TIMEOUT");
  assert.equal(result.phase, "readiness-health");
  assert.equal(result.phaseHistory.length, 1);
});
