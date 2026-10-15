import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { api } from "../lib/api";
import { Button, Card, Field, Label, Pill, Row, Toggle } from "../components/ui";
import { shortAddr } from "../lib/format";
import type { BuyingWallet } from "../lib/types";

export function Wallets() {
  const { state, refresh } = useStore();
  const [address, setAddress] = useState("");
  const [launchLabel, setLaunchLabel] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [buyLabel, setBuyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state) return <div className="py-20 text-center text-[var(--muted)]">Loading…</div>;

  async function addWatched(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.addWatched(address.trim(), launchLabel.trim() || "Launch wallet");
      setAddress("");
      setLaunchLabel("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add wallet");
    } finally {
      setBusy(false);
    }
  }

  async function addBuying(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.addBuying(privateKey.trim(), buyLabel.trim() || "Buying wallet");
      setPrivateKey("");
      setBuyLabel("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add wallet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="card border-[rgba(251,113,133,.3)] p-4 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {/* Launch wallets */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[16px] font-bold">Launch wallets</div>
            <div className="text-[12.5px] text-[var(--muted-dim)]">
              Wallets we watch for new launches
            </div>
          </div>
          <Pill tone="brand">{state.watched.length}</Pill>
        </div>

        <div className="mt-4 space-y-2">
          {state.watched.length === 0 ? (
            <div className="inset p-4 text-center text-[13px] text-[var(--muted-dim)]">
              No launch wallets yet. Add the wallet your team launches tokens from.
            </div>
          ) : (
            state.watched.map((wallet) => (
              <div key={wallet.id} className="inset flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{wallet.label}</div>
                  <div className="field-mono text-[12px] text-[var(--muted-dim)]">
                    {shortAddr(wallet.address, 6)}
                  </div>
                </div>
                <Toggle
                  on={wallet.enabled}
                  onChange={async (next) => {
                    await api.patchWatched(wallet.id, { enabled: next });
                    await refresh();
                  }}
                />
                <button
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-[var(--muted-dim)] transition hover:bg-[rgba(251,113,133,.12)] hover:text-[var(--danger)]"
                  onClick={async () => {
                    await api.removeWatched(wallet.id);
                    await refresh();
                  }}
                  aria-label="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <Row />
        <form onSubmit={addWatched} className="space-y-3">
          <div>
            <Label>Launch wallet address</Label>
            <Field
              mono
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <div>
            <Label>Label (optional)</Label>
            <Field
              value={launchLabel}
              onChange={(e) => setLaunchLabel(e.target.value)}
              placeholder="e.g. Team deployer"
            />
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !address}>
            <Plus size={16} /> Add launch wallet
          </Button>
        </form>
      </Card>

      {/* Buying wallets */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[16px] font-bold">Buying wallets</div>
            <div className="text-[12.5px] text-[var(--muted-dim)]">
              Sends the buy. Keys are encrypted at rest.
            </div>
          </div>
          <Pill tone="brand">{state.buying.length}</Pill>
        </div>

        <div className="mt-4 space-y-2">
          {state.buying.length === 0 ? (
            <div className="inset p-4 text-center text-[13px] text-[var(--muted-dim)]">
              No buying wallets yet. Add a funded burner wallet.
            </div>
          ) : (
            state.buying.map((wallet) => (
              <BuyingRow key={wallet.id} wallet={wallet} onChanged={refresh} />
            ))
          )}
        </div>

        <Row />
        <form onSubmit={addBuying} className="space-y-3">
          <div>
            <Label>Buying wallet private key</Label>
            <Field
              mono
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="0x… (64 hex chars)"
            />
          </div>
          <div>
            <Label>Label (optional)</Label>
            <Field
              value={buyLabel}
              onChange={(e) => setBuyLabel(e.target.value)}
              placeholder="e.g. Sniper 1"
            />
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !privateKey}>
            <Plus size={16} /> Add buying wallet
          </Button>
        </form>

        <div className="inset mt-4 p-3.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <strong className="text-[var(--text)]">Reminder:</strong> use burner wallets with only the
          capital you're willing to risk. Add every one to the launch's snipe-tax exemption list (the
          Launch screen does this automatically), or Larper will refuse the buy rather than pay the
          99% opening tax. Enable several to bundle a larger position across the 5% cap.
        </div>
      </Card>
    </div>
  );
}

function BuyingRow({
  wallet,
  onChanged,
}: {
  wallet: BuyingWallet;
  onChanged: () => Promise<void> | void;
}) {
  const [amount, setAmount] = useState(wallet.amountEth);
  const [amountQuote, setAmountQuote] = useState(wallet.amountQuote);

  useEffect(() => {
    setAmount(wallet.amountEth);
  }, [wallet.amountEth]);

  useEffect(() => {
    setAmountQuote(wallet.amountQuote);
  }, [wallet.amountQuote]);

  async function commit(field: "amountEth" | "amountQuote", value: string, original: string) {
    if (value !== original && /^\d*\.?\d+$/.test(value)) {
      await api.patchBuying(wallet.id, { [field]: value });
      await onChanged();
    } else {
      if (field === "amountEth") setAmount(original);
      else setAmountQuote(original);
    }
  }

  return (
    <div className="inset flex flex-wrap items-center gap-3 p-3.5">
      <KeyRound size={18} className="flex-none text-[var(--brand-400)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{wallet.label}</div>
        <div className="field-mono text-[12px] text-[var(--muted-dim)]">
          {shortAddr(wallet.address, 6)}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="field w-[74px] px-2 py-2 text-center text-[13px]"
          value={amount}
          inputMode="decimal"
          title="ETH spent per launch (native-ETH launches)"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => commit("amountEth", amount, wallet.amountEth)}
        />
        <span className="text-[11px] text-[var(--muted-dim)]">ETH</span>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="field w-[74px] px-2 py-2 text-center text-[13px]"
          value={amountQuote}
          inputMode="decimal"
          title="Pair-token amount spent per launch (e.g. USDG-paired launches)"
          onChange={(e) => setAmountQuote(e.target.value)}
          onBlur={() => commit("amountQuote", amountQuote, wallet.amountQuote)}
        />
        <span className="text-[11px] text-[var(--muted-dim)]">PAIR</span>
      </div>

      <Toggle
        on={wallet.enabled}
        onChange={async (next) => {
          await api.patchBuying(wallet.id, { enabled: next });
          await onChanged();
        }}
      />
      <button
        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-[var(--muted-dim)] transition hover:bg-[rgba(251,113,133,.12)] hover:text-[var(--danger)]"
        onClick={async () => {
          await api.removeBuying(wallet.id);
          await onChanged();
        }}
        aria-label="Remove"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
