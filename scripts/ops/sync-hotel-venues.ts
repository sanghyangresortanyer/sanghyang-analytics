/**
 * Tambahkan atau perbarui restoran, bar, dan spa di dalam hotel pembanding sebagai pesaing outlet Sanghyang, dari fakta
 * situs resmi (jalankan scripts/ops/collect-competitor-profiles.ts lebih dulu). Tanpa --apply hanya menampilkan rencana.
 * Baris yang sudah ada di bawah hotel yang sama (mis. Lighthouse di Mambruk) diperbarui: outlet digabung, tidak dibuang.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/sync-hotel-venues.ts [--apply]
 */
import { db } from "@/lib/db";
import { planHotelVenues, restoOutlets } from "@/lib/market/hotel-venues";

async function main() {
  const apply = process.argv.includes("--apply");
  const hotels = await db.competitor.findMany({
    where: { active: true, category: { in: ["hotel", "resort"] } },
    select: { id: true, name: true, placeId: true, compsetRole: true, roadKm: true, driveMinutes: true, straightKm: true, address: true, mapsUrl: true, googleMapsUrl: true, distanceSource: true },
  });
  const facts = await db.competitorFact.findMany({
    where: {
      competitorId: { in: hotels.map((h) => h.id) },
      OR: [
        { key: { startsWith: "restoran:" } },
        { key: { startsWith: "bar:" } },
        { key: { startsWith: "spa:" } },
        { key: { startsWith: "fasilitas:" } },
      ],
    },
    select: { competitorId: true, key: true, value: true, sourceUrl: true, observedAt: true },
  });
  const plans = planHotelVenues(
    hotels,
    facts.map((f) => ({ hotelId: f.competitorId, key: f.key, text: String((f.value as { text?: unknown }).text ?? ""), sourceUrl: f.sourceUrl })),
  );
  const existing = await db.competitor.findMany({ select: { id: true, name: true, placeId: true, parentId: true, category: true, outlets: true, version: true } });

  for (const plan of plans) {
    const hotel = hotels.find((h) => h.id === plan.parentId)!;
    const venueWord = plan.name.toLowerCase().split(" ").slice(0, 2).join(" ");
    const match = existing.find(
      (e) => e.placeId === plan.placeId || ((e.parentId === hotel.id || e.name.toLowerCase().includes(hotel.name.split(" ")[0].toLowerCase())) && e.name.toLowerCase().startsWith(venueWord)),
    );
    const merged = [...new Set([...(match?.outlets ?? []), ...plan.outlets])];
    // Resto di dalam hotel tidak pernah pesaing Sunset Grill, walau kolom lama masih memuatnya (keputusan pemilik 16 Nov 2026).
    const outlets = (match?.category ?? plan.category) === "resto" ? restoOutlets(merged, "hotel") : merged;
    console.log(`${match ? "perbarui" : "tambah "} ${plan.name} (${plan.category}, ${outlets.join("+")}) di bawah ${hotel.name}`);
    if (!apply) continue;
    // Kategori hanya diisi saat membuat baris baru: baris lama tetap (Lighthouse "Restaurant & Bar" tetap bar), outletnya digabung.
    const common = {
      outlets,
      parentId: hotel.id,
      roadKm: hotel.roadKm,
      driveMinutes: hotel.driveMinutes,
      straightKm: hotel.straightKm,
      address: hotel.address,
      mapsUrl: hotel.mapsUrl ?? hotel.googleMapsUrl,
      googleMapsUrl: hotel.googleMapsUrl ?? hotel.mapsUrl,
      distanceSource: `Mengikuti lokasi hotel induknya (${hotel.distanceSource ?? "Google Maps"})`,
      websiteUrl: plan.websiteUrl,
      compsetRole: plan.compsetRole,
      active: true,
      retiredReason: null,
      verifiedAt: new Date(),
    };
    if (match) {
      const res = await db.competitor.updateMany({ where: { id: match.id, version: match.version }, data: { ...common, version: { increment: 1 } } });
      if (res.count !== 1) throw new Error(`OCC conflict saat memperbarui ${match.name}`);
    } else {
      await db.competitor.create({
        data: { ...common, category: plan.category, group: plan.category, name: plan.name, placeId: plan.placeId, notes: `Outlet di dalam ${hotel.name} (situs resmi): ${plan.notes}` },
      });
    }
  }
  console.log(`[outlet-hotel] ${plans.length} outlet hotel dari fakta situs resmi${apply ? " disimpan" : "; uji kering, jalankan dengan --apply"}.`);
}

main()
  .catch((error) => {
    console.error("[outlet-hotel] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
