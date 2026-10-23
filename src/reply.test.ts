import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText, formatAgentError, formatDraftResumeHint, stripMarkdown } from "./reply.js";

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

describe("formatDraftResumeHint", () => {
  it("mentions leftover lines after restart", () => {
    assert.match(formatDraftResumeHint(3), /重启后草稿还在（3 条）/);
  });
});

describe("formatAgentError", () => {
  it("hides the available-models dump", () => {
    const raw =
      "Cannot use this model: grok-4.6-fast. Available models: auto, gpt-5.3-codex-low";
    const text = formatAgentError(raw);
    assert.match(text, /模型不可用：grok-4\.6-fast/);
    assert.doesNotMatch(text, /Available models/);
    assert.doesNotMatch(text, /gpt-5/);
  });
});
