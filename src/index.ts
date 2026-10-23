import { mkdirSync, unlinkSync } from "node:fs";
import { AgentCancelled, resolveAgentPath, startAgent } from "./cursor/agent.js";
import {
  ALLOWLIST_PATH,
  CONTEXT_TOKENS_PATH,
  CREDENTIALS_PATH,
  DRAFTS_PATH,
  INBOX_DIR,
  JOBS_PATH,
  loadConfig,
  SESSIONS_PATH,
  UPDATES_PATH,
} from "./config.js";
import {
  buildJobPrompt,
  jobSessionKey,
  loadJobsFile,
  pickNotifyUser,
  startScheduler,
} from "./schedule.js";
import {
  appendDraft,
  clearDraft,
  flushDraft,
  peekDraft,
  MAX_DRAFT_LINES,
  type DraftMap,
} from "./draft.js";
import { bumpEpoch, currentEpoch, forgetUserSession, sameEpoch } from "./session-guard.js";
import { error as logError, info, preview, warn } from "./log.js";
import { parseInbound } from "./protocol.js";
import {
  chunkText,
  formatAgentError,
  formatBusyHint,
  formatDraftFull,
  formatDraftStillHeld,
  formatEmptyDraftHint,
  stripMarkdown,
} from "./reply.js";
import { readJson, writeJson } from "./store.js";
import {
  type Credentials,
  loginWithQr,
  pollUpdates,
  sendText,
  sendTyping,
} from "./weixin/ilink.js";

type Sessions = Record<string, { sessionId: string }>;
type Tokens = Record<string, string>;
type AllowFile = { ids: string[] };

const CHUNK_GAP_MS = 1_500;

type Job = {
  cancel: () => void;
  timers: NodeJS.Timeout[];
};

const jobs = new Map<string, Job>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadAllow(envIds: string[]): string[] {
  const file = readJson<AllowFile>(ALLOWLIST_PATH, { ids: [] });
  return [...new Set([...envIds, ...file.ids])];
}

function saveAllow(ids: string[]): void {
  writeJson(ALLOWLIST_PATH, { ids });
}

function authorize(sender: string, envIds: string[]): boolean {
  const ids = loadAllow(envIds);
  if (ids.length === 0) {
    saveAllow([sender]);
    info(`白名单绑定首位 ${sender}`);
    return true;
  }
  return ids.includes(sender);
}

async function reply(
  creds: Credentials,
  to: string,
  tokens: Tokens,
  text: string,
  maxChars: number,
): Promise<void> {
  const token = tokens[to];
  if (!token) {
    warn(`出站跳过 ${to}：无 context_token`);
    return;
  }
  const chunks = chunkText(stripMarkdown(text), maxChars);
  info(`出站 ${to} ${String(chunks.length)}段 ${String(text.length)}字 「${preview(text)}」`);
  for (let i = 0; i < chunks.length; i += 1) {
    await sendText(creds, to, chunks[i], token);
    if (i < chunks.length - 1) {
      await sleep(CHUNK_GAP_MS);
    }
  }
}

function stopHeartbeat(job: Job): void {
  for (const t of job.timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  job.timers = [];
}

function closeJob(sender: string): boolean {
  const job = jobs.get(sender);
  if (!job) {
    return false;
  }
  stopHeartbeat(job);
  job.cancel();
  jobs.delete(sender);
  return true;
}

async function main(): Promise<void> {
  if (process.argv.includes("--logout")) {
    try {
      unlinkSync(CREDENTIALS_PATH);
      info("已清除登录凭证");
    } catch {
      info("没有已保存的凭证");
    }
    return;
  }

  const config = loadConfig();
  const agentPath = resolveAgentPath(config.cursorCliPath);

  const saved = readJson<Credentials | null>(CREDENTIALS_PATH, null);
  let creds: Credentials;
  if (saved?.botToken) {
    creds = saved;
    info(`使用已保存凭证 user=${saved.userId ?? "-"}`);
  } else {
    creds = await loginWithQr(CREDENTIALS_PATH);
  }

  const allow = loadAllow(config.allowFrom);
  if (allow.length === 0 && creds.userId) {
    saveAllow([creds.userId]);
  }

  mkdirSync(INBOX_DIR, { recursive: true });
  const drafts = readJson<DraftMap>(DRAFTS_PATH, {});
  const sessions = readJson<Sessions>(SESSIONS_PATH, {});
  const epochs = new Map<string, number>();
  const tokens = readJson<Tokens>(CONTEXT_TOKENS_PATH, {});
  let updates = readJson<{ get_updates_buf: string }>(UPDATES_PATH, {
    get_updates_buf: "",
  });

  info(
    `已启动 workspace=${config.workspace} model=${config.cursorModel} agent=${agentPath}`,
  );
  info(`白名单 ${String(allow.length)} 人 草稿${String(Object.keys(drafts).length)}份`);

  const persistDrafts = (): void => writeJson(DRAFTS_PATH, drafts);
  const persistSessions = (): void => writeJson(SESSIONS_PATH, sessions);
  const persistTokens = (): void => writeJson(CONTEXT_TOKENS_PATH, tokens);

  const send = (to: string, text: string): Promise<void> =>
    reply(creds, to, tokens, text, config.wechatMaxChars);

  let scheduledRunning = false;
  const jobsFile = loadJobsFile(JOBS_PATH);
  if (!jobsFile) {
    info("无 jobs.yaml，仅交互");
  } else {
    info(`已加载 ${String(jobsFile.jobs.length)} 个计划任务`);
    startScheduler({
      file: jobsFile,
      canStart: () => jobs.size === 0 && !scheduledRunning,
      onSkip: (reason) => {
        info(`计划跳过 ${reason}`);
      },
      onEnqueue: (job, waiting) => {
        info(`计划入队 ${job.id} 排队=${String(waiting)}`);
      },
      onDue: async (spec) => {
        scheduledRunning = true;
        const notifyUser = pickNotifyUser(jobsFile, tokens);
        const sessionKey = jobSessionKey(spec.id);
        info(`计划执行 ${spec.id} skill=${spec.skill} notify=${notifyUser || "-"}`);
        try {
          const run = startAgent({
            agentPath,
            workspace: config.workspace,
            model: config.cursorModel,
            sessionId: sessions[sessionKey]?.sessionId,
            userText: buildJobPrompt(spec),
          });
          const job: Job = { cancel: run.cancel, timers: [] };
          if (notifyUser) {
            jobs.set(notifyUser, job);
          }
          try {
            const result = await run.done;
            if (result.sessionId) {
              sessions[sessionKey] = { sessionId: result.sessionId };
              persistSessions();
            }
            if (notifyUser && tokens[notifyUser]) {
              await send(notifyUser, result.text || "（无输出）");
            } else {
              info(`计划 ${spec.id} 完成，无 context_token，不推微信`);
            }
          } catch (err) {
            if (err instanceof AgentCancelled) {
              info(`计划 ${spec.id} 已取消`);
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            logError(`计划 ${spec.id} 失败`, message);
            if (notifyUser && tokens[notifyUser]) {
              await send(notifyUser, formatAgentError(message));
            }
          } finally {
            if (notifyUser) {
              stopHeartbeat(job);
              jobs.delete(notifyUser);
            }
          }
        } finally {
          scheduledRunning = false;
        }
      },
    });
  }

  for (const [userId, state] of Object.entries(drafts)) {
    const n = state.lines.length;
    if (n === 0) {
      continue;
    }
    info(`恢复草稿 ${userId} ${String(n)}条`);
  }

  let lastAliveAt = Date.now();

  for (;;) {
    let poll;
    try {
      poll = await pollUpdates(creds, updates.get_updates_buf, INBOX_DIR);
    } catch (err) {
      logError("getupdates 失败", err);
      await sleep(2_000);
      continue;
    }

    if (poll.sessionExpired) {
      warn("会话过期，重新扫码");
      try {
        unlinkSync(CREDENTIALS_PATH);
      } catch {
        // ignore
      }
      creds = await loginWithQr(CREDENTIALS_PATH);
      updates = { get_updates_buf: "" };
      writeJson(UPDATES_PATH, updates);
      continue;
    }

    if (poll.nextBuf !== updates.get_updates_buf) {
      updates = { get_updates_buf: poll.nextBuf };
      writeJson(UPDATES_PATH, updates);
    }

    if (Date.now() - lastAliveAt >= 10 * 60_000) {
      info(`存活 交互=${String(jobs.size)} 计划中=${scheduledRunning ? "是" : "否"}`);
      lastAliveAt = Date.now();
    }

    if (poll.messages.length > 0) {
      info(`入站 ${String(poll.messages.length)} 条`);
      lastAliveAt = Date.now();
    }

    const commands: typeof poll.messages = [];
    for (const msg of poll.messages) {
      if (msg.contextToken) {
        tokens[msg.fromUserId] = msg.contextToken;
        persistTokens();
      }

      if (!authorize(msg.fromUserId, config.allowFrom)) {
        warn(`入站拒绝 ${msg.fromUserId} 「${preview(msg.text)}」`);
        await send(msg.fromUserId, "未授权");
        continue;
      }

      const action = parseInbound(msg.text);
      if (action.type === "draft") {
        if (!action.text) {
          continue;
        }
        if ((drafts[msg.fromUserId]?.lines.length ?? 0) >= MAX_DRAFT_LINES) {
          warn(`草稿已满 ${msg.fromUserId}`);
          await send(msg.fromUserId, formatDraftFull(MAX_DRAFT_LINES));
          continue;
        }
        appendDraft(drafts, msg.fromUserId, action.text);
        persistDrafts();
        const n = drafts[msg.fromUserId]?.lines.length ?? 0;
        info(`草稿 ${msg.fromUserId} 第${String(n)}条 「${preview(action.text)}」`);
        continue;
      }
      commands.push(msg);
    }

    for (const msg of commands) {
      const action = parseInbound(msg.text);
      if (action.type === "close") {
        const cancelled = closeJob(msg.fromUserId);
        clearDraft(drafts, msg.fromUserId);
        const dropped = forgetUserSession(sessions, msg.fromUserId);
        const epoch = bumpEpoch(epochs, msg.fromUserId);
        persistDrafts();
        persistSessions();
        info(
          `关闭 ${msg.fromUserId} 取消任务=${cancelled ? "是" : "否"} 丢掉session=${dropped ?? "无"} epoch=${String(epoch)}`,
        );
        await send(msg.fromUserId, "已关闭");
        continue;
      }

      if (jobs.has(msg.fromUserId) || scheduledRunning) {
        info(`忙碌拒绝 ${msg.fromUserId}`);
        await send(msg.fromUserId, formatBusyHint());
        continue;
      }

      const body = peekDraft(drafts, msg.fromUserId);
      if (!body) {
        info(`空草稿发送 ${msg.fromUserId}`);
        await send(msg.fromUserId, formatEmptyDraftHint());
        continue;
      }

      info(`提交 ${msg.fromUserId} ${String(body.length)}字（成功前保留草稿）`);
      await send(msg.fromUserId, "执行中");
      if (msg.contextToken) {
        void sendTyping(creds, msg.fromUserId, msg.contextToken);
      }

      const startedEpoch = currentEpoch(epochs, msg.fromUserId);
      const run = startAgent({
        agentPath,
        workspace: config.workspace,
        model: config.cursorModel,
        sessionId: sessions[msg.fromUserId]?.sessionId,
        userText: body,
        addDirs: [INBOX_DIR],
      });

      const job: Job = { cancel: run.cancel, timers: [] };
      jobs.set(msg.fromUserId, job);

      void run.done
        .then(async (result) => {
          stopHeartbeat(job);
          jobs.delete(msg.fromUserId);
          if (!sameEpoch(epochs, msg.fromUserId, startedEpoch)) {
            info(`已关闭，丢弃结果 ${msg.fromUserId}`);
            return;
          }
          if (result.sessionId) {
            sessions[msg.fromUserId] = { sessionId: result.sessionId };
            persistSessions();
          }
          flushDraft(drafts, msg.fromUserId);
          persistDrafts();
          await send(msg.fromUserId, result.text || "（无输出）");
        })
        .catch(async (err: unknown) => {
          stopHeartbeat(job);
          jobs.delete(msg.fromUserId);
          if (err instanceof AgentCancelled) {
            info(`交互已取消 ${msg.fromUserId}`);
            return;
          }
          if (!sameEpoch(epochs, msg.fromUserId, startedEpoch)) {
            info(`已关闭，丢弃失败结果 ${msg.fromUserId}`);
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          logError(`交互失败 ${msg.fromUserId}，草稿仍保留`, message);
          await send(
            msg.fromUserId,
            `${formatAgentError(message)} ${formatDraftStillHeld()}`,
          );
        });
    }
  }
}

main().catch((err: unknown) => {
  logError("进程退出", err);
  process.exit(1);
});
