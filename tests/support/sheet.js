import { THEMES } from "../../lib/themes.js";

// Called only by tests with a temporary host permission for the fixture/site.
// The isolated world's closed shadow roots are made observable only for this run.
export async function showSheet(worker, page) {
  await page.bringToFront();
  return worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({ active: true })).find((item) => item.url === url);
    if (!tab?.id) throw new Error("Source tab not found");
    const existing = await chrome.tabs.sendMessage(tab.id, { type: "sheet-show" }, { frameId: 0 }).catch(() => null);
    if (existing?.ok) return existing;
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => {
      if (globalThis.__sheetTestObservation) return;
      globalThis.__sheetTestObservation = true;
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: "open" }); };
    } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["/content-scripts/sheet.js"] });
    return chrome.tabs.sendMessage(tab.id, { type: "sheet-show" }, { frameId: 0 });
  }, page.url());
}

export async function chooseTheme(sheet, id) {
  const selector = sheet.locator(".theme-selector");
  if (!(await selector.evaluate(node => node.open))) await selector.locator("summary").click();
  await selector.getByRole("button", { name: THEMES.find(theme => theme.id === id).name, exact: true }).click();
}
