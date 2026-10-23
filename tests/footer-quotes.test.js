import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FOOTER_QUOTES, pickFooterQuote } from "../lib/footer-quotes.js";

test("全てのフッター文言が抽選でき、READMEにも一覧されている", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8",
  );
  const drawn = FOOTER_QUOTES.map((_, index) =>
    pickFooterQuote(() => (index + 0.5) / FOOTER_QUOTES.length),
  );
  assert.deepEqual(drawn, FOOTER_QUOTES);
  assert.equal(
    pickFooterQuote(() => 0),
    FOOTER_QUOTES[0],
  );
  assert.equal(
    pickFooterQuote(() => 1 - Number.EPSILON),
    FOOTER_QUOTES.at(-1),
  );
  for (const quote of FOOTER_QUOTES)
    assert.ok(readme.includes(quote.text), quote.text);
});
