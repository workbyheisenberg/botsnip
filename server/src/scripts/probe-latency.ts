import { createPublicClient, http } from "viem";
import { effectiveRpcUrl, robinhoodChain } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";
import { quoteCurveBuy, readCurveState } from "../quote.js";

loadDB(); // scripts must load the saved settings to see the configured RPC
installDohResolver();

const url = effectiveRpcUrl();
const curve = process.argv[2] as `0x${string}`;
const recipient = "0x0000000000000000000000000000000000000001" as `0x${string}`;

const clientNoBatch = createPublicClient({ chain: robinhoodChain, transport: http(url) });
const clientBatch = createPublicClient({ chain: robinhoodChain, transport: http(url, { batch: true }) });

async function timeIt(label: string, client: typeof clientNoBatch) {
  await readCurveState(client, curve, recipient).catch(() => {});
  const runs = 5;
  const t0 = Date.now();
  for (let i = 0; i < runs; i += 1) {
    await readCurveState(client, curve, recipient);
  }
  const ms = (Date.now() - t0) / runs;
  console.log(`${label}: ${ms.toFixed(0)} ms per curve read (9 contract calls)`);
  return ms;
}

console.log(`RPC: ${url}\n`);
const a = await timeIt("without batching", clientNoBatch);
const b = await timeIt("with batching   ", clientBatch);
console.log(`\nspeedup: ${(a / b).toFixed(1)}x  (saves ~${(a - b).toFixed(0)} ms per buy decision)`);
