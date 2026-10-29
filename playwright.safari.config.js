import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/safari",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: { viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "Asia/Tokyo", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
