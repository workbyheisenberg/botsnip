import { formatUnits, type Address } from "viem";
import { factoryAbi, PONS, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";

loadDB();
installDohResolver();

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address;

const [launchFee, maxTax, count] = await Promise.all([
  publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchFee" }),
  publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "maxCreatorTaxBps" }),
  publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchConfigCount" }),
]);

console.log(`launchFee        ${formatUnits(launchFee as bigint, 18)} ETH  (${launchFee})`);
console.log(`maxCreatorTaxBps ${maxTax}`);
console.log(`launchConfigs    ${count}\n`);

for (let id = 0; id < Number(count); id += 1) {
  const c = (await publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "getLaunchConfig",
    args: [BigInt(id)],
  })) as {
    supply: bigint;
    curveFeeBps: bigint;
    phantomQuote: bigint;
    graduationThreshold: bigint;
    poolFee: number;
    tickSpacing: number;
    enabled: boolean;
  };
  console.log(`config #${id}  enabled=${c.enabled}`);
  console.log(`  supply               ${formatUnits(c.supply, 18)}`);
  console.log(`  curveFeeBps          ${c.curveFeeBps}`);
  console.log(`  phantomQuote (ETH)   ${formatUnits(c.phantomQuote, 18)} ETH`);
  console.log(`  graduationThreshold  ${formatUnits(c.graduationThreshold, 18)} ETH`);
  console.log(`  poolFee=${c.poolFee} tickSpacing=${c.tickSpacing}`);
}

console.log("\n— quote asset economics —");
for (const [label, asset] of [
  ["native ETH", "0x0000000000000000000000000000000000000000"],
  ["USDG", USDG],
] as const) {
  const approved = (await publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "approvedPairTokens",
    args: [asset as Address],
  })) as boolean;
  let econ: string;
  try {
    const [phantom, threshold, decimals] = (await publicClient.readContract({
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "pairTokenEconomics",
      args: [asset as Address],
    })) as readonly [bigint, bigint, number];
    econ = `phantom=${formatUnits(phantom, decimals)}  threshold=${formatUnits(threshold, decimals)}  decimals=${decimals}`;
  } catch (err) {
    econ = `(unreadable: ${(err as Error).message.split("\n")[0]})`;
  }
  console.log(`${label.padEnd(10)} approved=${approved}  ${econ}`);
}

console.log("\n— canLaunch —");
const db = getDB();
for (const w of db.buying) {
  const ok = (await publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "canLaunch",
    args: [w.address as Address],
  })) as boolean;
  console.log(`  ${w.label} ${w.address} → ${ok}`);
}
