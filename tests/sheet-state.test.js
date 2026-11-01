import test from "node:test";
import assert from "node:assert/strict";
import { createSheetState, transitionSheet } from "../lib/sheet-state.js";

const variant = { kind: "exact", label: "時間どおり", date: "2026-11-08", endDate: "2026-11-08", start: "2026-11-08T14:00:00", end: "2026-11-08T16:00:00" };
const choose = { type: "choose", variant, title: "ページタイトル", url: "https://example.com/event" };
const act = (state, type, values = {}) => transitionSheet(state, { type, ...values });
const selected = () => transitionSheet(createSheetState(), choose);

function freeze(state) {
  if (state.draft) Object.freeze(state.draft);
  Object.freeze(state.complete);
  return Object.freeze(state);
}

test("3項目を取得すると自動で確認へ進み、元の状態を変更しない", () => {
  let state = selected();
  assert.equal(state.draft.title, "ページタイトル");
  assert.deepEqual(state.complete, [false, false, false]);
  for (const [step, value] of ["選択タイトル", "選択場所", "選択詳細"].entries()) {
    const previous = freeze(state);
    state = act(state, "accept", { value });
    assert.equal(state.draft.step, step + 1);
    assert.equal(state.mode, step === 2 ? "review" : "pick");
    assert.equal(previous.complete[step], false);
  }
  assert.deepEqual(state.draft, { title: "選択タイトル", location: "選択場所", details: "選択詳細", url: choose.url, step: 3 });
  assert.deepEqual(state.complete, [true, true, true]);
});

for (const origin of ["list", "pick", "review"]) {
  test(`${origin}から設定を開いて閉じても、戻る先・取得内容・チェックを保つ`, () => {
    let before = origin === "list" ? createSheetState() : act(selected(), "accept", { value: "選択タイトル" });
    if (origin === "review") before = act(before, "review");
    freeze(before);
    let state = act(before, "settings");
    state = act(state, "settings");
    state = act(state, "hide");
    assert.equal(state.mode, "settings");
    assert.equal(state.settingsOrigin, origin);
    state = act(state, "back");
    assert.equal(state.mode, origin);
    assert.deepEqual(state.draft, before.draft);
    assert.deepEqual(state.complete, before.complete);
  });
}

test("取得途中で閉じると確認画面へ戻り、再選択しても他の内容とチェックを保持する", () => {
  let state = act(selected(), "accept", { value: "最初のタイトル" });
  state = act(state, "accept", { value: "場所" });
  state = act(state, "hide");
  assert.equal(state.mode, "review");
  state = act(state, "pick", { step: 0 });
  state = act(state, "accept", { value: "修正タイトル" });
  assert.equal(state.draft.title, "修正タイトル");
  assert.equal(state.draft.location, "場所");
  assert.equal(state.draft.step, 1);
  assert.deepEqual(state.complete, [true, true, false]);
});

test("途中確認や項目移動は完了扱いにせず、詳細だけの取得でも確認へ進む", () => {
  let state = act(selected(), "review");
  assert.deepEqual(state.complete, [false, false, false]);
  state = act(state, "pick", { step: 2 });
  state = act(state, "accept", { value: "詳細だけ" });
  assert.equal(state.mode, "review");
  assert.equal(state.draft.location, "");
  assert.equal(state.draft.title, "ページタイトル");
  assert.deepEqual(state.complete, [false, false, true]);
});

test("選び直し・再スキャン・ページ遷移のリセットで前の内容を次の予定に持ち越さない", () => {
  let state = act(selected(), "accept", { value: "前の予定" });
  state = act(state, "settings");
  const previous = freeze(state);
  state = act(state, "reset");
  assert.equal(state.mode, "list");
  assert.equal(state.settingsOrigin, "list");
  assert.equal(state.draft, null);
  assert.equal(state.variant, null);
  assert.deepEqual(state.complete, [false, false, false]);
  state = transitionSheet(state, { ...choose, title: "次のページ", url: "https://example.com/next" });
  assert.equal(state.draft.title, "次のページ");
  assert.equal(state.draft.url, "https://example.com/next");
  assert.equal(state.draft.location, "");
  assert.equal(previous.draft.title, "前の予定");
});

test("日時未選択・設定中の取得や不正な項目番号で状態を壊さない", () => {
  const initial = freeze(createSheetState());
  for (const action of [{ type: "review" }, { type: "pick", step: 0 }, { type: "accept", value: "本文" }, { type: "back" }]) {
    assert.equal(transitionSheet(initial, action), initial);
  }
  const state = freeze(selected());
  for (const step of [-1, 3, 0.5, NaN]) assert.equal(act(state, "pick", { step }), state);
  assert.equal(act(state, "accept", { value: "  " }), state);
  const settings = act(state, "settings");
  assert.equal(act(settings, "accept", { value: "本文" }), settings);
});
