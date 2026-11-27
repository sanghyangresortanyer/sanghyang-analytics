import { Network } from "lucide-react";
import { SkeuoCard } from "@/components/skeuo/ui";
import { knowledgeAnalysisOriginText, sanitizeStrategyText, type SnSummary } from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";

type OutletAnalysis = NonNullable<NonNullable<SnSummary["outletAnalyses"]>[string]>;

const PRIORITY_STYLE: Record<string, string> = {
  tinggi: "bg-red-100 text-red-800",
  sedang: "bg-amber-100 text-amber-900",
  rendah: "bg-cream-200 text-navy-700",
};

/**
 * Rekomendasi periode dari kesimpulan Knowledge Graph (langkah analisis_graf saat Perbarui Semua Data dan jadwal malam):
 * data pasar ditambah sinyal operasional VHP, disusun ulang setiap pembaruan data.
 */
export function SnKnowledgeRecommendations({ analysis, outletLabel }: { analysis: OutletAnalysis | null | undefined; outletLabel: string }) {
  const recommendations = analysis?.periodRecommendations ?? [];
  return (
    <SkeuoCard className="space-y-4">
      <div className="border-b border-cream-300 pb-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-navy-500">
          <Network className="h-3.5 w-3.5" aria-hidden /> Knowledge Graph
        </p>
        <h3 className="mt-0.5 text-lg font-semibold text-navy-900">Rekomendasi dari Knowledge Graph ({outletLabel})</h3>
        <p className="mt-0.5 text-xs text-navy-600">{knowledgeAnalysisOriginText(analysis) ?? "Belum ada data"}</p>
      </div>
      {recommendations.length > 0 ? (
        <ol className="divide-y divide-cream-200 rounded-2xl border border-cream-300 bg-white px-4">
          {recommendations.map((rec) => (
            <li key={`${rec.factor}|${rec.finding}`} className="space-y-1.5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", PRIORITY_STYLE[rec.priority] ?? PRIORITY_STYLE.rendah)}>
                  Prioritas {rec.priority}
                </span>
                <span className="text-xs font-bold uppercase tracking-wide text-navy-800">{rec.factor}</span>
                {rec.aarrrStage && <span className="text-[11px] text-navy-600">{rec.aarrrStage}</span>}
                {rec.horizon && <span className="text-[11px] text-navy-600">· {rec.horizon.replace("-", " ")}</span>}
              </div>
              <p className="text-navy-900">{sanitizeStrategyText(rec.finding)}</p>
              <p className="text-xs leading-relaxed text-navy-700">
                <strong className="text-navy-900">Langkah:</strong> {sanitizeStrategyText(rec.action)}
              </p>
              <p className="text-xs leading-relaxed text-navy-700">
                <strong className="text-navy-900">Pantau:</strong> {sanitizeStrategyText(rec.metricToWatch)}
              </p>
              {rec.evidenceSources.length > 0 && (
                <p className="text-[11px] text-navy-500">Sumber: {rec.evidenceSources.map(sanitizeStrategyText).join(" · ")}</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-cream-300 bg-white p-4 text-sm text-navy-600">Belum ada data</p>
      )}
    </SkeuoCard>
  );
}
