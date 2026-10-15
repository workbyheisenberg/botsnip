import dns from "node:dns";
import { config } from "./config.js";

/**
 * Some networks (e.g. ISPs that hijack blockchain RPC domains via DNS
 * filtering) resolve `rpc.mainnet.chain.robinhood.com` to a block page.
 * This shim resolves hostnames over DNS-over-HTTPS instead, so the node can
 * still reach the real endpoint. Falls back to the system resolver on any
 * failure, so it is safe everywhere.
 */

interface CacheEntry {
  ips: string[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const realLookup = dns.lookup.bind(dns) as unknown as (...args: unknown[]) => void;
let dohHost = "";

async function resolveViaDoh(hostname: string): Promise<string[]> {
  const cached = cache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.ips;

  const url = `${config.dohUrl}?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);

  const json = (await res.json()) as {
    Answer?: Array<{ type: number; data: string; TTL?: number }>;
  };
  const answers = json.Answer ?? [];
  const ips = answers.filter((r) => r.type === 1).map((r) => r.data);
  const ttl = Math.min(...answers.map((r) => r.TTL ?? 60), 60);

  cache.set(hostname, { ips, expires: Date.now() + Math.max(5, ttl) * 1000 });
  return ips;
}

export function installDohResolver(): void {
  if (!config.dohEnabled) {
    console.log("[dns] DNS-over-HTTPS resolver disabled (using system DNS)");
    return;
  }
  try {
    dohHost = new URL(config.dohUrl).hostname;
  } catch {
    console.warn("[dns] invalid DOH_RESOLVER_URL — keeping system DNS");
    return;
  }

  const patched = (hostname: string, options: unknown, callback?: unknown) => {
    let opts = options as Record<string, unknown> | ((...a: unknown[]) => void);
    let cb = callback as ((...a: unknown[]) => void) | undefined;
    if (typeof opts === "function") {
      cb = opts as (...a: unknown[]) => void;
      opts = {};
    }
    const resolvedOpts = (opts as Record<string, unknown>) ?? {};

    if (hostname === dohHost || resolvedOpts.family === 6 || typeof cb !== "function") {
      return realLookup(hostname, resolvedOpts, cb);
    }

    resolveViaDoh(hostname)
      .then((ips) => {
        if (!ips.length) return realLookup(hostname, resolvedOpts, cb);
        if (resolvedOpts.all) {
          cb!(null, ips.map((address) => ({ address, family: 4 })));
        } else {
          cb!(null, ips[0], 4);
        }
      })
      .catch(() => realLookup(hostname, resolvedOpts, cb!));
  };

  (dns as unknown as { lookup: unknown }).lookup = patched;
  console.log(`[dns] DNS-over-HTTPS resolver active (${dohHost})`);
}
