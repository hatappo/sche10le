import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreferences, PREFERENCE_KEYS } from "../lib/preferences.js";

test("0.5の設定キーと値を維持し、旧AI設定は利用しない", () => {
  const saved = { themeId: "shikon", travelMinutes: 5, titleFormat: "{from:HHmm} {title}", candidateOrder: "date", aiEnabled: true };
  const result = normalizePreferences(saved);
  assert.deepEqual(Object.keys(result), PREFERENCE_KEYS);
  for (const key of PREFERENCE_KEYS) assert.equal(result[key], saved[key]);
  assert.equal(result.aiEnabled, undefined);
});
test("不正な設定だけ標準値へ戻す", () => {
  assert.deepEqual(normalizePreferences({ themeId: "unknown", travelMinutes: -1, titleFormat: "{bad}", candidateOrder: "bad" }), {
    themeId: "chitosemidori", travelMinutes: 30, titleFormat: "{title}", candidateOrder: "page",
  });
  assert.equal(normalizePreferences({ travelMinutes: 0 }).travelMinutes, 0);
  assert.equal(normalizePreferences({ travelMinutes: 180 }).travelMinutes, 180);
});
