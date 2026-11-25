import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import {
  buildOutletCompetitorMatrices,
  FNB_MATRIX_COLUMNS,
  MATRIX_NO_DATA,
  RESORT_MATRIX_COLUMNS,
  type HotelMatrixEntry,
  type HotelRoomTypeMatrixSubRow,
} from "../../src/lib/market/competitor-matrix";
import { COMPSET_MAX_ROAD_KM, MIN_LODGING_STARS } from "../../src/lib/market/compset";
import { loadDynamicHotelRoomTypes, type HotelRoomTypesProfile } from "../../src/lib/market/hotel-room-types";
import { rupiah, rupiahRange } from "../../src/lib/market/menu-format";
import { OUTLET_KEYS } from "../../src/lib/market/outlet-filters";
import { loadDynamicCompetitorMenuItems, type DynamicCompetitorMenuRecord } from "../../src/lib/market/refresh-competitor-menus";
import {
  checkInLabel,
  crawlCapturedAtMs,
  isoDateWib,
  RESORT_RATE_EVIDENCE,
  RESORT_RATE_EVIDENCE_ALL,
  RESORT_ROOM_RATE_SOURCE,
  resolveRateWindow,
  resolvedRateWindowNote,
} from "../../src/lib/market/resort-room-rates";
import { buildExecutiveBreakfastParity } from "../../src/lib/market/resort-strategy";
import { buildExecutiveRoomEvaluation } from "../../src/lib/market/room-pricing-executive";
import { officialRoomRatesFor, officialRoomRatesSource } from "../../src/lib/market/official-room-rates";

after(() => db.$disconnect());

const AI_ENGINE_RE = /\b(gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm|crawl4ai)\b/i;
type Stay = "weekday" | "weekend";
const STAYS: Stay[] = ["weekday", "weekend"];

const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Semua harga yang benar-benar tercetak di sub-baris (baris situs resmi dan baris OTA termurah). */
function shownPrices(h: HotelMatrixEntry, stay: Stay): number[] {
  return h.roomTypes.flatMap((rt) =>
    [stay === "weekday" ? rt.officialRate?.weekdayPrice : rt.officialRate?.weekendPrice,
      stay === "weekday" ? rt.otaLowest?.weekdayPrice : rt.otaLowest?.weekendPrice].filter(valid),
  );
}

function summaryOf(h: HotelMatrixEntry, stay: Stay): { min: number | null; max: number | null } {
  return stay === "weekday"
    ? { min: h.otaRateWeekdayMin, max: h.otaRateWeekdayMax }
    : { min: h.otaRateWeekendMin, max: h.otaRateWeekendMax };
}

function assertSummaryMatchesSubRows(h: HotelMatrixEntry) {
  const sides: string[] = [];
  for (const stay of STAYS) {
    const prices = shownPrices(h, stay);
    const s = summaryOf(h, stay);
    if (prices.length === 0) {
      assert.equal(s.min, null, `${h.name} ${stay}: tanpa harga di sub-baris, ringkasan tidak boleh berangka`);
      assert.equal(s.max, null, `${h.name} ${stay}: tanpa harga di sub-baris, ringkasan tidak boleh berangka`);
      sides.push(MATRIX_NO_DATA);
      continue;
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    assert.equal(s.min, min, `${h.name} ${stay}: batas bawah ringkasan = harga terendah sub-baris`);
    assert.equal(s.max, max, `${h.name} ${stay}: batas atas ringkasan = harga tertinggi sub-baris`);
    sides.push(max > min ? `${rupiah(min)}–${rupiah(max)}` : rupiah(min));
  }
  const expected = sides.every((x) => x === MATRIX_NO_DATA) ? MATRIX_NO_DATA : sides.join(" / ");
  assert.equal(h.otaRateLabel, expected, `${h.name}: teks ringkasan tarif sama dengan sub-baris`);
}

async function inactiveCompetitorNames(): Promise<Set<string>> {
  const rows = await db.competitor.findMany({ where: { active: false }, select: { name: true } });
  return new Set(rows.map((r) => r.name));
}

test("competitor-matrix: 6 outlet dari daftar aktif DB, tanpa kompetitor arsip, kolom web lengkap", async () => {
  const [matrices, inactive] = await Promise.all([buildOutletCompetitorMatrices(), inactiveCompetitorNames()]);
  assert.deepEqual(Object.keys(matrices).sort(), [...OUTLET_KEYS].sort(), "semua 6 outlet tersedia");

  const resort = matrices.resort;
  assert.equal(resort.kind, "resort");
  assert.deepEqual(resort.columns, [...RESORT_MATRIX_COLUMNS]);
  for (const col of ["Tipe Kamar", "Luas", "Tarif kamar (biasa / akhir pekan)", "Audit pembanding"]) {
    assert.ok(resort.columns.includes(col), `kolom ${col} ada`);
  }
  assert.ok(!resort.columns.includes("Luas Kamar"), "nama kolom harus Luas, bukan Luas Kamar");
  assert.ok(!resort.columns.includes("Pembeda (situs resmi)"), "kolom terakhir harus Audit pembanding");

  const hotels = resort.hotelEntries ?? [];
  assert.ok(hotels.length >= 2, `Sanghyang + minimal 1 kompetitor aktif (ditemukan ${hotels.length})`);
  assert.equal(hotels[0].role, "sanghyang");
  assert.equal(hotels[0].name, "Sanghyang Indah Spa Resort");
  for (const h of hotels) {
    assert.ok(!inactive.has(h.name), `${h.name} diarsipkan, tidak boleh tampil di Langkah 3`);
    assert.notEqual(h.auditRationale, MATRIX_NO_DATA, `${h.name}: punya Audit pembanding`);
  }
  assert.equal(new Set(hotels.map((h) => h.auditRationale)).size, hotels.length, "setiap hotel punya Audit pembanding sendiri");

  // Semua tipe kamar Sanghyang dari situs resmi, termasuk unit 2 kamar tidur.
  assert.equal(hotels[0].roomTypes.length, 7, "Sanghyang memuat semua 7 tipe kamar");
  const krakatauVilla = hotels[0].roomTypes.find((r) => r.name === "Krakatau Villa");
  assert.ok(krakatauVilla, "Krakatau Villa ada di sub-baris Sanghyang");
  assert.equal(krakatauVilla.areaLabel, "70 m²");
  assert.equal(krakatauVilla.bedrooms, 2);
  const baduyCondo = hotels[0].roomTypes.find((r) => r.name === "New Baduy Condo");
  assert.ok(baduyCondo?.otaLowest, "New Baduy Condo punya baris OTA termurah");
  assert.equal(baduyCondo.areaLabel, "60 m²");

  for (const key of OUTLET_KEYS.filter((k) => k !== "resort")) {
    const m = matrices[key];
    assert.equal(m.kind, "fnb", `${key}: kind fnb`);
    assert.deepEqual(m.columns, [...FNB_MATRIX_COLUMNS], `${key}: 8 kolom seragam`);
    const entries = m.fnbEntries ?? [];
    assert.ok(entries.length >= 2, `${key}: minimal Sanghyang + 1 kompetitor`);
    assert.equal(entries[0].role, "sanghyang", `${key}: baris 1 adalah outlet Sanghyang`);
    for (const e of entries) {
      assert.ok(!inactive.has(e.name), `${key}/${e.name} diarsipkan, tidak boleh tampil`);
      assert.notEqual(e.auditRationale, MATRIX_NO_DATA, `${key}/${e.name}: Audit pembanding terisi`);
    }
  }

  const serialized = JSON.stringify(matrices);
  assert.doesNotMatch(serialized, AI_ENGINE_RE, "matriks bebas nama mesin AI dan alat perayap");
  assert.doesNotMatch(serialized, /\bregistri\b/i, "matriks bebas kata registri");
});

test("C12: rentang tarif baris ringkasan = harga terendah dan tertinggi di sub-baris (situs resmi + OTA) untuk setiap hotel", async () => {
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const hotels = matrices.resort.hotelEntries ?? [];
  for (const h of hotels) assertSummaryMatchesSubRows(h);
  const priced = hotels.filter((h) => h.otaRateLabel !== MATRIX_NO_DATA);
  assert.ok(priced.length >= 2, `minimal Sanghyang dan satu kompetitor bertarif (ditemukan ${priced.length})`);
});

test("C12 regresi: harga situs resmi yang lebih mahal dari OTA pada kamar yang sama ikut menentukan batas atas", async () => {
  // Profil asli dari DB/berkas; yang dipilih hanya kamar yang punya dua lapisan harga dengan situs resmi lebih mahal.
  const full = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const profiles = await loadDynamicHotelRoomTypes();
  let checked = 0;
  for (const h of full.resort.hotelEntries ?? []) {
    const twoLayer = h.roomTypes.filter((rt) =>
      STAYS.some((stay) => {
        const off = stay === "weekday" ? rt.officialRate?.weekdayPrice : rt.officialRate?.weekendPrice;
        const ota = stay === "weekday" ? rt.otaLowest?.weekdayPrice : rt.otaLowest?.weekendPrice;
        return valid(off) && valid(ota) && off > ota;
      }),
    );
    const profile = h.placeId ? profiles.get(h.placeId) : undefined;
    if (!twoLayer.length || !profile) continue;
    const subset: HotelRoomTypesProfile = {
      ...profile,
      roomTypes: profile.roomTypes.filter((rt) => twoLayer.some((t) => t.name === rt.name)),
    };
    const rebuilt = await buildOutletCompetitorMatrices({
      outlets: ["resort"],
      roomTypesMap: new Map([...profiles].map(([k, v]) => [k, k === h.placeId ? subset : v])),
    });
    const hotel = rebuilt.resort.hotelEntries?.find((x) => x.competitorId === h.competitorId);
    assert.ok(hotel, `${h.name} tetap ada setelah dibangun ulang`);
    assertSummaryMatchesSubRows(hotel);
    checked++;
  }
  assert.ok(checked >= 1, "data asli memuat minimal satu hotel dengan harga situs resmi di atas harga OTA");
});

test("C15: semua tarif yang tampil berasal dari jendela yang disebut catatan; tanggal utama = tanggal crawl asli", async () => {
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const resort = matrices.resort;
  const w = resort.rateWindow;
  assert.ok(w, "rateWindow tersedia");
  assert.equal(w.basis, "crawl", "tanpa periode terpilih, dasar jendela adalah crawl 14 malam terakhir");
  assert.equal(w.firstCheckIn, RESORT_ROOM_RATE_SOURCE.window?.firstCheckIn, "jendela = jendela crawl di data");
  assert.equal(w.lastCheckIn, RESORT_ROOM_RATE_SOURCE.window?.lastCheckIn, "jendela = jendela crawl di data");
  assert.equal(w.checkInWeekday, RESORT_ROOM_RATE_SOURCE.checkInWeekday, "tanggal utama hari biasa dari data crawl");
  assert.equal(w.checkInWeekend, RESORT_ROOM_RATE_SOURCE.checkInWeekend, "tanggal utama akhir pekan dari data crawl");

  const note = resort.ratesWindowNote ?? "";
  for (const iso of [w.firstCheckIn, w.lastCheckIn, w.checkInWeekday, w.checkInWeekend]) {
    assert.ok(note.includes(checkInLabel(iso)), `catatan menyebut ${checkInLabel(iso)}`);
  }
  assert.ok(resort.note.includes(`${COMPSET_MAX_ROAD_KM} km`), "aturan jarak dibaca dari konfigurasi");
  assert.ok(resort.note.includes(`bintang ${MIN_LODGING_STARS}`), "aturan bintang dibaca dari konfigurasi");

  const evidence = RESORT_RATE_EVIDENCE_ALL;
  for (const h of resort.hotelEntries ?? []) {
    for (const rt of h.roomTypes) {
      const ota = rt.otaLowest;
      if (!ota) continue;
      for (const stay of STAYS) {
        const price = stay === "weekday" ? ota.weekdayPrice : ota.weekendPrice;
        const ci: string | null = stay === "weekday" ? ota.weekdayCheckIn : ota.weekendCheckIn;
        if (!valid(price)) continue;
        assert.ok(ci, `${h.name}/${rt.name} ${stay}: tanggal check-in tarif OTA tercatat`);
        assert.ok(ci >= w.firstCheckIn && ci <= w.lastCheckIn, `${h.name}/${rt.name} ${stay}: check-in ${ci} di dalam jendela ${w.firstCheckIn}..${w.lastCheckIn}`);
        const fromEvidence = evidence.some((e) => e.hotelId === h.placeId && e.stay === stay && e.price === price);
        const isPropertyLowest = stay === "weekday" ? ota.weekdayIsPropertyLowest : ota.weekendIsPropertyLowest;
        if (fromEvidence && !isPropertyLowest) {
          const expected = stay === "weekday" ? RESORT_ROOM_RATE_SOURCE.checkInWeekday : RESORT_ROOM_RATE_SOURCE.checkInWeekend;
          assert.equal(ci, expected, `${h.name}/${rt.name} ${stay}: tarif bukti per kamar memakai tanggal crawl aslinya`);
        }
      }
    }
  }
});

test("C14: baris OTA termurah per tipe kamar punya nama OTA, tautan, tanggal check-in, dan status sarapan per hari", async () => {
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  let otaRows = 0;
  for (const h of matrices.resort.hotelEntries ?? []) {
    for (const rt of h.roomTypes as HotelRoomTypeMatrixSubRow[]) {
      assert.ok(["Termasuk sarapan", "Tanpa sarapan", "Tersedia keduanya", "Belum tercatat"].includes(rt.breakfastLabel));
      const ota = rt.otaLowest;
      if (!ota) continue;
      otaRows++;
      assert.ok(ota.otaName.length > 0, `${h.name}/${rt.name}: nama OTA terisi`);
      for (const stay of STAYS) {
        const price = stay === "weekday" ? ota.weekdayPrice : ota.weekendPrice;
        const url = stay === "weekday" ? ota.weekdayOtaUrl : ota.weekendOtaUrl;
        const bf = stay === "weekday" ? ota.weekdayBreakfast : ota.weekendBreakfast;
        if (!valid(price)) continue;
        assert.match(url ?? "", /^https:\/\//, `${h.name}/${rt.name} ${stay}: tautan OTA bisa diklik`);
        assert.ok(bf === true || bf === false || bf === null, `${h.name}/${rt.name} ${stay}: status sarapan tercatat sebagai ya/tidak/belum`);
      }
    }
  }
  assert.ok(otaRows >= 2, `minimal dua baris OTA termurah (ditemukan ${otaRows})`);
  const deluxe = matrices.resort.hotelEntries?.[0].roomTypes.find((r) => r.name === "Sanghyang Deluxe");
  assert.equal(deluxe?.breakfastLabel, "Tersedia keduanya", "Sanghyang Deluxe punya bukti paket dengan dan tanpa sarapan");
});

test("C14 Direksi: evaluasi harga kamar memakai kompetitor aktif dari DB dan status sarapan dari matriks", async () => {
  const [matrices, inactive] = await Promise.all([
    buildOutletCompetitorMatrices({ outlets: ["resort"] }),
    inactiveCompetitorNames(),
  ]);
  const evaluation = buildExecutiveRoomEvaluation(matrices.resort);
  const matrixNames = (matrices.resort.hotelEntries ?? []).map((h) => h.name);
  assert.deepEqual(evaluation.breakfast.rows.map((r) => r.hotelName), matrixNames, "baris sarapan = daftar aktif di matriks");
  for (const r of evaluation.breakfast.rows) assert.ok(!inactive.has(r.hotelName), `${r.hotelName} diarsipkan`);
  assert.deepEqual(evaluation.competitorNames, matrixNames.slice(1), "kompetitor evaluasi = kompetitor aktif");
  const own = evaluation.breakfast.rows.find((r) => r.isSanghyang);
  assert.ok(own, "baris Sanghyang ada");
  assert.equal(own.overallStatus, "Tersedia keduanya", "Sanghyang menjual paket dengan dan tanpa sarapan");
  assert.ok(evaluation.summary.headline.length > 0, "kalimat utama terisi");
  assert.equal(evaluation.summary.competitorCount, matrixNames.length - 1);
  assert.doesNotMatch(JSON.stringify(evaluation), AI_ENGINE_RE);
});

test("C12 F&B: kisaran menu di baris ringkasan = harga item termurah dan termahal yang ditampilkan", async () => {
  const fnbKeys = OUTLET_KEYS.filter((k) => k !== "resort");
  const matrices = await buildOutletCompetitorMatrices({ outlets: fnbKeys });
  let checked = 0;
  for (const key of fnbKeys) {
    for (const e of matrices[key].fnbEntries ?? []) {
      if (!e.menuPriceRange) {
        assert.equal(e.rangeCheapest, null, `${key}/${e.name}: tanpa kisaran, tanpa item termurah`);
        continue;
      }
      checked++;
      assert.ok(e.rangeCheapest && e.rangePriciest, `${key}/${e.name}: item ujung kisaran tersedia`);
      assert.equal(e.rangeCheapest.price, e.menuPriceRange.min, `${key}/${e.name}: item termurah = batas bawah`);
      assert.equal(e.rangePriciest.priceMax ?? e.rangePriciest.price, e.menuPriceRange.max, `${key}/${e.name}: item termahal = batas atas`);
      assert.equal(e.menuRangeLabel, rupiahRange(e.menuPriceRange.min, e.menuPriceRange.max), `${key}/${e.name}: label kisaran`);
      const counted = e.countedItems.map((i) => i.priceMax ?? i.price);
      assert.equal(Math.min(...e.countedItems.map((i) => i.price)), e.menuPriceRange.min, `${key}/${e.name}: daftar item dihitung cocok batas bawah`);
      assert.equal(Math.max(...counted), e.menuPriceRange.max, `${key}/${e.name}: daftar item dihitung cocok batas atas`);
      assert.ok(e.menuDetailLabel.includes(e.rangeCheapest.name), `${key}/${e.name}: rincian menyebut item termurah`);
      assert.ok(e.menuDetailLabel.includes(e.rangePriciest.name), `${key}/${e.name}: rincian menyebut item termahal`);
    }
  }
  assert.ok(checked >= 5, `minimal satu tempat bermenu per outlet F&B (ditemukan ${checked})`);
});

test("resolveRateWindow: jendela mengikuti crawl yang ada saat akhir periode, lalu pantauan harian, lalu kosong", () => {
  const crawl = RESORT_ROOM_RATE_SOURCE;
  assert.ok(crawl.window, "berkas tarif memuat jendela crawl");
  const crawlMs = crawlCapturedAtMs(crawl.capturedAt);

  const latest = resolveRateWindow();
  assert.equal(latest.basis, "crawl");
  assert.equal(latest.crawlDate, isoDateWib(new Date(crawlMs)));
  assert.deepEqual([latest.firstCheckIn, latest.lastCheckIn], [crawl.window.firstCheckIn, crawl.window.lastCheckIn]);
  const note = resolvedRateWindowNote(latest, latest.crawlDate);
  assert.ok(note.includes(`dari pemeriksaan ${checkInLabel(latest.crawlDate as string)}`));
  assert.ok(note.includes(`check-in ${checkInLabel(latest.firstCheckIn)} sampai ${checkInLabel(latest.lastCheckIn)}`));

  // Periode yang selesai sebelum crawl: jendela H+1..H+n dari pantauan harian terakhir di periode itu.
  const observed = new Date(crawlMs - 3 * 86_400_000);
  const before = resolveRateWindow({ snapshotObservedDates: [observed], periodTo: new Date(crawlMs - 86_400_000) });
  assert.equal(before.basis, "snapshot");
  assert.equal(before.observedAt, isoDateWib(observed));
  assert.equal(before.firstCheckIn, isoDateWib(new Date(observed.getTime() + 86_400_000)));
  assert.equal(before.nights, crawl.window.nights);

  const empty = resolveRateWindow({ periodTo: new Date(crawlMs - 86_400_000) });
  assert.equal(empty.basis, "none");
  assert.match(resolvedRateWindowNote(empty, null), /^Belum ada tarif kamar yang terpantau/);

  assert.throws(() => crawlCapturedAtMs("bukan tanggal"), /tidak terbaca/, "tanggal crawl rusak gagal cepat, tidak diganti jam sekarang");

  // Angka sarapan diturunkan dari bukti crawl yang sedang dipakai, bukan ditulis tetap (berkas tarif diganti tiap hari).
  const bfParity = buildExecutiveBreakfastParity();
  const ownOffers = (stay: "weekday" | "weekend", breakfast: boolean) =>
    RESORT_RATE_EVIDENCE.filter((e) => e.hotelId === "sanghyang" && e.stay === stay && e.breakfast === breakfast).map((e) => e.price);
  const minOrNull = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  assert.equal(bfParity.sanghyangWeekdayWithoutBreakfast, minOrNull(ownOffers("weekday", false)));
  assert.equal(bfParity.sanghyangWeekdayWithBreakfast, minOrNull(ownOffers("weekday", true)));
  assert.equal(bfParity.sanghyangWeekendWithBreakfast, minOrNull(ownOffers("weekend", true)));
});

test("competitor-matrix: menu hasil refresh (rekaman DB) dipakai matriks F&B tanpa ubah kode", async () => {
  const fnbKeys = OUTLET_KEYS.filter((k) => k !== "resort");
  const [base, dbMenus] = await Promise.all([buildOutletCompetitorMatrices({ outlets: fnbKeys }), loadDynamicCompetitorMenuItems()]);
  // Rekaman refresh dibentuk dari menu asli kompetitor aktif (item dan URL sumbernya), lalu dilewatkan seperti hasil refresh.
  const target = fnbKeys
    .flatMap((k) => (base[k].fnbEntries ?? []).map((e) => ({ key: k, e })))
    .find(({ e }) => e.role !== "sanghyang" && e.countedItems.length >= 2 && e.menuSources.length > 0);
  assert.ok(target, "ada kompetitor F&B aktif dengan menu bersumber");
  const record: DynamicCompetitorMenuRecord = {
    competitorId: target.e.competitorId,
    competitorName: target.e.name,
    placeId: target.e.placeId,
    category: target.e.category,
    items: target.e.countedItems.slice(0, 2).map((i) => ({ name: i.name, category: i.category, price: i.price, priceMax: i.priceMax, unit: i.unit, quote: "" })),
    sourceUrl: target.e.menuSources[0].url,
    sourceLabel: target.e.menuSources[0].label,
    observedAt: new Date().toISOString(),
  };
  const rebuilt = await buildOutletCompetitorMatrices({
    outlets: [target.key],
    dynamicMenusMap: new Map([...dbMenus, [record.competitorId, record]]),
  });
  const entry = rebuilt[target.key].fnbEntries?.find((e) => e.competitorId === record.competitorId);
  assert.ok(entry, `${target.e.name} tetap ada`);
  for (const item of record.items) {
    assert.ok(entry.countedItems.some((i) => i.name === item.name && i.price === item.price), `${item.name} dari rekaman refresh terpakai`);
  }
  assert.ok(entry.menuSources.some((s) => s.url === record.sourceUrl), "sumber rekaman refresh tercantum");
  assert.doesNotMatch(JSON.stringify(rebuilt), AI_ENGINE_RE, "matriks bebas nama mesin AI");
});

test("E2: lapisan situs resmi Sanghyang mengikuti pemuat tarif resmi (harga bila terbaca, alasannya bila belum)", async () => {
  const source = officialRoomRatesSource();
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const own = matrices.resort.hotelEntries?.find((h) => h.role === "sanghyang");
  assert.ok(own, "baris Sanghyang ada");
  const w = matrices.resort.rateWindow;
  assert.ok(w);
  const windowFirst: string = w.firstCheckIn;
  const windowLast: string = w.lastCheckIn;
  const rates = officialRoomRatesFor(own.placeId ?? "");
  // Harga resmi dihitung hanya pada malam yang sama dengan tanggal utama lapisan OTA; malam lain tampil terpisah.
  const otaMain = w.basis === "crawl" ? { weekday: w.checkInWeekday, weekend: w.checkInWeekend } : null;
  let priced = 0;
  for (const rt of own.roomTypes) {
    const engine = rates.find((r) => r.roomName === rt.name);
    const inWin = (ci: string | null): boolean => ci !== null && ci >= windowFirst && ci <= windowLast;
    const wd: number | null = engine && inWin(engine.checkInWeekday) ? engine.weekdayPrice : null;
    const we: number | null = engine && inWin(engine.checkInWeekend) ? engine.weekendPrice : null;
    const sameWd = otaMain !== null && engine?.checkInWeekday === otaMain.weekday;
    const sameWe = otaMain !== null && engine?.checkInWeekend === otaMain.weekend;
    if (engine && (wd !== null || we !== null)) {
      priced++;
      assert.equal(rt.officialRate?.sourceLabel, engine.sourceLabel, `${rt.name}: label situs resmi dari pemuat`);
      assert.equal(rt.officialRate?.weekdayPrice ?? null, sameWd ? wd : null, `${rt.name}: harga hari biasa resmi yang dihitung`);
      assert.equal(rt.officialRate?.weekendPrice ?? null, sameWe ? we : null, `${rt.name}: harga akhir pekan resmi yang dihitung`);
      assert.equal(rt.officialRate?.weekdayOtherNightPrice ?? null, sameWd ? null : wd, `${rt.name}: harga hari biasa resmi malam lain`);
      assert.equal(rt.officialRate?.weekendOtherNightPrice ?? null, sameWe ? null : we, `${rt.name}: harga akhir pekan resmi malam lain`);
      assert.equal(rt.officialRate?.breakfastIncluded ?? null, engine.breakfastIncluded, `${rt.name}: sarapan dari pemuat`);
      if (wd === null) assert.equal(rt.officialRate?.weekdayUnavailableReason, engine.weekday.unavailableReason, `${rt.name}: alasan hari biasa dari pemuat`);
      if (we === null) assert.equal(rt.officialRate?.weekendUnavailableReason, engine.weekend.unavailableReason, `${rt.name}: alasan akhir pekan dari pemuat`);
      if (wd !== null) assert.equal(rt.officialRate?.weekdayCheckIn, engine.checkInWeekday, `${rt.name}: check-in hari biasa resmi`);
      if (we !== null) assert.equal(rt.officialRate?.weekendCheckIn, engine.checkInWeekend, `${rt.name}: check-in akhir pekan resmi`);
    } else if (!rt.officialRate && source.status !== "terbaca") {
      assert.ok(source.reason, "pemuat menyebut alasan saat belum ada data");
      assert.equal(rt.officialUnavailableReason, source.reason, `${rt.name}: alasan dari pemuat tarif resmi tampil, bukan 'tidak dipublikasikan'`);
    }
  }
  if (source.status === "terbaca") assert.ok(priced >= 1, "data terbaca berarti minimal satu kamar berharga resmi");
  assertSummaryMatchesSubRows(own);
  for (const h of (matrices.resort.hotelEntries ?? []).filter((x) => x.role !== "sanghyang")) {
    for (const rt of h.roomTypes) assert.equal(rt.officialUnavailableReason, null, `${h.name}: alasan booking engine Sanghyang tidak menempel di hotel lain`);
  }
});

test("C9: teks tampil matriks tanpa nama alat atau nama berkas teknis; jarak dari perhitungan rute ditulis 'estimasi rute'", async () => {
  const matrices = await buildOutletCompetitorMatrices();
  const texts: string[] = [];
  for (const m of Object.values(matrices)) {
    texts.push(m.note, m.ratesWindowNote ?? "");
    for (const h of m.hotelEntries ?? []) {
      texts.push(h.distanceLabel, h.distanceSource ?? "", h.auditRationale, h.poolLabel, h.designStyleLabel, h.rateConsistencyNote ?? "");
      for (const st of h.facilityNarrative) texts.push(st.text, ...st.sources.map((s) => s.label));
      for (const rt of h.roomTypes) texts.push(rt.sourceLabel, rt.conflictNote ?? "", ...rt.highlights, rt.officialRate?.sourceLabel ?? "", rt.officialUnavailableReason ?? "");
    }
    for (const e of m.fnbEntries ?? []) {
      texts.push(e.distanceLabel, e.distanceSource ?? "", e.menuRangeLabel, e.menuDetailLabel, e.facilitiesLabel, e.auditRationale, ...e.menuChecked, ...e.menuSources.map((s) => s.label));
    }
  }
  for (const t of texts) {
    assert.doesNotMatch(t, /\bOSRM\b/, `tanpa nama alat rute: ${t}`);
    assert.doesNotMatch(t, /\b[\w-]+\.(?:json|csv|py)\b/i, `tanpa nama berkas teknis: ${t}`);
  }
  assert.ok(texts.some((t) => t.includes("(estimasi rute)")), "jarak dari perhitungan rute tetap ditandai jujur");
});
