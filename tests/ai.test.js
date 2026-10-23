import assert from "node:assert/strict";
import test from "node:test";
import { aiAvailability, enhanceDates } from "../lib/ai.js";
import { aiCandidates } from "../lib/extract.js";

test("AIの非対応・例外時にも通常抽出を使える", async () => {
  assert.equal(await aiAvailability(undefined), "unavailable");
  assert.equal(
    await aiAvailability({
      availability() {
        throw new Error("unsupported");
      },
    }),
    "unavailable",
  );
  assert.equal(
    await aiAvailability({ availability: async () => "downloadable" }),
    "downloadable",
  );
});

test("AIの出力は日付・根拠の引用・終了順序を検証する", () => {
  const page = "明日の14時から16時に開催";
  const valid = {
    start: "2026-11-08T14:00:00+09:00",
    end: "2026-11-08T16:00:00+09:00",
    evidence: "明日の14時から16時",
  };
  assert.equal(aiCandidates([valid], page).length, 1);
  assert.deepEqual(
    aiCandidates([{ ...valid, evidence: "書かれていない予定" }], page),
    [],
  );
  assert.deepEqual(aiCandidates([{ ...valid, start: "2026-02-30" }], page), []);
  assert.deepEqual(aiCandidates([{ ...valid, end: "2026-11-07" }], page), []);
  assert.deepEqual(aiCandidates([{ ...valid, end: "bad-date" }], page), []);
  assert.deepEqual(
    aiCandidates([{ ...valid, end: "2026-11-08T12:00:00+09:00" }], page),
    [],
  );
  assert.deepEqual(aiCandidates("not an array", page), []);
});

test("AIが失敗してもモデルセッションを破棄する", async () => {
  let destroyed = false;
  const api = {
    create: async () => ({
      prompt: async () => "invalid json",
      destroy: () => {
        destroyed = true;
      },
    }),
  };
  await assert.rejects(enhanceDates(api, "明日", new AbortController().signal));
  assert.equal(destroyed, true);
});

test("AIの正常出力を取り込み、指定した中断signalを渡す", async () => {
  const controller = new AbortController();
  let destroyed = false;
  const api = {
    create: async (options) => {
      assert.equal(options.signal, controller.signal);
      return {
        prompt: async (_prompt, options) => {
          assert.equal(options.signal, controller.signal);
          return '```json\n[{"start":"2026-11-08","evidence":"明日"}]\n```';
        },
        destroy: () => {
          destroyed = true;
        },
      };
    },
  };
  const events = await enhanceDates(api, "明日、開催します", controller.signal);
  assert.equal(events[0].source, "ai");
  assert.equal(destroyed, true);
});
