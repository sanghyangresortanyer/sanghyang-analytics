-- Kategori promosi (cara promo membujuk calon tamu), dibaca AI; null = belum dibaca. Aditif: baris lama tidak berubah.
CREATE TYPE "PromotionType" AS ENUM ('kerja_sama_mitra', 'program_member', 'kontes_hadiah', 'potongan_harga', 'bonus_tambahan', 'paket_bundling', 'harga_spesial', 'produk_baru', 'brand_awareness');

ALTER TABLE "CompetitorPromotion" ADD COLUMN "promotionType" "PromotionType";
