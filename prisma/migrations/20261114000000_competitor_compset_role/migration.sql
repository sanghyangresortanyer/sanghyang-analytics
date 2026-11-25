-- Peran pembanding: "inti" (dihitung dalam pangsa pasar) atau "benchmark" (acuan saja).
ALTER TABLE "Competitor" ADD COLUMN "compsetRole" TEXT;

ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_compsetRole_check"
  CHECK ("compsetRole" IS NULL OR "compsetRole" IN ('inti', 'benchmark'));

CREATE INDEX "Competitor_active_compsetRole_idx" ON "Competitor"("active", "compsetRole");
