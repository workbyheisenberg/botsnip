import { PONS, publicClient, tokenLaunchedEvent } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";
import { config } from "../config.js";

/**
 * Scan a block range for pons v2 launches and print them. Useful for
 * verifying the watcher and for backfilling historical launches.
 *
 *   npm --workspace server run scan-history -- <fromBlock> <toBlock>
 */
loadDB();
installDohResolver();

const args = process.argv.slice(2);
const head = await publicClient.getBlockNumber();
const from = args[0] ? BigInt(args[0]) : head > 20000n ? head - 20000n : 0n;
const to = args[1] ? BigInt(args[1]) : head;

console.log(`Scanning [${from}, ${to}] on factory ${PONS.factory} …`);

const chunk = BigInt(config.logChunkSize);
let cursor = from;
let count = 0;

while (cursor <= to) {
  const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;
  const logs = await publicClient.getLogs({
    address: PONS.factory,
    event: tokenLaunchedEvent,
    fromBlock: cursor,
    toBlock: end,
  });
  for (const log of logs) {
    count += 1;
    const a = log.args as {
      token: string;
      curve: string;
      deployer: string;
      pairToken: string;
    };
    console.log(`  block ${log.blockNumber}  token=${a.token}  curve=${a.curve}  deployer=${a.deployer}  pair=${a.pairToken}`);
  }
  process.stdout.write(`\r  scanned ${end - from}/${to - from} blocks · ${count} launches`);
  cursor = end + 1n;
}

console.log(`\nDone. ${count} launches found in [${from}, ${to}].`);
