"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Calculator, ExternalLink, ListChecks, Scale, Tags } from "lucide-react";
import { SkeuoCard } from "@/components/skeuo/ui";
import {
  fmtCompactRupiah,
  type SnCompsetAudit,
  type SnOutletMarketShare,
  type SnResortMarketSize,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";
import { sanitizePublicText } from "./sn-competitor-detail-modal";

type ResortFilter = "semua" | "bintang4" | "bintang5" | "acuan";

const formatPercent = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "Belum ada data"
    : `${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const shortOutletName = (o: SnOutletMarketShare) => o.outletName.replace(/\s*\(.*\)$/, "");
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

function Pillar({
  n,
  icon,
  title,
  subtitle,
  children,
  footer,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <article className="flex flex-col justify-between rounded-2xl border border-cream-300 bg-white p-4">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-navy-800" aria-hidden>
            {icon}
          </span>
          <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-navy-800">Pilar {n}</span>
        </div>
        <h3 className="mt-3 text-base font-semibold text-navy-900">{title}</h3>
        <p className="mt-0.5 text-xs font-semibold text-navy-600">{subtitle}</p>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-navy-700">{children}</div>
      </div>
      <div className="mt-4 rounded-xl border border-cream-200 bg-cream-50 p-3 text-xs">{footer}</div>
    </article>
  );
}

/**
 * Tampilan lengkap Metodologi & Validasi Insight Pasar
 * (krem hangat + cokelat espresso).
 */
export function SnMethodologyView({
  onBack,
  marketShare,
  marketSize,
  audit,
}: {
  onBack?: () => void;
  marketShare: Record<string, SnOutletMarketShare>;
  marketSize?: SnResortMarketSize;
  audit?: Record<string, SnCompsetAudit>;
}) {
  const [filter, setFilter] = useState<ResortFilter>("semua");

  const consolidated = marketShare.all;
  const outlets = Object.entries(marketShare)
    .filter(([k]) => k !== "all")
    .map(([, v]) => v);
  const resort = marketShare.resort;
  const resortUsed = useMemo(
    () => audit?.resort?.used ?? resort?.benchmarkCompetitors ?? [],
    [audit?.resort?.used, resort?.benchmarkCompetitors],
  );
  const excludedAll = audit?.all?.excluded ?? [];

  const counts = {
    bintang4: resortUsed.filter((r) => r.compsetRole === "inti" && r.starRating === 4).length,
    bintang5: resortUsed.filter((r) => r.compsetRole === "inti" && (r.starRating ?? 0) >= 5).length,
    acuan: resortUsed.filter((r) => r.compsetRole === "benchmark").length,
  };

  const filtered = useMemo(
    () =>
      resortUsed.filter((r) =>
        filter === "semua"
          ? true
          : filter === "acuan"
            ? r.compsetRole === "benchmark"
            : r.compsetRole === "inti" && (filter === "bintang5" ? (r.starRating ?? 0) >= 5 : r.starRating === 4),
      ),
    [resortUsed, filter],
  );

  const filters: { key: ResortFilter; label: string }[] = [
    { key: "semua", label: `Semua (${resortUsed.length})` },
    { key: "bintang4", label: `Bintang 4 (${counts.bintang4})` },
    { key: "bintang5", label: `Bintang 5 (${counts.bintang5})` },
    ...(counts.acuan ? [{ key: "acuan" as const, label: `Acuan (${counts.acuan})` }] : []),
  ];

  const tpk = marketSize?.tpk ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-navy-900 p-6 text-cream-50 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 pb-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-cream-300">Metodologi &amp; Validasi</p>
            <h2 className="mt-1 text-2xl font-bold text-white">Metodologi riset pasar &amp; audit pembanding</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-cream-200">
              Cara Market Cap kamar resort dihitung, dari mana omset dan harga diambil, dan aturan memilih pembanding.
              Setiap angka di bawah punya sumber; yang belum bersumber ditulis &ldquo;Belum ada data&rdquo;.
            </p>
          </div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-full bg-cream-100 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Kembali ke Insight Pasar
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-3.5">
            <p className="text-xs text-cream-300">Market Cap kamar resort (perkiraan kasar)</p>
            <p className="mt-1 text-lg font-bold text-amber-200">
              {fmtCompactRupiah(consolidated?.totalMarketSizeEstimated)}
              {consolidated?.totalMarketSizeEstimated !== null && consolidated?.totalMarketSizeEstimated !== undefined ? "/bln" : ""}
            </p>
            <p className="text-[11px] text-cream-300">Resort bintang 4–5 dalam 25 km · outlet F&amp;B belum dihitung</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-3.5">
            <p className="text-xs text-cream-300">Sumber data operasional VHP</p>
            <p className="mt-1 text-lg font-bold text-white">
              {marketSize?.sanghyang.actual ? monthLabel(marketSize.sanghyang.actual.month) : (consolidated?.activeMonth ?? "Belum ada data")}
            </p>
            <p className="text-[11px] text-cream-300">Pangsa dihitung di server; nominal rupiah hanya tampil di Dashboard Operasional</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-3.5">
            <p className="text-xs text-cream-300">Pangsa pasar kamar resort</p>
            <p className="mt-1 text-lg font-bold text-white">{formatPercent(resort?.marketSharePercentage)}</p>
            <p className="text-[11px] text-cream-300">{resort?.marketRank ?? "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-3.5">
            <p className="text-xs text-cream-300">Pembanding resort</p>
            <p className="mt-1 text-lg font-bold text-white">
              {counts.bintang4 + counts.bintang5} dihitung{counts.acuan ? ` · ${counts.acuan} acuan` : ""}
            </p>
            <p className="text-[11px] text-cream-300">
              {counts.bintang4} bintang 4 dan {counts.bintang5} bintang 5
            </p>
          </div>
        </div>
      </div>

      <SkeuoCard className="space-y-4">
        <h3 className="text-lg font-semibold text-navy-900">Empat pilar metodologi</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Pillar
            n={1}
            icon={<Calculator className="h-5 w-5" />}
            title="Market Cap kamar resort"
            subtitle="Perkiraan kasar dari TPK BPS dan tarif OTA"
            footer={
              <>
                <p className="font-semibold text-navy-900">
                  Market Cap: {fmtCompactRupiah(consolidated?.totalMarketSizeEstimated)}
                  {consolidated?.totalMarketSizeEstimated != null ? "/bln" : ""}
                </p>
                <p className="mt-1 text-[11px] text-navy-600">
                  {outlets.map((o) => `${shortOutletName(o)}: ${fmtCompactRupiah(o.totalMarketSizeEstimated)}`).join(" · ")}
                </p>
              </>
            }
          >
            <p>
              Kamar × {marketSize?.daysPerMonth ?? 30} hari × TPK hotel bintang Banten × tarif OTA terbobot (5 malam hari
              biasa + 2 malam akhir pekan), dijumlah untuk Sanghyang dan pembanding inti.
              {counts.acuan ? " Acuan tidak dihitung." : ""}
            </p>
            <p>
              {tpk ? (
                <>
                  TPK {tpk.percent.toLocaleString("id-ID")}% untuk {monthLabel(tpk.period)} dari{" "}
                  <a href={tpk.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-navy-800 underline">
                    rilis BPS Banten
                  </a>
                  .
                </>
              ) : (
                "TPK BPS belum tersedia, jadi Market Cap belum bisa dihitung."
              )}{" "}
              Tarif dari pantauan Google Travel {marketSize?.ratesCapturedAt ?? "(belum ada)"}.
            </p>
            <p>Outlet F&amp;B belum dihitung karena kapasitas kursi dan rata-rata belanja per tamu belum ada dari sumber resmi.</p>
          </Pillar>

          <Pillar
            n={2}
            icon={<Scale className="h-5 w-5" />}
            title="Omset aktual vs perkiraan pembanding"
            subtitle="Pembukuan Sanghyang dan rumus yang sama untuk kompetitor"
            footer={
              <>
                <p className="font-semibold text-navy-900">Pangsa kamar resort: {formatPercent(resort?.marketSharePercentage)}</p>
                <p className="mt-1 text-[11px] text-navy-600">{resort?.marketRank ?? "—"}</p>
              </>
            }
          >
            <p>
              Omset kamar Sanghyang ({resort?.activeMonth ?? "—"}) dari pembukuan dibanding perkiraan omset pembanding
              inti dengan rumus Pilar 1. Bila omset aktual belum tersedia, pangsa memakai perkiraan Sanghyang dengan rumus
              yang sama.
            </p>
            <p>
              Untuk outlet F&amp;B yang dipakai adalah pangsa jumlah ulasan Google di antara outlet dan pembandingnya,
              sebagai proksi popularitas, bukan omset.
            </p>
          </Pillar>

          <Pillar
            n={3}
            icon={<Tags className="h-5 w-5" />}
            title="Sumber harga dan promo"
            subtitle="Tarif OTA, menu resmi, dan radar promo"
            footer={
              <>
                <p className="font-semibold text-navy-900">
                  Indeks harga kamar:{" "}
                  {resort?.pricePositioningIndex != null ? resort.pricePositioningIndex.toLocaleString("id-ID") : "Belum ada data"}
                </p>
                <p className="mt-1 text-[11px] text-navy-600">
                  100 = rata-rata tarif pembanding bintang 4. Indeks F&amp;B belum dihitung.
                </p>
              </>
            }
          >
            <p>Tarif kamar: penawaran OTA per tipe kamar dari pantauan Google Travel dan situs resmi masing-masing penginapan.</p>
            <p>
              Harga menu Sanghyang diambil dari situs resmi sanghyang.com. Harga menu kompetitor berasal dari toko daring,
              unggahan resmi kompetitor, serta foto menu unggahan pengguna di Google Maps.
            </p>
            <p>Promo: postingan media sosial dan halaman promo situs resmi kompetitor di daftar pembanding, dibaca setiap pembaruan data.</p>
          </Pillar>

          <Pillar
            n={4}
            icon={<ListChecks className="h-5 w-5" />}
            title="Aturan pembanding"
            subtitle="Sejenis, dekat, dan setara kelasnya"
            footer={
              <>
                <p className="font-semibold text-navy-900">Dikeluarkan: {excludedAll.length} tempat</p>
                <p className="mt-1 text-[11px] text-navy-600">
                  {excludedAll.slice(0, 6).map((c) => c.name).join(", ")}
                  {excludedAll.length > 6 ? ", …" : ""}
                </p>
              </>
            }
          >
            <p>
              Sejenis dengan outlet Sanghyang, jarak tempuh mobil paling jauh 25 km dari Sanghyang (Google Maps), dan untuk
              penginapan minimal bintang 4 seperti Sanghyang.
            </p>
            <p>
              Pembanding inti dihitung di pangsa pasar dan koridor harga.{counts.acuan ? " Acuan hanya ditampilkan." : ""}{" "}
              Yang tidak lolos diarsipkan beserta alasannya.
            </p>
          </Pillar>
        </div>
      </SkeuoCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeuoCard>
          <h3 className="border-b border-cream-300 pb-2.5 text-base font-semibold text-navy-900">Aturan pemilihan pembanding</h3>
          <table className="table-compact mt-2.5 w-full text-left text-xs">
            <thead>
              <tr>
                <th>Kriteria</th>
                <th>Syarat</th>
                <th>Sumber</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200 text-navy-800">
              <tr>
                <td className="font-semibold">Jenis usaha</td>
                <td>Sejenis dengan outlet (resort, resto, bar, spa)</td>
                <td className="text-navy-600">Kategori Google Maps dan situs resmi</td>
              </tr>
              <tr>
                <td className="font-semibold">Jarak</td>
                <td>Paling jauh 25 km jarak tempuh mobil</td>
                <td className="text-navy-600">Rute Google Maps dari Sanghyang</td>
              </tr>
              <tr>
                <td className="font-semibold">Kelas penginapan</td>
                <td>Minimal bintang 4</td>
                <td className="text-navy-600">Kelas hotel di Google Maps dan OTA</td>
              </tr>
              <tr>
                <td className="font-semibold">Peran</td>
                <td>Kompetitor inti dihitung, acuan hanya ditampilkan</td>
                <td className="text-navy-600">Keputusan pemilik di daftar kompetitor</td>
              </tr>
            </tbody>
          </table>
        </SkeuoCard>

        <SkeuoCard>
          <h3 className="border-b border-cream-300 pb-2.5 text-base font-semibold text-navy-900">Cakupan data operasional per unit bisnis</h3>
          <table className="table-compact mt-2.5 w-full text-left text-xs">
            <thead>
              <tr>
                <th>Unit bisnis</th>
                <th>Periode VHP</th>
                <th className="text-right">Pangsa / Posisi Harga</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200 text-navy-800">
              {outlets.map((o) => (
                <tr key={o.outletKey}>
                  <td className="font-semibold">{shortOutletName(o)}</td>
                  <td className="text-navy-600">{o.activeMonth}</td>
                  <td className="text-right font-semibold">
                    {o.marketSharePercentage != null ? (
                      formatPercent(o.marketSharePercentage)
                    ) : o.pricePositioningIndex != null ? (
                      `Indeks ${o.pricePositioningIndex.toLocaleString("id-ID")}`
                    ) : (
                      <span className="font-normal text-navy-500">Proksi ulasan Google</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {consolidated && (
              <tfoot className="border-t-2 border-cream-300 font-semibold text-navy-900">
                <tr>
                  <td className="py-2">Ringkasan ({consolidated.activeMonth})</td>
                  <td />
                  <td className="py-2 text-right text-navy-600">
                    Nominal rupiah hanya tampil di Dashboard Operasional
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </SkeuoCard>
      </div>

      <SkeuoCard className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-cream-300 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">Audit pembanding resort</p>
            <h3 className="text-lg font-semibold text-navy-900">
              Hasil audit {resortUsed.length} resort pembanding Anyer–Carita
            </h3>
          </div>
          <div className="skeuo-inset flex flex-wrap gap-1 p-1 text-xs" role="group" aria-label="Saring pembanding resort">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn("rounded-full px-3 py-1 font-semibold", filter === f.key ? "skeuo-pill-dark" : "text-navy-600 hover:text-navy-900")}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((r) => (
            <article
              key={r.name}
              className={cn(
                "rounded-2xl border p-4",
                r.compsetRole === "benchmark" ? "border-amber-200 bg-amber-50/50" : "border-cream-300 bg-white",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-navy-900">{r.name}</h4>
                {r.compsetRole && (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      r.compsetRole === "benchmark" ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800",
                    )}
                  >
                    {r.compsetRole === "benchmark" ? "Acuan" : "Kompetitor Inti"}
                  </span>
                )}
              </div>
              {r.auditRationale && (
                <p className="mt-1.5 text-xs leading-relaxed text-navy-700">{sanitizePublicText(r.auditRationale)}</p>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-cream-50 p-2.5">
                  <dt className="text-navy-500">Perkiraan omset kamar</dt>
                  <dd className="font-semibold text-navy-900">
                    {r.estimatedRevenue != null ? `${fmtCompactRupiah(r.estimatedRevenue)}/bln` : "Belum ada data"}
                  </dd>
                  <dd className="text-[11px] text-navy-600">Pangsa {formatPercent(r.estimatedMarketShare)}</dd>
                </div>
                <div className="rounded-xl bg-cream-50 p-2.5">
                  <dt className="text-navy-500">Harga vs Sanghyang</dt>
                  <dd className="font-semibold text-navy-900">{r.priceLevel ?? "Belum ada data"}</dd>
                </div>
              </dl>
              {r.evidenceSourceUrl && (
                <a
                  href={r.evidenceSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-navy-800 underline"
                >
                  Sumber <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </article>
          ))}
        </div>

        {(audit?.resort?.excluded.length ?? 0) > 0 && (
          <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <h4 className="text-sm font-semibold text-navy-900">Resort yang dikeluarkan</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-navy-700">
              {audit?.resort?.excluded.map((c) => (
                <li key={c.name}>
                  <strong className="text-navy-900">{c.name}</strong>: {sanitizePublicText(c.reason ?? "Tidak memenuhi kriteria")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SkeuoCard>
    </div>
  );
}
