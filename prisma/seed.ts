import { db } from "@/lib/db";
import { ensureSourceForJob } from "@/lib/market/scrape-log";

async function main() {
  console.log("=== Memulai Database Seeding Sanghyang Analytics ===");

  // Sumber berita dengan nama dari registri tugas perayapan, sama dengan job berita dan panel admin.
  await ensureSourceForJob("news");

  console.log("=== Seluruh Seeding Database Berhasil 100% ===");
}

main()
  .catch((error) => {
    console.error("Database seed failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
