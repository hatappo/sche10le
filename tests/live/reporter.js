import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { sites } from "./sites.js";
import { reportOutcome, summaryMarkdown } from "./contract.js";

export default class LiveReporter {
  results = new Map();
  onBegin(_config, suite) {
    for (const test of suite.allTests()) {
      const site = sites.find((site) => site.id === test.title);
      if (site)
        this.results.set(site.id, {
          id: site.id,
          name: site.name,
          url: site.url,
          expected: site.expected,
          status: "failed",
          category: "NOT_RUN",
          candidates: [],
        });
    }
  }
  onTestEnd(test, result) {
    const attachment = result.attachments.find(
      (item) => item.name === "live-result",
    );
    if (!attachment?.body) return;
    const report = JSON.parse(attachment.body.toString("utf8"));
    if (result.status !== "passed" && report.category === "PASS") {
      report.status = "failed";
      report.category = "HARNESS_ERROR";
    }
    this.results.set(test.title, report);
  }
  async onEnd(result) {
    const reports = [...this.results.values()];
    const outcome = reportOutcome(reports, result.status);
    const summary = summaryMarkdown(reports, outcome);
    await mkdir("test-results/live", { recursive: true });
    await writeFile(
      "test-results/live/report.json",
      JSON.stringify(
        {
          outcome,
          commit: process.env.GITHUB_SHA ?? null,
          reports,
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile("test-results/live/summary.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    return { status: outcome };
  }
}
