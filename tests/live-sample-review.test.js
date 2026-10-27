import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sites } from "./live/sites.js";
import { reviewSamples, reviewMarkdown } from "./live/sample-review.js";

const sample = {
  id: "example",
  name: "Example",
  url: "https://example.com/event/1",
  identity: "イベント",
  reviewedOn: "2026-10-01",
  expected: {
    start: "2026-10-02T10:00:00+09:00",
    end: "2026-10-02T12:00:00+09:00",
  },
};
const reviewAt = (date, site = sample) =>
  reviewSamples([site], { now: new Date(date) })[0];

test("開催終了30日後の日本時間0時に見直し対象となる", () => {
  const before = reviewAt("2026-10-31T14:59:59Z");
  const after = reviewAt("2026-10-31T15:00:00Z");
  assert.equal(before.due, false);
  assert.equal(after.due, true);
  assert.equal(after.reviewBy, "2026-11-01");
  assert.deepEqual(after.reasons, ["開催終了から30日経過"]);
});

test("未来のイベントも確認から90日で見直し、両条件に当てはまれば両方知らせる", () => {
  const future = {
    ...sample,
    expected: {
      start: "2027-02-01T10:00:00+09:00",
      end: "2027-02-01T12:00:00+09:00",
    },
  };
  assert.equal(reviewAt("2026-12-29T00:00:00+09:00", future).due, false);
  const after = reviewAt("2026-12-30T00:00:00+09:00", future);
  assert.equal(after.reviewBy, "2026-12-30");
  assert.deepEqual(after.reasons, ["最終確認から90日経過"]);
  assert.equal(reviewAt("2026-12-30T00:00:00+09:00").reasons.length, 2);
});

test("イベント終了の時差を日本時間に換算し、年越しでも暦日で数える", () => {
  const overseas = {
    ...sample,
    reviewedOn: "2026-12-01",
    expected: {
      start: "2026-12-31T22:00:00-08:00",
      end: "2026-12-31T23:00:00-08:00",
    },
  };
  assert.equal(reviewAt("2027-01-30T23:59:59+09:00", overseas).due, false);
  assert.equal(reviewAt("2027-01-31T00:00:00+09:00", overseas).due, true);
});

test("欠落・存在しない日・未来の確認日を拒否し、閏日は受け付ける", () => {
  for (const reviewedOn of [undefined, "", "2026-2-1", "2026-02-30", "2026-10-03"]) {
    assert.throws(() => reviewAt("2026-10-02T12:00:00+09:00", { ...sample, reviewedOn }));
  }
  assert.doesNotThrow(() => reviewAt("2026-10-02T12:00:00+09:00", {
    ...sample, reviewedOn: "2024-02-29",
  }));
  assert.throws(() => reviewAt("invalid"));
});

test("見直し対象を除外せず全件表示し、元の登録値を変更しない", () => {
  const input = [structuredClone(sample), { ...sample, id: "second", name: "Second" }];
  const original = structuredClone(input);
  const result = reviewSamples(input, { now: new Date("2027-01-01T00:00:00Z") });
  assert.equal(result.length, 2);
  assert.ok(result.every((row) => row.due));
  assert.deepEqual(input, original);
  const markdown = reviewMarkdown(result);
  assert.match(markdown, /見直し対象: 2 \/ 2/);
  assert.match(markdown, /example/);
  assert.match(markdown, /second/);
});

test("登録済み全サイトに確認日があり、CLIが追加依存やビルドなしで一覧を出す", () => {
  assert.equal(reviewSamples(sites).length, sites.length);
  const output = execFileSync(process.execPath, ["scripts/check-live-samples.js"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
  });
  for (const site of sites) assert.ok(output.includes(site.id));
});
