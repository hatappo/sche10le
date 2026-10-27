import assert from "node:assert/strict";
import { validateSites } from "./contract.js";

const DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET = 9 * 60 * 60 * 1000;
const dateInJapan = (time) => new Date(time + JST_OFFSET).toISOString().slice(0, 10);

function calendarDay(value) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}$/, "確認日はYYYY-MM-DDで指定してください");
  const time = Date.parse(`${value}T00:00:00Z`);
  assert.ok(Number.isFinite(time), "確認日が不正です");
  assert.equal(new Date(time).toISOString().slice(0, 10), value, "確認日が存在しません");
  return time;
}

// Calendar-day thresholds in Asia/Tokyo; this never fetches or replaces a page.
export function reviewSamples(sites, { now = new Date() } = {}) {
  validateSites(sites);
  const asOf = dateInJapan(now.getTime());
  const today = calendarDay(asOf);
  return sites.map((site) => {
    const reviewed = calendarDay(site.reviewedOn);
    assert.ok(reviewed <= today, `${site.id}: 確認日は未来にできません`);
    const endedOn = dateInJapan(Date.parse(site.expected.end));
    const endDeadline = calendarDay(endedOn) + 30 * DAY;
    const reviewDeadline = reviewed + 90 * DAY;
    const reasons = [];
    if (today >= endDeadline) reasons.push("開催終了から30日経過");
    if (today >= reviewDeadline) reasons.push("最終確認から90日経過");
    return {
      id: site.id,
      name: site.name,
      reviewedOn: site.reviewedOn,
      endedOn,
      asOf,
      reviewBy: new Date(Math.min(endDeadline, reviewDeadline)).toISOString().slice(0, 10),
      due: reasons.length > 0,
      reasons,
    };
  });
}

export function reviewMarkdown(reviews) {
  const cell = (value) => String(value).replace(/[\r\n|`<>]/g, " ");
  return [
    "## ライブ検証サンプルの見直し",
    "",
    `基準日: ${reviews[0]?.asOf ?? "—"}（日本時間）。見直し対象: ${reviews.filter((r) => r.due).length} / ${reviews.length}`,
    "",
    "| サイト | 最終確認 | 開催終了（日本時間） | 見直し目安 | 状態 |",
    "| --- | --- | --- | --- | --- |",
    ...reviews.map((r) =>
      `| ${cell(r.name)} (${cell(r.id)}) | ${r.reviewedOn} | ${r.endedOn} | ${r.reviewBy} | ${r.due ? `見直し: ${r.reasons.join("・")}` : "期限内"} |`,
    ),
    "",
    "外部アクセスなし。見直し時期は検証の合否と別に扱い、対象を自動更新・除外しません。",
    "更新方法: tests/live/README.md の「サンプルを見直す」を参照してください。",
    "",
  ].join("\n");
}
