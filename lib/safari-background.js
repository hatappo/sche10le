import { browser } from "wxt/browser";
import { isCalendarHandoff } from "./safari-policy.js";
import { unsupportedPage, accessFailure } from "./page-access.js";

export function startSafariBackground() {
  browser.action.onClicked.addListener(async (tab) => {
    let reason = "unsupported";
    if (tab.id !== undefined && !unsupportedPage(tab.url)) {
      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["/content-scripts/safari.js"],
        });
        await browser.tabs.sendMessage(tab.id, { type: "safari-show" }, { frameId: 0 });
        return;
      } catch (error) {
        reason = accessFailure(error);
      }
    }
    // A denied injection cannot draw guidance on the page itself.
    await browser.tabs.create({
      url: browser.runtime.getURL(`/safari-help.html?reason=${reason}`),
    }).catch(() => {});
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "safari-open-calendar") return;
    if (sender.id !== browser.runtime.id || sender.tab?.id === undefined ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      !isCalendarHandoff(message.url)) return Promise.resolve({ ok: false });
    return browser.tabs.create({ url: message.url })
      .then(() => ({ ok: true }), () => ({ ok: false }));
  });
}
