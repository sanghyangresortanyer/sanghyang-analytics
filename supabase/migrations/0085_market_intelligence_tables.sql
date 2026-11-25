-- Sanghyang Analytics (ADR-014): 18 Market Intelligence tables + 14 enums + indexes + FKs + RLS lock
-- Generated deterministically from prisma/schema.prisma

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('news', 'fnb', 'event', 'competitor', 'review');

-- CreateEnum
CREATE TYPE "ScrapeMethod" AS ENUM ('rss', 'http', 'browser', 'manual');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('discovered', 'extracted', 'failed', 'duplicate');

-- CreateEnum
CREATE TYPE "MarketItemKind" AS ENUM ('fnb', 'event', 'entertainment', 'destination');

-- CreateEnum
CREATE TYPE "ScrapeJob" AS ENUM ('news', 'rates', 'reviews', 'social', 'promos', 'website', 'ratings', 'photos', 'room_rates');

-- CreateEnum
CREATE TYPE "ScrapeRunStatus" AS ENUM ('running', 'success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "ScrapeStage" AS ENUM ('fetch', 'parse', 'extract', 'persist');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('new', 'changed', 'expired');

-- CreateEnum
CREATE TYPE "MarketInsightType" AS ENUM ('insight', 'opportunity', 'recommendation');

-- CreateEnum
CREATE TYPE "MarketInsightStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "NewsReadStatus" AS ENUM ('relevan', 'tidak_relevan', 'di_luar_radius', 'lokasi_tidak_jelas', 'tidak_terbaca');

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('promo', 'event');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('kerja_sama_mitra', 'program_member', 'kontes_hadiah', 'potongan_harga', 'bonus_tambahan', 'paket_bundling', 'harga_spesial', 'produk_baru', 'brand_awareness');

-- CreateEnum
CREATE TYPE "ReviewSentiment" AS ENUM ('positive', 'neutral', 'negative');

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "category" "SourceCategory" NOT NULL,
    "method" "ScrapeMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "intervalMinutes" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "normalizedTitle" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "description" TEXT,
    "content" TEXT,
    "imageUrl" TEXT,
    "publisherUrl" TEXT,
    "contentHash" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'discovered',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketItem" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "kind" "MarketItemKind" NOT NULL,
    "location" TEXT,
    "venue" TEXT,
    "organizer" TEXT,
    "brand" TEXT,
    "description" TEXT,
    "targetAudience" TEXT,
    "relevanceScore" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "tags" JSONB,
    "readStatus" "NewsReadStatus",
    "readAt" TIMESTAMP(3),
    "readNote" TEXT,
    "readSummary" TEXT,
    "outlets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "articleUrl" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "Competitor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "group" TEXT,
    "outlets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "placeId" TEXT,
    "googleMapsUrl" TEXT,
    "mapsUrl" TEXT,
    "roadKm" DOUBLE PRECISION,
    "driveMinutes" INTEGER,
    "straightKm" DOUBLE PRECISION,
    "distanceSource" TEXT,
    "address" TEXT,
    "starRating" INTEGER,
    "roomCount" INTEGER,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "tiktokUrl" TEXT,
    "location" TEXT,
    "rating" DECIMAL(3,2),
    "reviewCount" INTEGER,
    "ratingSource" TEXT,
    "ratingSourceUrl" TEXT,
    "ratingObservedAt" TIMESTAMP(3),
    "bookingUrl" TEXT,
    "ratesUrl" TEXT,
    "socialUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "compsetRole" TEXT,
    "parentId" UUID,
    "retiredReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPriceSnapshot" (
    "id" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "roomName" TEXT,
    "packageName" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "discount" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "guests" INTEGER NOT NULL DEFAULT 2,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanghyangPriceSnapshot" (
    "id" UUID NOT NULL,
    "roomName" TEXT NOT NULL,
    "packageName" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "discount" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "guests" INTEGER NOT NULL DEFAULT 2,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanghyangPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPromotion" (
    "id" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "price" DECIMAL(12,2),
    "originalPrice" DECIMAL(12,2),
    "discount" DECIMAL(5,2),
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "imageUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "status" "PromotionStatus" NOT NULL,
    "kind" "PromotionKind",
    "details" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promotionType" "PromotionType",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorReview" (
    "id" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "sentiment" "ReviewSentiment" NOT NULL,
    "themes" TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorFact" (
    "id" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMacroStat" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketMacroStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletMonthlyRevenue" (
    "id" UUID NOT NULL,
    "outletKey" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OutletMonthlyRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletMonthlySnapshot" (
    "id" UUID NOT NULL,
    "outletKey" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "googleRating" DECIMAL(3,2),
    "pricePositioningIndex" DECIMAL(6,1),
    "reviewsRecorded" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OutletMonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingGoal" (
    "id" UUID NOT NULL,
    "outletKey" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "targetRevenueGrowthPct" DECIMAL(6,2),
    "targetRating" DECIMAL(3,2),
    "strategy" TEXT NOT NULL DEFAULT '',
    "decisions" TEXT NOT NULL DEFAULT '',
    "filledBy" TEXT NOT NULL,
    "evaluation" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MarketingGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketInsight" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "activeFingerprint" TEXT,
    "type" "MarketInsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "sourceReferences" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" "MarketInsightStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "job" "ScrapeJob" NOT NULL,
    "status" "ScrapeRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "recordsSaved" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeError" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "url" TEXT,
    "stage" "ScrapeStage" NOT NULL,
    "message" TEXT NOT NULL,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeLock" (
    "job" "ScrapeJob" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerToken" TEXT NOT NULL,

    CONSTRAINT "ScrapeLock_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE INDEX "Source_category_enabled_idx" ON "Source"("category", "enabled");

-- CreateIndex
CREATE INDEX "Source_enabled_priority_idx" ON "Source"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Source_domain_method_key" ON "Source"("domain", "method");

-- CreateIndex
CREATE UNIQUE INDEX "Article_canonicalUrl_key" ON "Article"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Article_contentHash_key" ON "Article"("contentHash");

-- CreateIndex
CREATE INDEX "Article_sourceId_normalizedTitle_publishedAt_idx" ON "Article"("sourceId", "normalizedTitle", "publishedAt");

-- CreateIndex
CREATE INDEX "Article_sourceId_contentHash_idx" ON "Article"("sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "Article_status_createdAt_idx" ON "Article"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketItem_articleId_key" ON "MarketItem"("articleId");

-- CreateIndex
CREATE INDEX "MarketItem_kind_location_idx" ON "MarketItem"("kind", "location");

-- CreateIndex
CREATE INDEX "MarketItem_startsAt_idx" ON "MarketItem"("startsAt");

-- CreateIndex
CREATE INDEX "MarketItem_readStatus_idx" ON "MarketItem"("readStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GeoPlace_query_key" ON "GeoPlace"("query");

-- CreateIndex
CREATE INDEX "Competitor_active_name_idx" ON "Competitor"("active", "name");

-- CreateIndex
CREATE INDEX "Competitor_active_category_idx" ON "Competitor"("active", "category");

-- CreateIndex
CREATE INDEX "Competitor_active_compsetRole_idx" ON "Competitor"("active", "compsetRole");

-- CreateIndex
CREATE INDEX "Competitor_placeId_idx" ON "Competitor"("placeId");

-- CreateIndex
CREATE INDEX "Competitor_parentId_idx" ON "Competitor"("parentId");

-- CreateIndex
CREATE INDEX "CompetitorPriceSnapshot_competitorId_observedAt_idx" ON "CompetitorPriceSnapshot"("competitorId", "observedAt");

-- CreateIndex
CREATE INDEX "CompetitorPriceSnapshot_source_observedAt_idx" ON "CompetitorPriceSnapshot"("source", "observedAt");

-- CreateIndex
CREATE INDEX "SanghyangPriceSnapshot_roomName_checkIn_checkOut_guests_idx" ON "SanghyangPriceSnapshot"("roomName", "checkIn", "checkOut", "guests");

-- CreateIndex
CREATE INDEX "SanghyangPriceSnapshot_observedAt_idx" ON "SanghyangPriceSnapshot"("observedAt");

-- CreateIndex
CREATE INDEX "CompetitorPromotion_competitorId_capturedAt_idx" ON "CompetitorPromotion"("competitorId", "capturedAt");

-- CreateIndex
CREATE INDEX "CompetitorPromotion_status_startsAt_endsAt_idx" ON "CompetitorPromotion"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "CompetitorPromotion_kind_idx" ON "CompetitorPromotion"("kind");

-- CreateIndex
CREATE INDEX "CompetitorReview_competitorId_reviewDate_idx" ON "CompetitorReview"("competitorId", "reviewDate");

-- CreateIndex
CREATE INDEX "CompetitorReview_sentiment_reviewDate_idx" ON "CompetitorReview"("sentiment", "reviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorReview_competitorId_source_externalId_key" ON "CompetitorReview"("competitorId", "source", "externalId");

-- CreateIndex
CREATE INDEX "CompetitorFact_competitorId_section_idx" ON "CompetitorFact"("competitorId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorFact_competitorId_section_key_key" ON "CompetitorFact"("competitorId", "section", "key");

-- CreateIndex
CREATE INDEX "MarketMacroStat_key_period_idx" ON "MarketMacroStat"("key", "period");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMacroStat_key_period_key" ON "MarketMacroStat"("key", "period");

-- CreateIndex
CREATE UNIQUE INDEX "OutletMonthlyRevenue_outletKey_month_key" ON "OutletMonthlyRevenue"("outletKey", "month");

-- CreateIndex
CREATE UNIQUE INDEX "OutletMonthlySnapshot_outletKey_month_key" ON "OutletMonthlySnapshot"("outletKey", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingGoal_outletKey_month_key" ON "MarketingGoal"("outletKey", "month");

-- CreateIndex
CREATE INDEX "MarketInsight_type_generatedAt_idx" ON "MarketInsight"("type", "generatedAt");

-- CreateIndex
CREATE INDEX "MarketInsight_status_generatedAt_idx" ON "MarketInsight"("status", "generatedAt");

-- CreateIndex
CREATE INDEX "MarketInsight_fingerprint_status_idx" ON "MarketInsight"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "ScrapeRun_sourceId_createdAt_idx" ON "ScrapeRun"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeRun_status_createdAt_idx" ON "ScrapeRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeError_runId_createdAt_idx" ON "ScrapeError"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeError_sourceId_createdAt_idx" ON "ScrapeError"("sourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPriceSnapshot" ADD CONSTRAINT "CompetitorPriceSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPromotion" ADD CONSTRAINT "CompetitorPromotion_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorReview" ADD CONSTRAINT "CompetitorReview_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorFact" ADD CONSTRAINT "CompetitorFact_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeRun" ADD CONSTRAINT "ScrapeRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeError" ADD CONSTRAINT "ScrapeError_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScrapeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeError" ADD CONSTRAINT "ScrapeError_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index for active MarketInsight fingerprints (from Prisma migration 20260923070000)
CREATE UNIQUE INDEX "MarketInsight_activeFingerprint_key"
  ON public."MarketInsight"("activeFingerprint")
  WHERE "activeFingerprint" IS NOT NULL AND "status" = 'active'::"MarketInsightStatus";

-- Lock down all 18 Market Intelligence (Prisma) tables from Supabase public Data API (anon & authenticated).
-- Access is server-side only (Prisma / service_role) behind Next.js auth guards (ADR-014).
ALTER TABLE public."Source" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Source" FROM anon, authenticated;
ALTER TABLE public."Article" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Article" FROM anon, authenticated;
ALTER TABLE public."MarketItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MarketItem" FROM anon, authenticated;
ALTER TABLE public."GeoPlace" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."GeoPlace" FROM anon, authenticated;
ALTER TABLE public."Competitor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Competitor" FROM anon, authenticated;
ALTER TABLE public."CompetitorPriceSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompetitorPriceSnapshot" FROM anon, authenticated;
ALTER TABLE public."SanghyangPriceSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SanghyangPriceSnapshot" FROM anon, authenticated;
ALTER TABLE public."CompetitorPromotion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompetitorPromotion" FROM anon, authenticated;
ALTER TABLE public."CompetitorReview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompetitorReview" FROM anon, authenticated;
ALTER TABLE public."CompetitorFact" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompetitorFact" FROM anon, authenticated;
ALTER TABLE public."MarketMacroStat" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MarketMacroStat" FROM anon, authenticated;
ALTER TABLE public."OutletMonthlyRevenue" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OutletMonthlyRevenue" FROM anon, authenticated;
ALTER TABLE public."OutletMonthlySnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OutletMonthlySnapshot" FROM anon, authenticated;
ALTER TABLE public."MarketingGoal" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MarketingGoal" FROM anon, authenticated;
ALTER TABLE public."MarketInsight" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MarketInsight" FROM anon, authenticated;
ALTER TABLE public."ScrapeRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ScrapeRun" FROM anon, authenticated;
ALTER TABLE public."ScrapeError" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ScrapeError" FROM anon, authenticated;
ALTER TABLE public."ScrapeLock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ScrapeLock" FROM anon, authenticated;
