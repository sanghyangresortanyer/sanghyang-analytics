-- Ulasan riset lama yang terbukti ditulis manual diarsipkan, tidak dihapus.
ALTER TABLE "CompetitorReview" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Omset riil per outlet per bulan dari impor laporan pembukuan.
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

CREATE UNIQUE INDEX "OutletMonthlyRevenue_outletKey_month_key" ON "OutletMonthlyRevenue"("outletKey", "month");

-- Supabase membuka schema public lewat Data API ke peran anon/authenticated. RLS tanpa policy menutup akses itu.
-- Aplikasi tidak terpengaruh: Prisma tersambung sebagai postgres, pemilik tabel dengan BYPASSRLS.
ALTER TABLE "Article" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Competitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorPriceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorPromotion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutletMonthlyRevenue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SanghyangPriceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrapeError" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrapeLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrapeRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
