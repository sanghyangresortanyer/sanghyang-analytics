/**
 * Serializer konteks pengetahuan bisnis berbobot (Weighted Knowledge Graph context) untuk analis pasar
 * dan pelaporan lintas modul. Mengambil subgraf terstruktur per outlet Sanghyang (atau "all"), memadukan
 * skor & faktor relevansi holistik kompetitor, tipe kamar resmi, tarif OTA + status sarapan, fasilitas,
 * visual/galeri, menu, ulasan, promo/event terpisah, media sosial (IG & TikTok), strategi/target,
 * serta ringkasan sintesis berbobot lintas modul aplikasi.
 */
import crypto from "node:crypto";
import type { InternalOutletSignals } from "../analytics/internal-signals-types";
import type { OutletKey } from "../market/outlet-filters";
import {
  APP_MODULES,
  APP_MODULE_META,
  type AppModuleKey,
  type GraphLinkFactor,
  type KnowledgeGraph,
} from "./types";

export interface CitationItem {
  label: string;
  url: string | null;
  observedAt: string | null;
}

export interface SanghyangOutletProfile {
  outletKey: string;
  nodeId: string;
  label: string;
  ratingFact: string | null;
  pricing: {
    roomRates: string[];
    menuItemCount: number;
    sampleMenuItems: string[];
  };
  officialRoomTypes: string[];
  facilities: string[];
  visualStyle: {
    designStyle?: string;
    ambience?: string;
    elements?: string[];
  };
  activePromos: {
    id: string;
    title: string;
    kind: "promo" | "event";
    category: string;
    discount: string | null;
    source: string;
  }[];
  social: {
    accounts: string[];
    followersText: string | null;
    postsCount: number;
    likesText: string | null;
  };
  strategyNotes: string[];
  revenueNote: string | null;
  internalSignals: InternalOutletSignals | null;
}

export interface CompetitorContextProfile {
  id: string;
  nodeId: string;
  name: string;
  role: "pesaing" | "acuan";
  category: string | null;
  starRating: string | null;
  roadKm: string | null;
  ratingFact: string | null;
  holisticScore: number | null;
  holisticFactors: GraphLinkFactor[];
  edgeWeight: number | null;
  facilities: string[];
  visualStyle: {
    designStyle?: string;
    ambience?: string;
    elements?: string[];
  };
  pricing: {
    roomRates: string[];
    menuItems: string[];
    perPersonRange: string | null;
  };
  activePromos: {
    title: string;
    kind: "promo" | "event";
    category: string;
    discount: string | null;
  }[];
  reviewThemes: {
    theme: string;
    total: number;
    negative: number;
  }[];
}

export interface MacroIndicators {
  tpkPercent: number | null;
  tpkPeriod: string | null;
  marketCapMonthly: string | null;
}

export interface WeightedSynthesisSummary {
  averageHolisticScore: number | null;
  topWeightedCompetitors: {
    name: string;
    score: number;
    topFactors: string[];
  }[];
  moduleCoverage: {
    module: AppModuleKey;
    label: string;
    nodeCount: number;
    linkCount: number;
  }[];
  strongestSignals: {
    from: string;
    to: string;
    label: string;
    weight: number;
  }[];
  breakfastSummary: string[];
}

export interface OutletKnowledgeContext {
  outletKey: string;
  rangeLabel: string;
  sanghyang: SanghyangOutletProfile | null;
  sanghyangProfiles: SanghyangOutletProfile[];
  competitors: CompetitorContextProfile[];
  citations: CitationItem[];
  macro: MacroIndicators;
  weightedSynthesis: WeightedSynthesisSummary;
  digestHash: string;
  summaryStats: {
    competitorCount: number;
    excludedCount: number;
    promoCount: number;
    eventCount: number;
    reviewTopicCount: number;
    connectedModulesCount: number;
  };
}

const OWN_OUTLET_KEYS = ["resort", "sunset-grill", "dragon-beach-club", "dbistro", "dspa", "dbar"] as const;

function extractProfileForOutlet(graph: KnowledgeGraph, key: string): SanghyangOutletProfile | null {
  const nodeId = `outlet:${key}`;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const linkedTargetIds = new Set(graph.links.filter((l) => l.source === nodeId).map((l) => l.target));
  const linkedSourceIds = new Set(graph.links.filter((l) => l.target === nodeId).map((l) => l.source));
  const linkedIds = new Set([...linkedTargetIds, ...linkedSourceIds]);

  const fasilitasNode = graph.nodes.find((n) => n.id === `fasilitas:${nodeId}`);
  const visualNode = graph.nodes.find((n) => n.id === `visual:${nodeId}`);
  const menuNode = graph.nodes.find((n) => n.id === `menu:${nodeId}`);
  const rateNode = graph.nodes.find((n) => n.id === `statistik:tarif:${nodeId}`);
  const sosmedNode = graph.nodes.find((n) => n.id === `sosmed:${nodeId}`);
  const kinerjaNode = graph.nodes.find((n) => n.id === `operasional:kinerja:${key}`);
  const roomNodes = graph.nodes.filter((n) => n.kind === "kamar" && (linkedIds.has(n.id) || n.outlets.includes(key)));
  const strategyNodes = graph.nodes.filter((n) => n.kind === "strategi" && (linkedIds.has(n.id) || n.outlets.includes(key)));
  const internalSignals = graph.internalSignals?.[key as OutletKey] ?? null;

  let menuItemCount = 0;
  const sampleMenuItems: string[] = [];
  if (menuNode) {
    for (const d of menuNode.detail) {
      const m = d.match(/(\d+)\s+item\s+menu/);
      if (m) menuItemCount = Number(m[1]);
      else if (!d.startsWith("Rentang harga")) sampleMenuItems.push(d);
    }
  }

  const promoNodes = graph.nodes.filter(
    (n) => (n.kind === "promo-sanghyang" || n.kind === "event-sanghyang") && (linkedIds.has(n.id) || n.outlets.includes(key)),
  );

  const ratingFact = node.detail.find((d) => d.startsWith("Rating")) ?? null;

  return {
    outletKey: key,
    nodeId,
    label: node.label,
    ratingFact,
    pricing: {
      roomRates: rateNode?.detail ?? [],
      menuItemCount,
      sampleMenuItems,
    },
    officialRoomTypes: roomNodes.map((rn) => `${rn.label}: ${rn.detail.slice(0, 3).join("; ")}`),
    facilities: fasilitasNode?.detail ?? [],
    visualStyle: {
      designStyle: visualNode?.detail.find((d) => d.startsWith("Gaya:"))?.replace(/^Gaya:\s*/, ""),
      ambience: visualNode?.detail.find((d) => d.startsWith("Suasana:"))?.replace(/^Suasana:\s*/, ""),
      elements: visualNode?.detail.filter((d) => !d.startsWith("Gaya:") && !d.startsWith("Suasana:")),
    },
    activePromos: promoNodes.map((p) => ({
      id: p.id,
      title: p.label,
      kind: p.kind === "event-sanghyang" ? "event" : "promo",
      category: p.detail.find((d) => d.startsWith("Kategori"))?.replace(/^Kategori\s*/, "") ?? "",
      discount: p.detail.find((d) => d.startsWith("Diskon"))?.replace(/^Diskon\s*/, "") ?? null,
      source: p.sources[0]?.label ?? "",
    })),
    social: {
      accounts: sosmedNode?.detail.find((d) => d.startsWith("Akun resmi:"))?.replace(/^Akun resmi:\s*/, "").split(", ") ?? [],
      followersText: sosmedNode?.detail.find((d) => d.includes("pengikut")) ?? null,
      postsCount: Number(sosmedNode?.detail.find((d) => d.includes("postingan"))?.match(/(\d+)\s+postingan/)?.[1] ?? 0),
      likesText: sosmedNode?.detail.find((d) => d.includes("suka")) ?? null,
    },
    strategyNotes: strategyNodes.flatMap((sn) => [sn.label, ...sn.detail.slice(0, 2)]),
    revenueNote: kinerjaNode?.label ?? null,
    internalSignals,
  };
}

export function buildOutletKnowledgeContext(graph: KnowledgeGraph, outletKey: string, rangeLabel: string): OutletKnowledgeContext {
  const isAll = outletKey === "all";
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 1. Profil Sanghyang
  const sanghyangProfiles: SanghyangOutletProfile[] = [];
  for (const key of OWN_OUTLET_KEYS) {
    const prof = extractProfileForOutlet(graph, key);
    if (prof) sanghyangProfiles.push(prof);
  }

  const primaryProfile = isAll
    ? sanghyangProfiles.find((p) => p.outletKey === "resort") ?? sanghyangProfiles[0] ?? null
    : sanghyangProfiles.find((p) => p.outletKey === outletKey) ?? null;

  // 2. Kompetitor aktif saja (diurutkan kompetitor inti dulu, lalu skor holistik tertinggi)
  const competitorNodes = graph.nodes
    .filter((n) => (n.kind === "pesaing" || n.kind === "acuan") && (isAll || n.outlets.includes(outletKey)))
    .sort((a, b) => {
      const roleDiff = (a.kind === "pesaing" ? 0 : 1) - (b.kind === "pesaing" ? 0 : 1);
      if (roleDiff !== 0) return roleDiff;
      return (b.holisticScore ?? 0) - (a.holisticScore ?? 0) || a.label.localeCompare(b.label, "id");
    });
  const excludedCount = graph.nodes.filter(
    (n) => n.kind === "dikeluarkan" && (isAll || n.outlets.includes(outletKey)),
  ).length;

  const competitors: CompetitorContextProfile[] = [];
  for (const cn of competitorNodes) {
    const cid = cn.id;
    const linkedTargetIds = new Set(graph.links.filter((l) => l.source === cid).map((l) => l.target));
    const linkedSourceIds = new Set(graph.links.filter((l) => l.target === cid).map((l) => l.source));
    const linkedIds = new Set([...linkedTargetIds, ...linkedSourceIds]);

    const outletLink = !isAll
      ? graph.links.find((l) => l.source === `outlet:${outletKey}` && l.target === cid)
      : graph.links.find((l) => l.source.startsWith("outlet:") && l.target === cid);

    const fasilitasNode = graph.nodes.find((n) => n.id === `fasilitas:${cid}`);
    const visualNode = graph.nodes.find((n) => n.id === `visual:${cid}`);
    const rateNode = graph.nodes.find((n) => n.id === `statistik:tarif:${cid}`);
    const menuNode = graph.nodes.find((n) => n.id === `menu:${cid}`);

    const promoNodes = graph.nodes.filter((n) => (n.kind === "promo" || n.kind === "event") && linkedIds.has(n.id));

    const reviewThemes: { theme: string; total: number; negative: number }[] = [];
    for (const l of graph.links) {
      if (l.source === cid && l.target.startsWith("tema:")) {
        const themeNode = nodeById.get(l.target);
        if (themeNode) {
          const match = l.label.match(/(\d+)\s+ulasan(?:,\s*(\d+)\s+negatif)?/);
          reviewThemes.push({
            theme: themeNode.label,
            total: match ? Number(match[1]) : 1,
            negative: match && match[2] ? Number(match[2]) : 0,
          });
        }
      }
    }

    const starRating = cn.detail.find((d) => d.startsWith("Bintang")) ?? null;
    const roadKm = cn.detail.find((d) => d.includes("km jarak tempuh")) ?? null;
    const ratingFact = cn.detail.find((d) => d.startsWith("Rating")) ?? null;
    const category = cn.detail.find((d) => d.startsWith("Kategori"))?.replace(/^Kategori\s*/, "") ?? null;

    const holisticScore = outletLink?.weight ?? cn.holisticScore ?? null;
    const holisticFactors = outletLink?.factors ?? cn.holisticFactors ?? [];

    competitors.push({
      id: cid.replace(/^tempat:/, ""),
      nodeId: cid,
      name: cn.label,
      role: cn.kind as "pesaing" | "acuan",
      category,
      starRating,
      roadKm,
      ratingFact,
      holisticScore,
      holisticFactors,
      edgeWeight: outletLink?.weight ?? null,
      facilities: fasilitasNode?.detail ?? [],
      visualStyle: {
        designStyle: visualNode?.detail.find((d) => d.startsWith("Gaya:"))?.replace(/^Gaya:\s*/, ""),
        ambience: visualNode?.detail.find((d) => d.startsWith("Suasana:"))?.replace(/^Suasana:\s*/, ""),
        elements: visualNode?.detail.filter((d) => !d.startsWith("Gaya:") && !d.startsWith("Suasana:")),
      },
      pricing: {
        roomRates: rateNode?.detail ?? [],
        menuItems: menuNode?.detail.filter((d) => !d.startsWith("Perkiraan per orang") && !d.includes("item menu")) ?? [],
        perPersonRange: menuNode?.detail.find((d) => d.startsWith("Perkiraan per orang")) ?? null,
      },
      activePromos: promoNodes.map((p) => ({
        title: p.label,
        kind: p.kind === "event" ? "event" : "promo",
        category: p.detail.find((d) => d.startsWith("Kategori"))?.replace(/^Kategori\s*/, "") ?? "",
        discount: p.detail.find((d) => d.startsWith("Diskon"))?.replace(/^Diskon\s*/, "") ?? null,
      })),
      reviewThemes,
    });
  }

  // 3. Indikator makro
  const tpkNode = graph.nodes.find((n) => n.id === "statistik:tpk");
  let tpkPercent: number | null = null;
  let tpkPeriod: string | null = null;
  if (tpkNode) {
    const tpkMatch = tpkNode.label.match(/(\d+(?:[.,]\d+)?)%/);
    if (tpkMatch) tpkPercent = Number(tpkMatch[1].replace(",", "."));
    const periodMatch = tpkNode.label.match(/\(([^)]+)\)/);
    if (periodMatch) tpkPeriod = periodMatch[1];
  }

  const marketCapNode = graph.nodes.find((n) => n.id === "statistik:market-cap");
  const macro: MacroIndicators = {
    tpkPercent,
    tpkPeriod,
    marketCapMonthly: marketCapNode?.label ?? null,
  };

  // 4. Ringkasan Sintesis Berbobot lintas modul
  const scoredCompetitors = competitors.filter((c): c is CompetitorContextProfile & { holisticScore: number } => c.holisticScore !== null);
  const averageHolisticScore = scoredCompetitors.length
    ? Math.round((scoredCompetitors.reduce((s, c) => s + c.holisticScore, 0) / scoredCompetitors.length) * 10) / 10
    : null;
  const topWeightedCompetitors = scoredCompetitors.slice(0, 5).map((c) => ({
    name: c.name,
    score: c.holisticScore,
    topFactors: [...c.holisticFactors]
      .sort((a, b) => b.score * b.weight - a.score * a.weight)
      .slice(0, 3)
      .map((f) => `${f.label} (${f.score})`),
  }));

  const relevantNodes = graph.nodes.filter(
    (n) => n.kind !== "dikeluarkan" && (isAll || n.outlets.includes(outletKey) || n.kind === "statistik" || n.kind === "kawasan"),
  );
  const relevantNodeIds = new Set(relevantNodes.map((n) => n.id));
  const relevantLinks = graph.links.filter((l) => relevantNodeIds.has(l.source) && relevantNodeIds.has(l.target));

  const moduleCoverage = APP_MODULES.map((mod) => {
    const modNodes = relevantNodes.filter((n) => n.modules?.includes(mod));
    const modLinks = relevantLinks.filter((l) => l.modules?.includes(mod));
    return {
      module: mod,
      label: APP_MODULE_META[mod].label,
      nodeCount: modNodes.length,
      linkCount: modLinks.length,
    };
  }).filter((m) => m.nodeCount > 0 || m.linkCount > 0);

  const strongestSignals = relevantLinks
    .filter((l) => typeof l.weight === "number")
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 8)
    .map((l) => ({
      from: nodeById.get(l.source)?.label ?? l.source,
      to: nodeById.get(l.target)?.label ?? l.target,
      label: l.label,
      weight: l.weight ?? 0,
    }));

  const breakfastSummary = relevantNodes
    .filter((n) => n.id.startsWith("statistik:tarif:"))
    .flatMap((n) => n.detail.filter((d) => d.startsWith("Status sarapan")).map((d) => `${n.label}: ${d}`))
    .slice(0, 6);

  const weightedSynthesis: WeightedSynthesisSummary = {
    averageHolisticScore,
    topWeightedCompetitors,
    moduleCoverage,
    strongestSignals,
    breakfastSummary,
  };

  // 5. Citations (provenans sumber lengkap)
  const citationMap = new Map<string, CitationItem>();
  const addSource = (s: { label: string; url: string | null }, observedAt: string | null) => {
    const key = `${s.label}|${s.url ?? ""}`;
    if (!citationMap.has(key)) {
      citationMap.set(key, { label: s.label, url: s.url, observedAt });
    }
  };
  for (const n of relevantNodes) {
    for (const s of n.sources) addSource(s, n.observedAt);
  }
  const citations = [...citationMap.values()];

  // 6. SHA-256 Digest Hash. Daftar judul promo diurutkan di sini karena urutan barisnya berasal dari ORDER BY basis data,
  // yang hasilnya bergantung pada collation (Postgres lokal dan Supabase berbeda); tanpa itu sidik jari narasi yang sama
  // berbeda antara localhost dan produksi.
  const titlesInOrder = (titles: string[]) => [...titles].sort((a, b) => a.localeCompare(b, "id"));
  const hashPayload = {
    outletKey,
    rangeLabel,
    sanghyangName: primaryProfile?.label ?? null,
    sanghyangPricing: primaryProfile?.pricing ?? null,
    sanghyangPromos: titlesInOrder(primaryProfile?.activePromos.map((p) => p.title) ?? []),
    internalSignals: isAll
      ? sanghyangProfiles.map((p) => ({ outletKey: p.outletKey, signals: p.internalSignals }))
      : (primaryProfile?.internalSignals ?? null),
    competitors: competitors.map((c) => ({
      name: c.name,
      role: c.role,
      holisticScore: c.holisticScore,
      rating: c.ratingFact,
      rates: c.pricing.roomRates,
      promos: titlesInOrder(c.activePromos.map((p) => p.title)),
    })),
    macro,
    moduleCoverage,
    citationsCount: citations.length,
  };

  const digestHash = crypto.createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");

  const allOffers = [...(primaryProfile?.activePromos ?? []), ...competitors.flatMap((c) => c.activePromos)];
  const eventCount = allOffers.filter((o) => o.kind === "event").length;

  return {
    outletKey,
    rangeLabel,
    sanghyang: primaryProfile,
    sanghyangProfiles,
    competitors,
    citations,
    macro,
    weightedSynthesis,
    digestHash,
    summaryStats: {
      competitorCount: competitors.length,
      excludedCount,
      promoCount: allOffers.length,
      eventCount,
      reviewTopicCount: competitors.reduce((acc, c) => acc + c.reviewThemes.length, 0),
      connectedModulesCount: moduleCoverage.length,
    },
  };
}
