/** Max WeChat messages kept in one draft before send/close. */
export const MAX_DRAFT_LINES = 100;

export type DraftPart =
  | { type: "text"; text: string }
  | { type: "image"; path: string };

export type DraftState = {
  parts: DraftPart[];
};

export type DraftMap = Record<string, DraftState>;

function empty(): DraftState {
  return { parts: [] };
}

function isPart(value: unknown): value is DraftPart {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (rec.type === "text" && typeof rec.text === "string" && rec.text) {
    return true;
  }
  return rec.type === "image" && typeof rec.path === "string" && Boolean(rec.path);
}

/**
 * Accept `{ parts }` or the older `{ lines, images }` on disk.
 */
export function normalizeDraft(state: unknown): DraftState {
  if (!state || typeof state !== "object") {
    return empty();
  }
  const rec = state as Record<string, unknown>;
  if (Array.isArray(rec.parts)) {
    return { parts: rec.parts.filter(isPart) };
  }
  const lines = Array.isArray(rec.lines) ? rec.lines : [];
  const images = Array.isArray(rec.images) ? rec.images : [];
  const parts: DraftPart[] = [];
  for (const line of lines) {
    if (typeof line === "string" && line) {
      parts.push({ type: "text", text: line });
    }
  }
  for (const path of images) {
    if (typeof path === "string" && path) {
      parts.push({ type: "image", path });
    }
  }
  return { parts };
}

function current(map: DraftMap, sender: string): DraftState {
  return normalizeDraft(map[sender]);
}

export function draftSize(state: DraftState | undefined): number {
  return normalizeDraft(state).parts.length;
}

/**
 * Append one inbound line to the sender's draft.
 */
export function appendDraft(map: DraftMap, sender: string, text: string): DraftState {
  const next = current(map, sender);
  if (text) {
    next.parts.push({ type: "text", text });
  }
  map[sender] = next;
  return next;
}

/**
 * Append one saved inbound image path. Stays in arrival order with text.
 */
export function appendDraftImage(map: DraftMap, sender: string, path: string): DraftState {
  const next = current(map, sender);
  if (path) {
    next.parts.push({ type: "image", path });
  }
  map[sender] = next;
  return next;
}

function partText(part: DraftPart): string {
  return part.type === "text" ? part.text : part.path;
}

/**
 * All text and images, arrival order, one blob for a single agent run.
 */
export function peekDraft(map: DraftMap, sender: string): string {
  return current(map, sender).parts.map(partText).join("\n\n").trim();
}

/**
 * Take and clear the sender's draft.
 */
export function flushDraft(map: DraftMap, sender: string): string {
  const text = peekDraft(map, sender);
  delete map[sender];
  return text;
}

/**
 * Drop the sender's draft without sending.
 */
export function clearDraft(map: DraftMap, sender: string): void {
  delete map[sender];
}

/**
 * Whether the sender has unsent draft parts.
 */
export function hasDraft(map: DraftMap, sender: string): boolean {
  return draftSize(map[sender]) > 0;
}

export function draftStats(state: DraftState | undefined): { lines: number; chars: number } {
  const normalized = normalizeDraft(state);
  return {
    lines: normalized.parts.length,
    chars: normalized.parts.map(partText).join("\n\n").length,
  };
}
