/** Canonical Chinese send mark (two ideographic full stops). */
export const SEND_MARK = "\u3002\u3002";

/** Canonical Chinese close mark (two full stops + ideographic comma). */
export const CLOSE_MARK = "\u3002\u3002\uFF0C";

export type ProtocolAction =
  | { type: "send" }
  | { type: "close" }
  | { type: "draft"; text: string };

/**
 * Fold CJK / fullwidth period and comma into ASCII so `..` / `。。` match.
 */
export function normalizeMark(text: string): string {
  return text.replaceAll(/[\u3002\uFF0E]/g, ".").replaceAll("\uFF0C", ",");
}

/**
 * Classify one inbound WeChat text. Only an exact trimmed send/close mark
 * (CN or EN period/comma) is a command; `。。选2` and `。。。` stay draft.
 */
export function parseInbound(raw: string): ProtocolAction {
  const text = raw.trim();
  const mark = normalizeMark(text);
  if (mark === "..") {
    return { type: "send" };
  }
  if (mark === "..,") {
    return { type: "close" };
  }
  return { type: "draft", text };
}
