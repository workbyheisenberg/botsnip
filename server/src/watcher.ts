import { PONS, publicClient, tokenLaunchedEvent } from "./chain.js";
import { config } from "./config.js";
import { getDB, saveDB } from "./store.js";
import { handleLaunch, type LaunchEvent } from "./trader.js";

interface Health {
  running: boolean;
  connected: boolean;
  head: string;
  scanned: string;
  lastError: string | null;
  lastPollAt: number;
  launchesSeen: number;
}

const health: Health = {
  running: false,
  connected: false,
  head: "0",
  scanned: "0",
  lastError: null,
  lastPollAt: 0,
  launchesSeen: 0,
};

let stopRequested = false;
let loopPromise: Promise<void> | null = null;
let lastBlock = 0n;

export function watcherStatus(): Health {
  return { ...health };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWatcher(): Promise<void> {
  if (health.running) return;
  stopRequested = false;
  health.running = true;

  const db = getDB();
  const head = await safeHead();
  if (db.lastBlock) {
    lastBlock = BigInt(db.lastBlock);
    // Do not try to backfill enormous ranges on startup.
    const minStart = head > BigInt(config.startLookbackBlocks) ? head - BigInt(config.startLookbackBlocks) : 0n;
    if (lastBlock < minStart) lastBlock = minStart;
  } else {
    lastBlock = head > BigInt(config.startLookbackBlocks) ? head - BigInt(config.startLookbackBlocks) : 0n;
  }
  health.scanned = lastBlock.toString();
  db.lastBlock = lastBlock.toString();
  saveDB();

  loopPromise = loop();
}

export async function stopWatcher(): Promise<void> {
  stopRequested = true;
  health.running = false;
  if (loopPromise) await loopPromise.catch(() => {});
  loopPromise = null;
}

/**
 * One-off scan used by the "Scan now" and "Replay range" controls.
 * - No range given: scans recent blocks like the live watcher (trading allowed).
 * - A range given: replays those blocks for DETECTION ONLY (never trades).
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

async function loop(): Promise<void> {
  while (!stopRequested) {
    const started = Date.now();
    try {
      const head = await publicClient.getBlockNumber();
      health.connected = true;
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
    const wait = Math.max(250, config.pollIntervalMs - elapsed);
    await sleep(wait);
  }
}

async function scanRange(
  from: bigint,
  to: bigint,
  opts: { detectOnly: boolean; trackCursor: boolean },
): Promise<number> {
  const chunk = BigInt(config.logChunkSize);
  let cursor = from;
  let found = 0;

  while (cursor <= to) {
    const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;
    const logs = await publicClient.getLogs({
      address: PONS.factory,
      event: tokenLaunchedEvent,
      fromBlock: cursor,
      toBlock: end,
    });

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

async function safeHead(): Promise<bigint> {
  try {
    return await publicClient.getBlockNumber();
  } catch {
    return 0n;
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0];
  return String(err);
}
