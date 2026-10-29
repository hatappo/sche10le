import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { createSafariSheet } from "../lib/safari-sheet.js";

export default defineContentScript({
  include: ["safari"],
  matches: [],
  registration: "runtime",
  main(ctx) {
    const scope = /** @type {typeof globalThis & { __sche10leSafari?: boolean }} */ (globalThis);
    if (scope.__sche10leSafari) return;
    scope.__sche10leSafari = true;
    const sheet = createSafariSheet({
      load: () => browser.storage.local.get(["themeId", "travelMinutes", "titleFormat", "candidateOrder"]),
      save: (values) => browser.storage.local.set(values),
      openCalendar: async (url) => {
        const result = await browser.runtime.sendMessage({ type: "safari-open-calendar", url });
        if (!result?.ok) throw new Error("Calendar handoff failed");
      },
    });
    // A navigation clears page data, including SPA navigations while the UI is closed.
    let url = location.href;
    const syncPage = () => {
      if (url !== location.href) {
        url = location.href;
        sheet.reset();
      }
    };
    const receive = (/** @type {{type?: string}} */ message, /** @type {{id?: string}} */ sender) => {
      if (sender.id !== browser.runtime.id || message?.type !== "safari-show") return;
      syncPage();
      return sheet.show().then(() => ({ ok: true }));
    };
    browser.runtime.onMessage.addListener(receive);
    ctx.setInterval(syncPage, 750);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(receive);
      sheet.destroy();
      delete scope.__sche10leSafari;
    });
  },
});
