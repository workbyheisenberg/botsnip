import { randomBytes } from "node:crypto";
import { encodeFunctionData, formatEther, formatUnits, maxUint256, parseEventLogs, parseUnits, toHex, zeroAddress, type Address } from "viem";
import {
  curveAbi,
  erc20Abi,
  factoryAbi,
  gasOverrides,
  launchAndBuyAbi,
  makeWalletClient,
  PONS,
  publicClient,
  tokenLaunchedEvent,
} from "./chain.js";
import { decryptSecret } from "./crypto.js";
import { getDB, pushActivity, saveDB } from "./store.js";
import {
  applyBuyToState,
  freshCurveState,
  quoteCurveBuy,
  quoteFreshLaunch,
  withSlippage,
} from "./quote.js";
import { isAddressLike, shortAddr } from "./util.js";

export interface LaunchConfigView {
  id: string;
  supply: string;
  curveFeeBps: number;
  phantomQuote: string;
  graduationThreshold: string;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
}

export interface LaunchInfo {
  launchFee: string;
  maxCreatorTaxBps: number;
  configs: LaunchConfigView[];
  canLaunch: Record<string, boolean>;
  wallets: Array<{ id: string; address: string; label: string; hasKey: boolean; enabled: boolean }>;
}

export async function getLaunchInfo(): Promise<LaunchInfo> {
  const db = getDB();

  const [count, launchFee, maxTax] = await Promise.all([
    publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchConfigCount" }),
    publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchFee" }),
    publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "maxCreatorTaxBps" }),
  ]);

  const configs: LaunchConfigView[] = [];
  for (let id = 0; id < Number(count); id += 1) {
    const config = (await publicClient.readContract({
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "getLaunchConfig",
      args: [BigInt(id)],
    })) as {
      supply: bigint;
      curveFeeBps: bigint;
      phantomQuote: bigint;
      graduationThreshold: bigint;
      poolFee: number;
      tickSpacing: number;
      enabled: boolean;
    };
    configs.push({
      id: String(id),
      supply: config.supply.toString(),
      curveFeeBps: Number(config.curveFeeBps),
      phantomQuote: config.phantomQuote.toString(),
      graduationThreshold: config.graduationThreshold.toString(),
      poolFee: Number(config.poolFee),
      tickSpacing: Number(config.tickSpacing),
      enabled: config.enabled,
    });
  }

  const canLaunch: Record<string, boolean> = {};
  await Promise.all(
    db.buying.map(async (w) => {
      try {
        canLaunch[w.address] = (await publicClient.readContract({
          address: PONS.factory,
          abi: factoryAbi,
          functionName: "canLaunch",
          args: [w.address as Address],
        })) as boolean;
      } catch {
        canLaunch[w.address] = false;
      }
    }),
  );

  return {
    launchFee: launchFee.toString(),
    maxCreatorTaxBps: Number(maxTax),
    configs,
    canLaunch,
    wallets: db.buying.map((b) => ({
      id: b.id,
      address: b.address,
      label: b.label,
      hasKey: Boolean(b.encryptedKey),
      enabled: b.enabled,
    })),
  };
}

export interface LaunchInput {
  name: string;
  symbol: string;
  description?: string;
  logo?: string;
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
    farcaster?: string;
  };
  launchConfigId: string;
  pairToken?: string; // "native" or an ERC-20 address
  /** Buy amount in ETH (native launches). */
  buyAmountEth?: string;
  /** Buy amount in the pair token's own units (ERC-20 launches, e.g. USDG). */
  buyAmountQuote?: string;
  creatorTaxBps?: number;
  buybackEnabled?: boolean;
  creatorFeeRecipient?: string;
  signerWalletId: string;
  extraExemptions?: string[];
  /** Pre-sign the other buying wallets' buys so they can land in the launch block. */
  preArmBuyers?: boolean;
  dryRun: boolean;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
  plan?: {
    totalCostEth: string;
    launchFeeEth: string;
    buyEth: string;
    /** "ETH", "USDG", … — the asset the first buy is denominated in. */
    buySymbol: string;
    expectedTokens: string;
    minTokensOut: string;
    recipient: string;
    exemptions: string[];
    pairToken: string;
    /** True when a pair launch still needs an ERC-20 approval before it can run. */
    needsApproval: boolean;
    /** How many other buying wallets are pre-armed for the launch block. */
    prearmedBuyers: number;
  };
  txHash?: string;
  token?: string;
  curve?: string;
}

export async function executeLaunch(input: LaunchInput): Promise<LaunchResult> {
  const db = getDB();
  const signer = db.buying.find((b) => b.id === input.signerWalletId);
  if (!signer || !signer.encryptedKey) {
    return { ok: false, error: "Pick a signing wallet that has a key (a buying wallet)." };
  }
  if (!input.name.trim() || !input.symbol.trim()) {
    return { ok: false, error: "Name and symbol are required." };
  }

  const configId = Number(input.launchConfigId);
  if (!Number.isInteger(configId) || configId < 0) {
    return { ok: false, error: "Invalid launch config." };
  }

  let config: {
    supply: bigint;
    curveFeeBps: bigint;
    phantomQuote: bigint;
    graduationThreshold: bigint;
    enabled: boolean;
  };
  try {
    config = (await publicClient.readContract({
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "getLaunchConfig",
      args: [BigInt(configId)],
    })) as typeof config;
  } catch {
    return { ok: false, error: "Could not read that launch config." };
  }
  if (!config.enabled) return { ok: false, error: "That launch config is disabled." };

  const pairToken = (!input.pairToken || input.pairToken === "native"
    ? zeroAddress
    : (input.pairToken as Address)) as Address;
  const native = pairToken === zeroAddress;

  if (!native) {
    if (!isAddressLike(pairToken)) return { ok: false, error: "Invalid pair token address." };
    const approved = (await publicClient.readContract({
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "approvedPairTokens",
      args: [pairToken],
    })) as boolean;
    if (!approved) return { ok: false, error: "That pair token is not approved for launches." };
  }

  // Launch economics are recorded PER ASSET. A USDG launch is sized in USDG
  // (6 decimals), so using the ETH config here would be wrong by 1e12.
  let quoteDecimals = 18;
  let buySymbol = "ETH";
  let phantomQuote = config.phantomQuote;
  let graduationThreshold = config.graduationThreshold;

  if (!native) {
    try {
      const [phantom, threshold, decimals] = (await publicClient.readContract({
        address: PONS.factory,
        abi: factoryAbi,
        functionName: "pairTokenEconomics",
        args: [pairToken],
      })) as readonly [bigint, bigint, number];
      phantomQuote = phantom;
      graduationThreshold = threshold;
      quoteDecimals = Number(decimals);
    } catch {
      return { ok: false, error: "Could not read that pair token's launch economics." };
    }
    buySymbol = (await readErc20Symbol(pairToken)) ?? "pair";
  }

  const rawAmount = ((native ? input.buyAmountEth : input.buyAmountQuote) ?? "").trim();
  let quoteIn: bigint;
  try {
    quoteIn = parseUnits(rawAmount || "0", quoteDecimals);
  } catch {
    return { ok: false, error: `Invalid ${buySymbol} buy amount.` };
  }

  const creatorTaxBps = Math.max(0, Math.min(65535, Math.round(input.creatorTaxBps ?? 0)));
  const recipient = (input.creatorFeeRecipient?.trim() || signer.address) as Address;
  if (!isAddressLike(recipient)) return { ok: false, error: "Invalid creator fee recipient." };

  // Only allowed while the launch gate is open for this wallet.
  const allowed = (await publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "canLaunch",
    args: [signer.address as Address],
  })) as boolean;
  if (!allowed) {
    return {
      ok: false,
      error: `${shortAddr(signer.address)} is not whitelisted to launch right now (pons v2 public launches are gated).`,
    };
  }

  const [launchFee, expectedEconomics] = await Promise.all([
    publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchFee" }),
    publicClient.readContract({
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "previewLaunchEconomics",
      args: [BigInt(configId), pairToken],
    }),
  ]);

  const quote = quoteFreshLaunch({
    supply: config.supply,
    phantomQuote,
    graduationThreshold,
    curveFeeBps: config.curveFeeBps,
    creatorTaxBps: BigInt(creatorTaxBps),
    quoteIn,
  });
  const minOut = withSlippage(quote.tokensOut, db.settings.slippageBps);

  // Funding check up front, so a mistake is a clear message instead of a revert.
  if (native) {
    const balance = await publicClient.getBalance({ address: signer.address as Address });
    if (balance < launchFee + quoteIn) {
      return {
        ok: false,
        error: `Signing wallet needs ${formatEther(launchFee + quoteIn)} ETH (fee + buy), has ${formatEther(balance)}.`,
      };
    }
  } else {
    const balance = (await publicClient.readContract({
      address: pairToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [signer.address as Address],
    })) as bigint;
    if (balance < quoteIn) {
      return {
        ok: false,
        error: `Signing wallet needs ${formatUnits(quoteIn, quoteDecimals)} ${buySymbol}, has ${formatUnits(balance, quoteDecimals)}.`,
      };
    }
  }

  // A custom-pair launch needs the router approved to pull the pair asset.
  let needsApproval = false;
  if (!native && quoteIn > 0n) {
    const allowance = (await publicClient.readContract({
      address: pairToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [signer.address as Address, PONS.launchAndBuy],
    })) as bigint;
    needsApproval = allowance < quoteIn;
  }

  // Every enabled buying wallet should be exempt so the team can bundle buys.
  const exemptions = Array.from(
    new Set(
      [
        ...db.buying.filter((b) => b.enabled).map((b) => b.address),
        ...(input.extraExemptions ?? []),
      ]
        .filter((a) => isAddressLike(a))
        .filter((a) => a.toLowerCase() !== recipient.toLowerCase())
        .slice(0, 32),
    ),
  ) as Address[];

  const value = native ? launchFee + quoteIn : launchFee;

  // The signer already buys atomically; these are the *other* wallets we can
  // pre-sign so their buys can land in the launch block too.
  const prearmableBuyers = db.buying.filter(
    (b) => b.enabled && b.encryptedKey && b.id !== signer.id,
  ).length;

  const plan = {
    totalCostEth: formatEther(value),
    launchFeeEth: formatEther(launchFee),
    buyEth: formatUnits(quoteIn, quoteDecimals),
    buySymbol,
    expectedTokens: quote.tokensOut.toString(),
    minTokensOut: minOut.toString(),
    recipient,
    exemptions,
    pairToken,
    needsApproval,
    prearmedBuyers: input.preArmBuyers === false ? 0 : prearmableBuyers,
  };

  if (input.dryRun) {
    return { ok: true, plan };
  }

  const params = {
    name: input.name.trim(),
    symbol: input.symbol.trim(),
    logo: input.logo?.trim() || "",
    description: input.description?.trim() || "",
    socials: {
      twitter: input.socials?.twitter?.trim() || "",
      telegram: input.socials?.telegram?.trim() || "",
      discord: input.socials?.discord?.trim() || "",
      website: input.socials?.website?.trim() || "",
      farcaster: input.socials?.farcaster?.trim() || "",
    },
    creatorFeeRecipient: recipient,
    creatorTaxBps,
    buybackEnabled: Boolean(input.buybackEnabled),
    expectedEconomics: expectedEconomics as `0x${string}`,
    salt: toHex(randomBytes(32)),
  };

  try {
    const privateKey = decryptSecret(signer.encryptedKey) as `0x${string}`;
    const { wallet } = makeWalletClient(privateKey);

    // ERC-20 pair: the router must be allowed to pull `quoteIn` before the
    // launch runs. This is the one non-atomic step pons requires for pairs
    // (approve, wait, then launchAndBuy). Native ETH needs none of this.
    if (needsApproval) {
      const approveHash = await wallet.writeContract({
        address: pairToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [PONS.launchAndBuy, maxUint256],
        account: wallet.account!,
        chain: wallet.chain,
      });
      pushActivity({
        kind: "info",
        level: "info",
        title: `Approving ${buySymbol} for launches`,
        detail: `One-time approval sent (${approveHash.slice(0, 10)}…) — the launch follows once it lands.`,
        txHash: approveHash,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 90_000 });
    }

    // ── Pre-arm the other buyers for the launch block ──────────────────────
    // We know the salt, so simulating launchAndBuy reveals the exact token and
    // curve addresses. That lets us pre-sign every other buyer's buy BEFORE the
    // launch is sent, then submit them immediately behind it. If the sequencer
    // orders them after the launch they land in the launch block; if one is
    // ordered before it, it simply reverts (gas only).
    const preArmed: Array<{ label: string; raw: `0x${string}` }> = [];
    if (input.preArmBuyers !== false) {
      try {
        const preview = await publicClient.simulateContract({
          address: PONS.launchAndBuy,
          abi: launchAndBuyAbi,
          functionName: "launchAndBuy",
          args: [params, BigInt(configId), pairToken, quoteIn, minOut, recipient, exemptions],
          value,
          account: wallet.account!,
        });
        const predictedCurve = (preview.result as readonly [Address, Address, bigint])[1];

        // Price the buyers against the curve AFTER our own atomic buy.
        let simState = freshCurveState({
          supply: config.supply,
          phantomQuote,
          graduationThreshold,
          curveFeeBps: config.curveFeeBps,
          creatorTaxBps: BigInt(creatorTaxBps),
        });
        if (quoteIn > 0n) {
          const atomic = quoteCurveBuy(quoteIn, simState);
          simState = applyBuyToState(simState, atomic.spent, atomic.tokensOut);
        }

        // A pre-signed tx cannot ask the node for gas/fees later, so pin them.
        const gasOv = await gasOverrides();
        const gas = gasOv.gas ?? 400_000n;
        let maxFee = gasOv.maxFeePerGas;
        let maxPrio = gasOv.maxPriorityFeePerGas;
        if (!maxFee) {
          const est = await publicClient.estimateFeesPerGas();
          maxFee = est.maxFeePerGas;
          maxPrio = est.maxPriorityFeePerGas ?? maxPrio;
        }

        const armed = db.buying.filter(
          (b) => b.enabled && b.encryptedKey && b.id !== signer.id,
        );
        const prepared = armed.map((b) => ({
          buyer: b,
          ...makeWalletClient(decryptSecret(b.encryptedKey) as `0x${string}`),
        }));
        const armedNonces = await Promise.all(
          prepared.map((p) =>
            publicClient.getTransactionCount({ address: p.account.address, blockTag: "pending" }),
          ),
        );

        for (let i = 0; i < prepared.length; i += 1) {
          const { buyer: b, wallet: bw, account: bacc } = prepared[i];
          const spend = native
            ? parseUnits((b.amountEth || "").trim() || "0", 18)
            : parseUnits((b.amountQuote || "").trim() || "0", quoteDecimals);
          if (spend <= 0n) continue;

          const q = quoteCurveBuy(spend, simState);
          if (q.tokensOut <= 0n) continue;
          const buyerMinOut = withSlippage(q.tokensOut, db.settings.slippageBps);

          let n = armedNonces[i] ?? 0;
          if (!native) {
            const approveTx = await bw.prepareTransactionRequest({
              to: pairToken,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [predictedCurve, spend],
              }),
              nonce: n,
              gas,
              maxFeePerGas: maxFee,
              maxPriorityFeePerGas: maxPrio,
              account: bacc,
              chain: bw.chain,
            });
            preArmed.push({
              label: `${b.label} approve`,
              raw: await bacc.signTransaction(approveTx),
            });
            n += 1;
          }

          const buyTx = await bw.prepareTransactionRequest({
            to: predictedCurve,
            data: encodeFunctionData({
              abi: curveAbi,
              functionName: "buy",
              args: [spend, buyerMinOut, bacc.address],
            }),
            value: native ? spend : 0n,
            nonce: n,
            gas,
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: maxPrio,
            account: bacc,
            chain: bw.chain,
          });
          preArmed.push({ label: b.label, raw: await bacc.signTransaction(buyTx) });

          // Move the simulated curve forward so the next buyer is priced fairly.
          simState = applyBuyToState(simState, q.spent, q.tokensOut);
        }

        if (preArmed.length > 0) {
          pushActivity({
            kind: "info",
            level: "info",
            title: `Pre-armed ${preArmed.length} buy(s) for the launch block`,
            detail: `${preArmed.map((p) => p.label).join(", ")} · curve ${shortAddr(predictedCurve, 5)}`,
          });
        }
      } catch (err) {
        pushActivity({
          kind: "info",
          level: "warn",
          title: "Pre-arming skipped",
          detail: `${err instanceof Error ? err.message.split("\n")[0] : String(err)} — the watcher will still buy.`,
        });
      }
    }

    const hash = await wallet.writeContract({
      address: PONS.launchAndBuy,
      abi: launchAndBuyAbi,
      functionName: "launchAndBuy",
      args: [params, BigInt(configId), pairToken, quoteIn, minOut, recipient, exemptions],
      value,
      account: wallet.account!,
      chain: wallet.chain,
    });

    // Submit the pre-armed buys immediately behind the launch.
    if (preArmed.length > 0) {
      const sent = await Promise.allSettled(
        preArmed.map((p) => publicClient.sendRawTransaction({ serializedTransaction: p.raw })),
      );
      const ok = sent.filter((r) => r.status === "fulfilled").length;
      pushActivity({
        kind: "info",
        level: ok === sent.length ? "success" : "warn",
        title: `Launch-block buys submitted — ${ok}/${sent.length}`,
        detail: `${preArmed.map((p) => p.label).join(", ")} · launch ${hash.slice(0, 10)}…`,
        txHash: hash,
      });
    }

    pushActivity({
      kind: "info",
      level: "success",
      title: `Atomic launch sent — ${params.symbol}`,
      detail: `Launch + first buy in one tx · ${plan.buyEth} ${plan.buySymbol} buy · wallet ${shortAddr(signer.address)}`,
      txHash: hash,
    });

    let token: string | undefined;
    let curve: string | undefined;
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      const parsed = parseEventLogs({ abi: [tokenLaunchedEvent], logs: receipt.logs });
      const first = parsed[0]?.args as { token?: string; curve?: string } | undefined;
      token = first?.token;
      curve = first?.curve;

      const db2 = getDB();
      db2.stats.buys += 1;
      saveDB();
      pushActivity({
        kind: "buy",
        level: "success",
        title: `Launched ${params.name} (${params.symbol}) at ${plan.buyEth} ${plan.buySymbol}`,
        detail: token ? `token ${token} · curve ${curve}` : "confirmed on chain",
        token,
        tokenSymbol: params.symbol,
        curve,
        txHash: hash,
        amountEth: native ? plan.buyEth : undefined,
      });
    } catch {
      /* receipt not needed for success */
    }

    return { ok: true, plan, txHash: hash, token, curve };
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    pushActivity({ kind: "error", level: "error", title: "Atomic launch failed", detail: message });
    return { ok: false, error: message };
  }
}

async function readErc20Symbol(token: Address): Promise<string | undefined> {
  try {
    return await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
  } catch {
    return undefined;
  }
}
