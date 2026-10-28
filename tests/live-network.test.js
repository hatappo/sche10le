import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { observeNavigation, navigationErrorCode } from "./live/network.js";

function fixture() {
  const page = new EventEmitter();
  const frame = {};
  page.mainFrame = () => frame;
  const request = (url, main = true) => ({
    url: () => url,
    isNavigationRequest: () => true,
    frame: () => main ? frame : {},
    failure: () => ({ errorText: `net::ERR_CONNECTION_RESET at ${url}` }),
  });
  const updates = [];
  const stop = observeNavigation(page, {
    startedAt: Date.now(),
    onEvent: (event, network) => updates.push({ event, network }),
  });
  return { page, request, updates, stop };
}

test("本文を待たずにHTTPと転送先を記録し、URLの資格情報・クエリ・断片を保存しない", () => {
  const { page, request, updates, stop } = fixture();
  const req = request("https://user:password@example.com/event?token=secret#fragment");
  page.emit("request", req);
  page.emit("response", {
    request: () => req, url: req.url, status: () => 302,
    headers: () => ({ location: "/login?token=secret#fragment", "set-cookie": "private-cookie" }),
  });
  assert.equal(updates[1].event.status, 302);
  assert.equal(updates[1].event.redirectTo, "https://example.com/login");
  assert.equal(updates[0].network.events.length, 1);
  assert.equal(updates[1].network.events.length, 2);
  assert.doesNotMatch(JSON.stringify(updates), /password|token|secret|fragment|private-cookie/);
  stop();
});

test("通信エラーはコードだけを残し、サブフレームや終了処理中の通信は記録しない", () => {
  const { page, request, updates, stop } = fixture();
  page.emit("requestfailed", request("https://example.com/?private=secret", false));
  page.emit("request", {
    isNavigationRequest: () => true,
    frame: () => { throw new Error("Frame is not available"); },
  });
  assert.equal(updates.length, 0);
  page.emit("requestfailed", request("https://example.com/?private=secret"));
  assert.equal(updates[0].event.errorCode, "net::ERR_CONNECTION_RESET");
  assert.doesNotMatch(JSON.stringify(updates), /private|secret/);
  stop();
  page.emit("requestfailed", request("https://example.com/"));
  assert.equal(updates.length, 1);
  assert.equal(page.listenerCount("response"), 0);
  assert.equal(navigationErrorCode({ name: "TimeoutError", message: "secret" }), "TIMEOUT");
  assert.equal(navigationErrorCode(new Error("secret")), "UNKNOWN");
});

test("繰り返す遷移でも記録を32件に制限し、上限到達を知らせる", () => {
  const { page, request, updates, stop } = fixture();
  for (let i = 0; i < 100; i++) page.emit("request", request(`https://example.com/${i}`));
  assert.equal(updates.at(-1).network.events.length, 32);
  assert.equal(updates.at(-1).network.truncated, true);
  assert.equal(updates.length, 33);
  stop();
});
