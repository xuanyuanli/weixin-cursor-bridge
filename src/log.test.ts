import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preview } from "./log.js";

describe("preview", () => {
  it("collapses whitespace and truncates", () => {
    assert.equal(preview("  已收\n1 条  "), "已收 1 条");
    assert.equal(preview("a".repeat(12), 10), `${"a".repeat(10)}…`);
  });
});
