// Temporary diagnostic: does the configured HTTP RPC accept batched JSON-RPC?
// Reads the URL from server/data/db.json. Never prints the key.

import { readFileSync } from "node:fs";

const db = JSON.parse(readFileSync("server/data/db.json", "utf8"));
const url = (db.settings?.rpcUrl || process.env.ROBINHOOD_RPC_URL || "").trim();
if (!url) {
  console.log("no rpcUrl in settings");
  process.exit(1);
}

const masked = url.replace(/\/v2\/.+$/, "/v2/<KEY>");
console.log("endpoint:", masked);

async function post(body, label) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let summary;
    try {
      const j = JSON.parse(text);
      summary = Array.isArray(j)
        ? `ARRAY of ${j.length}: ` + j.map((r) => (r.error ? `ERR(${r.error.message})` : "ok")).join(", ")
        : j.error
          ? `ERROR: ${j.error.message}`
          : `ok (result ${String(JSON.stringify(j.result)).slice(0, 40)})`;
    } catch {
      summary = `NON-JSON: ${text.slice(0, 200)}`;
    }
    console.log(`  ${label} -> HTTP ${res.status} | ${summary}`);
  } catch (err) {
    console.log(`  ${label} -> network error: ${err.message}`);
  }
}

const addr = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

await post({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, "single eth_blockNumber");
await post({ jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{ address: addr, fromBlock: "latest", toBlock: "latest" }] }, "single eth_getLogs");
await post(
  [
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] },
  ],
  "batch of 2 (blockNumber+chainId)",
);
await post(
  [
    { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: addr, fromBlock: "latest", toBlock: "latest" }] },
    { jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{ address: addr, fromBlock: "latest", toBlock: "latest" }] },
  ],
  "batch of 2 (getLogs x2)",
);
await post(
  Array.from({ length: 9 }, (_, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_call",
    params: [{ to: addr, data: "0xdc08e094" }, "latest"], // isNativeQuote-ish selector
  })),
  "batch of 9 (eth_call)",
);
