export type SessionMap = Record<string, { sessionId: string }>;

/**
 * Drop the WeChat user's Cursor session. Returns the id that was stored.
 */
export function forgetUserSession(sessions: SessionMap, userId: string): string | undefined {
  const old = sessions[userId]?.sessionId;
  delete sessions[userId];
  return old;
}

/**
 * Bump after close so a late agent `.then` cannot write the old session back.
 */
export function bumpEpoch(epochs: Map<string, number>, userId: string): number {
  const next = (epochs.get(userId) ?? 0) + 1;
  epochs.set(userId, next);
  return next;
}

export function currentEpoch(epochs: Map<string, number>, userId: string): number {
  return epochs.get(userId) ?? 0;
}

export function sameEpoch(
  epochs: Map<string, number>,
  userId: string,
  started: number,
): boolean {
  return currentEpoch(epochs, userId) === started;
}
