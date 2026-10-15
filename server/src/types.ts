export type Mode = "dry-run" | "live";

export interface WatchedWallet {
  id: string;
  /** Address whose launches we react to. This is our own launch wallet. */
  address: string;
  label: string;
  enabled: boolean;
  createdAt: number;
}

export interface BuyingWallet {
  id: string;
  /** Address that sends the buy transaction. */
  address: string;
  label: string;
  /** AES-256-GCM encrypted private key. Never exposed to the UI. */
  encryptedKey: string;
  /** ETH this specific wallet spends per launch (native-ETH pairs). */
  amountEth: string;
  /** Pair-token amount this wallet spends per launch (e.g. USDG). */
  amountQuote: string;
  enabled: boolean;
  createdAt: number;
}

export interface Settings {
  /** "dry-run" logs what it would do; "live" sends real transactions. */
  mode: Mode;
  /** Master arm switch. Buying only happens when this AND mode=live. */
  autoBuyEnabled: boolean;
  /** Default spend applied to newly added buying wallets. */
  buyAmountEth: string;
  /** Slippage tolerance in basis points (1500 = 15%). */
  slippageBps: number;
  /** Refuse to buy launches paired against anything other than native ETH. */
  nativePairOnly: boolean;
  /** Refuse a buy if the recipient would be hit by the opening snipe tax above this (bps). */
  maxSnipeTaxBps: number;
  /** Notify on EVERY launch (monitor only — never buys). Useful for testing. */
  watchAllLaunches: boolean;

  /** Telegram alerting. */
  telegramEnabled: boolean;
  telegramChatId: string;
  notifyLaunches: boolean;
  notifyBuys: boolean;
  notifySkips: boolean;
  notifyErrors: boolean;
}

export type ActivityKind = "launch" | "buy" | "skip" | "error" | "info";
export type ActivityLevel = "info" | "success" | "warn" | "error";

export interface ActivityItem {
  id: string;
  ts: number;
  kind: ActivityKind;
  level: ActivityLevel;
  title: string;
  detail?: string;
  token?: string;
  tokenSymbol?: string;
  deployer?: string;
  curve?: string;
  txHash?: string;
  amountEth?: string;
}

export interface Stats {
  launchesSeen: number;
  matches: number;
  buys: number;
  skipped: number;
}

export interface Vault {
  /** Encrypted Telegram bot token. */
  telegramBotToken?: string;
}

export interface DB {
  watched: WatchedWallet[];
  buying: BuyingWallet[];
  settings: Settings;
  activity: ActivityItem[];
  stats: Stats;
  vault: Vault;
  /** Last block scanned by the watcher, as a string (bigint-safe). */
  lastBlock?: string;
}
