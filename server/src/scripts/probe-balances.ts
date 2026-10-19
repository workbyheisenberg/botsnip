import { formatEther, formatUnits, type Address } from "viem";
import { erc20Abi, PONS, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";

loadDB();
installDohResolver();

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address;
const db = getDB();

const escrowAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOfToken", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

console.log("watched launch wallets:");
for (const w of db.watched) console.log(`  ${w.label} ${w.address} enabled=${w.enabled}`);

console.log("\nbuying wallet balances:");
for (const b of db.buying) {
  const addr = b.address as Address;
  const [eth, usdg, allowanceEscrow] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [addr] }) as Promise<bigint>,
    publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [addr, PONS.launchAndBuy] }) as Promise<bigint>,
  ]);
  console.log(`  ${b.label} ${addr} enabled=${b.enabled}`);
  console.log(`    ETH  ${formatEther(eth)}`);
  console.log(`    USDG ${formatUnits(usdg, 6)}   (allowance to launchAndBuy: ${formatUnits(allowanceEscrow, 6)})`);
}

console.log("\ncreator-fee escrow (pons):");
const extra = [
  ["drytest (past launcher)", "0x8b2C28eA180be9de7b7e2EdC479FAA4667CB0C12"],
  ["alascraft (watched)", "0x6F4917fd0d480FD424EF72a64FAEB675ea47EED1"],
] as const;
const all: Array<readonly [string, string]> = [
  ...db.buying.map((b) => [b.label, b.address] as const),
  ...extra,
];
for (const [label, raw] of all) {
  const addr = raw as Address;
  const [ethOwed, usdgOwed] = await Promise.all([
    publicClient.readContract({ address: PONS.feeEscrow, abi: escrowAbi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: PONS.feeEscrow, abi: escrowAbi, functionName: "balanceOfToken", args: [addr, USDG] }),
  ]);
  console.log(`  ${label}: ${formatEther(ethOwed as bigint)} ETH claimable, ${formatUnits(usdgOwed as bigint, 6)} USDG claimable`);
}
