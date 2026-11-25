-- Potret bulanan per outlet (perbandingan "vs bulan lalu") dan tujuan bulanan tim digital marketing.
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

-- CreateIndex
CREATE UNIQUE INDEX "OutletMonthlySnapshot_outletKey_month_key" ON "OutletMonthlySnapshot"("outletKey", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingGoal_outletKey_month_key" ON "MarketingGoal"("outletKey", "month");


-- Sama seperti tabel lain: tutup akses Data API Supabase; Prisma tersambung sebagai pemilik tabel (BYPASSRLS).
ALTER TABLE "OutletMonthlySnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingGoal" ENABLE ROW LEVEL SECURITY;
