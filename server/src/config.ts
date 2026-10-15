import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** server/ directory */
export const SERVER_ROOT = path.resolve(__dirname, "..");
/** repository root (one level above server/) */
export const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

// Load env from the repo root first, then allow a server-local override.
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config();

export const DATA_DIR = path.join(SERVER_ROOT, "data");
export const DB_FILE = path.join(DATA_DIR, "db.json");
export const SECRETS_FILE = path.join(DATA_DIR, ".secrets.json");
export const WEB_DIST = path.join(REPO_ROOT, "web", "dist");

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 8787),
  /** HTTP RPC endpoint for Robinhood Chain */
  rpcUrl: process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
  /** Optional WebSocket endpoint (paid providers). Empty = poll instead. */
  wsUrl: process.env.ROBINHOOD_WS_URL?.trim() || "",
  teamPassword: process.env.TEAM_PASSWORD?.trim() || "changeme",
  /** Optional explicit master key. If empty one is generated and stored. */
  masterKey: process.env.MASTER_KEY?.trim() || "",
  pollIntervalMs: num(process.env.POLL_INTERVAL_MS, 2000),
  /** How many blocks can be requested in a single eth_getLogs on the public RPC */
  logChunkSize: num(process.env.LOG_CHUNK_SIZE, 900),
  /** Look back this many blocks on first boot so we don't miss a just-launched token */
  startLookbackBlocks: num(process.env.START_LOOKBACK_BLOCKS, 50),
  isProd: process.env.NODE_ENV === "production",
  /** Resolve hostnames over DNS-over-HTTPS to bypass ISP DNS filtering. */
  dohEnabled: (process.env.DNS_OVER_HTTPS ?? "true").toLowerCase() !== "false",
  dohUrl: process.env.DOH_RESOLVER_URL?.trim() || "https://cloudflare-dns.com/dns-query",
};
