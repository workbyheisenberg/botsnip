import { PONS, publicClient, tokenLaunchedEvent } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const head = await publicClient.getBlockNumber();
const logs = await publicClient.getLogs({
  address: PONS.factory,
  event: tokenLaunchedEvent,
  fromBlock: head - 200n,
  toBlock: head,
});

console.log(`found ${logs.length} recent launches\n`);

function pad(addr: string) {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

for (const log of logs.slice(0, 3)) {
  const a = log.args as unknown as { deployer: string; curve: string; token: string };
  console.log("token   :", a.token);
  console.log("  topics[1] vs token   match:", log.topics[1] === pad(a.token));
  console.log("  topics[2] vs curve   match:", log.topics[2] === pad(a.curve));
  console.log("  topics[3] vs deployer match:", log.topics[3] === pad(a.deployer));
  console.log("  deployer:", a.deployer);
  console.log("");
}
