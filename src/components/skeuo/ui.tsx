import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkeuoCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("skeuo-card p-4", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-4xl font-semibold tracking-tight text-navy-900 md:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 text-lg text-navy-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

const PILL = "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold";

export function PillLink({ href, tone = "dark", icon: Icon, children }: { href: string; tone?: "dark" | "light"; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(PILL, tone === "dark" ? "skeuo-pill-dark hover:brightness-110" : "skeuo-pill-light hover:brightness-[1.02]")}>
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Link>
  );
}

export function PillAnchor({ href, tone = "light", icon: Icon, children }: { href: string; tone?: "dark" | "light"; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <a href={href} className={cn(PILL, tone === "dark" ? "skeuo-pill-dark hover:brightness-110" : "skeuo-pill-light hover:brightness-[1.02]")}>
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </a>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-800",
  ember: "bg-ember-50 text-ember-600",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-cream-200 text-navy-700",
  muted: "bg-cream-200 text-navy-500",
} as const;
export type Tone = keyof typeof TONES;

export function IconTile({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: Tone }) {
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-[inset_0_1px_0_#fff,0_2px_5px_rgba(40,46,54,.14)]", TONES[tone])}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function StatusPill({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-base font-semibold", TONES[tone])}>{children}</span>;
}

/** Change against the comparison: dark green up, red down; nothing when there is no baseline. */
export function DeltaPill({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-base text-navy-600">
      <StatusPill tone={up ? "green" : "ember"}>
        <Icon className="h-3 w-3" />
        {Math.abs(value).toFixed(1)}%
      </StatusPill>
      {suffix}
    </span>
  );
}

/** Thin inset track with a dark green fill (capped at 100%). */
export function ProgressTrack({ pct, label }: { pct: number; label: string }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="skeuo-track h-3 w-full" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}>
      <div className="h-full rounded-full bg-emerald-800" style={{ width: `${width}%` }} />
    </div>
  );
}

/** Green arc on an inset ring, percentage in the middle. */
export function RingProgress({ pct, caption, label, size = 104 }: { pct: number; caption: string; label: string; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const shown = Math.min(100, Math.max(0, pct));
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${pct.toFixed(1)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#d6dbe0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-naik)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-white shadow-[0_3px_8px_rgba(40,46,54,.16)]">
        <span className="text-2xl font-bold tabular-nums text-navy-900">{Math.round(pct)}%</span>
        <span className="text-sm text-navy-600">{caption}</span>
      </div>
    </div>
  );
}

/** Row of a feed/list card: icon tile, title + subtitle, value on the right. */
export function FeedRow({ icon, tone, title, subtitle, value, valueTone }: { icon: LucideIcon; tone?: Tone; title: React.ReactNode; subtitle?: React.ReactNode; value?: React.ReactNode; valueTone?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-navy-900">{title}</p>
        {subtitle && <p className="truncate text-base text-navy-600">{subtitle}</p>}
      </div>
      {value !== undefined && <div className={cn("shrink-0 text-right text-lg font-semibold tabular-nums", valueTone ?? "text-navy-800")}>{value}</div>}
    </div>
  );
}
