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
  assert.equal(
    new Set(FOOTER_QUOTES.map((quote) => quote.original)).size,
    FOOTER_QUOTES.length,
  );
  for (const quote of FOOTER_QUOTES) {
    assert.ok(readme.includes(quote.text), quote.text);
    assert.ok(quote.original.trim());
    assert.ok(readme.includes(quote.original), quote.original);
    assert.ok(readme.includes(quote.source), quote.source);
    assert.equal(new URL(quote.source).protocol, "https:");
  }
});
