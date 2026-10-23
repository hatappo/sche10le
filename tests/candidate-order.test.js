import assert from "node:assert/strict";
import test from "node:test";
import { orderCandidates } from "../lib/candidate-order.js";
import {
  extractTextEvents,
  extractStructuredEvents,
  mergeCandidates,
  identify,
} from "../lib/extract.js";
import { sourceLocator } from "../lib/source-locator.js";

const now = new Date(2026, 9, 24, 12);

test("構造化データを優先した統合後も本文の登場順に戻し、位置不明は末尾に置く", () => {
  const text = "2026/12/8 18:00\n2026/11/8 10:00";
  const body = extractTextEvents(text, now);
  const structured = extractStructuredEvents([
    JSON.stringify([
      { "@type": "Event", startDate: body[1].start, endDate: body[1].end },
      { "@type": "Event", startDate: "2026-10-01" },
    ]),
  ]);
  const merged = mergeCandidates(structured, body);
  const before = [...merged];
  const ordered = orderCandidates(merged, "page", text);
  assert.deepEqual(
    ordered.map(({ date }) => date),
    ["2026-12-08", "2026-11-08", "2026-10-01"],
  );
  assert.equal(ordered[1].source, "structured");
  assert.deepEqual(merged, before);
  assert.deepEqual(
    orderCandidates(merged, "date", text).map(({ date }) => date),
    ["2026-10-01", "2026-11-08", "2026-12-08"],
  );
});

test("同日の時刻は実時刻順、終日は先頭、同時刻は登場順で安定する", () => {
  const make = (start, end, evidence) =>
    identify({ date: "2026-11-08", start, end, evidence, source: "ai" });
  const events = [
    make("2026-11-08T16:00:00+09:00", "2026-11-08T17:00:00+09:00", "later"),
    make("2026-11-08T01:00:00Z", "2026-11-08T02:00:00Z", "first ten"),
    make(undefined, undefined, "all day"),
    make(
      "2026-11-08T10:00:00+09:00",
      "2026-11-08T12:00:00+09:00",
      "second ten",
    ),
  ];
  assert.deepEqual(
    orderCandidates(events, "date", "").map(({ evidence }) => evidence),
    ["all day", "first ten", "second ten", "later"],
  );
  assert.deepEqual(orderCandidates(events, "page", ""), events);
  assert.deepEqual(orderCandidates([], "date", ""), []);
});

test("AIの引用は全角・空白と同じ引用の出現回数を考慮して登場順に並べる", () => {
  const text = "告知\nＡ の予定\nＢ の予定\nＡ の予定";
  const make = (evidence, start) =>
    identify({
      date: "2026-11-08",
      source: "ai",
      evidence,
      locator: sourceLocator(text, start, start + evidence.length),
    });
  const first = make("Ａ の予定", text.indexOf("Ａ"));
  const second = make("Ｂ の予定", text.indexOf("Ｂ"));
  const last = make("Ａ の予定", text.lastIndexOf("Ａ"));
  assert.deepEqual(orderCandidates([last, second, first], "page", text), [
    first,
    second,
    last,
  ]);
});
