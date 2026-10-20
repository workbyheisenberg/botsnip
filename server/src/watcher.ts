import { decodeEventLog } from "viem";
import {
  ensureBatchSupport,
  factoryAbi,
  PONS,
  publicClient,
  rebuildClients,
  tokenLaunchedEvent,
  wsClient,
} from "./chain.js";
import { config } from "./config.js";
import { getDB, pushActivity, saveDB } from "./store.js";
import { handleLaunch, type LaunchEvent } from "./trader.js";
import { redactSecrets } from "./util.js";

type TransportKind = "websocket" | "polling" | "idle";

interface Health {
  running: boolean;
  /** True when there is something to watch (a watched wallet or watch-all). */
  watching: boolean;
  connected: boolean;
  transport: TransportKind;
  /** True when launches arrive via a filtered push stream (best case). */
  logsPush: boolean;
  head: string;
  scanned: string;
  lastError: string | null;
  lastPollAt: number;
  launchesSeen: number;
  /** Raw log messages received on the push feed. */
  pushed: number;
  /** Push messages that decoded as a TokenLaunched event. */
  decoded: number;
}

const health: Health = {
  running: false,
  watching: false,
  connected: false,
  transport: "idle",
  logsPush: false,
  head: "0",
  scanned: "0",
  lastError: null,
  lastPollAt: 0,
  launchesSeen: 0,
  pushed: 0,
  decoded: 0,
};

let stopRequested = false;
let loopPromise: Promise<void> | null = null;
let headUnsubscribe: (() => void) | null = null;
let logsUnsubscribe: (() => void) | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastBlock = 0n;
/** True when the push feed delivers launch logs directly (best case). */
let logsLive = false;
/** Shrunk automatically when an RPC caps the eth_getLogs block range. */
let chunkOverride: bigint | null = null;

/** TokenLaunched(address,address,address,address,uint256,uint256) — topic0. */
const TOKEN_LAUNCHED_TOPIC =
  "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";

export function watcherStatus(): Health {
  return { ...health };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWatcher(): Promise<void> {
  if (health.running) return;

  // Nothing to watch? Don't open a socket at all. With pre-armed buys on the
  // Launch screen a launch needs no watcher, so an empty watch list means the
  // watcher should cost exactly zero RPC/WebSocket traffic.
  const watching =
    getDB().watched.some((w) => w.enabled) || getDB().settings.watchAllLaunches;
  if (!watching) {
    health.running = false;
    health.watching = false;
    health.connected = false;
    health.transport = "idle";
    health.logsPush = false;
    health.lastError = null;
    return;
  }

  stopRequested = false;
  health.running = true;
  health.watching = true;

  rebuildClients();
  await ensureBatchSupport();
  rebuildClients();

  const db = getDB();
  const head = await safeHead();
  if (db.lastBlock) {
    lastBlock = BigInt(db.lastBlock);
    const minStart =
      head > BigInt(config.startLookbackBlocks) ? head - BigInt(config.startLookbackBlocks) : 0n;
    if (lastBlock < minStart) lastBlock = minStart;
  } else {
    lastBlock =
      head > BigInt(config.startLookbackBlocks) ? head - BigInt(config.startLookbackBlocks) : 0n;
  }
  health.scanned = lastBlock.toString();
  db.lastBlock = lastBlock.toString();
  saveDB();

  // Prefer the push feed when a WebSocket endpoint is configured.
  if (await startWsFeed()) {
    health.transport = "websocket";
    return;
  }

  health.transport = "polling";
  loopPromise = loop();
}

/** Tear down and restart (used when RPC/WebSocket settings change). */
export async function restartWatcher(): Promise<void> {
  await stopWatcher();
  await startWatcher();
}

export async function stopWatcher(): Promise<void> {
  stopRequested = true;
  health.running = false;
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (headUnsubscribe) {
    try {
      headUnsubscribe();
    } catch {
      /* ignore */
    }
    headUnsubscribe = null;
  }
  if (logsUnsubscribe) {
    try {
      logsUnsubscribe();
    } catch {
      /* ignore */
    }
    logsUnsubscribe = null;
  }
  logsLive = false;
  health.logsPush = false;
  pendingBlocks.clear();
  if (loopPromise) await loopPromise.catch(() => {});
  loopPromise = null;
  health.transport = "idle";
  health.connected = false;
}

// ── WebSocket push feed ──────────────────────────────────────────────────

async function startWsFeed(): Promise<boolean> {
  const client = wsClient as unknown as {
    transport?: {
      subscribe?: (args: {
        params: unknown[];
        onData: (data: unknown) => void;
        onError?: (err: unknown) => void;
      }) => Promise<{ subscriptionId?: string; unsubscribe?: () => void }>;
    };
  } | null;
  const transport = client?.transport;
  if (!transport || typeof transport.subscribe !== "function") return false;

  try {
    // 1) Block heartbeat: keeps the head fresh and proves the socket is alive.
    const headRes = await transport.subscribe({
      params: ["newHeads"],
      onData: (data: unknown) => {
        health.lastPollAt = Date.now();
        health.connected = true;
        const number = (data as { result?: { number?: string } })?.result?.number;
        if (typeof number === "string") {
          try {
            const bn = BigInt(number);
            health.head = bn.toString();
            if (logsLive) {
              // With a direct logs stream we're never "behind" — the push feed
              // IS the cursor.
              health.scanned = bn.toString();
            } else {
              // Only fetch per-block when there is no direct logs stream.
              enqueueBlock(bn);
            }
          } catch {
            /* ignore */
          }
        }
      },
      onError: (err: unknown) => {
        health.connected = false;
        health.lastError = errMsg(err);
      },
    });
    headUnsubscribe = headRes?.unsubscribe ?? null;

    // 2) Primary detector: the node pushes ONLY our wallets' TokenLaunched
    //    events (filtered by the deployer topic). We never scan the market.
    try {
      const logsRes = await transport.subscribe({
        params: ["logs", logsFilter()],
        onData: (data: unknown) => {
          health.lastPollAt = Date.now();
          health.connected = true;
          health.pushed += 1;
          const log = (data as { result?: RawPushedLog })?.result;
          if (log) onPushedLog(log);
        },
        onError: (err: unknown) => {
          health.connected = false;
          health.lastError = errMsg(err);
        },
      });
      logsUnsubscribe = logsRes?.unsubscribe ?? null;
      logsLive = true;
    } catch (err) {
      // Endpoint may not serve `logs` (e.g. free Blockmachine) — fall back to
      // fetching each block's logs off the heartbeat.
      logsLive = false;
      health.lastError = errMsg(err);
    }

    health.connected = true;
    if (logsLive) health.lastError = null;
    health.logsPush = logsLive;
    health.lastPollAt = Date.now();
    startWatchdog();
    return true;
  } catch (err) {
    health.lastError = errMsg(err);
    return false;
  }
}

function padTopic(address: string): string {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

/**
 * Log filter for the push feed. When we're not watching "all launches" and we
 * have wallets configured, we narrow it to those deployers — so the node only
 * wakes us for our own launches.
 */
function logsFilter(): { address: string; topics: Array<string | string[] | null> } {
  const db = getDB();
  const watched = db.watched.filter((w) => w.enabled).map((w) => padTopic(w.address));
  const watchEverything = db.settings.watchAllLaunches || watched.length === 0;
  const topics: Array<string | string[] | null> = [TOKEN_LAUNCHED_TOPIC];
  if (!watchEverything) topics.push(null, null, watched);
  return { address: PONS.factory, topics };
}

interface RawPushedLog {
  data?: `0x${string}`;
  topics?: [] | [`0x${string}`, ...`0x${string}`[]];
  blockNumber?: string;
  transactionHash?: string;
}

function onPushedLog(log: RawPushedLog): void {
  const event = decodeLaunch(log);
  if (!event) return;
  health.decoded += 1;
  if (!markSeen(event.txHash)) return;

  health.launchesSeen += 1;
  if (event.blockNumber > lastBlock) {
    lastBlock = event.blockNumber;
    health.scanned = lastBlock.toString();
    const db = getDB();
    db.lastBlock = lastBlock.toString();
    saveDB();
  }
  void handleLaunch(event, { allowTrade: true });
}

function decodeLaunch(log: RawPushedLog): LaunchEvent | null {
  if (!log.data || !log.topics) return null;
  try {
    const decoded = decodeEventLog({ abi: [tokenLaunchedEvent], data: log.data, topics: log.topics });
    if (decoded.eventName !== "TokenLaunched") return null;
    const a = decoded.args as unknown as {
      token: `0x${string}`;
      curve: `0x${string}`;
      deployer: `0x${string}`;
      pairToken: `0x${string}`;
      launchConfigId: bigint;
      graduationThreshold: bigint;
    };
    return {
      token: a.token,
      curve: a.curve,
      deployer: a.deployer,
      pairToken: a.pairToken,
      launchConfigId: a.launchConfigId,
      graduationThreshold: a.graduationThreshold,
      blockNumber: BigInt(log.blockNumber ?? 0),
      txHash: log.transactionHash ?? "",
    };
  } catch {
    return null;
  }
}

/** Dedupe repeated deliveries on the push path. */
const seenTx = new Map<string, number>();
function markSeen(hash: string): boolean {
  if (!hash) return true;
  const now = Date.now();
  if (seenTx.has(hash)) return false;
  seenTx.set(hash, now);
  if (seenTx.size > 800) {
    for (const [key, at] of seenTx) if (now - at > 600_000) seenTx.delete(key);
  }
  return true;
}

// Coalescing queue: blocks arrive ~10/s, we fetch their logs as fast as we
// can, merging any backlog into a single range request.
const pendingBlocks = new Set<bigint>();
let draining = false;

function enqueueBlock(bn: bigint): void {
  if (bn <= lastBlock) return;
  pendingBlocks.add(bn);
  void drain();
}

async function drain(): Promise<void> {
  if (draining || stopRequested) return;
  draining = true;
  try {
    while (pendingBlocks.size > 0 && !stopRequested) {
      // Always scan contiguously from our cursor. If a newHeads message was
      // dropped by the socket, scanning [min..max] of what we received would
      // silently skip blocks — so we never trust the queue's lower bound.
      let to = lastBlock;
      for (const bn of pendingBlocks) {
        if (bn > to) to = bn;
      }
      pendingBlocks.clear();

      if (to <= lastBlock) continue;
      await scanRange(lastBlock + 1n, to, { detectOnly: false, trackCursor: true });
    }
  } catch (err) {
    health.lastError = errMsg(err);
    console.error("[watcher] scan failed:", redactSecrets(err instanceof Error ? err.stack ?? err.message : String(err)));
  } finally {
    draining = false;
  }
}

function startWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (stopRequested) return;
    if (Date.now() - health.lastPollAt > 45_000) {
      health.connected = false;
      health.lastError = "Push feed went quiet — reconnecting";
      void resubscribe();
    }
  }, 15_000);
}

let resubscribing = false;

async function resubscribe(): Promise<void> {
  if (resubscribing || stopRequested) return;
  resubscribing = true;
  try {
    if (headUnsubscribe) {
      try {
        headUnsubscribe();
      } catch {
        /* ignore */
      }
      headUnsubscribe = null;
    }
    health.lastPollAt = Date.now();
    const ok = await startWsFeed();
    if (!ok) {
      health.transport = "polling";
      if (!loopPromise) loopPromise = loop();
    }
  } finally {
    resubscribing = false;
  }
}

// ── Polling fallback ─────────────────────────────────────────────────────

async function loop(): Promise<void> {
  while (!stopRequested) {
    const started = Date.now();
    try {
      const head = await publicClient.getBlockNumber();
      health.connected = true;
      health.transport = "polling";
      health.head = head.toString();
      health.lastError = null;
      health.lastPollAt = Date.now();

      if (head > lastBlock) {
        await scanRange(lastBlock + 1n, head, { detectOnly: false, trackCursor: true });
      }
    } catch (err) {
      health.connected = false;
      health.lastError = errMsg(err);
    }

    const elapsed = Date.now() - started;
    await sleep(Math.max(150, config.pollIntervalMs - elapsed));
  }
}

// ── One-off scans ────────────────────────────────────────────────────────

/**
 * Used by the "Scan now" and "Replay range" controls.
 * - No range: scans recent blocks like the live watcher (trading allowed).
 * - With a range: replays those blocks for DETECTION ONLY (never trades).
 */
export async function scanOnce(
  opts: { fromBlock?: string; toBlock?: string } = {},
): Promise<{ from: string; to: string; launches: number; detectionOnly: boolean }> {
  const head = await safeHead();

  if (opts.fromBlock) {
    const from = BigInt(opts.fromBlock);
    const to = opts.toBlock ? BigInt(opts.toBlock) : head;
    const count = await scanRange(from, to, { detectOnly: true, trackCursor: false });
    return { from: from.toString(), to: to.toString(), launches: count, detectionOnly: true };
  }

  const lookback = BigInt(Math.max(config.startLookbackBlocks, 20));
  const from = head > lookback ? head - lookback : 0n;
  const count = await scanRange(from, head, { detectOnly: false, trackCursor: true });
  return { from: from.toString(), to: head.toString(), launches: count, detectionOnly: false };
}

async function scanRange(
  from: bigint,
  to: bigint,
  opts: { detectOnly: boolean; trackCursor: boolean },
): Promise<number> {
  let cursor = from;
  let found = 0;

  while (cursor <= to) {
    // Recompute each pass: some RPCs (e.g. Alchemy Free) cap the block range
    // per eth_getLogs and we shrink `chunkOverride` on the fly.
    const chunk = chunkOverride ?? BigInt(config.logChunkSize);
    const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;

    let logs;
    try {
      logs = await publicClient.getLogs({
        address: PONS.factory,
        event: tokenLaunchedEvent,
        fromBlock: cursor,
        toBlock: end,
      });
    } catch (err) {
      const limit = detectRangeLimit(fullErrText(err));
      if (limit && (!chunkOverride || chunkOverride > limit)) {
        chunkOverride = limit;
        pushActivity({
          kind: "info",
          level: "warn",
          title: `RPC caps eth_getLogs to ${limit} blocks — adapting`,
          detail: "The watcher will fetch bigger ranges in smaller pieces. Backfill will be slower on this plan.",
        });
        continue; // retry the same cursor with a smaller range
      }
      throw err;
    }

    for (const log of logs) {
      const args = log.args as {
        token: `0x${string}`;
        curve: `0x${string}`;
        deployer: `0x${string}`;
        pairToken: `0x${string}`;
        launchConfigId: bigint;
        graduationThreshold: bigint;
      };
      if (!args?.token) continue;

      const event: LaunchEvent = {
        token: args.token,
        curve: args.curve,
        deployer: args.deployer,
        pairToken: args.pairToken,
        launchConfigId: args.launchConfigId,
        graduationThreshold: args.graduationThreshold,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? "",
      };

      found += 1;
      health.launchesSeen += 1;
      await handleLaunch(event, { allowTrade: !opts.detectOnly });
    }

    if (opts.trackCursor) {
      lastBlock = end;
      health.scanned = end.toString();
      const db = getDB();
      db.lastBlock = end.toString();
      saveDB();
    }

    cursor = end + 1n;
  }

  return found;
}

/** Parse "up to a N block range" / "up to N blocks" style limit errors. */
function detectRangeLimit(message: string): bigint | null {
  const match = /up to (?:a )?(\d+)\s*block/i.exec(message);
  if (!match) return null;
  const value = BigInt(match[1]);
  return value > 0n && value < 100_000n ? value : null;
}

/**
 * Walk the error + its causes and gather every message/detail field. viem puts
 * the useful text (e.g. the RPC's range limit) in `details`/`cause`, not in the
 * top-level message's first line.
 */
function fullErrText(err: unknown): string {
  const parts: string[] = [];
  let current = err as
    | { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown }
    | undefined;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    for (const field of ["message", "details", "shortMessage"] as const) {
      const value = current[field];
      if (typeof value === "string") parts.push(value);
    }
    current = current.cause as typeof current;
  }
  if (parts.length === 0) parts.push(String(err));
  return parts.join(" | ");
}

async function safeHead(): Promise<bigint> {
  try {
    return await publicClient.getBlockNumber();
  } catch {
    return 0n;
  }
}

function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message.split("\n")[0] : String(err);
  return redactSecrets(raw);
}
