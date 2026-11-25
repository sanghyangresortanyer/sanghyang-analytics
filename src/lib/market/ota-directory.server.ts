/**
 * Penggabung direktori OTA sisi server: membaca hasil crawl Google Travel (`resort-room-rates.data.json`)
 * dan melengkapinya secara langsung dari tabel basis data (`CompetitorPriceSnapshot`, ulasan Google Travel,
 * serta `Competitor.websiteUrl` / `bookingUrl` untuk mengecualikan situs resmi hotel beserta subdomainnya).
 */
import { cache } from "react";
import { withCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { db } from "@/lib/db";
import {
  buildDynamicOtaDirectory,
  extractHostnameFromUrl,
  normalizeHost,
  type DynamicOtaDirectory,
} from "./ota-providers";

const EXCLUDED_GOOGLE_SUFFIXES = ["google.com", "google.co.id", "goo.gl"];
const EXCLUDED_SOCIAL_SUFFIXES = ["instagram.com", "tiktok.com", "facebook.com", "fb.com", "youtube.com", "youtu.be", "linktr.ee"];

function isInfrastructureOrSocialHost(host: string): boolean {
  const h = normalizeHost(host);
  return [...EXCLUDED_GOOGLE_SUFFIXES, ...EXCLUDED_SOCIAL_SUFFIXES].some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

export const loadDynamicOtaDirectory = cache(async (): Promise<DynamicOtaDirectory> =>
  withCache(
    async () => {
      const [competitors, priceSources, reviewSources] = await Promise.all([
        db.competitor.findMany({
          select: { websiteUrl: true, bookingUrl: true },
        }),
        db.competitorPriceSnapshot.findMany({
          select: { source: true, sourceUrl: true },
          distinct: ["source", "sourceUrl"],
        }),
        db.competitorReview.findMany({
          where: {
            archivedAt: null,
            OR: [
              { sourceUrl: { contains: "/travel/hotels/entity/" } },
              { sourceUrl: { contains: "/travel/lodging/clk" } },
            ],
          },
          select: { source: true, sourceUrl: true },
          distinct: ["source", "sourceUrl"],
        }),
      ]);

      const excludeHosts = new Set<string>();
      for (const c of competitors) {
        for (const raw of [c.websiteUrl, c.bookingUrl]) {
          const h = extractHostnameFromUrl(raw);
          if (h && !isInfrastructureOrSocialHost(h)) {
            excludeHosts.add(normalizeHost(h));
          }
        }
      }

      const runtimeProviders = new Set<string>();
      const runtimeReviewProviders = new Set<string>();
      const runtimeHosts = new Set<string>();
      const runtimeReviewHosts = new Set<string>();

      for (const p of priceSources) {
        if (p.source) runtimeProviders.add(p.source);
        const h = extractHostnameFromUrl(p.sourceUrl);
        if (h && !isInfrastructureOrSocialHost(h)) runtimeHosts.add(h);
      }

      for (const r of reviewSources) {
        if (r.source) runtimeReviewProviders.add(r.source);
        // Hanya catat host luar dari tautan klik Google Travel (bukan sembarang URL lama di DB).
        if (r.sourceUrl?.includes("/travel/lodging/clk")) {
          const h = extractHostnameFromUrl(r.sourceUrl);
          if (h && !isInfrastructureOrSocialHost(h)) runtimeReviewHosts.add(h);
        }
      }

      return buildDynamicOtaDirectory({
        providers: runtimeProviders,
        reviewProviders: runtimeReviewProviders,
        hosts: runtimeHosts,
        reviewHosts: runtimeReviewHosts,
        excludeHosts,
      });
    },
    ["mi-ota-directory"],
    { tags: [CACHE_TAGS.marketOtaDirectory, CACHE_TAGS.marketCompetitors], revalidate: CACHE_TTL.marketIntelligence },
  ),
);
