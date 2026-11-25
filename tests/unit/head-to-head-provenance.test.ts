import test from "node:test";
import assert from "node:assert/strict";
import { OUTLET_HEAD_TO_HEAD_COMPARISONS } from "../../src/lib/market/competitor-comparison";
import { db } from "../../src/lib/db";

// ADR-002 + ADR-003: setiap perbandingan merujuk pesaing di registri tunggal dengan nama yang sama, dan narasi
// kualitatif tidak boleh memuat angka harga atau persentase yang tidak berasal dari observasi tersimpan.
test("Head-to-head: semua pesaing ada di registri aktif dengan nama yang sama", async () => {
  // Rujukan lewat nama registri: UUID baris berbeda antara DB lokal dan produksi.
  const active = new Set((await db.competitor.findMany({ where: { active: true }, select: { name: true } })).map((c) => c.name));
  for (const c of OUTLET_HEAD_TO_HEAD_COMPARISONS) {
    assert.ok(active.has(c.competitorName), `${c.competitorName} tidak ada di registri aktif`);
    assert.equal(c.competitorId, undefined, `${c.competitorName}: UUID tidak boleh ditanam di kode`);
  }
});

test("Head-to-head: narasi tanpa klaim harga atau persentase karangan", () => {
  for (const c of OUTLET_HEAD_TO_HEAD_COMPARISONS) {
    const texts = [c.summary, ...c.entityStrengths, ...c.entityWeaknesses, ...c.competitorStrengths, ...c.competitorWeaknesses];
    for (const t of texts) assert.doesNotMatch(t, /\d+\s*%|Rp\s*\d/, `${c.id}: "${t.slice(0, 80)}"`);
  }
});
