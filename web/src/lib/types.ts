export type Mode = "dry-run" | "live";

export interface WatchedWallet {
  id: string;
  address: string;
  label: string;
  enabled: boolean;
  createdAt: number;
}

export interface BuyingWallet {
  id: string;
  address: string;
  label: string;
  enabled: boolean;
  createdAt: number;
  amountEth: string;
  amountQuote: string;
  hasKey: boolean;
}

export interface Settings {
  mode: Mode;
  autoBuyEnabled: boolean;
  buyAmountEth: string;
  slippageBps: number;
  nativePairOnly: boolean;
  maxSnipeTaxBps: number;
  watchAllLaunches: boolean;
  priorityFeeGwei: string;
  gasLimit: string;
  rpcUrl: string;
  wsUrl: string;
  rpcBatch: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
  notifyLaunches: boolean;
  notifyBuys: boolean;
  notifySkips: boolean;
  notifyErrors: boolean;
}

export interface Stats {
  launchesSeen: number;
  matches: number;
  buys: number;
  skipped: number;
}

export interface ActivityItem {
  id: string;
  ts: number;
  kind: "launch" | "buy" | "skip" | "error" | "info";
  level: "info" | "success" | "warn" | "error";
  title: string;
  detail?: string;
  token?: string;
  tokenSymbol?: string;
  deployer?: string;
  curve?: string;
  txHash?: string;
  amountEth?: string;
}

export interface AppState {
  watched: WatchedWallet[];
  buying: BuyingWallet[];
  settings: Settings;
  stats: Stats;
  telegramConfigured: boolean;
}

export interface LaunchConfigView {
  id: string;
  supply: string;
  curveFeeBps: number;
  phantomQuote: string;
  graduationThreshold: string;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
}

export interface LaunchInfo {
  launchFee: string;
  maxCreatorTaxBps: number;
  configs: LaunchConfigView[];
  canLaunch: Record<string, boolean>;
  wallets: Array<{ id: string; address: string; label: string; hasKey: boolean; enabled: boolean }>;
}

export interface LaunchPlan {
  totalCostEth: string;
  launchFeeEth: string;
  buyEth: string;
  expectedTokens: string;
  minTokensOut: string;
  recipient: string;
  exemptions: string[];
  pairToken: string;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
  plan?: LaunchPlan;
  txHash?: string;
  token?: string;
  curve?: string;
}

export interface LaunchRequest {
  name: string;
  symbol: string;
  description?: string;
  logo?: string;
  socials?: Record<string, string>;
  launchConfigId: string;
  pairToken?: string;
  buyAmountEth: string;
  creatorTaxBps?: number;
  buybackEnabled?: boolean;
  creatorFeeRecipient?: string;
  signerWalletId: string;
  extraExemptions?: string[];
  dryRun: boolean;
}

export interface StatusInfo {
  chain: { id: number; rpc: string; connectedChainId: number | null; head: string | null };
  pons: { factory: string; launchAndBuy: string };
  watcher: {
    running: boolean;
    connected: boolean;
    transport: "websocket" | "polling" | "idle";
    logsPush: boolean;
    head: string;
    scanned: string;
    lastError: string | null;
    lastPollAt: number;
    launchesSeen: number;
  };
  stats: Stats;
  websocket: boolean;
}
