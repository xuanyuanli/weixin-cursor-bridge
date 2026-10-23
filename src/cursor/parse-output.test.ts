import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentOutput } from "./parse-output.js";

const SAMPLE = `{"type":"result","subtype":"success","is_error":false,"duration_ms":81177,"result":"收到。之后回复会短、分段，方便手机看。","session_id":"ab2a21355","usage":{"inputTokens":15155,"outputTokens":209}}`;

describe("parseAgentOutput", () => {
  it("takes result not the nested usage object", () => {
    const parsed = parseAgentOutput(SAMPLE);
    assert.equal(parsed.text, "收到。之后回复会短、分段，方便手机看。");
    assert.equal(parsed.sessionId, "ab2a21355");
    assert.doesNotMatch(parsed.text, /inputTokens/);
    assert.doesNotMatch(parsed.text, /"type":"result"/);
  });

  it("returns empty text when stdout is not an envelope", () => {
    assert.equal(parseAgentOutput("not json").text, "");
    assert.equal(parseAgentOutput('{"usage":{"inputTokens":1}}').text, "");
  });
});
