import { test, expect } from "@playwright/test";
import { sites } from "./sites.js";
import { categories, selectSites } from "./contract.js";
import { runLiveCase } from "./run-case.js";

for (const site of selectSites(sites, process.env.LIVE_SITES ?? "all")) {
  test(site.id, async ({ browserName: _browserName }, testInfo) => {
    const result = await runLiveCase(site, {
      onProgress: (snapshot) =>
        testInfo.attach("live-progress", {
          body: JSON.stringify(snapshot),
          contentType: "application/json",
        }),
    });
    await testInfo.attach("live-result", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(
      result.status,
      `${site.name}: ${result.category} — ${categories[result.category]}`,
    ).toBe("passed");
  });
}

// No retries or crawling. Leave a small gap even when a site immediately fails.
test.afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
});
