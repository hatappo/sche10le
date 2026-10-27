import { sites } from "../tests/live/sites.js";
import { reviewMarkdown, reviewSamples } from "../tests/live/sample-review.js";

// A maintenance reminder, not a live test: overdue samples keep exit status 0.
console.log(reviewMarkdown(reviewSamples(sites)));
