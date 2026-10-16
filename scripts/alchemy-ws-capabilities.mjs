// Which targeted subscriptions does Robinhood Chain (via Alchemy) actually support?
// Reads the WS URL from db.json. Never prints the key.

import { readFileSync } from "node:fs";
import { createPublicClient, webSocket } from "viem";

const db = JSON.parse(readFileSync("server/data/db.json", "utf8"));
const url = (db.settings?.wsUrl || "").trim();
if (!url) {
  console.log("no wsUrl configured");
  process.exit(1);
}
console.log("endpoint:", url.replace(/\/v2\/.+$/, "/v2/<KEY>"));

const client = createPublicClient({ transport: webSocket(url) });
const transport = client.transport;

const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const TOPIC0 = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"; // TokenLaunched
const DEPLOYER = "0xad138fde10d206DA16888F349511e2ED1b7c191e"; // your watched wallet

const counts = new Map();
const unsubs = [];

async function trySub(label, params) {
  try {
    const res = await transport.subscribe({
      params,
      onData: () => counts.set(label, (counts.get(label) ?? 0) + 1),
      onError: (e) => console.log(`  ${label}: runtime error -> ${e?.message ?? e}`),
    });
    counts.set(label, 0);
    unsubs.push(res.unsubscribe);
    console.log(`  ${label}: ACCEPTED (subscriptionId ${String(res.subscriptionId).slice(0, 12)}…)`);
  } catch (err) {
    console.log(`  ${label}: REJECTED -> ${String(err?.message).split("\n")[0]}`);
  }
}

const padded = "0x000000000000000000000000" + DEPLOYER.slice(2).toLowerCase();

console.log("\nsubscribing…");
await trySub("logs(all factory launches)", ["logs", { address: FACTORY, topics: [TOPIC0] }]);
await trySub("logs(filtered to wallet)", ["logs", { address: FACTORY, topics: [TOPIC0, null, null, padded] }]);
await trySub("alchemy_pendingTransactions(from wallet)", [
  "alchemy_pendingTransactions",
  { fromAddress: DEPLOYER, hashesOnly: true },
]);
await trySub("alchemy_minedTransactions(from wallet)", [
  "alchemy_minedTransactions",
  { fromAddress: DEPLOYER, hashesOnly: true },
]);

await new Promise((r) => setTimeout(r, 35000));

console.log("\nmessages received in 35s:");
for (const [label, count] of counts) console.log(`  ${count.toString().padStart(4)}  ${label}`);

for (const u of unsubs) {
  try {
    u();
  } catch {
    /* ignore */
  }
}
process.exit(0);
