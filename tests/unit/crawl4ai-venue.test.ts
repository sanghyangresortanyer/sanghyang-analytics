import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRenderedListing } from "../../src/lib/market/crawl4ai-venue";

// Markdown asli hasil render Crawl4AI (Chrome terpasang, identitas SanghyangNewsCrawler/1.0) dari listing Google Maps
// 17 Nov 2026. Baris nama, foto, dan tautan profil pengulas dibuang; sisanya apa adanya.
const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");

test("listing Crawl4AI: rating, jumlah ulasan, dan topik ulasan terbaca dari tampilan terbatas", () => {
  const listing = parseRenderedListing(fixture("crawl4ai-maps-andalan-2026-11-17.md"));
  assert.ok(listing, "listing Andalan punya panel tempat");
  assert.equal(listing.rating, 4.5);
  assert.equal(listing.reviewCount, 100);
  assert.deepEqual(listing.topics.slice(0, 2), [
    { label: "foto", count: 6 },
    { label: "estetik", count: 5 },
  ]);
  assert.ok(listing.topics.every((t) => t.label !== "Semua" && t.count > 0), "tombol Semua bukan topik");
});

test("listing Crawl4AI: panel tempat yang tidak tersedia menghasilkan null, bukan angka karangan", () => {
  assert.equal(parseRenderedListing(fixture("crawl4ai-maps-serai-kosong-2026-11-17.md")), null);
});
