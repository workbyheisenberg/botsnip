import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bus } from "./bus.js";
import { encryptSecret } from "./crypto.js";
import { checkPassword, cookieName, cookieOptions, issueToken, verifyToken } from "./auth.js";
import { getDB, newId, publicState, pushActivity, saveDB, updateSettings } from "./store.js";
import { PONS, publicClient } from "./chain.js";
import { scanOnce, restartWatcher, watcherStatus } from "./watcher.js";
import { executeLaunch, getLaunchInfo } from "./launcher.js";
import { sendTelegram } from "./notify.js";
import { config } from "./config.js";

export const api = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[cookieName];
  if (!verifyToken(token)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// ── auth ────────────────────────────────────────────────────────────────

api.post("/auth/login", (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!checkPassword(password)) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  res.cookie(cookieName, issueToken(), cookieOptions);
  res.json({ ok: true });
});

api.post("/auth/logout", (req, res) => {
  res.clearCookie(cookieName, { path: "/" });
  res.json({ ok: true });
});

api.get("/auth/me", (req, res) => {
  res.json({ authenticated: verifyToken(req.cookies?.[cookieName]) });
});

// ── state ───────────────────────────────────────────────────────────────

api.get("/state", requireAuth, (_req, res) => {
  res.json(publicState());
});

api.get("/status", requireAuth, async (_req, res) => {
  const db = getDB();
  let chainId: number | null = null;
  let head: string | null = null;
  try {
    chainId = await publicClient.getChainId();
    head = (await publicClient.getBlockNumber()).toString();
  } catch {
    /* offline */
  }
  res.json({
    chain: { id: 4663, rpc: redact(config.rpcUrl), connectedChainId: chainId, head },
    pons: { factory: PONS.factory, launchAndBuy: PONS.launchAndBuy },
    watcher: watcherStatus(),
    stats: db.stats,
    websocket: Boolean(config.wsUrl),
  });
});

api.post("/scan", requireAuth, async (req, res) => {
  const fromBlock = typeof req.body?.fromBlock === "string" ? req.body.fromBlock.trim() : undefined;
  const toBlock = typeof req.body?.toBlock === "string" ? req.body.toBlock.trim() : undefined;
  if (fromBlock && !/^\d+$/.test(fromBlock)) {
    res.status(400).json({ error: "fromBlock must be a block number" });
    return;
  }
  if (toBlock && !/^\d+$/.test(toBlock)) {
    res.status(400).json({ error: "toBlock must be a block number" });
    return;
  }
  try {
    const result = await scanOnce({ fromBlock, toBlock });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: msg(err) });
  }
});

// ── watched (launch) wallets ──────────────────────────────────────────────

const watchedSchema = z.object({
  address: z.string().refine(isAddress, "Invalid address"),
  label: z.string().max(60).optional().default(""),
});

api.post("/watched", requireAuth, (req, res) => {
  const parsed = watchedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const db = getDB();
  const address = getAddress(parsed.data.address);
  if (db.watched.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
    res.status(409).json({ error: "That launch wallet is already watched" });
    return;
  }
  const wallet = { id: newId(), address, label: parsed.data.label || "Launch wallet", enabled: true, createdAt: Date.now() };
  db.watched.push(wallet);
  saveDB();
  pushActivity({ kind: "info", level: "info", title: `Watching launch wallet ${address}` });
  // Re-subscribe the push feed so the node filters for this wallet.
  restartWatcher().catch(() => {});
  res.json({ ok: true, wallet });
});

api.patch("/watched/:id", requireAuth, (req, res) => {
  const db = getDB();
  const wallet = db.watched.find((w) => w.id === req.params.id);
  if (!wallet) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (typeof req.body?.label === "string") wallet.label = req.body.label.slice(0, 60);
  if (typeof req.body?.enabled === "boolean") wallet.enabled = req.body.enabled;
  saveDB();
  restartWatcher().catch(() => {});
  res.json({ ok: true, wallet });
});

api.delete("/watched/:id", requireAuth, (req, res) => {
  const db = getDB();
  const before = db.watched.length;
  db.watched = db.watched.filter((w) => w.id !== req.params.id);
  saveDB();
  if (before !== db.watched.length) restartWatcher().catch(() => {});
  res.json({ ok: true, removed: before !== db.watched.length });
});

// ── buying wallets ───────────────────────────────────────────────────────

const buyingSchema = z.object({
  label: z.string().max(60).optional().default("Buying wallet"),
  privateKey: z.string().refine((v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()), "Private key must be 0x + 64 hex chars"),
  amountEth: z.string().regex(/^\d*\.?\d+$/, "Amount must be a number").optional(),
  amountQuote: z.string().regex(/^\d*\.?\d+$/, "Amount must be a number").optional(),
});

api.post("/buying", requireAuth, (req, res) => {
  const parsed = buyingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  let address: string;
  try {
    address = privateKeyToAccount(parsed.data.privateKey.trim() as `0x${string}`).address;
  } catch {
    res.status(400).json({ error: "Could not derive an address from that key" });
    return;
  }
  const db = getDB();
  if (db.buying.some((b) => b.address.toLowerCase() === address.toLowerCase())) {
    res.status(409).json({ error: "That buying wallet already exists" });
    return;
  }
  const wallet = {
    id: newId(),
    address,
    label: parsed.data.label || "Buying wallet",
    encryptedKey: encryptSecret(parsed.data.privateKey.trim()),
    amountEth: parsed.data.amountEth ?? db.settings.buyAmountEth,
    amountQuote: parsed.data.amountQuote ?? "0",
    enabled: true,
    createdAt: Date.now(),
  };
  db.buying.push(wallet);
  saveDB();
  pushActivity({ kind: "info", level: "info", title: `Buying wallet added ${address}` });
  res.json({ ok: true, wallet: { ...wallet, encryptedKey: undefined, hasKey: true } });
});

api.patch("/buying/:id", requireAuth, (req, res) => {
  const db = getDB();
  const wallet = db.buying.find((b) => b.id === req.params.id);
  if (!wallet) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (typeof req.body?.label === "string") wallet.label = req.body.label.slice(0, 60);
  if (typeof req.body?.enabled === "boolean") wallet.enabled = req.body.enabled;
  if (typeof req.body?.amountEth === "string" && /^\d*\.?\d+$/.test(req.body.amountEth)) {
    wallet.amountEth = req.body.amountEth;
  }
  if (typeof req.body?.amountQuote === "string" && /^\d*\.?\d+$/.test(req.body.amountQuote)) {
    wallet.amountQuote = req.body.amountQuote;
  }
  if (typeof req.body?.privateKey === "string" && req.body.privateKey.trim()) {
    const pk = req.body.privateKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
      res.status(400).json({ error: "Private key must be 0x + 64 hex chars" });
      return;
    }
    wallet.encryptedKey = encryptSecret(pk);
    wallet.address = privateKeyToAccount(pk as `0x${string}`).address;
  }
  saveDB();
  res.json({ ok: true, wallet: { id: wallet.id, address: wallet.address, label: wallet.label, enabled: wallet.enabled, amountEth: wallet.amountEth, amountQuote: wallet.amountQuote, hasKey: true } });
});

api.delete("/buying/:id", requireAuth, (req, res) => {
  const db = getDB();
  const before = db.buying.length;
  db.buying = db.buying.filter((b) => b.id !== req.params.id);
  saveDB();
  res.json({ ok: true, removed: before !== db.buying.length });
});

// ── settings ──────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  mode: z.enum(["dry-run", "live"]).optional(),
  autoBuyEnabled: z.boolean().optional(),
  buyAmountEth: z.string().regex(/^\d*\.?\d+$/, "Must be a number").optional(),
  slippageBps: z.number().int().min(0).max(9999).optional(),
  nativePairOnly: z.boolean().optional(),
  maxSnipeTaxBps: z.number().int().min(0).max(10000).optional(),
  watchAllLaunches: z.boolean().optional(),
  priorityFeeGwei: z.string().regex(/^\d*\.?\d+$/, "Priority fee must be a number").optional(),
  gasLimit: z.string().regex(/^\d*$/, "Gas limit must be a whole number").optional(),
  rpcUrl: z.string().max(300).optional(),
  wsUrl: z.string().max(300).optional(),
  rpcBatch: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z.string().max(64).optional(),
  notifyLaunches: z.boolean().optional(),
  notifyBuys: z.boolean().optional(),
  notifySkips: z.boolean().optional(),
  notifyErrors: z.boolean().optional(),
});

api.put("/settings", requireAuth, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const before = getDB().settings;
  const networkChanged =
    (parsed.data.rpcUrl !== undefined && parsed.data.rpcUrl !== before.rpcUrl) ||
    (parsed.data.wsUrl !== undefined && parsed.data.wsUrl !== before.wsUrl) ||
    (parsed.data.rpcBatch !== undefined && parsed.data.rpcBatch !== before.rpcBatch) ||
    (parsed.data.watchAllLaunches !== undefined &&
      parsed.data.watchAllLaunches !== before.watchAllLaunches);

  const settings = updateSettings(parsed.data);

  if (networkChanged) {
    pushActivity({
      kind: "info",
      level: "info",
      title: "Reconnecting to chain",
      detail: settings.wsUrl
        ? `WebSocket: ${settings.wsUrl}`
        : settings.rpcUrl
          ? `RPC: ${settings.rpcUrl}`
          : "Using the .env endpoint",
    });
    restartWatcher().catch(() => {});
  }

  res.json({ ok: true, settings });
});

// ── launch (atomic launch + buy) ──────────────────────────────────────────

api.get("/launch/info", requireAuth, async (_req, res) => {
  try {
    res.json(await getLaunchInfo());
  } catch (err) {
    res.status(500).json({ error: msg(err) });
  }
});

const launchSchema = z.object({
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(16),
  description: z.string().max(500).optional(),
  logo: z.string().max(4096).optional(),
  socials: z
    .object({
      twitter: z.string().max(300).optional(),
      telegram: z.string().max(300).optional(),
      discord: z.string().max(300).optional(),
      website: z.string().max(300).optional(),
      farcaster: z.string().max(300).optional(),
    })
    .optional(),
  launchConfigId: z.string().regex(/^\d+$/, "Pick a launch config"),
  pairToken: z.string().optional(),
  buyAmountEth: z.string().regex(/^\d*\.?\d+$/, "Invalid buy amount").optional(),
  buyAmountQuote: z.string().regex(/^\d*\.?\d+$/, "Invalid buy amount").optional(),
  creatorTaxBps: z.number().int().min(0).max(65535).optional(),
  buybackEnabled: z.boolean().optional(),
  creatorFeeRecipient: z.string().optional(),
  signerWalletId: z.string().min(1),
  extraExemptions: z.array(z.string()).max(32).optional(),
  preArmBuyers: z.boolean().optional(),
  dryRun: z.boolean(),
});

api.post("/launch/execute", requireAuth, async (req, res) => {
  const parsed = launchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const result = await executeLaunch(parsed.data);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── telegram alerts ───────────────────────────────────────────────────────

api.post("/telegram/token", requireAuth, (req, res) => {
  const token = typeof req.body?.botToken === "string" ? req.body.botToken.trim() : "";
  if (!token) {
    res.status(400).json({ error: "Bot token is required" });
    return;
  }
  const db = getDB();
  db.vault.telegramBotToken = encryptSecret(token);
  saveDB();
  res.json({ ok: true, telegramConfigured: true });
});

api.delete("/telegram/token", requireAuth, (_req, res) => {
  const db = getDB();
  delete db.vault.telegramBotToken;
  saveDB();
  res.json({ ok: true });
});

api.post("/telegram/test", requireAuth, async (_req, res) => {
  const result = await sendTelegram(
    "🔔 <b>Larper</b> — test alert. If you can read this, alerts are working.",
  );
  res.status(result.ok ? 200 : 400).json(result);
});

// ── activity ──────────────────────────────────────────────────────────────

api.get("/activity", requireAuth, (_req, res) => {
  res.json({ activity: getDB().activity });
});

api.delete("/activity", requireAuth, (_req, res) => {
  const db = getDB();
  db.activity = [];
  saveDB();
  res.json({ ok: true });
});

// ── live feed (SSE) ───────────────────────────────────────────────────────

api.get("/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const onActivity = (item: unknown) => write(res, "activity", item);
  const onStatus = (payload: unknown) => write(res, "status", payload);

  bus.on("activity", onActivity);
  bus.on("status", onStatus);

  write(res, "hello", { ts: Date.now() });

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off("activity", onActivity);
    bus.off("status", onStatus);
    res.end();
  });
});

function write(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function redact(url: string): string {
  return url.replace(/([?&](?:api[-_]?key|apikey|token)=)[^&]+/gi, "$1***");
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}
