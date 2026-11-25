/**
 * Menjalankan langkah "situs" penyegaran secara terpisah: promo dan event situs resmi kompetitor dibaca ulang (isi paket
 * disalin dari halaman), baris yang belum punya jenis dipisahkan AI menjadi promo atau event, lalu promo yang belum punya
 * kategori promosi dibaca kategorinya. Sama dengan bagian langkah situs pada tombol "Perbarui Semua Data", tanpa langkah
 * lain yang berat.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/refresh-promos-and-events.ts
 */
import { db } from "@/lib/db";
import { classifyPromotionKinds } from "@/lib/market/promo-kind";
import { classifyPromotionTypes } from "@/lib/market/promo-type-classifier";
import { promotionTypeLabel } from "@/lib/market/promo-type";
import { scrapeWebsitePromos } from "@/lib/market/website-promos";
import { assertLocalWorkDatabase } from "./local-db-guard";

async function main() {
  assertLocalWorkDatabase();
  const site = await scrapeWebsitePromos();
  console.log(`[promo-event] situs: ${site.sites} situs, ${site.saved} baru, ${site.updated} diperbarui.`);
  for (const failure of site.failures) console.log(`  gagal: ${failure}`);
  const kinds = await classifyPromotionKinds();
  console.log(`[promo-event] jenis: ${kinds.checked} baris ditandai (${kinds.promos} promo, ${kinds.events} event).`);
  for (const failure of kinds.failures) console.log(`  gagal: ${failure}`);
  const types = await classifyPromotionTypes();
  const perType = Object.entries(types.byType).map(([key, n]) => `${promotionTypeLabel(key)} ${n}`).join(", ");
  console.log(`[promo-event] kategori promosi: ${types.checked} promo ditandai${perType ? ` (${perType})` : ""}.`);
  for (const failure of types.failures) console.log(`  gagal: ${failure}`);
  if (site.failures.length === site.sites && site.sites > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
