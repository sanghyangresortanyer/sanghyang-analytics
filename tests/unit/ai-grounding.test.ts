import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { knowledgeGraphGrounding } from "../../src/lib/knowledge-graph/ai-grounding";

after(() => db.$disconnect());

test("ringkasan Knowledge Graph untuk semua panggilan AI memuat keenam unit bisnis, sinyal VHP, dan kompetitor, tanpa nominal rupiah", async () => {
  const text = await knowledgeGraphGrounding(new Date("2026-11-27T05:00:00Z"));
  assert.match(text, /^KONTEKS KNOWLEDGE GRAPH SANGHYANG \(periode 29 Okt 2026 – 27 Nov 2026;/);
  assert.match(text, /jawaban tetap hanya berisi hal yang tertulis di sumber itu/, "tugas ekstraksi tetap memakai teks sumber saja");
  for (const outlet of ["Kamar & Resort", "Sunset Grill", "Dragon Beach Club", "D'Bistro", "D'Bar & Karaoke", "D'Spa & Hot Spring Aquamedic"]) {
    assert.ok(text.includes(`- ${outlet}:`), `${outlet} ada di ringkasan`);
  }
  assert.match(text, /kinerja VHP \d{4}-\d{2}:/, "sinyal operasional VHP hasil konsolidasi ikut");
  assert.match(text, /Kompetitor inti per unit bisnis:/);
  assert.doesNotMatch(text, /Rp\s?\d/, "tanpa nominal rupiah (ADR-014)");
});
