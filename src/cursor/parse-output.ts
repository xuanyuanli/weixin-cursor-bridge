type AgentEnvelope = {
  type?: string;
  result?: unknown;
  session_id?: string;
};

function extractJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (c === "\\") {
          esc = true;
        } else if (c === "\"") {
          inStr = false;
        }
        continue;
      }
      if (c === "\"") {
        inStr = true;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(text.slice(i, j + 1)));
          } catch {
            // skip malformed slice
          }
          i = j + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) {
      break;
    }
  }
  return objects;
}

function asEnvelope(value: unknown): AgentEnvelope | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as AgentEnvelope;
}

/**
 * Cursor `--output-format json` prints one envelope. Do not take the last `{`
 * (that is usually `usage`). Never return the raw envelope as chat text.
 */
export function parseAgentOutput(stdout: string): { text: string; sessionId?: string } {
  const objects = extractJsonObjects(stdout);
  const hit =
    [...objects].reverse().find((item) => {
      const env = asEnvelope(item);
      return Boolean(env && (typeof env.result === "string" || env.type === "result"));
    }) ?? objects.at(-1);
  const env = asEnvelope(hit);
  const result = env && typeof env.result === "string" ? env.result.trim() : "";
  return {
    text: result,
    sessionId: env?.session_id,
  };
}
