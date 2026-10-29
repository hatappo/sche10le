import { test } from "node:test";
import assert from "node:assert/strict";
import { isCalendarHandoff } from "../lib/safari-policy.js";
import { calendarUrl } from "../lib/calendar.js";
import { createDraft } from "../lib/draft.js";

test("Safariのカレンダー受け渡しは生成済みURLだけを許可する", () => {
  const draft = createDraft("予定", "https://example.com/");
  const url = calendarUrl({ kind: "all-day", label: "終日", date: "2026-11-08", endDate: "2026-11-08" }, draft);
  assert.equal(isCalendarHandoff(url), true);
  for (const invalid of [undefined, {}, "javascript:alert(1)", "https://example.com/calendar/render?action=TEMPLATE",
    "https://calendar.google.com.evil.example/calendar/render?action=TEMPLATE",
    "http://calendar.google.com/calendar/render?action=TEMPLATE",
    "https://user@calendar.google.com/calendar/render?action=TEMPLATE",
    "https://calendar.google.com/calendar/render?action=DELETE",
    "https://calendar.google.com/other?action=TEMPLATE", url + "x".repeat(120_000)]) {
    assert.equal(isCalendarHandoff(invalid), false, String(invalid).slice(0, 100));
  }
});
