import { PONS, publicClient, tokenLaunchedEvent } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const head = await publicClient.getBlockNumber();
console.log("head:", head.toString());

async function tryRange(label: string, from: bigint, to: bigint) {
  try {
    const logs = await publicClient.getLogs({
      address: PONS.factory,
      event: tokenLaunchedEvent,
      fromBlock: from,
      toBlock: to,
    });
    console.log(`  ${label} ${from}..${to} -> ok, ${logs.length} logs`);
  } catch (err) {
    console.log(`  ${label} ${from}..${to} -> ERROR: ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log("single-block ranges:");
await tryRange("1-block", head, head);
await tryRange("1-block", head - 1n, head - 1n);

console.log("multi-block ranges:");
await tryRange("100-block", head - 100n, head);
await tryRange("900-block", head - 900n, head);

// also test a plain batched read (what the buy path does)
try {
  const [a, b] = await Promise.all([
    publicClient.readContract({ address: PONS.factory, abi: [
      { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    ], functionName: "launchFee" }),
    publicClient.readContract({ address: PONS.factory, abi: [
      { type: "function", name: "launchConfigCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    ], functionName: "launchConfigCount" }),
  ]);
  console.log(`  batched reads -> ok (launchFee=${a}, configCount=${b})`);
} catch (err) {
  console.log(`  batched reads -> ERROR: ${(err as Error).message.split("\n")[0]}`);
}
