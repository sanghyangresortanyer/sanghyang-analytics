-- Promo (penawaran harga atau manfaat) dan event (kegiatan pada tanggal tertentu) dipisahkan oleh pembacaan AI.
-- NULL berarti baris belum dibaca AI; langkah penyegaran mengisinya. Isi paket dan syarat disalin persis dari sumber.
CREATE TYPE "PromotionKind" AS ENUM ('promo', 'event');
ALTER TABLE "CompetitorPromotion" ADD COLUMN "kind" "PromotionKind";
ALTER TABLE "CompetitorPromotion" ADD COLUMN "details" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CompetitorPromotion" ADD COLUMN "terms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "CompetitorPromotion_kind_idx" ON "CompetitorPromotion"("kind");
