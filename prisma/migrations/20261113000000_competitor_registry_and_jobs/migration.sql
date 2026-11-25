-- AlterEnum
ALTER TYPE "ScrapeJob" ADD VALUE 'rates';
ALTER TYPE "ScrapeJob" ADD VALUE 'reviews';
ALTER TYPE "ScrapeJob" ADD VALUE 'social';
ALTER TYPE "ScrapeJob" ADD VALUE 'promos';
ALTER TYPE "ScrapeJob" ADD VALUE 'website';
ALTER TYPE "ScrapeJob" ADD VALUE 'ratings';
ALTER TYPE "ScrapeJob" ADD VALUE 'photos';
ALTER TYPE "ScrapeJob" ADD VALUE 'room_rates';

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN "category" TEXT,
ADD COLUMN "group" TEXT,
ADD COLUMN "outlets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "placeId" TEXT,
ADD COLUMN "mapsUrl" TEXT,
ADD COLUMN "roadKm" DOUBLE PRECISION,
ADD COLUMN "driveMinutes" INTEGER,
ADD COLUMN "straightKm" DOUBLE PRECISION,
ADD COLUMN "distanceSource" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "starRating" INTEGER,
ADD COLUMN "roomCount" INTEGER,
ADD COLUMN "ratesUrl" TEXT,
ADD COLUMN "retiredReason" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Competitor_active_category_idx" ON "Competitor"("active", "category");

-- CreateIndex
CREATE INDEX "Competitor_placeId_idx" ON "Competitor"("placeId");
