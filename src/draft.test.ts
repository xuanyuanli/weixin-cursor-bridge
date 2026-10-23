import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDraft,
  clearDraft,
  draftStats,
  flushDraft,
  hasDraft,
  peekDraft,
  type DraftMap,
} from "./draft.js";

describe("draft buffer", () => {
  it("appends lines and flushes joined text", () => {
    const map: DraftMap = {};
    appendDraft(map, "u1", "先看登录");
    const state = appendDraft(map, "u1", "再补测试");
    assert.deepEqual(draftStats(state), { lines: 2, chars: "先看登录\n\n再补测试".length });
    assert.equal(flushDraft(map, "u1"), "先看登录\n\n再补测试");
    assert.equal(flushDraft(map, "u1"), "");
  });

  it("isolates senders and clear drops without flush", () => {
    const map: DraftMap = {};
    appendDraft(map, "a", "A");
    appendDraft(map, "b", "B");
    clearDraft(map, "a");
    assert.equal(flushDraft(map, "a"), "");
    assert.equal(flushDraft(map, "b"), "B");
  });

  it("hasDraft is true only with unsent lines", () => {
    const map: DraftMap = {};
    assert.equal(hasDraft(map, "u1"), false);
    appendDraft(map, "u1", "待发");
    assert.equal(hasDraft(map, "u1"), true);
    flushDraft(map, "u1");
    assert.equal(hasDraft(map, "u1"), false);
  });

  it("peekDraft does not clear", () => {
    const map: DraftMap = {};
    appendDraft(map, "u1", "先看登录");
    assert.equal(peekDraft(map, "u1"), "先看登录");
    assert.equal(hasDraft(map, "u1"), true);
  });
});
