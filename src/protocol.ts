/** Two ideographic full stops: send the current draft. */
export const SEND_MARK = "\u3002\u3002";

/** Two ideographic full stops + ideographic comma: close the current agent. */
export const CLOSE_MARK = "\u3002\u3002\uFF0C";

export type ProtocolAction =
  | { type: "send" }
  | { type: "close" }
  | { type: "draft"; text: string };

/**
 * Classify one inbound WeChat text. Only an exact trimmed send/close mark
 * is a command; everything else (including `。。选2` and `。。。`) is draft.
 */
export function parseInbound(raw: string): ProtocolAction {
  const text = raw.trim();
  if (text === SEND_MARK) {
    return { type: "send" };
  }
  if (text === CLOSE_MARK) {
    return { type: "close" };
  }
  return { type: "draft", text };
}
