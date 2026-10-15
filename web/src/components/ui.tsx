import clsx from "clsx";
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className,
  hero,
}: {
  children: ReactNode;
  className?: string;
  hero?: boolean;
}) {
  return <div className={clsx("card p-5", hero && "card-hero", className)}>{children}</div>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "ghost", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        "btn",
        `btn-${variant}`,
        size === "lg" && "h-[52px] px-6 text-[15px]",
        size === "md" && "h-11 px-4 text-sm",
        size === "sm" && "h-9 px-3 text-[13px]",
        className,
      )}
      {...rest}
    />
  );
}

export function Field(props: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { className, mono, ...rest } = props;
  return <input className={clsx("field", mono && "field-mono", className)} {...rest} />;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[12px] font-semibold tracking-wide text-[var(--muted)] uppercase">
      {children}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={clsx("toggle", disabled && "opacity-50")}
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const PILL_TONES: Record<string, CSSProperties> = {
  muted: {},
  success: {
    color: "var(--success)",
    borderColor: "rgba(52,211,153,.3)",
    background: "rgba(52,211,153,.08)",
  },
  warn: { color: "var(--warn)", borderColor: "rgba(251,191,36,.3)", background: "rgba(251,191,36,.08)" },
  error: {
    color: "var(--danger)",
    borderColor: "rgba(251,113,133,.3)",
    background: "rgba(251,113,133,.08)",
  },
  brand: {
    color: "var(--brand-400)",
    borderColor: "rgba(91,155,255,.3)",
    background: "rgba(91,155,255,.1)",
  },
};

export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "success" | "warn" | "error" | "brand";
  className?: string;
}) {
  return (
    <span className={clsx("pill", className)} style={PILL_TONES[tone]}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="inset p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">
        {label}
      </div>
      <div
        className={clsx(
          "font-display mt-1.5 text-2xl font-bold",
          accent ? "accent" : "text-[var(--text)]",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-[var(--muted-dim)]">{hint}</div> : null}
    </div>
  );
}

export function Row({ className }: { className?: string }) {
  return <div className={clsx("divider my-4", className)} />;
}
