import assert from "node:assert/strict";
import test from "node:test";
import { createVariants, registrationSummary } from "../lib/calendar.js";
import { extractTextEvents, extractStructuredEvents } from "../lib/extract.js";

test("登録内容は選んだパターンの時刻を示し、終日を重複表示しない", () => {
  const candidate = extractTextEvents("2026/11/8 14:00〜16:00")[0];
  assert.deepEqual(
    createVariants(candidate).map((variant) =>
      registrationSummary(variant, candidate),
    ),
    ["時間どおり 14:00–16:00", "移動込み 13:30–16:30", "終日"],
  );
});

test("移動込みで前日・翌年にまたがる場合は実際の両端の日付を示す", () => {
  for (const [text, expected] of [
    ["2026/11/8 00:15〜01:00", "移動込み 2026/11/07 23:45–2026/11/08 01:30"],
    ["2026/12/31 23:00〜23:45", "移動込み 2026/12/31 22:30–2027/01/01 00:15"],
  ]) {
    const candidate = extractTextEvents(text)[0];
    assert.equal(
      registrationSummary(createVariants(candidate)[1], candidate),
      expected,
    );
  }
});

test("深夜0時に終わる予定を終日にする際は登録対象日を明示する", () => {
  const candidate = extractStructuredEvents([
    JSON.stringify({
      "@type": "Event",
      startDate: "2026-11-08T23:00:00",
      endDate: "2026-11-09T00:00:00",
    }),
  ])[0];
  const allDay = createVariants(candidate)[2];
  assert.equal(
    registrationSummary(allDay, candidate),
    "終日 2026年11月8日(日)",
  );
});

test("終了時刻が仮の場合の注記を登録内容にも残す", () => {
  const candidate = extractTextEvents("2026/11/8 14:00")[0];
  assert.equal(
    registrationSummary(createVariants(candidate)[0], candidate),
    "時間どおり 14:00–15:00（終了時刻は仮に1時間後）",
  );
});
