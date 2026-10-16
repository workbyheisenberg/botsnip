import fs from "node:fs";
import crypto from "node:crypto";
import { DATA_DIR, DB_FILE } from "./config.js";
import { publish } from "./bus.js";
import type { ActivityItem, ActivityKind, ActivityLevel, DB, Settings } from "./types.js";

const DEFAULT_SETTINGS: Settings = {
  mode: "dry-run",
  autoBuyEnabled: false,
  buyAmountEth: "0.02",
  slippageBps: 1500,
  nativePairOnly: true,
  maxSnipeTaxBps: 100,
  watchAllLaunches: false,
  priorityFeeGwei: "0",
  gasLimit: "0",
  rpcUrl: "",
  wsUrl: "",
  rpcBatch: true,
  telegramEnabled: false,
  telegramChatId: "",
  notifyLaunches: true,
  notifyBuys: true,
  notifySkips: false,
  notifyErrors: true,
};

const MAX_ACTIVITY = 400;

function defaults(): DB {
  return {
    watched: [],
    buying: [],
    settings: { ...DEFAULT_SETTINGS },
    activity: [],
    stats: { launchesSeen: 0, matches: 0, buys: 0, skipped: 0 },
    vault: {},
  };
}

let db: DB = defaults();

export function loadDB(): DB {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Partial<DB>;
      db = {
        ...defaults(),
        ...raw,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        stats: { ...defaults().stats, ...(raw.stats ?? {}) },
        watched: raw.watched ?? [],
        buying: (raw.buying ?? []).map((b) => ({
          ...b,
          amountEth: b.amountEth ?? DEFAULT_SETTINGS.buyAmountEth,
          amountQuote: b.amountQuote ?? "0",
        })),
        activity: raw.activity ?? [],
        vault: raw.vault ?? {},
      } as DB;
    } else {
      db = defaults();
      saveDB();
    }
  } catch {
    db = defaults();
  }
  return db;
}

export function getDB(): DB {
  return db;
}

export function saveDB(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function updateSettings(patch: Partial<Settings>): Settings {
  db.settings = { ...db.settings, ...patch };
  saveDB();
  publish("status", db.settings);
  return db.settings;
}

interface ActivityInput {
  kind: ActivityKind;
  level?: ActivityLevel;
  title: string;
  detail?: string;
  token?: string;
  tokenSymbol?: string;
  deployer?: string;
  curve?: string;
  txHash?: string;
  amountEth?: string;
}

export function pushActivity(input: ActivityInput): ActivityItem {
  const item: ActivityItem = {
    id: newId(),
    ts: Date.now(),
    level: input.level ?? "info",
    ...input,
  };
  db.activity.unshift(item);
  if (db.activity.length > MAX_ACTIVITY) db.activity.length = MAX_ACTIVITY;
  saveDB();
  publish("activity", item);
  return item;
}

export interface PublicState {
  watched: Array<{ id: string; address: string; label: string; enabled: boolean; createdAt: number }>;
  buying: Array<{
    id: string;
    address: string;
    label: string;
    enabled: boolean;
    createdAt: number;
    amountEth: string;
    amountQuote: string;
    hasKey: boolean;
  }>;
  settings: Settings;
  stats: DB["stats"];
  telegramConfigured: boolean;
}

/** Strips encrypted keys before anything is sent to the browser. */
export function publicState(): PublicState {
  return {
    watched: db.watched.map((w) => ({ ...w })),
    buying: db.buying.map((b) => ({
      id: b.id,
      address: b.address,
      label: b.label,
      enabled: b.enabled,
      createdAt: b.createdAt,
      amountEth: b.amountEth,
      amountQuote: b.amountQuote,
      hasKey: Boolean(b.encryptedKey),
    })),
    settings: { ...db.settings },
    stats: { ...db.stats },
    telegramConfigured: Boolean(db.vault?.telegramBotToken),
  };
}
