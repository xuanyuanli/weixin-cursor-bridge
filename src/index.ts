import { unlinkSync } from "node:fs";
import { AgentCancelled, resolveAgentPath, startAgent } from "./cursor/agent.js";
import {
  ALLOWLIST_PATH,
  CONTEXT_TOKENS_PATH,
  CREDENTIALS_PATH,
  DRAFTS_PATH,
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
  draftStats,
  flushDraft,
  hasDraft,
  type DraftMap,
} from "./draft.js";
import { CLOSE_MARK, parseInbound, SEND_MARK } from "./protocol.js";
import { chunkText, formatDraftAck, stripMarkdown } from "./reply.js";
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
const HEARTBEAT_FIRST_MS = 30_000;
const HEARTBEAT_EVERY_MS = 60_000;

type Job = {
  cancel: () => void;
  startedAt: number;
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
    console.log(`allowlist bound first sender ${sender}`);
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
    console.error(`no context_token for ${to}, skip send`);
    return;
  }
  const chunks = chunkText(stripMarkdown(text), maxChars);
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
      console.log("已清除登录凭证");
    } catch {
      console.log("没有已保存的凭证");
    }
    return;
  }

  const config = loadConfig();
  const agentPath = resolveAgentPath(config.cursorCliPath);

  const saved = readJson<Credentials | null>(CREDENTIALS_PATH, null);
  let creds: Credentials = saved?.botToken
    ? saved
    : await loginWithQr(CREDENTIALS_PATH);

  const allow = loadAllow(config.allowFrom);
  if (allow.length === 0 && creds.userId) {
    saveAllow([creds.userId]);
  }

  const drafts = readJson<DraftMap>(DRAFTS_PATH, {});
  const sessions = readJson<Sessions>(SESSIONS_PATH, {});
  const tokens = readJson<Tokens>(CONTEXT_TOKENS_PATH, {});
  let updates = readJson<{ get_updates_buf: string }>(UPDATES_PATH, {
    get_updates_buf: "",
  });

  console.log(`weixin-cursor-bridge 已启动 workspace=${config.workspace}`);
  console.log(`agent=${agentPath}`);

  const persistDrafts = (): void => writeJson(DRAFTS_PATH, drafts);
  const persistSessions = (): void => writeJson(SESSIONS_PATH, sessions);
  const persistTokens = (): void => writeJson(CONTEXT_TOKENS_PATH, tokens);

  const send = (to: string, text: string): Promise<void> =>
    reply(creds, to, tokens, text, config.wechatMaxChars);

  let scheduledRunning = false;
  const jobsFile = loadJobsFile(JOBS_PATH);
  if (!jobsFile) {
    console.log("无 jobs.yaml，仅交互");
  } else {
    console.log(`已加载 ${String(jobsFile.jobs.length)} 个计划任务`);
    startScheduler({
      file: jobsFile,
      canStart: () => jobs.size === 0 && !scheduledRunning,
      onSkip: (reason) => {
        console.log(`schedule skip: ${reason}`);
      },
      onDue: async (spec) => {
        scheduledRunning = true;
        const notifyUser = pickNotifyUser(jobsFile, tokens);
        const sessionKey = jobSessionKey(spec.id);
        console.log(`schedule fire ${spec.id} skill=${spec.skill}`);
        try {
          const run = startAgent({
            agentPath,
            workspace: config.workspace,
            model: config.cursorModel,
            sessionId: sessions[sessionKey]?.sessionId,
            userText: buildJobPrompt(spec),
          });
          const job: Job = { cancel: run.cancel, startedAt: Date.now(), timers: [] };
          if (notifyUser) {
            jobs.set(notifyUser, job);
            const beat = (): void => {
              const minutes = Math.max(1, Math.floor((Date.now() - job.startedAt) / 60_000));
              void send(notifyUser, `执行中 ${minutes} 分`);
            };
            job.timers.push(setTimeout(beat, HEARTBEAT_FIRST_MS));
            job.timers.push(setInterval(beat, HEARTBEAT_EVERY_MS));
          }
          try {
            const result = await run.done;
            if (result.sessionId) {
              sessions[sessionKey] = { sessionId: result.sessionId };
              if (notifyUser && !hasDraft(drafts, notifyUser)) {
                sessions[notifyUser] = { sessionId: result.sessionId };
              }
              persistSessions();
            }
            if (notifyUser && tokens[notifyUser]) {
              await send(notifyUser, result.text || "（无输出）");
            } else {
              console.log(`schedule ${spec.id} done, no context_token, skip push`);
            }
          } catch (err) {
            if (err instanceof AgentCancelled) {
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            if (notifyUser && tokens[notifyUser]) {
              await send(notifyUser, `失败：${message.slice(0, 400)}`);
            } else {
              console.error(`schedule ${spec.id} failed`, message);
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

  for (;;) {
    let poll;
    try {
      poll = await pollUpdates(creds, updates.get_updates_buf);
    } catch (err) {
      console.error("getupdates failed", err);
      await sleep(2_000);
      continue;
    }

    if (poll.sessionExpired) {
      console.error("session expired, need re-login");
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

    for (const msg of poll.messages) {
      if (msg.contextToken) {
        tokens[msg.fromUserId] = msg.contextToken;
        persistTokens();
      }

      if (!authorize(msg.fromUserId, config.allowFrom)) {
        await send(msg.fromUserId, "未授权");
        continue;
      }

      const action = parseInbound(msg.text);
      if (action.type === "draft") {
        if (!action.text) {
          continue;
        }
        const state = appendDraft(drafts, msg.fromUserId, action.text);
        persistDrafts();
        const stats = draftStats(state);
        await send(msg.fromUserId, formatDraftAck(stats.lines, stats.chars));
        continue;
      }

      if (action.type === "close") {
        closeJob(msg.fromUserId);
        clearDraft(drafts, msg.fromUserId);
        delete sessions[msg.fromUserId];
        persistDrafts();
        persistSessions();
        await send(msg.fromUserId, "已关闭");
        continue;
      }

      if (jobs.has(msg.fromUserId) || scheduledRunning) {
        await send(msg.fromUserId, `执行中，先 ${CLOSE_MARK} 关闭`);
        continue;
      }

      const body = flushDraft(drafts, msg.fromUserId);
      persistDrafts();
      if (!body) {
        await send(msg.fromUserId, `草稿为空，先发内容再 ${SEND_MARK}`);
        continue;
      }

      await send(msg.fromUserId, "已提交，执行中");
      if (msg.contextToken) {
        void sendTyping(creds, msg.fromUserId, msg.contextToken);
      }

      const run = startAgent({
        agentPath,
        workspace: config.workspace,
        model: config.cursorModel,
        sessionId: sessions[msg.fromUserId]?.sessionId,
        userText: body,
      });

      const job: Job = { cancel: run.cancel, startedAt: Date.now(), timers: [] };
      jobs.set(msg.fromUserId, job);

      const beat = (): void => {
        const minutes = Math.max(1, Math.floor((Date.now() - job.startedAt) / 60_000));
        void send(msg.fromUserId, `执行中 ${minutes} 分`);
      };
      job.timers.push(setTimeout(beat, HEARTBEAT_FIRST_MS));
      job.timers.push(setInterval(beat, HEARTBEAT_EVERY_MS));

      void run.done
        .then(async (result) => {
          stopHeartbeat(job);
          jobs.delete(msg.fromUserId);
          if (result.sessionId) {
            sessions[msg.fromUserId] = { sessionId: result.sessionId };
            persistSessions();
          }
          await send(msg.fromUserId, result.text || "（无输出）");
        })
        .catch(async (err: unknown) => {
          stopHeartbeat(job);
          jobs.delete(msg.fromUserId);
          if (err instanceof AgentCancelled) {
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          await send(msg.fromUserId, `失败：${message.slice(0, 400)}`);
        });
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
