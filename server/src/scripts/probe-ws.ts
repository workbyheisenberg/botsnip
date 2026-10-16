import { createPublicClient, webSocket } from "viem";
import { PONS, robinhoodChain } from "../chain.js";
import { installDohResolver } from "../doh.js";

installDohResolver();

const url = process.argv[2];
console.log("connecting:", url);

const client = createPublicClient({ chain: robinhoodChain, transport: webSocket(url) });
const transport = (
  client.transport as unknown as {
    subscribe: (a: unknown) => Promise<{ subscriptionId?: string; unsubscribe?: () => void }>;
  }
);

let heads = 0;
let logs = 0;

console.log("subscribing to logs from factory:", PONS.factory);
const res = await transport.subscribe({
  params: ["logs", { address: PONS.factory }],
  onData: (data: unknown) => {
    const log = (data as { result?: { address?: string; topics?: string[] } })?.result;
    logs += 1;
    if (logs <= 5) console.log("LOG:", JSON.stringify(log).slice(0, 220));
  },
  onError: (err: unknown) => console.log("logs onError:", (err as Error)?.message ?? err),
});
console.log("logs subscribe keys:", Object.keys(res ?? {}));

// heartbeat subscription so we can confirm the socket is alive
await transport.subscribe({
  params: ["newHeads"],
  onData: () => {
    heads += 1;
  },
  onError: (err: unknown) => console.log("heads onError:", (err as Error)?.message ?? err),
});

setTimeout(() => {
  console.log(`\nin 60s -> newHeads: ${heads}, factory logs: ${logs}`);
  process.exit(0);
}, 60_000);
