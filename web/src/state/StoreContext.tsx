import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { ActivityItem, AppState, StatusInfo } from "../lib/types";

interface StoreValue {
  state: AppState | null;
  status: StatusInfo | null;
  activity: ActivityItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  patchState: (patch: Partial<AppState>) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [nextState, nextStatus, nextActivity] = await Promise.all([
      api.state(),
      api.status(),
      api.activity(),
    ]);
    if (!mounted.current) return;
    setState(nextState);
    setStatus(nextStatus);
    setActivity(nextActivity.activity);
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Periodic status refresh (chain head, watcher health)
  useEffect(() => {
    const id = setInterval(() => {
      api.status().then(setStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Live activity feed via SSE
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("activity", (event) => {
      try {
        const item = JSON.parse((event as MessageEvent).data) as ActivityItem;
        setActivity((prev) => [item, ...prev].slice(0, 400));
        if (item.kind === "buy" || item.kind === "launch") {
          api.state().then(setState).catch(() => {});
        }
      } catch {
        /* ignore malformed frame */
      }
    });
    source.addEventListener("status", () => {
      api.state().then(setState).catch(() => {});
    });
    return () => source.close();
  }, []);

  const patchState = useCallback((patch: Partial<AppState>) => {
    setState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ state, status, activity, loading, error, refresh, patchState }),
    [state, status, activity, loading, error, refresh, patchState],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
