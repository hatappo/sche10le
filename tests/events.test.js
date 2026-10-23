import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTextEvents,
  extractStructuredEvents,
  mergeCandidates,
} from "../lib/extract.js";
import {
  calendarUrl,
  createVariants,
  candidateOptions,
  composeDetails,
} from "../lib/calendar.js";
import {
  createDraft,
  pickField,
  skipField,
  previousField,
} from "../lib/draft.js";

const now = new Date(2026, 9, 24, 12);
const extract = (text) => extractTextEvents(text, now);

test("同じ日付範囲の終日は1つにまとめ、別時刻・別範囲は残す", () => {
  const events = extract(
    "11/8 10:00〜12:00\n11/8 14:00〜16:00\n11/8\n11/8〜11/9\n11/9 10:00〜12:00",
  );
  const options = candidateOptions(events, 30);
  assert.equal(options.length, 4);
  assert.deepEqual(
    options.map(({ variants }) => variants.map(({ kind }) => kind)),
    [
      ["exact", "travel", "all-day"],
      ["exact", "travel"],
      ["all-day"],
      ["exact", "travel", "all-day"],
    ],
  );
  assert.equal(candidateOptions(events, 0)[1].variants.length, 1);
  const overnight = candidateOptions(
    extract("11/8 22:00〜00:00\n11/8 23:00〜01:00\n11/8〜11/9"),
  );
  assert.equal(overnight.length, 2);
  assert.deepEqual(
    overnight.map(({ variants }) => variants.at(-1).endDate),
    ["2026-11-08", "2026-11-09"],
  );
  // A date-only entry can also own the shared all-day option when it comes first.
  const dateFirst = candidateOptions([events[2], events[0], events[1]]);
  assert.deepEqual(
    dateFirst.map(({ variants }) => variants.length),
    [1, 2, 2],
  );
  // Appending AI candidates does not move options away from existing cards.
  assert.deepEqual(candidateOptions(events.slice(0, 1))[0], options[0]);
});

test("候補の出典は日時の範囲を指し、構造化データとの統合でも残る", () => {
  const [event] = extract(
    "説明\n２０２６年１１月８日（日）１４：００〜１６：００\n会場はこちら",
  );
  assert.deepEqual(event.locator, {
    text: "2026年11月8日(日)14:00〜16:00",
    occurrence: 0,
  });
  const structured = extractStructuredEvents([
    JSON.stringify({
      "@type": "Event",
      startDate: "2026-11-08T14:00:00+09:00",
      endDate: "2026-11-08T16:00:00+09:00",
    }),
  ]);
  assert.deepEqual(
    mergeCandidates(structured, [event])[0].locator,
    event.locator,
  );
  assert.equal(
    extract("2026/11/21〜11/23")[0].locator.text,
    "2026/11/21〜11/23",
  );
});

test("日本語・スラッシュ・ISOの日付と時間帯を抽出する", () => {
  for (const text of [
    "2026年11月8日（日）14:00〜16:00",
    "2026/11/8 14:00–16:00",
    "2026-11-08 14時〜16時",
  ]) {
    const [event] = extract(text);
    assert.equal(event.date, "2026-11-08");
    assert.equal(new Date(event.start).getHours(), 14);
    assert.equal(new Date(event.end).getHours(), 16);
  }
});

test("複数の日付や同日の別の時間帯を混ぜない", () => {
  const events = extract(
    "11月8日 10:00〜12:00 / 14:00〜16:00\n11月9日 18:00〜20:00",
  );
  assert.equal(events.length, 3);
  assert.equal(events[2].date, "2026-11-09");
  assert.equal(events[0].inferredYear, true);
});

test("不正な日付・時刻・数値の一部を予定にしない", () => {
  for (const text of [
    "2026/2/30",
    "2026/13/1",
    "2026/11/8 25:00〜26:00",
    "2026/11/8 14:99〜16:00",
    "1232026/11/8",
  ]) {
    assert.deepEqual(extract(text), [], text);
  }
  assert.equal(extract("2028/2/29").length, 1);
});

test("年省略は走査時の年、単独時刻は仮の1時間、日付またぎは翌日", () => {
  assert.equal(extract("1月8日")[0].date, "2026-01-08");
  const [single] = extract("11/8 15時");
  assert.equal(single.assumedEnd, true);
  assert.equal(new Date(single.end) - new Date(single.start), 3_600_000);
  const [overnight] = extract("11/8 23:00〜01:00");
  assert.equal(new Date(overnight.end).getDate(), 9);
});

test("日付の範囲と年またぎを終日候補として扱う", () => {
  const [range] = extract("2026年11月8日〜11月10日");
  assert.equal(range.date, "2026-11-08");
  assert.equal(range.endDate, "2026-11-10");
  assert.equal(extract("2026/12/31〜1/2")[0].endDate, "2027-01-02");
});

test("JSON-LDの配列・@graph・複数type・壊れたJSONを処理する", () => {
  const events = extractStructuredEvents([
    "{broken",
    JSON.stringify({
      "@graph": [
        {
          "@type": ["Thing", "Event"],
          startDate: "2026-11-08T14:00:00+09:00",
          endDate: "2026-11-08T16:00:00+09:00",
        },
      ],
    }),
    JSON.stringify([
      { "@type": "Event", startDate: "2026-11-10", endDate: "2026-11-12" },
    ]),
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].start, "2026-11-08T05:00:00.000Z");
  assert.equal(events[1].endDate, "2026-11-12");
  assert.deepEqual(
    extractStructuredEvents([
      JSON.stringify({ "@type": "Event", startDate: "2026-02-30" }),
    ]),
    [],
  );
});

test("同一の日時候補は構造化データを優先してまとめる", () => {
  const event = extract("11/8 14:00〜16:00")[0];
  const structured = { ...event, source: "structured" };
  assert.deepEqual(mergeCandidates([structured], [event, event]), [structured]);
});

test("移動時間は前後に加算し、時刻なしでは終日だけを出す", () => {
  const [event] = extract("11/8 14:00〜16:00");
  const variants = createVariants(event, 30);
  assert.deepEqual(
    variants.map((v) => v.kind),
    ["exact", "travel", "all-day"],
  );
  assert.equal(new Date(variants[1].start).getHours(), 13);
  assert.equal(new Date(variants[1].start).getMinutes(), 30);
  assert.equal(
    createVariants(event, 45)[1].end,
    new Date(new Date(event.end).getTime() + 45 * 60_000).toISOString(),
  );
  assert.equal(createVariants(extract("11/8")[0]).length, 1);
  assert.throws(() => createVariants(event, -1));
});

test("タイトル・場所・詳細の取得とスキップ、戻る操作", () => {
  let draft = createDraft("ページタイトル", "https://example.com/event");
  assert.equal(draft.title, "ページタイトル");
  assert.equal(draft.location, "");
  assert.equal(draft.step, 0);
  draft = pickField(draft, "イベント名");
  draft = skipField(draft);
  draft = pickField(draft, "入場無料");
  assert.equal(draft.step, 3);
  assert.equal(draft.title, "イベント名");
  assert.equal(composeDetails(draft), "入場無料\n\nhttps://example.com/event");
  draft = previousField(draft);
  draft = pickField(draft, "予約必須");
  assert.equal(composeDetails(draft), "予約必須\n\nhttps://example.com/event");
});

test("URLは詳細の末尾に1回だけ残り、未選択でも引き継ぐ", () => {
  const draft = createDraft("A & B", "https://example.com/event?a=1&b=2");
  assert.equal(composeDetails(draft), draft.url);
  assert.equal(
    composeDetails({ ...draft, details: `説明\n${draft.url}` }),
    `説明\n\n${draft.url}`,
  );
  const url = new URL(
    calendarUrl(createVariants(extract("11/8")[0])[0], draft),
  );
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("text"), "A & B");
  assert.equal(url.searchParams.get("dates"), "20261108/20261109");
  assert.equal(url.searchParams.get("details"), draft.url);
});

test("終日の終了日は排他的、時間付きはUTC、移動込みは開催時間を保持", () => {
  const draft = createDraft("テスト", "https://example.com");
  const range = new URL(
    calendarUrl(createVariants(extract("11/8〜11/10")[0])[0], draft),
  );
  assert.equal(range.searchParams.get("dates"), "20261108/20261111");
  const variant = createVariants(extract("11/8 14:00〜16:00")[0])[1];
  const url = new URL(calendarUrl(variant, draft));
  assert.match(url.searchParams.get("dates"), /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  assert.match(url.searchParams.get("details"), /開催日時:/);
  assert.ok(url.searchParams.get("details").endsWith(draft.url));
});
