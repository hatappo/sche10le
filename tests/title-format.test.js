import assert from "node:assert/strict";
import test from "node:test";
import { formatTitle, validateTitleFormat } from "../lib/title-format.js";
import { createDraft, pickField } from "../lib/draft.js";
import { calendarUrl, createVariants } from "../lib/calendar.js";
import { extractTextEvents } from "../lib/extract.js";

const event = extractTextEvents("2026/11/8 17:30〜19:00")[0];
const [exact, travel, allDay] = createVariants(event);

test("初期値はそのままのタイトル、日時書式は24時間表記", () => {
  assert.equal(formatTitle("{title}", "勉強会", exact), "勉強会");
  assert.equal(
    formatTitle("{from:HHmm} {title} あいうえお", "勉強会", exact),
    "1730 勉強会 あいうえお",
  );
  assert.equal(
    formatTitle("{from:hhmm} {title}", "勉強会", exact),
    "1730 勉強会",
  );
  assert.equal(
    formatTitle(
      "{date:YYYY-MM-DD} {from:HH:mm}–{to:HH:mm} {title}",
      "勉強会",
      exact,
    ),
    "2026-11-08 17:30–19:00 勉強会",
  );
});

test("開始・終了は移動前の開催時刻を使い、終日では時刻を空にする", () => {
  assert.equal(
    formatTitle("{from:HHmm} {title} {to:HHmm}", "勉強会", travel),
    "1730 勉強会 1900",
  );
  assert.equal(
    formatTitle("{from:HHmm} {title} {to:HHmm}", "展示", allDay),
    "展示",
  );
  assert.equal(
    formatTitle("{date:MM/DD} {title}", "展示", allDay),
    "11/08 展示",
  );
  const overnight = createVariants(
    extractTextEvents("2026/11/8 00:15〜01:00")[0],
  )[1];
  assert.equal(
    formatTitle("{date} {from}–{to} {title}", "夜", overnight),
    "2026-11-07 00:15–01:00 夜",
  );
});

test("移動時間を変えても書式の開催時刻は変わらず、確保する時間帯だけ広がる", () => {
  for (const minutes of [5, 30, 180]) {
    const variant = createVariants(event, minutes)[1];
    let draft = createDraft("ページ", "https://example.com");
    draft = pickField(draft, "選んだタイトル");
    const url = new URL(calendarUrl(variant, draft, "{from} {title} {to}"));
    assert.equal(url.searchParams.get("text"), "17:30 選んだタイトル 19:00");
    const utc = (value) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    assert.equal(
      url.searchParams.get("dates"),
      `${utc(Date.parse(event.start) - minutes * 60_000)}/${utc(Date.parse(event.end) + minutes * 60_000)}`,
    );
    assert.ok(url.searchParams.get("details").includes("17:30–19:00"));
  }
});

test("タイトルを選び直しても装飾を重複させず、カレンダーに同じ表示を渡す", () => {
  const template = "{from:HHmm} {title} メモ";
  let draft = createDraft("ページ", "https://example.com");
  draft = pickField(draft, "新しいタイトル");
  assert.equal(draft.title, "新しいタイトル");
  assert.equal(
    formatTitle(template, draft.title, exact),
    "1730 新しいタイトル メモ",
  );
  draft = pickField({ ...draft, step: 0 }, "選び直したタイトル");
  const url = new URL(calendarUrl(exact, draft, template));
  assert.equal(url.searchParams.get("text"), "1730 選び直したタイトル メモ");
  assert.equal(
    formatTitle("{title}", "{from:HHmm} & <b>文字</b>", exact),
    "{from:HHmm} & <b>文字</b>",
  );
});

test("未対応の変数・壊れた括弧・長すぎる書式を保存させない", () => {
  for (const value of [
    "",
    "{unknown}",
    "{from:YYYY}",
    "{{title}}",
    "{title",
    "title}",
    "x".repeat(201),
    "{title}\n次の行",
  ]) {
    assert.ok(validateTitleFormat(value), value);
  }
  assert.equal(validateTitleFormat("{from} {title} / {to} [{date}]"), null);
  assert.equal(validateTitleFormat("固定タイトル"), null);
  assert.throws(() => formatTitle("{unknown}", "タイトル", exact));
});
