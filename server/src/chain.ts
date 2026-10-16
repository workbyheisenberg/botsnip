import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseAbiItem,
  webSocket,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { getDB, pushActivity, saveDB } from "./store.js";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
});

/** RPC URL in effect: the UI setting overrides the .env value when set. */
export function effectiveRpcUrl(): string {
  try {
    const url = getDB()?.settings?.rpcUrl?.trim();
    if (url) return url;
  } catch {
    /* store not ready */
  }
  return config.rpcUrl;
}

/** WebSocket URL in effect (empty = no push feed, polling instead). */
export function effectiveWsUrl(): string {
  try {
    const url = getDB()?.settings?.wsUrl?.trim();
    if (url) return url;
  } catch {
    /* store not ready */
  }
  return config.wsUrl;
}

function makeHttpClient(url: string): PublicClient {
  // `batch: true` aggregates all JSON-RPC calls made in the same tick into a
  // single HTTP request. The buy path reads ~9 curve fields at once, so this
  // cuts several round-trips per buy. Auto-disabled if the endpoint rejects it.
  let batch = true;
  try {
    batch = getDB()?.settings?.rpcBatch !== false;
  } catch {
    /* default to true */
  }
  return createPublicClient({ chain: robinhoodChain, transport: http(url, { batch }) });
}

/**
 * Verify the RPC accepts batched JSON-RPC. Some endpoints (e.g. Blockmachine's
 * HTTP node) return a single object instead of an array and blow up. If so,
 * turn batching off automatically so reads/buys keep working.
 */
export async function ensureBatchSupport(): Promise<void> {
  let enabled = true;
  try {
    enabled = getDB()?.settings?.rpcBatch !== false;
  } catch {
    /* ignore */
  }
  if (!enabled) return;

  const url = effectiveRpcUrl();
  try {
    const probe = createPublicClient({ chain: robinhoodChain, transport: http(url, { batch: true }) });
    // Must exercise eth_call specifically — the buy path is dominated by
    // concurrent contract reads, and some endpoints only choke on batched calls.
    await Promise.all([
      probe.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchFee" }),
      probe.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "launchConfigCount" }),
      probe.readContract({ address: PONS.factory, abi: factoryAbi, functionName: "maxCreatorTaxBps" }),
    ]);
  } catch {
    const db = getDB();
    db.settings.rpcBatch = false;
    saveDB();
    pushActivity({
      kind: "info",
      level: "warn",
      title: "RPC rejected request batching — disabled",
      detail: `${url} does not support batched JSON-RPC. Speed reads are unbatched. Switch to a provider that supports batching (e.g. Alchemy) and re-enable it in Settings.`,
    });
  }
}

/** HTTP client for reads, getLogs, receipts, balances. */
export let publicClient: PublicClient = makeHttpClient(config.rpcUrl);

/** Optional WebSocket client used only for the live push feed. */
export let wsClient: PublicClient | null = null;

/** Rebuild both clients from the current effective URLs. */
export function rebuildClients(): { rpc: string; ws: string } {
  const rpc = effectiveRpcUrl();
  const ws = effectiveWsUrl();
  publicClient = makeHttpClient(rpc);
  wsClient = ws
    ? createPublicClient({
        chain: robinhoodChain,
        transport: webSocket(ws, { keepAlive: true, retryCount: 8 }),
      })
    : null;
  return { rpc, ws };
}

export interface GasOverrides {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gas?: bigint;
}

/** Build fee/gas overrides from the site settings (priority fee, gas limit). */
export async function gasOverrides(): Promise<GasOverrides> {
  const overrides: GasOverrides = {};
  let settings: { priorityFeeGwei?: string; gasLimit?: string } = {};
  try {
    settings = getDB()?.settings ?? {};
  } catch {
    return overrides;
  }

  const priority = toGwei(settings.priorityFeeGwei);
  if (priority > 0n) {
    try {
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const base = block.baseFeePerGas ?? 0n;
      overrides.maxPriorityFeePerGas = priority;
      overrides.maxFeePerGas = base * 2n + priority;
    } catch {
      overrides.maxPriorityFeePerGas = priority;
    }
  }

  const gas = toBigInt(settings.gasLimit);
  if (gas > 0n) overrides.gas = gas;

  return overrides;
}

function toGwei(value: string | undefined): bigint {
  try {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 1e9));
  } catch {
    return 0n;
  }
}

function toBigInt(value: string | undefined): bigint {
  try {
    if (!value || !/^\d+$/.test(value.trim())) return 0n;
    return BigInt(value.trim());
  } catch {
    return 0n;
  }
}

/** pons v2 deployment on Robinhood Chain (chain id 4663). */
export const PONS = {
  chainId: 4663,
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address,
  memeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044" as Address,
  feeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e" as Address,
  buybackVault: "0x42df2a798f82289E177311362e8f5ccC45c1219c" as Address,
  launchLocker: "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952" as Address,
  launchAndBuy: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948" as Address,
  launchDeployer: "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42" as Address,
  graduationExecutor: "0xC7819B64A1dAECD7eC19856d026cb14EfBd89046" as Address,
  graduationGuard: "0xf5695117b99B6f6401e67d4195BD653628176C6C" as Address,
} as const;

/** Factory event emitted for every new launch, including the curve and deployer. */
export const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);

export const factoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function canLaunch(address account) view returns (bool)",
  "function launchFee() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function approvedPairTokens(address pairToken) view returns (bool)",
  "function pairTokenEconomics(address pairToken) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);

/** Atomic "launch and buy in one transaction" router. */
export const launchAndBuyAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",
]);

export const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function isNativeQuote() view returns (bool)",
  "function pairToken() view returns (address)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function tokenReserve() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function reservedTokens() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
  "function graduated() view returns (bool)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function buybackEnabled() view returns (bool)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const tokenAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

export function makeWalletClient(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  let batch = true;
  try {
    batch = getDB()?.settings?.rpcBatch !== false;
  } catch {
    /* default */
  }
  const wallet = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(effectiveRpcUrl(), { batch }),
  });
  return { account, wallet };
}

export function explorerTx(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}
