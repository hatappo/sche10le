import { defineContentScript } from "wxt/utils/define-content-script";
import { createPicker } from "../lib/picker.js";
import { createSourceHighlight } from "../lib/source-highlight.js";

export default defineContentScript({
  // Inject only on demand through activeTab; matches would grant host permissions.
  matches: [],
  registration: "runtime",
  main(ctx) {
    const scope =
      /** @type {typeof globalThis & { __sche10leInstalled?: boolean }} */ (
        globalThis
      );
    if (scope.__sche10leInstalled) return;
    scope.__sche10leInstalled = true;
    /** @type {chrome.runtime.Port | undefined} */
    let activePort;
    /** @type {ReturnType<typeof createPicker> | undefined} */
    let picker;
    /** @type {ReturnType<typeof createSourceHighlight> | undefined} */
    let highlight;

    /** @param {chrome.runtime.Port} port */
    function connect(port) {
      if (port.name !== "sche10le" || port.sender?.id !== chrome.runtime.id)
        return;
      activePort?.disconnect();
      picker?.destroy();
      highlight?.destroy();
      activePort = port;
      const originalUrl = location.href;
      const notify = (/** @type {object} */ message) => {
        try {
          port.postMessage(message);
        } catch {
          picker?.destroy();
          highlight?.clear();
        }
      };
      picker = createPicker(notify);
      const currentPicker = picker;
      highlight = createSourceHighlight();
      const currentHighlight = highlight;
      port.onMessage.addListener((message) => {
        if (location.href !== originalUrl) {
          currentPicker.destroy();
          currentHighlight.destroy();
          notify({ type: "page-changed" });
          return;
        }
        if (message.type === "scan") {
          currentPicker.stop();
          currentHighlight.capture();
          const json = [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
          ]
            .slice(0, 50)
            .map((el) => (el.textContent ?? "").slice(0, 200_001));
          notify({
            type: "snapshot",
            title: document.title,
            url: originalUrl,
            text: (document.body?.innerText ?? "").slice(0, 100_000),
            json,
          });
        } else if (message.type === "pick") {
          currentHighlight.clear();
          currentPicker.start(
            message.step,
            message.token,
            message.resetPosition === true,
          );
        } else if (message.type === "reveal-source") {
          currentHighlight.reveal(message.locator);
        } else if (message.type === "clear-source") {
          currentHighlight.clear();
        } else if (message.type === "stop") {
          currentPicker.stop();
          currentHighlight.clear();
        }
      });
      // Handles SPA URL changes as well as a normal document unload. No scanning here.
      const navigationTimer = ctx.setInterval(() => {
        if (location.href !== originalUrl) {
          currentPicker.destroy();
          currentHighlight.destroy();
          notify({ type: "page-changed" });
          port.disconnect();
          clearInterval(navigationTimer);
        }
      }, 750);
      port.onDisconnect.addListener(() => {
        clearInterval(navigationTimer);
        currentPicker.destroy();
        currentHighlight.destroy();
        if (activePort === port) activePort = undefined;
      });
    }
    chrome.runtime.onConnect.addListener(connect);
    ctx.onInvalidated(() => {
      activePort?.disconnect();
      picker?.destroy();
      highlight?.destroy();
      chrome.runtime.onConnect.removeListener(connect);
      delete scope.__sche10leInstalled;
    });
  },
});
