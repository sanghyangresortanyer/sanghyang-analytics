/**
 * Analisis per outlet dari Knowledge Graph lewat model di .env, dijalankan langkah penyegaran setelah data baru masuk.
 *
 * Insight Pasar dan laporan PDF memanggil synthesizeOutletAnalysis dalam mode deterministik supaya halaman tidak
 * memanggil model; mode itu lebih dulu membaca simpanan MarketInsight dengan sidik jari yang sama (outlet, label periode,
 * dan isi konteks graf). Fungsi ini mengisi simpanan tersebut, jadi narasi dan rekomendasi yang tampil memakai model
 * selama datanya belum berubah sejak penyegaran.
 */
import { OutletAnalysisError, synthesizeOutletAnalysis, type OutletAnalysisResult, type SynthesizeOptions } from "../ai/market-analyst";
import { rangeLabel, type DayRange } from "../market/date-range";
import { OUTLET_KEYS, type OutletKey } from "../market/outlet-filters";
import { buildKnowledgeGraph } from "./build";
import { buildOutletKnowledgeContext } from "./context";

export interface RefreshedOutletAnalysis {
  outletKey: OutletKey;
  /**
   * Analisis yang dibaca Insight Pasar untuk outlet ini sesudah penyegaran: "live" = hasil model baru yang sudah
   * tersimpan, "cache" = simpanan yang sudah ada, "deterministic" = susunan otomatis (kunci kosong, model gagal, atau hasil
   * model gagal disimpan).
   */
  origin: OutletAnalysisResult["origin"];
  fingerprint: string;
  /** Alasan outlet ini memakai susunan otomatis karena galat model atau galat simpan; null bila tidak ada galat. */
  failure: string | null;
}

export async function refreshOutletAnalysesFromGraph(
  range: DayRange,
  outlets: readonly OutletKey[] = OUTLET_KEYS,
  opts?: Pick<SynthesizeOptions, "generate">,
): Promise<RefreshedOutletAnalysis[]> {
  const graph = await buildKnowledgeGraph(range);
  const label = rangeLabel(range);
  const results: RefreshedOutletAnalysis[] = [];
  // Berurutan, bukan paralel: kuota model dibatasi per menit.
  for (const outletKey of outlets) {
    try {
      const analysis = await synthesizeOutletAnalysis(buildOutletKnowledgeContext(graph, outletKey, label), opts);
      results.push({ outletKey, origin: analysis.origin, fingerprint: analysis.fingerprint, failure: null });
    } catch (error) {
      if (!(error instanceof OutletAnalysisError)) throw error;
      // ZERO-FALLBACK: satu outlet yang gagal tidak menghentikan outlet lain. Outlet ini tetap tampil dengan susunan
      // otomatis, dan hasilnya membawa alasan galat supaya langkah analisis_graf melapor gagal atau sebagian, bukan berhasil.
      console.error(`[analisis_graf] ${outletKey}: ${error.message}`, error.cause ?? "");
      results.push({ outletKey, origin: "deterministic", fingerprint: error.fingerprint, failure: error.message });
    }
  }
  return results;
}
