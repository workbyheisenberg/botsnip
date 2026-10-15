import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Button, Field } from "../components/ui";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-5">
      <div className="app-glow" />
      <div className="fade-up relative z-10 w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(180deg,#4e8dff,#1e5bff)",
              boxShadow: "0 14px 34px -14px rgba(30,91,255,.95), inset 0 1px 0 rgba(255,255,255,.3)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 17L9 7l4 6 3-4 5 8"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="font-display text-xl font-extrabold tracking-tight">Larper</div>
        </div>

        <h1 className="font-display text-[34px] leading-[1.08] font-extrabold tracking-tight">
          Own Your Launch,
          <br />
          <span className="accent">Shape Your Supply.</span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Internal sniper console for pons on Robinhood Chain. Sign in to manage wallets and arm
          auto-buy.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <Field
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Team password"
          />
          {error ? <div className="text-[13px] text-[var(--danger)]">{error}</div> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? "Checking…" : "Enter console"}
          </Button>
        </form>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-[var(--muted-dim)]">
          The default password is <span className="text-[var(--muted)]">changeme</span> — set
          <span className="text-[var(--muted)]"> TEAM_PASSWORD</span> in .env before sharing.
        </p>
      </div>
    </div>
  );
}
