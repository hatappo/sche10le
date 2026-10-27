import assert from "node:assert/strict";

export const categories = {
  PASS: "期待した開催日時を抽出",
  DATE_MISMATCH: "抽出日時の不一致（ページ内容と期待値も要確認）",
  ACCESS_BLOCKED: "アクセス制限・認証画面",
  RATE_LIMITED: "アクセス頻度の制限",
  PAGE_MISSING: "ページ消失",
  HTTP_ERROR: "サイトのHTTPエラー",
  NETWORK_ERROR: "接続・読み込み失敗",
  TARGET_CHANGED: "別ページへの移動・対象イベントを確認できない",
  PAGE_NOT_READY: "本文の読み込みが完了しない",
  HARNESS_ERROR: "検証環境・拡張の実行エラー",
  TEST_TIMEOUT: "検証全体の時間切れ（最後の段階を要確認）",
  NOT_RUN: "未実行・中断",
};

export function validateSites(sites, { allowLocalhost = false } = {}) {
  assert.ok(
    Array.isArray(sites) && sites.length,
    "サイトを1件以上指定してください",
  );
  const ids = new Set();
  for (const site of sites) {
    assert.match(site.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(site.id), `サイトIDが重複しています: ${site.id}`);
    ids.add(site.id);
    const url = new URL(site.url);
    assert.ok(
      url.protocol === "https:" ||
        (allowLocalhost &&
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1"),
      "公開ページはHTTPSで指定してください",
    );
    assert.ok(
      !url.username && !url.password && !url.hash,
      "認証情報やフラグメントをURLに含めないでください",
    );
    assert.ok(
      site.name?.trim() && site.identity?.trim(),
      "サイト名と対象イベントの識別文が必要です",
    );
    for (const value of [site.expected?.start, site.expected?.end]) {
      assert.match(
        value,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/,
      );
      assert.ok(
        Number.isFinite(Date.parse(value)),
        "日時には有効な時差付きISO日時を指定してください",
      );
      assert.equal(
        new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10),
        value.slice(0, 10),
      );
    }
    assert.ok(
      Date.parse(site.expected.end) > Date.parse(site.expected.start),
      "終了は開始より後にしてください",
    );
  }
  return sites;
}

export function selectSites(sites, selection = "all") {
  validateSites(sites);
  if (selection === "all") return sites;
  const ids = selection.split(",").map((id) => id.trim());
  assert.ok(
    ids.length && ids.every((id) => sites.some((site) => site.id === id)),
    "LIVE_SITESにはallか登録済みのIDをカンマ区切りで指定してください",
  );
  return sites.filter((site) => ids.includes(site.id));
}

// Only classify actual challenge/login screens, not ordinary event text about security.
export function accessCategory(status, title = "", lead = "", url = "") {
  if (status === 429) return "RATE_LIMITED";
  if ([401, 403].includes(status)) return "ACCESS_BLOCKED";
  if ([404, 410].includes(status)) return "PAGE_MISSING";
  if (status >= 400) return "HTTP_ERROR";
  if (
    /access denied|just a moment|security verification|^ログイン|^sign in|^log in/i.test(
      title,
    ) ||
    /verify (?:that )?you(?:'re| are) (?:a )?human|verify that you're not a robot|checking your browser|ロボットではないことを確認/i.test(
      lead,
    ) ||
    /\/(?:login|signin|sign_in|auth)(?:[/?#]|$)/i.test(url)
  )
    return "ACCESS_BLOCKED";
  return null;
}

// Read the UI's candidate identity, rather than importing production extraction code
// to generate the expected answer (which would allow the same bug on both sides).
export function candidateFromId(id) {
  const [date, endDate, start, end] = id.split("/");
  return { date, endDate, start: start || null, end: end || null };
}

export function matchesExpected(candidates, expected) {
  const start = new Date(expected.start).toISOString();
  const end = new Date(expected.end).toISOString();
  return candidates.some(
    (candidate) => candidate.start === start && candidate.end === end,
  );
}

export function reportOutcome(reports, runnerStatus) {
  if (runnerStatus !== "passed") return runnerStatus;
  return reports.length && reports.every((report) => report.status === "passed")
    ? "passed"
    : "failed";
}

export function summaryMarkdown(reports, outcome) {
  const cell = (value) => String(value ?? "—").replace(/[\r\n|`<>]/g, " ");
  return [
    `# ライブサイト検証: ${outcome}`,
    "",
    "HTML・DOM・ページ本文は保存していません。合格は対象イベントの開始・終了日時の一致を意味し、全候補の正確性を保証するものではありません。",
    "",
    "| サイト | 判定 | 段階 | 所要時間 | HTTP | 期待日時 | 候補数 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...reports.map(
      (r) =>
        `| ${cell(r.name)} | ${cell(r.category)}: ${cell(categories[r.category])} | ${cell(r.phase)} | ${Number.isFinite(r.durationMs) ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"} | ${cell(r.httpStatus)} | ${cell(r.expected.start)} ～ ${cell(r.expected.end)} | ${r.candidates?.length ?? 0} |`,
    ),
    "",
    ...reports.map((r) => `- ${cell(r.name)}: ${cell(r.url)}`),
    "",
    "DATE_MISMATCHはページを手動確認し、抽出の退行と開催日時変更を切り分けてください。アクセス不能・未実行は合格に含めません。",
    "",
  ].join("\n");
}
