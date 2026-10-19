// Measure the opening snipe-tax decay on the next live launch, so we can tune
// how long the buy path should wait. Uses the WS push feed for instant kicks.
import { decodeEventLog, type Address } from "viem";
import { createPublicClient, webSocket } from "viem";
import {
  curveAbi,
  effectiveWsUrl,
  PONS,
  publicClient,
  robinhoodChain,
  tokenLaunchedEvent,
} from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const ws = effectiveWsUrl();
if (!ws) {
  console.log("no wsUrl configured");
  process.exit(1);
}
console.log("listening for the next launch…\n");

const client = createPublicClient({ chain: robinhoodChain, transport: webSocket(ws) });
const transport = client.transport as unknown as {
  subscribe: (a: {
    params: unknown[];
    onData: (d: unknown) => void;
    onError?: (e: unknown) => void;
  }) => Promise<{ unsubscribe?: () => void }>;
};

const PROBE: Address = "0x1111111111111111111111111111111111111111"; // almost certainly non-exempt

const TOKEN0 = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
let busy = false;

async function onLaunch(curve: Address, blockNumber: bigint): Promise<void> {
  if (busy) return;
  busy = true;

  // Use receive time immediately; refine to the block timestamp when it lands
  // (fetching it first would delay the whole sampling loop).
  const t = { v: Date.now() };
  void publicClient
    .getBlock({ blockNumber })
    .then((b) => {
      t.v = Number(b.timestamp) * 1000;
    })
    .catch(() => {});

  console.log(`launch curve ${curve} (block ${blockNumber})`);
  console.log("  t(ms)   snipeTaxBps   tax%");
  const end = Date.now() + 7_000;
  while (Date.now() < end) {
    let tax: bigint | null = null;
    try {
      tax = (await publicClient.readContract({
        address: curve,
        abi: curveAbi,
        functionName: "currentSnipeTaxBps",
        args: [PROBE],
      })) as bigint;
    } catch {
      /* ignore */
    }
    const dt = Date.now() - t.v;
    if (tax !== null) {
      console.log(`  ${String(dt).padStart(5)}   ${String(tax).padStart(10)}   ${(Number(tax) / 100).toFixed(2)}%`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log("");
  busy = false;
}

await transport.subscribe({
  params: ["logs", { address: PONS.factory, topics: [TOKEN0] }],
  onData: (data: unknown) => {
    const log = (data as { result?: { data: `0x${string}`; topics: `0x${string}`[]; blockNumber: string } })
      ?.result;
    if (!log) return;
    try {
      const decoded = decodeEventLog({
        abi: [tokenLaunchedEvent],
        data: log.data,
        topics: log.topics as never,
      });
      const args = decoded.args as unknown as { curve: Address };
      void onLaunch(args.curve, BigInt(log.blockNumber));
    } catch {
      /* ignore */
    }
  },
  onError: (e: unknown) => console.log("ws error:", e),
});

// keep alive
setInterval(() => {}, 1 << 30);
