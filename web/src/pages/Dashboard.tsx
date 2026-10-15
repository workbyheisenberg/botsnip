import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleCheck, FlaskConical, Lock, RefreshCw, Zap } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { api } from "../lib/api";
import { Button, Card, Field, Label, Pill, Row, Segmented, Stat } from "../components/ui";
import { compactNumber, shortAddr, timeAgo } from "../lib/format";
import type { Mode } from "../lib/types";

function ActivityDot({ level }: { level: string }) {
  const cls =
    level === "success" ? "dot-success" : level === "warn" ? "dot-warn" : level === "error" ? "dot-error" : "dot-info";
  return <span className={`dot ${cls}`} />;
}

export function Dashboard() {
  const { state, status, activity, patchState } = useStore();
  const [busy, setBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [fromBlock, setFromBlock] = useState("");
  const [toBlock, setToBlock] = useState("");
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

  if (!state) {
    return <div className="py-20 text-center text-[var(--muted)]">Loading console…</div>;
  }

  const settings = state.settings;
  const stats = state.stats;
  const live = settings.mode === "live";
  const armed = settings.autoBuyEnabled;
  const watched = state.watched.filter((w) => w.enabled).length;
  const buying = state.buying.filter((b) => b.enabled).length;

  async function setMode(mode: Mode) {
    const res = await api.saveSettings({ mode });
    patchState({ settings: res.settings });
  }

  async function toggleArm() {
    const res = await api.saveSettings({ autoBuyEnabled: !armed });
    patchState({ settings: res.settings });
  }

  async function scanNow() {
    setBusy(true);
    setScanMsg(null);
    try {
      const res = await api.scan();
      setScanMsg(`Scanned blocks ${Number(res.from).toLocaleString()}–${Number(res.to).toLocaleString()} · ${res.launches} launches`);
    } catch {
      setScanMsg("Scan failed — check the RPC connection.");
    } finally {
      setBusy(false);
    }
  }

  async function replay() {
    setBusy(true);
    setReplayMsg(null);
    try {
      const res = await api.scan({
        fromBlock: fromBlock.trim() || undefined,
        toBlock: toBlock.trim() || undefined,
      });
      setReplayMsg(
        `Replayed ${Number(res.from).toLocaleString()}–${Number(res.to).toLocaleString()} · ` +
          `${res.launches} launch(es) detected${res.detectionOnly ? " (detection only, no buys)" : ""}`,
      );
    } catch (err) {
      setReplayMsg(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setBusy(false);
    }
  }

  const checklist = [
    {
      ok: watched > 0,
      title: "Launch wallets",
      sub:
        watched > 0
          ? `${watched} wallet${watched > 1 ? "s" : ""} being watched`
          : "Add the wallet that launches your tokens",
    },
    {
      ok: buying > 0,
      title: "Buying wallets",
      sub: buying > 0 ? `${buying} ready to snipe` : "Add a buying wallet with funds",
    },
    {
      ok: live,
      title: live ? "Live mode" : "Dry-run mode",
      sub: live ? "Real transactions will be sent" : "Safe — logs what it would do",
    },
    {
      ok: status?.watcher.connected ?? false,
      title: "Chain connection",
      sub: status?.watcher.connected
        ? `Block ${Number(status.watcher.head).toLocaleString()}`
        : "Not connected to Robinhood Chain",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Hero control card */}
      <Card hero className="fade-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Pill tone={armed && live ? "success" : "muted"}>
              <span className={armed && live ? "dot dot-success pulse" : "dot dot-info"} />
              {armed && live ? "Armed & live" : armed ? "Armed · dry-run" : "Disarmed"}
            </Pill>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-extrabold leading-none">
              {compactNumber(stats.buys)}
            </div>
            <div className="text-[11px] text-[var(--muted-dim)]">positions taken</div>
          </div>
        </div>

        <h2 className="font-display mt-4 text-[26px] leading-[1.1] font-extrabold tracking-tight">
          Be first on
          <br />
          <span className="accent">your own launch.</span>
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
          When a watched wallet launches on pons v2, Larper buys instantly — untaxed, because your
          buying wallet is on the launch exemption list.
        </p>

        <div className="mt-5">
          <Segmented<Mode>
            value={settings.mode}
            onChange={setMode}
            options={[
              { value: "dry-run", label: "Dry run" },
              { value: "live", label: "Live" },
            ]}
          />
        </div>

        <Button
          variant={armed ? "ghost" : "primary"}
          size="lg"
          className="mt-3 w-full"
          onClick={toggleArm}
        >
          <Zap size={18} />
          {armed ? "Auto-buy armed — tap to disarm" : "Arm auto-buy"}
        </Button>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Launches seen" value={compactNumber(stats.launchesSeen)} />
        <Stat label="Our matches" value={compactNumber(stats.matches)} accent />
        <Stat label="Buys" value={compactNumber(stats.buys)} />
        <Stat label="Skipped" value={compactNumber(stats.skipped)} />
      </div>

      {/* Checklist */}
      <Card>
        <div className="mb-1 font-display text-[15px] font-bold">Setup</div>
        <div className="text-[13px] text-[var(--muted-dim)]">Everything needed to snipe reliably.</div>
        <div className="mt-3">
          {checklist.map((item, index) => (
            <div key={item.title}>
              {index > 0 ? <Row /> : null}
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{item.title}</div>
                  <div className="text-[12.5px] text-[var(--muted-dim)]">{item.sub}</div>
                </div>
                {item.ok ? (
                  <CircleCheck size={20} className="flex-none text-[var(--brand-400)]" />
                ) : (
                  <Lock size={18} className="flex-none text-[var(--muted-dim)]" />
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Recent activity */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="font-display text-[15px] font-bold">Recent activity</div>
          <Link to="/activity" className="text-[13px] font-semibold text-[var(--brand-400)]">
            View all
          </Link>
        </div>
        <div className="mt-3 space-y-1">
          {activity.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-[var(--muted-dim)]">
              Nothing yet. Activity appears here the moment a watched wallet launches.
            </div>
          ) : (
            activity.slice(0, 4).map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-2.5">
                <ActivityDot level={item.level} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{item.title}</div>
                  {item.detail ? (
                    <div className="truncate text-[12px] text-[var(--muted-dim)]">{item.detail}</div>
                  ) : null}
                </div>
                <div className="flex-none text-[11px] text-[var(--muted-dim)]">{timeAgo(item.ts)}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Test detection */}
      <Card>
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-[var(--brand-400)]" />
          <div className="font-display text-[15px] font-bold">Test detection</div>
        </div>
        <div className="mt-1 text-[12.5px] text-[var(--muted-dim)]">
          Replay a block range through the detector to prove it works. Detection only — never buys.
          Tip: enable <span className="text-[var(--muted)]">Watch all launches</span> in Settings and
          use a recent range.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label>From block</Label>
            <Field
              mono
              value={fromBlock}
              onChange={(e) => setFromBlock(e.target.value)}
              placeholder="89391260"
            />
          </div>
          <div>
            <Label>To block</Label>
            <Field
              mono
              value={toBlock}
              onChange={(e) => setToBlock(e.target.value)}
              placeholder="89391280"
            />
          </div>
        </div>
        <Button className="mt-3 w-full" onClick={replay} disabled={busy || !fromBlock}>
          <FlaskConical size={16} /> Replay range
        </Button>
        {replayMsg ? <div className="mt-2 text-[12.5px] text-[var(--muted)]">{replayMsg}</div> : null}
      </Card>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" onClick={scanNow} disabled={busy}>
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
          Scan now
        </Button>
        <Link to="/wallets">
          <Button variant="ghost">
            Manage wallets <ArrowRight size={16} />
          </Button>
        </Link>
        {settings.mode === "dry-run" ? (
          <Pill tone="brand" className="self-center">
            Dry run — no funds can move
          </Pill>
        ) : null}
      </div>
      {scanMsg ? <div className="text-[12.5px] text-[var(--muted)]">{scanMsg}</div> : null}
    </div>
  );
}
