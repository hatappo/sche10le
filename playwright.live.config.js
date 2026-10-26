import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "live.spec.js",
  outputDir: "test-results/live/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  timeout: 75_000,
  globalTimeout: 10 * 60_000,
  forbidOnly: true,
  reporter: [["list"], ["./tests/live/reporter.js"]],
  use: { trace: "off", screenshot: "off", video: "off" },
});
