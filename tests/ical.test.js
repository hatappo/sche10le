import assert from "node:assert/strict";
import test from "node:test";
import { calendarFile } from "../lib/ical.js";
import { createVariants } from "../lib/calendar.js";
import { extractTextEvents } from "../lib/extract.js";
import { createDraft } from "../lib/draft.js";

const unfold = (value) => value.replace(/\r\n[ \t]/g, "");
const utc = (date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");

test("ICSは移動込みの日時と開催時刻のタイトル書式、場所、詳細、URLを保持する", () => {
  const variant = createVariants(
    extractTextEvents("2026/11/8 14:00〜16:00")[0],
    45,
  )[1];
  const draft = {
    ...createDraft("勉強会", "https://example.com/event"),
    location: "東京",
    details: "持ち物：筆記具",
  };
  const ics = unfold(
    calendarFile(variant, draft, "{from:HHmm} {title} {to:HHmm}"),
  );
  assert.ok(ics.includes(`DTSTART:${utc(new Date(2026, 10, 8, 13, 15))}\r\n`));
  assert.ok(ics.includes(`DTEND:${utc(new Date(2026, 10, 8, 16, 45))}\r\n`));
  assert.ok(ics.includes("SUMMARY:1400 勉強会 1600\r\n"));
  assert.ok(ics.includes("LOCATION:東京\r\n"));
  assert.ok(ics.includes("DESCRIPTION:持ち物：筆記具\\n\\n開催日時:"));
  assert.ok(ics.includes("14:00–16:00\\n\\nhttps://example.com/event\r\n"));
});

test("ICSの終日・年またぎの終了日は翌日で、時刻やタイムゾーンを付けない", () => {
  const variant = createVariants(
    extractTextEvents("2026/12/31〜2027/1/2")[0],
  )[0];
  const ics = unfold(
    calendarFile(
      variant,
      createDraft("休暇", "https://example.com"),
      "{from:HHmm}{title}{to:HHmm}",
    ),
  );
  assert.ok(
    ics.includes(
      "DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270103\r\n",
    ),
  );
  assert.ok(ics.includes("SUMMARY:休暇\r\n"));
  assert.ok(!ics.includes("TZID"));
});

test("ICSの日本語・絵文字・長文はUTF-8の75バイト以内で折り返し、特殊文字と改行を保つ", () => {
  const title = "予定🎉日本語".repeat(30) + ",;\\:末尾";
  const draft = {
    ...createDraft(title, "https://example.com"),
    location: "A,B;C\\D",
    details:
      "一行目\r\n二行目\r三行目\nEND:VEVENT\nBEGIN:VALARM\nACTION:DISPLAY\n\x00\x01\x7f",
  };
  const ics = calendarFile(
    createVariants(extractTextEvents("2026/11/8")[0])[0],
    draft,
  );
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
  assert.ok(ics.includes("\r\n "));
  const text = unfold(ics);
  assert.ok(text.includes(`SUMMARY:${title.replace(/[\\,;]/g, "\\$&")}\r\n`));
  assert.ok(text.includes("LOCATION:A\\,B\\;C\\\\D\r\n"));
  assert.ok(
    text.includes(
      "一行目\\n二行目\\n三行目\\nEND:VEVENT\\nBEGIN:VALARM\\nACTION:DISPLAY\\n",
    ),
  );
  assert.equal(
    text.split("\r\n").filter((line) => line === "END:VEVENT").length,
    1,
  );
  assert.equal(
    text.split("\r\n").filter((line) => line === "BEGIN:VALARM").length,
    0,
  );
  assert.ok(
    !text.includes("\x00") && !text.includes("\x01") && !text.includes("\x7f"),
  );
  assert.ok(!text.includes("�"));
});

test("ICSは1予定の標準コンテナ・生成日時・一意のUIDを持ち、招待メールにはしない", () => {
  const variant = createVariants(extractTextEvents("2026/11/8 14:00")[0])[0];
  const draft = createDraft("予定", "https://example.com");
  const first = calendarFile(variant, draft);
  const second = calendarFile(variant, draft);
  assert.ok(first.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:"));
  assert.ok(first.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.match(first, /\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
  assert.match(first, /\r\nUID:[a-f0-9-]{36}@sche10le\r\n/);
  assert.notEqual(first.match(/UID:.+/)[0], second.match(/UID:.+/)[0]);
  assert.ok(!first.includes("METHOD:") && !first.includes("ATTENDEE:"));
});
