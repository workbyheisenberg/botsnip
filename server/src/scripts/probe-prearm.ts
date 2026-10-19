// Verifies the pre-arm mechanism: simulate launchAndBuy with a throwaway salt
// and confirm it returns concrete token + curve addresses we could pre-sign
// buys against. Nothing is sent.
import { randomBytes } from "node:crypto";
import { parseUnits, toHex, type Address } from "viem";
import { factoryAbi, launchAndBuyAbi, PONS, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";

loadDB();
installDohResolver();

const db = getDB();
const signer = db.buying.find((b) => b.enabled && b.encryptedKey) ?? db.buying[0];
if (!signer) {
  console.log("no buying wallet");
  process.exit(1);
}

const [launchFee, config] = await Promise.all([
  publicClient.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchFee" }) as Promise<bigint>,
  publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "getLaunchConfig",
    args: [0n],
  }) as Promise<{ supply: bigint; curveFeeBps: bigint; phantomQuote: bigint; graduationThreshold: bigint }>,
]);
const expectedEconomics = (await publicClient.readContract({
  address: PONS.factory,
  abi: factoryAbi,
  functionName: "previewLaunchEconomics",
  args: [0n, "0x0000000000000000000000000000000000000000"],
})) as `0x${string}`;

const quoteIn = parseUnits("0.0003", 18);
const params = {
  name: "Prearm Probe",
  symbol: "PARM",
  logo: "",
  description: "",
  socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
  creatorFeeRecipient: signer.address as Address,
  creatorTaxBps: 0,
  buybackEnabled: false,
  expectedEconomics,
  salt: toHex(randomBytes(32)),
} as const;

const sim = await publicClient.simulateContract({
  address: PONS.launchAndBuy,
  abi: launchAndBuyAbi,
  functionName: "launchAndBuy",
  args: [
    params,
    BigInt(0),
    "0x0000000000000000000000000000000000000000",
    quoteIn,
    0n,
    signer.address as Address,
    [],
  ],
  value: launchFee + quoteIn,
  account: signer.address as Address,
});

const [token, curve, tokensOut] = sim.result as readonly [Address, Address, bigint];
console.log("simulation OK (nothing sent)");
console.log(`  launchFee   ${launchFee}`);
console.log(`  config      supply=${config.supply} feeBps=${config.curveFeeBps}`);
console.log(`  predicted token  ${token}`);
console.log(`  predicted curve  ${curve}`);
console.log(`  tokensOut        ${tokensOut}`);
console.log("");
console.log("→ pre-signing a buy against this curve is therefore possible before launch.");
