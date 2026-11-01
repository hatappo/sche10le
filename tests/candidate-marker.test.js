import test from "node:test";
import assert from "node:assert/strict";
import { candidateMarker } from "../lib/candidate-marker.js";

test("候補の目印はZの後も重複せずAA・ABと続く", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(candidateMarker),
    ["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});
