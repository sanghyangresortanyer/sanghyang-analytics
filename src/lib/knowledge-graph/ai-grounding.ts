/**
 * Ringkasan Knowledge Graph yang ikut dikirim ke setiap panggilan AI lewat lib/gemini.ts (keputusan pemilik 27 Nov 2026:
 * semua yang memanggil AI memakai Knowledge Graph, terlepas dari toggle menu Knowledge Graph di Pengaturan yang hanya
 * menampilkan atau menyembunyikan halamannya). Bahannya konteks yang sama dengan analisis outlet Insight Pasar
 * (buildOutletKnowledgeContext) untuk 30 hari terakhir: data pasar dan sinyal operasional VHP dalam persen, arah, porsi,
 * dan peringkat, tanpa nominal omset rupiah (ADR-014).
 */
import { presetRange, rangeLabel } from "../market/date-range";
import { buildKnowledgeGraph } from "./build";
import { buildOutletKnowledgeContext, type OutletKnowledgeContext } from "./context";

const OWN_OUTLETS = ["resort", "sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"] as const;
/** Kompetitor, promo, dan menu per outlet yang ikut dikirim; cukup untuk latar belakang tanpa membengkakkan tiap permintaan. */
const MAX_COMPETITORS = 5;
const MAX_PROMOS = 3;
const MAX_MENUS = 5;
/**
 * Satu proses (job malam, skrip, atau instans server) membangun ringkasan paling sering sekali per 10 menit; job malam
 * memanggil AI lebih dari seratus kali, dan graf berubah hanya ketika data baru tersimpan.
 */
const MEMO_MS = 10 * 60 * 1000;

const pct = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` : null);
const joinParts = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join("; ");

function outletLine(ctx: OutletKnowledgeContext): string | null {
  const p = ctx.sanghyang;
  if (!p) return null;
  const sig = p.internalSignals;
  const perf = sig?.performance;
  const stay = sig?.resortStay;
  const menu = sig?.menuHealth;
  const promo = sig?.promoAudit;
  const acq = sig?.acquisition;
  return `- ${p.label}: ${joinParts([
    p.ratingFact,
    perf &&
      `kinerja VHP ${perf.month}: ${joinParts([
        pct(perf.momGrowthPct) && `pertumbuhan ${pct(perf.momGrowthPct)} dibanding tanggal setara bulan lalu`,
        pct(perf.targetAchievementPct) && `capaian target ${pct(perf.targetAchievementPct)}`,
        perf.status && `status ${perf.status.replace("_", " ")}`,
        pct(perf.contributionSharePct) && `porsi ${pct(perf.contributionSharePct)} dari 6 outlet`,
      ])}`,
    stay &&
      `okupansi ${pct(stay.occPct) ?? "belum ada data"} (bulan lalu ${pct(stay.prevOccPct) ?? "belum ada data"}); segmen tamu FIT ${pct(stay.segmentMixPct.fit)}, walk-in ${pct(stay.segmentMixPct.walkIn)}, OTA ${pct(stay.segmentMixPct.ota)}, korporat ${pct(stay.segmentMixPct.corp)}, lainnya ${pct(stay.segmentMixPct.other)}`,
    stay && stay.roomTypesByShare.length > 0 &&
      `tipe kamar terjual: ${stay.roomTypesByShare.slice(0, MAX_MENUS).map((r) => `${r.name} ${pct(r.nightsSharePct)} malam`).join(", ")}`,
    menu && menu.topMenus.length > 0 && `menu terlaris (porsi penjualan): ${menu.topMenus.slice(0, MAX_MENUS).map((m) => `${m.description} ${pct(m.salesSharePct)}`).join(", ")}`,
    menu && `menu lambat ${menu.slowMenuCount}, menu tidak terjual 90 hari ${menu.deadMenuCount}`,
    promo && promo.totalAudited > 0 && `audit promo: ${promo.naikCount} menaikkan penjualan, ${promo.tidakNaikCount} tidak, dari ${promo.totalAudited}`,
    acq?.waClosingRatePct !== null && acq?.waClosingRatePct !== undefined && `closing WhatsApp ${pct(acq.waClosingRatePct)}`,
    p.activePromos.length > 0 && `promo/event berjalan: ${p.activePromos.slice(0, MAX_PROMOS).map((x) => x.title).join(" | ")}`,
    p.facilities.length > 0 && `fasilitas: ${p.facilities.slice(0, MAX_PROMOS + 2).join(", ")}`,
  ])}`;
}

function competitorLine(ctx: OutletKnowledgeContext): string | null {
  const label = ctx.sanghyang?.label ?? ctx.outletKey;
  const list = ctx.competitors.filter((c) => c.role === "pesaing").slice(0, MAX_COMPETITORS);
  if (!list.length) return null;
  return `- ${label}: ${list
    .map((c) => `${c.name}${c.roadKm ? ` (${c.roadKm})` : ""}${c.ratingFact ? `, ${c.ratingFact}` : ""}${c.holisticScore !== null ? `, skor kemiripan ${c.holisticScore}` : ""}`)
    .join("; ")}`;
}

/** Teks ringkasan dari konteks per outlet; fungsi murni supaya isinya bisa diuji tanpa basis data. */
export function formatKnowledgeGraphGrounding(contexts: OutletKnowledgeContext[], builtAtWib: string): string {
  const first = contexts[0];
  const macro = first?.macro;
  const lines = [
    `KONTEKS KNOWLEDGE GRAPH SANGHYANG (periode ${first?.rangeLabel ?? "belum ada data"}; dibangun ${builtAtWib} WIB).`,
    "Pakai sebagai latar belakang tentang Sanghyang Indah Spa Resort, enam unit bisnisnya, kompetitor, dan pasar Anyer–Carita. " +
      "Bila tugas meminta isi dari teks, halaman, atau gambar sumber, jawaban tetap hanya berisi hal yang tertulis di sumber itu; " +
      "jangan memindahkan fakta dari konteks ini ke jawaban. Konteks ini tidak memuat nominal omset rupiah Sanghyang.",
    "",
    "Unit bisnis Sanghyang:",
    ...contexts.map(outletLine).filter((l): l is string => l !== null),
    "",
    "Kompetitor inti per unit bisnis:",
    ...contexts.map(competitorLine).filter((l): l is string => l !== null),
  ];
  if (macro?.tpkPercent !== null && macro?.tpkPercent !== undefined) lines.push("", `Makro: TPK hotel bintang Banten ${pct(macro.tpkPercent)}${macro.tpkPeriod ? ` (${macro.tpkPeriod})` : ""}.`);
  return lines.join("\n");
}

let memo: { at: number; day: string; text: Promise<string> } | null = null;

/** Ringkasan graf 30 hari terakhir untuk dikirim ke AI; galat membangun graf dilempar, tidak diganti teks kosong. */
export function knowledgeGraphGrounding(now: Date = new Date()): Promise<string> {
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  if (memo && memo.day === day && now.getTime() - memo.at < MEMO_MS) return memo.text;
  const text = (async () => {
    const range = presetRange("30d", now);
    const graph = await buildKnowledgeGraph(range);
    const label = rangeLabel(range);
    const builtAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(now);
    return formatKnowledgeGraphGrounding(OWN_OUTLETS.map((key) => buildOutletKnowledgeContext(graph, key, label)), builtAt);
  })();
  memo = { at: now.getTime(), day, text };
  // Pembangunan yang gagal tidak boleh tersimpan sebagai memo; panggilan berikutnya mencoba membangun lagi.
  text.catch(() => {
    if (memo?.text === text) memo = null;
  });
  return text;
}
