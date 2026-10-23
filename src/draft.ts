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
 * Take and clear the sender's draft. Lines are joined with blank lines.
 */
export function flushDraft(map: DraftMap, sender: string): string {
  const current = map[sender] ?? empty();
  delete map[sender];
  return current.lines.join("\n\n").trim();
}

/**
 * Drop the sender's draft without sending.
 */
export function clearDraft(map: DraftMap, sender: string): void {
  delete map[sender];
}

export function draftStats(state: DraftState | undefined): { lines: number; chars: number } {
  const lines = state?.lines ?? [];
  return {
    lines: lines.length,
    chars: lines.join("\n\n").length,
  };
}
