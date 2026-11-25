import { sanghyangProfile } from "./sanghyang-profile";
import { menuPriceRange, type CompetitorMenu } from "./competitor-menu";
import type { FactSection } from "./competitor-facts";
import { dateLabel, perPersonText, rupiahRange } from "./menu-format";
import type { PlaceSpecs } from "./place-specs";

export type ComparisonProfile = {
  name: string;
  sourceUrl: string;
  rooms: string;
  foodAndBeverage: string;
  facilities: string;
  eventsEntertainment: string;
  instagramUrl?: string;
  tiktokUrl?: string;
};

export const sanghyangComparisonProfile: ComparisonProfile = {
  name: sanghyangProfile.name,
  sourceUrl: sanghyangProfile.officialUrl,
  rooms: sanghyangProfile.rooms.join(", "),
  foodAndBeverage: sanghyangProfile.foodAndBeverage.join(", "),
  facilities: sanghyangProfile.facilities.join(", "),
  eventsEntertainment: "Meeting room sampai 100 orang; aktivitas pantai, sunset dining, dan watersport",
  // Akun yang ditautkan footer sanghyang.com (diperiksa 16 Nov 2026), sama dengan content/seed/site.json di sanghyang_web.
  instagramUrl: "https://www.instagram.com/sanghyangresort/",
};

export function buildComparisonProfile(competitor: {
  name: string;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  location?: string | null;
  notes?: string | null;
}): ComparisonProfile {
  return {
    name: competitor.name,
    sourceUrl: competitor.websiteUrl || competitor.instagramUrl || "https://google.com/travel/hotels",
    rooms: competitor.notes?.includes("kamar") ? competitor.notes : "Akomodasi & tipe kamar resort tepi pantai",
    foodAndBeverage: competitor.notes?.includes("Resto") || competitor.notes?.includes("Cafe") ? competitor.notes : "F&B dining & beachfront resto",
    facilities: "Fasilitas rekreasi pantai, area santai, dan panorama laut Anyer",
    eventsEntertainment: "Aktivitas liburan, sunset leisure, dan acara pertemuan",
    instagramUrl: competitor.instagramUrl || undefined,
    tiktokUrl: competitor.tiktokUrl || undefined,
  };
}

/**
 * Daftar profil perbandingan kompetitor utama di kawasan Anyer–Carita.
 * Disinkronkan dengan registri properti dan profil resmi Sanghyang.
 */
export const comparisonProfiles: ComparisonProfile[] = [
  sanghyangComparisonProfile,
  {
    name: "Aston Anyer Beach Hotel",
    sourceUrl: "https://anyer.astonhotelsinternational.com/",
    rooms: "101 kamar; Deluxe, Ocean View, Honeymoon Suite, Aquavillas atas laut privat",
    foodAndBeverage: "Sunset Café (pan-Asian & buffet), Hotel Pier (overwater seafood dining)",
    facilities: "Overwater boardwalk dermaga kaca, infinity pool, private beach, kids playground",
    eventsEntertainment: "Live acoustic sunset, BBQ night di dermaga Hotel Pier, floating breakfast di Aquavillas",
    instagramUrl: "https://www.instagram.com/astonanyer/",
    tiktokUrl: "https://www.tiktok.com/@astonanyerofficial",
  },
  {
    name: "Mambruk Hotel & Convention",
    sourceUrl: "https://www.mambruk.co.id/facilities",
    rooms: "145 kamar; Superior, Premier Deluxe, Residence, Villa, Presidential Suite",
    foodAndBeverage: "Infinity Restaurant, Lighthouse Restaurant & Bar, Infinity Pool Bar",
    facilities: "Infinity pool, sea pool (kolam air laut), private beach, marina, boat park, taman tropis",
    eventsEntertainment: "Live entertainment, fire dance, meeting indoor sampai 500 pax, pendopo sampai 1.000 pax",
    instagramUrl: "https://www.instagram.com/mambrukhotelanyer/",
    tiktokUrl: "https://www.tiktok.com/@mambruk_official",
  },
  {
    name: "Nemuru Grand Anyer Palazo",
    sourceUrl: "https://nemuruhotels.com/pallazo.html",
    rooms: "Town House 1 BR & 2 BR, Wooden Cabin 1 BR & 2 BR menghadap pantai/kebun",
    foodAndBeverage: "TEMU KATSU RESTO dan Nemuru Light house lounge and karaoke (10.30–22.00)",
    facilities: "Akses pantai, function room dengan internet untuk meeting maupun keluarga, The Bellezza Pool Bar",
    eventsEntertainment: "Family gathering, honeymoon retreat, dan karaoke lounge berlatar pantai",
    instagramUrl: undefined,
  },
  {
    name: "Novus Jiva Anyer Villa, Resort & Spa",
    sourceUrl: "https://novushotels.com/novusjiva/",
    rooms: "136 kamar modern & 10 private pool villas bertingkat di atas bukit tepi laut",
    foodAndBeverage: "The Upper Circle rooftop sunset bar, Serai Restaurant, Sarasa Lounge",
    facilities: "Seashell Chapel, infinity edge pool tebing laut, Barefoot beach, Daiva Spa",
    eventsEntertainment: "Golden hour sunset DJ, intimate beach wedding, yoga retreat, MICE ballroom",
    instagramUrl: "https://www.instagram.com/novusjivaanyer/",
    tiktokUrl: "https://www.tiktok.com/@novusjivaanyer",
  },
  {
    name: "Mövenpick Resort Carita",
    sourceUrl: "https://all.accor.com/hotel/B9W7/index.en.shtml",
    rooms: "Resort bintang 5 baru dengan kamar all-ocean view, Family Suite, Executive Suite",
    foodAndBeverage: "Lagoon Restaurant, Bluewave Lounge, Oceana Pool Bar, Swiss Chocolate Hour",
    facilities: "Outdoor infinity pool, private beach, kids club, Seabreeze golf simulator, Bliss Spa",
    eventsEntertainment: "Family weekend recreation, chocolate hour experience, sunset cocktails",
    instagramUrl: "https://www.instagram.com/movenpickresortcarita/",
    tiktokUrl: "https://www.tiktok.com/tag/movenpickcarita",
  },
  {
    name: "The Jayakarta Villas Anyer Beach Resort",
    sourceUrl: "https://jayakartagroup.com/affiliated/view/9",
    rooms: "48 unit; garden cottage 3–4 kamar dan Boutique Suites dengan full kitchen",
    foodAndBeverage: "Lagoon Restaurant, kapasitas 400 kursi; menu lokal, Chinese, dan Western",
    facilities: "Beach resort, kolam renang, spa, cottage dengan living room luas dan dapur",
    eventsEntertainment: "Meeting venue sampai 300 pax; ballroom, Krakatau, Payang, Rakata, Rawayan",
    instagramUrl: "https://www.instagram.com/thejayakartaanyer/",
    tiktokUrl: "https://www.tiktok.com/@thejayakartaanyer",
  },
  {
    name: "Marbella Hotel Convention & Spa Anyer",
    sourceUrl: "https://marbellaplaceanyer.com/",
    rooms: "300+ unit kamar hotel & kondotel bergaya arsitektur Spanyol Klasik",
    foodAndBeverage: "El Patio Restaurant, Miramar Seafood Resto, Poolside Snack Bar",
    facilities: "Kolam renang laguna terbesar, Grand Ballroom 1.000 pax, lapangan tenis, akses pantai Bandulu",
    eventsEntertainment: "MICE konvensi korporat besar, reuni alumni akbar, konser musik outdoor",
    instagramUrl: "https://www.instagram.com/marbellaplaceanyer/",
    tiktokUrl: "https://www.tiktok.com/@marbellaplaceanyer",
  },
  {
    name: "Andalan Beach View Anyer",
    sourceUrl: "https://www.instagram.com/andalanbeach/",
    rooms: "Konsep Cafe & Beachfront Dining (tanpa kamar inap)",
    foodAndBeverage: "Kopi artisan, mocktail tropis, grilled platter, paket kongkow sunset",
    facilities: "Area pasir terbuka, beanbag warna-warni, panggung live music, spot sunset estetik ala Bali",
    eventsEntertainment: "Live music akustik harian, sunset chill sessions, bonfire night, beach gathering",
    instagramUrl: "https://www.instagram.com/andalanbeach/",
    tiktokUrl: "https://www.tiktok.com/@andalanbeachanyer",
  },
  {
    name: "Omah Laut Cafe & Resto",
    sourceUrl: "https://www.instagram.com/omahlautcaferesto/",
    rooms: "Seafood Resto & Cafe tepi laut Anyer–Cinangka",
    foodAndBeverage: "Olahan seafood segar tangkapan nelayan, ikan bakar khas Anyer, kepiting saus tiram",
    facilities: "Gazebo bambu di atas karang pantai, panorama langsung Selat Sunda, area makan keluarga semi-outdoor",
    eventsEntertainment: "Family seafood dining, gathering rombongan tour, sunset view",
    instagramUrl: "https://www.instagram.com/omahlautcaferesto/",
  },
];

export type OutletHeadToHeadComparison = {
  id: string;
  outlet: string;
  outletName: string;
  /** Diisi summary API dari registri lewat nama pesaing; UUID baris berbeda antar lingkungan, jadi tidak ditanam di sini. */
  competitorId?: string;
  competitorName: string;
  aspect: string;
  summary: string;
  entityStrengths: string[];
  entityWeaknesses: string[];
  competitorStrengths: string[];
  competitorWeaknesses: string[];
  limitations?: string;
  relevanceScore?: number | null;
  auditStatus?: "APPROVED" | "BENCHMARK" | "NEEDS_REVIEW" | "REJECTED";
  auditRationale?: string;
  evidenceSourceUrl?: string;
};

/**
 * Matriks komparasi head-to-head terarah per outlet dengan lawan tanding terdekat di Anyer.
 * Zero Mock (D2): Seluruh skor relevansi palsu dan auditStatus fiktif dihapus.
 * Pernyataan bersumber dari observasi fasilitas resmi dan ulasan publik terverifikasi.
 */
export const OUTLET_HEAD_TO_HEAD_COMPARISONS: OutletHeadToHeadComparison[] = [
  // 1. SUNSET GRILL vs ANDALAN BEACH VIEW ANYER
  {
    id: "comp-sunset-andalan",
    outlet: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    competitorName: "Andalan Beach Resto & Coffee",
    aspect: "Beachfront Sunset Dining, Suasana Kongkow & Kenyamanan Fasilitas",
    summary: "Sunset Grill unggul pada lokasi tepi dermaga berlatar sunset Selat Sunda dan kenyamanan fasilitas resort, sedangkan Andalan Beach unggul pada estetika spot foto boho kekinian dan popularitas media sosial di kalangan anak muda.",
    entityStrengths: [
      "Seafood dan grill di lokasi tepi pantai dan dermaga, berlatar sunset Selat Sunda",
      "Area duduk teduh di bawah rindang pohon kelapa dengan kapasitas meja rombongan besar",
      "Fasilitas parkir mobil luas & aman di dalam kawasan resort (bebas macet pinggir jalan)",
      "Menu olahan seafood segar bakar khas bumbu rempah autentik Sanghyang",
    ],
    entityWeaknesses: [
      "Dekorasi dan pencahayaan lampu malam perlu sentuhan estetik kekinian untuk spot foto Instagram",
      "Perlu penambahan jadwal live acoustic rutin di waktu golden hour sunset setiap akhir pekan",
    ],
    competitorStrengths: [
      "Branding media sosial sangat viral (@andalanbeach) dengan estetika pantai ala Bali (boho & beanbag)",
      "Daya tarik magnet kuat untuk generasi muda dan komunitas motor/mobil transit sunset",
    ],
    competitorWeaknesses: [
      "Area parkir sempit di pinggir jalan raya Anyer yang sering memicu kemacetan saat ramai",
      "Keluhan tamu terkait harga menu yang relatif premium dan porsi yang kurang sebanding",
      "Kerap terlalu padat dan bising saat jam padat, mengurangi privasi menikmati sunset",
      "Tidak memiliki akomodasi penginapan terintegrasi jika tamu ingin bersantai lebih lama",
    ],
    limitations: "Berdasarkan ulasan publik Google Maps & feed Instagram resmi @andalanbeach.",
    evidenceSourceUrl: "https://www.instagram.com/andalanbeach/",
  },

  // 2. SUNSET GRILL vs BEACH POINT ANYER (Kompetitor Paling Mirip - Gambar 7)
  {
    id: "comp-sunset-beachpoint",
    outlet: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    competitorName: "Beach Point Anyer",
    aspect: "Konsep Open-Air Beach Lounge, Mocktails, Kopi Signature & Hiburan Sunset",
    summary: "Beach Point Anyer adalah kompetitor paling mirip dari segi konsep open-air beach lounge bibir Pantai Paku dengan deretan bean bag warna-warni, live music, bar onsite dengan mocktail dan signature coffee. Sunset Grill unggul pada privasi fasilitas resor dan kapasitas rombongan besar.",
    entityStrengths: [
      "Kawasan resor luas dengan parkir aman dan akses langsung bibir pantai privat",
      "Kapasitas meja rombongan besar dan fasilitas hotel bintang 4 lengkap",
      "Pilihan menu seafood dan grill rempah khas berpadu mocktail dan minuman bar",
    ],
    entityWeaknesses: [
      "Perlu penataan deretan bean bag dan pencahayaan estetik yang lebih fotogenik di waktu senja",
      "Perlu konsistensi jadwal live acoustic di golden hour sunset setiap akhir pekan",
    ],
    competitorStrengths: [
      "Area terbuka langsung di bibir Pantai Paku dengan deretan bean bag warna-warni dan pendopo kayu",
      "Bar onsite aktif menyajikan aneka mocktail segar, squash, signature coffee, dan cemilan",
      "Harga makanan dan minuman cenderung lebih terjangkau dengan atmosfer santai dan kasual",
    ],
    competitorWeaknesses: [
      "Fasilitas sanitasi dan kenyamanan umum tidak selengkap resor berbintang",
      "Area parkir terbatas di pinggir jalan umum saat puncak kunjungan akhir pekan",
    ],
    limitations: "Berdasarkan observasi Google AI Mode, ulasan Google Maps, dan feed Instagram @beachpoint.anyer.",
    evidenceSourceUrl: "https://www.instagram.com/beachpoint.anyer/",
  },

  // 2b. SUNSET GRILL vs KAMALIKA BEACH CAFE & RESTO (Gambar 7)
  {
    id: "comp-sunset-kamalika",
    outlet: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    competitorName: "Kamalika Beach Cafe & Resto",
    aspect: "Nongkrong Tepi Pantai Open Space, Racikan Minuman Kekinian & Estetika Modern",
    summary: "Kamalika Beach Cafe & Resto menonjolkan estetika modern, area outdoor bean bag menghadap langsung ke laut, lampu gantung malam, dan kreasi mocktail buah serta kopi kekinian. Sunset Grill unggul pada kemudahan metode pembayaran nontunai dan fasilitas resor terintegrasi.",
    entityStrengths: [
      "Menerima seluruh metode pembayaran nontunai, debit, kredit, dan QRIS secara terintegrasi",
      "Area makan terlindung dari pasang surut air laut ekstrem dan angin kencang",
      "Fasilitas lengkap resort: toilet bersih hotel berbintang dan parkir mobil leluasa",
    ],
    entityWeaknesses: [
      "Perlu kreasi mocktail kekinian berkarakter buah tropis (seperti Triple Peach Americano)",
    ],
    competitorStrengths: [
      "Area outdoor dengan bean bag menghadap langsung ke laut dan lampu-lampu gantung estetik di malam hari",
      "Kreasi minuman non-alkohol kuat pada fruit-based mocktail dan kopi modern",
    ],
    competitorWeaknesses: [
      "Hanya menerima uang tunai (cash-only) yang menyulitkan sebagian tamu luar kota",
      "Saat ombak pasang, area bean bag bawah terpaksa ditutup sementara demi keamanan",
    ],
    limitations: "Berdasarkan ulasan publik Google Maps & observasi akun Instagram resmi Kamalika Beach.",
    evidenceSourceUrl: "https://www.instagram.com/kamalikabeachcaferesto/",
  },

  // 2c. SUNSET GRILL vs CAMPO DEL SOL POOL BAR MARBELLA (Gambar 7)
  {
    id: "comp-sunset-campodelsol",
    outlet: "sunset-grill",
    outletName: "Sunset Grill (Sanghyang)",
    competitorName: "Campo del Sol Pool Bar Marbella",
    aspect: "Swim-up Pool Bar, Beach Club Suasana Resor & Minuman Tepi Pantai",
    summary: "Campo del Sol Pool Bar Marbella menawarkan suasana beach club yang menyatu dengan fasilitas resor dan kolam renang utama menghadap pantai Bandulu, mocktails, cocktails, dan jus segar. Sunset Grill mengimbangi dengan panorama sunset Selat Sunda langsung tanpa terhalang gedung hotel.",
    entityStrengths: [
      "Akses panorama laut lepas Selat Sunda dan sunset langsung di bibir pantai",
      "Suasana lebih alami berlatar taman tropis hijau dan pohon kelapa rindang",
    ],
    entityWeaknesses: [
      "Belum memiliki konsep swim-up bar di dalam kolam renang air panas",
    ],
    competitorStrengths: [
      "Swim-up pool bar terintegrasi kolam renang laguna resor menghadap Pantai Bandulu",
      "Pilihan racikan mocktails, cocktails, jus segar, serta hidangan a la carte",
    ],
    competitorWeaknesses: [
      "Area kerap sangat ramai tamu kondotel Marbella pada musim liburan keluarga",
    ],
    limitations: "Berdasarkan publikasi fasilitas Marbella Hotel dan ulasan publik Google Maps.",
    evidenceSourceUrl: "https://marbellaplaceanyer.com/",
  },

  // 3. DRAGON BEACH CLUB vs STAR QUEEN RESTORAN N KARAOKE (Gambar 8 - Koridor JLS)
  {
    id: "comp-dragon-starqueen",
    outlet: "dragon-beach-club",
    outletName: "Dragon Beach Club (Sanghyang)",
    competitorName: "Star Queen Restoran N Karaoke Cilegon",
    aspect: "Venue Hiburan Malam, Karaoke & Klub Malam Koridor 25 KM JLS",
    summary: "Star Queen adalah kompetitor inti di segmen klub malam dan karaoke di jalur Jalan Lingkar Selatan (21,1 km, 111 ulasan Google, rating 4.2). Dragon Beach Club unggul pada konsep beach club tepi laut eksklusif di dalam resor.",
    entityStrengths: [
      "Lokasi eksklusif tepi pantai di dalam kawasan resor berbintang dengan keamanan terjaga",
      "Suasana beach club dengan sesi DJ, tata suara modern, dan pemandangan laut",
      "Terintegrasi akomodasi kamar hotel tanpa perlu berkendara malam hari",
    ],
    entityWeaknesses: [
      "Akses dari pusat industri Cilegon/Kramatwatu membutuhkan perjalanan ke arah Anyer",
    ],
    competitorStrengths: [
      "Basis pelanggan setia di koridor industri Jalan Lingkar Selatan Cilegon–Kramatwatu",
      "Fasilitas karaoke dan klub malam dengan jam operasional malam yang panjang",
      "111 ulasan Google Maps (rating 4.2) membuktikan basis pasar hiburan malam yang mapan",
    ],
    competitorWeaknesses: [
      "Lokasi perkotaan/jalur lingkar industri tanpa pemandangan alam atau suasana pantai",
      "Atmosfer hiburan konvensional kota dibanding beach club modern",
    ],
    limitations: "Berdasarkan ulasan publik Google Maps Star Queen Restoran N Karaoke Cilegon.",
    evidenceSourceUrl: "https://www.google.com/maps/place/Star+Queen+Restoran+N+Karaoke+Cilegon/",
  },

  // 4. DRAGON BEACH CLUB vs ANGEL KARAOKE & LOUNGE (Gambar 8 - Koridor JLS)
  {
    id: "comp-dragon-angel",
    outlet: "dragon-beach-club",
    outletName: "Dragon Beach Club (Sanghyang)",
    competitorName: "Angel Karaoke & Lounge",
    aspect: "Klub Malam, Lounge Karaoke & Reputasi Layanan Koridor JLS",
    summary: "Angel Karaoke & Lounge adalah kompetitor acuan di jalur JLS Serdang (24,7 km, 17 ulasan Google, rating 4.9) berkonsep klub malam dan lounge karaoke. Dragon Beach Club menawarkan skala kapasitas panggung yang jauh lebih besar.",
    entityStrengths: [
      "Kapasitas venue panggung hiburan dan DJ mencapai 400 orang",
      "Terhubung dengan fasilitas rekreasi resor pantai dan d'Bar",
      "Fasilitas parkir luas di dalam kawasan resort",
    ],
    entityWeaknesses: [
      "Perlu promosi acara malam dan jadwal penampil tematik yang lebih aktif di media sosial",
    ],
    competitorStrengths: [
      "Rating Google sangat tinggi 4.9 dengan reputasi kepuasan layanan di kalangan tamu lounge",
      "Lokasi strategis di koridor JLS No. 14 Serdang untuk pasar hiburan malam Cilegon/Serang",
    ],
    competitorWeaknesses: [
      "Jumlah ulasan publik masih terbatas (17 ulasan Google) sehingga berstatus kompetitor acuan",
      "Bukan venue bertema pantai atau ruang terbuka",
    ],
    limitations: "Berdasarkan ulasan publik Google Maps Angel Karaoke & Lounge Serdang Kramatwatu.",
    evidenceSourceUrl: "https://www.google.com/maps/place/Angel+Karaoke+%26+Lounge/",
  },



  // 6b. D'BISTRO vs INFINITY RESTAURANT MAMBRUK

  // 8. RESORT & KAMAR vs ASTON ANYER BEACH HOTEL
  {
    id: "comp-resort-aston",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "Aston Anyer Beach Hotel",
    aspect: "Keluasan Kawasan, Fasilitas Pantai, Kapasitas Rombongan & Value for Money",
    summary: "Sanghyang unggul pada taman tropis yang luas, Hot Spring Aquamedic, kelengkapan fasilitas 6 outlet, dan tarif yang sangat bersahabat dibanding Aston yang bertarif tinggi.",
    entityStrengths: [
      "Kawasan resort luas dengan taman hijau rindang dan akses langsung ke pantai",
      "Fasilitas lengkap dalam 1 area: Kamar, Suite & Villa, Hot Spring Aquamedic, Beach Club, Resto Seafood, Karaoke",
      "Value for money tinggi: tarif OTA jauh di bawah Aston untuk keluarga dan corporate gathering",
    ],
    entityWeaknesses: [
      "Bangunan lama perlu peremajaan bertahap: ulasan Google menyebut nyamuk, kamar mandi berbau, dan plafon bocor",
    ],
    competitorStrengths: [
      "Bangunan kamar baru bertingkat dengan desain interior modern dan kamar atas laut (Aquavillas)",
    ],
    competitorWeaknesses: [
      "Kawasan pantai relatif sempit dan sebagian berbatu karang",
    ],
    limitations: "Berdasarkan tarif OTA Google Hotels/Traveloka dan ulasan Google Maps.",
    evidenceSourceUrl: "https://anyer.astonhotelsinternational.com/",
  },

  // 9. RESORT & KAMAR vs MAMBRUK HOTEL & CONVENTION
  {
    id: "comp-resort-mambruk",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "Mambruk Hotel & Convention",
    aspect: "Fasilitas Rekreasi, Infinity Pool & Keberagaman Aktivitas Tamu",
    summary: "Sanghyang mengimbangi fasilitas konvensi Mambruk dengan Hot Spring Aquamedic dan suasana Dragon Beach Club.",
    entityStrengths: [
      "Hot Spring Aquamedic yang tidak dimiliki Mambruk",
      "Voli pantai dan water sports di pantai resort",
      "Tarif penginapan yang lebih fleksibel untuk rombongan",
    ],
    entityWeaknesses: [
      "Kapasitas aula ballroom indoor perlu renovasi agar mampu menampung konvensi skala 500+ pax",
    ],
    competitorStrengths: [
      "Fasilitas MICE dan ballroom indoor berkapasitas besar",
      "Kolam renang infinity pool air laut (sea pool)",
    ],
    competitorWeaknesses: [
      "Sebagian area pantai dilindungi tanggul pemecah ombak sehingga akses pasir terbatas",
    ],
    limitations: "Berdasarkan perbandingan fasilitas resmi dan ulasan publik.",
    evidenceSourceUrl: "https://www.mambruk.co.id/facilities",
  },

  // 10. RESORT & KAMAR vs THE JAYAKARTA ANYER
  {
    id: "comp-resort-jayakarta",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "The Jayakarta Villas Anyer Beach Resort",
    aspect: "Nuansa Resort Taman Tropis, Kapasitas Rombongan & Fasilitas Pantai",
    summary: "Sanghyang dan The Jayakarta sama-sama resort taman tropis, namun Sanghyang unggul pada Hot Spring Aquamedic dan beach club.",
    entityStrengths: [
      "Fasilitas terpadu lengkap (Hot Spring Aquamedic, beach club, karaoke)",
      "Water sports dan voli pantai di pantai resort",
    ],
    entityWeaknesses: [
      "Perlu pembaruan interior soft furnishing di beberapa unit tipe lawas",
    ],
    competitorStrengths: [
      "Unit cottage 3–4 kamar tidur yang sangat luas cocok untuk reuni keluarga besar",
      "Kapasitas parkir bus rombongan luas di koridor KM 135",
    ],
    competitorWeaknesses: [
      "Bangunan hotel bergaya heritage klasik memerlukan peremajaan fasilitas AC & kamar mandi",
      "Tidak memiliki natural hot spring",
    ],
    limitations: "Berdasarkan direktori resmi Jayakarta Hotels dan ulasan publik Google Maps.",
    evidenceSourceUrl: "https://jayakartagroup.com/affiliated/view/9",
  },

  // 12. RESORT & KAMAR vs MARBELLA PLACE ANYER
  {
    id: "comp-resort-marbella",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "Marbella Place Anyer by Jayakarta",
    aspect: "Kapasitas Rombongan Massal, Kolam Renang & Fasilitas MICE",
    summary: "Marbella memiliki kapasitas unit kamar massal di Pantai Bandulu, namun Sanghyang unggul pada suasana asri privat, ketenangan taman, dan kebersihan lingkungan.",
    entityStrengths: [
      "Suasana resor lebih privat, teduh, tenang dan tidak bising oleh kepadatan massa",
      "Hot Spring Aquamedic, satu-satunya natural hot spring di Anyer",
      "Perawatan area pantai yang lebih terjaga kebersihannya",
    ],
    entityWeaknesses: [
      "Kapasitas unit kamar total lebih sedikit dibanding raksasa kondotel Marbella",
    ],
    competitorStrengths: [
      "Kapasitas hunian massal sangat besar (300+ unit kamar/kondotel)",
      "Grand Ballroom berkapasitas hingga 1.000 pax untuk konvensi skala akbar",
      "Kolam renang bergaya laguna Spanyol yang luas",
    ],
    competitorWeaknesses: [
      "Keluhan pemeliharaan lift, lorong, dan fasilitas kamar kondotel dari ulasan publik",
      "Area pantai publik Bandulu seringkali terlalu ramai dan padat pedagang kaki lima",
    ],
    limitations: "Berdasarkan ulasan publik tamu dan observasi fasilitas.",
    evidenceSourceUrl: "https://marbellaplaceanyer.com/",
  },



  // 15. RESORT & KAMAR vs NEMURU GRAND ANYER PALAZO
  {
    id: "comp-resort-nemuru",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "Nemuru Grand Anyer Palazo",
    aspect: "Standar Fasilitas Bintang 4, Konsep Desain & Pembeda Air Panas Alami",
    summary: "Nemuru Grand Anyer Palazo mengusung konsep hospitality modern di Anyer. Sanghyang unggul dengan fasilitas Hot Spring Aquamedic alami dan pantai berpasir landai.",
    entityStrengths: [
      "Hot Spring Aquamedic, satu-satunya sumber air panas mineral alami di Anyer",
      "Kombinasi pantai berpasir luas dan taman tropis asri",
      "Pilihan tipe kamar bervariasi dari kamar hotel hingga unit multi-kamar",
    ],
    entityWeaknesses: [
      "Peremajaan interior kamar modern masih terus berjalan bertahap",
    ],
    competitorStrengths: [
      "Arsitektur modern bernuansa kontemporer",
      "Restoran Temu Katsu dan fasilitas lounge tepi pantai",
    ],
    competitorWeaknesses: [
      "Tidak memiliki sumber air panas mineral alami (hot spring)",
    ],
    limitations: "Berdasarkan ulasan publik tamu dan observasi fasilitas resor.",
    evidenceSourceUrl: "https://nemuruhotels.com/",
  },

  // 16. RESORT & KAMAR vs MY PISITA ANYER RESORT
  {
    id: "comp-resort-mypisita",
    outlet: "resort",
    outletName: "Sanghyang Indah Spa Resort",
    competitorName: "My Pisita Anyer Resort",
    aspect: "Akomodasi Tepi Pantai, Kapasitas Rombongan & Fasilitas Resor",
    summary: "My Pisita Anyer Resort berfokus pada pondok tepi pantai mandiri untuk rombongan. Sanghyang menawarkan fasilitas resor bintang 4 terpadu dengan Hot Spring dan layanan spa.",
    entityStrengths: [
      "Fasilitas lengkap bintang 4 dengan Hot Spring Aquamedic dan D'Spa",
      "Pilihan kuliner terpadu: Sunset Grill tepi pantai dan D'Bistro",
      "Area pantai privat yang luas dan terawat",
    ],
    entityWeaknesses: [
      "Sebagian unit cottage tipe keluarga memerlukan pembaruan interior",
    ],
    competitorStrengths: [
      "Banyak unit cottage berkapasitas besar untuk rombongan mandiri",
      "Akses tepi pantai langsung di koridor Anyer",
    ],
    competitorWeaknesses: [
      "Fasilitas rekreasi dan spa mineral alami tidak selengkap Sanghyang",
    ],
    limitations: "Berdasarkan observasi fasilitas dan data publik penginapan.",
    evidenceSourceUrl: "https://pisitahotelanyer.com/",
  },
  // 17. D'BISTRO vs EL PATIO MARBELLA
  {
    id: "comp-dbistro-elpatio",
    outlet: "dbistro",
    outletName: "D'Bistro (Sanghyang)",
    competitorName: "El Patio Marbella",
    aspect: "Restoran Hotel All-Day Dining & Masakan Indonesia",
    summary: "D'Bistro bersaing langsung di segmen restoran di dalam hotel resort yang menyajikan masakan Indonesia dan internasional bagi tamu menginap maupun keluarga.",
    entityStrengths: [
      "Pembagian menu resmi Indonesian, Japanese, dan Western corner (situs resmi Sanghyang)",
      "Daftar harga menu resmi terbuka per item untuk tamu dan rombongan",
    ],
    entityWeaknesses: [
      "Jumlah ulasan khusus halaman Google Maps outlet restoran (41 ulasan) perlu terus ditingkatkan",
    ],
    competitorStrengths: [
      "Berada di kompleks hunian massal Marbella Place Anyer (kapasitas besar untuk rombongan)",
    ],
    competitorWeaknesses: [
      "Ulasan Google Maps khusus outlet restoran masih sangat sedikit (10 ulasan, rating 4,2)",
    ],
    limitations: "Berdasarkan halaman resmi dining Marbella dan daftar menu resmi D'Bistro Sanghyang.",
    evidenceSourceUrl: "https://marbellaplaceanyer.com/dining/el-patio/",
  },
  // 18. D'BAR & KARAOKE vs HAPPY PUPPY KARAOKE
  {
    id: "comp-dbar-happypuppy",
    outlet: "dbar",
    outletName: "D'Bar & Karaoke (Sanghyang)",
    competitorName: "Happy Puppy Karaoke",
    aspect: "Hiburan Karaoke Keluarga di Cilegon vs Resort Anyer",
    summary: "Happy Puppy memimpin volume ulasan karaoke mandiri di pusat Kota Cilegon (23,2 km), sedangkan D'Bar unggul sebagai ruang karaoke privat langsung di dalam kawasan resort pesisir.",
    entityStrengths: [
      "Berada langsung di dalam Sanghyang Indah Spa Resort sehingga tamu menginap tidak perlu berkendara jauh ke Cilegon",
      "Terintegrasi dengan restoran dan pantai dalam satu kawasan resort",
    ],
    entityWeaknesses: [
      "Volume ulasan Google Maps masih rendah (12 ulasan, rating 3,7) dan tarif sewa ruang belum dipublikasikan di situs resmi",
    ],
    competitorStrengths: [
      "Volume ulasan Google Maps sangat tinggi (1.448 ulasan, rating 4,5) dan nama waralaba dikenal luas",
    ],
    competitorWeaknesses: [
      "Lokasi di pusat kota Cilegon (±41 menit perjalanan mobil dari koridor resort Anyer)",
    ],
    limitations: "Berdasarkan profil situs resmi Sanghyang dan listing Google Maps Happy Puppy Karaoke Cilegon.",
    evidenceSourceUrl: "https://sanghyang.com/dbar/",
  },
  // 19. D'SPA vs ALTA SPA MARBELLA ANYER
  {
    id: "comp-dspa-alta",
    outlet: "dspa",
    outletName: "D'Spa & Hot Spring Aquamedic (Sanghyang)",
    competitorName: "Alta Spa Marbella Anyer",
    aspect: "Terapi Relaksasi Hotel & Pembeda Natural Hot Spring",
    summary: "Alta Spa melayani tamu kondotel Marbella dengan pijat tradisional. D'Spa Sanghyang unggul dengan fasilitas pemandian air panas alami Hot Spring Aquamedic satu-satunya di Anyer.",
    entityStrengths: [
      "Hot Spring Aquamedic sebagai satu-satunya natural hot spring di Anyer disertai paket terapi pijat tradisional (situs resmi)",
      "Promo resmi tersedia untuk menjangkau tamu resort dan wisatawan luar",
    ],
    entityWeaknesses: [
      "Edukasi khasiat mineral air panas alami kepada publik perlu terus diperluas",
    ],
    competitorStrengths: [
      "Berada di dalam kawasan kondotel Marbella dengan akses basis tamu menginap yang besar",
    ],
    competitorWeaknesses: [
      "Tidak memiliki fasilitas pemandian air panas alami (natural hot spring)",
    ],
    limitations: "Berdasarkan situs resmi Marbella, situs resmi Sanghyang, dan listing Google Maps.",
    evidenceSourceUrl: "https://marbellaplaceanyer.com/",
  },
];

/*
 * Keunggulan, celah, dan peluang per pesaing yang diturunkan dari data tersimpan, bukan ditulis tangan: fakta situs
 * resmi (CompetitorFact), ulasan tamu (CompetitorReview), rating Google Maps di registri, harga per orang dari
 * competitor-menu.data.json, dan topik ulasan Google Maps (competitor-review-topics.data.json). Setiap butir membawa
 * sumber dan tanggalnya. Pesaing yang belum punya data mendapat alasan, bukan isian karangan.
 */

/** Dasar sebuah butir: dipakai tampilan untuk ikon dan oleh tes untuk memeriksa bukti dua sisi. */
export type EvidenceBasis = "fakta" | "rating" | "ulasan" | "tema" | "harga" | "topik";

export interface EvidenceSource {
  label: string;
  url: string | null;
  /** ISO; tanggal fakta diamati, rating dibaca, atau ulasan ditulis (ulasan Google berupa perkiraan dari "x lalu"). */
  observedAt: string;
}

export interface EvidenceItem {
  text: string;
  basis: EvidenceBasis;
  /** Kutipan asli ulasan atau halaman, dipotong pendek. */
  quote?: string;
  sources: EvidenceSource[];
}

export interface CompetitorEvidence {
  /** Fakta netral yang teramati (harga, alamat, pengelola, topik ulasan); bukan penilaian. */
  observed: EvidenceItem[];
  strengths: EvidenceItem[];
  gaps: EvidenceItem[];
  opportunities: EvidenceItem[];
}

export interface EvidenceComparison {
  id: string;
  outlet: string;
  /** Nama baris registri outlet Sanghyang yang dibandingkan. */
  outletName: string;
  competitorName: string;
  name: string;
  kind: string | null;
  parentName: string | null;
  compsetRole: string | null;
  evidence: CompetitorEvidence;
  isSanghyang?: boolean;
  specs?: PlaceSpecs | null;
}

export interface EvidenceRegistryRow {
  id: string;
  name: string;
  category: string | null;
  placeId: string | null;
  outlets: string[];
  compsetRole: string | null;
  parentId: string | null;
  parentName: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  googleMapsUrl?: string | null;
  mapsUrl?: string | null;
  rating: number | null;
  reviewCount: number | null;
  ratingSource: string | null;
  ratingSourceUrl: string | null;
  ratingObservedAt: string | null;
}

export interface EvidenceFact {
  competitorId: string;
  section: FactSection | string;
  key: string;
  text: string;
  quote: string;
  sourceUrl: string;
  observedAt: string;
}

export interface EvidenceReview {
  competitorId: string;
  source: string;
  sourceUrl: string;
  rating: number;
  reviewDate: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  themes: string[];
}

export interface EvidenceDataset {
  registry: EvidenceRegistryRow[];
  facts: EvidenceFact[];
  reviews: EvidenceReview[];
}

/** Topik ulasan Google Maps sebuah tempat ("lalat, disebutkan dalam 41 ulasan"), hasil scripts/ops/crawl-venue-reviews.ts. */
export interface ReviewTopics {
  url: string;
  observedAt: string;
  topics: { label: string; count: number }[];
}

export interface EvidenceOptions {
  ownOutlets: readonly { outletKey: string; competitorName: string }[];
  menuOf: (name: string) => CompetitorMenu | null;
  topicsOf: (name: string) => ReviewTopics | null;
  specsMap?: Map<string, PlaceSpecs>;
  /** Tarif kamar termurah per malam di jendela crawl (penginapan), supaya head-to-head membandingkan harga. */
  roomRateOf?: (placeId: string | null) => EvidenceItem | null;
  /** Jumlah tipe kamar, luas, dan unit multi-kamar tidur dari profil tipe kamar (situs resmi menang atas OTA). */
  roomTypesOf?: (placeId: string | null) => EvidenceItem | null;
  /** Harga menu resmi outlet F&B Sanghyang (dipakai kartu Sanghyang sendiri). */
  ownMenuOf?: (outletKey: string) => EvidenceItem | null;
}

/** Tema dari extractThemes (scrape-new-reviews.ts); tanda internal penanda outlet dan "umum" tidak dihitung. */
const REVIEW_THEMES = ["kamar & kebersihan", "makanan & sarapan", "fasilitas & pantai", "pelayanan & staf", "harga & value", "keluarga & anak"];
const LODGING = new Set(["hotel", "resort"]);
const MAX_ITEMS = { observed: 6, strengths: 6, gaps: 5, opportunities: 4 } as const;
const QUOTE_CHARS = 160;
/** Tema dianggap dipuji bila minimal sekian ulasan memujinya dan pujian lebih banyak dari keluhan. */
const MIN_PRAISES_FOR_THEME = 2;
/** Keluhan pada tema yang sama baru disebut "berulang" mulai dari jumlah ini. */
const MIN_REPEATED_COMPLAINTS = 2;
/** Kata umum nama outlet; nama fasilitas yang hanya berisi kata ini ("Spa", "Pool Bar") tidak menunjuk outlet tertentu. */
const GENERIC_VENUE_WORDS = new Set(
  "restaurant restoran resto dining cafe café kafe bistro grill bar lounge pub spa pool kolam renang beach pantai rooftop coffee shop main utama all day the & and dan hotel".split(" "),
);
/** Kunci fakta outlet yang menggambarkan apa yang ditawarkan; sisanya fakta netral. */
const OFFER_KEYS = /^(restoran|bar|spa|fasilitas):|^(mice_kapasitas|pantai|masakan|minuman|suasana|kapasitas|hiburan|perawatan)$/;
const NEUTRAL_KEYS = /^(operator|kelas_bintang|jumlah_kamar|luas_lahan|deskripsi|alamat|segmen|jam_buka|kode_pakaian|reservasi|lokasi_outlet)$/;

const num = (n: number) => n.toLocaleString("id-ID");
const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const snippet = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= QUOTE_CHARS ? flat : `${flat.slice(0, QUOTE_CHARS - 1).replace(/\s+\S*$/, "")}…`;
};
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url);
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

const ENGLISH_WORDS = /\b(the|and|with|of|is|for|offering|perfect|stunning|views?|dining|destination)\b/gi;
const INDONESIAN_WORDS = /\b(dan|yang|di|dengan|untuk|adalah|ini|dari|menyajikan|tersedia|memiliki)\b/i;
/** Teks situs resmi yang disalin apa adanya dalam bahasa Inggris (mis. llms.txt Archipelago) tidak dijadikan kalimat butir. */
const looksEnglish = (text: string) => !INDONESIAN_WORDS.test(text) && (text.match(ENGLISH_WORDS)?.length ?? 0) >= 3;
const factSubject = (key: string) => (key.includes(":") ? key.split(":").slice(1).join(":") : key === "deskripsi" ? "deskripsi tempat" : key.replace(/_/g, " "));

const isPraise = (r: EvidenceReview) => (r.rating > 0 ? r.rating >= 4 && r.sentiment !== "negative" : r.sentiment === "positive");
const isComplaint = (r: EvidenceReview) =>
  r.rating > 0 ? r.rating <= 2 || (r.rating <= 3 && r.sentiment === "negative") : r.sentiment === "negative";
const themesOf = (r: EvidenceReview) => r.themes.filter((t) => REVIEW_THEMES.includes(t));
const reviewSource = (r: EvidenceReview): EvidenceSource => ({ label: `Ulasan ${r.source}, ${monthLabel(r.reviewDate)}`, url: r.sourceUrl, observedAt: r.reviewDate });
const factSource = (f: EvidenceFact): EvidenceSource => ({ label: `Situs resmi ${hostOf(f.sourceUrl)}, ${dateLabel(f.observedAt)}`, url: f.sourceUrl, observedAt: f.observedAt });
/** Nama untuk kalimat: keterangan dalam kurung di akhir nama registri ("Sunset Grill (Sanghyang)") dibuang. */
const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "");
const ratingText = (row: Pick<EvidenceRegistryRow, "rating" | "reviewCount">) =>
  `${num(row.rating as number)}${row.reviewCount != null ? ` dari ${num(row.reviewCount)} ulasan` : ""}`;
const ratingSource = (row: EvidenceRegistryRow): EvidenceSource => ({
  label: `Rating ${row.ratingSource} ${row.name}, ${dateLabel(row.ratingObservedAt as string)}`,
  url: row.ratingSourceUrl,
  observedAt: row.ratingObservedAt as string,
});

/** Kata khas nama outlet (tanpa kata umum), untuk mencocokkan fakta hotel induk dan ulasan yang menyebut outlet itu. */
function distinctiveWords(name: string): string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length > 2 && !GENERIC_VENUE_WORDS.has(w));
}

/** Kata khas outlet tanpa nama hotel induknya: "Upper Circle" dari "The Upper Circle Novus Jiva". */
function venueOnlyWords(row: Pick<EvidenceRegistryRow, "name" | "parentName">): string[] {
  const parentWords = new Set(distinctiveWords(row.parentName ?? ""));
  return distinctiveWords(row.name).filter((w) => !parentWords.has(w));
}

/** Fakta hotel induk yang menyebut outlet ini lewat kuncinya (restoran:/bar:/spa:/fasilitas:<nama outlet>). */
function parentVenueFacts(venue: EvidenceRegistryRow, parentFacts: EvidenceFact[]): EvidenceFact[] {
  const venueName = fold(venue.name);
  return parentFacts.filter((f) => {
    const m = f.key.match(/^(restoran|bar|spa|fasilitas):(.+)$/);
    if (!m) return false;
    const named = fold(m[2]);
    return distinctiveWords(m[2]).length > 0 && venueName.includes(named);
  });
}

/** Satu butir per kunci outlet: "restoran:El Patio" dan "restoran:EL PATIO" sama; yang terbaru dan terpanjang dipakai. */
function dedupeFacts(facts: EvidenceFact[]): EvidenceFact[] {
  const byKey = new Map<string, EvidenceFact>();
  for (const f of facts) {
    const suffix = f.key.includes(":") ? fold(f.key.split(":").slice(1).join(":")) : fold(f.key);
    const id = f.key.includes(":") && /^(restoran|bar|spa|fasilitas):/.test(f.key) ? `outlet:${suffix}` : `${f.section}:${suffix}`;
    const prev = byKey.get(id);
    if (!prev || f.observedAt > prev.observedAt || (f.observedAt === prev.observedAt && f.text.length > prev.text.length)) byKey.set(id, f);
  }
  return [...byKey.values()];
}

/** Fakta yang dipakai untuk sebuah pesaing: hotel memakai faktanya sendiri; outlet memakai faktanya dan fakta outlet itu di hotel induk. */
function factsFor(row: EvidenceRegistryRow, factsById: Map<string, EvidenceFact[]>): EvidenceFact[] {
  const own = factsById.get(row.id) ?? [];
  if (!row.parentId) return dedupeFacts(own);
  // Tipe kamar hotel yang terlanjur tersimpan di baris outlet bukan fakta tentang restoran, bar, atau spa itu.
  const ownVenue = own.filter((f) => f.section !== "kamar");
  const words = venueOnlyWords(row);
  const describesVenue = ownVenue.some(
    (f) => (/^(restoran|bar|spa):/.test(f.key) || f.key === "deskripsi") && words.some((w) => fold(f.text).includes(w)),
  );
  // Deskripsi outlet dari halamannya sendiri menggantikan kalimat ringkas di halaman hotel induk.
  const fromParent = describesVenue ? [] : parentVenueFacts(row, factsById.get(row.parentId) ?? []);
  return dedupeFacts([...ownVenue, ...fromParent]);
}

/** Ulasan yang relevan: milik pesaing itu, ditambah ulasan hotel induk yang menyebut nama khas outletnya. */
function reviewsFor(row: EvidenceRegistryRow, reviewsById: Map<string, EvidenceReview[]>): { own: EvidenceReview[]; fromParent: EvidenceReview[] } {
  const own = reviewsById.get(row.id) ?? [];
  if (!row.parentId) return { own, fromParent: [] };
  const words = venueOnlyWords(row);
  const fromParent = words.length
    ? (reviewsById.get(row.parentId) ?? []).filter((r) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(fold(r.text))))
    : [];
  return { own, fromParent };
}

interface ThemeTally {
  theme: string;
  praises: EvidenceReview[];
  complaints: EvidenceReview[];
  total: number;
}

function tallyThemes(reviews: EvidenceReview[]): ThemeTally[] {
  return REVIEW_THEMES.map((theme) => {
    const about = reviews.filter((r) => themesOf(r).includes(theme));
    return { theme, praises: about.filter(isPraise), complaints: about.filter(isComplaint), total: about.length };
  }).filter((t) => t.total > 0);
}

/**
 * Urutan tampil per dasar butir (stabil di dalam dasar yang sama). Pembanding terukur dan suara tamu didahulukan supaya
 * daftar fasilitas yang panjang tidak menggeser keduanya keluar dari batas butir per kartu.
 */
function byPriority(items: EvidenceItem[], order: EvidenceBasis[]): EvidenceItem[] {
  const rank = (b: EvidenceBasis) => (order.includes(b) ? order.indexOf(b) : order.length);
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.basis) - rank(b.item.basis) || a.i - b.i).map((x) => x.item);
}

const newest = (list: EvidenceReview[]) => [...list].sort((a, b) => b.reviewDate.localeCompare(a.reviewDate))[0];

function evidenceFor(
  row: EvidenceRegistryRow,
  own: EvidenceRegistryRow | undefined,
  ownReviews: EvidenceReview[],
  facts: EvidenceFact[],
  reviews: { own: EvidenceReview[]; fromParent: EvidenceReview[] },
  options: EvidenceOptions,
  specs?: PlaceSpecs | null,
): CompetitorEvidence {
  const observed: EvidenceItem[] = [];
  const strengths: EvidenceItem[] = [];
  const gaps: EvidenceItem[] = [];
  const opportunities: EvidenceItem[] = [];
  const lodging = LODGING.has(row.category ?? "");

  // Fakta situs resmi: tawaran tempat menjadi keunggulan, sisanya fakta netral.
  const roomTypes = facts.filter((f) => f.section === "kamar");
  for (const f of facts.filter((x) => x.section !== "kamar")) {
    const item: EvidenceItem = looksEnglish(f.text)
      ? { text: `${factSubject(f.key)}: kutipan situs resmi (bahasa Inggris).`, basis: "fakta", quote: snippet(f.text), sources: [factSource(f)] }
      : { text: f.text, basis: "fakta", sources: [factSource(f)] };
    if (OFFER_KEYS.test(f.key)) strengths.push(item);
    else if (NEUTRAL_KEYS.test(f.key) || !lodging) observed.push(item);
  }
  const profileRooms = lodging ? options.roomTypesOf?.(row.placeId) ?? null : null;
  if (profileRooms) observed.push(profileRooms);
  if (lodging && roomTypes.length && !profileRooms) {
    const names = roomTypes.map((f) => f.key.replace(/^tipe:/, ""));
    const latest = roomTypes.reduce((a, b) => (a.observedAt >= b.observedAt ? a : b));
    strengths.push({
      text: `${roomTypes.length} tipe kamar tercantum di situs resmi: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", dan lainnya" : ""}.`,
      basis: "fakta",
      sources: [...new Map(roomTypes.map((f) => [f.sourceUrl, factSource(f)])).values()].slice(0, 2).map((s) => ({ ...s, observedAt: latest.observedAt })),
    });
  }

  // Rating Google Maps dibandingkan dengan outlet Sanghyang yang sama, hanya bila keduanya dibaca dari Google Maps.
  const comparable = (r: EvidenceRegistryRow | undefined): r is EvidenceRegistryRow =>
    Boolean(r && r.rating != null && r.ratingSource === "Google Maps" && r.ratingObservedAt);
  if (comparable(row) && comparable(own)) {
    const sources = [ratingSource(row), ratingSource(own)];
    const theirs = row.rating as number;
    const ours = own.rating as number;
    if (theirs > ours) strengths.push({ text: `Rating Google Maps ${ratingText(row)}, di atas ${shortName(own.name)} (${ratingText(own)}).`, basis: "rating", sources });
    else if (theirs < ours) {
      gaps.push({ text: `Rating Google Maps ${ratingText(row)}, di bawah ${shortName(own.name)} (${ratingText(own)}).`, basis: "rating", sources });
      opportunities.push({
        text: `Pakai rating ${shortName(own.name)} yang lebih tinggi (${num(ours)} dibanding ${num(theirs)}) sebagai bukti di materi promosi dan balasan ulasan.`,
        basis: "rating",
        sources,
      });
    } else observed.push({ text: `Rating Google Maps sama dengan ${shortName(own.name)}: ${ratingText(row)} dan ${ratingText(own)}.`, basis: "rating", sources });
  } else if (comparable(row)) {
    observed.push({ text: `Rating Google Maps ${ratingText(row)}.`, basis: "rating", sources: [ratingSource(row)] });
  }

  // Tarif kamar termurah per malam (penginapan), sama dengan jendela tarif Langkah 3.
  const roomRate = lodging ? options.roomRateOf?.(row.placeId) ?? null : null;
  if (roomRate) observed.push(roomRate);

  // Harga per orang laporan pengguna Google Maps dan rentang harga menu: fakta netral, bukan penilaian murah atau mahal.
  const menu = options.menuOf(row.name);
  if (menu?.perPerson) {
    const p = menu.perPerson;
    observed.push({
      text: `Harga ${perPersonText(p)} menurut ${p.reporters != null ? `${num(p.reporters)} pengguna` : "pengguna"} Google Maps.`,
      basis: "harga",
      sources: [{ label: `Google Maps, ${dateLabel(p.capturedAt)}`, url: p.url, observedAt: p.capturedAt }],
    });
  }
  if (menu?.items.length) {
    // Rentang sama dengan tabel harga Langkah 3: tanpa tambahan, paket promo, paket beberapa orang, sewa ruang, dan harga per ons/kg/jam/orang.
    const range = menuPriceRange(menu.items);
    if (range) {
      observed.push({
        text: `${num(menu.items.length)} harga menu tercatat, harga per porsi ${rupiahRange(range.min, range.max)}.`,
        basis: "harga",
        sources: menu.sources.slice(0, 2).map((s) => ({ label: `${s.label}, ${dateLabel(s.capturedAt)}`, url: s.url, observedAt: s.capturedAt })),
      });
    }
  }

  const topics = options.topicsOf(row.name);
  if (topics?.topics.length) {
    observed.push({
      text: `Topik yang paling sering disebut di ulasan Google Maps: ${topics.topics.slice(0, 5).map((t) => `${t.label} (${num(t.count)})`).join(", ")}.`,
      basis: "topik",
      sources: [{ label: `Google Maps, ${dateLabel(topics.observedAt)}`, url: topics.url, observedAt: topics.observedAt }],
    });
  }

  // Spesifikasi fasilitas dan visual dari grounding multi-sumber (place-specs.ts)
  if (specs?.facilities) {
    const f = specs.facilities;
    const sources = specs.sources.filter((s) => !s.url || s.url.startsWith("https://")).slice(0, 2);
    if (sources.length > 0) {
      if (f.smartTv !== null && f.smartTv !== undefined) {
        observed.push({
          text: f.smartTv
            ? `Smart TV tersedia: ${f.smartTvNote ?? "Android/Google TV dengan aplikasi streaming"}.`
            : `Belum Smart TV: ${f.smartTvNote ?? "TV kabel flat-screen standard"}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.bathtub === true) {
        observed.push({
          text: `Kamar mandi dengan bathtub: ${f.bathtubNote ?? "tersedia di tipe kamar pilihan"}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.hotSpring === true) {
        observed.push({
          text: `Pemandian air panas alami (natural hot spring): ${f.hotSpringNote ?? "fasilitas unggulan alami bersertifikat"}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.infinityPool === true) {
        observed.push({
          text: `Fasilitas kolam renang: ${f.poolType ?? "Infinity pool tepi pantai"}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.roomSizeRangeLabel) {
        observed.push({
          text: `Luas kamar terverifikasi: ${f.roomSizeRangeLabel}${specs.roomCount ? ` (${specs.roomCount} kamar total)` : ""}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.designStyle) {
        observed.push({
          text: `Konsep arsitektur: ${f.designStyle}.`,
          basis: "fakta",
          sources,
        });
      }
      if (f.usp) {
        observed.push({
          text: `Pembeda utama (USP): ${f.usp}.`,
          basis: "fakta",
          sources,
        });
      }
    }
  }

  // Ulasan: tema yang dipuji jadi keunggulan, ulasan bintang rendah jadi celah, lalu peluang dari tema yang sama di kedua sisi.
  const all = [...reviews.own, ...reviews.fromParent];
  const fromParentNote = (r: EvidenceReview) => (reviews.fromParent.includes(r) ? ` (ulasan tamu ${row.parentName} yang menyebut outlet ini)` : "");
  const theirThemes = tallyThemes(all);
  const quoted = new Set<EvidenceReview>();
  for (const t of theirThemes.filter((x) => x.praises.length >= MIN_PRAISES_FOR_THEME && x.praises.length > x.complaints.length).slice(0, 2)) {
    // Satu ulasan sering menyentuh beberapa tema; tiap tema memakai ulasan pujian terbaru yang belum dikutip.
    const fresh = t.praises.filter((x) => !quoted.has(x));
    const r = newest(fresh.length ? fresh : t.praises);
    quoted.add(r);
    strengths.push({
      text: `Tamu memuji ${t.theme}: ${t.praises.length} dari ${t.total} ulasan yang membahasnya${fromParentNote(r)}.`,
      basis: "ulasan",
      quote: snippet(r.text),
      sources: [reviewSource(r)],
    });
  }
  const complaints = all.filter(isComplaint).sort((a, b) => b.reviewDate.localeCompare(a.reviewDate));
  for (const r of complaints.slice(0, 3)) {
    const themes = themesOf(r);
    gaps.push({
      text: `${r.rating > 0 ? `Keluhan tamu (${num(r.rating)}/5)` : "Komentar negatif media sosial"}${themes.length ? ` soal ${themes.join(", ")}` : ""}${fromParentNote(r)}.`,
      basis: "ulasan",
      quote: snippet(r.text),
      sources: [reviewSource(r)],
    });
  }
  for (const t of theirThemes.filter((x) => x.complaints.length >= MIN_REPEATED_COMPLAINTS)) {
    gaps.push({
      text: `Keluhan berulang soal ${t.theme}: ${t.complaints.length} dari ${t.total} ulasan yang membahasnya.`,
      basis: "tema",
      sources: [...t.complaints].sort((a, b) => b.reviewDate.localeCompare(a.reviewDate)).slice(0, 2).map(reviewSource),
    });
  }

  if (own) {
    const ourThemes = new Map(tallyThemes(ownReviews).map((t) => [t.theme, t]));
    for (const t of theirThemes) {
      const ours = ourThemes.get(t.theme);
      if (!ours) continue;
      if (t.complaints.length > 0 && ours.praises.length > ours.complaints.length) {
        opportunities.push({
          text: `Tonjolkan ${t.theme} di ${shortName(own.name)}: tamu ${row.name} mengeluhkannya (${t.complaints.length} ulasan), sedangkan ${ours.praises.length} ulasan ${shortName(own.name)} memujinya.`,
          basis: "tema",
          sources: [reviewSource(newest(t.complaints)), reviewSource(newest(ours.praises))],
        });
      } else if (t.praises.length >= MIN_PRAISES_FOR_THEME && t.praises.length > t.complaints.length && ours.complaints.length > 0 && ours.complaints.length >= ours.praises.length) {
        opportunities.push({
          text: `Kejar ${t.theme}: tamu ${row.name} memujinya (${t.praises.length} ulasan), sementara ${ours.complaints.length} ulasan ${shortName(own.name)} mengeluhkannya.`,
          basis: "tema",
          sources: [reviewSource(newest(t.praises)), reviewSource(newest(ours.complaints))],
        });
      }
    }
  }

  return {
    observed: byPriority(observed, ["harga", "topik", "rating", "fakta"]).slice(0, MAX_ITEMS.observed),
    strengths: byPriority(strengths, ["rating", "ulasan", "fakta"]).slice(0, MAX_ITEMS.strengths),
    gaps: byPriority(gaps, ["rating", "ulasan", "tema"]).slice(0, MAX_ITEMS.gaps),
    opportunities: byPriority(opportunities, ["tema", "rating"]).slice(0, MAX_ITEMS.opportunities),
  };
}

const ROLE_ORDER: Record<string, number> = { inti: 0, benchmark: 1 };

/** Kartu bukti per outlet Sanghyang dan pesaingnya di registri (pembanding inti dan acuan). */
export function buildCompetitorEvidence(data: EvidenceDataset, options: EvidenceOptions): EvidenceComparison[] {
  const byName = new Map(data.registry.map((r) => [r.name, r]));
  const ownNames = new Set(options.ownOutlets.map((o) => o.competitorName));
  const factsById = new Map<string, EvidenceFact[]>();
  for (const f of data.facts) factsById.set(f.competitorId, [...(factsById.get(f.competitorId) ?? []), f]);
  const reviewsById = new Map<string, EvidenceReview[]>();
  for (const r of data.reviews) reviewsById.set(r.competitorId, [...(reviewsById.get(r.competitorId) ?? []), r]);

  const out: EvidenceComparison[] = [];
  for (const ownOutlet of options.ownOutlets) {
    const own = byName.get(ownOutlet.competitorName);
    const ownReviews = own ? (reviewsById.get(own.id) ?? []) : [];
    const rivals = data.registry
      .filter((r) => r.outlets.includes(ownOutlet.outletKey) && !ownNames.has(r.name) && (r.compsetRole === "inti" || r.compsetRole === "benchmark"))
      .sort((a, b) => (ROLE_ORDER[a.compsetRole ?? ""] ?? 9) - (ROLE_ORDER[b.compsetRole ?? ""] ?? 9) || a.name.localeCompare(b.name, "id"));
    for (const row of rivals) {
      const specs = options.specsMap?.get(row.placeId ?? "") ?? options.specsMap?.get(row.name.toLowerCase()) ?? null;
      out.push({
        id: `ev:${ownOutlet.outletKey}:${row.placeId ?? row.id}`,
        outlet: ownOutlet.outletKey,
        outletName: ownOutlet.competitorName,
        competitorName: row.name,
        name: row.name,
        kind: row.category,
        parentName: row.parentName,
        compsetRole: row.compsetRole,
        specs,
        evidence: evidenceFor(row, own, ownReviews, factsFor(row, factsById), reviewsFor(row, reviewsById), options, specs),
      });
    }
  }
  return out;
}

/** Kartu bukti Sanghyang sendiri per outlet untuk komparasi internal. */
export function buildOwnEvidence(data: EvidenceDataset, options: EvidenceOptions): Record<string, EvidenceComparison> {
  const byName = new Map(data.registry.map((r) => [r.name, r]));
  const factsById = new Map<string, EvidenceFact[]>();
  for (const f of data.facts) factsById.set(f.competitorId, [...(factsById.get(f.competitorId) ?? []), f]);
  const reviewsById = new Map<string, EvidenceReview[]>();
  for (const r of data.reviews) reviewsById.set(r.competitorId, [...(reviewsById.get(r.competitorId) ?? []), r]);

  const result: Record<string, EvidenceComparison> = {};
  for (const ownOutlet of options.ownOutlets) {
    const own = byName.get(ownOutlet.competitorName);
    if (!own) continue;
    const ownReviews = reviewsById.get(own.id) ?? [];
    const specs = options.specsMap?.get(own.placeId ?? "") ?? options.specsMap?.get(own.name.toLowerCase()) ?? options.specsMap?.get("sanghyang") ?? null;
    const evidence = evidenceFor(own, undefined, ownReviews, factsFor(own, factsById), { own: ownReviews, fromParent: [] }, options, specs);
    // Kartu outlet F&B Sanghyang membawa harga menu resminya, supaya Langkah 2 membandingkan harga dua sisi.
    const ownMenu = LODGING.has(own.category ?? "") ? null : options.ownMenuOf?.(ownOutlet.outletKey) ?? null;
    if (ownMenu) evidence.observed = [ownMenu, ...evidence.observed].slice(0, MAX_ITEMS.observed);
    result[ownOutlet.outletKey] = {
      id: `ev:${ownOutlet.outletKey}:sanghyang`,
      outlet: ownOutlet.outletKey,
      outletName: ownOutlet.competitorName,
      competitorName: ownOutlet.competitorName,
      name: ownOutlet.competitorName,
      kind: own.category,
      parentName: null,
      compsetRole: "own",
      isSanghyang: true,
      specs,
      evidence,
    };
  }
  return result;
}

/**
 * Kartu Langkah 2: hanya pesaing yang punya butir bersumber (fakta situs resmi, rating, ulasan, atau harga). Catatan
 * perbandingan lama yang tidak bersumber per butir dan alasan "data belum ada" tidak dikirim lagi (keputusan pemakai
 * 18 Nov 2026).
 */
export function groundedComparisons(evidence: readonly EvidenceComparison[]): EvidenceComparison[] {
  return evidence.filter((e) => e.evidence.strengths.length + e.evidence.gaps.length + e.evidence.opportunities.length + e.evidence.observed.length > 0);
}

/**
 * Butir harga dan tipe kamar dari data asli: crawl tarif 14 malam (hanya titik yang check-in-nya di jendela crawl),
 * profil tipe kamar (situs resmi menang atas OTA), dan menu resmi Sanghyang.
 */
async function priceEvidenceBuilders(): Promise<Pick<EvidenceOptions, "roomRateOf" | "roomTypesOf" | "ownMenuOf">> {
  const [rates, { loadDynamicHotelRoomTypes, formatAreaSqm }, { officialMenu, OFFICIAL_MENU_SOURCE }, { rupiah, itemPriceText }, menuLib] = await Promise.all([
    import("./resort-room-rates"),
    import("./hotel-room-types"),
    import("./official-menu"),
    import("./menu-format"),
    import("./competitor-menu"),
  ]);
  const profiles = await loadDynamicHotelRoomTypes();
  const source = rates.RESORT_ROOM_RATE_SOURCE;
  const window = source.window;
  const crawlIso = new Date(rates.crawlCapturedAtMs(source.capturedAt)).toISOString();
  const inWindow = (iso: string | null) => Boolean(iso && window && iso >= window.firstCheckIn && iso <= window.lastCheckIn);

  const roomRateOf = (placeId: string | null): EvidenceItem | null => {
    const hotel = placeId && window ? rates.RESORT_LOWEST_BY_HOTEL_ALL.find((h) => h.hotelId === placeId) : undefined;
    if (!hotel?.range || !window) return null;
    const side = (label: string, r: { min: { price: number | null; checkIn: string | null; source: string | null }; max: { price: number | null; checkIn: string | null } }) => {
      if (r.min.price === null || !inWindow(r.min.checkIn)) return `${label} belum ada data`;
      const max = r.max.price !== null && inWindow(r.max.checkIn) && r.max.price > r.min.price ? ` sampai ${rupiah(r.max.price)} (${rates.checkInLabel(r.max.checkIn as string)})` : "";
      return `${label} ${rupiah(r.min.price)} (${rates.checkInLabel(r.min.checkIn as string)}${r.min.source ? `, ${r.min.source}` : ""})${max}`;
    };
    const wd = side("hari biasa", hotel.range.weekday);
    const we = side("akhir pekan", hotel.range.weekend);
    if (wd.endsWith("belum ada data") && we.endsWith("belum ada data")) return null;
    return {
      text: `Tarif OTA termurah per malam (semua tipe kamar), check-in ${rates.checkInLabel(window.firstCheckIn)} sampai ${rates.checkInLabel(window.lastCheckIn)}: ${wd}; ${we}.`,
      basis: "harga",
      sources: [{ label: `Google Travel, pemeriksaan ${dateLabel(crawlIso)}`, url: null, observedAt: crawlIso }],
    };
  };

  const roomTypesOf = (placeId: string | null): EvidenceItem | null => {
    const profile = placeId ? profiles.get(placeId) : undefined;
    if (!profile?.roomTypes.length) return null;
    const rooms = profile.roomTypes;
    const sizes = rooms.map((r) => r.areaSqm).filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b);
    const area = sizes.length ? (sizes.length === 1 ? formatAreaSqm(rooms.find((r) => r.areaSqm === sizes[0])!) : `${sizes[0]}–${sizes[sizes.length - 1]} m²`) : "luas belum tercatat";
    const multi = rooms.filter((r) => (r.bedrooms ?? 0) >= 2);
    const latest = rooms.map((r) => r.observedAt).reduce((a, b) => (a > b ? a : b));
    const sources = [...new Map(rooms.filter((r) => r.sourceUrl).map((r) => [r.sourceUrl, { label: r.sourceLabel || "Situs resmi", url: r.sourceUrl, observedAt: r.observedAt }])).values()].slice(0, 3);
    return {
      text: `${rooms.length} tipe kamar (${rooms.slice(0, 4).map((r) => r.name).join(", ")}${rooms.length > 4 ? ", dan lainnya" : ""}); luas ${area}${multi.length ? `; ${multi.length} unit 2 kamar tidur atau lebih` : ""}.`,
      basis: "fakta",
      sources: sources.length ? sources : [{ label: "Profil tipe kamar", url: null, observedAt: latest }],
    };
  };

  const ownMenuOf = (outletKey: string): EvidenceItem | null => {
    const menu = officialMenu(outletKey);
    if (!menu?.items.length) return null;
    const items = menu.items.map((i) => ({ name: i.name, category: i.category, price: i.price, priceMax: null, unit: i.unit === "porsi" ? null : i.unit }));
    const range = menuLib.menuPriceRange(items);
    if (!range) return null;
    const counted = items.filter(menuLib.isCountedMenuItem).sort((a, b) => a.price - b.price);
    const cheapest = counted[0];
    const priciest = counted[counted.length - 1];
    return {
      text: `${num(items.length)} harga menu resmi, harga per porsi ${rupiahRange(range.min, range.max)} (termurah ${cheapest.name} ${itemPriceText(cheapest)}, termahal ${priciest.name} ${itemPriceText(priciest)}).`,
      basis: "harga",
      sources: [{ label: `${OFFICIAL_MENU_SOURCE.title}, ${dateLabel(OFFICIAL_MENU_SOURCE.capturedAt)}`, url: menu.sourceUrl, observedAt: OFFICIAL_MENU_SOURCE.capturedAt }],
    };
  };

  return { roomRateOf, roomTypesOf, ownMenuOf };
}

interface EvidenceBundle {
  ownEvidence: Record<string, EvidenceComparison>;
  competitorEvidence: EvidenceComparison[];
}

/**
 * Memuat kartu bukti Sanghyang dan seluruh kompetitor dalam 1 set kueri DB ter-cache
 * (menghilangkan duplikasi pembacaan 4.000+ ulasan & fakta antara `loadOwnEvidence` dan `loadCompetitorEvidence`).
 */
export async function loadEvidenceBundle(): Promise<EvidenceBundle> {
  const [{ withCache }, { CACHE_TAGS, CACHE_TTL }] = await Promise.all([
    import("../cache/cached"),
    import("../cache/tags"),
  ]);
  return withCache(
    async () => {
      const [{ db }, { competitorMenu }, { OWN_OUTLETS }, { reviewTopicsOf }, { loadPlaceSpecsMap }] = await Promise.all([
        import("../db"),
        import("./competitor-menu"),
        import("./outlet-ratings"),
        import("./review-topics"),
        import("./place-specs"),
      ]);
      const rows = await db.competitor.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          category: true,
          placeId: true,
          outlets: true,
          compsetRole: true,
          parentId: true,
          parent: { select: { name: true } },
          websiteUrl: true,
          instagramUrl: true,
          googleMapsUrl: true,
          mapsUrl: true,
          rating: true,
          reviewCount: true,
          ratingSource: true,
          ratingSourceUrl: true,
          ratingObservedAt: true,
        },
      });
      const ids = rows.map((r) => r.id);
      const [facts, reviews, placeSpecsMap, builders] = await Promise.all([
        db.competitorFact.findMany({ where: { competitorId: { in: ids } }, orderBy: [{ section: "asc" }, { key: "asc" }] }),
        db.competitorReview.findMany({
          where: { competitorId: { in: ids }, archivedAt: null },
          select: { competitorId: true, source: true, sourceUrl: true, rating: true, reviewDate: true, text: true, sentiment: true, themes: true },
          // Banyak ulasan bertanggal sama (tanggal relatif dari satu kali baca); urutan cadangan menurut kunci ulasan supaya
          // kutipan yang dipilih sama di DB lokal dan produksi yang isinya sama.
          orderBy: [{ reviewDate: "desc" }, { source: "asc" }, { externalId: "asc" }],
        }),
        loadPlaceSpecsMap(),
        priceEvidenceBuilders(),
      ]);
      const dataset: EvidenceDataset = {
        registry: rows.map(({ parent, rating, ratingObservedAt, ...r }) => ({
          ...r,
          parentName: parent?.name ?? null,
          rating: rating === null ? null : Number(rating),
          ratingObservedAt: ratingObservedAt?.toISOString() ?? null,
        })),
        facts: facts.flatMap((f) => {
          const v = f.value as { text?: unknown; quote?: unknown };
          return typeof v.text === "string" && typeof v.quote === "string"
            ? [{ competitorId: f.competitorId, section: f.section, key: f.key, text: v.text, quote: v.quote, sourceUrl: f.sourceUrl, observedAt: f.observedAt.toISOString() }]
            : [];
        }),
        reviews: reviews.map((r) => ({ ...r, rating: Number(r.rating), reviewDate: r.reviewDate.toISOString() })),
      };
      const sharedOpts = { ownOutlets: OWN_OUTLETS, menuOf: competitorMenu, topicsOf: reviewTopicsOf, specsMap: placeSpecsMap, ...builders };
      return {
        ownEvidence: buildOwnEvidence(dataset, sharedOpts),
        competitorEvidence: buildCompetitorEvidence(dataset, sharedOpts),
      };
    },
    ["mi-evidence-bundle"],
    { tags: [CACHE_TAGS.marketEvidence, CACHE_TAGS.marketCompetitors, CACHE_TAGS.marketSpecs], revalidate: CACHE_TTL.marketIntelligence },
  );
}

/**
 * Memuat kartu bukti Sanghyang sendiri dari DB lokal dan PlaceSpecs (berbagi cache dengan `loadCompetitorEvidence`).
 */
export async function loadOwnEvidence(): Promise<Record<string, EvidenceComparison>> {
  return (await loadEvidenceBundle()).ownEvidence;
}

/**
 * Kartu bukti dari DB: registri aktif, fakta situs resmi, dan ulasan aktif. Dipanggil summary API lalu disaring dengan
 * groundedComparisons (berbagi cache dengan `loadOwnEvidence`).
 */
export async function loadCompetitorEvidence(): Promise<EvidenceComparison[]> {
  return (await loadEvidenceBundle()).competitorEvidence;
}
