import { ExternalLink, Trash2 } from "lucide-react";
import { useStore } from "../state/StoreContext";
import { api } from "../lib/api";
import { Button, Card, Pill } from "../components/ui";
import { clockTime, explorerTx, shortAddr } from "../lib/format";

export function ActivityPage() {
  const { activity, refresh } = useStore();

  const tone =
    activity.filter((a) => a.level === "success").length > 0
      ? ("success" as const)
      : ("muted" as const);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[16px] font-bold">Activity</div>
            <div className="text-[12.5px] text-[var(--muted-dim)]">
              Live feed of detections, buys and skips
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={tone}>{activity.length} events</Pill>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.clearActivity();
                await refresh();
              }}
            >
              <Trash2 size={14} /> Clear
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          {activity.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[var(--muted-dim)]">
              No activity yet.
            </div>
          ) : (
            activity.map((item) => {
              const dot =
                item.level === "success"
                  ? "dot-success"
                  : item.level === "warn"
                    ? "dot-warn"
                    : item.level === "error"
                      ? "dot-error"
                      : "dot-info";
              return (
                <div key={item.id} className="fade-up flex items-start gap-3 rounded-xl px-2 py-3">
                  <span className={`dot ${dot} mt-1.5`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">{item.title}</div>
                    {item.detail ? (
                      <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-dim)] break-words">
                        {item.detail}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-dim)]">
                      <span>{clockTime(item.ts)}</span>
                      {item.token ? <span>· {shortAddr(item.token, 5)}</span> : null}
                      {item.txHash ? (
                        <a
                          href={explorerTx(item.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--brand-400)]"
                        >
                          explorer <ExternalLink size={11} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
