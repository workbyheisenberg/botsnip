import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { api } from "../lib/api";
import { Button, Card, Field, Label, Pill, Row, Segmented, Toggle } from "../components/ui";
import type { Mode } from "../lib/types";

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const { state, status, patchState, refresh } = useStore();
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("");
  const [maxTax, setMaxTax] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);
  const [priorityFee, setPriorityFee] = useState("");
  const [gasLimit, setGasLimit] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [wsUrl, setWsUrl] = useState("");

  useEffect(() => {
    if (!state) return;
    setAmount(state.settings.buyAmountEth);
    setSlippage(String(state.settings.slippageBps / 100));
    setMaxTax(String(state.settings.maxSnipeTaxBps / 100));
    setChatId(state.settings.telegramChatId);
    setPriorityFee(state.settings.priorityFeeGwei);
    setGasLimit(state.settings.gasLimit);
    setRpcUrl(state.settings.rpcUrl);
    setWsUrl(state.settings.wsUrl);
  }, [
    state?.settings.buyAmountEth,
    state?.settings.slippageBps,
    state?.settings.maxSnipeTaxBps,
    state?.settings.telegramChatId,
    state?.settings.priorityFeeGwei,
    state?.settings.gasLimit,
    state?.settings.rpcUrl,
    state?.settings.wsUrl,
  ]);

  if (!state) return <div className="py-20 text-center text-[var(--muted)]">Loading…</div>;
  const settings = state.settings;

  async function save(patch: Partial<typeof settings>, note = "Saved") {
    const res = await api.saveSettings(patch);
    patchState({ settings: res.settings });
    setSaved(note);
    setTimeout(() => setSaved(null), 1800);
  }

  async function saveNumbers() {
    const slip = Math.round(Number(slippage) * 100);
    const tax = Math.round(Number(maxTax) * 100);
    await save(
      {
        buyAmountEth: amount,
        slippageBps: Number.isFinite(slip) ? Math.max(0, Math.min(9999, slip)) : settings.slippageBps,
        maxSnipeTaxBps: Number.isFinite(tax) ? Math.max(0, Math.min(10000, tax)) : settings.maxSnipeTaxBps,
      },
      "Settings saved",
    );
  }

  async function saveSpeed() {
    await save(
      {
        priorityFeeGwei: priorityFee || "0",
        gasLimit: gasLimit || "0",
        rpcUrl: rpcUrl.trim(),
        wsUrl: wsUrl.trim(),
      },
      "Speed settings saved — reconnecting",
    );
  }

  async function telegramSaveToken() {
    if (!botToken.trim()) return;
    try {
      await api.setTelegramToken(botToken.trim());
      setBotToken("");
      await refresh();
      flashTelegram("Bot token saved");
    } catch (err) {
      flashTelegram(err instanceof Error ? err.message : "Could not save token");
    }
  }

  async function telegramClearToken() {
    await api.clearTelegramToken();
    await refresh();
    flashTelegram("Bot token removed");
  }

  async function telegramTest() {
    try {
      const result = await api.testTelegram();
      flashTelegram(result.ok ? "Test alert sent ✓" : `Failed: ${result.error}`);
    } catch (err) {
      flashTelegram(err instanceof Error ? err.message : "Test failed");
    }
  }

  function flashTelegram(message: string) {
    setTelegramMsg(message);
    setTimeout(() => setTelegramMsg(null), 4000);
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="font-display text-[16px] font-bold">Trading</div>
        <div className="text-[12.5px] text-[var(--muted-dim)]">How Larper sizes and sends buys.</div>

        <div className="mt-4 space-y-4">
          <div>
            <Label>Mode</Label>
            <Segmented<Mode>
              value={settings.mode}
              onChange={(mode) => save({ mode }, mode === "live" ? "Live mode on" : "Dry run")}
              options={[
                { value: "dry-run", label: "Dry run" },
                { value: "live", label: "Live" },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Buy per launch (ETH)</Label>
              <Field value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.02" />
            </div>
            <div>
              <Label>Slippage (%)</Label>
              <Field value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder="15" />
            </div>
          </div>

          <div>
            <Label>Max opening snipe tax tolerated (%)</Label>
            <Field value={maxTax} onChange={(e) => setMaxTax(e.target.value)} placeholder="1" />
            <div className="mt-1.5 text-[12px] text-[var(--muted-dim)]">
              If a buy would be taxed more than this, Larper refuses instead of paying it.
            </div>
          </div>

          <Button variant="primary" className="w-full" onClick={saveNumbers}>
            Save settings
          </Button>
          {saved ? <div className="text-center text-[12.5px] text-[var(--success)]">{saved}</div> : null}
        </div>
      </Card>

      <Card>
        <div className="font-display text-[16px] font-bold">Protections</div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Native ETH pairs only</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">
                Skip launches paired against a token (e.g. USDG). Turn OFF to buy those — set the
                PAIR amount per wallet in Wallets.
              </div>
            </div>
            <Toggle
              on={settings.nativePairOnly}
              onChange={(next) => save({ nativePairOnly: next })}
            />
          </div>
          <Row />
          <div className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Watch all launches</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">
                Notify on every launch (monitor only — never buys). Great for testing.
              </div>
            </div>
            <Toggle
              on={settings.watchAllLaunches}
              onChange={(next) => save({ watchAllLaunches: next }, next ? "Watching all launches" : "Watching your wallets only")}
            />
          </div>
          <Row />
          <div className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Auto-buy</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">
                Master switch — buy automatically on a matched launch
              </div>
            </div>
            <Toggle
              on={settings.autoBuyEnabled}
              onChange={(next) => save({ autoBuyEnabled: next }, next ? "Armed" : "Disarmed")}
            />
          </div>
        </div>
      </Card>

      <Card>
        <div className="font-display text-[16px] font-bold">Telegram alerts</div>
        <div className="text-[12.5px] text-[var(--muted-dim)]">
          Get pinged when the bot detects a launch, buys, skips or errors.
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Enable alerts</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">
                {state.telegramConfigured ? "Bot token saved" : "No bot token saved yet"}
              </div>
            </div>
            <Toggle
              on={settings.telegramEnabled}
              onChange={(next) => save({ telegramEnabled: next }, next ? "Alerts on" : "Alerts off")}
            />
          </div>

          <div>
            <Label>Bot token</Label>
            <Field
              mono
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={state.telegramConfigured ? "•••••• saved — paste to replace" : "123456789:ABC…"}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={telegramSaveToken} disabled={!botToken.trim()}>
                Save token
              </Button>
              <Button size="sm" onClick={telegramTest} disabled={!state.telegramConfigured}>
                Send test
              </Button>
              {state.telegramConfigured ? (
                <Button size="sm" variant="danger" onClick={telegramClearToken}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>

          <div>
            <Label>Chat ID</Label>
            <Field
              mono
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              onBlur={() => {
                if (chatId !== settings.telegramChatId) save({ telegramChatId: chatId });
              }}
              placeholder="e.g. 123456789 or -100…"
            />
          </div>

          <div className="space-y-1">
            <NotifyRow
              label="Launch detections"
              on={settings.notifyLaunches}
              onChange={(v) => save({ notifyLaunches: v })}
            />
            <Row />
            <NotifyRow label="Buys" on={settings.notifyBuys} onChange={(v) => save({ notifyBuys: v })} />
            <Row />
            <NotifyRow
              label="Skips / refusals"
              on={settings.notifySkips}
              onChange={(v) => save({ notifySkips: v })}
            />
            <Row />
            <NotifyRow
              label="Errors"
              on={settings.notifyErrors}
              onChange={(v) => save({ notifyErrors: v })}
            />
          </div>

          {telegramMsg ? <div className="text-[12.5px] text-[var(--muted)]">{telegramMsg}</div> : null}

          <div className="inset p-3.5 text-[12px] leading-relaxed text-[var(--muted-dim)]">
            Create a bot with <span className="text-[var(--muted)]">@BotFather</span>, then message
            your bot and get the chat id from{" "}
            <span className="text-[var(--muted)]">api.telegram.org/bot&lt;token&gt;/getUpdates</span>.
          </div>
        </div>
      </Card>

      <Card>
        <div className="font-display text-[16px] font-bold">Speed &amp; network</div>
        <div className="text-[12.5px] text-[var(--muted-dim)]">
          The levers that make sniping fast. Leave a field blank to use the .env value.
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority fee (gwei)</Label>
              <Field
                value={priorityFee}
                onChange={(e) => setPriorityFee(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Gas limit</Label>
              <Field
                value={gasLimit}
                onChange={(e) => setGasLimit(e.target.value)}
                placeholder="0 = estimate"
              />
            </div>
          </div>

          <div>
            <Label>RPC URL (HTTP)</Label>
            <Field
              mono
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              placeholder="blank = .env endpoint"
            />
          </div>

          <div>
            <Label>WebSocket URL</Label>
            <Field
              mono
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="blank = polling"
            />
            <div className="mt-1.5 text-[12px] text-[var(--muted-dim)]">
              Paste a WebSocket endpoint (paid providers give you one) to switch the watcher from
              polling to instant push. Saved changes reconnect the watcher automatically.
            </div>
          </div>

          <div className="flex items-center gap-3 py-1">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Batch RPC reads</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">
                Combines the buy-path reads into one request (faster). Auto-disabled if your RPC
                rejects it.
              </div>
            </div>
            <Toggle on={settings.rpcBatch} onChange={(next) => save({ rpcBatch: next })} />
          </div>

          <Button variant="primary" className="w-full" onClick={saveSpeed}>
            Save speed settings
          </Button>

          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-[var(--muted-dim)]">Active feed</span>
            <Pill tone={status?.watcher.logsPush ? "success" : status?.watcher.transport === "websocket" ? "brand" : "muted"}>
              {status?.watcher.logsPush
                ? "wallet push"
                : status?.watcher.transport === "websocket"
                  ? "block push"
                  : (status?.watcher.transport ?? "—")}
            </Pill>
          </div>
        </div>
      </Card>

      <Card>
        <div className="font-display text-[16px] font-bold">Connection</div>
        <div className="mt-3 space-y-2 text-[13px]">
          <ConnRow label="Chain" value="Robinhood Chain · 4663" />
          <ConnRow
            label="Status"
            value={status?.watcher.connected ? "Connected" : "Disconnected"}
            tone={status?.watcher.connected ? "success" : "error"}
          />
          <ConnRow label="Block" value={status?.chain.head ? Number(status.chain.head).toLocaleString() : "—"} />
          <ConnRow label="RPC" value={status?.chain.rpc ?? "—"} mono />
          <ConnRow label="Factory" value={status?.pons.factory ?? "—"} mono />
          <ConnRow
            label="Feed"
            value={
              status?.watcher.logsPush
                ? "WebSocket (wallet push)"
                : status?.watcher.transport === "websocket"
                  ? "WebSocket (block push)"
                  : "Polling"
            }
            tone={status?.watcher.transport === "websocket" ? "success" : undefined}
          />
          {status?.watcher.lastError ? (
            <ConnRow label="Last error" value={status.watcher.lastError} tone="error" />
          ) : null}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="danger"
          onClick={async () => {
            await api.logout();
            onLogout();
          }}
        >
          <LogOut size={16} /> Sign out
        </Button>
      </div>
    </div>
  );
}

function ConnRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "error";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--muted-dim)]">{label}</span>
      <span
        className={`truncate ${mono ? "field-mono text-[12px]" : ""} ${
          tone === "success" ? "text-[var(--success)]" : tone === "error" ? "text-[var(--danger)]" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function NotifyRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1 text-[14px] font-medium">{label}</div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
