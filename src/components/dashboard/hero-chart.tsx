"use client";

import { useMemo, useState } from "react";
import { chartPoints, type ChartPoint, direction, dotStep, gridLines, monthName } from "@/lib/dashboard/day-series";
import type { RevenueCharts } from "@/lib/dashboard/revenue-trend";
import { formatPct, formatRp, formatRpShort } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

const SHAPES = [
  { id: "batang", label: "Batang" },
  { id: "titik", label: "Titik" },
  { id: "outlet", label: "Outlet" },
] as const;
type Shape = (typeof SHAPES)[number]["id"];

const COLOR = { naik: "var(--color-naik)", turun: "var(--color-turun)", sama: "var(--color-netral)", tanpa: "var(--color-netral)" } as const;
const DOT = 9;

/** "Sabtu 14 Nov: Rp 120.123.456 · naik 33,3% dari Sabtu 7 Nov". */
function detail(p: ChartPoint, what = ""): string {
  if (p.value === null) return `${what}${p.label}: belum ada data`;
  const d = direction(p.changePct);
  const change = p.changePct === null ? "" : d === "sama" ? ` · sama dengan ${p.against}` : ` · ${d} ${formatPct(Math.abs(p.changePct))} dari ${p.against}`;
  return `${what}${p.label}: ${formatRp(p.value)}${change}`;
}

/** Which points get a name on the axis: every fifth day, or the first week of a month. */
function axisName(points: ChartPoint[], i: number, unit: "hari" | "minggu"): string {
  const p = points[i];
  if (unit === "minggu") return i === 0 || p.start.slice(0, 7) !== points[i - 1].start.slice(0, 7) ? monthName(p.start) : "";
  if (points.length <= 10) return p.short;
  const day = Number(p.start.slice(8, 10));
  return day === 1 || (day % 5 === 0 && day < 31) ? p.short : "";
}

function Marker({ at, label }: { at: number; label: string }) {
  const left = `${at}%`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10" style={{ left }}>
      <div className="absolute inset-y-0 left-0 w-px bg-navy-900" />
      <span className={cn("absolute top-0 flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-navy-900 px-2.5 text-xs font-semibold text-white", at > 70 ? "right-0 translate-x-px" : "-left-px")}>
        <span className="h-2 w-2 rounded-full bg-lemon" />
        {label}
      </span>
      <span className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full border-2 border-navy-900 bg-lemon" />
    </div>
  );
}

function Legend({ unit, shape, step }: { unit: "hari" | "minggu"; shape: Shape; step: number }) {
  const items = [
    { color: COLOR.naik, text: `naik dari ${unit === "hari" ? "hari yang sama pekan lalu" : "minggu sebelumnya"}` },
    { color: COLOR.turun, text: "turun" },
    { color: COLOR.tanpa, text: "tanpa pembanding" },
  ];
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy-600">
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5", shape === "titik" ? "rounded-full" : "rounded-sm")} style={{ background: i.color }} />
          {i.text}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-2.5 w-2.5 border border-navy-400", shape === "titik" ? "rounded-full" : "border-dashed")} />
        belum ada data
      </span>
      {shape === "titik" && <span>1 titik = Rp {formatRpShort(step)}</span>}
    </p>
  );
}

/** Columns of bars or dots; pointing at (or focusing) one writes its date and exact amount above the chart. */
function Columns({ points, unit, lastIndex, shape }: { points: ChartPoint[]; unit: "hari" | "minggu"; lastIndex: number; shape: "batang" | "titik" }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const step = dotStep(max);
  const top = useMemo(
    () => new Set(points.map((p, i) => ({ i, v: p.value ?? 0 })).sort((a, b) => b.v - a.v).slice(0, 3).filter((x, k, all) => x.v > 0 && all.slice(0, k).every((y) => Math.abs(y.i - x.i) > 1)).map((x) => x.i)),
    [points],
  );
  const shown = active ?? lastIndex;
  const open = lastIndex >= 0 && lastIndex < points.length - 1;
  // Bars use 86% of the height, so the amounts above the highest ones stay inside.
  const height = (v: number) => (max > 0 ? (Math.max(v, 0) / max) * 86 : 0);
  return (
    <figure aria-label={`Revenue per ${unit}`}>
      <p className="min-h-6 text-base font-semibold text-navy-900" aria-live="polite">
        {points[shown] ? detail(points[shown]) : "Belum ada data"}
      </p>
      <div className="mt-2 flex">
        {shape === "batang" && (
          <div aria-hidden className="relative hidden h-64 w-16 shrink-0 sm:block">
            {gridLines(max).map((g) => (
              <span key={g} className="absolute left-0 translate-y-1/2 whitespace-nowrap text-xs tabular-nums text-navy-600" style={{ bottom: `${height(g)}%` }}>
                {formatRpShort(g)}
              </span>
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="relative h-64 border-b border-cream-400">
            {shape === "batang" && gridLines(max).map((g) => <span key={g} aria-hidden className="absolute inset-x-0 border-t border-cream-300" style={{ bottom: `${height(g)}%` }} />)}
            {open && <Marker at={((lastIndex + 1) / points.length) * 100} label={`Data s.d. ${points[lastIndex].short}`} />}
            <div className="relative flex h-full items-end">
              {points.map((p, i) => {
                const color = COLOR[direction(p.changePct)];
                const dots = p.value === null ? 0 : Math.max(1, Math.round(Math.max(p.value, 0) / step));
                return (
                  <button
                    key={p.start}
                    type="button"
                    aria-label={detail(p)}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className={cn("flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end", active === i && "bg-navy-900/5")}
                  >
                    {p.value === null ? (
                      <span className={cn("mb-1 border border-navy-300", shape === "titik" ? "h-[7px] w-[7px] rounded-full" : "h-2.5 w-[46%] max-w-5 border-dashed")} />
                    ) : shape === "titik" ? (
                      <span className="w-[9px] max-w-full" style={{ height: dots * DOT, background: `radial-gradient(circle at center, ${color} 3.4px, transparent 3.9px) bottom center / ${DOT}px ${DOT}px repeat-y` }} />
                    ) : (
                      <>
                        {top.has(i) && <span className="mb-2 hidden whitespace-nowrap text-xs font-semibold tabular-nums text-navy-900 sm:block">{formatRpShort(p.value)}</span>}
                        <span className="relative w-[46%] max-w-9" style={{ height: `${height(p.value)}%`, minHeight: 2, background: color }}>
                          <span aria-hidden className="absolute left-full top-0 hidden h-full w-[5px] origin-top-left -skew-y-[45deg] md:block" style={{ background: `color-mix(in srgb, ${color} 62%, white)` }} />
                          <span aria-hidden className="absolute bottom-full left-0 hidden h-[5px] w-full origin-bottom-left -skew-x-[45deg] md:block" style={{ background: `color-mix(in srgb, ${color} 34%, white)` }} />
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <Axis points={points} unit={unit} />
        </div>
      </div>
      <Legend unit={unit} shape={shape} step={step} />
    </figure>
  );
}

function Axis({ points, unit, sparse }: { points: ChartPoint[]; unit: "hari" | "minggu"; /** fewer names on a phone, where this chart is narrow */ sparse?: boolean }) {
  return (
    <div aria-hidden className="mt-2 flex">
      {points.map((p, i) => (
        <span key={p.start} className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap text-xs text-navy-600">
          <span className="w-0">
            <span className={cn("block w-max -translate-x-1/2", sparse && i > 0 && !/0$/.test(p.start) && "max-sm:hidden")}>
              {axisName(points, i, unit)}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** One line per outlet on its own scale: when was this outlet busy. Never compared by height. */
function OutletLines({ charts, start, end, outlets }: { charts: RevenueCharts; start: string; end: string; outlets: string[] }) {
  const rows = useMemo(() => outlets.map((name) => ({ name, ...chartPoints(charts, start, end, name) })), [charts, start, end, outlets]);
  const [active, setActive] = useState<{ row: number; i: number } | null>(null);
  const first = rows[0];
  if (!first) return <p className="py-6 text-center text-base text-navy-600">Belum ada data.</p>;
  const n = first.points.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const open = first.lastIndex >= 0 && first.lastIndex < n - 1;
  const shown = active ? detail(rows[active.row].points[active.i], `${rows[active.row].name}, `) : "Sentuh garis untuk melihat tanggal dan angkanya.";
  return (
    <figure aria-label="Revenue tiap outlet">
      <p className="min-h-6 text-base font-semibold text-navy-900" aria-live="polite">
        {shown}
      </p>
      <div className="relative mt-2 pt-8">
        {open && (
          <div aria-hidden className="absolute bottom-6 left-[10.75rem] right-[6.75rem] top-0 hidden sm:block">
            <Marker at={((first.lastIndex + 1) / n) * 100} label={`Data s.d. ${first.points[first.lastIndex].short}`} />
          </div>
        )}
        {rows.map((r, k) => {
          const max = Math.max(0, ...r.points.map((p) => p.value ?? 0));
          const y = (v: number) => (max > 0 ? 94 - (Math.max(v, 0) / max) * 84 : 94);
          const known = r.points.map((p, i) => ({ p, i })).filter((z): z is { p: ChartPoint & { value: number }; i: number } => z.p.value !== null);
          const line = r.points.reduce((d, p, i) => (p.value === null ? d : `${d}${i > 0 && r.points[i - 1].value !== null ? "L" : "M"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`), "");
          const peak = known.length && max > 0 ? known.reduce((a, b) => (b.p.value > a.p.value ? b : a)) : null;
          const total = known.reduce((s, z) => s + z.p.value, 0);
          return (
            <div key={r.name} className="flex flex-wrap items-end gap-x-3 sm:flex-nowrap">
              <div className="w-full shrink-0 pb-1 sm:w-40">
                <p className="truncate text-sm font-semibold text-navy-900" title={r.name}>{r.name}</p>
                <p className="text-sm tabular-nums text-navy-600">{known.length ? formatRpShort(total) : "Belum ada data"}</p>
              </div>
              <div
                className="relative h-12 min-w-0 flex-1 border-b border-cream-400"
                onMouseMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setActive({ row: k, i: Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n))) });
                }}
                onMouseLeave={() => setActive(null)}
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={peak ? `${r.name}: tertinggi ${detail(peak.p)}` : `${r.name}: belum ada data`}>
                  {known.length > 1 && <path d={`${line}L${x(known[known.length - 1].i)},100L${x(known[0].i)},100Z`} fill="var(--color-navy-900)" fillOpacity={0.07} />}
                  <path d={line} fill="none" stroke="var(--color-navy-900)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {peak && <span aria-hidden className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-lemon" style={{ left: `${x(peak.i)}%`, top: `${y(peak.p.value)}%` }} />}
                {active?.row === k && r.points[active.i].value !== null && (
                  <span aria-hidden className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-navy-900" style={{ left: `${x(active.i)}%`, top: `${y(r.points[active.i].value!)}%` }} />
                )}
              </div>
              <div className="w-24 shrink-0 pb-1 text-right text-sm">
                {peak && (
                  <>
                    <p className="text-navy-600">{peak.p.short}</p>
                    <p className="font-semibold tabular-nums text-navy-900">{formatRpShort(peak.p.value)}</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div className="mr-[6.75rem] sm:ml-[10.75rem]">
          <Axis points={first.points} unit={first.unit} sparse />
        </div>
      </div>
      <p className="mt-2 text-sm text-navy-600">Bulatan hijau = tertinggi (tanggal dan angkanya di kanan). Tinggi garis hanya untuk naik-turun outlet itu sendiri, jangan dibandingkan antar outlet.</p>
    </figure>
  );
}

/** The chart of the main card: the same revenue as bars, dots, or one line per outlet. */
export function HeroChart({ charts, start, end, outlets }: { charts: RevenueCharts; start: string; end: string; outlets: string[] }) {
  const [shape, setShape] = useState<Shape>("batang");
  const all = useMemo(() => chartPoints(charts, start, end, null), [charts, start, end]);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-navy-900">{shape === "outlet" ? `Revenue per ${all.unit}, tiap outlet` : `Revenue per ${all.unit}`}</h2>
        <div role="group" aria-label="Bentuk grafik" className="skeuo-inset flex gap-1 p-1">
          {SHAPES.map((s) => (
            <button key={s.id} type="button" aria-pressed={shape === s.id} onClick={() => setShape(s.id)} className={cn("min-h-9 rounded-xl px-3.5 text-sm font-semibold", shape === s.id ? "skeuo-pill-light" : "text-navy-600 hover:text-navy-900")}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {shape === "outlet" ? <OutletLines charts={charts} start={start} end={end} outlets={outlets} /> : <Columns {...all} shape={shape} />}
    </div>
  );
}

/**
 * Mini bars of one outlet in the list, the same days as the main chart, coloured like it (dark green up, red
 * down against the same weekday a week earlier); pointing at a bar names its day and amount.
 */
export function MiniBars({ charts, start, end, outlet }: { charts: RevenueCharts; start: string; end: string; outlet: string }) {
  const { points } = useMemo(() => chartPoints(charts, start, end, outlet), [charts, start, end, outlet]);
  const [active, setActive] = useState<number | null>(null);
  const known = points.filter((p) => p.value !== null);
  const max = Math.max(0, ...known.map((p) => p.value ?? 0));
  return (
    <span className="relative flex h-9 min-w-0 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
      {known.map((p, i) => (
        <span
          key={p.start}
          title={detail(p)}
          onMouseEnter={() => setActive(i)}
          className={cn("min-w-0 max-w-3 flex-1 rounded-t-sm", active !== null && active !== i && "opacity-40")}
          style={{ height: `${max > 0 ? (Math.max(p.value ?? 0, 0) / max) * 100 : 0}%`, minHeight: 3, background: COLOR[direction(p.changePct)] }}
        />
      ))}
      {active !== null && known[active] && (
        <span className="pointer-events-none absolute -top-7 left-0 z-10 whitespace-nowrap rounded-full bg-navy-900 px-2.5 py-0.5 text-xs font-semibold text-white">{detail(known[active])}</span>
      )}
    </span>
  );
}
