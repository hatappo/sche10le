import assert from "node:assert/strict";
import test from "node:test";
import { extractTextEvents } from "../lib/extract.js";

const now = new Date(2030, 0, 15, 12);
const extract = (text) => extractTextEvents(text, now);

test("令和の数字年・元年を換算し、境界と実在日を検証する", () => {
  for (const text of [
    "令和8年11月8日",
    "令和８年１１月８日",
    "令和 8 年 11 月 8 日",
  ])
    assert.equal(extract(text)[0].date, "2026-11-08", text);
  assert.equal(extract("令和元年5月1日")[0].date, "2019-05-01");
  assert.equal(extract("令和1年5月1日")[0].inferredYear, false);
  assert.equal(extract("令和6年2月29日")[0].date, "2024-02-29");
  for (const text of [
    "令和0年11月8日",
    "令和元年4月30日",
    "令和8年2月29日",
    "令和999年11月8日",
  ])
    assert.deepEqual(extract(text), [], text);
});

test("英語月名・省略形・日月の順序・序数・年省略に対応する", () => {
  for (const text of [
    "November 8, 2026",
    "Nov 8 2026",
    "Nov. 8th, 2026",
    "8 November 2026",
    "8 Nov. 2026",
    "8th NOV 2026",
  ])
    assert.equal(extract(text)[0].date, "2026-11-08", text);
  const months = [
    "January",
    "Feb",
    "March",
    "Apr.",
    "May",
    "June",
    "Jul",
    "August",
    "Sept.",
    "October",
    "Nov",
    "December",
  ];
  months.forEach((month, index) =>
    assert.equal(
      extract(`${month} 8, 2026`)[0].date,
      `2026-${String(index + 1).padStart(2, "0")}-08`,
    ),
  );
  assert.equal(extract("Nov 8 2 PM")[0].date, "2030-11-08");
  assert.equal(extract("Nov 8 2 PM")[0].inferredYear, true);
  for (const text of [
    "February 30, 2026",
    "Nov 32, 2026",
    "abcNovember 8, 2026",
    "November 8thly, 2026",
    "Nov 8, 20266",
    "Nov 8, 26",
  ])
    assert.deepEqual(extract(text), [], text);
});

test("明示されたAM/PMを24時間に換算し、正午・深夜・日またぎを扱う", () => {
  for (const text of [
    "Nov 8, 2026 2 PM–4 PM",
    "8 Nov 2026 2:30 p.m. to 4:30 p.m.",
    "令和8年11月8日 2:30PM-4:30PM",
  ]) {
    const [event] = extract(text);
    assert.equal(new Date(event.start).getHours(), 14, text);
    assert.equal(new Date(event.end).getHours(), 16, text);
  }
  assert.equal(
    new Date(extract("Nov 8, 2026 12 AM–12 PM")[0].start).getHours(),
    0,
  );
  assert.equal(
    new Date(extract("Nov 8, 2026 12 AM–12 PM")[0].end).getHours(),
    12,
  );
  assert.equal(new Date(extract("Nov 8, 2026 11 PM–1 AM")[0].end).getDate(), 9);
  assert.equal(extract("Nov 8, 2026 2 PM")[0].assumedEnd, true);
  assert.equal(extract("Nov 8, 2026.")[0].date, "2026-11-08");
  for (const text of [
    "Nov 8, 2026 0 PM–2 PM",
    "Nov 8, 2026 13 PM–14 PM",
    "Nov 8, 2026 2:00–4:00 PM",
    "Nov 8, 2026 2–4 PM",
    "Nov 8, 2026 2 PM–4",
  ])
    assert.deepEqual(extract(text), [], text);
});

test("既存の区切り前後の空白を維持し、人数の範囲を時刻にしない", () => {
  assert.equal(extract("2026 / 11 / 8 受付2-4名")[0].date, "2026-11-08");
  assert.equal(extract("2026 / 11 / 8 受付2-4名")[0].start, undefined);
});

test("年省略の英語月日は次の日付から年を借りない", () => {
  for (const text of [
    "Nov 8\n2026年12月1日",
    "Nov 8 2026 年 12 月 1 日",
    "8 November\n2026/12/1",
  ]) {
    const events = extract(text);
    assert.equal(events.length, 1, text);
    assert.equal(events[0].date, "2026-12-01", text);
    assert.equal(events[0].inferredYear, false, text);
  }
});

test("未対応表記の一部分を別の年の日付として拾わない", () => {
  for (const text of [
    "平成30年11月8日",
    "昭和64年1月7日",
    "令和八年11月8日",
    "二〇二六年11月8日",
    "2026年十一月八日",
    "R8.11.8",
    "11/08/2026",
    "08/11/2026",
    "11/08/26",
  ])
    assert.deepEqual(extract(text), [], text);
  assert.equal(extract("平成30年11月8日\n2026/11/9")[0].date, "2026-11-09");
});

test("新書式の範囲・混在・元の出典を保つ", () => {
  const [range] = extract("令和8年12月31日〜1月2日");
  assert.equal(range.endDate, "2027-01-02");
  const [english] = extract("Dec 31, 2026 to Jan 2");
  assert.equal(english.date, "2026-12-31");
  assert.equal(english.endDate, "2027-01-02");
  assert.equal(extract("2028/2/28〜2/29")[0].endDate, "2028-02-29");
  assert.deepEqual(extract("Feb 29"), []);
  const events = extract(
    "令和８年１１月８日 14:00〜16:00\nNovember 9, 2026 2 PM–4 PM\n2026/11/10",
  );
  assert.equal(events.length, 3);
  assert.equal(events[0].locator.text, "令和8年11月8日14:00〜16:00");
  assert.equal(events[1].locator.text, "November9,20262PM–4PM");
});
