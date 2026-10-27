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
    const progress = result.attachments
      .filter((item) => item.name === "live-progress" && item.body)
      .map((item) => JSON.parse(item.body.toString("utf8")))
      .filter((snapshot) => {
        if (result.status !== "timedOut") return true;
        // Cleanup may emit attachments after the deadline. It must not replace
        // the phase that was actually running when the test timed out.
        const startOffset = result.startTime && snapshot.checkedAt
          ? Date.parse(snapshot.checkedAt) - result.startTime.getTime()
          : 0;
        return startOffset + snapshot.durationMs <= result.duration;
      });
    const attachment = result.attachments.find(
      (item) => item.name === "live-result",
    );
    const report = attachment?.body && result.status !== "timedOut"
      ? JSON.parse(attachment.body.toString("utf8"))
      : (progress.at(-1) ?? this.results.get(test.title));
    if (!report) return;
    report.phaseHistory = progress.map((p) => ({
      phase: p.phase,
      elapsedMs: p.durationMs,
    }));
    if (result.status === "timedOut") {
      report.status = "failed";
      report.category = "TEST_TIMEOUT";
      report.durationMs = result.duration;
    } else if (
      (!attachment?.body && !["skipped", "interrupted"].includes(result.status)) ||
      (result.status !== "passed" && report.category === "PASS")
    ) {
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
