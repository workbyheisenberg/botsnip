import clsx from "clsx";
import { NavLink, Outlet } from "react-router-dom";
import { Activity, LayoutDashboard, Rocket, Settings, Wallet } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { Pill } from "./ui";

const NAV = [
  { to: "/", label: "Console", icon: LayoutDashboard, end: true },
  { to: "/launch", label: "Launch", icon: Rocket, end: false },
  { to: "/wallets", label: "Wallets", icon: Wallet, end: false },
  { to: "/activity", label: "Activity", icon: Activity, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl"
        style={{
          background: "linear-gradient(180deg,#4e8dff,#1e5bff)",
          boxShadow: "0 10px 24px -12px rgba(30,91,255,.9), inset 0 1px 0 rgba(255,255,255,.3)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 17L9 7l4 6 3-4 5 8"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="font-display text-[17px] font-extrabold tracking-tight">Larper</div>
    </div>
  );
}

export function Layout() {
  const { state, status } = useStore();
  const live = state?.settings.mode === "live";
  const armed = state?.settings.autoBuyEnabled;
  const connected = status?.watcher.connected;

  return (
    <div className="relative min-h-screen">
      <div className="app-glow" />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl gap-8 px-4 pb-28 pt-6 lg:pb-10">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 flex-none lg:block">
          <div className="sticky top-6">
            <Brand />
            <nav className="mt-8 flex flex-col gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition",
                      isActive
                        ? "bg-[rgba(91,155,255,.12)] text-[var(--text)]"
                        : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]",
                    )
                  }
                >
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="inset mt-8 p-4">
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "dot",
                    !connected ? "dot-error" : armed && live ? "dot-success pulse" : "dot-warn",
                  )}
                />
                <span className="text-[13px] font-semibold">
                  {!connected ? "Disconnected" : armed && live ? "Live · armed" : "Idle"}
                </span>
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--muted-dim)]">
                {live ? "Live mode" : "Dry-run mode"} · block{" "}
                {status?.chain.head ? Number(status.chain.head).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <header className="mb-6 flex items-center justify-between gap-4">
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="hidden lg:block">
              <div className="font-display text-lg font-bold">Sniper console</div>
              <div className="text-[13px] text-[var(--muted)]">pons · Robinhood Chain</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={connected ? "brand" : "error"}>
                <span className={clsx("dot", connected ? "dot-info" : "dot-error")} />
                {connected ? "Connected" : "Offline"}
              </Pill>
              <Pill tone={live ? "error" : "muted"}>{live ? "LIVE" : "DRY RUN"}</Pill>
            </div>
          </header>

          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(6,9,16,.86)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition",
                  isActive ? "text-[var(--brand-400)]" : "text-[var(--muted-dim)]",
                )
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
