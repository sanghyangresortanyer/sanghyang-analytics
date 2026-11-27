/**
 * Data pasar per outlet Sanghyang: ukuran pasar, posisi harga, pembanding, dan rekomendasi pemasaran.
 *
 * - Omset aktual dari impor pembukuan pemilik (OutletMonthlyRevenue), diisi summary API; tidak ditanam di kode.
 * - Market Cap kamar resort dihitung di market-size.ts: kamar × 30 hari × TPK hotel bintang Banten (BPS) × tarif OTA terbobot.
 * - Pembanding per outlet diisi summary API dari registri pesaing (aturan di compset.ts); daftar resort di sini diturunkan
 *   dari data kompset yang sama.
 * - Harga menu Sanghyang dari foto menu resmi (official-menu.ts). Perbandingan per item dengan menu pesaing
 *   (competitor-menu.ts) dihitung fnb-compare.ts untuk langkah 3 Insight Pasar dan halaman Untuk Direksi; indeks harga
 *   outlet F&B di modul ini tetap kosong (null), bukan ditebak.
 * - Rekomendasi pemasaran berisi usulan. Fakta di dalamnya hanya yang bersumber (situs resmi Sanghyang, ulasan Google,
 *   tarif OTA, radar promo); tidak ada persen kenaikan omset, belanja per tamu, atau promo pesaing karangan.
 */
import {
  breakEvenOccupancyDropPercent,
  buildRoomRateSummaries,
  competitorGapPercent,
  isPricingCompetitor,
  RESORT_ROOM_RATE_SOURCE,
  resortPhase1PriceLiftPercent,
  resortPricePositioningIndex,
} from "./resort-room-rates";

import {
  pricePositionCategory,
  type BenchmarkCompetitorItem,
  type MenuItemComparison,
  type OutletMarketShareData,
} from "./pricing-rules";

import { calculatePrecisionMarketShare, COMPSET_HOTELS, COMPSET_SOURCE, compsetStars, type CompsetHotel } from "./hotel-compset";
import { MIN_LODGING_STARS } from "./compset";
import { compsetRationale } from "./compset-rationale";
import { officialMenuComparisons, OFFICIAL_MENU_SOURCE } from "./official-menu";

export * from "./pricing-rules";

const RESORT_ROOM_SUMMARIES = buildRoomRateSummaries();
const RESORT_PPI = resortPricePositioningIndex();
/** Pembanding inti yang punya tarif OTA; acuan (mis. Hawaii) tampil di tabel tetapi tidak dihitung. */
const RESORT_RATE_COMPETITORS = new Set(RESORT_ROOM_SUMMARIES.flatMap((s) => s.rows.map((r) => r.hotelId)).filter(isPricingCompetitor)).size;
const RESORT_ROOMS_BELOW_MARKET = RESORT_ROOM_SUMMARIES.filter((s) => s.weekday.position === "DI_BAWAH_PASAR").length;
const RESORT_ROOMS_ABOVE_MARKET = RESORT_ROOM_SUMMARIES.filter((s) => s.weekday.position === "DI_ATAS_PASAR").length;

/** Proyeksi Fase 1 bila okupansi tetap (proksi ADR = penawaran OTA termurah, bobot 5 malam hari biasa + 2 akhir pekan). */
const RESORT_PHASE1_LIFT = resortPhase1PriceLiftPercent(RESORT_ROOM_SUMMARIES);

/**
 * Baris kompset tanpa TPK: dipakai untuk tarif terbobot (ADR) dan posisi harga. Perkiraan omset dan Market Cap butuh
 * TPK BPS dari basis data, jadi diisi summary API lewat lib/market/market-size.ts, bukan di modul statis ini.
 */
const RESORT_COMPSET_PRECISION = calculatePrecisionMarketShare(null, "all");
const RESORT_PRECISION_MARKET_SIZE: number | null = null;

const findCompsetRow = (hotelId: string) => RESORT_COMPSET_PRECISION.rows.find((r) => r.hotelId === hotelId);

/** Tarif OTA terbobot pesaing dibanding Sanghyang dalam persen (crawl Google Travel); tanpa tarif kedua sisi null. */
const priceVsSanghyangPercent = (hotelId: string): number | null => {
  const own = findCompsetRow("sanghyang")?.adr ?? null;
  const rival = findCompsetRow(hotelId)?.adr ?? null;
  return own && rival ? Math.round((rival / own) * 100) : null;
};
const priceVsSanghyang = (hotelId: string) => {
  const percent = priceVsSanghyangPercent(hotelId);
  return percent === null ? "Belum ada data harga yang bersumber" : `${percent}% vs Sanghyang (tarif OTA terbobot)`;
};

/** Tabel kamar resort diturunkan dari analisa tarif OTA (satu item per jenis kamar, harga hari biasa yang tampil di bukti). */
const RESORT_MENU_PRICE_ITEMS: MenuItemComparison[] = RESORT_ROOM_SUMMARIES.flatMap((s) =>
  s.weekday.sanghyang === null
    ? []
    : [{
        itemName: s.room,
        category: "Kamar Resort (OTA, Hari Biasa)",
        sanghyangPrice: s.weekday.sanghyang,
        competitorPrices: s.rows.flatMap((row) => {
          const gap = competitorGapPercent(row.weekday);
          return row.weekday.competitor === null || gap === null
            ? []
            : [{ competitorName: `${row.competitorName} · ${row.competitorRoom}`, price: row.weekday.competitor, differencePercent: gap, note: row.offer }];
        }),
        portionValueNote: s.recommendation,
      }],
);

const firstUrl = (text: string) => text.match(/https?:\/\/[^\s)]+/)?.[0];

const SANGHYANG_STARS = COMPSET_HOTELS.find((h) => h.hotelId === "sanghyang")?.googleStars ?? null;
const clusterFor = (stars: number | null) =>
  stars === null || stars < MIN_LODGING_STARS ? undefined : stars >= 5 ? "KLASTER_II_BINTANG_5" : "KLASTER_I_BINTANG_4";

/**
 * Alasan pembanding resort dari data kompset statis, dengan kalimat yang sama seperti audit registri
 * (compset-rationale.ts). Fakta situs resmi dan rating hanya ada di basis data, jadi tidak disebut di sini.
 */
function compsetAuditSentence(h: CompsetHotel): string {
  return compsetRationale(
    {
      name: h.name,
      category: h.group,
      outlets: ["resort"],
      starRating: compsetStars(h),
      roomCount: h.roomCount,
      roadKm: h.roadKm,
      driveMinutes: h.driveMinutes,
      distanceSource: COMPSET_SOURCE.method,
      rating: null,
      reviewCount: null,
      compsetRole: h.compsetRole,
      facts: [],
      parent: null,
    },
    "resort",
    {
      own: { starRating: SANGHYANG_STARS, seaside: false },
      market: { stars: compsetStars(h), roomCountSource: h.roomCountSource, priceVsSanghyang: priceVsSanghyangPercent(h.hotelId) },
      rates: { source: RESORT_ROOM_RATE_SOURCE.source, capturedAt: RESORT_ROOM_RATE_SOURCE.capturedAt },
      menu: null,
    },
  );
}

/** Pembanding resort (inti dan acuan) dari data kompset; perkiraan omset diisi summary API dari market-size.ts. */
const RESORT_BENCHMARK_COMPETITORS: BenchmarkCompetitorItem[] = COMPSET_HOTELS.filter(
  (h) => h.hotelId !== "sanghyang" && h.compsetRole !== null,
).map((h) => ({
  name: h.name,
  estimatedRevenue: null,
  estimatedMarketShare: null,
  priceLevel: priceVsSanghyang(h.hotelId),
  starRating: compsetStars(h) ?? undefined,
  cluster: clusterFor(compsetStars(h)),
  compsetRole: h.compsetRole ?? undefined,
  roadKm: h.roadKm,
  auditRationale: compsetAuditSentence(h),
  evidenceSource: `Jumlah kamar: ${h.roomCountSource}`,
  evidenceSourceUrl: firstUrl(h.roomCountSource) ?? h.mapsUrl,
}));

const MENU_NOTE = `Harga Sanghyang di tabel dari ${OFFICIAL_MENU_SOURCE.title}, konten ${OFFICIAL_MENU_SOURCE.capturedAt}.`;

function fnbPricing(outlet: string, hasOfficialMenu: boolean): OutletMarketShareData["digitalMarketingStrategy"]["pricingOptimization"] {
  return {
    title: `Harga ${outlet} dibanding kompetitor`,
    currentAnalysis: hasOfficialMenu
      ? `Harga item menu resmi ${outlet} dibandingkan per item dengan item sebanding di menu kompetitor inti (bahan utama dan satuan harga sama) di Langkah 3 Insight Pasar dan ringkasan harga tab Strategy. ${MENU_NOTE}`
      : `Daftar harga resmi ${outlet} belum tercantum di situs Sanghyang, jadi indeks harga belum dihitung. Harga kompetitor yang sudah bersumber ada di langkah 3 Insight Pasar (per outlet) dan di laporan PDF Rapat Senin.`,
    recommendation: hasOfficialMenu
      ? "Tinjau item dengan selisih terbesar di ringkasan harga tab Strategy sebelum mengubah harga; harga bersih tetap tidak di bawah P25 kompetitor."
      : `Minta daftar harga resmi ${outlet} dari outlet, lalu kumpulkan daftar harga kompetitor inti beserta sumber dan tanggalnya.`,
  };
}

function counterPromo(outlet: string): OutletMarketShareData["digitalMarketingStrategy"]["competitorCounterPromo"] {
  return {
    title: "Menanggapi promo kompetitor",
    competitorAction: "Promo kompetitor yang terdeteksi tampil di Langkah 4 (Promo Kompetitor) dan di halaman Omset, Target dan Strategy.",
    ourCounterStrategy: `Tanggapi dengan nilai tambah lintas outlet Sanghyang, bukan potongan harga ${outlet}, sampai harga kompetitor bersumber dan bisa dibandingkan.`,
  };
}

/** Tanpa data biaya program dan omset per outlet, tidak ada proyeksi kenaikan yang bisa dipertanggungjawabkan. */
const NO_PROJECTION: OutletMarketShareData["digitalMarketingStrategy"]["financialProjection"] = {
  targetRevenueLiftPercent: null,
  projectedMonthlyRevenue: null,
  projectedMarketShare: null,
};

/** Satu-satunya harga D'Spa di situs resmi (halaman D'Spa): promo Buy 1 Get 1 Aquamedic, bersama diskon 30% Hotspring Spa. */
const DSPA_OFFICIAL_PROMO_ITEM: MenuItemComparison = {
  itemName: "Hot Spring Aquamedic (promo resmi Buy 1 Get 1)",
  category: "Hot Spring",
  sanghyangPrice: 350000,
  competitorPrices: [],
  portionValueNote: "Harga promo di situs resmi Sanghyang; harga normal tidak dicantumkan.",
};

const NO_REVENUE_LABEL = "Belum ada data omset";

export const OUTLET_MARKET_SHARE_DATA: Record<string, OutletMarketShareData> = {
  "sunset-grill": {
    outletKey: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: null,
    marketSegmentName: "Pasar kuliner seafood dan sunset dining pesisir Anyer–Cinangka",
    marketSharePercentage: null,
    marketRank: "Belum ada data (tidak ada data omset resmi kompetitor non-hotel)",
    pricePositioningIndex: null,
    pricePositioningCategory: null,
    benchmarkCompetitors: [],
    menuPriceItems: officialMenuComparisons("sunset-grill"),
    digitalMarketingStrategy: {
      pricingOptimization: fnbPricing("Sunset Grill", true),
      sentimentLeverage: {
        title: "Seafood dan grill di tepi dermaga saat senja",
        positiveDrivers: [
          "Hidangan laut segar dan aneka bakaran di tepi dermaga, berlatar langit jingga Selat Sunda (situs resmi)",
          "Udang, lobster, ikan, cumi, kepiting, dan kerang ada di menu resmi (situs resmi)",
        ],
        negativeFriction: [],
        marketingAngle: "Makan malam seafood di tepi dermaga saat matahari terbenam di Selat Sunda (situs resmi).",
      },
      competitorCounterPromo: counterPromo("menu Sunset Grill"),
      promoFormulation: {
        promoName: "Senja di Tepi Dermaga",
        headline: "Makan malam seafood saat matahari terbenam di Sunset Grill",
        discountStructure: "Usulan nilai tambah, bukan potongan harga menu; bentuk dan besarnya ditetapkan manajemen.",
        targetAudience: "Tamu menginap dan wisatawan Anyer yang mencari makan malam di tepi pantai",
        terms: "Reservasi lewat nomor RSVP resmi yang tercantum di menu Sunset Grill.",
        crossSellingOutlet: "Usulan: tamu Sunset Grill diberi informasi promo D'Spa yang berlaku di situs resmi (diskon 30% Hotspring Spa dan Buy 1 Get 1 Aquamedic Rp 350.000).",
      },
      financialProjection: NO_PROJECTION,
    },
  },

  "dragon-beach-club": {
    outletKey: "dragon-beach-club",
    outletName: "Dragon Beach Club (Sanghyang)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: null,
    marketSegmentName: "Pasar beach club dan hiburan malam pesisir Anyer",
    marketSharePercentage: null,
    marketRank: "Belum ada data (tidak ada data omset resmi kompetitor non-hotel)",
    pricePositioningIndex: null,
    pricePositioningCategory: null,
    benchmarkCompetitors: [],
    menuPriceItems: [],
    digitalMarketingStrategy: {
      pricingOptimization: fnbPricing("Dragon Beach Club", false),
      sentimentLeverage: {
        title: "Malam DJ dan atraksi panggung di beach club privat",
        positiveDrivers: [
          "Beach club privat dua lantai berkapasitas sekitar 400 orang (situs resmi)",
          "DJ tampil rutin, sering ditemani penari, atraksi api, dan rampak bedug; DJ perempuan tampil sekali seminggu (situs resmi)",
          "Acara spesial bersama artis pada momen besar seperti Tahun Baru dan hari jadi (situs resmi)",
        ],
        negativeFriction: [],
        marketingAngle: "Malam DJ dengan penari, atraksi api, dan rampak bedug di beach club privat tepi pantai (situs resmi).",
      },
      competitorCounterPromo: counterPromo("Dragon Beach Club"),
      promoFormulation: {
        promoName: "Malam DJ Dragon Beach Club",
        headline: "DJ, penari, atraksi api, dan rampak bedug di tepi pantai Anyer",
        discountStructure: "Usulan nilai tambah untuk rombongan; bentuk dan besarnya ditetapkan manajemen.",
        targetAudience: "Rombongan dan tamu menginap yang mencari hiburan malam",
        terms: "Reservasi lewat kontak resmi Dragon Beach Club.",
        crossSellingOutlet: "Usulan: tamu makan malam Sunset Grill mendapat informasi jadwal DJ Dragon Beach Club malam itu.",
      },
      financialProjection: NO_PROJECTION,
    },
  },

  "resort": {
    outletKey: "resort",
    outletName: "Kamar & Resort (Sanghyang Indah)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: RESORT_PRECISION_MARKET_SIZE,
    marketSegmentName: "Pasar kamar resort bintang 4–5 Anyer–Carita",
    marketSharePercentage: null,
    marketRank: "Perkiraan kasar Klaster I & II Bintang 4–5 (BPS TPK)",
    pricePositioningIndex: RESORT_PPI,
    pricePositioningCategory: pricePositionCategory(RESORT_PPI),
    benchmarkCompetitors: RESORT_BENCHMARK_COMPETITORS,
    menuPriceItems: RESORT_MENU_PRICE_ITEMS,
    digitalMarketingStrategy: {
      pricingOptimization: {
        title: `Penyesuaian tarif per jenis kamar vs ${RESORT_RATE_COMPETITORS} resort pembanding inti (OTA)`,
        currentAnalysis: `Indeks harga resort ${RESORT_PPI} (100 = setara harga kompetitor bintang 4 di OTA). Hari biasa: ${RESORT_ROOMS_BELOW_MARKET} dari ${RESORT_ROOM_SUMMARIES.length} jenis kamar Sanghyang di bawah koridor pasar bintang 4, ${RESORT_ROOMS_ABOVE_MARKET} di atasnya. Harga bersih setelah promo tidak boleh di bawah lantai koridor.`,
        recommendation: RESORT_ROOM_SUMMARIES.map((s) => `${s.room}: ${s.recommendation}`).join(" "),
        recommendationItems: RESORT_ROOM_SUMMARIES.map((s) => ({ room: s.room, lines: s.recommendationLines })),
      },
      sentimentLeverage: {
        title: "Satu-satunya Natural Hot Spring di Anyer & Fasilitas Lengkap dalam Satu Resort",
        positiveDrivers: [
          "Satu-satunya natural hot spring di Anyer: Hot Spring Aquamedic di D'Spa (situs resmi)",
          "7 tipe kamar 24–115 m², dari kamar berdua sampai villa keluarga 4 tamu dengan pantry (situs resmi)",
          "Dalam satu resort: kolam renang, tenis, voli pantai, water sports, dan ruang rapat hingga 100 orang (situs resmi)",
        ],
        negativeFriction: [
          "Kamar & bangunan: nyamuk, kamar mandi berbau, dan plafon bocor muncul di ulasan Google Travel",
          "Pelayanan: respons staf saat tamu meminta bantuan dinilai kurang ramah di ulasan Google Travel",
        ],
        marketingAngle: "Highlight narasi: 'Satu-satunya Natural Hot Spring di Anyer: Berendam di Hot Spring Aquamedic, Senja di Dermaga Sunset Grill'.",
      },
      competitorCounterPromo: {
        title: "Menghadapi Promo Diskon Kamar Kompetitor",
        competitorAction: "Promo kamar kompetitor yang terdeteksi tampil di Langkah 4 (Promo Kompetitor).",
        ourCounterStrategy: "Jangan membalas dengan potongan harga kamar di bawah lantai pasar bintang 4. Fase 1: balas dengan nilai tambah, misalnya sarapan atau voucher Hot Spring Aquamedic D'Spa (harga promo resmi Buy 1 Get 1 Rp 350.000); biayanya perlu dihitung dan disetujui manajemen. Fase 2: diskon boleh menyamai promo kompetitor hanya sampai batas maksimal per kamar di Pilar 1.",
      },
      promoFormulation: {
        promoName: "Sanghyang Hot Spring Staycation",
        headline: "Menginap di Satu-satunya Resort Natural Hot Spring di Anyer + Voucher Hot Spring Aquamedic!",
        discountStructure: "Fase 1: tanpa potongan harga kamar; nilai tambah sarapan dan voucher Hot Spring Aquamedic D'Spa untuk menginap 2 malam (usulan, hitung biaya dan setujui manajemen). Fase 2: harga coret dari harga publikasi dengan diskon maksimal per kamar sesuai Pilar 1, sehingga harga bersih tetap di atas lantai pasar bintang 4.",
        targetAudience: "Keluarga (kamar dan villa hingga 4 tamu) dan rombongan rapat (ruang rapat hingga 100 orang), sesuai fasilitas di situs resmi",
        terms: "Harga kamar sama di semua OTA dan reservasi langsung (paritas harga); tamu reservasi langsung mendapat nilai tambah, bukan harga lebih murah.",
        crossSellingOutlet: "Usulan: tamu menginap mendapat potongan di Sunset Grill (besarnya ditetapkan manajemen) dan penawaran D'Spa yang berlaku di situs resmi (diskon 30% Hotspring Spa dan Buy 1 Get 1 Aquamedic Rp 350.000).",
      },
      financialProjection: {
        targetRevenueLiftPercent: RESORT_PHASE1_LIFT,
        projectedMonthlyRevenue: null,
        projectedMarketShare: null,
        breakEvenOccupancyDropPercent: breakEvenOccupancyDropPercent(RESORT_PHASE1_LIFT),
      },
    },
  },

  "dbistro": {
    outletKey: "dbistro",
    outletName: "D'Bistro (Sanghyang)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: null,
    marketSegmentName: "Pasar restoran all-day dining dan masakan internasional Anyer",
    marketSharePercentage: null,
    marketRank: "Belum ada data (tidak ada data omset resmi kompetitor non-hotel)",
    pricePositioningIndex: null,
    pricePositioningCategory: null,
    benchmarkCompetitors: [],
    menuPriceItems: officialMenuComparisons("dbistro"),
    digitalMarketingStrategy: {
      pricingOptimization: fnbPricing("D'Bistro", true),
      sentimentLeverage: {
        title: "Santap internasional dan prasmanan Indonesia",
        positiveDrivers: [
          "Hidangan Eropa, piza dan pasta Italia, favorit Asia, serta prasmanan Indonesia setiap makan malam (situs resmi)",
          "Menu resmi terbagi Indonesian, Japanese, dan Western corner (situs resmi)",
        ],
        negativeFriction: [],
        marketingAngle: "Santap internasional dan prasmanan Indonesia setiap makan malam, dari sarapan sampai makan malam di dalam resort (situs resmi).",
      },
      competitorCounterPromo: counterPromo("menu D'Bistro"),
      promoFormulation: {
        promoName: "Prasmanan Malam D'Bistro",
        headline: "Prasmanan Indonesia setiap makan malam di D'Bistro",
        discountStructure: "Usulan nilai tambah untuk keluarga; bentuk dan besarnya ditetapkan manajemen.",
        targetAudience: "Tamu menginap dan keluarga yang makan malam di dalam resort",
        terms: "Berlaku saat prasmanan makan malam tersedia.",
        crossSellingOutlet: "Usulan: tamu D'Bistro diberi informasi jadwal hiburan D'Bar dan Dragon Beach Club malam itu.",
      },
      financialProjection: NO_PROJECTION,
    },
  },

  "dbar": {
    outletKey: "dbar",
    outletName: "D'Bar & Karaoke (Sanghyang)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: null,
    marketSegmentName: "Pasar karaoke, lounge bar, dan hiburan keluarga Anyer",
    marketSharePercentage: null,
    marketRank: "Belum ada data (tidak ada data omset resmi kompetitor non-hotel)",
    pricePositioningIndex: null,
    pricePositioningCategory: null,
    benchmarkCompetitors: [],
    menuPriceItems: [],
    digitalMarketingStrategy: {
      pricingOptimization: fnbPricing("D'Bar & Karaoke", false),
      sentimentLeverage: {
        title: "Karaoke nyaman di dalam resort",
        positiveDrivers: [
          "Ruang karaoke yang nyaman dan modern untuk bernyanyi lagu-lagu terbaru (situs resmi)",
          "Suasana santai dengan dekorasi modern yang elegan (situs resmi)",
        ],
        negativeFriction: [],
        marketingAngle: "Bernyanyi bersama keluarga dan teman di ruang karaoke modern tanpa keluar resort (situs resmi).",
      },
      competitorCounterPromo: counterPromo("D'Bar"),
      promoFormulation: {
        promoName: "Karaoke Bersama di D'Bar",
        headline: "Bernyanyi lagu-lagu terbaru di ruang karaoke modern D'Bar",
        discountStructure: "Usulan nilai tambah untuk rombongan; bentuk dan besarnya ditetapkan manajemen.",
        targetAudience: "Keluarga dan rombongan yang menginap",
        terms: "Reservasi ruang lewat kontak resmi D'Bar.",
        crossSellingOutlet: "Usulan: tamu D'Bar bisa memesan makanan dari D'Bistro atau Sunset Grill.",
      },
      financialProjection: NO_PROJECTION,
    },
  },

  "dspa": {
    outletKey: "dspa",
    outletName: "D'Spa & Hot Spring Aquamedic (Sanghyang)",
    activeMonth: NO_REVENUE_LABEL,
    revenueActual: null,
    totalMarketSizeEstimated: null,
    marketSegmentName: "Pasar spa relaksasi dan natural hot spring Anyer",
    marketSharePercentage: null,
    marketRank: "Belum ada data (satu-satunya natural hot spring di Anyer)",
    pricePositioningIndex: null,
    pricePositioningCategory: null,
    benchmarkCompetitors: [],
    menuPriceItems: [DSPA_OFFICIAL_PROMO_ITEM],
    digitalMarketingStrategy: {
      pricingOptimization: {
        title: "Hot Spring Aquamedic untuk tamu dan wisatawan luar",
        currentAnalysis: "Hot Spring Aquamedic adalah satu-satunya natural hot spring di Anyer (situs resmi) dan sudah dijual sebagai produk D'Spa: promo Buy 1 Get 1 Rp 350.000 dan paket pijat tradisional 120 menit yang termasuk berendam. Harga spa kompetitor belum ada yang bersumber, jadi indeks harga belum dihitung.",
        recommendation: "Uji paket untuk wisatawan yang tidak menginap, misalnya Hot Spring Aquamedic dan pijat tradisional, dengan harga dari daftar resmi D'Spa.",
      },
      sentimentLeverage: {
        title: "Satu-satunya natural hot spring di Anyer",
        positiveDrivers: [
          "Satu-satunya resor di Anyer dengan pemandian air panas alami (situs resmi)",
          "Kolam Hot Spring Aquamedic berundak di bawah pendopo beratap ijuk, di tengah taman tropis (situs resmi)",
          "Paket pijat tradisional 120 menit termasuk berendam di Hot Spring Aquamedic (situs resmi)",
        ],
        negativeFriction: [],
        marketingAngle: "Konten Reels: natural hot spring satu-satunya di Anyer, Hot Spring Aquamedic di D'Spa (situs resmi).",
      },
      competitorCounterPromo: {
        title: "Diferensiasi dari spa hotel pembanding",
        competitorAction: "Pembanding spa di daftar kompetitor: Daiva Spa Novus Jiva, Bliss Spa Mövenpick Resort Carita, Alta Spa Marbella Anyer, Spa & Wellness Aston Anyer, dan Belia Spa and Reflexy Cilegon.",
        ourCounterStrategy: "Tonjolkan yang tercantum di situs resmi Sanghyang: berendam di natural hot spring lalu pijat tradisional dalam satu paket D'Spa.",
      },
      promoFormulation: {
        promoName: "Hot Spring Aquamedic & Pijat Tradisional",
        headline: "Berendam di natural hot spring satu-satunya di Anyer, lalu pijat tradisional",
        discountStructure: "Usulan: promosikan paket resmi Hot Spring with Traditional Massage (120 menit) apa adanya; potongan tambahan ditetapkan manajemen.",
        targetAudience: "Tamu menginap dan wisatawan yang mencari relaksasi",
        terms: "Penawaran resmi saat ini di situs: diskon 30% Hotspring Spa dan Buy 1 Get 1 Aquamedic Rp 350.000.",
        crossSellingOutlet: "Usulan: tamu D'Spa diberi informasi makan malam di Sunset Grill.",
      },
      financialProjection: NO_PROJECTION,
    },
  },
};

export const ALL_OUTLETS_MARKET_SHARE_DATA: OutletMarketShareData = {
  outletKey: "all",
  outletName: "Konsolidasi Seluruh Outlet Sanghyang",
  activeMonth: NO_REVENUE_LABEL,
  revenueActual: null,
  totalMarketSizeEstimated: null,
  marketSegmentName: "Pasar kamar resort bintang 4–5 Anyer–Carita (outlet F&B belum dihitung)",
  marketSharePercentage: null,
  marketRank: "Belum ada data (hanya pasar kamar resort yang bisa dihitung; lihat Kamar & Resort)",
  pricePositioningIndex: null,
  pricePositioningCategory: null,
  // Diisi summary API: gabungan pembanding semua outlet dari registri pesaing.
  benchmarkCompetitors: [],
  menuPriceItems: [
    ...officialMenuComparisons("sunset-grill").map((item) => ({ ...item, itemName: `Sunset Grill: ${item.itemName}` })),
    ...officialMenuComparisons("dbistro").map((item) => ({ ...item, itemName: `D'Bistro: ${item.itemName}` })),
    { ...DSPA_OFFICIAL_PROMO_ITEM, itemName: `D'Spa: ${DSPA_OFFICIAL_PROMO_ITEM.itemName}` },
  ],
  digitalMarketingStrategy: {
    pricingOptimization: {
      title: "Belanja tamu lintas outlet",
      currentAnalysis: "Belanja tamu per kunjungan dan perpindahan tamu antar outlet belum tercatat di data yang ada, jadi besarnya belum bisa diukur.",
      recommendation: "Catat outlet asal dan tujuan setiap voucher atau paket lintas outlet di kasir, supaya dampaknya bisa diukur sebelum promo diperluas.",
    },
    sentimentLeverage: {
      title: "Satu resort dengan banyak pengalaman",
      positiveDrivers: [
        "Kamar, Sunset Grill, D'Bistro, Dragon Beach Club, D'Bar, dan D'Spa ada dalam satu resort (situs resmi)",
        "Satu-satunya resor di Anyer dengan pemandian air panas alami, Hot Spring Aquamedic (situs resmi)",
      ],
      negativeFriction: [],
      marketingAngle: "Menginap, makan seafood di tepi dermaga, malam di beach club, dan berendam di air panas alami dalam satu resort (situs resmi).",
    },
    competitorCounterPromo: {
      title: "Menanggapi promo kompetitor",
      competitorAction: "Promo kompetitor per outlet tampil di Langkah 4 dan di halaman Omset, Target dan Strategy.",
      ourCounterStrategy: "Jawab dengan paket nilai tambah lintas outlet; harga kamar tidak dipotong di bawah lantai pasar bintang 4 (lihat Kamar & Resort).",
    },
    promoFormulation: {
      promoName: "Paket lintas outlet Sanghyang",
      headline: "Menginap, makan, hiburan, dan hot spring dalam satu resort",
      discountStructure: "Usulan paket kamar, makan malam Sunset Grill, Dragon Beach Club, dan Hot Spring Aquamedic. Potongan hanya untuk komponen kuliner, hiburan, dan spa, besarnya ditetapkan manajemen; harga kamar tetap mengikuti lantai pasar bintang 4.",
      targetAudience: "Tamu menginap dan rombongan",
      terms: "Pemesanan lewat situs resmi atau front office.",
      crossSellingOutlet: "Menghubungkan keenam outlet Sanghyang.",
    },
    financialProjection: NO_PROJECTION,
  },
};

export function getOutletMarketShare(outletKey: string): OutletMarketShareData {
  if (outletKey === "all") return ALL_OUTLETS_MARKET_SHARE_DATA;
  const data = OUTLET_MARKET_SHARE_DATA[outletKey];
  if (!data) throw new Error(`Outlet "${outletKey}" tidak dikenal di OUTLET_MARKET_SHARE_DATA`);
  return data;
}
