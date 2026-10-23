/**
 * Flatten Markdown into WeChat-readable plain text.
 */
export function stripMarkdown(input: string): string {
  let text = input.replace(/\r\n/g, "\n");
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code: string) => {
    return code.replace(/\n+$/, "");
  });
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/^[-*]\s+/gm, "· ");
  text = text.replace(/^\d+\.\s+/gm, (m) => m);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split text into chunks at or below `maxChars`, preferring paragraph / line breaks.
 */
export function chunkText(input: string, maxChars: number): string[] {
  const text = input.trim();
  if (!text) {
    return [];
  }
  if (text.length <= maxChars) {
    return [text];
  }

  const labelReserve = 12;
  const bodyMax = Math.max(32, maxChars - labelReserve);
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > bodyMax) {
    const window = rest.slice(0, bodyMax);
    let cut = window.lastIndexOf("\n\n");
    if (cut < bodyMax * 0.4) {
      cut = window.lastIndexOf("\n");
    }
    if (cut < bodyMax * 0.4) {
      cut = window.lastIndexOf("。");
      if (cut >= 0) {
        cut += 1;
      }
    }
    if (cut < bodyMax * 0.4) {
      cut = bodyMax;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    chunks.push(rest);
  }

  if (chunks.length === 1) {
    return chunks;
  }
  const total = chunks.length;
  return chunks.map((c, i) => {
    const labeled = `【${i + 1}/${total}】\n${c}`;
    return labeled.length <= maxChars ? labeled : labeled.slice(0, maxChars);
  });
}

const HINT_SEND = "发送：单独发两个句号（。。 或 ..）";
const HINT_CLOSE = "关闭：两个句号加逗号（。。， 或 ..,）";

export function formatDraftFull(maxLines: number): string {
  return `草稿已满（${maxLines} 条），请先发送或关闭。${HINT_SEND}。${HINT_CLOSE}`;
}

/**
 * CLI 模型不存在时不要把 Available models 整表回微信。
 */
export function formatAgentError(raw: string): string {
  const model = /Cannot use this model:\s*([A-Za-z0-9._-]+)/i.exec(raw)?.[1];
  if (model) {
    return `模型不可用：${model}。把 CURSOR_CLI_MODEL 改成本机 agent 支持的名字，或设为 auto。`;
  }
  const text = raw.replace(/\s+/g, " ").trim();
  return `失败：${text.slice(0, 200)}`;
}

export function formatBusyHint(): string {
  return "正在执行。要打断请单独发两个句号加逗号（。。， 或 ..,）";
}

export function formatEmptyDraftHint(): string {
  return "还没有收到要发送的话。先发文字，再单独发两个句号。";
}

export function formatDraftStillHeld(): string {
  return "草稿还在，再发两个句号可重试。";
}

export function formatDraftResumeHint(lines: number): string {
  return `重启后草稿还在（${String(lines)} 条）。${HINT_SEND}。${HINT_CLOSE}`;
}
