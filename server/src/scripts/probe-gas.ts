import { formatGwei } from "viem";
import { publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";

installDohResolver();

const SAMPLES = 20;
const head = await publicClient.getBlockNumber();
console.log("head:", head.toString());

const latest = await publicClient.getBlock({ blockTag: "latest" });
console.log("baseFeePerGas:", latest.baseFeePerGas ? `${formatGwei(latest.baseFeePerGas)} gwei` : "n/a");
console.log("gasUsed / gasLimit:", latest.gasUsed.toString(), "/", latest.gasLimit.toString());

try {
  const fees = await publicClient.estimateFeesPerGas();
  console.log(
    "estimateFeesPerGas:",
    `maxFee=${fees.maxFeePerGas ? formatGwei(fees.maxFeePerGas) : "?"} gwei`,
    `maxPriority=${fees.maxPriorityFeePerGas ? formatGwei(fees.maxPriorityFeePerGas) : "?"} gwei`,
  );
} catch (err) {
  console.log("estimateFeesPerGas failed:", (err as Error).message.split("\n")[0]);
}

try {
  console.log("gasPrice:", formatGwei(await publicClient.getGasPrice()), "gwei");
} catch {
  /* ignore */
}

const tips: number[] = [];
const gasPrices: number[] = [];
let txCount = 0;

for (let i = 0n; i < BigInt(SAMPLES); i += 1n) {
  const bn = head - i;
  if (bn < 0n) break;
  try {
    const block = await publicClient.getBlock({ blockNumber: bn, includeTransactions: true });
    for (const tx of block.transactions as unknown as Array<Record<string, unknown>>) {
      if (typeof tx !== "object" || tx === null) continue;
      txCount += 1;
      const priority = tx.maxPriorityFeePerGas as bigint | undefined;
      const gasPrice = tx.gasPrice as bigint | undefined;
      if (typeof priority === "bigint") tips.push(Number(formatGwei(priority)));
      else if (typeof gasPrice === "bigint") gasPrices.push(Number(formatGwei(gasPrice)));
    }
  } catch {
    /* skip block */
  }
}

tips.sort((a, b) => a - b);
gasPrices.sort((a, b) => a - b);

function stats(label: string, arr: number[]) {
  if (!arr.length) {
    console.log(`${label}: (none)`);
    return;
  }
  const q = (p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  console.log(
    `${label}: n=${arr.length} min=${arr[0].toFixed(6)} p50=${q(0.5).toFixed(6)} p90=${q(0.9).toFixed(6)} max=${arr[arr.length - 1].toFixed(6)}`,
  );
}

console.log(`\nsampled ${txCount} txs across ${SAMPLES} blocks:`);
stats("priorityFee gwei", tips);
stats("legacy gasPrice gwei", gasPrices);
