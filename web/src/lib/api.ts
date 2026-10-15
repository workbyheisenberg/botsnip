import type { ActivityItem, AppState, LaunchInfo, LaunchRequest, LaunchResult, Settings, StatusInfo } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  login: (password: string) =>
    request<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ authenticated: boolean }>("/auth/me"),

  state: () => request<AppState>("/state"),
  status: () => request<StatusInfo>("/status"),
  scan: (opts: { fromBlock?: string; toBlock?: string } = {}) =>
    request<{ ok: true; from: string; to: string; launches: number; detectionOnly: boolean }>("/scan", {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  addWatched: (address: string, label: string) =>
    request("/watched", { method: "POST", body: JSON.stringify({ address, label }) }),
  patchWatched: (id: string, patch: Partial<{ label: string; enabled: boolean }>) =>
    request(`/watched/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeWatched: (id: string) => request(`/watched/${id}`, { method: "DELETE" }),

  addBuying: (privateKey: string, label: string) =>
    request("/buying", { method: "POST", body: JSON.stringify({ privateKey, label }) }),
  patchBuying: (
    id: string,
    patch: Partial<{ label: string; enabled: boolean; amountEth: string; amountQuote: string }>,
  ) => request(`/buying/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeBuying: (id: string) => request(`/buying/${id}`, { method: "DELETE" }),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ ok: true; settings: Settings }>("/settings", { method: "PUT", body: JSON.stringify(patch) }),

  activity: () => request<{ activity: ActivityItem[] }>("/activity"),
  clearActivity: () => request<{ ok: true }>("/activity", { method: "DELETE" }),

  launchInfo: () => request<LaunchInfo>("/launch/info"),
  executeLaunch: (body: LaunchRequest) =>
    request<LaunchResult>("/launch/execute", { method: "POST", body: JSON.stringify(body) }),

  setTelegramToken: (botToken: string) =>
    request<{ ok: true }>("/telegram/token", { method: "POST", body: JSON.stringify({ botToken }) }),
  clearTelegramToken: () => request<{ ok: true }>("/telegram/token", { method: "DELETE" }),
  testTelegram: () => request<{ ok: boolean; error?: string }>("/telegram/test", { method: "POST" }),
};
