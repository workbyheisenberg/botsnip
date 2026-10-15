import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { api } from "./api.js";
import { config, WEB_DIST } from "./config.js";
import { loadDB, pushActivity } from "./store.js";
import { masterSecret } from "./crypto.js";
import { installDohResolver } from "./doh.js";
import { startNotifier } from "./notify.js";
import { startWatcher } from "./watcher.js";
import { watcherStatus } from "./watcher.js";
import { publicClient } from "./chain.js";

async function main() {
  installDohResolver();
  loadDB();
  masterSecret(); // ensure a master key exists before anything needs it
  startNotifier();

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(cors({ origin: true, credentials: true }));

  app.get("/healthz", (_req, res) => res.json({ ok: true, watcher: watcherStatus() }));
  app.use("/api", api);

  // Serve the built console in production (npm run build).
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/events")) return next();
      res.sendFile(path.join(WEB_DIST, "index.html"));
    });
  }

  const server = app.listen(config.port, () => {
    banner();
  });

  startWatcher().catch((err) => {
    console.error("[watcher] failed to start:", err);
  });

  const shutdown = async () => {
    console.log("\n[larper] shutting down…");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function banner() {
  let head = "?";
  try {
    head = (await publicClient.getBlockNumber()).toString();
  } catch {
    head = "unreachable";
  }
  console.log("");
  console.log("  ▟▛  LARPER — pons sniper console");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  Console   http://localhost:${config.port}`);
  console.log(`  RPC       ${config.rpcUrl.replace(/([?&]apikey=)[^&]+/i, "$1***")}`);
  console.log(`  Head      block ${head}`);
  console.log(`  Mode      configurable in the console (dry-run is safe)`);
  console.log("");
  pushActivity({ kind: "info", level: "info", title: "Larper started", detail: `head block ${head}` });
}

main().catch((err) => {
  console.error("[larper] fatal:", err);
  process.exit(1);
});
