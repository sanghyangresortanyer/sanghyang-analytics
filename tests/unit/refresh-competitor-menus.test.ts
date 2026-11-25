/**
 * Tes unit & integrasi DB lokal untuk pembaruan dinamis daftar menu kompetitor F&B, Bar, dan Spa.
 * Menguji kontrak:
 * 1. `MENU_FACT_SECTION` mematuhi CHECK constraint PostgreSQL `CompetitorFact_section_check` & OCC upsert.
 * 2. `discoverMenuLinks` menjangkau halaman penawaran (`/offers`, `/promo`) dan `refreshDynamicCompetitorMenus`
 *    melanjutkan ke `parent.websiteUrl` bila `venue.websiteUrl` tidak memuat daftar harga.
 * 3. Ekstraktor katalog toko daring iSeller generik berjalan deterministik dengan 0 panggilan model AI.
 * 4. Ekstraktor brosur gambar menu/pricelist resmi memverifikasi nama + harga terhadap kutipan & mematuhi robots.txt.
 * 5. Pre-filter `hasPriceSignal` menghemat kuota pada halaman tanpa angka harga dan melaporkan `noOnlinePrice` secara jujur.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { db } from "../../src/lib/db";
import {
  competitorMenusRefreshOutcome,
  discoverMenuBrochureImages,
  discoverMenuLinks,
  hasPriceSignal,
  loadDynamicCompetitorMenuItems,
  MENU_FACT_KEY,
  MENU_FACT_SECTION,
  parseVerifiedImageMenuItems,
  refreshDynamicCompetitorMenus,
  type RefreshCompetitorMenusDbClient,
} from "../../src/lib/market/refresh-competitor-menus";

const AI_MODEL_PATTERN = /\b(gemini|flash[- ]?lite|claude|openai|chatgpt|gpt-?\d|llm)\b/i;

after(() => db.$disconnect());

function makeFakeMenuClient(
  venues: Array<{
    id: string;
    name: string;
    placeId: string | null;
    category: string | null;
    websiteUrl: string | null;
    parent?: { id: string; name: string; websiteUrl: string | null } | null;
  }>,
  initialFacts: Array<{
    id: string;
    competitorId: string;
    section: string;
    key: string;
    value: unknown;
    sourceUrl: string;
    observedAt: Date;
    version: number;
  }> = [],
) {
  const stored = [...initialFacts];
  const createCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];
  const venueById = new Map(venues.map((v) => [v.id, v]));

  const tx = {
    competitor: {
      findMany: async () => venues,
    },
    competitorFact: {
      findMany: async ({ where }: { where: { section?: string; key?: string; competitorId?: { in: string[] } } }) =>
        stored
          .filter(
            (r) =>
              (!where.section || r.section === where.section) &&
              (!where.key || r.key === where.key) &&
              (!where.competitorId?.in || where.competitorId.in.includes(r.competitorId)),
          )
          .map((r) => {
            const v = venueById.get(r.competitorId);
            return {
              ...r,
              competitor: v ? { id: v.id, name: v.name, placeId: v.placeId, category: v.category } : null,
            };
          }),
      findUnique: async ({
        where,
      }: {
        where: { competitorId_section_key: { competitorId: string; section: string; key: string } };
      }) => {
        const k = where.competitorId_section_key;
        const found = stored.find((r) => r.competitorId === k.competitorId && r.section === k.section && r.key === k.key);
        return found ? { id: found.id, version: found.version } : null;
      },
      updateMany: async (args: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        updateManyCalls.push(args);
        const found = stored.find((r) => r.id === args.where.id && r.version === args.where.version);
        if (!found) return { count: 0 };
        found.value = args.data.value;
        found.sourceUrl = String(args.data.sourceUrl);
        found.observedAt = args.data.observedAt as Date;
        found.version += 1;
        return { count: 1 };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createCalls.push(args.data);
        const row = {
          id: `fact-${stored.length + 1}`,
          competitorId: String(args.data.competitorId),
          section: String(args.data.section),
          key: String(args.data.key),
          value: args.data.value,
          sourceUrl: String(args.data.sourceUrl),
          observedAt: args.data.observedAt as Date,
          version: 1,
        };
        stored.push(row);
        return row;
      },
    },
    source: {
      upsert: async () => ({ id: "src-menu", domain: "menu_pesaing_dinamis" }),
      update: async () => ({ id: "src-menu" }),
    },
    scrapeRun: {
      create: async () => ({ id: "run-menu", sourceId: "src-menu" }),
      findUnique: async () => ({ id: "run-menu", sourceId: "src-menu", errors: 0 }),
      update: async () => ({ id: "run-menu", sourceId: "src-menu" }),
    },
    scrapeError: {
      create: async () => ({ id: "err-menu" }),
    },
  };

  const client = {
    ...tx,
    $transaction: async <T>(fn: (inner: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as RefreshCompetitorMenusDbClient;

  return { client, stored, createCalls, updateManyCalls };
}

test("MENU_FACT_SECTION mematuhi CHECK constraint PostgreSQL CompetitorFact_section_check dan sukses create + OCC update di DB lokal", async () => {
  assert.equal(MENU_FACT_SECTION, "fasilitas", "section harus termasuk daftar sah CHECK constraint CompetitorFact");

  // Buat kompetitor uji sementara di DB lokal lalu hapus di finally agar tidak meninggalkan sampah.
  const probeComp = await db.competitor.create({
    data: {
      name: `Uji Menu Constraint ${Date.now()}`,
      category: "resto",
      compsetRole: "inti",
      active: true,
      websiteUrl: "https://uji-menu-constraint.test/",
    },
    select: { id: true },
  });

  try {
    const first = await refreshDynamicCompetitorMenus({
      competitorIds: [probeComp.id],
      force: true,
      recordRun: false,
      checkRobots: async () => true,
      fetchPage: async (url) => ({
        url,
        html: `<html><body><h1>Dining Offers</h1><p>Seafood BBQ Dinner - Rp 250.000 per orang tersedia setiap Sabtu malam di tepi pantai.</p></body></html>`,
      }),
      generate: async () =>
        JSON.stringify({
          items: [
            {
              name: "Seafood BBQ Dinner",
              price: 250000,
              priceMax: null,
              category: "Dining Offers",
              unit: "per orang",
              quote: "Seafood BBQ Dinner - Rp 250.000 per orang",
            },
          ],
        }),
    });

    assert.equal(first.failures.length, 0, `Tidak boleh crash Prisma CHECK constraint: ${first.failures.join("; ")}`);
    assert.equal(first.updated, 1);
    assert.equal(first.itemsSaved, 1);

    const row1 = await db.competitorFact.findUnique({
      where: {
        competitorId_section_key: {
          competitorId: probeComp.id,
          section: MENU_FACT_SECTION,
          key: MENU_FACT_KEY,
        },
      },
      select: { version: true, section: true },
    });
    assert.ok(row1, "Baris CompetitorFact harus tersimpan di PostgreSQL lokal");
    assert.equal(row1.version, 1);

    // Putaran kedua harus menaikkan versi OCC menjadi 2 tanpa error unique constraint.
    const second = await refreshDynamicCompetitorMenus({
      competitorIds: [probeComp.id],
      force: true,
      recordRun: false,
      checkRobots: async () => true,
      fetchPage: async (url) => ({
        url,
        html: `<html><body><h1>Dining Offers</h1><p>Seafood BBQ Dinner - Rp 275.000 per orang tersedia setiap Sabtu malam di tepi pantai.</p></body></html>`,
      }),
      generate: async () =>
        JSON.stringify({
          items: [
            {
              name: "Seafood BBQ Dinner",
              price: 275000,
              priceMax: null,
              category: "Dining Offers",
              unit: "per orang",
              quote: "Seafood BBQ Dinner - Rp 275.000 per orang",
            },
          ],
        }),
    });
    assert.equal(second.failures.length, 0);
    const row2 = await db.competitorFact.findUnique({
      where: {
        competitorId_section_key: {
          competitorId: probeComp.id,
          section: MENU_FACT_SECTION,
          key: MENU_FACT_KEY,
        },
      },
      select: { version: true },
    });
    assert.equal(row2?.version, 2, "OCC update wajib menaikkan kolom version");

    const loaded = await loadDynamicCompetitorMenuItems([probeComp.id]);
    assert.equal(loaded.get(probeComp.id)?.items[0].price, 275000);
  } finally {
    await db.competitorFact.deleteMany({ where: { competitorId: probeComp.id } });
    await db.competitor.delete({ where: { id: probeComp.id } });
  }
});

test("discoverMenuLinks menemukan tautan /offers dan refreshDynamicCompetitorMenus mengikuti parent.websiteUrl serta sub-halaman offers", async () => {
  const facilitiesHtml = `<html><body><nav><a href="/offers">Offers</a><a href="/contact">Contact</a></nav><p>Bar dan restoran tepi laut di dalam resor.</p></body></html>`;
  const links = discoverMenuLinks("https://hotel.test/facilities", facilitiesHtml, "Lighthouse Bar", "bar", 4);
  assert.equal(links[0], "https://hotel.test/offers", "tautan /offers harus ditemukan oleh discoverMenuLinks");

  const { client, stored } = makeFakeMenuClient([
    {
      id: "v-child",
      name: "Infinity Restaurant Uji",
      placeId: "infinity_uji",
      category: "resto",
      websiteUrl: "https://hotel.test/facilities",
      parent: { id: "h-parent", name: "Hotel Induk Uji", websiteUrl: "https://hotel.test/" },
    },
  ]);

  const result = await refreshDynamicCompetitorMenus({
    force: true,
    recordRun: false,
    client,
    checkRobots: async () => true,
    fetchPage: async (url) => {
      if (url === "https://hotel.test/facilities") {
        return { url, html: `<html><body><p>Infinity Restaurant terletak di tepi pantai dengan pemandangan laut luas dan tempat duduk terbuka.</p></body></html>` };
      }
      if (url === "https://hotel.test/") {
        return {
          url,
          html: `<html><body><a href="/offers">Dining Offers</a><p>Hotel Induk Uji di tepi pantai Anyer dengan fasilitas lengkap.</p></body></html>`,
        };
      }
      if (url === "https://hotel.test/offers") {
        return {
          url,
          html: `<html><body>
            <h1>Special Dining Offers</h1>
            <p>Seaside Candlelight Dinner - Starting from 950k / couple (2 pax) overlooking the ocean.</p>
            <a href="/offers/seafood-grill">Seafood Grill by the sea</a>
          </body></html>`,
        };
      }
      return {
        url,
        html: `<html><body>
          <h1>Seafood Grill by the sea</h1>
          <p>Every Saturday night we have Seafood BBQ with 250k only for All-You-Can-Eat buffet. Also available Seaside Candlelight Dinner 950k per person.</p>
        </body></html>`,
      };
    },
    generate: async (prompt) => {
      if (prompt.includes("Seaside Candlelight Dinner - Starting")) {
        return JSON.stringify({
          items: [
            {
              name: "Seaside Candlelight Dinner",
              price: 950000,
              priceMax: null,
              category: "Dining Offers",
              unit: null,
              quote: "Seaside Candlelight Dinner - Starting from 950k / couple (2 pax)",
            },
          ],
        });
      }
      if (prompt.includes("Seafood BBQ")) {
        return JSON.stringify({
          items: [
            {
              name: "Seafood Grill by the sea",
              price: 250000,
              priceMax: null,
              category: "Dining Offers",
              unit: null,
              quote: "Seafood BBQ with 250k only",
            },
            {
              // Duplikat nama & harga sama persis dari halaman listing tetapi dengan satuan berbeda (null vs per orang).
              name: "Seaside Candlelight Dinner",
              price: 950000,
              priceMax: null,
              category: "Dining Offers",
              unit: "per orang",
              quote: "Seaside Candlelight Dinner 950k per person",
            },
          ],
        });
      }
      return JSON.stringify({ items: [] });
    },
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.itemsSaved, 2, "Item dari /offers dan sub-halaman /offers/seafood-grill harus tergabung");
  assert.equal(stored.length, 1);
});

test("ekstraktor toko daring iSeller generik mengambil item menu live dengan 0 panggilan model AI", async () => {
  const { client } = makeFakeMenuClient([
    {
      id: "v-iseller",
      name: "Beach Point Uji",
      placeId: "beach_point_uji",
      category: "resto",
      websiteUrl: "https://toko-uji.isellershop.com/?mode=take_away&outlet=Beach+Point+Uji",
      parent: null,
    },
  ]);

  let aiCalls = 0;
  const result = await refreshDynamicCompetitorMenus({
    force: true,
    recordRun: false,
    client,
    checkRobots: async () => true,
    fetchPage: async (url) => ({
      url,
      html: `<html><body><script>var cfg={"outlet_id":"403c0945-960d-475e-9119-fc9220c0140c"}; $.ajax({url:"/services/Liquid/Collections"});</script></body></html>`,
    }),
    fetchPostJson: async (url, params) => {
      if (url.endsWith("/services/Liquid/Collections")) {
        return {
          IsSuccess: true,
          Data: [
            { id: "col-1", title: "MAIN COURSE", all_product_count: 2 },
            { id: "col-empty", title: "EMPTY", all_product_count: 0 },
          ],
        };
      }
      if (url.endsWith("/services/Liquid/Products") && params.collection === "col-1") {
        return {
          IsSuccess: true,
          Data: [
            { title: "AYAM BAKAR & NASI", price: 42000, regular_price: 42000 },
            { title: "BUNTUT SAPI BAKAR", price: 66000, regular_price: 66000 },
          ],
        };
      }
      return { IsSuccess: true, Data: [] };
    },
    generate: async () => {
      aiCalls++;
      return JSON.stringify({ items: [] });
    },
  });

  assert.equal(aiCalls, 0, "Ekstraksi iSeller wajib 100% deterministik tanpa panggilan model AI");
  assert.equal(result.failures.length, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.itemsSaved, 2);
  const loaded = await loadDynamicCompetitorMenuItems(["v-iseller"], { client });
  assert.equal(loaded.get("v-iseller")?.items.length, 2);
  assert.equal(loaded.get("v-iseller")?.items[0].name, "AYAM BAKAR & NASI");
  assert.equal(loaded.get("v-iseller")?.items[0].price, 42000);
});

test("discoverMenuBrochureImages dan ekstraksi brosur gambar resmi memvalidasi nama + harga pada kutipan dan menolak halusinasi", async () => {
  const blogHtml = `<html><body>
    <img src="https://resources.blogblog.com/icon.png" />
    <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/thumb/w72-h72-p-k-no-nu/mini.jpg" />
    <a href="https://blogger.googleusercontent.com/img/b/R29vZ2xl/abc/s1600/1.jpg">
      <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/abc/s320/1.jpg" />
    </a>
    <a href="https://blogger.googleusercontent.com/img/b/R29vZ2xl/def/s1600/2.jpg">
      <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/def/s320/2.jpg" />
    </a>
  </body></html>`;

  const imgs = discoverMenuBrochureImages("http://altaspa.blogspot.com/2018/11/spa.html", blogHtml, 4);
  assert.deepEqual(imgs, [
    "https://blogger.googleusercontent.com/img/b/R29vZ2xl/abc/s1600/1.jpg",
    "https://blogger.googleusercontent.com/img/b/R29vZ2xl/def/s1600/2.jpg",
  ]);

  const parsed = parseVerifiedImageMenuItems(
    JSON.stringify({
      items: [
        {
          name: "Traditional Massage 60 Min",
          price: 250000,
          priceMax: null,
          category: "Body Massage",
          unit: "per jam",
          quote: "Traditional Massage 60 Min Rp 250.000",
        },
        {
          name: "Harga Halusinasi",
          price: 999000,
          priceMax: null,
          category: "Body Massage",
          unit: null,
          quote: "Harga Halusinasi Rp 150.000",
        },
        {
          name: "Snorkeling",
          price: 600000,
          priceMax: null,
          category: "Activity",
          unit: "per orang",
          quote: "Snorkeling Rp 600.000 per orang",
        },
      ],
    }),
  );
  assert.equal(parsed.items.length, 1, "Item valid lolos");
  assert.equal(parsed.rejected.length, 2, "Item halusinasi angka dan aktivitas wisata laut wajib ditolak");

  const { client } = makeFakeMenuClient([
    {
      id: "v-spa",
      name: "Alta Spa Uji",
      placeId: "alta_uji",
      category: "spa",
      websiteUrl: "http://altaspa.blogspot.com/",
      parent: null,
    },
  ]);

  const run = await refreshDynamicCompetitorMenus({
    force: true,
    recordRun: false,
    client,
    checkRobots: async () => true,
    fetchPage: async (url) => {
      if (url === "http://altaspa.blogspot.com/") {
        return {
          url,
          html: `<html><body><a href="http://altaspa.blogspot.com/2018/11/alta-spa-pricelist.html">Alta Spa</a></body></html>`,
        };
      }
      return { url, html: blogHtml };
    },
    fetchImage: async () => ({ data: Buffer.from("fakeimg").toString("base64"), mimeType: "image/jpeg" }),
    generate: async () => JSON.stringify({ items: [] }),
    generateFromImages: async () =>
      JSON.stringify({
        items: [
          {
            name: "Traditional Massage 60 Min",
            price: 250000,
            priceMax: null,
            category: "Body Massage",
            unit: "per jam",
            quote: "Traditional Massage 60 Min Rp 250.000",
          },
        ],
      }),
  });

  assert.equal(run.failures.length, 0);
  assert.equal(run.updated, 1);
  assert.equal(run.itemsSaved, 1);
});

test("hasPriceSignal mencegah panggilan model AI pada halaman tanpa harga dan competitorMenusRefreshOutcome melaporkan outlet tanpa harga daring secara jujur", async () => {
  assert.equal(hasPriceSignal("El Patio Restaurant serves International and Indonesian dishes daily from 06.00 am to 11.00 pm."), false);
  assert.equal(hasPriceSignal("Seafood BBQ every Saturday night, 250k only!"), true);
  assert.equal(hasPriceSignal("Sop Buntut Spesial Rp 125.000"), true);

  const { client } = makeFakeMenuClient([
    {
      id: "v-no-price",
      name: "El Patio Uji",
      placeId: "el_patio_uji",
      category: "resto",
      websiteUrl: "https://marbella.test/dining/el-patio/",
      parent: null,
    },
  ]);

  let generateCalls = 0;
  const run = await refreshDynamicCompetitorMenus({
    force: true,
    recordRun: false,
    client,
    checkRobots: async () => true,
    fetchPage: async (url) => ({
      url,
      html: `<html><body><h1>El Patio</h1><p>El Patio Restaurant is an all day dining restaurant serving International and Indonesian specialties from 06.00 am to 11.00 pm daily without published a la carte prices online.</p></body></html>`,
    }),
    generate: async () => {
      generateCalls++;
      return JSON.stringify({ items: [] });
    },
  });

  assert.equal(generateCalls, 0, "Halaman tanpa indikator angka harga tidak boleh memanggil model AI");
  assert.equal(run.failures.length, 0, "Outlet tanpa daftar harga daring bukan kegagalan teknis");
  assert.equal(run.noOnlinePrice, 1);

  const outcome = competitorMenusRefreshOutcome({
    attempted: 13,
    updated: 3,
    itemsSaved: 120,
    noOnlinePrice: 10,
    freshSkipped: 0,
    failures: [],
    staleAfterDays: 7,
  });
  assert.equal(outcome.status, "berhasil");
  assert.match(outcome.detail, /13 dari 13 outlet terbaca/);
  assert.match(outcome.detail, /3 outlet punya harga menu, 120 item terverifikasi/);
  assert.match(outcome.detail, /10 tidak mempublikasikan harga daring/);
  assert.doesNotMatch(`${outcome.detail} ${outcome.issue ?? ""}`, AI_MODEL_PATTERN);
});
