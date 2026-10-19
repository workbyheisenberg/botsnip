import { useEffect, useMemo, useState } from "react";
import { CircleCheck, ExternalLink, Eye, Lock, Rocket, TriangleAlert } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { api } from "../lib/api";
import { Button, Card, Field, Label, Pill, Row, Toggle } from "../components/ui";
import type { LaunchInfo, LaunchRequest, LaunchResult } from "../lib/types";
import { explorerTx, shortAddr } from "../lib/format";

/** pons-approved pair asset on Robinhood Chain (6 decimals). */
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

function tokens(value: string): string {
  const n = Number(value) / 1e18;
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function LaunchPage() {
  const { state } = useStore();
  const live = state?.settings.mode === "live";

  const [info, setInfo] = useState<LaunchInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [configId, setConfigId] = useState("0");
  const [pairToken, setPairToken] = useState("");
  const [buyAmountEth, setBuyAmountEth] = useState(state?.settings.buyAmountEth ?? "0.02");
  const [buyAmountQuote, setBuyAmountQuote] = useState("1");
  const [creatorTaxBps, setCreatorTaxBps] = useState(0);
  const [buybackEnabled, setBuybackEnabled] = useState(true);
  const [signerWalletId, setSignerWalletId] = useState("");

  const [plan, setPlan] = useState<LaunchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LaunchResult | null>(null);

  useEffect(() => {
    api
      .launchInfo()
      .then((data) => {
        setInfo(data);
        const firstEnabled = data.configs.find((c) => c.enabled);
        if (firstEnabled) setConfigId(firstEnabled.id);
        const signable = data.wallets.find((w) => w.hasKey && w.enabled);
        if (signable) setSignerWalletId(signable.id);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load launch info"));
  }, [state?.buying.length]);

  const signers = useMemo(() => (info?.wallets ?? []).filter((w) => w.hasKey), [info]);
  const enabledConfigs = useMemo(() => (info?.configs ?? []).filter((c) => c.enabled), [info]);
  const canLaunch = signerWalletId ? info?.canLaunch?.[signers.find((s) => s.id === signerWalletId)?.address ?? ""] : false;
  const exemptions = (state?.buying ?? []).filter((b) => b.enabled).map((b) => b.address);
  const isPair = pairToken.trim().length > 0;

  function buildRequest(dryRun: boolean): LaunchRequest {
    return {
      name,
      symbol,
      description,
      logo,
      socials: { twitter, telegram, website },
      launchConfigId: configId,
      pairToken: pairToken.trim() || "native",
      buyAmountEth,
      buyAmountQuote,
      creatorTaxBps,
      buybackEnabled,
      signerWalletId,
      dryRun,
    };
  }

  async function preview() {
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const result = await api.executeLaunch(buildRequest(true));
      if (!result.ok) setError(result.error ?? "Preview failed");
      else setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (!live) return;
    if (
      !window.confirm(
        isPair
          ? `Launch ${symbol || name} paired against ${pairToken} and buy ${buyAmountQuote} of it atomically? This sends REAL transactions: a one-time approval (if needed) plus the launch fee in ETH.`
          : `Launch ${symbol || name} and buy ${buyAmountEth} ETH atomically? This sends a REAL transaction and spends ETH.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await api.executeLaunch(buildRequest(false));
      if (!result.ok) setError(result.error ?? "Launch failed");
      else setDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card hero>
        <Pill tone="brand">
          <Rocket size={13} /> Atomic · one transaction
        </Pill>
        <h2 className="font-display mt-3 text-[24px] leading-[1.12] font-extrabold tracking-tight">
          Launch and take the
          <br />
          <span className="accent">opening position — at once.</span>
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
          Creates the token and buys it in the same transaction, so nothing can trade in between.
          Your buying wallets are auto-added to the snipe-tax exemption list.
        </p>
      </Card>

      {loadError ? (
        <div className="card border-[rgba(251,113,133,.3)] p-4 text-[13px] text-[var(--danger)]">{loadError}</div>
      ) : null}

      <Card>
        <div className="font-display text-[16px] font-bold">Token</div>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" />
            </div>
            <div>
              <Label>Symbol</Label>
              <Field value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="TKN" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Field value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label>Logo URL / IPFS</Label>
            <Field value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="ipfs://… or https://…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Twitter</Label>
              <Field value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <Label>Telegram</Label>
              <Field value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div>
            <Label>Website</Label>
            <Field value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="optional" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="font-display text-[16px] font-bold">Launch &amp; buy</div>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Launch config</Label>
              <select
                className="field"
                style={{ colorScheme: "dark" }}
                value={configId}
                onChange={(e) => setConfigId(e.target.value)}
              >
                {enabledConfigs.length === 0 ? <option value="0">none available</option> : null}
                {enabledConfigs.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} · {c.curveFeeBps / 100}% fee
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>First buy ({isPair ? "pair token" : "ETH"})</Label>
              <Field
                value={isPair ? buyAmountQuote : buyAmountEth}
                onChange={(e) =>
                  isPair ? setBuyAmountQuote(e.target.value) : setBuyAmountEth(e.target.value)
                }
                placeholder={isPair ? "1.0" : "0.02"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Creator tax (%)</Label>
              <Field
                value={String(creatorTaxBps / 100)}
                onChange={(e) => setCreatorTaxBps(Math.round((Number(e.target.value) || 0) * 100))}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Pair token (optional)</Label>
              <Field
                mono
                value={pairToken}
                onChange={(e) => setPairToken(e.target.value)}
                placeholder="blank = native ETH"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPairToken("")}
                  className={`rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
                    isPair ? "text-[var(--muted-dim)]" : "inset text-[var(--brand-400)]"
                  }`}
                >
                  Native ETH
                </button>
                <button
                  type="button"
                  onClick={() => setPairToken(USDG)}
                  className={`rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
                    isPair ? "inset text-[var(--brand-400)]" : "text-[var(--muted-dim)]"
                  }`}
                >
                  USDG
                </button>
              </div>
            </div>
          </div>

          <div>
            <Label>Launch from wallet</Label>
            <select
              className="field"
              style={{ colorScheme: "dark" }}
              value={signerWalletId}
              onChange={(e) => setSignerWalletId(e.target.value)}
            >
              {signers.length === 0 ? <option value="">no wallet with a key</option> : null}
              {signers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} — {shortAddr(w.address, 5)}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center gap-2">
              {canLaunch ? (
                <>
                  <CircleCheck size={16} className="text-[var(--success)]" />
                  <span className="text-[12.5px] text-[var(--muted)]">Whitelisted to launch</span>
                </>
              ) : (
                <>
                  <Lock size={14} className="text-[var(--muted-dim)]" />
                  <span className="text-[12.5px] text-[var(--muted-dim)]">
                    This wallet is not whitelisted to launch right now
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Enable buybacks</div>
              <div className="text-[12.5px] text-[var(--muted-dim)]">Optional creator buyback, funded from creator fees</div>
            </div>
            <Toggle on={buybackEnabled} onChange={setBuybackEnabled} />
          </div>

          <div className="inset p-3.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            <div className="mb-1 font-semibold text-[var(--text)]">
              {exemptions.length} wallet{exemptions.length === 1 ? "" : "s"} will be exempt from the opening tax
            </div>
            {exemptions.length ? (
              <div className="field-mono text-[11.5px] text-[var(--muted-dim)]">
                {exemptions.map((a) => shortAddr(a, 5)).join(", ")}
              </div>
            ) : (
              <span>Add buying wallets so your bundle buys untaxed.</span>
            )}
          </div>

          {!live ? (
            <div className="inset flex items-start gap-2 p-3.5 text-[12.5px] text-[var(--warn)]">
              <TriangleAlert size={15} className="mt-0.5 flex-none" />
              <span>Console is in Dry-run. Preview works; switch to Live to send the real launch.</span>
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={preview} disabled={busy || !name || !symbol}>
              <Eye size={16} /> Preview
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={launch}
              disabled={busy || !live || !canLaunch || !name || !symbol || !signerWalletId}
            >
              <Rocket size={16} /> Launch atomically
            </Button>
          </div>

          {error ? <div className="text-[13px] text-[var(--danger)]">{error}</div> : null}
        </div>
      </Card>

      {plan?.plan ? (
        <Card className="fade-up">
          <div className="font-display text-[15px] font-bold">Plan preview</div>
          <div className="mt-3 space-y-2 text-[13px]">
            <PlanRow label="Launch fee (ETH)" value={`${Number(plan.plan.launchFeeEth).toFixed(6)} ETH`} />
            <Row />
            <PlanRow label="First buy" value={`${plan.plan.buyEth} ${plan.plan.buySymbol}`} />
            <Row />
            <PlanRow label="ETH out of wallet" value={`${Number(plan.plan.totalCostEth).toFixed(6)} ETH`} />
            <Row />
            <PlanRow label="Expected tokens" value={tokens(plan.plan.expectedTokens)} />
            <Row />
            <PlanRow label="Min out (slippage)" value={tokens(plan.plan.minTokensOut)} />
            <Row />
            <PlanRow label="Recipient" value={shortAddr(plan.plan.recipient, 5)} mono />
            <Row />
            <PlanRow label="Exempt wallets" value={String(plan.plan.exemptions.length)} />
          </div>
          {plan.plan.needsApproval ? (
            <div className="mt-3 flex items-start gap-2 text-[12px] text-[var(--warn)]">
              <TriangleAlert size={14} className="mt-0.5 flex-none" />
              <span>
                First {plan.plan.buySymbol} launch needs a one-time approval. Larper sends it, waits
                for it to land, then launches.
              </span>
            </div>
          ) : null}
          <div className="mt-3 text-[12px] text-[var(--muted-dim)]">
            Estimated at the config's opening price. A fresh launch has no pool yet, so this is a
            deterministic quote, not a market read.
          </div>
        </Card>
      ) : null}

      {done ? (
        <Card className="fade-up">
          <div className="flex items-center gap-2">
            <CircleCheck size={18} className="text-[var(--success)]" />
            <div className="font-display text-[15px] font-bold">Launched</div>
          </div>
          <div className="mt-3 space-y-2 text-[13px]">
            {done.token ? <PlanRow label="Token" value={shortAddr(done.token, 6)} mono /> : null}
            {done.txHash ? (
              <a
                href={explorerTx(done.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--brand-400)]"
              >
                View transaction <ExternalLink size={12} />
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function PlanRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--muted-dim)]">{label}</span>
      <span className={mono ? "field-mono text-[12px]" : "font-semibold"}>{value}</span>
    </div>
  );
}
