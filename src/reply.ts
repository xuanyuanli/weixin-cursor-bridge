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

export function formatDraftAck(lines: number, chars: number): string {
  return `草稿 ${lines} 条 / ${chars} 字。发送。。  关闭。。，`;
}
