-- Berita dibaca isinya sebelum dinilai relevan (permintaan pemakai 18 Nov 2026): situs penerbit dari RSS Google News,
-- hasil pembacaan per MarketItem, dan cache koordinat lokasi berita dari pencarian Google Maps.
ALTER TABLE "Article" ADD COLUMN "publisherUrl" TEXT;

CREATE TYPE "NewsReadStatus" AS ENUM ('relevan', 'tidak_relevan', 'di_luar_radius', 'lokasi_tidak_jelas', 'tidak_terbaca');
ALTER TABLE "MarketItem" ADD COLUMN "readStatus" "NewsReadStatus";
ALTER TABLE "MarketItem" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "MarketItem" ADD COLUMN "readNote" TEXT;
ALTER TABLE "MarketItem" ADD COLUMN "readSummary" TEXT;
ALTER TABLE "MarketItem" ADD COLUMN "outlets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MarketItem" ADD COLUMN "articleUrl" TEXT;
ALTER TABLE "MarketItem" ADD COLUMN "distanceKm" DOUBLE PRECISION;
CREATE INDEX "MarketItem_readStatus_idx" ON "MarketItem"("readStatus");

CREATE TABLE "GeoPlace" (
    "id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "name" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "mapsUrl" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeoPlace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GeoPlace_query_key" ON "GeoPlace"("query");
