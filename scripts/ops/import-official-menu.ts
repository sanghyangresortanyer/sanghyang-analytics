/**
 * Impor harga menu resmi Sunset Grill dan D'Bistro dari konten situs resmi Sanghyang (teks foto menu sanghyang.com
 * yang dikurasi di repositori situs) ke lib/market/official-menu.data.json.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ops/import-official-menu.ts <path ke content/seed/venues.json>
 *
 * Item yang dibandingkan dipilih di MENU_SPECS. Setiap item harus ditemukan tepat satu kali beserta harganya;
 * bila tidak, impor berhenti supaya tidak ada harga yang ditebak.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findMenuPrice, type MenuItemSpec, type OfficialMenu } from "@/lib/market/menu-text";

const MENU_SPECS: Record<string, { slug: string; items: MenuItemSpec[] }> = {
  "sunset-grill": {
    slug: "sunset-grill",
    items: [
      { label: "Ikan Kwe (goreng/bakar)", category: "Seafood", menuName: "IKAN KWE" },
      { label: "Ikan Kakap Bakar", category: "Seafood", menuName: "IKAN KAKAP BAKAR" },
      { label: "Kerapu Bakar", category: "Seafood", menuName: "KERAPU BAKAR" },
      { label: "Cumi Bakar", category: "Seafood", menuName: "CUMI BAKAR" },
      { label: "Udang Bakar", category: "Seafood", menuName: "UDANG BAKAR" },
      { label: "Kelapa Muda (Young Coconut)", category: "Minuman", menuName: "Young Coconut" },
    ],
  },
  dbistro: {
    slug: "dbistro",
    items: [
      { label: "Sop Buntut", category: "Indonesian corner", menuName: "SOP BUNTUT" },
      { label: "Soto Ayam Madura", category: "Indonesian corner", menuName: "SOTO AYAM MADURA" },
      { label: "Gurame Bakar", category: "Indonesian corner", menuName: "GURAME BAKAR" },
      { label: "Udang Bakar", category: "Indonesian corner", menuName: "UDANG BAKAR" },
      { label: "Nasi Goreng Kampung", category: "Rice & noodles", menuName: "NASI GORENG KAMPUNG" },
      { label: "Nasi Goreng D'Bistro", category: "Rice & noodles", menuName: "NASI GORENG D’BISTRO" },
    ],
  },
};

interface SeedOutlet {
  slug: string;
  menuPages?: { image: string; text?: string }[];
}

function main() {
  const seedPath = process.argv[2];
  if (!seedPath) throw new Error("Sebutkan path content/seed/venues.json dari repositori situs resmi Sanghyang.");
  const seed = JSON.parse(readFileSync(resolve(seedPath), "utf8")) as { $comment: string; outlets: SeedOutlet[] };
  const capturedAt = seed.$comment.match(/crawl P0 (\d{4}-\d{2}-\d{2})/)?.[1];
  if (!capturedAt) throw new Error("Tanggal crawl situs resmi tidak ditemukan di $comment venues.json.");

  const outlets: Record<string, OfficialMenu> = {};
  for (const [outletKey, spec] of Object.entries(MENU_SPECS)) {
    const outlet = seed.outlets.find((o) => o.slug === spec.slug);
    if (!outlet?.menuPages?.length) throw new Error(`Foto menu ${spec.slug} tidak ada di konten situs.`);
    const items = spec.items.map((item) => {
      const found = outlet.menuPages!.flatMap((page) => {
        const hit = page.text ? findMenuPrice(page.text, item.menuName) : null;
        return hit ? [{ ...hit, menuImage: page.image }] : [];
      });
      if (found.length !== 1) throw new Error(`${spec.slug}: "${item.menuName}" ditemukan ${found.length} kali, harus tepat satu.`);
      return { name: item.label, category: item.category, ...found[0] };
    });
    outlets[outletKey] = { sourceUrl: `https://sanghyang.com/${spec.slug}/`, items };
  }

  const out = {
    $comment:
      "Dibuat oleh scripts/ops/import-official-menu.ts dari teks foto menu situs resmi Sanghyang. Jangan diubah manual; jalankan ulang skripnya bila menu berganti.",
    source: { title: "foto menu resmi di situs Sanghyang (sanghyang.com)", capturedAt },
    outlets,
  };
  const target = resolve("src/lib/market/official-menu.data.json");
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  for (const [key, menu] of Object.entries(outlets)) {
    console.log(`[menu-resmi] ${key}: ${menu.items.map((i) => `${i.name} Rp ${i.price.toLocaleString("id-ID")}${i.unit === "per ons" ? "/ons" : ""}`).join(", ")}`);
  }
}

main();
