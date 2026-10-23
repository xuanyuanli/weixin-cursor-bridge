import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bumpEpoch,
  currentEpoch,
  forgetUserSession,
  sameEpoch,
  type SessionMap,
} from "./session-guard.js";

describe("session-guard", () => {
  it("forgets the user session and keeps job keys", () => {
    const sessions: SessionMap = {
      u1: { sessionId: "old" },
      "jobs.error-alert": { sessionId: "job" },
    };
    assert.equal(forgetUserSession(sessions, "u1"), "old");
    assert.equal(sessions.u1, undefined);
    assert.equal(sessions["jobs.error-alert"]?.sessionId, "job");
  });

  it("rejects writes after close bumps the epoch", () => {
    const epochs = new Map<string, number>();
    const started = currentEpoch(epochs, "u1");
    assert.equal(sameEpoch(epochs, "u1", started), true);
    bumpEpoch(epochs, "u1");
    assert.equal(sameEpoch(epochs, "u1", started), false);
  });
});
