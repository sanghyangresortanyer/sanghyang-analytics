import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDynamicOtaDirectory,
  extractHostnameFromUrl,
  isKnownOtaHost,
  isKnownOtaProvider,
} from "../../src/lib/market/ota-providers";
import { channelFromSource } from "../../src/lib/market/outlet-filters";
import { isVerifiedReviewSource } from "../../src/lib/market/resort-strategy";
import { socialSourceStatuses } from "../../src/lib/market/social-sources";
import { socialStepOutcome } from "../../src/lib/market/scrape-social-buzz";

test("klasifikasi OTA dan verifikasi URL bekerja dinamis tanpa false positive kata umum atau TLD palsu", () => {
  const discoveredHosts = ["halalbooking.com", "expedia.co.id", "etrip.net", "bluepillow.id", "trustyou.com", "hotels.com", "booking.com"];
  const discoveredProviders = [
    "Halalbooking",
    "Expedia.co.id",
    "Etrip.net",
    "Bluepillow.id",
    "TrustYou",
    "Wego.com",
    "Hotels.com",
    "Booking.com",
    "tiket.com",
    "Traveloka.com",
  ];

  for (const name of discoveredProviders) {
    assert.equal(channelFromSource(name, discoveredProviders), "ota", `${name} harus masuk kanal OTA`);
    assert.equal(isKnownOtaProvider(name, discoveredProviders), true);
  }

  // Nama umum dan situs langsung tidak boleh terseret sebagai OTA meski memakai kata hotels/booking/tiket.
  assert.equal(channelFromSource("Archipelago Hotels", discoveredProviders), "website");
  assert.equal(channelFromSource("Booking Langsung", discoveredProviders), "website");
  assert.equal(channelFromSource("Tiket Masuk", discoveredProviders), "website");
  assert.equal(channelFromSource("YouTube", discoveredProviders), "website");
  assert.equal(channelFromSource("Google Maps", discoveredProviders), "google");
  assert.equal(channelFromSource("Instagram", discoveredProviders), "social");
  assert.equal(channelFromSource("TikTok", discoveredProviders), "social");

  // Domain tak dikenal, fail-closed Google/IG/TikTok non-ulasan, dan domain TLD tiruan harus ditolak.
  assert.equal(isVerifiedReviewSource("https://example.com/reviews", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://www.youtube.com/watch?v=123", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://hotels.id/fake", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://booking.org/fake", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://tripadvisor.info/x", ["tripadvisor.co.id"]), false);
  assert.equal(isVerifiedReviewSource("https://www.google.com/maps/place/Sanghyang", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://www.instagram.com/astonanyer/", discoveredHosts), false);
  assert.equal(isVerifiedReviewSource("https://www.tiktok.com/@astonanyerofficial", discoveredHosts), false);

  // Domain OTA terverifikasi dan subdomain langsung serta pcurl Google Travel lolos.
  assert.equal(isVerifiedReviewSource("https://www.halalbooking.com/id/hotel/sanghyang", discoveredHosts), true);
  assert.equal(isVerifiedReviewSource("https://id.expedia.co.id/Anyer-Hotels", discoveredHosts), true);
  assert.equal(isKnownOtaHost("id.hotels.com", ["hotels.com"]), true);
  assert.equal(
    isVerifiedReviewSource("https://www.google.com/travel/lodging/clk?pc=abc&pcurl=https://halalbooking.com/p/1", discoveredHosts),
    true,
  );
  assert.equal(
    isVerifiedReviewSource("https://www.google.com/travel/lodging/clk?pc=abc&pcurl=https://example.com/bad", discoveredHosts),
    false,
  );
  assert.equal(extractHostnameFromUrl("https://www.google.com/travel/lodging/clk?pcurl=https://etrip.net/x"), "etrip.net");
});

test("direktori dinamis memisahkan situs resmi beserta subdomainnya dan membedakan host harga vs ulasan", () => {
  const dir = buildDynamicOtaDirectory({
    records: [
      { provider: "Halalbooking", hosts: ["halalbooking.com"], hotelIds: ["sanghyang", "aston_anyer"], channels: ["prices"] },
      { provider: "Qantas Hotels", hosts: ["qantas.com"], hotelIds: ["sanghyang"], channels: ["prices"] },
      { provider: "Pegipegi", hosts: ["pegipegi.com"], hotelIds: ["mambruk"], channels: ["prices", "reviews"] },
      { provider: "all.accor.com", hosts: ["all.accor.com", "booking.all.accor.com"], hotelIds: ["movenpick"], channels: ["reviews"] },
    ],
    excludeHosts: ["all.accor.com", "sanghyang.com"],
  });

  assert.ok(dir.hosts.includes("halalbooking.com"));
  assert.ok(dir.hosts.includes("pegipegi.com"));
  assert.ok(dir.reviewHosts.includes("pegipegi.com"));
  assert.equal(dir.reviewHosts.includes("qantas.com"), false, "situs harga saja tidak masuk reviewHosts");
  assert.equal(isVerifiedReviewSource("https://www.qantas.com/au/en.html", dir.reviewHosts), false);

  assert.equal(dir.hosts.includes("all.accor.com"), false, "situs resmi hotel harus dikeluarkan");
  assert.equal(dir.hosts.includes("booking.all.accor.com"), false, "subdomain situs resmi harus dikeluarkan");
  assert.equal(dir.providers.includes("all.accor.com"), false);
  assert.ok(dir.byHotel.mambruk?.includes("Pegipegi"));
  assert.equal(dir.byHotel.sanghyang?.includes("Pegipegi") ?? false, false);
});

test("status sesi media sosial saat butuh login ulang mengarahkan ke Ekstensi Chrome ADR-012 tanpa merusak TikTok oEmbed dan socialStepOutcome", () => {
  const sources = socialSourceStatuses({ SOCIAL_RESEARCH_SESSION: "needs_login" }, { tiktokVideos: 1 });
  assert.equal(sources[0].state, "belum-dikonfigurasi");
  assert.deepEqual(sources[0].missingEnvKeys, []);
  assert.match(sources[0].detail, /Ekstensi Chrome Sanghyang Market Sync/);
  assert.doesNotMatch(sources[0].detail, /launch-social-login\.mjs|data\/social-browser-profile/);
  assert.doesNotMatch(sources[0].detail, /^Belum dikonfigurasi: isi INSTAGRAM_GRAPH_ACCESS_TOKEN/);
  assert.equal(sources[1].state, "siap", "TikTok oEmbed tidak butuh sesi login");
  assert.doesNotMatch(sources[1].detail, /launch-social-login\.mjs/);
  assert.match(sources[1].detail, /Ekstensi Chrome Sanghyang Market Sync/);

  const outcome = socialStepOutcome({
    attempted: 0,
    totalDiscovered: 0,
    newPosts: 0,
    blocked: [],
    failures: [],
    skippedReason: "Instagram (Perlu login ulang di Chrome)",
    sources,
    tiktok: { checked: 1, available: 1, unavailable: [], failures: [] },
  });
  assert.doesNotMatch(outcome.detail, /isi \./, "detail tidak boleh berakhir 'isi .' ketika missingEnvKeys kosong");
});
