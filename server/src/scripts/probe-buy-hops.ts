// Times each network hop of the buy path, then compares it with a version that
// collapses the hops into one batch. Answers "where do the seconds go?".
import type { Address } from "viem";
import { gasOverrides, PONS, publicClient, tokenLaunchedEvent } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";
import { readCurveCore, readSnipeTax } from "../quote.js";

loadDB();
installDohResolver();

// find a recent curve
const head = await publicClient.getBlockNumber();
let curve: Address | undefined = process.argv[2] ? (process.argv[2].toLowerCase() as Address) : undefined;
for (let i = 0n; !curve && i < 300n; i += 1n) {
  const to = head - i * 10n;
  const from = to - 9n;
  const logs = await publicClient.getLogs({
    address: PONS.factory,
    event: tokenLaunchedEvent,
    fromBlock: from,
    toBlock: to,
  });
  if (logs.length) curve = (logs[0].args as { curve: Address }).curve;
}
if (!curve) {
  console.log("no recent curve found");
  process.exit(1);
}

const db = getDB();
const wallet = db.buying.find((b) => b.enabled) ?? db.buying[0];
const addr = wallet.address as Address;
console.log(`curve  ${curve}`);
console.log(`wallet ${wallet.label} ${addr}\n`);

async function hop(label: string, fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

const runs = 3;
const totals: number[] = [];
const batched: number[] = [];

for (let r = 0; r < runs; r += 1) {
  // ── current code path: 4 separate round trips ────────────────────────────
  const h1 = await hop("1 reads", () =>
    Promise.all([readCurveCore(publicClient, curve!), readSnipeTax(publicClient, curve!, addr), gasOverrides()]),
  );
  const h2 = await hop("2 balance", () => publicClient.getBalance({ address: addr }));
  const h3 = await hop("3 nonce", () =>
    publicClient.getTransactionCount({ address: addr, blockTag: "pending" }),
  );
  const sum = h1 + h2 + h3;
  totals.push(sum);
  console.log(
    `run ${r + 1}  CURRENT: reads ${h1.toFixed(0)}ms → balance ${h2.toFixed(0)}ms → nonce ${h3.toFixed(0)}ms  = ${sum.toFixed(0)}ms (+1 broadcast hop)`,
  );

  // ── proposed: every read in ONE round trip ──────────────────────────────
  const one = await hop("all", () =>
    Promise.all([
      readCurveCore(publicClient, curve!),
      readSnipeTax(publicClient, curve!, addr),
      gasOverrides(),
      publicClient.getBalance({ address: addr }),
      publicClient.getTransactionCount({ address: addr, blockTag: "pending" }),
    ]),
  );
  batched.push(one);
  console.log(`      PROPOSED: all reads in ONE batch = ${one.toFixed(0)}ms (+1 broadcast hop)`);
  console.log("");
  await new Promise((res) => setTimeout(res, 400));
}

const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`median CURRENT  (3 read hops) = ${med(totals).toFixed(0)}ms`);
console.log(`median PROPOSED (1 read hop)  = ${med(batched).toFixed(0)}ms`);
console.log(`saved per buy                 = ${(med(totals) - med(batched)).toFixed(0)}ms`);
