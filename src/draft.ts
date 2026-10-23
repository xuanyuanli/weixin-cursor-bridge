/** Max WeChat messages kept in one draft before send/close. */
export const MAX_DRAFT_LINES = 100;

export type DraftState = {
  lines: string[];
};

export type DraftMap = Record<string, DraftState>;

function empty(): DraftState {
  return { lines: [] };
}

/**
 * Append one inbound line to the sender's draft.
 */
export function appendDraft(map: DraftMap, sender: string, text: string): DraftState {
  const current = map[sender] ?? empty();
  if (!text) {
    return current;
  }
  const next = { lines: [...current.lines, text] };
  map[sender] = next;
  return next;
}

/**
 * Read the sender's draft without clearing it.
 */
export function peekDraft(map: DraftMap, sender: string): string {
  return (map[sender]?.lines ?? []).join("\n\n").trim();
}

/**
 * Take and clear the sender's draft. Lines are joined with blank lines.
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
 * Whether the sender has unsent draft lines.
 */
export function hasDraft(map: DraftMap, sender: string): boolean {
  return (map[sender]?.lines.length ?? 0) > 0;
}

export function draftStats(state: DraftState | undefined): { lines: number; chars: number } {
  const lines = state?.lines ?? [];
  return {
    lines: lines.length,
    chars: lines.join("\n\n").length,
  };
}
