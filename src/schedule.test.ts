import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isCnHoliday, isCnWorkday } from "./holidays.js";
import {
  buildJobPrompt,
  cronHitsMinute,
  dueJobs,
  enqueueUnique,
  jobSessionKey,
  loadJobsFile,
  minuteKey,
  parseJobsFile,
  pickNotifyUser,
  startScheduler,
} from "./schedule.js";

const TZ = "Asia/Shanghai";
/** 2026-10-23 12:00:10 +8 */
const AT_1200 = new Date("2026-10-23T04:00:10.000Z");
/** 2026-10-23 12:01:00 +8 */
const AT_1201 = new Date("2026-10-23T04:01:00.000Z");
// 2026-10-21 12:40 +8; day 21 matches every-5th-day-of-month
const AT_1240_D21 = new Date("2026-10-21T04:40:05.000Z");
// 2026-10-23 12:40 +8; day 23 does not match
const AT_1240_D23 = new Date("2026-10-23T04:40:05.000Z");
const AT_ND = new Date("2026-10-01T04:00:10.000Z");
/** 2026-10-24 12:00:10 +8 Saturday */
const AT_SAT = new Date("2026-10-24T04:00:10.000Z");
/** 2026-10-10 12:00:10 +8 Saturday makeup workday */
const AT_MAKEUP = new Date("2026-10-10T04:00:10.000Z");

const EXAMPLE = `
timezone: Asia/Shanghai
notifyUser: ""
jobs:
  - id: error-alert
    enabled: true
    cron: "0 12 * * *"
    skill: aliyun-error-log
    skipHolidays: true
  - id: notify-fail
    enabled: true
    cron: "20 12 * * *"
    skill: notify-fail
    skipHolidays: true
  - id: lot-tag-audit
    enabled: true
    cron: "40 12 */5 * *"
    skill: lot-tagging-llm-quality
  - id: translation-audit
    enabled: true
    cron: "0 13 */5 * *"
    skill: translation-llm-quality
`;

describe("parseJobsFile", () => {
  it("reads skipHolidays and */5 crons", () => {
    const file = parseJobsFile(EXAMPLE);
    assert.equal(file.jobs.length, 4);
    assert.equal(file.jobs[0]?.skipHolidays, true);
    assert.equal(file.jobs[2]?.skipHolidays, false);
    assert.equal(file.jobs[2]?.cron, "40 12 */5 * *");
    assert.equal(file.jobs[3]?.skill, "translation-llm-quality");
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
  it("hits 12:00 daily and not 12:01", () => {
    assert.equal(cronHitsMinute("0 12 * * *", TZ, AT_1200), true);
    assert.equal(cronHitsMinute("0 12 * * *", TZ, AT_1201), false);
  });

  it("hits day-of-month */5 and misses other days", () => {
    assert.equal(cronHitsMinute("40 12 */5 * *", TZ, AT_1240_D21), true);
    assert.equal(cronHitsMinute("40 12 */5 * *", TZ, AT_1240_D23), false);
  });
});

describe("holidays / dueJobs", () => {
  it("treats National Day as holiday", () => {
    assert.equal(isCnHoliday(AT_ND, TZ), true);
    assert.equal(isCnHoliday(AT_1200, TZ), false);
  });

  it("treats weekends as off unless they are makeup workdays", () => {
    assert.equal(isCnWorkday(AT_1200, TZ), true);
    assert.equal(isCnWorkday(AT_SAT, TZ), false);
    assert.equal(isCnWorkday(AT_ND, TZ), false);
    assert.equal(isCnWorkday(AT_MAKEUP, TZ), true);
  });

  it("skips holiday-gated jobs and still fires */5 on the 21st", () => {
    const file = parseJobsFile(EXAMPLE);
    assert.deepEqual(
      dueJobs(file, AT_ND, new Map()).map((j) => j.id),
      [],
    );
    assert.deepEqual(
      dueJobs(file, AT_SAT, new Map()).map((j) => j.id),
      [],
    );
    assert.deepEqual(
      dueJobs(file, AT_MAKEUP, new Map()).map((j) => j.id),
      ["error-alert"],
    );
    assert.deepEqual(
      dueJobs(file, AT_1240_D21, new Map()).map((j) => j.id),
      ["lot-tag-audit"],
    );
  });

  it("returns error-alert once per minute on a normal day", () => {
    const file = parseJobsFile(EXAMPLE);
    const last = new Map<string, string>();
    assert.deepEqual(
      dueJobs(file, AT_1200, last).map((j) => j.id),
      ["error-alert"],
    );
    last.set("error-alert", minuteKey(AT_1200, TZ));
    assert.deepEqual(dueJobs(file, AT_1200, last), []);
  });
});

describe("enqueueUnique", () => {
  it("dedupes by id", () => {
    const file = parseJobsFile(EXAMPLE);
    const q = [];
    assert.equal(enqueueUnique(q, file.jobs[0]!), true);
    assert.equal(enqueueUnique(q, file.jobs[0]!), false);
    assert.equal(q.length, 1);
  });
});

describe("buildJobPrompt", () => {
  it("points at WCB_OUTPUT and the skill path without gate scripts", () => {
    const file = parseJobsFile(EXAMPLE);
    const text = buildJobPrompt(file.jobs[2]!);
    assert.match(text, /\.cursor\/skills-wcb\/WCB_OUTPUT\.md/);
    assert.match(text, /\.cursor\/skills-wcb\/lot-tagging-llm-quality\/SKILL\.md/);
    assert.doesNotMatch(text, /schedule_gate/);
  });
});

describe("startScheduler", () => {
  it("enqueues when busy and drains when free", async () => {
    const file = parseJobsFile(EXAMPLE);
    const fired: string[] = [];
    let busy = true;
    const sched = startScheduler({
      intervalMs: 25,
      now: () => AT_1200,
      file,
      canStart: () => !busy,
      onDue: async (job) => {
        fired.push(job.id);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(fired, []);
    busy = false;
    await new Promise((resolve) => setTimeout(resolve, 40));
    sched.stop();
    assert.deepEqual(fired, ["error-alert"]);
  });

  it("pauses drain when canStart flips false between jobs", async () => {
    const file = parseJobsFile(`
timezone: Asia/Shanghai
notifyUser: ""
jobs:
  - id: a
    cron: "0 12 * * *"
    skill: aliyun-error-log
  - id: b
    cron: "0 12 * * *"
    skill: notify-fail
`);
    const fired: string[] = [];
    let busy = false;
    const sched = startScheduler({
      intervalMs: 25,
      now: () => AT_1200,
      file,
      canStart: () => !busy,
      onDue: async (job) => {
        fired.push(job.id);
        busy = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(fired, ["a"]);
    busy = false;
    await new Promise((resolve) => setTimeout(resolve, 40));
    sched.stop();
    assert.deepEqual(fired, ["a", "b"]);
  });

  it("fires immediately when idle", async () => {
    const file = parseJobsFile(EXAMPLE);
    let fired = 0;
    const sched = startScheduler({
      intervalMs: 60_000,
      now: () => AT_1200,
      file,
      canStart: () => true,
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
