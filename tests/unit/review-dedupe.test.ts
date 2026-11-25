import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { ingestScrapedReviews, isTruncatedVersionOf } from "../../src/lib/market/scrape-new-reviews";
import { findDuplicateReviews } from "../../src/lib/market/review-duplicates";

test("ulasan yang sudah tersimpan tidak masuk lagi meski tanggal relatifnya bergeser", async () => {
  // Ulasan Google asli yang dibaca dari tab ulasan Google Travel (label Google Maps sejak 18 Nov 2026), dikirim ulang
  // seperti hasil crawl hari berikutnya.
  const stored = await db.competitorReview.findFirst({
    where: { source: "Google Maps", sourceUrl: { contains: "/travel/" }, archivedAt: null },
    include: { competitor: { select: { name: true } } },
    orderBy: { capturedAt: "asc" },
  });
  assert.ok(stored, "butuh minimal satu ulasan Google yang dibaca dari Google Travel di DB lokal");
  const before = await db.competitorReview.count({ where: { competitorId: stored.competitorId } });
  const shifted = new Date(stored.reviewDate.getTime() + 86_400_000);
  const result = await ingestScrapedReviews(stored.competitorId, stored.competitor.name, [
    {
      author: "penulis yang sama",
      rating: Number(stored.rating),
      reviewDate: shifted,
      text: stored.text,
      source: stored.source,
      sourceUrl: stored.sourceUrl,
      observedAt: new Date(),
      dateUncertaintyDays: 7,
    },
  ]);
  assert.deepEqual(result, { inserted: 0, skipped: 1 });
  assert.equal(await db.competitorReview.count({ where: { competitorId: stored.competitorId } }), before);
});

test("pencari duplikat menyimpan baris tertua dan menandai sisanya", () => {
  const rows = [
    { id: "b", competitorId: "c1", source: "Google Travel", text: "Kamar  bersih ", capturedAt: new Date("2026-11-13") },
    { id: "a", competitorId: "c1", source: "Google Travel", text: "Kamar bersih", capturedAt: new Date("2026-11-04") },
    { id: "c", competitorId: "c2", source: "Google Travel", text: "Kamar bersih", capturedAt: new Date("2026-11-05") },
  ];
  assert.deepEqual(findDuplicateReviews(rows), ["b"]);
});

test("ulasan Google Maps dengan review id sama: tidak masuk dua kali dan teks lengkap tidak diganti versi terpotong", async () => {
  // Ulasan Maps asli di DB lokal yang sourceUrl-nya memuat reviewid dari kartu Google Maps.
  const stored = await db.competitorReview.findFirst({
    where: { source: "Google Maps", archivedAt: null, sourceUrl: { contains: "reviewid=" } },
    include: { competitor: { select: { name: true } } },
    orderBy: { capturedAt: "asc" },
  });
  assert.ok(stored, "butuh minimal satu ulasan Google Maps berreviewid di DB lokal");
  const reviewId = decodeURIComponent(stored.sourceUrl.match(/reviewid=([^&]+)/)?.[1] ?? "");
  const truncated = `${stored.text.slice(0, Math.min(60, stored.text.length - 1))} …`;
  const base = { author: "x", rating: Number(stored.rating), reviewDate: stored.reviewDate, source: "Google Maps", sourceUrl: stored.sourceUrl, observedAt: new Date(), dateUncertaintyDays: 7, reviewId };
  const again = await ingestScrapedReviews(stored.competitorId, stored.competitor.name, [{ ...base, text: truncated }]);
  assert.deepEqual(again, { inserted: 0, skipped: 1 }, "versi terpotong tidak boleh jadi baris baru");
  const after = await db.competitorReview.findUniqueOrThrow({ where: { id: stored.id } });
  assert.equal(after.text, stored.text, "teks lengkap yang tersimpan tidak boleh diganti versi terpotong");
});

test("pencari duplikat: review id Google yang sama dihitung satu ulasan, teks terlengkap disimpan", () => {
  const url = (id: string) => `https://www.google.com/maps/place/X?hl=id&reviewid=${id}`;
  const rows = [
    { id: "pendek", competitorId: "c1", source: "Google Maps", text: "Tempat nyaman …", sourceUrl: url("R1"), capturedAt: new Date("2026-11-07") },
    { id: "lengkap", competitorId: "c1", source: "Google Maps", text: "Tempat nyaman dan bersih, tolong diperbaiki lagi.", sourceUrl: url("R1"), capturedAt: new Date("2026-11-09") },
    { id: "lain", competitorId: "c1", source: "Google Maps", text: "Tempat nyaman …", sourceUrl: url("R2"), capturedAt: new Date("2026-11-08") },
  ];
  assert.deepEqual(findDuplicateReviews(rows), ["pendek"]);
});

test("teks terpotong dikenali hanya bila awalnya sama dengan teks lengkap", () => {
  assert.equal(isTruncatedVersionOf("Tempat nyaman dengan suasana …", "Tempat nyaman dengan suasana angin pantai."), true);
  assert.equal(isTruncatedVersionOf("Tempat nyaman dengan suasana angin pantai.", "Tempat nyaman dengan suasana …"), false);
  assert.equal(isTruncatedVersionOf("Kamar bersih …", "Kamar kotor sekali."), false);
  assert.equal(isTruncatedVersionOf("Kamar bersih", "Kamar bersih dan luas"), false, "tanpa tanda potong bukan versi terpotong");
});
