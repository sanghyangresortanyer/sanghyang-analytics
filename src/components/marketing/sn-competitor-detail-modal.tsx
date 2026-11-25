"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Bath,
  ExternalLink,
  Hotel,
  MessageSquare,
  Scale,
  ShieldCheck,
  Sparkles,
  Tv,
  Utensils,
  UtensilsCrossed,
  Waves,
} from "lucide-react";
import {
  checkInLabel,
  fmtRupiah,
  sanitizePublicText,
  type SnFnbMatrixEntry,
  type SnFnbMenuItem,
  type SnHotelMatrixEntry,
  type SnHotelRoomSubRow,
  type SnRoomOtaLayer,
  type SnSourceRef,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";

export { checkInLabel, sanitizePublicText };

export function breakfastText(bf: boolean | null | undefined): string {
  if (bf === true) return "termasuk sarapan";
  if (bf === false) return "tanpa sarapan";
  return "sarapan tidak disebutkan";
}

const GROUP_LABEL: Record<string, string> = { resort: "Resort", hotel: "Hotel" };

const CATEGORY_LABEL: Record<string, string> = {
  standard: "Kamar standar",
  suite: "Suite",
  villa: "Villa",
  condo: "Condo",
  cottage: "Cottage",
};

function rupiahRange(min: number, max: number): string {
  return min === max ? fmtRupiah(min) : `${fmtRupiah(min)} – ${fmtRupiah(max)}`;
}

function servingLabel(m: Pick<SnFnbMenuItem, "kind" | "pax" | "unit">): string | null {
  if (m.kind === "paket-bersama") return m.pax ? `paket ${m.pax} orang` : "paket beberapa orang";
  if (m.kind === "sewa-ruang") return m.unit ? "sewa ruang" : "paket sewa ruang";
  return null;
}

export function formatMenuItemPrice(m: SnFnbMenuItem): string {
  const label = servingLabel(m);
  return `${rupiahRange(m.price, m.priceMax ?? m.price)}${m.unit ? ` ${m.unit}` : ""}${label ? `, ${label}` : ""}`;
}

export function formatPerPersonRange(r: { min: number; max: number }): string {
  return `${rupiahRange(r.min, r.max)} per orang`;
}

function readReviewTopics(raw: unknown): { label: string; count: number | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; count: number | null }[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ label: item.trim(), count: null });
    } else if (item && typeof item === "object" && "label" in item) {
      const obj = item as { label?: unknown; count?: unknown };
      if (typeof obj.label === "string" && obj.label.trim()) {
        out.push({
          label: obj.label.trim(),
          count: typeof obj.count === "number" && Number.isFinite(obj.count) ? obj.count : null,
        });
      }
    }
  }
  return out;
}

/** Tautan eksternal ringkas dengan ikon panah keluar. */
export function SnExtLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("/") ? undefined : "_blank"}
      rel="noreferrer"
      className={cn("inline-flex items-center gap-0.5 text-navy-800 underline hover:text-navy-950", className)}
    >
      {children}
      <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden />
    </a>
  );
}

/** Lencana status sarapan (Termasuk sarapan / Tanpa sarapan / Tersedia keduanya / Belum tercatat). */
export function SnBreakfastBadge({ status }: { status: string }) {
  const cls =
    status === "Termasuk sarapan"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : status === "Tanpa sarapan"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : status === "Tersedia keduanya"
          ? "border-sky-300 bg-sky-50 text-sky-800"
          : "border-cream-300 bg-cream-100 text-navy-600";
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold", cls)}>
      <UtensilsCrossed className="h-2.5 w-2.5 shrink-0" aria-hidden />
      {status}
    </span>
  );
}

/** Satu sisi tarif OTA termurah: harga, penyedia OTA klikable, tanggal check-in, status sarapan, dan penanda termurah properti. */
function SnOtaSide({ ota, stay }: { ota: SnRoomOtaLayer; stay: "weekday" | "weekend" }) {
  const price = stay === "weekday" ? ota.weekdayPrice : ota.weekendPrice;
  const label = stay === "weekday" ? "Hari biasa" : "Akhir pekan";
  if (price === null || price === undefined) {
    return <div className="text-navy-500">{label}: belum ada data</div>;
  }
  const name = (stay === "weekday" ? ota.weekdayOtaName : ota.weekendOtaName) ?? ota.otaName;
  const url = (stay === "weekday" ? ota.weekdayOtaUrl : ota.weekendOtaUrl) ?? ota.otaUrl;
  const checkIn = stay === "weekday" ? ota.weekdayCheckIn : ota.weekendCheckIn;
  const bf = stay === "weekday" ? ota.weekdayBreakfast : ota.weekendBreakfast;
  const propertyLowest = stay === "weekday" ? ota.weekdayIsPropertyLowest : ota.weekendIsPropertyLowest;
  return (
    <div className="leading-snug">
      <span className="text-navy-600">{label}:</span>{" "}
      <b className="tabular-nums text-navy-900">{fmtRupiah(price)}</b>{" "}
      {url ? (
        <SnExtLink href={url} className="font-semibold">
          via {name}
        </SnExtLink>
      ) : (
        <span className="font-semibold text-navy-800">via {name}</span>
      )}
      <span className="text-navy-600">
        {checkIn ? ` · check-in ${checkInLabel(checkIn)}` : ""} · {breakfastText(bf)}
        {propertyLowest ? " · termurah properti di jendela" : ""}
      </span>
    </div>
  );
}

/** Rincian tarif OTA termurah hari biasa & akhir pekan. */
export function SnOtaSides({ ota }: { ota: SnRoomOtaLayer | null }) {
  if (!ota) return <span className="text-navy-500">Belum ada data OTA untuk tipe ini di jendela tarif</span>;
  return (
    <div className="space-y-1">
      <SnOtaSide ota={ota} stay="weekday" />
      <SnOtaSide ota={ota} stay="weekend" />
    </div>
  );
}

/** Rincian harga situs resmi per jenis hari dengan tanggal check-in, sarapan, rate plan, dan penanda malam berbeda. */
export function SnOfficialPrice({ rt }: { rt: Pick<SnHotelRoomSubRow, "officialRate" | "officialUnavailableReason"> }) {
  const off = rt.officialRate;
  if (!off) {
    return <span className="text-navy-500">{rt.officialUnavailableReason ?? "Tarif situs resmi belum tercatat"}</span>;
  }

  const renderSide = (stay: "weekday" | "weekend") => {
    const wd = stay === "weekday";
    const price = wd ? off.weekdayPrice : off.weekendPrice;
    const otherNight = wd ? off.weekdayOtherNightPrice ?? null : off.weekendOtherNightPrice ?? null;
    const checkIn = wd ? off.weekdayCheckIn : off.weekendCheckIn;
    const bf = wd ? off.weekdayBreakfast : off.weekendBreakfast;
    const url = wd ? off.weekdaySourceUrl : off.weekendSourceUrl;
    const otaCheckIn = wd ? off.otaCheckInWeekday : off.otaCheckInWeekend;
    const unavailReason = wd ? off.weekdayUnavailableReason : off.weekendUnavailableReason;

    return (
      <div className="leading-snug">
        <span className="text-navy-600">{wd ? "Hari biasa" : "Akhir pekan"}:</span>{" "}
        {price !== null ? (
          <>
            {url ? (
              <SnExtLink href={url} className="font-bold text-emerald-900">
                <span className="tabular-nums">{fmtRupiah(price)}</span>
              </SnExtLink>
            ) : (
              <b className="tabular-nums text-emerald-900">{fmtRupiah(price)}</b>
            )}
            {checkIn || (bf !== null && bf !== undefined) ? (
              <span className="text-navy-600">
                {checkIn ? ` · check-in ${checkInLabel(checkIn)}` : ""}
                {bf !== null && bf !== undefined ? ` · ${breakfastText(bf)}` : ""}
              </span>
            ) : null}
          </>
        ) : otherNight !== null ? (
          <>
            <span className="text-navy-600">
              Situs resmi, check-in {checkIn ? checkInLabel(checkIn) : "belum tercatat"}:
            </span>{" "}
            {url ? (
              <SnExtLink href={url} className="font-semibold text-navy-800">
                <span className="tabular-nums">{fmtRupiah(otherNight)}</span>
              </SnExtLink>
            ) : (
              <b className="tabular-nums text-navy-800">{fmtRupiah(otherNight)}</b>
            )}
            {bf !== null && bf !== undefined ? <span className="text-navy-600"> · {breakfastText(bf)}</span> : null}
            <span className="mt-0.5 block text-[10px] text-amber-800">
              Tidak dihitung di rentang, harga termurah, atau selisih karena malamnya beda dengan tarif OTA
              {otaCheckIn ? ` (check-in ${checkInLabel(otaCheckIn)})` : ""}.
            </span>
          </>
        ) : (
          <span className="text-navy-500">{unavailReason ?? "belum ada data"}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {renderSide("weekday")}
      {renderSide("weekend")}
      {off.ratePlan && <div className="text-[10px] text-navy-600">{off.ratePlan}</div>}
      {off.breakfastLabel && (
        <div className="pt-0.5">
          <SnBreakfastBadge status={off.breakfastLabel} />
        </div>
      )}
    </div>
  );
}

/** Daftar tautan sumber + tanggal observasi di bawah poin fasilitas atau kartu fasilitas. */
export function SnSourceList({ sources }: { sources?: SnSourceRef[] | null }) {
  if (!sources || sources.length === 0) {
    return <span className="mt-0.5 block text-[10px] text-navy-500">Sumber belum tercatat</span>;
  }
  return (
    <span className="mt-0.5 block text-[10px] leading-relaxed text-navy-500">
      Sumber:{" "}
      {sources.map((s, i) => (
        <span key={`${s.label}-${i}`}>
          {i > 0 ? "; " : ""}
          {s.url ? (
            <a
              href={s.url}
              target={s.url.startsWith("/") ? undefined : "_blank"}
              rel="noreferrer"
              className="text-navy-800 underline hover:text-navy-950"
            >
              {sanitizePublicText(s.label)}
            </a>
          ) : (
            sanitizePublicText(s.label)
          )}
          {s.observedAt ? ` (${s.observedAt.slice(0, 10)})` : ""}
        </span>
      ))}
    </span>
  );
}

function FacilityCard({
  icon,
  title,
  value,
  note,
  source,
}: {
  icon?: ReactNode;
  title: string;
  value: string;
  note?: string | null;
  source?: SnSourceRef;
}) {
  return (
    <div className="rounded-xl border border-cream-300 bg-cream-50 p-3">
      <span className="flex items-center gap-1.5 font-semibold text-navy-900">
        {icon}
        {title}
      </span>
      <span className="mt-0.5 block font-bold text-navy-800">{value}</span>
      {note && <span className="mt-0.5 block text-[10px] leading-snug text-navy-600">{note}</span>}
      <SnSourceList sources={source ? [source] : []} />
    </div>
  );
}

function PhotoTile({ url, alt, aspectClass = "aspect-[4/3]" }: { url: string; alt: string; aspectClass?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-cream-300 bg-cream-100 p-3 text-center text-[11px] text-navy-600",
          aspectClass,
        )}
      >
        Foto tidak dapat dimuat dari sumbernya
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-xl border border-cream-300 bg-white"
      title={`Buka ukuran penuh: ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- foto eksternal berizin dari Google/situs resmi */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]", aspectClass)}
      />
    </a>
  );
}

function ModalShell({
  titleId,
  maxWidthClass,
  onClose,
  header,
  children,
}: {
  titleId: string;
  maxWidthClass: string;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5"
    >
      <div
        className={cn(
          "skeuo-card flex max-h-[90vh] w-full flex-col overflow-hidden p-0 shadow-2xl",
          maxWidthClass,
        )}
      >
        <div className="shrink-0 border-b border-cream-300 bg-cream-50/95 px-5 py-4">{header}</div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs">{children}</div>
      </div>
    </div>
  );
}

/** Tabel 9 kolom Rincian Semua Tipe Kamar & Luas di dalam modal detail Hotel/Resort. */
function SnHotelRoomTypesTable({ roomTypes }: { roomTypes: SnHotelRoomSubRow[] }) {
  if (!roomTypes.length) return null;
  const multiCount = roomTypes.filter((rt) => (rt.bedrooms ?? 0) >= 2).length;

  return (
    <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 pb-2.5">
        <div className="flex items-center gap-2">
          <Hotel className="h-4 w-4 text-navy-800" aria-hidden />
          <h4 className="text-sm font-bold text-navy-900">
            Rincian Semua Tipe Kamar &amp; Luas ({roomTypes.length} tipe
            {multiCount > 0 ? ` · ${multiCount} unit 2+ kamar tidur` : ""})
          </h4>
        </div>
        <span className="rounded-full border border-cream-300 bg-cream-100 px-2.5 py-0.5 text-[10px] font-semibold text-navy-700">
          Situs resmi menang bila berbeda dengan OTA
        </span>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-cream-200">
        <table className="table-compact w-full min-w-[860px] text-left text-xs">
          <caption className="sr-only">
            Tipe kamar, luas, harga situs resmi dan OTA termurah, serta fasilitas kamar
          </caption>
          <thead>
            <tr>
              <th scope="col">Tipe Kamar</th>
              <th scope="col">Konfigurasi</th>
              <th scope="col">Luas</th>
              <th scope="col">Situs resmi</th>
              <th scope="col">OTA termurah</th>
              <th scope="col">Sarapan</th>
              <th scope="col">Smart TV</th>
              <th scope="col">Bathtub</th>
              <th scope="col">Sumber spesifikasi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {roomTypes.map((rt, idx) => {
              const tvKnown = rt.smartTv === true || rt.smartTv === false;
              const tvText = rt.smartTv === true ? "Smart TV" : rt.smartTv === false ? "TV biasa" : rt.smartTvLabel || "Belum ada data";
              const tvActive = rt.smartTv === true || (!tvKnown && /smart\s*tv/i.test(tvText));

              const bathKnown = rt.bathtub === true || rt.bathtub === false;
              const bathText = rt.bathtub === true ? "Ada" : rt.bathtub === false ? "Tidak" : rt.bathtubLabel || "Belum ada data";
              const bathActive = rt.bathtub === true || (!bathKnown && /^ada\b|^sebagian\b/i.test(bathText));

              const isOfficialSpec = rt.sourcePriority === "official";

              return (
                <tr key={`${rt.name}-${idx}`} className="hover:bg-cream-50/70">
                  <th scope="row" className="!align-top max-w-[220px] border-b border-cream-200 px-2 py-2 text-left font-normal break-words">
                    <span className="block font-bold text-navy-900">{rt.name}</span>
                    {rt.highlights && rt.highlights.length > 0 && (
                      <span className="mt-0.5 block text-[10px] leading-snug text-navy-600">
                        {rt.highlights.slice(0, 3).map(sanitizePublicText).join(" · ")}
                      </span>
                    )}
                    {rt.conflictNote && (
                      <span className="mt-1.5 block rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-950">
                        {sanitizePublicText(rt.conflictNote)}
                      </span>
                    )}
                  </th>
                  <td className="!align-top whitespace-nowrap text-navy-600">
                    <span className="block font-semibold text-navy-900">{CATEGORY_LABEL[rt.category] ?? rt.category}</span>
                    <span className="block text-[10px]">
                      {rt.bedrooms !== null && rt.bedrooms !== undefined ? `${rt.bedrooms} kamar tidur` : "Belum tercatat"}
                    </span>
                  </td>
                  <td className="!align-top whitespace-nowrap font-semibold text-navy-900">
                    <span className="tabular-nums">{rt.areaLabel}</span>
                  </td>
                  <td className="!align-top text-[11px]">
                    <SnOfficialPrice rt={rt} />
                    {rt.officialRate?.sourceUrl && (
                      <span className="mt-1 block text-[10px] text-navy-600">
                        <SnExtLink href={rt.officialRate.sourceUrl}>
                          {sanitizePublicText(rt.officialRate.sourceLabel)}
                        </SnExtLink>
                      </span>
                    )}
                  </td>
                  <td className="!align-top text-[11px]">
                    <SnOtaSides ota={rt.otaLowest} />
                  </td>
                  <td className="!align-top whitespace-nowrap">
                    <SnBreakfastBadge status={rt.breakfastLabel} />
                  </td>
                  <td className="!align-top whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-navy-800">
                      <Tv className={cn("h-3.5 w-3.5 shrink-0", tvActive ? "text-navy-900" : "text-navy-400")} aria-hidden />
                      {tvText}
                    </span>
                  </td>
                  <td className="!align-top whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-navy-800">
                      <Bath className={cn("h-3.5 w-3.5 shrink-0", bathActive ? "text-navy-900" : "text-navy-400")} aria-hidden />
                      {bathText}
                    </span>
                  </td>
                  <td className="!align-top max-w-[135px] space-y-1 text-[10px] text-navy-600 break-words">
                    <span
                      className={cn(
                        "inline-block rounded-md px-1.5 py-0.5 font-semibold",
                        isOfficialSpec ? "bg-emerald-100 text-emerald-800" : "bg-cream-200 text-navy-700",
                      )}
                    >
                      {isOfficialSpec ? "Situs resmi" : "OTA"}
                    </span>
                    {rt.sourceUrl ? (
                      <span className="block break-words">
                        <a
                          href={rt.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-navy-800 underline hover:text-navy-950"
                        >
                          {sanitizePublicText(rt.sourceLabel || (isOfficialSpec ? "Situs resmi" : "Sumber OTA"))}
                          <ExternalLink className="ml-0.5 inline h-2.5 w-2.5 align-text-top" aria-hidden />
                        </a>
                      </span>
                    ) : (
                      <span className="block">{sanitizePublicText(rt.sourceLabel || "—")}</span>
                    )}
                    {rt.observedAt && <span className="block text-navy-500">diperiksa {rt.observedAt.slice(0, 10)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Modal rincian lengkap satu hotel/resort pada matriks Kamar & Resort. */
export function SnHotelDetailModal({ hotel, onClose }: { hotel: SnHotelMatrixEntry; onClose: () => void }) {
  const titleId = useId();
  const specs = hotel.specs;
  const fac = specs?.facilities;
  const facSrc = specs?.facilitySources ?? {};
  const isOwn = hotel.role === "sanghyang";
  const isBenchmark = hotel.role === "acuan";
  const photos = specs?.visual?.photoUrls ?? [];
  const roomTypes = hotel.roomTypes ?? [];
  const reviewHighlights = specs?.reviewHighlights;
  const reviewTopics = readReviewTopics(reviewHighlights?.topics);
  const reviewThemes = reviewHighlights?.topThemes ?? [];
  const groupBadge = `${GROUP_LABEL[specs?.category ?? ""] ?? "Penginapan"} · ${hotel.starLabel}`;

  const groundingLinks = new Map<string, { label: string; url: string; date?: string }>();
  if (hotel.websiteUrl) groundingLinks.set(hotel.websiteUrl, { label: "Situs resmi", url: hotel.websiteUrl });
  if (hotel.mapsUrl) groundingLinks.set(hotel.mapsUrl, { label: "Profil Google Maps", url: hotel.mapsUrl });
  for (const s of specs?.sources ?? []) {
    if (s.url) {
      groundingLinks.set(s.url, {
        label: sanitizePublicText(s.label),
        url: s.url,
        date: s.observedAt ? s.observedAt.slice(0, 10) : undefined,
      });
    }
  }
  for (const rt of roomTypes) {
    if (rt.sourceUrl && !groundingLinks.has(rt.sourceUrl)) {
      groundingLinks.set(rt.sourceUrl, {
        label: sanitizePublicText(rt.sourceLabel || (rt.sourcePriority === "official" ? "Situs resmi" : "Listing OTA")),
        url: rt.sourceUrl,
        date: rt.observedAt ? rt.observedAt.slice(0, 10) : undefined,
      });
    }
    if (rt.officialRate?.sourceUrl && !groundingLinks.has(rt.officialRate.sourceUrl)) {
      groundingLinks.set(rt.officialRate.sourceUrl, {
        label: sanitizePublicText(rt.officialRate.sourceLabel || "Tarif situs resmi"),
        url: rt.officialRate.sourceUrl,
      });
    }
    if (rt.otaLowest?.otaUrl && !groundingLinks.has(rt.otaLowest.otaUrl)) {
      groundingLinks.set(rt.otaLowest.otaUrl, {
        label: `Tarif OTA (${rt.otaLowest.otaName})`,
        url: rt.otaLowest.otaUrl,
      });
    }
  }

  return (
    <ModalShell
      titleId={titleId}
      maxWidthClass="max-w-6xl"
      onClose={onClose}
      header={
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[10px] font-bold text-navy-800">
                {groupBadge}
              </span>
              {isOwn && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  Properti Sanghyang
                </span>
              )}
              {isBenchmark && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
                  Acuan
                </span>
              )}
            </div>
            <h3 id={titleId} className="mt-1 text-lg font-bold text-navy-900">
              {hotel.name}
            </h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
              <span>{isOwn ? "Titik acuan" : `${hotel.distanceLabel} dari Sanghyang`}</span>
              {hotel.ratingLabel && (
                <>
                  <span aria-hidden>·</span>
                  <span>Rating: {hotel.ratingLabel}</span>
                </>
              )}
              {hotel.mapsUrl && (
                <>
                  <span aria-hidden>·</span>
                  <SnExtLink href={hotel.mapsUrl} className="font-semibold">
                    Google Maps
                  </SnExtLink>
                </>
              )}
              {hotel.websiteUrl && (
                <>
                  <span aria-hidden>·</span>
                  <SnExtLink href={hotel.websiteUrl} className="font-semibold">
                    Situs resmi
                  </SnExtLink>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="skeuo-pill-light shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-navy-900 hover:brightness-[0.98]"
          >
            Tutup
          </button>
        </div>
      }
    >
      {/* 1. Audit pembanding */}
      <div className="rounded-2xl border border-navy-200 bg-cream-50 p-4 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-navy-800">
          <Scale className="h-3.5 w-3.5" aria-hidden />
          Audit pembanding
        </div>
        <p className="text-xs leading-relaxed text-navy-800">{sanitizePublicText(hotel.auditRationale)}</p>
      </div>

      {/* 2. Ringkasan fasilitas lengkap beserta tautan sumber dan tanggal pemeriksaan */}
      {hotel.facilityNarrative && hotel.facilityNarrative.length > 0 && (
        <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-2.5">
          <h4 className="text-sm font-bold text-navy-900">Ringkasan fasilitas</h4>
          <ul className="space-y-2 text-navy-800">
            {hotel.facilityNarrative.map((st, idx) => (
              <li key={idx} className="border-l-2 border-navy-300 pl-2.5 leading-relaxed">
                <span>{sanitizePublicText(st.text)}</span>
                <SnSourceList sources={st.sources} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Tabel 9 kolom Rincian Semua Tipe Kamar & Luas */}
      <SnHotelRoomTypesTable roomTypes={roomTypes} />

      {/* 4. Kartu Fasilitas kamar & resor beserta sumber tiap poin */}
      <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-cream-200 pb-2">
          <Hotel className="h-4 w-4 text-navy-800" aria-hidden />
          <h4 className="text-sm font-bold text-navy-900">Fasilitas kamar &amp; resor</h4>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <FacilityCard
            title="Jumlah kamar"
            value={hotel.roomCount != null ? `${hotel.roomCount} kamar` : hotel.roomCountLabel || "Belum tercatat"}
            source={facSrc.roomCount}
          />
          <FacilityCard
            title="Rentang luas"
            value={hotel.areaSummaryLabel}
            note={fac?.roomSizesM2?.length ? `Tercatat: ${fac.roomSizesM2.join(", ")} m²` : null}
            source={facSrc.roomSize}
          />
          <FacilityCard
            icon={<Tv className="h-3.5 w-3.5 text-navy-700" aria-hidden />}
            title="Smart TV"
            value={hotel.smartTvLabel}
            note={fac?.smartTvNote ? sanitizePublicText(fac.smartTvNote) : null}
            source={facSrc.smartTv}
          />
          <FacilityCard
            icon={<Bath className="h-3.5 w-3.5 text-navy-700" aria-hidden />}
            title="Bathtub"
            value={hotel.bathtubLabel}
            note={fac?.bathtubNote ? sanitizePublicText(fac.bathtubNote) : null}
            source={facSrc.bathtub}
          />
          <FacilityCard
            icon={<Waves className="h-3.5 w-3.5 text-navy-700" aria-hidden />}
            title="Kolam renang"
            value={hotel.poolLabel}
            note={fac?.poolType && fac.poolType !== hotel.poolLabel ? sanitizePublicText(fac.poolType) : null}
            source={facSrc.pool}
          />
          <FacilityCard
            icon={<Sparkles className="h-3.5 w-3.5 text-navy-700" aria-hidden />}
            title="Air panas alami"
            value={fac?.hotSpring === true ? "Ada" : fac?.hotSpring === false ? "Tidak ada" : "Belum tercatat"}
            note={fac?.hotSpringNote ? sanitizePublicText(fac.hotSpringNote) : null}
            source={facSrc.hotSpring}
          />
        </div>
        {fac?.keyAmenities && fac.keyAmenities.length > 0 && (
          <div className="pt-1">
            <span className="font-semibold text-navy-900">Fasilitas unggulan: </span>
            <span className="text-navy-700">{fac.keyAmenities.map(sanitizePublicText).join(", ")}</span>
            <SnSourceList sources={facSrc.amenities ? [facSrc.amenities] : []} />
          </div>
        )}
      </div>

      {/* 5. Gaya desain & karakter visual */}
      {(specs?.visual || fac?.designStyle || fac?.usp) && (
        <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-2.5">
          <h4 className="text-sm font-bold text-navy-900">Gaya desain &amp; karakter visual</h4>
          {(specs?.visual?.designStyle || fac?.designStyle) && (
            <div>
              <span className="font-semibold text-navy-900">Konsep desain: </span>
              <span className="text-navy-700">{sanitizePublicText(specs?.visual?.designStyle ?? fac?.designStyle ?? "")}</span>
              <SnSourceList sources={facSrc.design ? [facSrc.design] : []} />
            </div>
          )}
          {specs?.visual?.ambience && (
            <div>
              <span className="font-semibold text-navy-900">Suasana: </span>
              <span className="text-navy-700">{sanitizePublicText(specs.visual.ambience)}</span>
            </div>
          )}
          {fac?.usp && (
            <div>
              <span className="font-semibold text-navy-900">Pembeda utama: </span>
              <span className="text-navy-700">{sanitizePublicText(fac.usp)}</span>
            </div>
          )}
          {specs?.visual?.keyElements && specs.visual.keyElements.length > 0 && (
            <div>
              <span className="font-semibold text-navy-900">Elemen kunci:</span>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-navy-700">
                {specs.visual.keyElements.map((el, i) => (
                  <li key={i}>{sanitizePublicText(el)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 6. Ringkasan topik ulasan tamu bila tersedia */}
      {(reviewThemes.length > 0 || reviewTopics.length > 0) && (
        <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-2">
          <div className="flex items-center gap-2 border-b border-cream-200 pb-2">
            <MessageSquare className="h-4 w-4 text-navy-800" aria-hidden />
            <h4 className="text-sm font-bold text-navy-900">Topik Ulasan Tamu</h4>
          </div>
          {reviewThemes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reviewThemes.map((t, idx) => (
                <span
                  key={idx}
                  className="rounded-full border border-cream-300 bg-cream-50 px-2.5 py-0.5 text-[11px] font-medium text-navy-800"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {reviewTopics.length > 0 && (
            <p className="text-navy-600">
              {reviewTopics.map((t) => (t.count !== null ? `${t.label} (${t.count})` : t.label)).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* 7. Foto galeri terverifikasi */}
      {photos.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-navy-900">Foto galeri ({photos.length})</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((url, idx) => (
              <PhotoTile key={`${url}-${idx}`} url={url} alt={`${hotel.name} foto ${idx + 1}`} />
            ))}
          </div>
        </div>
      )}

      {/* 8. Sumber grounding lengkap */}
      <div className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5 text-[11px] text-navy-600 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-navy-900">
          <ShieldCheck className="h-3.5 w-3.5 text-navy-800" aria-hidden />
          Sumber grounding (situs resmi, Google Maps, OTA)
        </div>
        <p>
          Spesifikasi kamar dan fasilitas menggabungkan situs resmi, profil Google Maps, dan listing OTA. Bila angkanya
          berbeda, data situs resmi diutamakan.
        </p>
        {groundingLinks.size > 0 && (
          <ul className="list-disc space-y-0.5 pl-5">
            {[...groundingLinks.values()].map((src) => (
              <li key={src.url}>
                <a href={src.url} target="_blank" rel="noreferrer" className="text-navy-800 underline hover:text-navy-950">
                  {src.label}
                </a>
                {src.date ? ` (${src.date})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

/** Modal rincian lengkap satu tempat F&B, bar, atau spa pada matriks harga. */
export function SnFnbDetailModal({ entry, onClose }: { entry: SnFnbMatrixEntry; onClose: () => void }) {
  const titleId = useId();
  const specs = entry.specs;
  const fac = specs?.facilities;
  const reviewHighlights = specs?.reviewHighlights;
  const reviewTopics = readReviewTopics(reviewHighlights?.topics);
  const reviewThemes = reviewHighlights?.topThemes ?? [];
  const isOwn = entry.role === "sanghyang";
  const websiteUrl = entry.websiteUrl ?? specs?.websiteUrl ?? null;
  const photos = specs?.visual?.photoUrls ?? [];
  const countedItems = entry.countedItems ?? [];
  const excludedItems = entry.excludedItems ?? [];
  const menuSources = entry.menuSources ?? [];
  const menuChecked = entry.menuChecked ?? [];

  const isRangeEnd = (item: SnFnbMenuItem) =>
    [entry.rangeCheapest ?? null, entry.rangePriciest ?? null].some(
      (end) =>
        end !== null &&
        end.name === item.name &&
        end.price === item.price &&
        (end.priceMax ?? null) === (item.priceMax ?? null),
    );

  return (
    <ModalShell
      titleId={titleId}
      maxWidthClass="max-w-4xl"
      onClose={onClose}
      header={
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[10px] font-bold text-navy-800">
                {entry.parentName ? `Di dalam ${entry.parentName}` : isOwn ? "Outlet Sanghyang" : "Tempat mandiri"}
              </span>
              {isOwn && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  Titik Acuan (Sanghyang)
                </span>
              )}
              {entry.role === "acuan" && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
                  Acuan
                </span>
              )}
            </div>
            <h3 id={titleId} className="mt-1 text-lg font-bold text-navy-900">
              {entry.name}
            </h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
              <span>{entry.distanceLabel}</span>
              <span aria-hidden>·</span>
              <span>Rating: {entry.ratingLabel}</span>
              {entry.mapsUrl && (
                <>
                  <span aria-hidden>·</span>
                  <SnExtLink href={entry.mapsUrl} className="font-semibold">
                    Google Maps
                  </SnExtLink>
                </>
              )}
              {websiteUrl && (
                <>
                  <span aria-hidden>·</span>
                  <SnExtLink href={websiteUrl} className="font-semibold">
                    Situs Resmi
                  </SnExtLink>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="skeuo-pill-light shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-navy-900 hover:brightness-[0.98]"
          >
            Tutup
          </button>
        </div>
      }
    >
      {/* 1. Audit Pembanding */}
      <div className="rounded-2xl border border-navy-200 bg-cream-50 p-4 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-navy-800">
          <Scale className="h-3.5 w-3.5" aria-hidden />
          Audit Pembanding (Perbandingan Harga, Menu &amp; Fasilitas vs Sanghyang)
        </div>
        <p className="text-xs leading-relaxed text-navy-800">{sanitizePublicText(entry.auditRationale)}</p>
      </div>

      {/* 2. Rincian Menu & Harga */}
      <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 pb-2">
          <div className="flex items-center gap-2">
            <Utensils className="h-4 w-4 text-navy-800" aria-hidden />
            <h4 className="text-sm font-bold text-navy-900">
              Rincian Menu &amp; Harga ({entry.menuItemCount} Item Terdata)
            </h4>
          </div>
          <span className="font-bold text-navy-900">{entry.menuRangeLabel}</span>
        </div>

        {entry.perPersonRange && (
          <p className="text-navy-600">
            Kisaran belanja per orang (Google Maps):{" "}
            <strong className="text-navy-900">{formatPerPersonRange(entry.perPersonRange)}</strong>
          </p>
        )}

        {countedItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-navy-600">
              Dihitung dalam kisaran: {countedItems.length} item per porsi, urut dari termurah. Item pertama dan
              terakhir adalah batas kisaran di tabel.
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {countedItems.map((item, idx) => (
                <li
                  key={`${item.name}-${idx}`}
                  className={cn(
                    "flex items-baseline justify-between gap-2 rounded-xl border px-3 py-2",
                    isRangeEnd(item)
                      ? "border-navy-400 bg-cream-100"
                      : "border-cream-200 bg-cream-50",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900">{item.name}</span>
                    {item.category && <span className="block text-[10px] text-navy-500">{item.category}</span>}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-navy-900">{formatMenuItemPrice(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-navy-600">{entry.menuDetailLabel}</p>
        )}

        {excludedItems.length > 0 && (
          <div className="space-y-1.5 border-t border-cream-200 pt-2.5">
            <p className="text-navy-600">
              Tidak dihitung dalam kisaran (tambahan, paket promo, paket beberapa orang, sewa ruang, atau harga per
              ons/kg/jam/orang):
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {excludedItems.map((item, idx) => (
                <li
                  key={`x-${item.name}-${idx}`}
                  className="rounded-full border border-cream-300 bg-cream-50 px-2.5 py-0.5 text-[11px] text-navy-700"
                >
                  {item.name} · <span className="tabular-nums">{formatMenuItemPrice(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 3. Fasilitas Venue, Konsep & Suasana */}
      <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-2">
        <h4 className="text-sm font-bold text-navy-900">Fasilitas Venue, Konsep &amp; Suasana</h4>
        <p className="leading-relaxed text-navy-700">{sanitizePublicText(entry.facilitiesLabel)}</p>
        {fac?.usp && (
          <div>
            <span className="font-semibold text-navy-900">Pembeda Utama (USP): </span>
            <span className="text-navy-700">{sanitizePublicText(fac.usp)}</span>
          </div>
        )}
        {specs?.visual?.ambience && (
          <div>
            <span className="font-semibold text-navy-900">Suasana Tempat: </span>
            <span className="text-navy-700">{sanitizePublicText(specs.visual.ambience)}</span>
          </div>
        )}
        {specs?.visual?.materialsAndLighting && (
          <div>
            <span className="font-semibold text-navy-900">Material &amp; Pencahayaan: </span>
            <span className="text-navy-700">{sanitizePublicText(specs.visual.materialsAndLighting)}</span>
          </div>
        )}
        {specs?.visual?.keyElements && specs.visual.keyElements.length > 0 && (
          <div>
            <span className="font-semibold text-navy-900">Elemen Kunci:</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-navy-700">
              {specs.visual.keyElements.map((el, idx) => (
                <li key={idx}>{sanitizePublicText(el)}</li>
              ))}
            </ul>
          </div>
        )}
        {fac?.hotSpring === true && (
          <div className="flex items-center gap-1.5 pt-1 font-semibold text-emerald-800">
            <Sparkles className="h-4 w-4" aria-hidden />
            {fac.hotSpringNote ? sanitizePublicText(fac.hotSpringNote) : "Tersedia fasilitas terapi air panas alami"}
          </div>
        )}
      </div>

      {/* 4. Topik Ulasan Pengunjung */}
      {(reviewThemes.length > 0 || reviewTopics.length > 0) && (
        <div className="rounded-2xl border border-cream-300 bg-white p-4 space-y-2">
          <div className="flex items-center gap-2 border-b border-cream-200 pb-2">
            <MessageSquare className="h-4 w-4 text-navy-800" aria-hidden />
            <h4 className="text-sm font-bold text-navy-900">Topik Ulasan Pengunjung</h4>
          </div>
          {reviewThemes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reviewThemes.map((t, idx) => (
                <span
                  key={idx}
                  className="rounded-full border border-cream-300 bg-cream-50 px-2.5 py-0.5 text-[11px] font-medium text-navy-800"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {reviewTopics.length > 0 && (
            <p className="text-navy-600">
              {reviewTopics.map((t) => (t.count !== null ? `${t.label} (${t.count})` : t.label)).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* 5. Foto terverifikasi */}
      {photos.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-navy-900">Foto terverifikasi ({photos.length})</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((url, idx) => (
              <PhotoTile key={`${url}-${idx}`} url={url} alt={`${entry.name} foto ${idx + 1}`} />
            ))}
          </div>
        </div>
      )}

      {/* 6. Sumber grounding */}
      <div className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5 text-[11px] text-navy-600 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-navy-900">
          <ShieldCheck className="h-3.5 w-3.5 text-navy-800" aria-hidden />
          Sumber grounding (situs resmi, buku menu, Google Maps)
        </div>
        {(menuSources.length > 0 || (specs?.sources?.length ?? 0) > 0) && (
          <ul className="list-disc space-y-0.5 pl-5">
            {menuSources.map((s, idx) => (
              <li key={`m-${idx}`}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-navy-800 underline hover:text-navy-950">
                  {sanitizePublicText(s.label)}
                </a>
              </li>
            ))}
            {specs?.sources?.map((s, idx) => (
              <li key={`s-${idx}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-navy-800 underline hover:text-navy-950">
                    {sanitizePublicText(s.label)}
                    {s.observedAt ? ` (${s.observedAt.slice(0, 10)})` : ""}
                  </a>
                ) : (
                  <span>
                    {sanitizePublicText(s.label)}
                    {s.observedAt ? ` (${s.observedAt.slice(0, 10)})` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {menuChecked.length > 0 && menuSources.length === 0 && (
          <p>Sumber sudah diperiksa: {menuChecked.map(sanitizePublicText).join("; ")}.</p>
        )}
      </div>
    </ModalShell>
  );
}

/** Modal galeri foto satu tempat dari tabel matriks (Hotel/Resort maupun F&B). */
export function SnPhotoGalleryModal({
  name,
  detail,
  mapsUrl,
  photos,
  onClose,
}: {
  name: string;
  detail: string;
  mapsUrl: string | null;
  photos: string[];
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell
      titleId={titleId}
      maxWidthClass="max-w-4xl"
      onClose={onClose}
      header={
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold text-navy-900">
              {name}
            </h3>
            <p className="mt-0.5 text-xs text-navy-600">
              {detail}
              {mapsUrl && (
                <>
                  {" · "}
                  <SnExtLink href={mapsUrl} className="font-semibold">
                    Google Maps
                  </SnExtLink>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="skeuo-pill-light shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-navy-900"
          >
            Tutup
          </button>
        </div>
      }
    >
      {photos.length === 0 ? (
        <p className="text-sm text-navy-600">Belum ada foto terverifikasi untuk tempat ini.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((url, idx) => (
            <PhotoTile key={`${url}-${idx}`} url={url} alt={`${name} foto ${idx + 1}`} />
          ))}
        </div>
      )}
    </ModalShell>
  );
}
