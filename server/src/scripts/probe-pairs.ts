import { PONS, publicClient, tokenLaunchedEvent, factoryAbi } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const ZERO = "0x0000000000000000000000000000000000000000";
const head = await publicClient.getBlockNumber();
const CHUNK = 10n; // Alchemy Free caps eth_getLogs at 10 blocks
const SPAN = 2000n;
const from = head - SPAN;

const counts = new Map<string, { count: number; deployers: Set<string> }>();

let cursor = from;
while (cursor <= head) {
  const to = cursor + CHUNK - 1n > head ? head : cursor + CHUNK - 1n;
  const logs = await publicClient.getLogs({
    address: PONS.factory,
    event: tokenLaunchedEvent,
    fromBlock: cursor,
    toBlock: to,
  });
  for (const log of logs) {
    const a = log.args as unknown as { token: string; deployer: string; pairToken: string };
    const key = (a.pairToken ?? ZERO).toLowerCase();
    const entry = counts.get(key) ?? { count: 0, deployers: new Set<string>() };
    entry.count += 1;
    entry.deployers.add(a.deployer.toLowerCase());
    counts.set(key, entry);
  }
  cursor = to + 1n;
}

console.log(`scanned blocks ${from}..${head} (${SPAN} blocks, ${Number(SPAN / CHUNK)} requests)\n`);
console.log(`distinct launch blobs found: ${[...counts.values()].reduce((s, v) => s + v.count, 0)}\n`);

for (const [pair, info] of counts) {
  const native = pair === ZERO;
  console.log(`${native ? "NATIVE ETH" : "ERC-20    "}  ${pair}  → ${info.count} launch(es)`);
  if (!native) {
    try {
      const [approved, econ] = await Promise.all([
        publicClient.readContract({
          address: PONS.factory,
          abi: factoryAbi,
          functionName: "approvedPairTokens",
          args: [pair as `0x${string}`],
        }),
        publicClient.readContract({
          address: PONS.factory,
          abi: factoryAbi,
          functionName: "pairTokenEconomics",
          args: [pair as `0x${string}`],
        }),
      ]);
      const [phantomQuote, graduationThreshold, decimals] = econ as readonly [bigint, bigint, number];
      console.log(`             approved=${approved} decimals=${decimals} phantom=${phantomQuote} threshold=${graduationThreshold}`);
    } catch (err) {
      console.log(`             (could not read economics: ${String((err as Error).message).split("\n")[0]})`);
    }
  }
}
