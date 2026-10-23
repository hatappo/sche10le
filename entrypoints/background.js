import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    // open() must run directly in the action's user gesture, before any await.
    void chrome.sidePanel
      .open({ windowId: tab.windowId })
      .then(() => {
        return chrome.runtime.sendMessage({
          type: "scan-request",
          windowId: tab.windowId,
        });
      })
      .catch(() => {
        /* The panel may still be starting; it scans on first load. */
      });
  });
});
