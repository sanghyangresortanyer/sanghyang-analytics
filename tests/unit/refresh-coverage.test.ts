import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { getHotelRateTargets, getReviewTargets } from "../../src/lib/market/competitor-repository";
import { loadVenueReviewTargets } from "../../src/lib/market/scrape-new-reviews";
import { getActiveCompetitorWebsites, isOfficialSite } from "../../src/lib/market/website-promos";
import { mapsPlaceIds } from "../../src/lib/market/google-travel-entity";

after(() => db.$disconnect());

/**
 * "Perbarui Semua Data" mengambil sasarannya dari registri DB, bukan dari daftar nama di kode. Tes ini memeriksa registri
 * yang sekarang: setiap pembanding aktif ikut di setiap langkah yang sumbernya ada, termasuk pesaing yang baru ditambah.
 */
const LODGING = new Set(["hotel", "resort"]);
const mapsOf = (row: { mapsUrl: string | null; googleMapsUrl: string | null } | null) => (row ? row.mapsUrl ?? row.googleMapsUrl : null);
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

async function registry() {
  return db.competitor.findMany({
    where: { active: true, compsetRole: { in: ["inti", "benchmark"] } },
    select: {
      id: true,
      name: true,
      category: true,
      mapsUrl: true,
      googleMapsUrl: true,
      ratesUrl: true,
      websiteUrl: true,
      parent: { select: { mapsUrl: true, googleMapsUrl: true } },
    },
  });
}

test("langkah tarif dan ulasan hotel: setiap penginapan pembanding aktif dengan ID tempat Google Maps menjadi sasaran", async () => {
  const [rows, rateTargets, reviewTargets] = await Promise.all([registry(), getHotelRateTargets(), getReviewTargets()]);
  const lodging = rows.filter((r) => LODGING.has(r.category ?? ""));
  assert.ok(lodging.length > 0);
  for (const r of lodging) {
    const hasEntity = Boolean(r.ratesUrl) || mapsPlaceIds(mapsOf(r)) !== null;
    assert.ok(hasEntity, `${r.name}: registri tanpa ratesUrl dan tanpa ID tempat Google Maps, tarif tidak bisa dibaca`);
    assert.ok(rateTargets.some((t) => t.competitorId === r.id && t.url.startsWith("https://www.google.com/travel/hotels/entity/")), `${r.name}: bukan sasaran tarif Google Hotels`);
    assert.ok(reviewTargets.some((t) => t.competitorId === r.id), `${r.name}: bukan sasaran ulasan Google Travel`);
  }
});

test("langkah ulasan venue: setiap resto, bar, dan spa pembanding yang punya listing Google Maps sendiri menjadi sasaran", async () => {
  const [rows, targets] = await Promise.all([registry(), loadVenueReviewTargets()]);
  const venues = rows.filter((r) => !LODGING.has(r.category ?? ""));
  assert.ok(venues.length > 0);
  for (const r of venues) {
    const listing = mapsOf(r);
    const ownListing = listing && /\/maps\/place\//.test(listing) && listing !== mapsOf(r.parent);
    // Outlet yang tautannya sama dengan hotel induk hanya dibaca bila data menu mencatat listingnya sendiri.
    if (ownListing) assert.ok(targets.some((t) => t.competitorId === r.id), `${r.name}: listing sendiri tetapi bukan sasaran ulasan`);
    for (const t of targets.filter((x) => x.competitorId === r.id)) assert.notEqual(t.mapsUrl, mapsOf(r.parent), `${r.name}: membaca listing hotel induk`);
  }
});

test("langkah situs resmi: setiap situs resmi pembanding aktif dibaca, satu kali per domain", async () => {
  const [rows, targets] = await Promise.all([registry(), getActiveCompetitorWebsites()]);
  const hosts = new Set(targets.map((t) => host(t.websiteUrl!)));
  assert.equal(hosts.size, targets.length, "satu domain dibaca sekali");
  for (const r of rows.filter((x) => isOfficialSite(x.websiteUrl))) {
    assert.ok(hosts.has(host(r.websiteUrl!)), `${r.name}: situs ${r.websiteUrl} tidak dibaca`);
  }
});
