import { bus } from "./bus.js";
import { decryptSecret } from "./crypto.js";
import { getDB } from "./store.js";
import type { ActivityItem, Settings } from "./types.js";

let started = false;

/** Forwards activity events to Telegram when enabled. */
export function startNotifier(): void {
  if (started) return;
  started = true;
  bus.on("activity", (item: ActivityItem) => {
    void dispatch(item);
  });
}

function wants(item: ActivityItem, settings: Settings): boolean {
  switch (item.kind) {
    case "launch":
      return settings.notifyLaunches;
    case "buy":
      return settings.notifyBuys;
    case "skip":
      return settings.notifySkips;
    case "error":
      return settings.notifyErrors;
    default:
      return false;
  }
}

function icon(item: ActivityItem): string {
  switch (item.kind) {
    case "launch":
      return "🚀";
    case "buy":
      return item.level === "success" ? "✅" : "🟦";
    case "skip":
      return "⚠️";
    case "error":
      return "⛔";
    default:
      return "ℹ️";
  }
}

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDB();
  const encryptedToken = db.vault?.telegramBotToken;
  const chatId = db.settings.telegramChatId;
  if (!encryptedToken) return { ok: false, error: "No Telegram bot token saved" };
  if (!chatId) return { ok: false, error: "No Telegram chat id set" };

  let botToken: string;
  try {
    botToken = decryptSecret(encryptedToken);
  } catch {
    return { ok: false, error: "Stored bot token could not be decrypted (MASTER_KEY changed?)" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function dispatch(item: ActivityItem): Promise<void> {
  const db = getDB();
  const settings = db.settings;
  if (!settings.telegramEnabled) return;
  if (!db.vault?.telegramBotToken || !settings.telegramChatId) return;
  if (!wants(item, settings)) return;

  const lines = [`${icon(item)} <b>${escapeHtml(item.title)}</b>`];
  if (item.detail) lines.push(escapeHtml(item.detail));
  if (item.token) lines.push(`<code>${item.token}</code>`);
  if (item.txHash) {
    lines.push(
      `<a href="https://robinhoodchain.blockscout.com/tx/${item.txHash}">view on explorer</a>`,
    );
  }

  await sendTelegram(lines.join("\n"));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
