import type { Address, PublicClient } from "viem";
import { curveAbi } from "./chain.js";

const BPS = 10_000n;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Constant product in the curve's own integer order (no fee applied here). */
function amountOut(inAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}

function amountIn(outAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (outAmount * reserveIn) / (reserveOut - outAmount) + 1n;
}

export interface CurveState {
  isNativeQuote: boolean;
  pairToken: Address;
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellable: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  /** Opening snipe tax for this specific recipient, in bps. 0 when exempt. */
  snipeTaxBps: bigint;
  graduated: boolean;
  readyToGraduate: boolean;
}

/** Everything about a curve that does NOT depend on who is doing the buying. */
export type CurveCore = Omit<CurveState, "snipeTaxBps">;

/**
 * Reads the buyer-independent curve fields in a single batch (8 calls).
 * When several wallets buy the same launch, this only needs to run ONCE —
 * the per-wallet read is just `currentSnipeTaxBps(recipient)`.
 */
export async function readCurveCore(client: PublicClient, curve: Address): Promise<CurveCore> {
  const read = (functionName: string) =>
    client.readContract({ address: curve, abi: curveAbi, functionName: functionName as never });

  const [isNativeQuote, pairToken, reserves, sellable, feeBps, creatorTaxBps, graduated, ready] =
    await Promise.all([
      read("isNativeQuote"),
      read("pairToken"),
      read("getReserves"),
      read("sellableTokens"),
      read("feeBps"),
      read("creatorTaxBps"),
      read("graduated"),
      read("readyToGraduate"),
    ]);

  const [quoteReserve, tokenReserve] = reserves as [bigint, bigint];

  return {
    isNativeQuote: isNativeQuote as boolean,
    pairToken: pairToken as Address,
    quoteReserve,
    tokenReserve,
    sellable: sellable as bigint,
    feeBps: feeBps as bigint,
    creatorTaxBps: creatorTaxBps as bigint,
    graduated: graduated as boolean,
    readyToGraduate: ready as boolean,
  };
}

/** The opening snipe tax (bps) for one specific token recipient. */
export async function readSnipeTax(
  client: PublicClient,
  curve: Address,
  recipient: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: curve,
    abi: curveAbi,
    functionName: "currentSnipeTaxBps",
    args: [recipient],
  })) as bigint;
}

export async function readCurveState(
  client: PublicClient,
  curve: Address,
  recipient: Address,
): Promise<CurveState> {
  const [core, snipeTaxBps] = await Promise.all([
    readCurveCore(client, curve),
    readSnipeTax(client, curve, recipient),
  ]);
  return { ...core, snipeTaxBps };
}

export interface BuyQuote {
  tokensOut: bigint;
  spent: bigint;
  refund: bigint;
  /** Snipe tax actually applied after the protocol's own cap. */
  appliedSnipeTaxBps: bigint;
}

/**
 * Quote a curve buy using the protocol's own integer order. Mirrors the
 * reference implementation in the pons v2 docs so the result matches what
 * the trade settles at when nothing moves in between.
 */
export function quoteCurveBuy(quoteIn: bigint, state: CurveState): BuyQuote {
  const { feeBps, creatorTaxBps, quoteReserve, tokenReserve, sellable } = state;

  // The snipe tax is capped so the buyer always nets at least 1% of spend.
  let snipeBps = state.snipeTaxBps;
  if (snipeBps > 0n) {
    const maxSnipeBps = BPS - feeBps - creatorTaxBps - 100n;
    if (snipeBps > maxSnipeBps) snipeBps = maxSnipeBps;
  }

  // Every fee comes off the input before the curve prices the trade.
  let spent = quoteIn;
  const fee = (spent * feeBps) / BPS;
  const tax = (spent * creatorTaxBps) / BPS;
  const snipeTax = (spent * snipeBps) / BPS;
  let tokensOut = amountOut(spent - fee - tax - snipeTax, quoteReserve, tokenReserve);

  // A buy that would cross the reserved allocation fills to the edge and is
  // repriced from the token side, refunding the difference.
  if (tokensOut > sellable) {
    tokensOut = sellable;
    const net = amountIn(sellable, quoteReserve, tokenReserve);
    const grossed = ceilDiv(net * BPS, BPS - feeBps - creatorTaxBps - snipeBps);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }

  return {
    tokensOut,
    spent,
    refund: quoteIn - spent,
    appliedSnipeTaxBps: snipeBps,
  };
}

/** Apply a slippage tolerance (bps) to derive a minimum-output bound. */
export function withSlippage(tokensOut: bigint, slippageBps: number): bigint {
  const bound = BigInt(Math.max(0, Math.min(9999, Math.round(slippageBps))));
  return (tokensOut * (BPS - bound)) / BPS;
}

/**
 * The curve's opening state for a brand-new launch. The curve starts at
 * (phantomQuote, supply) and holds back
 * `supply * phantomQuote / (phantomQuote + threshold)` for the pool.
 */
export function freshCurveState(params: {
  supply: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  curveFeeBps: bigint;
  creatorTaxBps: bigint;
}): CurveState {
  const { supply, phantomQuote, graduationThreshold, curveFeeBps, creatorTaxBps } = params;
  const reserved = (supply * phantomQuote) / (phantomQuote + graduationThreshold);
  return {
    isNativeQuote: true,
    pairToken: "0x0000000000000000000000000000000000000000",
    quoteReserve: phantomQuote,
    tokenReserve: supply,
    sellable: supply - reserved,
    feeBps: curveFeeBps,
    creatorTaxBps,
    snipeTaxBps: 0n,
    graduated: false,
    readyToGraduate: false,
  };
}

/**
 * Advance a curve state by a buy that settled. Used to chain quotes so a
 * later buyer in the same block is priced against the earlier buys instead of
 * against the opening state.
 */
export function applyBuyToState(state: CurveState, spent: bigint, tokensOut: bigint): CurveState {
  const fee = (spent * state.feeBps) / BPS;
  const tax = (spent * state.creatorTaxBps) / BPS;
  const snipe = (spent * state.snipeTaxBps) / BPS;
  const net = spent - fee - tax - snipe;
  return {
    ...state,
    quoteReserve: state.quoteReserve + net,
    tokenReserve: state.tokenReserve - tokensOut,
    sellable: state.sellable > tokensOut ? state.sellable - tokensOut : 0n,
  };
}

/**
 * Quote the first buy of a brand-new launch, before its curve exists.
 */
export function quoteFreshLaunch(params: {
  supply: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  curveFeeBps: bigint;
  creatorTaxBps: bigint;
  quoteIn: bigint;
}): BuyQuote & { sellable: bigint } {
  const state = freshCurveState(params);
  return { ...quoteCurveBuy(params.quoteIn, state), sellable: state.sellable };
}

export { BPS };
