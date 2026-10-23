import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText, formatDraftAck, stripMarkdown } from "./reply.js";

describe("stripMarkdown", () => {
  it("drops fences headings and emphasis", () => {
    const raw = ["# 标题", "", "这是 **粗体** 和 `code`", "", "```ts", "const x = 1;", "```"].join(
      "\n",
    );
    const out = stripMarkdown(raw);
    assert.match(out, /标题/);
    assert.match(out, /粗体/);
    assert.match(out, /const x = 1/);
    assert.doesNotMatch(out, /```/);
    assert.doesNotMatch(out, /\*\*/);
  });
});

describe("chunkText", () => {
  it("returns one chunk when under the cap", () => {
    assert.deepEqual(chunkText("短回复", 1800), ["短回复"]);
  });

  it("splits long text and labels parts", () => {
    const para = "一段话。".repeat(80);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(text, 200);
    assert.ok(chunks.length >= 2);
    assert.match(chunks[0], /^【1\/\d+】/);
    assert.match(chunks[chunks.length - 1], /^【\d+\/\d+】/);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 200);
    }
  });
});

describe("formatDraftAck", () => {
  it("tells send and close marks", () => {
    assert.equal(formatDraftAck(2, 87), "草稿 2 条 / 87 字。发送。。  关闭。。，");
  });
});
