import { formatUnits, parseAbiItem, parseEventLogs, type Address } from "viem";
import { curveAbi, factoryAbi, PONS, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const buyHash = process.argv[2] as `0x${string}`;
const tokenRaw = process.argv[3];
if (!buyHash || !tokenRaw) {
  console.log("usage: inspect-buy-tx <buyTxHash> <launchToken>");
  process.exit(1);
}
const token = tokenRaw.toLowerCase() as Address;

// Resolve the authoritative curve from the factory (the activity field can be
// display-truncated).
const launch = (await publicClient.readContract({
  address: PONS.factory,
  abi: factoryAbi,
  functionName: "getLaunchedToken",
  args: [token],
})) as { curve: Address; pairToken: Address };
const curve = launch.curve.toLowerCase() as Address;

console.log(`token     ${token}`);
console.log(`pairToken ${launch.pairToken}`);

const curveBuyEvent = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);

const [feeBps, creatorTaxBps, receipt] = await Promise.all([
  publicClient.readContract({ address: curve, abi: curveAbi, functionName: "feeBps" }) as Promise<bigint>,
  publicClient.readContract({ address: curve, abi: curveAbi, functionName: "creatorTaxBps" }) as Promise<bigint>,
  publicClient.getTransactionReceipt({ hash: buyHash }),
]);

console.log(`buy tx    ${buyHash}`);
console.log(`status    ${receipt.status}`);
console.log(`block     ${receipt.blockNumber}`);
console.log(`curve     ${curve}`);
console.log(`base feeBps   ${feeBps}`);
console.log(`creator taxBps ${creatorTaxBps}`);
console.log("");

const parsed = parseEventLogs({ abi: [curveBuyEvent], logs: receipt.logs });
for (const p of parsed) {
  const a = p.args as unknown as {
    buyer: string;
    recipient: string;
    quoteIn: bigint;
    tokensOut: bigint;
    fee: bigint;
    tax: bigint;
  };
  const spend = Number(a.quoteIn);
  const feeBpsObserved = spend > 0 ? (Number(a.fee) / spend) * 10_000 : 0;
  console.log("CurveBuy");
  console.log(`  buyer      ${a.buyer}`);
  console.log(`  recipient  ${a.recipient}`);
  console.log(`  quoteIn    ${formatUnits(a.quoteIn, 18)} ETH`);
  console.log(`  tokensOut  ${formatUnits(a.tokensOut, 18)} tokens`);
  console.log(`  fee paid   ${formatUnits(a.fee, 18)} ETH  (${feeBpsObserved.toFixed(0)} bps of spend)`);
  console.log(`  tax paid   ${formatUnits(a.tax, 18)} ETH`);
  console.log(
    `  ⇒ snipe-tax portion ≈ ${(feeBpsObserved - Number(feeBps)).toFixed(0)} bps (fee includes base fee + snipe tax)`,
  );
}
