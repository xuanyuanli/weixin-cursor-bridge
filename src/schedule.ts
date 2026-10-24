import { existsSync, readFileSync } from "node:fs";
import { Cron } from "croner";
import { isCnWorkday } from "./holidays.js";
import { error as logError } from "./log.js";
import { parse } from "yaml";

export type JobSpec = {
  id: string;
  enabled: boolean;
  cron: string;
  skill: string;
  extraPrompt?: string;
  skipHolidays: boolean;
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
      skipHolidays: rec.skipHolidays === true,
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
 * Cron-hit enabled jobs not yet seen this minute, minus holiday-gated ones.
 */
export function dueJobs(
  file: JobsFile,
  now: Date,
  lastFired: Map<string, string>,
): JobSpec[] {
  const tz = file.timezone || "Asia/Shanghai";
  const key = minuteKey(now, tz);
  return file.jobs.filter((job) => {
    if (!job.enabled || lastFired.get(job.id) === key) {
      return false;
    }
    if (!cronHitsMinute(job.cron, tz, now)) {
      return false;
    }
    if (job.skipHolidays && !isCnWorkday(now, tz)) {
      return false;
    }
    return true;
  });
}

/**
 * Append job if this id is not already waiting.
 */
export function enqueueUnique(queue: JobSpec[], job: JobSpec): boolean {
  if (queue.some((item) => item.id === job.id)) {
    return false;
  }
  queue.push(job);
  return true;
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
      "/SKILL.md，并按该 skill 执行。不要做调度/门禁。",
    extra ?? "",
    "禁止计划模式。高置信当场改并点名路径；拿不准只列 1. 2. 3.。最终回复用【已自动处理】【需要确认】【细节】。终态只写一份短 md，json 嵌在文内。",
  ]
    .filter(Boolean)
    .join("\n");
}

export type SchedulerHooks = {
  intervalMs?: number;
  now?: () => Date;
  file: JobsFile;
  canStart: () => boolean;
  onSkip?: (reason: string) => void;
  onEnqueue?: (job: JobSpec, waiting: number) => void;
  onDue: (job: JobSpec) => Promise<void>;
};

/**
 * Cron 命中则入队；agent 空闲时串行 drain。忙不丢当天任务。
 */
export function startScheduler(hooks: SchedulerHooks): { stop: () => void } {
  const lastFired = new Map<string, string>();
  const queue: JobSpec[] = [];
  let inflight = false;
  const tz = hooks.file.timezone || "Asia/Shanghai";

  const tick = async (): Promise<void> => {
    const now = hooks.now?.() ?? new Date();
    const key = minuteKey(now, tz);
    for (const job of hooks.file.jobs) {
      if (!job.enabled || lastFired.get(job.id) === key) {
        continue;
      }
      if (!cronHitsMinute(job.cron, tz, now)) {
        continue;
      }
      lastFired.set(job.id, key);
      if (job.skipHolidays && !isCnWorkday(now, tz)) {
        hooks.onSkip?.(`off-day ${job.id}`);
        continue;
      }
      if (enqueueUnique(queue, job)) {
        hooks.onEnqueue?.(job, queue.length);
      }
    }
    if (inflight || !hooks.canStart() || queue.length === 0) {
      return;
    }
    inflight = true;
    try {
      while (queue.length > 0) {
        if (!hooks.canStart()) {
          break;
        }
        const job = queue.shift();
        if (!job) {
          break;
        }
        try {
          await hooks.onDue(job);
        } catch (err) {
          logError(`计划任务 ${job.id} 未捕获异常`, err);
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
