import { publicClient, erc20Abi } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { loadDB } from "../store.js";

loadDB();
installDohResolver();

const token = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
const read = (fn: "name" | "symbol" | "decimals") =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: fn });

const [name, symbol, decimals] = await Promise.all([read("name"), read("symbol"), read("decimals")]);
console.log(`pair token ${token}`);
console.log(`  name     ${name}`);
console.log(`  symbol   ${symbol}`);
console.log(`  decimals ${decimals}`);
