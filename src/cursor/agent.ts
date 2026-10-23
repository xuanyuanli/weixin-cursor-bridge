import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { defaultAgentCandidates } from "../config.js";
import { buildPrompt } from "./prompt.js";

export type AgentRun = {
  child: ChildProcess;
  done: Promise<AgentResult>;
  cancel: () => void;
};

export type AgentResult = {
  text: string;
  sessionId?: string;
  killed: boolean;
};

export class AgentCancelled extends Error {
  constructor() {
    super("agent cancelled");
    this.name = "AgentCancelled";
  }
}

/**
 * Resolve the Cursor CLI executable.
 */
export function resolveAgentPath(explicit: string): string {
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  for (const candidate of defaultAgentCandidates()) {
    if (candidate === "agent" || existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("找不到本机 Cursor agent CLI，请设置 CURSOR_CLI_PATH");
}

function spawnAgent(agentPath: string, args: string[], cwd: string): ChildProcess {
  const win = platform() === "win32";
  if (win && /\.(cmd|bat)$/i.test(agentPath)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", agentPath, ...args], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(agentPath, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Kill a spawned agent, including Windows process trees.
 */
export function killAgent(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  if (platform() === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 5_000);
}

function parseAgentJson(stdout: string): { result?: string; session_id?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }
  const lastBrace = trimmed.lastIndexOf("{");
  const candidate = lastBrace >= 0 ? trimmed.slice(lastBrace) : trimmed;
  try {
    return JSON.parse(candidate) as { result?: string; session_id?: string };
  } catch {
    return { result: trimmed };
  }
}

/**
 * Start a headless Cursor agent run. Caller must keep polling WeChat.
 */
export function startAgent(opts: {
  agentPath: string;
  workspace: string;
  model: string;
  sessionId?: string;
  userText: string;
}): AgentRun {
  const args = [
    "-p",
    "--force",
    "--trust",
    "--approve-mcps",
    "--workspace",
    opts.workspace,
    "--output-format",
    "json",
  ];
  if (opts.model && opts.model !== "auto") {
    args.push("--model", opts.model);
  }
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  }
  args.push(buildPrompt(opts.userText));

  const child = spawnAgent(opts.agentPath, args, opts.workspace);
  let stdout = "";
  let stderr = "";
  let killed = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const cancel = (): void => {
    killed = true;
    killAgent(child);
  };

  const done = new Promise<AgentResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (killed) {
        reject(new AgentCancelled());
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `agent exited ${String(code)}`));
        return;
      }
      const parsed = parseAgentJson(stdout);
      resolve({
        text: parsed.result ?? stdout.trim(),
        sessionId: parsed.session_id,
        killed: false,
      });
    });
  });

  return { child, done, cancel };
}
