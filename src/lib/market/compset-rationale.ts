/**
 * Teks "Audit pembanding" per tempat terhadap Sanghyang: dua sampai empat kalimat pendek yang seluruhnya dibangun dari
 * data bersumber, sama untuk web dan PDF.
 * - Kamar & Resort: posisi tarif terhadap rentang tarif per malam Sanghyang, tipe kamar (unit 2+ kamar tidur seperti
 *   kondominium keluarga Sanghyang), fasilitas resor, lalu kelebihan kompetitor dan kelebihan Sanghyang.
 * - Resto, bar, dan spa: jenis dan letak, harga menu sebanding, kesamaan konsep menurut skor holistik, lalu kelebihan
 *   masing-masing.
 * Tanpa nama tempat yang ditanam di kode, tanpa kutipan berbahasa Inggris, dan tanpa nama mesin AI maupun alat perayap.
 */
import { compsetIneligibility, isLodging, parseCompsetRole } from "./compset";
import type { HolisticScoreResult } from "./competitor-holistic-matcher";
import { isAddon, menuPriceRange, type CompetitorMenu } from "./competitor-menu";
import { getHotelRoomTypes, sanitizeAiModelText, type HotelRoomTypesProfile } from "./hotel-room-types";
import { OUTLET_KEYS, isOutletKey, type OutletKey } from "./outlet-filters";
import type { PlaceSpecs } from "./place-specs";

/** Fakta situs resmi (CompetitorFact) dalam bentuk teks. */
export interface RationaleFact {
  key: string;
  text: string;
  observedAt: Date;
}

export interface RationalePlace {
  name: string;
  placeId?: string | null;
  category: string | null;
  outlets: string[];
  starRating: number | null;
  roomCount: number | null;
  roadKm: number | null;
  driveMinutes: number | null;
  distanceSource: string | null;
  rating: number | null;
  reviewCount: number | null;
  compsetRole: string | null;
  facts: RationaleFact[];
  /** Hotel induk untuk restoran, bar, atau spa di dalam hotel pembanding, beserta fakta situs resminya. */
  parent: { name: string; starRating: number | null; facts: RationaleFact[] } | null;
  /** Spesifikasi fasilitas multi-sumber (Smart TV, bathtub, kolam, hot spring, desain). */
  specs?: PlaceSpecs | null;
  /** Profil tipe kamar terverifikasi (dari loadDynamicHotelRoomTypes). */
  roomTypesProfile?: HotelRoomTypesProfile | null;
}

/** Posisi tarif rata-rata kompetitor terhadap rentang tarif per malam Sanghyang pada jendela tanggal yang sama. */
export interface RationalePriceSegment {
  position: "dalam" | "di atas" | "di bawah";
  /** Tarif rata-rata kompetitor dibagi tarif rata-rata Sanghyang. */
  ratio: number;
  bandMin: number;
  bandMax: number;
}

export interface RationaleContext {
  /** Sanghyang sendiri: kelas bintang dan apakah situs resminya menyebut tepi laut. */
  own: { starRating: number | null; seaside: boolean };
  /** Baris pasar kamar (market-size.ts) untuk penginapan. */
  market: { stars: number | null; roomCountSource: string; priceVsSanghyang: number | null } | null;
  rates: { source: string; capturedAt: string } | null;
  menu: CompetitorMenu | null;
  /** Spesifikasi fasilitas Sanghyang untuk perbandingan langsung. */
  ownSpecs?: PlaceSpecs | null;
  /** Profil tipe kamar Sanghyang untuk perbandingan kesetaraan tipe kamar. */
  ownRoomTypes?: HotelRoomTypesProfile | null;
  /** Rating & jumlah ulasan Google Maps outlet Sanghyang terkait. */
  ownRating?: number | null;
  ownReviewCount?: number | null;
  /** Selisih harga rata-rata item sebanding kompetitor terhadap menu resmi Sanghyang (F&B). */
  comparableGap?: { percent: number; items: number } | null;
  /** Hasil skor kecocokan holistik 6 dimensi (diisi compset-audit.ts). */
  holistic?: HolisticScoreResult | null;
  /** Segmen tarif kamar terhadap Sanghyang (diisi compset-audit.ts untuk penginapan). */
  priceSegment?: RationalePriceSegment | null;
}

export interface SanghyangAuditInput {
  outlet: OutletKey;
  ownAdr?: number | null;
  ownRoomCount?: number | null;
  ownRating?: number | null;
  ownReviewCount?: number | null;
  ownSpecs?: PlaceSpecs | null;
  ownRoomTypes?: HotelRoomTypesProfile | null;
  ownMenuItemCount?: number;
  ownMenuRange?: { min: number; max: number } | null;
}

const OUTLET_LABEL: Record<OutletKey, string> = {
  "sunset-grill": "Sunset Grill",
  "dragon-beach-club": "Dragon Beach Club",
  resort: "Kamar & Resort",
  dbistro: "D'Bistro",
  dbar: "D'Bar & Karaoke",
  dspa: "D'Spa",
};

const KIND_LABEL: Record<string, string> = { resto: "Resto", bar: "Bar", spa: "Spa" };

const ID_WORDS = /(?<![\p{L}])(yang|dan|di|dengan|untuk|ini|dari|adalah|menyajikan|menawarkan|memiliki|tersedia|berupa|bagi)(?![\p{L}])/giu;
const EN_WORDS = /(?<![\p{L}])(the|and|is|of|with|our|offering|a|an|in|for|to|its)(?![\p{L}])/giu;
const PRIVATE_BEACH = /pantai pribadi|private beach/iu;

const TOOL_AND_OLD_TERMS_RE = /\b(crawl4ai|playwright)\b/gi;
const cleanRationaleText = (text: string) =>
  sanitizeAiModelText(text)
    .replace(TOOL_AND_OLD_TERMS_RE, "")
    .replace(/\bpesaing\b/gi, (m) => (m[0] === "P" ? "Kompetitor" : "kompetitor"))
    .replace(/\bregistri(?:\s+pembanding|\s+kompetitor)?\b/gi, (m) =>
      m[0] === "R" ? "Daftar kompetitor" : "daftar kompetitor",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const num = (n: number) => n.toLocaleString("id-ID");
const fmtArea = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));
const rupiah = (min: number, max: number) => (min === max ? `Rp ${num(min)}` : `Rp ${num(min)}–${num(max)}`);
const times = (ratio: number) => `${ratio.toFixed(1).replace(".", ",")} kali`;
const listOf = (items: string[]) =>
  items.length <= 2 ? items.join(" dan ") : `${items.slice(0, -1).join(", ")}, dan ${items[items.length - 1]}`;
const sentence = (text: string) => {
  const clean = text.trim();
  if (!clean) return "";
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}${/[.!?]$/.test(clean) ? "" : "."}`;
};

/** Teks fakta berbahasa Inggris tidak dikutip di laporan berbahasa Indonesia. */
function isIndonesian(text: string): boolean {
  const indonesian = text.match(ID_WORDS)?.length ?? 0;
  return indonesian > 0 && indonesian >= (text.match(EN_WORDS)?.length ?? 0);
}

const factOf = (facts: RationaleFact[], key: string) => facts.find((f) => f.key === key && f.text);

function areaBounds(profile: HotelRoomTypesProfile | null): { min: number | null; max: number | null } {
  if (!profile) return { min: null, max: null };
  const sizes = profile.roomTypes
    .map((r) => r.areaSqm)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!sizes.length) return { min: null, max: null };
  return { min: sizes[0], max: sizes[sizes.length - 1] };
}

const areaText = (min: number | null, max: number | null) =>
  min && max ? (min === max ? `${fmtArea(min)} m²` : `${fmtArea(min)}–${fmtArea(max)} m²`) : null;

/** Fasilitas resor sebuah tempat dari spesifikasi dan tipe kamar terverifikasi (null = belum ada data). */
function lodgingFacilities(specs: PlaceSpecs | null | undefined, profile: HotelRoomTypesProfile | null) {
  return {
    hotSpring: specs?.facilities.hotSpring ?? null,
    pool: specs?.facilities.infinityPool ?? null,
    smartTv: specs?.facilities.smartTv === true || profile?.roomTypes.some((r) => r.smartTv === true) === true ? true : (specs?.facilities.smartTv ?? null),
    bathtub: specs?.facilities.bathtub ?? (profile ? profile.roomTypes.some((r) => r.bathtub === true) : null),
  };
}

/** Kalimat dari skor holistik tanpa awalan "Konsep terhadap X:" atau "Fasilitas:". */
function reasonBody(reason: string | undefined): string | null {
  if (!reason) return null;
  const body = reason.replace(/^[^:]{0,60}:\s*/, "").trim();
  return body || null;
}

/**
 * Ringkasan posisi Sanghyang sendiri (baris pertama matriks Kamar & Resort serta 5 outlet F&B, bar, dan spa).
 */
export function sanghyangAuditSummary(input: SanghyangAuditInput): string {
  const specs = input.ownSpecs ?? null;
  if (input.outlet === "resort") {
    const profile = input.ownRoomTypes ?? getHotelRoomTypes("sanghyang");
    const totalTypes = profile?.roomTypes.length ?? 0;
    const multiUnits = (profile?.roomTypes ?? []).filter((r) => (r.bedrooms ?? 0) >= 2);
    const bounds = areaBounds(profile);
    const area = areaText(bounds.min, bounds.max);
    const ratePart = input.ownAdr ? `tarif dasar OTA Rp ${num(Math.round(input.ownAdr))}/malam` : null;
    const roomPart =
      totalTypes > 0 ? `${totalTypes} tipe kamar, ${multiUnits.length} di antaranya unit 2 kamar tidur${area ? `, ${area}` : ""}` : null;
    const head = [ratePart, roomPart].filter(Boolean).join("; ");
    const fac = lodgingFacilities(specs, profile);
    const strengths = [fac.hotSpring === true ? "air panas alami" : null, fac.pool === true ? "kolam infinity/laut" : null].filter(
      (s): s is string => s !== null,
    );
    const gaps = [fac.smartTv === false ? "belum ada Smart TV di kamar" : null].filter((s): s is string => s !== null);
    const tail = [strengths.length ? `Unggul di ${listOf(strengths)}` : null, gaps.length ? `celah: ${listOf(gaps)}` : null]
      .filter(Boolean)
      .join("; ");
    return cleanRationaleText(`Patokan Sanghyang${head ? ` (${head})` : ""}.${tail ? ` ${sentence(tail)}` : ""}`);
  }

  const parts: string[] = [];
  if (input.ownMenuItemCount && input.ownMenuItemCount > 0) {
    const rangeStr = input.ownMenuRange ? ` (${rupiah(input.ownMenuRange.min, input.ownMenuRange.max)})` : "";
    parts.push(`${num(input.ownMenuItemCount)} menu resmi${rangeStr}`);
  }
  if (input.ownRating != null) {
    parts.push(`rating Google ${num(input.ownRating)}${input.ownReviewCount ? ` (${num(input.ownReviewCount)} ulasan)` : ""}`);
  }
  const head = parts.length ? `Patokan ${OUTLET_LABEL[input.outlet]} (${parts.join(", ")}).` : `Outlet Sanghyang (${OUTLET_LABEL[input.outlet]}).`;
  // Konsep outlet sendiri dibaca dari fakta situs resmi (konsep desain), bukan kalimat yang ditanam di kode.
  const concept = specs?.facilities.designStyle ?? specs?.facilities.usp ?? null;
  const conceptSentence = concept && isIndonesian(concept) ? ` ${sentence(concept)}` : "";
  return cleanRationaleText(`${head}${conceptSentence}`);
}

function lodgingPriceSentence(ctx: RationaleContext): string | null {
  const seg = ctx.priceSegment;
  if (seg) {
    const pct = Math.round(seg.ratio * 100);
    if (seg.position === "di atas") {
      return `Tarif rata-rata ${times(seg.ratio)} Sanghyang, di atas tarif termurah akhir pekan Sanghyang (Rp ${num(seg.bandMax)}).`;
    }
    if (seg.position === "di bawah") {
      return `Tarif rata-rata hanya ${pct}% dari Sanghyang, di bawah tarif termurah hari biasa Sanghyang (Rp ${num(seg.bandMin)}).`;
    }
    if (pct === 100) return "Tarif rata-rata setara Sanghyang, satu segmen harga.";
    return pct > 100
      ? `Tarif rata-rata ${pct - 100}% di atas Sanghyang, masih satu segmen harga.`
      : `Tarif rata-rata ${100 - pct}% lebih murah dari Sanghyang, masih satu segmen harga.`;
  }
  const pct = ctx.market?.priceVsSanghyang;
  if (pct == null) return "Tarif OTA belum ada data.";
  if (pct === 100) return "Tarif rata-rata setara Sanghyang.";
  return pct > 100 ? `Tarif rata-rata ${pct - 100}% di atas Sanghyang.` : `Tarif rata-rata ${100 - pct}% lebih murah dari Sanghyang.`;
}

function lodgingRoomSentence(place: RationalePlace, ctx: RationaleContext, rivalProfile: HotelRoomTypesProfile | null): string | null {
  const fromScore = ctx.holistic?.dimensions.product.reason;
  if (fromScore) return fromScore;
  if (!rivalProfile || rivalProfile.roomTypes.length === 0) return null;
  const multi = rivalProfile.roomTypes.filter((r) => (r.bedrooms ?? 0) >= 2);
  const bounds = areaBounds(rivalProfile);
  const area = areaText(bounds.min, bounds.max);
  return multi.length
    ? `${multi.length} dari ${rivalProfile.roomTypes.length} tipe kamar adalah unit 2+ kamar tidur${area ? ` (${area})` : ""}.`
    : `Hanya kamar 1 ruang (${rivalProfile.roomTypes.length} tipe${area ? `, ${area}` : ""}), tanpa unit 2 kamar tidur seperti Sanghyang.`;
}

function buildLodgingRationale(place: RationalePlace, ctx: RationaleContext): string {
  const role = parseCompsetRole(place.compsetRole);
  const rivalProfile = place.roomTypesProfile ?? getHotelRoomTypes(place.placeId ?? place.name);
  const ownProfile = ctx.ownRoomTypes ?? getHotelRoomTypes("sanghyang");
  const rival = lodgingFacilities(place.specs, rivalProfile);
  const own = lodgingFacilities(ctx.ownSpecs, ownProfile);

  const sentences: string[] = [];
  const price = lodgingPriceSentence(ctx);
  if (price) sentences.push(price);
  const room = lodgingRoomSentence(place, ctx, rivalProfile);
  if (room) sentences.push(sentence(room));

  const rivalPros: string[] = [];
  if (rival.smartTv === true && own.smartTv !== true) rivalPros.push("Smart TV");
  if (rival.pool === true && own.pool !== true) rivalPros.push("kolam infinity");
  if (rival.bathtub === true && own.bathtub !== true) rivalPros.push("bathtub");
  const ownMin = areaBounds(ownProfile).min;
  const rivalMin = areaBounds(rivalProfile).min;
  if (ownMin !== null && rivalMin !== null && rivalMin >= ownMin + 5) {
    rivalPros.push(`kamar terkecil lebih luas (${fmtArea(rivalMin)} m² vs ${fmtArea(ownMin)} m²)`);
  }
  if (place.starRating != null && ctx.own.starRating != null && place.starRating > ctx.own.starRating) {
    rivalPros.push(`kelas bintang ${place.starRating}`);
  }
  const beachFact = factOf(place.facts, "pantai")?.text ?? "";
  if (PRIVATE_BEACH.test(beachFact) && isIndonesian(beachFact)) rivalPros.push("pantai pribadi");
  if (ctx.ownRating != null && place.rating != null && place.rating >= ctx.ownRating + 0.1) {
    rivalPros.push(`rating Google lebih tinggi (${num(place.rating)})`);
  }

  const ownPros: string[] = [];
  if (own.hotSpring === true && rival.hotSpring !== true) ownPros.push("air panas alami");
  if (own.pool === true && rival.pool !== true) ownPros.push("kolam infinity/laut");
  const productScore = ctx.holistic?.dimensions.product.score;
  const rivalLacksFamilyUnits =
    productScore !== undefined ? productScore <= 50 : rivalProfile !== null && !rivalProfile.hasMultiBedroomUnit;
  if (ownProfile?.hasMultiBedroomUnit && rivalLacksFamilyUnits) ownPros.push("unit keluarga 2 kamar tidur");
  if (ctx.priceSegment?.position === "di atas") ownPros.push("tarif lebih terjangkau");
  if (ctx.ownRating != null && place.rating != null && ctx.ownRating >= place.rating + 0.2) {
    ownPros.push(`rating tamu lebih tinggi (${num(ctx.ownRating)} vs ${num(place.rating)})`);
  }
  const prosCons = [
    rivalPros.length ? `Kompetitor unggul di ${listOf(rivalPros.slice(0, 3))}` : null,
    ownPros.length ? `Sanghyang unggul di ${listOf(ownPros.slice(0, 3))}` : null,
  ].filter(Boolean);
  if (prosCons.length) sentences.push(`${prosCons.join("; ")}.`);

  if (role === "benchmark") {
    const rule = compsetIneligibility({ category: place.category, starRating: place.starRating, roadKm: place.roadKm });
    const why =
      rule ??
      (ctx.priceSegment && ctx.priceSegment.position !== "dalam"
        ? `tarif ${ctx.priceSegment.position} rentang tarif Sanghyang (skor holistik ${ctx.holistic?.score ?? "belum ada data"}/100).`
        : ctx.holistic
          ? `skor holistik ${ctx.holistic.score}/100, di bawah ambang kompetitor inti.`
          : null);
    sentences.push(why ? `Acuan harga, tidak dihitung di pangsa pasar: ${why}` : "Acuan harga, tidak dihitung di pangsa pasar.");
  } else if (ctx.holistic && ctx.holistic.score > 0) {
    sentences.push(`Skor holistik ${ctx.holistic.score}/100.`);
  } else if (sentences.length === 0) {
    const bits = [
      place.starRating ? `Bintang ${place.starRating}` : null,
      place.roomCount ? `${num(place.roomCount)} kamar` : null,
      place.roadKm != null ? `${num(place.roadKm)} km dari Sanghyang` : null,
    ].filter(Boolean);
    sentences.push(sentence(bits.join(", ") || "Belum ada data pembanding"));
  }

  return cleanRationaleText(sentences.join(" "));
}

function buildVenueRationale(place: RationalePlace, outlet: string, ctx: RationaleContext): string {
  const ownOutlets = OUTLET_KEYS.filter((k) => place.outlets.includes(k));
  const target = isOutletKey(outlet) ? outlet : ownOutlets.length === 1 ? ownOutlets[0] : null;
  const kindWord = KIND_LABEL[place.category ?? ""] ?? "Tempat";
  const sentences: string[] = [];

  // 1. Jenis dan letak
  if (place.parent) {
    const starTag = place.parent.starRating ? ` (bintang ${place.parent.starRating})` : "";
    const kmTag = place.roadKm != null ? `, ${num(place.roadKm)} km` : "";
    sentences.push(`${kindWord} di dalam ${place.parent.name}${starTag}${kmTag}.`);
  } else {
    const distTag =
      place.roadKm != null
        ? `, ${num(place.roadKm)} km${place.driveMinutes ? ` atau ${place.driveMinutes} menit berkendara` : ""} dari Sanghyang`
        : "";
    sentences.push(`${kindWord} mandiri${distTag}.`);
  }

  // 2. Harga menu atau belanja per orang
  const menu = ctx.menu;
  const range = menu ? menuPriceRange(menu.items) : null;
  const pricedCount = menu ? menu.items.filter((i) => !isAddon(i)).length : 0;
  if (ctx.comparableGap && target) {
    const { percent, items } = ctx.comparableGap;
    const rangeNote = range ? `; rentang ${rupiah(range.min, range.max)}` : "";
    if (percent > 0) {
      sentences.push(`Menu sebanding ${num(percent)}% lebih mahal dari ${OUTLET_LABEL[target]} (${items} item${rangeNote}).`);
    } else if (percent < 0) {
      sentences.push(`Menu sebanding ${num(Math.abs(percent))}% lebih murah dari ${OUTLET_LABEL[target]} (${items} item${rangeNote}).`);
    } else {
      sentences.push(`Harga menu sebanding setara ${OUTLET_LABEL[target]} (${items} item${rangeNote}).`);
    }
  } else if (range) {
    sentences.push(`Harga menu ${rupiah(range.min, range.max)} (${num(pricedCount)} item tercatat).`);
  } else if (menu?.perPerson) {
    sentences.push(`Belanja ${rupiah(menu.perPerson.min, menu.perPerson.max)}/orang (Google Maps).`);
  } else {
    sentences.push("Harga menu belum ada data.");
  }

  // 3. Kesamaan konsep dari skor holistik (data menu, catatan, fakta, dan foto tempat itu)
  const likeness = reasonBody(ctx.holistic?.dimensions.concept.reason);
  if (likeness && target) {
    const cues = likeness.replace(/\.$/, "").split(/,\s*/).slice(0, 3);
    sentences.push(`Kesamaan: ${cues.join(", ")}.`);
  }

  // 4. Kelebihan kompetitor dan kelebihan Sanghyang
  const rivalPros: string[] = [];
  if (place.rating != null && place.reviewCount && place.reviewCount >= 50) {
    if (ctx.ownRating != null && place.rating >= ctx.ownRating + 0.1) {
      rivalPros.push(`rating ${num(place.rating)} dari ${num(place.reviewCount)} ulasan`);
    } else if (ctx.ownReviewCount != null && place.reviewCount >= 2 * ctx.ownReviewCount) {
      rivalPros.push(`ulasan Google lebih banyak (${num(place.reviewCount)} vs ${num(ctx.ownReviewCount)})`);
    }
  }
  if (ctx.comparableGap && ctx.comparableGap.percent <= -10) rivalPros.push("harga menu lebih murah");
  const ownPros: string[] = [];
  if (ctx.ownSpecs?.facilities.hotSpring === true && place.specs?.facilities.hotSpring !== true && target === "dspa") {
    ownPros.push("kolam air panas alami");
  }
  if (!place.parent && target !== "dspa") ownPros.push("akses langsung ke tamu menginap resor");
  if (ctx.comparableGap && ctx.comparableGap.percent >= 10) ownPros.push("harga menu lebih terjangkau");
  if (ctx.ownRating != null && place.rating != null && ctx.ownRating >= place.rating + 0.2) {
    ownPros.push(`rating lebih tinggi (${num(ctx.ownRating)} vs ${num(place.rating)})`);
  }
  if (target) {
    const prosCons = [
      rivalPros.length ? `Kompetitor unggul di ${listOf(rivalPros.slice(0, 2))}` : null,
      ownPros.length ? `Sanghyang unggul di ${listOf(ownPros.slice(0, 2))}` : null,
    ].filter(Boolean);
    if (prosCons.length) sentences.push(`${prosCons.join("; ")}.`);
  }

  // 5. Peran
  const scoreTag = ctx.holistic && ctx.holistic.score > 0 ? ` (skor holistik ${ctx.holistic.score}/100)` : "";
  if (parseCompsetRole(place.compsetRole) === "benchmark") {
    const rule = compsetIneligibility({
      category: place.category,
      starRating: place.starRating,
      roadKm: place.roadKm,
      reviewCount: place.reviewCount,
      insideLodging: place.parent !== null,
    });
    const where = target ? OUTLET_LABEL[target] : listOf(ownOutlets.map((k) => OUTLET_LABEL[k]));
    sentences.push(
      rule
        ? `Acuan ${where}, tidak dihitung di pangsa pasar: ${rule}`
        : place.parent
          ? `Acuan ${where}${scoreTag}, tidak dihitung di pangsa pasar karena hotel induknya berstatus acuan.`
          : `Acuan ${where}${scoreTag}, tidak dihitung di pangsa pasar inti.`,
    );
  } else if (!target) {
    sentences.push(`Pembanding ${listOf(ownOutlets.map((k) => OUTLET_LABEL[k]))}.`);
  } else {
    sentences.push(`Kompetitor inti ${OUTLET_LABEL[target]}${scoreTag}.`);
  }

  return cleanRationaleText(sentences.join(" "));
}

export function compsetRationale(place: RationalePlace, outlet: string, ctx: RationaleContext): string {
  if (isLodging(place.category)) {
    return buildLodgingRationale(place, ctx);
  }
  return buildVenueRationale(place, outlet, ctx);
}
