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
test("ライブ対象は登録済みIDだけを選び、未知ID・重複・認証URL・曖昧な日時を拒否する", () => {
  assert.equal(validateSites(sites), sites);
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
  assert.equal(reporter.results.size, 6);
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
