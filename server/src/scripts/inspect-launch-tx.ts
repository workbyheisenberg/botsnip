import { decodeFunctionData } from "viem";
import { launchAndBuyAbi, PONS, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const hash = process.argv[2] as `0x${string}`;
if (!hash) {
  console.log("usage: inspect-launch-tx <txHash>");
  process.exit(1);
}

const tx = await publicClient.getTransaction({ hash });
console.log(`tx       ${hash}`);
console.log(`from     ${tx.from}`);
console.log(`to       ${tx.to}`);
console.log(`value    ${tx.value} wei`);
console.log("");

if (tx.to && tx.to.toLowerCase() === PONS.launchAndBuy.toLowerCase()) {
  console.log("→ launched via Larper's atomic launchAndBuy router");
  try {
    const decoded = decodeFunctionData({ abi: launchAndBuyAbi, data: tx.input });
    const args = decoded.args as readonly unknown[];
    console.log(`function   ${decoded.functionName}`);
    console.log(`pairToken  ${String(args[2])}`);
    console.log(`quoteIn    ${String(args[3])}`);
    console.log(`recipient  ${String(args[5])}`);
    console.log(`exemptions ${JSON.stringify(args[6] ?? [])}`);
  } catch (err) {
    console.log(`decode failed: ${(err as Error).message}`);
  }
} else if (tx.to && tx.to.toLowerCase() === PONS.factory.toLowerCase()) {
  console.log("→ launched DIRECTLY on the pons factory (not through Larper)");
  console.log("  ⇒ no snipe-tax exemption list was applied");
} else {
  console.log("→ launched through some other contract (not Larper, not the factory)");
}
