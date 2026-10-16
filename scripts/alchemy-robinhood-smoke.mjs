// Alchemy → Robinhood Chain smoke test.
// Reads ALCHEMY_API_KEY from the repo-root .env and calls eth_getBalance.
//
//   node scripts/alchemy-robinhood-smoke.mjs
//
// Never prints the API key.

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* fall through to the explicit check below */
  }
}

const key = process.env.ALCHEMY_API_KEY?.trim();
if (!key) {
  console.error("✖ ALCHEMY_API_KEY is not set.");
  console.error("  Add it to .env at the repo root:");
  console.error("      ALCHEMY_API_KEY=your_key_here");
  console.error("  (.env is already git-ignored.)");
  process.exit(1);
}

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const url = `https://robinhood-mainnet.g.alchemy.com/v2/${key}`;

console.log("Calling eth_getBalance on Robinhood Chain (chain 4663)...");

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [VITALIK, "latest"],
    }),
  });
} catch (err) {
  console.error("✖ Network error:", err.message);
  process.exit(1);
}

const text = await res.text();
console.log("HTTP status:", res.status);

let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("✖ Non-JSON response (check the key / endpoint):", text.slice(0, 300));
  process.exit(1);
}

if (json.error) {
  console.error("✖ JSON-RPC error:", JSON.stringify(json.error));
  process.exit(1);
}

if (typeof json.result !== "string") {
  console.error("✖ Unexpected result:", JSON.stringify(json).slice(0, 300));
  process.exit(1);
}

const wei = BigInt(json.result);
const whole = wei / 10n ** 18n;
const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);

console.log("");
console.log("  address :", VITALIK, "(vitalik.eth)");
console.log("  network : Robinhood Chain (4663)");
console.log("  balance :", `${whole}.${frac} ETH`);
console.log("  wei     :", wei.toString());
console.log("");
console.log("✔ Success — check your Alchemy dashboard, the request is logged there.");
