import { createPublicClient, http } from "viem";
import { effectiveRpcUrl, PONS, publicClient, robinhoodChain, tokenLaunchedEvent } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";
import { readCurveCore, readCurveState, readSnipeTax } from "../quote.js";

loadDB();
installDohResolver();

// ── Find a recent curve to measure against (or take one as an argument) ─────
const head = await publicClient.getBlockNumber();
let curve: `0x${string}` | undefined = process.argv[2] as `0x${string}` | undefined;
for (let i = 0n; !curve && i < 300n; i += 1n) {
  const to = head - i * 10n;
  const from = to - 9n;
  const logs = await publicClient.getLogs({
    address: PONS.factory,
    event: tokenLaunchedEvent,
    fromBlock: from,
    toBlock: to,
  });
  if (logs.length) curve = (logs[0].args as { curve: `0x${string}` }).curve;
}
if (!curve) {
  console.log("no recent curve found");
  process.exit(1);
}
console.log(`curve under test: ${curve}\n`);

// ── Instrument global fetch to count JSON-RPC calls per batch ───────────────
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  try {
    const body = init?.body;
    if (typeof body === "string") {
      const parsed = JSON.parse(body) as unknown;
      calls += Array.isArray(parsed) ? parsed.length : 1;
    } else {
      calls += 1;
    }
  } catch {
    calls += 1;
  }
  return realFetch(input as never, init as never);
}) as typeof fetch;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(effectiveRpcUrl(), { batch: true }),
});

// ── Recipients: real buying wallets, padded with synthetic ones ─────────────
const db = getDB();
const recipients: `0x${string}`[] = db.buying
  .filter((b) => b.enabled)
  .map((b) => b.address as `0x${string}`);
for (let i = recipients.length; i < 3; i += 1) {
  recipients.push(`0x${(i + 1).toString().repeat(40)}` as `0x${string}`);
}

const C = curve;

async function measure(label: string, fn: () => Promise<unknown>): Promise<void> {
  await fn(); // warm-up
  await new Promise((r) => setTimeout(r, 400));

  const runs: number[] = [];
  let rpcCalls = 0;
  for (let i = 0; i < 3; i += 1) {
    calls = 0;
    const t0 = performance.now();
    await fn();
    runs.push(performance.now() - t0);
    rpcCalls = Math.max(rpcCalls, calls);
    await new Promise((r) => setTimeout(r, 300));
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  console.log(
    `${label.padEnd(46)} ${String(rpcCalls).padStart(2)} RPC calls   median ${median.toFixed(0).padStart(4)} ms`,
  );
}

console.log("— decision phase: curve read + snipe tax —");
for (const n of [0, 1, 2, 3]) {
  if (n === 0) continue;
  const r = recipients.slice(0, n);

  await measure(`OLD  ${n} wallet(s) — ${n} x readCurveState (9 calls each)`, () =>
    Promise.all(r.map((addr) => readCurveState(client, C, addr))),
  );
  await measure(`NEW  ${n} wallet(s) — one batch (8 + ${n} calls)`, () =>
    Promise.all([
      readCurveCore(client, C),
      Promise.all(r.map((addr) => readSnipeTax(client, C, addr))),
    ]),
  );
  console.log("");
}
