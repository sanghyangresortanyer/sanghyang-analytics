import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { mergeCompetitorMenu } from "../../src/lib/market/compset-audit";
import { isCountedMenuItem, menuPriceRange } from "../../src/lib/market/competitor-menu";
import { createRunDetailsHandler } from "../../src/app/api/admin/scraping/[runId]/route";
import { createCompetitorsHandlers, GET as GET_COMPETITORS_UNAUTH } from "../../src/app/api/competitors/route";
import { GET as GET_HEALTH } from "../../src/app/api/health/route";
import { GET as GET_HEALTH_READY } from "../../src/app/api/health/ready/route";

after(() => db.$disconnect());

test("mergeCompetitorMenu mewarisi kind paket-bersama lewat normalisasi nama dasar tanpa duplikat dan mendeteksi paket pasangan/grup baru secara umum", () => {
  // 1. Pencocokan nama dasar (menghapus catatan dalam kurung) dan subset kata terhadap data statis yang bertanda.
  const mergedInfinity = mergeCompetitorMenu("Infinity Restaurant Mambruk", {
    competitorId: "dyn-infinity",
    competitorName: "Infinity Restaurant Mambruk",
    placeId: "infinity_mambruk",
    category: "resto",
    sourceUrl: "https://mambruk.co.id/offers",
    sourceLabel: "Situs resmi",
    observedAt: "2026-11-25T01:00:00.000Z",
    items: [
      {
        name: "Seaside Candlelight Dinner",
        category: "Dining Package",
        price: 950000,
        priceMax: null,
        unit: null,
        quote: "Starting from 950k / couple (2 pax), our romantic candlelight dinner",
      },
      {
        name: "Floating Breakfast",
        category: "Dining Package",
        price: 400000,
        priceMax: null,
        unit: null,
        quote: "floating breakfast starting from 400k / couple (2 pax)",
      },
      {
        name: "High Tea",
        category: "Dining Package",
        price: 400000,
        priceMax: null,
        unit: null,
        quote: "Only with 400k / couple (2 pax), let's try our High Tea package",
      },
      {
        name: "Seafood BBQ",
        category: "Dining Package",
        price: 250000,
        priceMax: null,
        unit: null,
        quote: "Because every Saturday night, we have Seafood BBQ, with 250k only!",
      },
      {
        name: "The Mambruk Sizzling Grill",
        category: "Dining",
        price: 250000,
        priceMax: null,
        unit: null,
        quote: "The Mambruk Sizzling Grill Rp. 250,000,-",
      },
    ],
  });
  assert.ok(mergedInfinity);
  assert.deepEqual(menuPriceRange(mergedInfinity.items), { min: 30000, max: 250000 });
  assert.equal(mergedInfinity.items.filter(isCountedMenuItem).length, 56, "56 item per porsi tanpa duplikat");
  const sharedInfinity = mergedInfinity.items.filter((i) => i.kind === "paket-bersama");
  assert.equal(sharedInfinity.length, 3, "hanya 3 paket 2 orang tanpa menggandakan entri statis");
  assert.ok(sharedInfinity.every((i) => i.pax === 2));

  // 2. Alta Spa: HONEYMOONER (Two People) cocok dengan Honeymooner (2 orang, 90 menit: ...) tanpa menghapus varian 90 menit massage.
  const mergedAlta = mergeCompetitorMenu("Alta Spa Marbella Anyer", {
    competitorId: "dyn-alta",
    competitorName: "Alta Spa Marbella Anyer",
    placeId: "alta_spa",
    category: "spa",
    sourceUrl: "https://altaspa.example.com/",
    sourceLabel: "Situs resmi",
    observedAt: "2026-11-25T01:00:00.000Z",
    items: [
      {
        name: "BALI BUNGAH",
        category: "Spa Package",
        price: 750000,
        priceMax: null,
        unit: null,
        quote: "BALI BUNGAH 120 min - Rp. 750.000",
      },
      {
        name: "HONEYMOONER (Two People)",
        category: "Spa Package",
        price: 850000,
        priceMax: null,
        unit: null,
        quote: "HONEYMOONER (Two People) 90 Min - Rp. 850.000",
      },
      {
        name: "JAVANESE MASSAGE",
        category: "Spa Ala Carte",
        price: 280000,
        priceMax: null,
        unit: null,
        quote: "JAVANESE MASSAGE 60' Rp. 280K",
      },
    ],
  });
  assert.ok(mergedAlta);
  assert.deepEqual(menuPriceRange(mergedAlta.items), { min: 150000, max: 750000 });
  const honeymoonItems = mergedAlta.items.filter((i) => /honeymooner/i.test(i.name));
  assert.equal(honeymoonItems.length, 1, "Honeymooner tidak terduplikasi");
  assert.equal(honeymoonItems[0].kind, "paket-bersama");
  assert.equal(honeymoonItems[0].pax, 2);
  assert.ok(
    mergedAlta.items.some((i) => i.name === "Javanese Massage (90 menit)" && i.price === 350000),
    "varian durasi/harga berbeda tetap dipertahankan",
  );

  // 3. Kompetitor baru tanpa data statis: pola paket pasangan/grup umum tetap terdeteksi di luar kisaran per porsi.
  const mergedBrandNew = mergeCompetitorMenu("Resto Baru Tanpa Data Statis", {
    competitorId: "dyn-new",
    competitorName: "Resto Baru Tanpa Data Statis",
    placeId: null,
    category: "resto",
    sourceUrl: "https://restobaru.example.com/menu",
    sourceLabel: "Situs resmi",
    observedAt: "2026-11-25T01:00:00.000Z",
    items: [
      {
        name: "Nasi Goreng Laut",
        category: "Main Course",
        price: 55000,
        priceMax: null,
        unit: null,
        quote: "Nasi Goreng Laut Rp 55.000",
      },
      {
        name: "Romantic Candlelight Set",
        category: "Dining Package",
        price: 1200000,
        priceMax: null,
        unit: null,
        quote: "Romantic Candlelight Set Rp 1.200.000 per pasangan",
      },
      {
        name: "Paket Keluarga Bahari",
        category: "Group Menu",
        price: 650000,
        priceMax: null,
        unit: null,
        quote: "Paket Keluarga Bahari untuk 4 orang Rp 650.000",
      },
      {
        name: "Honeymoon Escape Spa",
        category: "Spa Package",
        price: 900000,
        priceMax: null,
        unit: null,
        quote: "Honeymoon Escape Spa for couple Rp 900.000",
      },
      {
        name: "Body Treatment Single",
        category: "Spa Package",
        price: 350000,
        priceMax: null,
        unit: null,
        quote: "Body Treatment Single 90 min Rp 350.000",
      },
    ],
  });
  assert.ok(mergedBrandNew);
  assert.deepEqual(menuPriceRange(mergedBrandNew.items), { min: 55000, max: 350000 });
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Romantic Candlelight Set")?.kind, "paket-bersama");
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Romantic Candlelight Set")?.pax, 2);
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Paket Keluarga Bahari")?.kind, "paket-bersama");
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Paket Keluarga Bahari")?.pax, 4);
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Honeymoon Escape Spa")?.kind, "paket-bersama");
  assert.equal(mergedBrandNew.items.find((i) => i.name === "Body Treatment Single")?.kind, undefined);
});

test("GET /api/admin/scraping/[runId] menolak runId non-UUID dengan HTTP 400 sebelum menyentuh Prisma", async () => {
  let dbCalls = 0;
  const { GET } = createRunDetailsHandler({
    checkAccess: async () => null,
    getRuns: async () => {
      dbCalls++;
      return [];
    },
  });

  const validUuid = "10000000-0000-4000-8000-000000000001";
  for (const badId of [
    "nonexistent-id-000",
    "not-a-uuid",
    "------------------------------------",
    `${validUuid},invalid-second-id`,
    ",",
  ]) {
    const res = await GET(new Request(`http://127.0.0.1:3001/api/admin/scraping/${encodeURIComponent(badId)}`), {
      params: Promise.resolve({ runId: badId }),
    });
    assert.equal(res.status, 400, `runId "${badId}" harus mengembalikan HTTP 400`);
    const body = (await res.json()) as { error?: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0, `runId "${badId}" harus menyertakan pesan error JSON`);
  }
  assert.equal(dbCalls, 0, "Prisma/getRuns tidak boleh dipanggil untuk runId non-UUID");

  // UUID valid yang tidak ada di DB tetap mengembalikan 404 (bukan 400 atau 500).
  const missingRes = await GET(new Request(`http://127.0.0.1:3001/api/admin/scraping/${validUuid}`), {
    params: Promise.resolve({ runId: validUuid }),
  });
  assert.equal(missingRes.status, 404);
  assert.equal(dbCalls, 1);
});

test("GET /api/competitors menolak akses tanpa login (401) dan menolak competitorId non-UUID dengan HTTP 400 tanpa melempar Prisma P2023", async () => {
  const unauthRes = await GET_COMPETITORS_UNAUTH(new Request("http://127.0.0.1:3001/api/competitors"));
  assert.equal(unauthRes.status, 401);

  const { GET: GET_COMPETITORS } = createCompetitorsHandlers(async () => null);

  for (const query of [
    "competitorId=invalid-uuid&type=review",
    "competitorId=nonexistent-id&type=promotion",
    "competitorId=bad-id&type=price",
    "competitorId=------------------------------------&type=review",
    "competitorId=&type=review",
  ]) {
    const res = await GET_COMPETITORS(
      new Request(`http://127.0.0.1:3001/api/competitors?${query}`),
    );
    assert.equal(res.status, 400, `query "${query}" harus mengembalikan HTTP 400`);
    const body = (await res.json()) as { error?: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0);
  }

  // Tanpa competitorId tetap mengembalikan 200 daftar kompetitor.
  const listRes = await GET_COMPETITORS(new Request("http://127.0.0.1:3001/api/competitors"));
  assert.equal(listRes.status, 200);
  const rows = (await listRes.json()) as unknown[];
  assert.ok(Array.isArray(rows) && rows.length > 0);
});

test("PATCH /api/competitors menerima teks biasa untuk location dan notes serta tetap menolak URL tidak valid", async () => {
  const { POST, PATCH, DELETE } = createCompetitorsHandlers(async () => null);
  const createdRes = await POST(
    new Request("http://127.0.0.1:3001/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "competitor",
        name: "Uji Patch Non-URL Temporary",
        location: "Anyer",
        notes: "Catatan awal",
        active: false,
      }),
    }),
  );
  assert.equal(createdRes.status, 201);
  const created = (await createdRes.json()) as { id: string };

  try {
    const patchOk = await PATCH(
      new Request(`http://127.0.0.1:3001/api/competitors?id=${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "Jl. Raya Sirih KM 128, Anyer",
          notes: "Diperbarui sebagai teks biasa non-URL",
          websiteUrl: "https://example.com",
        }),
      }),
    );
    assert.equal(patchOk.status, 200);
    const updated = (await patchOk.json()) as { location: string | null; notes: string | null; websiteUrl: string | null };
    assert.equal(updated.location, "Jl. Raya Sirih KM 128, Anyer");
    assert.equal(updated.notes, "Diperbarui sebagai teks biasa non-URL");
    assert.equal(updated.websiteUrl, "https://example.com");

    const badUrl = await PATCH(
      new Request(`http://127.0.0.1:3001/api/competitors?id=${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: "bukan-url" }),
      }),
    );
    assert.equal(badUrl.status, 400);

    const badLocation = await PATCH(
      new Request(`http://127.0.0.1:3001/api/competitors?id=${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: 12345 }),
      }),
    );
    assert.equal(badLocation.status, 400);
  } finally {
    await DELETE(new Request(`http://127.0.0.1:3001/api/competitors?id=${created.id}`, { method: "DELETE" }));
  }
});

test("GET /api/health dan /api/health/ready publik tidak membocorkan nama model AI", async () => {
  const livenessRes = await GET_HEALTH();
  assert.equal(livenessRes.status, 200);
  const liveness = (await livenessRes.json()) as Record<string, unknown>;
  assert.equal(liveness.status, "ok");
  assert.equal(liveness.service, "sanghyang-analytics");

  const readyRes = await GET_HEALTH_READY();
  assert.ok(readyRes.status === 200 || readyRes.status === 503);
  const ready = (await readyRes.json()) as { status: string; gemini?: Record<string, unknown> };
  assert.equal(typeof ready.gemini?.configured, "boolean");
  assert.equal("model" in (ready.gemini ?? {}), false, "gemini.model tidak boleh diekspos di endpoint health publik");
  assert.doesNotMatch(
    JSON.stringify(ready),
    /\b(gemini-[\w.-]+|flash[- ]?lite|claude|openai|chatgpt|gpt-\d|llm)\b/i,
    "respons /api/health/ready bebas nama model AI",
  );
});
