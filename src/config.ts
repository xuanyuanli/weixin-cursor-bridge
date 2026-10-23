import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Project root (parent of `src/` or `dist/`). */
export const PROJECT_ROOT = resolve(here, "..");

export const DATA_DIR = join(PROJECT_ROOT, "data");
export const CREDENTIALS_PATH = join(DATA_DIR, "credentials.json");
export const UPDATES_PATH = join(DATA_DIR, "updates.json");
export const CONTEXT_TOKENS_PATH = join(DATA_DIR, "context-tokens.json");
export const DRAFTS_PATH = join(DATA_DIR, "drafts.json");
export const SESSIONS_PATH = join(DATA_DIR, "sessions.json");
export const ALLOWLIST_PATH = join(DATA_DIR, "allowlist.json");
export const JOBS_PATH = join(PROJECT_ROOT, "jobs.yaml");

export type AppConfig = {
  allowFrom: string[];
  cursorCliPath: string;
  cursorModel: string;
  workspace: string;
  wechatMaxChars: number;
};

function loadDotEnv(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function splitIds(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Candidate paths for the local Cursor Agent CLI on this machine.
 */
export function defaultAgentCandidates(): string[] {
  const localApp = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return [
    join(localApp, "cursor-agent", "agent.cmd"),
    join(homedir(), "bin", "agent"),
    "agent",
  ];
}

/**
 * Load `.env` then resolve runtime config.
 */
export function loadConfig(): AppConfig {
  loadDotEnv(join(PROJECT_ROOT, ".env"));
  const workspace = (
    process.env.CURSOR_WORKSPACE ?? "d:\\workspace\\jinpai\\backend"
  ).trim();
  const max = Number(process.env.WECHAT_MAX_CHARS ?? "1800");
  return {
    allowFrom: splitIds(process.env.WEIXIN_ALLOW_FROM),
    cursorCliPath: (process.env.CURSOR_CLI_PATH ?? "").trim(),
    cursorModel: (process.env.CURSOR_CLI_MODEL ?? "auto").trim() || "auto",
    workspace,
    wechatMaxChars: Number.isFinite(max) && max > 0 ? Math.min(max, 1800) : 1800,
  };
}
