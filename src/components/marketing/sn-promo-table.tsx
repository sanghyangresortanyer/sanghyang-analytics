"use client";

import { ExternalLink } from "lucide-react";
import {
  PROMOTION_TYPES,
  PROMOTION_TYPE_INFO,
  isPromotionType,
  ownPromoSourceSummary,
  promoPeriodText,
  promoPriceDiscountText,
  promotionTypeLabel,
  type SnRadarPromo,
} from "@/lib/marketing/market-intelligence-types";
import { sanitizePublicText } from "./sn-competitor-detail-modal";

export { ownPromoSourceSummary };
export { SnFnbDetailModal, SnHotelDetailModal, SnPhotoGalleryModal } from "./sn-competitor-detail-modal";

const SOURCE_LABEL: Record<string, string> = {
  website: "Situs resmi",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  upcoming: "Segera datang",
  expired: "Berakhir",
};

const RAW_POST_TITLE_PREFIX = /^\[(REELS|FEED|CAROUSEL|TIKTOK_VIDEO|STORY)\]\s*/i;
const OUR_VERSION_SPLIT = "\nVersi kita: ";

/** Mengurai teks bersih judul dan isi promo (membuka JSON takarir sosmed & membuang usulan "Versi kita"). */
export function extractPromoPlainText(item: Pick<SnRadarPromo, "title" | "description">): { title: string; body: string } {
  const title = sanitizePublicText((item.title ?? "").replace(RAW_POST_TITLE_PREFIX, "").trim());
  let body = (item.description ?? "").trim();
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { caption?: unknown };
      if (typeof parsed.caption === "string") body = parsed.caption.trim();
    } catch {
      // Biarkan isi mentah bila bukan JSON takarir valid.
    }
  }
  body = sanitizePublicText((body.split(OUR_VERSION_SPLIT)[0] ?? "").trim());
  return { title, body };
}

/**
 * Tabel promo/event dengan kolom selaras laporan PDF:
 * Tempat | Judul Promo/Event | Kategori Promosi (untuk promo) | Periode | Harga / Diskon | Sumber.
 */
export function SnPromoTable({
  items,
  kind,
  caption,
  showDescription = false,
}: {
  items: SnRadarPromo[];
  kind: "promo" | "event";
  caption: string;
  showDescription?: boolean;
}) {
  const shownTypes =
    kind === "promo" ? PROMOTION_TYPES.filter((t) => items.some((p) => p.promotionType === t)) : [];

  return (
    <div>
      <div className="relative overflow-x-auto">
        <table className="table-compact w-full min-w-[42rem] text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Tempat</th>
              <th scope="col">{kind === "promo" ? "Judul Promo" : "Judul Event"}</th>
              {kind === "promo" && <th scope="col">Kategori Promosi</th>}
              <th scope="col">Periode</th>
              <th scope="col">Harga / Diskon</th>
              <th scope="col">Sumber</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {items.map((p) => {
              const { title, body } = extractPromoPlainText(p);
              const sources = p.sources?.length
                ? p.sources
                : p.sourceUrl
                  ? [{ platform: p.platform, url: p.sourceUrl, label: p.source }]
                  : [];
              const views = p.metrics?.views ?? 0;
              const likes = p.metrics?.likes ?? 0;
              return (
                <tr key={p.id}>
                  <td className="!align-top font-semibold text-navy-900">{p.competitorName}</td>
                  <td className="!align-top">
                    <span className="font-medium text-navy-900">{title}</span>
                    {showDescription && body && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-navy-600">{body}</p>
                    )}
                  </td>
                  {kind === "promo" && (
                    <td className="!align-top text-navy-800">
                      <span title={isPromotionType(p.promotionType) ? PROMOTION_TYPE_INFO[p.promotionType].definition : undefined}>
                        {promotionTypeLabel(p.promotionType)}
                      </span>
                    </td>
                  )}
                  <td className="!align-top text-navy-600">
                    {STATUS_LABEL[p.status] ?? p.status} · {promoPeriodText(p)}
                  </td>
                  <td className="!align-top whitespace-nowrap font-semibold text-navy-900">
                    <span className="tabular-nums">{promoPriceDiscountText(p)}</span>
                  </td>
                  <td className="!align-top">
                    {sources.length > 0 ? (
                      <span className="flex flex-col gap-0.5">
                        {sources.map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 font-semibold text-navy-800 underline hover:text-navy-950"
                          >
                            {SOURCE_LABEL[s.platform] ?? s.label ?? s.platform}
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="sr-only">(membuka tab baru)</span>
                          </a>
                        ))}
                      </span>
                    ) : (
                      <span className="text-navy-500">{p.source || "Tanpa tautan sumber"}</span>
                    )}
                    {(views > 0 || likes > 0) && (
                      <span className="mt-0.5 block text-[11px] text-navy-500">
                        {[
                          views > 0 ? `${views.toLocaleString("id-ID")} tayangan` : null,
                          likes > 0 ? `${likes.toLocaleString("id-ID")} suka` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shownTypes.length > 0 && (
        <dl className="mt-2.5 space-y-0.5 border-t border-cream-200 pt-2 text-[11px] text-navy-600">
          {shownTypes.map((t) => (
            <div key={t}>
              <dt className="inline font-semibold text-navy-900">{PROMOTION_TYPE_INFO[t].label}:</dt>{" "}
              <dd className="inline">{PROMOTION_TYPE_INFO[t].definition}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
