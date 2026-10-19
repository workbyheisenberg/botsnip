// Measures the SENDING path (no broadcast): for N wallets, how many HTTP
// requests does the prepare/sign/send sequence actually make, and how long
// does it take? This decides whether multi-wallet is slow by construction.
import { decryptSecret } from "../crypto.js";
import { makeWalletClient, publicClient } from "../chain.js";
import { installDohResolver } from "../doh.js";
import { getDB, loadDB } from "../store.js";
import { generatePrivateKey } from "viem/accounts";
import type { Address } from "viem";

loadDB();
installDohResolver();

// ── instrument global fetch: count requests AND json-rpc calls ──────────────
let requests = 0;
let rpcCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  requests += 1;
  try {
    const body = init?.body;
    if (typeof body === "string") {
      const parsed = JSON.parse(body) as unknown;
      rpcCalls += Array.isArray(parsed) ? parsed.length : 1;
    } else {
      rpcCalls += 1;
    }
  } catch {
    rpcCalls += 1;
  }
  return realFetch(input as never, init as never);
}) as typeof fetch;

const db = getDB();
const buying = db.buying.filter((b) => b.encryptedKey);
if (buying.length < 2) {
  console.log(`need at least 2 buying wallets with keys; found ${buying.length}`);
}
const wallets = buying.map((b) => {
  const { wallet, account } = makeWalletClient(decryptSecret(b.encryptedKey) as `0x${string}`);
  return { label: b.label, address: b.address as Address, wallet, account };
});

// Pad with synthetic (unfunded) accounts so we can measure N>1 network shape.
// These are throwaway keys; nothing is ever broadcast.
for (let i = wallets.length; i < 3; i += 1) {
  const pk = generatePrivateKey();
  const { wallet, account } = makeWalletClient(pk);
  wallets.push({ label: `synth${i}`, address: account.address, wallet, account });
}

const TO: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"; // pons factory (any target)

async function timed(label: string, fn: () => Promise<unknown>): Promise<void> {
  await fn(); // warm-up (also opens connections)
  await new Promise((r) => setTimeout(r, 400));
  const runs: number[] = [];
  let reqs = 0;
  let calls = 0;
  for (let i = 0; i < 3; i += 1) {
    requests = 0;
    rpcCalls = 0;
    const t0 = performance.now();
    await fn();
    runs.push(performance.now() - t0);
    reqs = Math.max(reqs, requests);
    calls = Math.max(calls, rpcCalls);
    await new Promise((r) => setTimeout(r, 250));
  }
  runs.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(52)} ${String(reqs).padStart(2)} HTTP   ${String(calls).padStart(2)} calls   median ${runs[1].toFixed(0).padStart(4)} ms`,
  );
}

console.log(`\nwallets: ${wallets.map((w) => w.label).join(", ")}\n`);

for (const n of [1, 2, 3]) {
  const set = wallets.slice(0, n);

  // 1) Shared client reads (this is what our reactor uses for curve/balance).
  await timed(`SHARED client: ${n}x getBalance (batched)`, () =>
    Promise.all(set.map((w) => publicClient.getBalance({ address: w.address }))),
  );

  // 2) Per-wallet client prepare (nonce fetch through the wallet's OWN transport).
  await timed(`PER-WALLET transport: ${n}x prepareTransactionRequest`, () =>
    Promise.all(
      set.map((w) =>
        w.wallet.prepareTransactionRequest({
          to: TO,
          value: 0n,
          data: "0x" as const,
          account: w.account,
          chain: w.wallet.chain,
          gas: 500_000n,
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
        }),
      ),
    ),
  );

  // 3) Per-wallet local signing (no network).
  await timed(`LOCAL sign only: ${n}x signTransaction`, () =>
    Promise.all(
      set.map(async (w) => {
        const req = await w.wallet.prepareTransactionRequest({
          to: TO,
          value: 0n,
          data: "0x" as const,
          account: w.account,
          chain: w.wallet.chain,
          gas: 500_000n,
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          nonce: 0,
        });
        return w.account.signTransaction(req);
      }),
    ),
  );
  console.log("");
}
