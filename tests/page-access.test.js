import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFailure, unsupportedPage } from "../lib/page-access.js";

test("URLが伏せられた未許可ページと、判明している対象外ページを区別する", () => {
  for (const url of [
    undefined,
    "https://example.com",
    "http://localhost",
    "https://chrome.google.com/other",
  ])
    assert.equal(unsupportedPage(url), false);
  for (const url of [
    "chrome://settings",
    "about:blank",
    "file:///tmp/page.html",
    "https://chromewebstore.google.com/detail/app/id",
    "https://chrome.google.com/webstore/detail/app/id",
  ])
    assert.equal(unsupportedPage(url), true);
});

test("権限不足・禁止ページ・一時的な失敗を別々の案内にする", () => {
  assert.equal(
    accessFailure(
      new Error(
        'Cannot access contents of url "https://example.com/". Extension manifest must request permission to access this host.',
      ),
    ),
    "blocked",
  );
  assert.equal(
    accessFailure(new Error("Cannot access a chrome:// URL")),
    "unsupported",
  );
  assert.equal(
    accessFailure(new Error("The extensions gallery cannot be scripted.")),
    "unsupported",
  );
  assert.equal(
    accessFailure(new Error("Frame with ID 0 was removed.")),
    "error",
  );
  assert.equal(accessFailure(new Error("No tab with id: 99")), "error");
  assert.equal(accessFailure(undefined), "error");
});
