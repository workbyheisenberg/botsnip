import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { StoreProvider } from "./state/StoreContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { LaunchPage } from "./pages/Launch";
import { Wallets } from "./pages/Wallets";
import { ActivityPage } from "./pages/Activity";
import { SettingsPage } from "./pages/Settings";

function Splash() {
  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <div className="app-glow" />
      <div className="relative z-10 text-center">
        <div className="font-display text-2xl font-extrabold tracking-tight">Larper</div>
        <div className="mt-1 text-[13px] text-[var(--muted)]">Connecting…</div>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then((res) => setAuthed(res.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <Splash />;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <StoreProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="launch" element={<LaunchPage />} />
          <Route path="wallets" element={<Wallets />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage onLogout={() => setAuthed(false)} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </StoreProvider>
  );
}
