-- Statistik makro pasar dari sumber resmi (TPK hotel bintang Banten dari BPS), satu baris per indikator per bulan.
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

CREATE UNIQUE INDEX "MarketMacroStat_key_period_key" ON "MarketMacroStat"("key", "period");
CREATE INDEX "MarketMacroStat_key_period_idx" ON "MarketMacroStat"("key", "period");
