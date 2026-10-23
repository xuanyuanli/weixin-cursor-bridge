import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDraft,
  appendDraftImage,
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

  it("keeps multi text and images in arrival order as one send", () => {
    const map: DraftMap = {};
    appendDraft(map, "u1", "第一张");
    appendDraftImage(map, "u1", "D:\\\\inbox\\\\a.jpg");
    appendDraft(map, "u1", "第二张");
    appendDraftImage(map, "u1", "D:\\\\inbox\\\\b.jpg");
    const body = "第一张\n\nD:\\\\inbox\\\\a.jpg\n\n第二张\n\nD:\\\\inbox\\\\b.jpg";
    assert.equal(peekDraft(map, "u1"), body);
    assert.deepEqual(draftStats(map.u1), { lines: 4, chars: body.length });
    assert.equal(flushDraft(map, "u1"), body);
    assert.equal(hasDraft(map, "u1"), false);
  });

  it("reads leftover { lines, images } drafts", () => {
    const map = {
      u1: {
        lines: ["看看这个问题"],
        images: ["D:\\\\inbox\\\\a.jpg"],
      },
    } as unknown as DraftMap;
    assert.equal(peekDraft(map, "u1"), "看看这个问题\n\nD:\\\\inbox\\\\a.jpg");
  });
});
