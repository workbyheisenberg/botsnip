/**
 * Remembers launches that Larper already covered with pre-armed buys.
 *
 * When you launch from Larper's Launch screen, the buyers' transactions are
 * pre-signed and submitted behind the launch. The watcher will still see the
 * same `TokenLaunched` event a moment later, and without this guard it would
 * buy a second time with every enabled wallet.
 */
const prearmed = new Map<string, number>();

/** Long enough to cover detection + a stalled block, short enough to not leak. */
const TTL_MS = 120_000;

export function markPrearmed(token: string): void {
  prearmed.set(token.toLowerCase(), Date.now());
}

export function wasPrearmed(token: string): boolean {
  const key = token.toLowerCase();
  const at = prearmed.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > TTL_MS) {
    prearmed.delete(key);
    return false;
  }
  return true;
}
