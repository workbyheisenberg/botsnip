import { formatEther, formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import {
  curveAbi,
  erc20Abi,
  gasOverrides,
  makeWalletClient,
  publicClient,
  tokenAbi,
  type GasOverrides,
} from "./chain.js";
import { decryptSecret } from "./crypto.js";
import { wasPrearmed } from "./launchRegistry.js";
import { getDB, pushActivity, saveDB } from "./store.js";
import {
  quoteCurveBuy,
  readCurveCore,
  readSnipeTax,
  withSlippage,
  type CurveCore,
  type CurveState,
} from "./quote.js";
import { shortAddr } from "./util.js";
import type { BuyingWallet, Settings, WatchedWallet } from "./types.js";

export interface LaunchEvent {
  token: Address;
  curve: Address;
  deployer: Address;
  pairToken: Address;
  launchConfigId: bigint;
  graduationThreshold: bigint;
  blockNumber: bigint;
  txHash: string;
}

const inFlight = new Set<string>();

/**
 * Nonces we've already handed out this session. The shared batch reads the
 * chain's pending nonce, but if two launches arrive back-to-back we must not
 * reuse one — so we layer our own counter on top of the chain value.
 */
const localNonce = new Map<string, number>();

function reserveNonce(address: string, chainNonce: number, count: number): number {
  const key = address.toLowerCase();
  const local = localNonce.get(key);
  const start = local !== undefined && local > chainNonce ? local : chainNonce;
  localNonce.set(key, start + count);
  return start;
}

/**
 * Reacts to a launch event: if the deployer is one of our watched wallets,
 * take a position with every enabled buying wallet (bundling across the
 * per-wallet 5% launch cap).
 */
export async function handleLaunch(
  event: LaunchEvent,
  opts: { allowTrade?: boolean } = {},
): Promise<void> {
  const allowTrade = opts.allowTrade !== false;
  const db = getDB();
  db.stats.launchesSeen += 1;
  saveDB();

  const watched = db.watched.find(
    (w) => w.enabled && w.address.toLowerCase() === event.deployer.toLowerCase(),
  );
  const watchAll = db.settings.watchAllLaunches;

  if (!watched && !watchAll) return;

  if (watched) {
    db.stats.matches += 1;
    saveDB();
  }

  const symbol = await readSymbol(event.token);
  const label = `${symbol ?? "token"} · ${shortAddr(event.token)}`;

  pushActivity({
    kind: "launch",
    level: watched ? "success" : "info",
    title: watched
      ? `Launch detected from ${watched.label || shortAddr(watched.address)}`
      : `Launch detected — ${symbol ?? shortAddr(event.token)}`,
    detail: watched
      ? `${label} — curve ${shortAddr(event.curve)}`
      : `deployer ${shortAddr(event.deployer)} · curve ${shortAddr(event.curve)}`,
    token: event.token,
    tokenSymbol: symbol,
    deployer: event.deployer,
    curve: event.curve,
    txHash: event.txHash,
  });

  // Larper already pre-armed this launch's buys from the Launch screen, so the
  // watcher must not buy a second time when the same event arrives.
  if (wasPrearmed(event.token)) {
    pushActivity({
      kind: "info",
      level: "info",
      title: "Skipped — already covered by pre-armed buys",
      detail: `${label} · no second buy`,
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
    });
    return;
  }

  // Watch-all is monitoring/notifications only — never trade on arbitrary launches.
  if (!watched) return;
  // Replays / detection-only scans must never send transactions.
  if (!allowTrade) return;

  if (inFlight.has(event.token.toLowerCase())) return;
  inFlight.add(event.token.toLowerCase());
  try {
    await reaction(event, symbol, watched);
  } finally {
    setTimeout(() => inFlight.delete(event.token.toLowerCase()), 90_000);
  }
}

async function reaction(
  event: LaunchEvent,
  symbol: string | undefined,
  _watched: WatchedWallet,
): Promise<void> {
  const db = getDB();
  const { settings } = db;

  if (!settings.autoBuyEnabled) {
    pushActivity({
      kind: "info",
      level: "info",
      title: "Auto-buy is OFF — detection only",
      detail: "Enable auto-buy in Settings to take a position automatically.",
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
    });
    return;
  }

  const buyers = db.buying.filter((b) => b.enabled && b.encryptedKey);
  if (buyers.length === 0) {
    pushActivity({
      kind: "error",
      level: "error",
      title: "No buying wallet configured",
      detail: "Add an enabled buying wallet with a key in Wallets.",
      token: event.token,
      tokenSymbol: symbol,
    });
    return;
  }

  pushActivity({
    kind: "info",
    level: "info",
    title: `Sniping with ${buyers.length} wallet${buyers.length > 1 ? "s" : ""}`,
    detail: buyers.map((b) => b.label || shortAddr(b.address)).join(", "),
    token: event.token,
    tokenSymbol: symbol,
    curve: event.curve,
  });

  // ── Shared work, done ONCE regardless of wallet count ────────────────────
  // Everything the send path needs is fetched in the SAME tick: curve, snipe
  // tax, gas/fees, each wallet's balance AND each wallet's nonce. viem merges
  // them into one HTTP request, so the buy path is then:
  //     [1 read hop] → sign (local) → [1 broadcast hop]
  // instead of the old reads → balance → nonce → broadcast (4 round trips).
  const walletAddrs = buyers.map((b) => b.address as Address);
  const nativeQuote = event.pairToken.toLowerCase() === zeroAddress;

  let core: CurveCore;
  let taxes: bigint[];
  let overrides: GasOverrides;
  let balances: bigint[];
  let nonces: number[];
  try {
    const [c, t, ov, bal, non] = await Promise.all([
      readCurveCore(publicClient, event.curve),
      Promise.all(walletAddrs.map((a) => readSnipeTax(publicClient, event.curve, a))),
      settings.mode === "live"
        ? gasOverrides().catch(() => ({}) as GasOverrides)
        : Promise.resolve({} as GasOverrides),
      Promise.all(
        walletAddrs.map((a) =>
          nativeQuote
            ? publicClient.getBalance({ address: a })
            : (publicClient.readContract({
                address: event.pairToken,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [a],
              }) as Promise<bigint>),
        ),
      ),
      settings.mode === "live"
        ? Promise.all(
            walletAddrs.map((a) =>
              publicClient.getTransactionCount({ address: a, blockTag: "pending" }),
            ),
          )
        : Promise.resolve(walletAddrs.map(() => 0)),
    ]);
    core = c;
    taxes = t;
    overrides = ov;
    balances = bal;
    nonces = non;
  } catch (err) {
    pushActivity({
      kind: "error",
      level: "error",
      title: "Failed to read curve",
      detail: msg(err),
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
    });
    return;
  }

  // If any wallet isn't exempt, wait out the opening tax ONCE for all wallets.
  // Polling inside each wallet multiplied the reads and stretched the exit.
  const limit = BigInt(settings.maxSnipeTaxBps);
  if (settings.mode === "live" && taxes.some((t) => t > limit)) {
    taxes = await waitForSnipeTax(event.curve, walletAddrs, limit);
  }

  await Promise.allSettled(
    buyers.map((buyer, i) =>
      buyOne(
        event,
        symbol,
        buyer,
        settings,
        core,
        overrides,
        taxes[i] ?? 0n,
        balances[i] ?? 0n,
        nonces[i] ?? 0,
      ),
    ),
  );
}

/**
 * The opening snipe tax decays from 99% to 0 over ~5s. If any recipient is
 * above our limit we poll the tax ONCE for the whole wallet set (a single
 * batched read per round) until they are all acceptable or we time out.
 */
async function waitForSnipeTax(
  curve: Address,
  recipients: Address[],
  limit: bigint,
): Promise<bigint[]> {
  let taxes = await Promise.all(recipients.map((r) => readSnipeTax(publicClient, curve, r)));
  if (taxes.every((t) => t <= limit)) return taxes;

  const waitUntil = Date.now() + 5_000;
  while (taxes.some((t) => t > limit) && Date.now() < waitUntil) {
    await sleep(150);
    try {
      taxes = await Promise.all(recipients.map((r) => readSnipeTax(publicClient, curve, r)));
    } catch {
      break;
    }
  }
  return taxes;
}

async function buyOne(
  event: LaunchEvent,
  symbol: string | undefined,
  buyer: BuyingWallet,
  settings: Settings,
  core: CurveCore,
  overrides: GasOverrides,
  snipeTaxBps: bigint,
  prefetchedBalance: bigint,
  prefetchedNonce: number,
): Promise<void> {
  const db = getDB();
  const recipient = buyer.address as Address;
  const who = buyer.label || shortAddr(buyer.address);

  if (core.readyToGraduate || core.graduated) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Skipped (${who}) — curve already closed`,
      detail: "Launch graduated before the buy could be placed.",
      token: event.token,
      tokenSymbol: symbol,
    });
    return;
  }

  const native = core.isNativeQuote;

  if (!native && settings.nativePairOnly) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Skipped (${who}) — non-ETH pairing`,
      detail: `Paired against ${core.pairToken}. Turn OFF "Native ETH pairs only" in Settings to buy token-paired launches.`,
      token: event.token,
      tokenSymbol: symbol,
    });
    return;
  }

  // How much to spend, in the launch's own quote asset.
  let spend = 0n;
  let decimals = 18;
  let assetLabel = "ETH";
  if (native) {
    spend = safeParseUnits(buyer.amountEth, 18);
  } else {
    // Pair-token metadata never changes, so it is cached across launches.
    const meta = await readPairMeta(core.pairToken);
    decimals = meta.decimals;
    assetLabel = meta.symbol ?? "pair token";
    spend = safeParseUnits(buyer.amountQuote, decimals);
  }

  if (spend <= 0n) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Skipped (${who}) — no amount set`,
      detail: native
        ? "Set an ETH amount for this buying wallet."
        : `Set a ${assetLabel} amount for this buying wallet (this launch is paired against ${assetLabel}).`,
      token: event.token,
      tokenSymbol: symbol,
    });
    return;
  }

  // The snipe tax was read (and, if needed, waited out) for all wallets in the
  // shared step. Exempt wallets read 0, so the fast path gets zero extra calls.
  const state: CurveState = { ...core, snipeTaxBps };
  const quote = quoteCurveBuy(spend, state);
  const minOut = withSlippage(quote.tokensOut, settings.slippageBps);

  if (quote.appliedSnipeTaxBps > BigInt(settings.maxSnipeTaxBps)) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Buy REFUSED (${who}) — snipe tax too high`,
      detail:
        `${who} is not exempt on this launch (tax ≈ ${bpsToPct(quote.appliedSnipeTaxBps)}, limit ${bpsToPct(BigInt(settings.maxSnipeTaxBps))}). ` +
        `The opening tax decays to ~3% after 2s and 0 after 5s.`,
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
    });
    return;
  }

  if (settings.mode === "dry-run") {
    pushActivity({
      kind: "buy",
      level: "info",
      title: `DRY RUN (${who}) — would spend ${fmtAmount(spend, decimals)} ${assetLabel} → ${symbol ?? "token"}`,
      detail: `Min out ${fmtToken(minOut)} ${symbol ?? ""} · tax ${bpsToPct(quote.appliedSnipeTaxBps)}`.trim(),
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
      amountEth: native ? formatEther(spend) : undefined,
    });
    return;
  }

  await sendBuy(
    event,
    symbol,
    buyer,
    state,
    spend,
    decimals,
    assetLabel,
    minOut,
    overrides,
    prefetchedBalance,
    prefetchedNonce,
  );
}

async function sendBuy(
  event: LaunchEvent,
  symbol: string | undefined,
  buyer: BuyingWallet,
  state: CurveState,
  spend: bigint,
  decimals: number,
  assetLabel: string,
  minOut: bigint,
  overrides: GasOverrides,
  prefetchedBalance: bigint,
  prefetchedNonce: number,
): Promise<void> {
  const who = buyer.label || shortAddr(buyer.address);
  const recipient = buyer.address as Address;

  try {
    const privateKey = decryptSecret(buyer.encryptedKey) as `0x${string}`;
    const { wallet } = makeWalletClient(privateKey);
    const account = wallet.account!;

    // Balance and nonce came from the shared batch — there are no reads left
    // on this path, so the only remaining round trip is the broadcast itself.
    if (prefetchedBalance < spend) {
      pushActivity({
        kind: "skip",
        level: "warn",
        title: `Buy skipped (${who}) — underfunded`,
        detail: state.isNativeQuote
          ? `Balance ${formatEther(prefetchedBalance)} ETH is less than the ${formatEther(spend)} ETH buy.`
          : `Needs ${fmtAmount(spend, decimals)} ${assetLabel}, has ${fmtAmount(prefetchedBalance, decimals)}.`,
        token: event.token,
        tokenSymbol: symbol,
      });
      return;
    }

    if (state.isNativeQuote) {
      const nonce = reserveNonce(recipient, prefetchedNonce, 1);
      const hash = await wallet.writeContract({
        address: event.curve,
        abi: curveAbi,
        functionName: "buy",
        args: [spend, minOut, recipient],
        value: spend,
        nonce,
        ...overrides,
        account,
        chain: wallet.chain,
      });
      reportBuy(event, symbol, who, spend, decimals, assetLabel, minOut, hash);
      return;
    }

    // ── ERC-20 paired launch ──────────────────────────────────────────────
    // Approval is per-curve, and this curve was created seconds ago, so its
    // allowance is provably zero — no read needed. Send approve and buy
    // together with sequential nonces instead of awaiting the approve.
    const nonce = reserveNonce(recipient, prefetchedNonce, 2);

    const [approveHash, hash] = await Promise.all([
      wallet.writeContract({
        address: state.pairToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [event.curve, spend],
        nonce,
        ...overrides,
        account,
        chain: wallet.chain,
      }),
      wallet.writeContract({
        address: event.curve,
        abi: curveAbi,
        functionName: "buy",
        args: [spend, minOut, recipient],
        nonce: nonce + 1,
        ...overrides,
        account,
        chain: wallet.chain,
      }),
    ]);

    pushActivity({
      kind: "info",
      level: "info",
      title: `Approving ${assetLabel} (${who})`,
      detail: `Approve sent (${approveHash.slice(0, 10)}…) — buy sent back-to-back, no wait.`,
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
      txHash: approveHash,
    });

    reportBuy(event, symbol, who, spend, decimals, assetLabel, minOut, hash);
  } catch (err) {
    localNonce.delete(recipient.toLowerCase());
    pushActivity({
      kind: "error",
      level: "error",
      title: `Buy transaction failed (${who})`,
      detail: msg(err),
      token: event.token,
      tokenSymbol: symbol,
      curve: event.curve,
    });
  }
}

function reportBuy(
  event: LaunchEvent,
  symbol: string | undefined,
  who: string,
  spend: bigint,
  decimals: number,
  assetLabel: string,
  minOut: bigint,
  hash: string,
): void {
  const db = getDB();
  db.stats.buys += 1;
  saveDB();

  pushActivity({
    kind: "buy",
    level: "success",
    title: `BUY SENT (${who}) — ${fmtAmount(spend, decimals)} ${assetLabel} → ${symbol ?? "token"}`,
    detail: `Min out ${fmtToken(minOut)} · tx ${hash.slice(0, 12)}…`,
    token: event.token,
    tokenSymbol: symbol,
    curve: event.curve,
    txHash: hash,
    amountEth: assetLabel === "ETH" ? formatEther(spend) : undefined,
  });
}

async function readDecimals(token: Address): Promise<number> {
  try {
    const decimals = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "decimals",
    })) as number;
    return Number(decimals);
  } catch {
    return 18;
  }
}

async function readSymbol(token: Address): Promise<string | undefined> {
  try {
    return await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" });
  } catch {
    return undefined;
  }
}

/** Pair-token metadata (decimals/symbol) never changes — cache it per address. */
const pairMetaCache = new Map<string, { decimals: number; symbol?: string }>();

async function readPairMeta(token: Address): Promise<{ decimals: number; symbol?: string }> {
  const key = token.toLowerCase();
  const cached = pairMetaCache.get(key);
  if (cached) return cached;

  const [decimals, symbol] = await Promise.all([readDecimals(token), readSymbol(token)]);
  const meta = { decimals, symbol };
  pairMetaCache.set(key, meta);
  return meta;
}

function safeParseUnits(value: string, decimals: number): bigint {
  try {
    const parsed = parseUnits((value || "0").trim(), decimals);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function fmtToken(value: bigint): string {
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n) / 10n ** 14n;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(4, "0")}`;
}

function fmtAmount(value: bigint, decimals: number): string {
  const n = Number(formatUnits(value, decimals));
  if (!Number.isFinite(n)) return formatUnits(value, decimals);
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals > 8 ? 5 : 2 });
}

function bpsToPct(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msg(err: unknown): string {
  const raw = err instanceof Error ? err.message.split("\n")[0] : String(err);
  return raw.replace(/\/v2\/[A-Za-z0-9_\-]{8,}/g, "/v2/***").replace(/alch_[A-Za-z0-9_\-]{6,}/g, "alch_***");
}
