import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildJobPrompt,
  cronHitsMinute,
  dueJobs,
  jobSessionKey,
  loadJobsFile,
  minuteKey,
  parseJobsFile,
  pickNotifyUser,
  startScheduler,
} from "./schedule.js";

const TZ = "Asia/Shanghai";
/** 2026-10-23 09:30:40 +8 */
const AT_0930 = new Date("2026-10-23T01:30:40.000Z");
/** 2026-10-23 09:31:00 +8 */
const AT_0931 = new Date("2026-10-23T01:31:00.000Z");
/** 2026-10-23 13:00:05 +8 */
const AT_1300 = new Date("2026-10-23T05:00:05.000Z");
/** 2026-10-23 14:00:05 +8 */
const AT_1400 = new Date("2026-10-23T06:00:05.000Z");

const EXAMPLE = `
timezone: Asia/Shanghai
notifyUser: ""
jobs:
  - id: error-alert
    enabled: true
    cron: "30 9 * * *"
    skill: aliyun-error-log
    extraPrompt: "先跑 .cursor/skills-wcb/scripts/schedule_gate.py --mode holiday；法定假日 skip。窗口走增量。"
  - id: notify-fail
    enabled: true
    cron: "0 10 * * *"
    skill: notify-fail
    extraPrompt: "先跑 .cursor/skills-wcb/scripts/schedule_gate.py --mode holiday；法定假日 skip。窗口近 24h。"
  - id: lot-tag-audit
    enabled: true
    cron: "0 13 * * *"
    skill: lot-tagging-llm-quality
    extraPrompt: "先跑 .cursor/skills-wcb/scripts/schedule_gate.py --mode interval --days 5 --job lot-tag-audit；未满 5 天 skip。不跳假日。lookback-days=5。成功后 --mark。只做分类域。"
  - id: translation-audit
    enabled: true
    cron: "0 14 * * *"
    skill: translation-llm-quality
    extraPrompt: "先跑 .cursor/skills-wcb/scripts/schedule_gate.py --mode interval --days 5 --job translation-audit；未满 5 天 skip。不跳假日。lookback-days=5。成功后 --mark。只做翻译域。"
`;

describe("parseJobsFile", () => {
  it("reads example jobs and extraPrompt", () => {
    const file = parseJobsFile(EXAMPLE);
    assert.equal(file.timezone, TZ);
    assert.equal(file.notifyUser, "");
    assert.equal(file.jobs.length, 4);
    assert.equal(file.jobs[2]?.skill, "lot-tagging-llm-quality");
    assert.equal(file.jobs[3]?.skill, "translation-llm-quality");
    assert.match(file.jobs[0]?.extraPrompt ?? "", /法定假日/);
    assert.match(file.jobs[2]?.extraPrompt ?? "", /interval --days 5/);
    assert.match(file.jobs[3]?.extraPrompt ?? "", /只做翻译域/);
  });

  it("rejects illegal skill names", () => {
    assert.throws(() => parseJobsFile("jobs:\n  - id: x\n    cron: '* * * * *'\n    skill: ../x\n"));
  });
});

describe("loadJobsFile", () => {
  it("returns null when jobs.yaml is missing", () => {
    assert.equal(loadJobsFile(join(tmpdir(), "wcb-no-such-jobs.yaml")), null);
  });

  it("loads a written file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wcb-jobs-"));
    const path = join(dir, "jobs.yaml");
    writeFileSync(path, EXAMPLE, "utf8");
    const file = loadJobsFile(path);
    assert.equal(file?.jobs[0]?.id, "error-alert");
  });
});

describe("cronHitsMinute", () => {
  it("hits 09:30 for error-alert and not 09:31", () => {
    assert.equal(cronHitsMinute("30 9 * * *", TZ, AT_0930), true);
    assert.equal(cronHitsMinute("30 9 * * *", TZ, AT_0931), false);
  });

  it("hits 13:00 for lot-tag-audit and 14:00 for translation-audit", () => {
    assert.equal(cronHitsMinute("0 13 * * *", TZ, AT_1300), true);
    assert.equal(cronHitsMinute("0 13 * * *", TZ, AT_0930), false);
    assert.equal(cronHitsMinute("0 14 * * *", TZ, AT_1400), true);
    assert.equal(cronHitsMinute("0 14 * * *", TZ, AT_1300), false);
  });
});

describe("dueJobs", () => {
  it("returns the matching enabled job once per minute", () => {
    const file = parseJobsFile(EXAMPLE);
    const last = new Map<string, string>();
    const first = dueJobs(file, AT_0930, last);
    assert.deepEqual(
      first.map((j) => j.id),
      ["error-alert"],
    );
    last.set("error-alert", minuteKey(AT_0930, TZ));
    assert.deepEqual(dueJobs(file, AT_0930, last), []);
  });

  it("skips disabled jobs", () => {
    const file = parseJobsFile(EXAMPLE);
    file.jobs[0]!.enabled = false;
    assert.deepEqual(dueJobs(file, AT_0930, new Map()), []);
  });
});

describe("buildJobPrompt", () => {
  it("points at WCB_OUTPUT and the skill path", () => {
    const file = parseJobsFile(EXAMPLE);
    const text = buildJobPrompt(file.jobs[2]!);
    assert.match(text, /\.cursor\/skills-wcb\/WCB_OUTPUT\.md/);
    assert.match(text, /\.cursor\/skills-wcb\/lot-tagging-llm-quality\/SKILL\.md/);
    assert.match(text, /lookback-days=5/);
  });
});

describe("startScheduler", () => {
  it("skips the tick when agent is busy", async () => {
    const file = parseJobsFile(EXAMPLE);
    let skips = 0;
    let fired = 0;
    const sched = startScheduler({
      intervalMs: 60_000,
      now: () => AT_0930,
      file,
      isBusy: () => true,
      onSkip: () => {
        skips += 1;
      },
      onDue: async () => {
        fired += 1;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sched.stop();
    assert.ok(skips >= 1);
    assert.equal(fired, 0);
  });

  it("fires the matching job once when idle", async () => {
    const file = parseJobsFile(EXAMPLE);
    let fired = 0;
    const sched = startScheduler({
      intervalMs: 60_000,
      now: () => AT_0930,
      file,
      isBusy: () => false,
      onSkip: () => {
        /* unused */
      },
      onDue: async (job) => {
        fired += 1;
        assert.equal(job.id, "error-alert");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    sched.stop();
    assert.equal(fired, 1);
  });
});

describe("jobSessionKey / pickNotifyUser", () => {
  it("uses jobs.<id> and falls back to first token", () => {
    assert.equal(jobSessionKey("error-alert"), "jobs.error-alert");
    const file = parseJobsFile(EXAMPLE);
    assert.equal(pickNotifyUser(file, { u1: "tok" }), "u1");
    file.notifyUser = "wx-9";
    assert.equal(pickNotifyUser(file, { u1: "tok" }), "wx-9");
  });
});
