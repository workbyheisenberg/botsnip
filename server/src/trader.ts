import { formatEther, formatUnits, parseUnits, type Address } from "viem";
import {
  curveAbi,
  erc20Abi,
  gasOverrides,
  makeWalletClient,
  publicClient,
  tokenAbi,
} from "./chain.js";
import { decryptSecret } from "./crypto.js";
import { getDB, pushActivity, saveDB } from "./store.js";
import { quoteCurveBuy, readCurveState, withSlippage } from "./quote.js";
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

  await Promise.allSettled(buyers.map((buyer) => buyOne(event, symbol, buyer, settings)));
}

async function buyOne(
  event: LaunchEvent,
  symbol: string | undefined,
  buyer: BuyingWallet,
  settings: Settings,
): Promise<void> {
  const db = getDB();
  const recipient = buyer.address as Address;
  const who = buyer.label || shortAddr(buyer.address);

  let state;
  try {
    state = await readCurveState(publicClient, event.curve, recipient);
  } catch (err) {
    pushActivity({
      kind: "error",
      level: "error",
      title: `Failed to read curve (${who})`,
      detail: msg(err),
      token: event.token,
      tokenSymbol: symbol,
    });
    return;
  }

  if (state.readyToGraduate || state.graduated) {
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

  const native = state.isNativeQuote;

  if (!native && settings.nativePairOnly) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Skipped (${who}) — non-ETH pairing`,
      detail: `Paired against ${state.pairToken}. Turn OFF "Native ETH pairs only" in Settings to buy token-paired launches.`,
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
    decimals = await readDecimals(state.pairToken);
    assetLabel = (await readSymbol(state.pairToken)) ?? "pair token";
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

  const quote = quoteCurveBuy(spend, state);
  const minOut = withSlippage(quote.tokensOut, settings.slippageBps);

  if (quote.appliedSnipeTaxBps > BigInt(settings.maxSnipeTaxBps)) {
    db.stats.skipped += 1;
    saveDB();
    pushActivity({
      kind: "skip",
      level: "warn",
      title: `Buy REFUSED (${who}) — snipe tax would apply`,
      detail:
        `${who} is not exempt on this launch (tax ≈ ${bpsToPct(quote.appliedSnipeTaxBps)}). ` +
        `Raise "Max snipe tax tolerated" or add this wallet to the launch's exemption list.`,
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

  await sendBuy(event, symbol, buyer, state, spend, decimals, assetLabel, minOut);
}

async function sendBuy(
  event: LaunchEvent,
  symbol: string | undefined,
  buyer: BuyingWallet,
  state: Awaited<ReturnType<typeof readCurveState>>,
  spend: bigint,
  decimals: number,
  assetLabel: string,
  minOut: bigint,
): Promise<void> {
  const who = buyer.label || shortAddr(buyer.address);
  const recipient = buyer.address as Address;

  try {
    const privateKey = decryptSecret(buyer.encryptedKey) as `0x${string}`;
    const { wallet } = makeWalletClient(privateKey);
    const overrides = await gasOverrides();

    if (state.isNativeQuote) {
      const balance = await publicClient.getBalance({ address: recipient });
      if (balance < spend) {
        pushActivity({
          kind: "skip",
          level: "warn",
          title: `Buy skipped (${who}) — underfunded`,
          detail: `Balance ${formatEther(balance)} ETH is less than the ${formatEther(spend)} ETH buy.`,
          token: event.token,
          tokenSymbol: symbol,
        });
        return;
      }

      const hash = await wallet.writeContract({
        address: event.curve,
        abi: curveAbi,
        functionName: "buy",
        args: [spend, minOut, recipient],
        value: spend,
        ...overrides,
        account: wallet.account!,
        chain: wallet.chain,
      });
      reportBuy(event, symbol, who, spend, decimals, assetLabel, minOut, hash);
      return;
    }

    // ── ERC-20 paired launch ──────────────────────────────────────────────
    const balance = (await publicClient.readContract({
      address: state.pairToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [recipient],
    })) as bigint;
    if (balance < spend) {
      pushActivity({
        kind: "skip",
        level: "warn",
        title: `Buy skipped (${who}) — underfunded`,
        detail: `Needs ${fmtAmount(spend, decimals)} ${assetLabel}, has ${fmtAmount(balance, decimals)}.`,
        token: event.token,
        tokenSymbol: symbol,
      });
      return;
    }

    const allowance = (await publicClient.readContract({
      address: state.pairToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [recipient, event.curve],
    })) as bigint;

    if (allowance < spend) {
      // Approval is per-curve. Fire approve and buy back-to-back with
      // sequential nonces so they land together instead of waiting a block.
      const nonce = await publicClient.getTransactionCount({
        address: recipient,
        blockTag: "pending",
      });

      const approveHash = await wallet.writeContract({
        address: state.pairToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [event.curve, spend],
        nonce,
        ...overrides,
        account: wallet.account!,
        chain: wallet.chain,
      });

      pushActivity({
        kind: "info",
        level: "info",
        title: `Approving ${assetLabel} (${who})`,
        detail: `Approve sent (${approveHash.slice(0, 10)}…) — buy follows immediately, no wait.`,
        token: event.token,
        tokenSymbol: symbol,
        curve: event.curve,
        txHash: approveHash,
      });

      const hash = await wallet.writeContract({
        address: event.curve,
        abi: curveAbi,
        functionName: "buy",
        args: [spend, minOut, recipient],
        nonce: nonce + 1,
        ...overrides,
        account: wallet.account!,
        chain: wallet.chain,
      });
      reportBuy(event, symbol, who, spend, decimals, assetLabel, minOut, hash);
      return;
    }

    const hash = await wallet.writeContract({
      address: event.curve,
      abi: curveAbi,
      functionName: "buy",
      args: [spend, minOut, recipient],
      ...overrides,
      account: wallet.account!,
      chain: wallet.chain,
    });
    reportBuy(event, symbol, who, spend, decimals, assetLabel, minOut, hash);
  } catch (err) {
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

function msg(err: unknown): string {
  const raw = err instanceof Error ? err.message.split("\n")[0] : String(err);
  return raw.replace(/\/v2\/[A-Za-z0-9_\-]{8,}/g, "/v2/***").replace(/alch_[A-Za-z0-9_\-]{6,}/g, "alch_***");
}
