import { generateWithRetry } from "../gemini";
import { humanizeDeep } from "../humanize-text";
import { DISPROVEN_FACILITY_CLAIM } from "./resort-strategy";

export type ContentDraftInput = {
  competitorName: string;
  promoTitle: string;
  promoCategory: string;
  counterStrategy: string;
  outletName?: string;
  /** Judul draf sebelumnya untuk promo yang sama; tiap klik Draf Konten meminta versi baru yang berbeda. */
  previousHeadlines?: string[];
};

export type SocialDraftReels = {
  format: "reels";
  headline: string;
  hook3Sec: string;
  visualDirection: string;
  caption: string;
  audioRecommendation: string;
  callToAction: string;
  hashtags: string[];
};

export type SocialDraftTikTok = {
  format: "tiktok";
  headline: string;
  hookPOV: string;
  storyline: string[];
  caption: string;
  soundTrend: string;
  callToAction: string;
  hashtags: string[];
};

export type SocialDraftCarousel = {
  format: "carousel";
  headline: string;
  slides: Array<{
    slideNo: number;
    title: string;
    description: string;
    visualNote: string;
  }>;
  caption: string;
  promoOffer: string;
  hashtags: string[];
};

export type GeneratedContentDraftBundle = {
  competitorContext: {
    competitorName: string;
    promoTitle: string;
    counterStrategy: string;
  };
  generatedAt: string;
  reels: SocialDraftReels;
  tiktok: SocialDraftTikTok;
  carousel: SocialDraftCarousel;
};

/**
 * Kata yang merusak posisi harga bintang 4, membocorkan istilah strategi internal ke konten publik,
 * atau menyebut klaim fasilitas yang tidak didukung situs resmi Sanghyang.
 */
const OFF_POSITIONING = new RegExp(`termurah|paling murah|harga miring|boncos|lantai pasar|harga bersih|paritas|fase [12]|${DISPROVEN_FACILITY_CLAIM.source}`, "i");

export const violatesPricePositioning = (draft: unknown) => OFF_POSITIONING.test(JSON.stringify(draft));

export function createFallbackContentDraft(input: ContentDraftInput): GeneratedContentDraftBundle {
  const outlet = input.outletName || "Sanghyang Indah Spa Resort";
  return {
    competitorContext: {
      competitorName: input.competitorName,
      promoTitle: input.promoTitle,
      counterStrategy: input.counterStrategy,
    },
    generatedAt: new Date().toISOString(),
    reels: {
      format: "reels",
      headline: `Satu-satunya Natural Hot Spring di Anyer: Hot Spring Aquamedic di ${outlet}`,
      hook3Sec: "Tahu gak kalau di Anyer ada resort tepi pantai yang punya natural hot spring sendiri?",
      visualDirection:
        "Buka video dari teras kamar menuju dermaga saat sunset, lanjut ke kolam Hot Spring Aquamedic di bawah paviliun beratap ilalang.",
      caption: `Liburan yang benar-benar bikin pulih di tepi pantai Anyer 🌊✨\n\nDi ${outlet}, kamu bisa menikmati taman tropis yang rindang, sunset Selat Sunda dari dermaga, plus berendam di Hot Spring Aquamedic, satu-satunya natural hot spring di Anyer.\n\nTag orang tersayangmu yang butuh healing akhir pekan ini! 👇`,
      audioRecommendation: "Trending Acoustic Chill / Warm Sunset Surf Vibes",
      callToAction: "Kirim DM 'STAY' untuk info paket menginap & penawaran Hot Spring Aquamedic!",
      hashtags: ["#SanghyangResort", "#AnyerBeach", "#ExploreBanten", "#WisataAnyer", "#StaycationAnyer"],
    },
    tiktok: {
      format: "tiktok",
      headline: "POV: Liburan Anti-Mainstream di Anyer",
      hookPOV: "POV: Kamu nemu resort tepi pantai di Anyer yang punya natural hot spring sendiri...",
      storyline: [
        "Detik 0-3: POV membuka pintu kamar dengan pemandangan taman dan pohon kelapa.",
        "Detik 4-10: Menunjukkan suasana santai di beanbag Dragon Beach Club & aroma seafood bakar Sunset Grill.",
        "Detik 11-20: Momen sore berendam di Hot Spring Aquamedic yang bikin badan rileks.",
      ],
      caption: `Gak nyangka nemu tempat se-cozy ini di Anyer! Suasananya tenang, sunsetnya cantik dari dermaga, dan ada natural hot spring satu-satunya di Anyer! 🏝️🧖‍♀️\n\nYuk agendakan bareng bestie kamu!`,
      soundTrend: "Original Sound POV / Lo-fi Chill Surf Trip",
      callToAction: "Cek link di bio kami buat amankan kamar favoritmu!",
      hashtags: ["#TikTokTravel", "#HiddenGemAnyer", "#HealingAnyer", "#InfoAnyer", "#RekomendasiHotel"],
    },
    carousel: {
      format: "carousel",
      headline: "5 Alasan Kenapa Kamu Harus Liburan ke Sanghyang",
      slides: [
        {
          slideNo: 1,
          title: "Bosan Sama Hotel yang Gitu-Gitu Aja?",
          description: "Temukan resort pantai luas dengan alam asri di Anyer.",
          visualNote: "Foto aerial panorama pantai Sanghyang saat golden hour.",
        },
        {
          slideNo: 2,
          title: "Aktivitas Pantai dalam Satu Resort",
          description: "Water sports, voli pantai, dan sunset dari dermaga.",
          visualNote: "Foto keluarga bermain voli pantai atau water sports.",
        },
        {
          slideNo: 3,
          title: "Satu-satunya Natural Hot Spring di Anyer",
          description: "Kolam Hot Spring Aquamedic di bawah paviliun beratap ilalang, dikelilingi taman tropis.",
          visualNote: "Kolam Aquamedic berundak dengan pancuran gentong tanah liat.",
        },
        {
          slideNo: 4,
          title: "Sunset Grill & Dragon Beach Club",
          description: "Seafood dan grill segar di tepi dermaga, lanjut beach club dua lantai.",
          visualNote: "Platter seafood bakar lezat dengan latar matahari tenggelam.",
        },
        {
          slideNo: 5,
          title: "Penawaran D'Spa",
          description: "Hubungi kami untuk penawaran Hot Spring Aquamedic dan paket pijat tradisional yang sedang berlaku.",
          visualNote: "Grafis paket menginap dengan kontak WhatsApp resmi.",
        },
      ],
      caption: `Mau liburan yang benar-benar rileks tanpa ribet? 🌴\n\nGeser ke kiri untuk lihat 5 keunggulan unik Sanghyang Indah Spa Resort yang gak bakal kamu temukan di hotel lain di Anyer!\n\nHubungi kontak kami sekarang sebelum kamar penuh! 📞`,
      promoOffer: "Paket Menginap + Voucher Hot Spring Aquamedic + Voucher F&B Sunset Grill",
      hashtags: ["#SanghyangIndahSpaResort", "#HotelAnyer", "#PantaiAnyer", "#LiburanKeluarga", "#WeekendGetaway"],
    },
  };
}

/**
 * Menghasilkan 3 draf konten media sosial berkualitas tinggi (Reels, TikTok, Carousel)
 * menggunakan model Gemini AI yang terintegrasi dengan data intelijen kompetitor.
 */
export async function generateSocialContentDrafts(
  input: ContentDraftInput,
  deps: { generate?: (prompt: string) => Promise<string> } = {},
): Promise<GeneratedContentDraftBundle> {
  // Template hanya pengganti draf yang melanggar posisi harga. Galat AI (kuota, kunci kosong, graf gagal dibangun, jawaban
  // rusak) dilempar ke route supaya staf melihat alasannya; dulu galat diganti template yang sama di setiap klik.
  const fallback = createFallbackContentDraft(input);
  const generate = deps.generate ?? (async (prompt: string) => (await generateWithRetry({ contents: prompt })).text);
  const previous = (input.previousHeadlines ?? []).filter((h) => h.trim().length > 0);

  const prompt = `Kamu adalah Creative Social Media Director profesional untuk Sanghyang Indah Spa Resort Anyer (resort tepi pantai dengan 7 tipe kamar, suite, dan villa; Sunset Grill di tepi dermaga; Dragon Beach Club; D'Spa yang memiliki Hot Spring Aquamedic, satu-satunya natural hot spring di Anyer, buka 09.00–22.00).
    
Tugasmu adalah membuat STRATEGI BALASAN KONTEN MEDIA SOSIAL (Instagram Reels, TikTok POV, dan Instagram Carousel) untuk mengimbangi promo kompetitor berikut:

<KOMPETITOR>
Nama Kompetitor: ${input.competitorName}
Judul Promo/Event: ${input.promoTitle}
Kategori: ${input.promoCategory}
</KOMPETITOR>

<TAKTIK_BALASAN_SANGHYANG>
Rekomendasi Taktis: ${input.counterStrategy}
Outlet Terkait: ${input.outletName || "Sanghyang Indah Spa Resort"}
</TAKTIK_BALASAN_SANGHYANG>
${previous.length ? `\n<DRAF_SEBELUMNYA>\nJudul draf sebelumnya untuk promo yang sama: ${JSON.stringify(previous)}\nBuat versi baru: sudut cerita, hook, judul, dan caption harus berbeda dari draf sebelumnya.\n</DRAF_SEBELUMNYA>\n` : ""}
<GAYA_TULISAN>
Tulis seperti admin media sosial manusia: tanpa em dash (—), tanpa pujian kosong, dan tanpa menyebut nama mesin AI.
</GAYA_TULISAN>

<ATURAN_POSISI_HARGA_WAJIB>
- Sanghyang adalah resort bintang 4 yang menjual nilai (natural hot spring satu-satunya di Anyer, taman tropis, sunset di dermaga), bukan hotel murah.
- Jangan menulis "termurah", "paling murah", "harga miring", "anti boncos", atau membandingkan harga dengan kompetitor.
- Jangan menjanjikan potongan harga kamar. Penawaran berupa nilai tambah: voucher Hot Spring Aquamedic, sesi D'Spa, sarapan, voucher F&B.
- Sebut hot spring sebagai "Hot Spring Aquamedic" atau "natural hot spring". Jangan menyebutnya "onsen", "belerang", atau "vulkanik", dan jangan menyebut suhu air, akses "24 jam", gratis untuk tamu menginap, "pasir putih", atau kolam renang di Dragon Beach Club, karena tidak tercantum di situs resmi.
- Taktik balasan di atas adalah arahan internal: jangan menyalinnya mentah dan jangan menyebut istilah "lantai pasar", "harga bersih", "paritas", atau "Fase".
- Jangan mengarang harga, tanggal, atau fasilitas di luar data di atas.
</ATURAN_POSISI_HARGA_WAJIB>

Instruksi:
Keluarkan HANYA JSON valid (tanpa markdown pembuka/penutup) dengan struktur:
{
  "reels": {
    "format": "reels",
    "headline": "string",
    "hook3Sec": "string",
    "visualDirection": "string",
    "caption": "string",
    "audioRecommendation": "string",
    "callToAction": "string",
    "hashtags": ["string"]
  },
  "tiktok": {
    "format": "tiktok",
    "headline": "string",
    "hookPOV": "string",
    "storyline": ["string"],
    "caption": "string",
    "soundTrend": "string",
    "callToAction": "string",
    "hashtags": ["string"]
  },
  "carousel": {
    "format": "carousel",
    "headline": "string",
    "slides": [
      {
        "slideNo": 1,
        "title": "string",
        "description": "string",
        "visualNote": "string"
      }
    ],
    "caption": "string",
    "promoOffer": "string",
    "hashtags": ["string"]
  }
}`;

  const text = (await generate(prompt)).trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("jawaban AI tidak terbaca sebagai draf konten");

  const parsed = humanizeDeep(JSON.parse(jsonMatch[0]) as Partial<GeneratedContentDraftBundle>);
  // Keluaran LLM tidak dipercaya begitu saja: draf yang melanggar posisi harga diganti template yang patuh.
  const compliant = <T,>(draft: T | undefined, backup: T, format: string): T => {
    if (!draft) return backup;
    if (!violatesPricePositioning(draft)) return draft;
    console.warn(`[ai-content-generator] Draf ${format} dari Gemini melanggar posisi harga, memakai template.`);
    return backup;
  };

  return {
    competitorContext: {
      competitorName: input.competitorName,
      promoTitle: input.promoTitle,
      counterStrategy: input.counterStrategy,
    },
    generatedAt: new Date().toISOString(),
    reels: compliant(parsed.reels, fallback.reels, "reels"),
    tiktok: compliant(parsed.tiktok, fallback.tiktok, "tiktok"),
    carousel: compliant(parsed.carousel, fallback.carousel, "carousel"),
  };
}


