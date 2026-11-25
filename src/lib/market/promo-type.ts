/**
 * Kategori promosi: cara sebuah promo membujuk calon tamu. Tidak semua promosi berupa potongan harga, jadi tabel promo
 * di web dan PDF menampilkan kategori ini di samping harga (permintaan pemilik 21 Nov 2026, contoh "Seaside Candlelight
 * Dinner" yang memperkenalkan fasilitas = Brand awareness). Satu promo mendapat satu kategori utama, dibaca AI dari
 * judul, ringkasan, isi paket, dan syarat yang tersimpan; null berarti belum dibaca dan tampil "belum ada data".
 */

export const PROMOTION_TYPES = [
  "kerja_sama_mitra",
  "program_member",
  "kontes_hadiah",
  "potongan_harga",
  "bonus_tambahan",
  "paket_bundling",
  "harga_spesial",
  "produk_baru",
  "brand_awareness",
] as const;

export type PromotionTypeKey = (typeof PROMOTION_TYPES)[number];

interface PromotionTypeInfo {
  label: string;
  /** Definisi yang sama untuk prompt AI dan keterangan di bawah tabel. */
  definition: string;
}

/**
 * Urutan PROMOTION_TYPES adalah urutan prioritas bila beberapa kategori cocok: syarat khusus penerima (mitra, member,
 * kontes) menentukan bentuk promo lebih dulu, lalu insentif harga, lalu promosi tanpa insentif harga.
 */
export const PROMOTION_TYPE_INFO: Record<PromotionTypeKey, PromotionTypeInfo> = {
  kerja_sama_mitra: {
    label: "Kerja sama mitra",
    definition: "Manfaatnya hanya berlaku lewat mitra: bank, kartu kredit, dompet digital, aplikasi, atau merek lain.",
  },
  program_member: {
    label: "Program member",
    definition: "Hanya untuk anggota, pemegang poin, tamu langganan, atau lewat referral.",
  },
  kontes_hadiah: {
    label: "Kontes & hadiah",
    definition: "Giveaway, kuis, undian, atau lomba berhadiah untuk mendorong interaksi.",
  },
  potongan_harga: {
    label: "Potongan harga",
    definition: "Harga dipotong dari harga normal yang tertulis: persen, nominal, harga coret, early bird, last minute, flash sale.",
  },
  bonus_tambahan: {
    label: "Bonus tambahan",
    definition: "Tambahan tanpa biaya saat membeli: beli 1 gratis 1, gratis upgrade, anak gratis, malam gratis, welcome drink gratis.",
  },
  paket_bundling: {
    label: "Paket bundling",
    definition: "Beberapa layanan yang biasanya dijual terpisah ditawarkan sebagai satu paket berharga tunggal, mis. kamar + makan malam atau paket rapat.",
  },
  harga_spesial: {
    label: "Harga spesial",
    definition: "Harga yang disebut promo, spesial, hemat, atau terbatas waktu, tanpa pembanding harga normal.",
  },
  produk_baru: {
    label: "Produk baru",
    definition: "Mengumumkan menu, layanan, atau fasilitas yang baru diluncurkan.",
  },
  brand_awareness: {
    label: "Brand awareness",
    definition:
      "Memperkenalkan fasilitas, suasana, atau pengalaman tanpa insentif harga; harga biasa boleh tercantum, tetapi tidak ada potongan, bonus, atau sebutan promo.",
  },
};

export function isPromotionType(value: unknown): value is PromotionTypeKey {
  return typeof value === "string" && (PROMOTION_TYPES as readonly string[]).includes(value);
}

/** Label kolom "Kategori Promosi"; promo yang belum dibaca AI ditulis apa adanya. */
export function promotionTypeLabel(value: string | null | undefined): string {
  return isPromotionType(value) ? PROMOTION_TYPE_INFO[value].label : "belum ada data";
}
