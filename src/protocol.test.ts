import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOSE_MARK, parseInbound, SEND_MARK } from "./protocol.js";

describe("parseInbound", () => {
  it("sends only on exact two ideographic full stops", () => {
    assert.deepEqual(parseInbound(SEND_MARK), { type: "send" });
    assert.deepEqual(parseInbound(`  ${SEND_MARK}  `), { type: "send" });
  });

  it("closes on two full stops plus ideographic comma", () => {
    assert.deepEqual(parseInbound(CLOSE_MARK), { type: "close" });
    assert.deepEqual(parseInbound(` ${CLOSE_MARK}`), { type: "close" });
  });

  it("keeps ellipsis and prefixed text as draft", () => {
    assert.deepEqual(parseInbound("等一下。。"), { type: "draft", text: "等一下。。" });
    assert.deepEqual(parseInbound("。。。"), { type: "draft", text: "。。。" });
    assert.deepEqual(parseInbound("。。选2"), { type: "draft", text: "。。选2" });
    assert.deepEqual(parseInbound(".."), { type: "draft", text: ".." });
    assert.deepEqual(parseInbound("。"), { type: "draft", text: "。" });
    assert.deepEqual(parseInbound("2"), { type: "draft", text: "2" });
  });
});
