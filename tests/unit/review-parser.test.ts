import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReviewCard,
  normalizeReviewSource,
  determineSentimentFromRating,
  determineSentimentFromText,
  determineReviewSentiment,
  isReviewWithinWindow,
  filterReviewsByWindow,
  formatReviewCountBreakdown,
  generateExternalId,
  parseRelativeDateWithUncertainty,
} from "../../src/lib/market/scrape-new-reviews";
import {
  isVerifiedReviewSource,
  verifiedFeedback,
  formatReviewComparisonLabels,
  type VerifiedReview,
} from "../../src/lib/market/resort-strategy";
import { ReviewSentiment } from "@prisma/client";

test("normalizeReviewSource - kartu \"di Google\" adalah ulasan Google Maps, OTA tetap memakai nama platformnya", () => {
  // Tab ulasan Google Travel Sanghyang menulis "Ringkasan ulasan Google 4,4 · 3.047 ulasan", sama dengan listing
  // Google Maps "4,4 (3.047)" (keduanya dibaca 18 Nov 2026): kartu bertanda "di Google" adalah ulasan Google Maps.
  assert.equal(normalizeReviewSource("Google"), "Google Maps");
  assert.equal(normalizeReviewSource(" Google Reviews "), "Google Maps");
  assert.equal(normalizeReviewSource("Tripadvisor"), "Tripadvisor");
  assert.equal(normalizeReviewSource("Trip.com"), "Trip.com");
  assert.equal(normalizeReviewSource("Agoda"), "Agoda");
});

test("kartu ulasan asli Google Travel 18 Nov 2026: label Google Maps, halaman bacanya tetap tersimpan", () => {
  // Teks kartu dibaca dari tab ulasan Google Travel Sanghyang (urutan Terbaru); nama penulis disamarkan.
  const card = [
    "(nama penulis disamarkan)",
    "sebulan lalu di  Google",
    "5/5",
    "Liburan ❘ Teman",
    "Kapan lagi staycation terus bangun pagi langsung disambut view laut, di sini bisa banget. … Baca",
  ].join("\n");
  const travelUrl = "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews?hl=id&gl=id";
  const parsed = parseReviewCard(card, travelUrl, new Date("2026-11-18T05:00:00Z"));
  assert.ok(parsed);
  assert.equal(parsed.source, "Google Maps");
  assert.equal(parsed.sourceUrl, travelUrl);
  assert.equal(parsed.rating, 5);
  assert.equal(parsed.dateUncertaintyDays, 30);
  assert.ok(parsed.text.startsWith("Kapan lagi staycation"));
});

test("tanggal relatif dalam jam pada urutan Terbaru (\"8 jam lalu\") dihitung dari jamnya", () => {
  const now = new Date("2026-11-18T05:00:00Z");
  const hours = parseRelativeDateWithUncertainty("8 jam lalu", now);
  assert.equal(hours.date.toISOString(), "2026-11-17T21:00:00.000Z");
  assert.equal(hours.uncertaintyDays, 0);
  assert.equal(parseRelativeDateWithUncertainty("30 menit lalu", now).date.toISOString(), "2026-11-18T04:30:00.000Z");
});

test("parseReviewCard - Penguraian kartu Google Travel dengan sumber yang benar", () => {
  const cardText = [
    "Budi Santoso",
    "3 minggu lalu di Google",
    "5/5",
    "Pemandangan laut sangat memesona, kolam air panas alaminya sangat bersih dan nyaman untuk relaksasi keluarga.",
  ].join("\n");

  const travelUrl = "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews";
  const parsed = parseReviewCard(cardText, travelUrl, new Date("2026-11-13T00:00:00Z"));

  assert.ok(parsed, "Kartu harus berhasil diurai");
  assert.equal(parsed.author, "Budi Santoso");
  assert.equal(parsed.rating, 5);
  assert.equal(parsed.source, "Google Maps", "Kartu \"di Google\" adalah ulasan Google Maps walau dibaca dari Google Travel");
  assert.equal(parsed.sourceUrl, travelUrl);
  assert.ok(parsed.text.includes("Pemandangan laut"));
});

test("Klasifikasi Sentimen Jujur - Rating & Teks Berbasis Kata Kunci", () => {
  // 1. Sentimen rating
  assert.equal(determineSentimentFromRating(5), ReviewSentiment.positive);
  assert.equal(determineSentimentFromRating(4), ReviewSentiment.positive);
  assert.equal(determineSentimentFromRating(3), ReviewSentiment.neutral);
  assert.equal(determineSentimentFromRating(2), ReviewSentiment.negative);
  assert.equal(determineSentimentFromRating(1), ReviewSentiment.negative);

  // 2. Sentimen teks
  const textPositive = "Kamar sangat bersih dan staf resepsionis ramah sekali, makanan lezat!";
  const textNegative = "Kamar mandi kotor dan bau, AC rusak dan pelayanan lambat.";
  const textNeutral = "Lokasi resort persis di jalan raya sirih anyer KM 128.";

  assert.equal(determineSentimentFromText(textPositive), ReviewSentiment.positive);
  assert.equal(determineSentimentFromText(textNegative), ReviewSentiment.negative);
  assert.equal(determineSentimentFromText(textNeutral), null);

  // 3. Sentimen gabungan
  assert.equal(determineReviewSentiment(textPositive, 5), ReviewSentiment.positive);
  assert.equal(determineReviewSentiment(textNegative, 1), ReviewSentiment.negative);
  // Bila teks netral, kembali ke rating
  assert.equal(determineReviewSentiment(textNeutral, 4), ReviewSentiment.positive);
});

test("Filter Jendela Waktu Ulasan (default 24 bulan)", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  const recentReview = { reviewDate: new Date("2026-05-10T00:00:00Z") }; // 6 bulan lalu
  const midReview = { reviewDate: new Date("2025-01-15T00:00:00Z") }; // ~22 bulan lalu
  const boundaryReview = { reviewDate: new Date("2024-11-20T00:00:00Z") }; // ~23,8 bulan lalu (dalam jendela 24 bulan)
  const oldReview = { reviewDate: new Date("2018-08-20T00:00:00Z") }; // 8 tahun lalu (temuan D6)

  assert.equal(isReviewWithinWindow(recentReview.reviewDate, 24, now), true);
  assert.equal(isReviewWithinWindow(midReview.reviewDate, 24, now), true);
  assert.equal(isReviewWithinWindow(oldReview.reviewDate, 24, now), false, "Ulasan tahun 2018 harus tersaring");

  const all = [recentReview, midReview, oldReview, boundaryReview];
  const filtered = filterReviewsByWindow(all, 24, now);

  assert.equal(filtered.length, 3, "Hanya ulasan dalam 24 bulan yang lolos");
  assert.ok(!filtered.includes(oldReview), "Ulasan 2018 tidak boleh ada di hasil filter");
});

test("Pembedaan Label 'Total ulasan di Google' vs 'Ulasan tersimpan di sistem'", () => {
  const counts = {
    totalOnGoogle: 2937,
    savedInSystem: 142,
    inWindowSaved: 120,
  };

  const formatted = formatReviewCountBreakdown(counts);
  assert.equal(formatted.headline, "142 ulasan tersimpan di sistem");
  assert.equal(
    formatted.detail,
    "Dari total 2937 ulasan di Google (120 ulasan dalam 24 bulan terakhir)"
  );

  const breakdown = {
    outletKey: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    totalOnGoogle: 450,
    savedInSystem: 11,
    inWindowSaved: 10,
  };

  const labels = formatReviewComparisonLabels(breakdown);
  assert.equal(labels.googleListingLabel, "Total ulasan di Google: 450");
  assert.equal(
    labels.systemDatabaseLabel,
    "Ulasan tersimpan di sistem: 11 (10 dalam 24 bulan terakhir)"
  );
});

test("isVerifiedReviewSource & verifiedFeedback di resort-strategy", () => {
  // 1. isVerifiedReviewSource
  const validTravel = "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews";
  const validMapsReview = "https://www.google.com/maps/place/Sanghyang/@-6.1,105.8/?reviewid=98765";
  const fakeCid = "https://maps.google.com/?cid=sanghyangresortanyer";
  const notGoogle = "https://example.com/reviews";

  assert.equal(isVerifiedReviewSource(validTravel), true);
  assert.equal(isVerifiedReviewSource(validMapsReview), true);
  assert.equal(isVerifiedReviewSource(fakeCid), false, "URL dengan cid buatan harus tidak terverifikasi");
  assert.equal(isVerifiedReviewSource(notGoogle), false);

  // 2. verifiedFeedback dengan filter jendela 24 bulan
  const baseDate = new Date("2026-11-13T00:00:00Z");
  const sampleReviews: VerifiedReview[] = [
    {
      rating: 5,
      text: "Luar biasa nyaman",
      source: "Google Travel",
      reviewDate: "2026-10-01T00:00:00Z",
    },
    {
      rating: 2,
      text: "Pelayanan agak lambat",
      source: "Google Travel",
      reviewDate: "2026-08-15T00:00:00Z",
    },
    {
      rating: 1,
      text: "AC mati di tahun 2018",
      source: "Google Maps",
      reviewDate: "2018-05-20T00:00:00Z", // Di luar jendela 24 bulan
    },
  ];

  const feedback = verifiedFeedback(sampleReviews, { monthsWindow: 24, baseDate });
  assert.equal(feedback.totalAllTime, 3, "Total semua waktu harus 3");
  assert.equal(feedback.total, 2, "Total ulasan dalam jendela 24 bulan harus 2");
  assert.equal(feedback.complaints.length, 1, "Keluhan dalam 24 bulan hanya 1 (ulasan 2018 disaring)");
  assert.equal(feedback.praises.length, 1, "Pujian dalam 24 bulan ada 1");
});

test("Parser Google Travel/Maps (C4) - Stabilisasi generateExternalId tanpa pergeseran tanggal", () => {
  const hotel = "Aston Anyer Beach Hotel";
  const author = "Budi Pratama";
  const text = "Pemandangan pantai sangat indah dan staf sangat ramah membantu.";

  // Hari ke-1: terdeteksi '2 minggu lalu'
  const dateDay1 = new Date("2026-10-25T00:00:00Z");
  const idDay1 = generateExternalId(hotel, author, dateDay1, text);

  // Hari ke-5: waktu relatif bergeser ke '3 minggu lalu'
  const dateDay5 = new Date("2026-10-20T00:00:00Z");
  const idDay5 = generateExternalId(hotel, author, dateDay5, text);

  // Pemanggilan tanpa objek tanggal (hanya text)
  const idDirect = generateExternalId(hotel, author, text);

  assert.equal(idDay1, idDay5, "externalId harus tetap stabil identik meski tanggal relatif bergeser antar-run");
  assert.equal(idDay1, idDirect, "externalId harus deterministik terhadap kombinasi hotel, penulis, dan teks");

  // Penulis atau hotel berbeda harus menghasilkan ID berbeda
  const idOtherAuthor = generateExternalId(hotel, "Dewi Santoso", dateDay1, text);
  assert.notEqual(idDay1, idOtherAuthor);
});

test("Parser Google Travel/Maps (C4) - Pencatatan ketidakpastian tanggal dan observedAt", () => {
  const now = new Date("2026-11-13T10:00:00Z");

  const dayResult = parseRelativeDateWithUncertainty("3 hari lalu", now);
  assert.equal(dayResult.uncertaintyDays, 1);
  assert.ok(dayResult.date.getTime() < now.getTime());

  const weekResult = parseRelativeDateWithUncertainty("2 minggu lalu", now);
  assert.equal(weekResult.uncertaintyDays, 7);

  const monthResult = parseRelativeDateWithUncertainty("4 bulan lalu", now);
  assert.equal(monthResult.uncertaintyDays, 30);

  const yearResult = parseRelativeDateWithUncertainty("1 tahun lalu", now);
  assert.equal(yearResult.uncertaintyDays, 365);

  const exactResult = parseRelativeDateWithUncertainty("2026-11-01", now);
  assert.equal(exactResult.uncertaintyDays, 0);
});

test("kartu asli tab ulasan Google Travel 18 Nov 2026: kartu tanpa teks dilewati, label Google Maps dan Tripadvisor", async () => {
  const fs = await import("node:fs");
  const fixture = JSON.parse(fs.readFileSync("tests/fixtures/google-travel-review-cards-sanghyang-2026-11-18.json", "utf8")) as { dibaca: string; kartu: string[] };
  const sourceUrl = "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews?hl=id&gl=id";
  const read = new Date(fixture.dibaca);
  const parsed = fixture.kartu.map((card) => parseReviewCard(card, sourceUrl, read));
  // Kartu 1 dan 3 hanya berisi nilai Kamar/Layanan/Lokasi tanpa teks, kartu 5 kosong: bukan ulasan yang bisa dibaca.
  assert.deepEqual(parsed.map((r) => r?.source ?? null), [null, "Google Maps", null, "Tripadvisor", null]);
  const google = parsed[1]!;
  assert.equal(google.rating, 5);
  assert.equal(google.dateUncertaintyDays, 1);
  assert.ok(google.text.includes("Family Gathering"));
  assert.ok(!/Tanggapan dari pemilik/.test(google.text));
  assert.equal(parsed[3]!.text, "Pemandangan indah, sejuk karena banyak pohon");
});
