import { existsSync, readFileSync } from "node:fs";
import { Cron } from "croner";
import { parse } from "yaml";

export type JobSpec = {
  id: string;
  enabled: boolean;
  cron: string;
  skill: string;
  extraPrompt?: string;
};

export type JobsFile = {
  timezone: string;
  notifyUser: string;
  jobs: JobSpec[];
};

/**
 * Session key for a scheduled job in data/sessions.json.
 */
export function jobSessionKey(id: string): string {
  return `jobs.${id}`;
}

/**
 * Asia/Shanghai minute key used to de-dupe a tick.
 */
export function minuteKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Whether `cron` fires in the same timezone-minute as `at`.
 */
export function cronHitsMinute(expr: string, timeZone: string, at: Date): boolean {
  const cron = new Cron(expr, { timezone: timeZone });
  const prevMs = at.getTime() - 60_000;
  const next = cron.nextRun(new Date(prevMs));
  if (!next) {
    return false;
  }
  return minuteKey(next, timeZone) === minuteKey(at, timeZone);
}

/**
 * Parse jobs.yaml text. Unknown extra keys are ignored.
 */
export function parseJobsFile(text: string): JobsFile {
  const raw = parse(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("jobs.yaml 无效");
  }
  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim()
      : "Asia/Shanghai";
  const notifyUser = typeof raw.notifyUser === "string" ? raw.notifyUser.trim() : "";
  const jobsRaw = Array.isArray(raw.jobs) ? raw.jobs : [];
  const jobs: JobSpec[] = [];
  for (const item of jobsRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    const skill = String(rec.skill ?? "").trim();
    const cron = String(rec.cron ?? "").trim();
    if (!id || !skill || !cron) {
      throw new Error("jobs.yaml 条目缺 id/skill/cron");
    }
    if (!/^[a-z0-9-]+$/.test(skill)) {
      throw new Error(`非法 skill: ${skill}`);
    }
    jobs.push({
      id,
      skill,
      cron,
      enabled: rec.enabled !== false,
      extraPrompt: typeof rec.extraPrompt === "string" ? rec.extraPrompt : undefined,
    });
  }
  return { timezone, notifyUser, jobs };
}

/**
 * Prefer jobs.yaml notifyUser; otherwise the first stored context_token owner.
 */
export function pickNotifyUser(file: JobsFile, tokens: Record<string, string>): string {
  if (file.notifyUser) {
    return file.notifyUser;
  }
  return Object.keys(tokens)[0] ?? "";
}

/**
 * Load local jobs.yaml. Missing file → interactive-only.
 */
export function loadJobsFile(path: string): JobsFile | null {
  if (!existsSync(path)) {
    return null;
  }
  return parseJobsFile(readFileSync(path, "utf8"));
}

/**
 * Jobs whose cron hits `now` and have not already fired this minute.
 */
export function dueJobs(
  file: JobsFile,
  now: Date,
  lastFired: Map<string, string>,
): JobSpec[] {
  const tz = file.timezone || "Asia/Shanghai";
  const key = minuteKey(now, tz);
  return file.jobs.filter(
    (job) =>
      job.enabled && lastFired.get(job.id) !== key && cronHitsMinute(job.cron, tz, now),
  );
}

/**
 * Prompt body (WeChat constraint is applied later by buildPrompt).
 */
export function buildJobPrompt(job: JobSpec): string {
  const extra = job.extraPrompt?.trim();
  return [
    `执行定时 skill：${job.skill}（job id=${job.id}）。`,
    "先读 .cursor/skills-wcb/WCB_OUTPUT.md，再读 .cursor/skills-wcb/" +
      job.skill +
      "/SKILL.md，并按该 skill 执行。",
    extra ?? "",
    "禁止计划模式。高置信当场改并点名路径；拿不准只列 1. 2. 3.。最终回复用【已自动处理】【需要确认】【细节】。",
  ]
    .filter(Boolean)
    .join("\n");
}

export type SchedulerHooks = {
  intervalMs?: number;
  now?: () => Date;
  file: JobsFile;
  isBusy: () => boolean;
  onSkip: (reason: string) => void;
  onDue: (job: JobSpec) => Promise<void>;
};

/**
 * Poll about every 20s; fire each matching cron once per timezone-minute.
 */
export function startScheduler(hooks: SchedulerHooks): { stop: () => void } {
  const lastFired = new Map<string, string>();
  let inflight = false;
  const tz = hooks.file.timezone || "Asia/Shanghai";

  const tick = async (): Promise<void> => {
    if (inflight) {
      return;
    }
    if (hooks.isBusy()) {
      hooks.onSkip("busy");
      return;
    }
    const now = hooks.now?.() ?? new Date();
    const due = dueJobs(hooks.file, now, lastFired);
    if (due.length === 0) {
      return;
    }
    inflight = true;
    const key = minuteKey(now, tz);
    try {
      for (const job of due) {
        if (hooks.isBusy()) {
          hooks.onSkip(`busy skip ${job.id}`);
          continue;
        }
        lastFired.set(job.id, key);
        try {
          await hooks.onDue(job);
        } catch (err) {
          console.error(`job ${job.id} failed`, err);
        }
      }
    } finally {
      inflight = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, hooks.intervalMs ?? 20_000);
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
