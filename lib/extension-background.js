import { browser } from "wxt/browser";
import { isCalendarHandoff } from "./calendar-handoff.js";
import { unsupportedPage, accessFailure } from "./page-access.js";

export function startExtensionBackground() {
  // Idempotent cleanup on background startup also retries after an interrupted update.
  // Only explicitly retired keys are removed; current and unknown keys are preserved.
  void browser.storage.local.remove(["aiEnabled"]).catch(() => {
    console.warn("Retired preference cleanup failed; retrying on next background startup.");
  });
  browser.action.onClicked.addListener(async (tab) => {
    let reason = "unsupported";
    if (tab.id !== undefined && !unsupportedPage(tab.url)) {
      try {
        // Reuse the page's existing state. WXT invalidates its previous context
        // on reinjection, which would otherwise discard the current draft.
        const existing = await browser.tabs.sendMessage(tab.id, { type: "sheet-show" }, { frameId: 0 }).catch(() => null);
        if (existing?.ok) return;
        await browser.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["/content-scripts/sheet.js"],
        });
        const result = await browser.tabs.sendMessage(tab.id, { type: "sheet-show" }, { frameId: 0 });
        if (!result?.ok) throw new Error("Sheet could not start");
        return;
      } catch (error) {
        reason = accessFailure(error);
      }
    }
    // A denied injection cannot draw guidance on the page itself.
    await browser.tabs.create({
      url: browser.runtime.getURL(`/help.html?reason=${reason}`),
    }).catch(() => {});
  });
  // Keep the validated legacy handoff for a sheet injected before this update.
  browser.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== "open-calendar") return;
    if (sender.id !== browser.runtime.id || sender.tab?.id === undefined ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      !isCalendarHandoff(message.url)) { reply({ ok: false }); return; }
    void browser.tabs.create({ url: message.url })
      .then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  });
}
