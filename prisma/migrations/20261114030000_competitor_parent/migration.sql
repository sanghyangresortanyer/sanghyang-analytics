-- Restoran, bar, atau spa di dalam hotel pembanding merujuk hotel induknya (lokasi, foto, dan kelayakan ikut hotel).
ALTER TABLE "Competitor" ADD COLUMN "parentId" UUID;
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_parentId_not_self" CHECK ("parentId" IS NULL OR "parentId" <> "id");
CREATE INDEX "Competitor_parentId_idx" ON "Competitor"("parentId");
