import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { PREFERENCE_KEYS } from "../lib/preferences.js";
import { createSheet } from "../lib/sheet.js";

export default defineContentScript({
  matches: [],
  registration: "runtime",
  main(ctx) {
    const scope = /** @type {typeof globalThis & { __sche10leSheet?: boolean }} */ (globalThis);
    if (scope.__sche10leSheet) return;
    scope.__sche10leSheet = true;
    const sheet = createSheet({
      load: () => browser.storage.local.get(PREFERENCE_KEYS),
      save: (values) => browser.storage.local.set(values),
      openCalendar: async (url) => {
        const result = await browser.runtime.sendMessage({ type: "open-calendar", url });
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
    const receive = (/** @type {{type?: string}} */ message, /** @type {{id?: string}} */ sender, /** @type {(result: {ok: boolean}) => void} */ reply) => {
      if (sender.id !== browser.runtime.id || message?.type !== "sheet-show") return;
      syncPage();
      void sheet.show().then(() => reply({ ok: true }), () => reply({ ok: false }));
      return true;
    };
    browser.runtime.onMessage.addListener(receive);
    const changed = (/** @type {Record<string, {newValue?: unknown}>} */ changes, /** @type {string} */ area) => {
      if (area !== "local") return;
      const values = Object.fromEntries(PREFERENCE_KEYS.filter((key) => key in changes)
        .map((key) => [key, changes[key].newValue]));
      sheet.updatePreferences(values);
    };
    browser.storage.onChanged.addListener(changed);
    ctx.setInterval(syncPage, 750);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(receive);
      browser.storage.onChanged.removeListener(changed);
      sheet.destroy();
      delete scope.__sche10leSheet;
    });
  },
});
