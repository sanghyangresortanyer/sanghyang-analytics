-- Fakta profil tempat dari halaman resminya, satu fakta satu sumber (dipakai PDF Rapat Senin).
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
    CONSTRAINT "CompetitorFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CompetitorFact_section_check" CHECK ("section" IN ('profil', 'kamar', 'lokasi', 'fasilitas', 'segmen'))
);

CREATE UNIQUE INDEX "CompetitorFact_competitorId_section_key_key" ON "CompetitorFact"("competitorId", "section", "key");
CREATE INDEX "CompetitorFact_competitorId_section_idx" ON "CompetitorFact"("competitorId", "section");

ALTER TABLE "CompetitorFact" ADD CONSTRAINT "CompetitorFact_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
