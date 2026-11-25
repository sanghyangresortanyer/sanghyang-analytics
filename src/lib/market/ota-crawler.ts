/**
 * Penemu OTA dinamis lintas hotel dari Google Travel (tab Harga -> Semua opsi, dan tab Ulasan -> Sumber ulasan).
 * Tidak memakai daftar OTA statis: setiap penyedia pihak ketiga, hostname tujuan nyata (parameter `pcurl`),
 * dan sumber ulasan hotel ditemukan langsung dari halaman live, sambil memisahkan situs resmi hotel.
 */
import type { Browser, Page } from "puppeteer";
import { normalizeHost, type DiscoveredOtaProvider } from "./ota-providers";
import { buildTs, isOfficialProvider, nextStayDates } from "./room-offers";

export interface OtaHotelTarget {
  hotelId: string;
  name: string;
  ratesUrl: string;
  officialHosts?: string[];
}

export interface HotelOtaObservation {
  hotelId: string;
  providers: Array<{ provider: string; host: string | null }>;
  reviewSources: string[];
}

const NOISE_PROVIDER_LINE =
  /^(Buka situs|Visit site|Situs Resmi|Official site|Bersponsor|Sponsored|Rp[\s0-9.,]+|IDR[\s0-9.,]+|Bebas biaya.*|Free cancellation.*|Tanpa biaya.*|Semua opsi|All options|Lihat opsi.*|View more.*|\d+% lebih murah.*)$/i;

const GENERIC_REVIEW_SOURCE = /^(Semua(\s+ulasan)?|All(\s+reviews)?|Google|Sumber ulasan|Review sources|Tinjau Opsi Sumber|Review Source Options)$/i;

function isExcludedOfficial(
  provider: string,
  host: string | null,
  isOfficialBadge: boolean,
  hotelId: string,
  officialHosts: Set<string>,
): boolean {
  if (isOfficialBadge) return true;
  if (isOfficialProvider(provider, hotelId)) return true;
  if (host) {
    const nh = normalizeHost(host);
    if (officialHosts.has(nh)) return true;
    for (const oh of officialHosts) {
      if (nh.endsWith(`.${oh}`) || oh.endsWith(`.${nh}`)) return true;
    }
  }
  return false;
}

function buildTravelPriceUrl(baseRatesUrl: string, checkin: string, checkout: string): string {
  const url = new URL(baseRatesUrl);
  if (!url.pathname.endsWith("/prices")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/prices`;
  }
  url.searchParams.set("hl", "id");
  url.searchParams.set("gl", "id");
  url.searchParams.set("curr", "IDR");
  url.searchParams.set("ts", buildTs(checkin, checkout, "IDR"));
  return url.toString();
}

async function clickExpandPriceOptions(page: Page): Promise<void> {
  // Pastikan tab Harga / Prices aktif jika URL mendarat di Ringkasan.
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const priceTab = tabs.find((t) => /^(Harga|Prices)$/i.test((t.textContent ?? "").trim()));
    if (priceTab && priceTab.getAttribute("aria-selected") !== "true") {
      (priceTab as HTMLElement).click();
    }
  });
  await page
    .waitForSelector('a[href*="/travel/lodging/clk"], button[aria-label^="Visit site for "], button[aria-label^="Kunjungi situs untuk "]', {
      timeout: 8_000,
    })
    .catch(() => undefined);

  // Klik tombol perluasan ("Semua opsi", "View more options", dll.) hingga semua OTA tampil.
  for (let i = 0; i < 8; i++) {
    const before = await page.$$eval(
      'a[href*="/travel/lodging/clk"], button[aria-label^="Visit site for "], button[aria-label^="Kunjungi situs untuk "]',
      (els) => els.length,
    );
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button, a[role='button']")];
      const match = btns.find((b) =>
        /^(View more options|Lihat opsi lainnya|Semua opsi|All options|More options|Opsi lainnya)$/i.test(
          (b.textContent ?? "").trim(),
        ),
      );
      if (!match) return false;
      (match as HTMLElement).click();
      return true;
    });
    if (!clicked) break;
    await page
      .waitForFunction(
        (prevCount) =>
          document.querySelectorAll(
            'a[href*="/travel/lodging/clk"], button[aria-label^="Visit site for "], button[aria-label^="Kunjungi situs untuk "]',
          ).length > prevCount,
        { timeout: 5_000 },
        before,
      )
      .catch(() => undefined);
  }
}

async function extractPriceOtasFromPage(page: Page): Promise<Array<{ provider: string; host: string | null; isOfficial: boolean }>> {
  return page.evaluate(() => {
    const out: Array<{ provider: string; host: string | null; isOfficial: boolean }> = [];
    const seenEl = new Set<Element>();
    const triggers = [
      ...document.querySelectorAll('a[href*="/travel/lodging/clk"]'),
      ...document.querySelectorAll('button[aria-label^="Visit site for "], button[aria-label^="Kunjungi situs untuk "]'),
    ];
    for (const trigger of triggers) {
      if (seenEl.has(trigger)) continue;
      seenEl.add(trigger);

      let host: string | null = null;
      const href = trigger.getAttribute("href") ?? trigger.closest("a[href*='/travel/lodging/clk']")?.getAttribute("href") ?? "";
      if (href) {
        try {
          const parsed = new URL(href, window.location.origin);
          const pcurl = parsed.searchParams.get("pcurl");
          if (pcurl) host = new URL(pcurl).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          host = null;
        }
      }

      // Naik ke kontainer baris penawaran tunggal (berhenti bila kontainer memuat >1 link agar badge Situs Resmi tidak menular).
      let rowEl: Element | null = trigger.parentElement;
      for (let depth = 0; depth < 6 && rowEl; depth++) {
        if (rowEl.querySelectorAll('a[href*="/travel/lodging/clk"]').length > 1) {
          rowEl = trigger.parentElement;
          break;
        }
        const txt = (rowEl as HTMLElement).innerText ?? "";
        if (/(Rp\s?[\d.,]+|IDR\s?[\d.,]+)/.test(txt) && txt.split("\n").length <= 16) break;
        rowEl = rowEl.parentElement;
      }

      const rawText = ((rowEl ?? trigger) as HTMLElement).innerText ?? "";
      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
      const isOfficial = /\b(Situs Resmi|Official site)\b/i.test(rawText);

      const ariaBtn =
        trigger.matches("button[aria-label^='Visit site for '], button[aria-label^='Kunjungi situs untuk ']")
          ? trigger
          : rowEl?.querySelector("button[aria-label^='Visit site for '], button[aria-label^='Kunjungi situs untuk ']");
      const aria = ariaBtn?.getAttribute("aria-label") ?? "";
      let provider = "";
      if (aria) {
        provider = aria.replace(/^(Visit site for |Kunjungi situs untuk )/i, "").trim();
      }
      if (!provider) {
        provider =
          lines.find(
            (l) =>
              !/^(Buka situs|Visit site|Situs Resmi|Official site|Bersponsor|Sponsored|Rp[\s0-9.,]+|IDR[\s0-9.,]+|Bebas biaya.*|Free cancellation.*|Tanpa biaya.*|Semua opsi|All options|Lihat opsi.*|View more.*|\d+% lebih murah.*|Tentang opsi ini|About these options|Promo terbaik|Great deal)$/i.test(
                l,
              ) && !/^[★\d.,\s()]+$/.test(l) && l.length <= 60,
          ) ??
          host ??
          "";
      }

      // Hindari memotong label ketika Google memberi 2 span berurutan tanpa spasi (mis. Trip.com) atau spasi berlebih.
      provider = provider.replace(/\s+/g, " ").trim();

      if (provider || host) {
        out.push({ provider: provider || host || "", host, isOfficial });
      }
    }
    return out;
  });
}

async function extractReviewSourcesFromPage(page: Page): Promise<string[]> {
  // Buka tab Ulasan / Reviews bila tersedia di Google Travel.
  const tabClicked = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const target = tabs.find((t) => /^(Ulasan|Reviews)$/i.test((t.textContent ?? "").trim()));
    if (!target) return false;
    (target as HTMLElement).click();
    return true;
  });
  if (!tabClicked) return [];

  const listboxSel =
    '[role="listbox"][aria-label="Tinjau Opsi Sumber"], [role="listbox"][aria-label*="Review source"], [role="listbox"][aria-label*="Sumber"]';
  await page.waitForSelector(listboxSel, { timeout: 5_000 }).catch(() => undefined);

  // Bila opsi dropdown sumber ulasan perlu dibuka dulu, klik pemicunya.
  await page.evaluate((sel) => {
    const trigger = [...document.querySelectorAll("button, [role='button']")].find((el) =>
      /^(Semua ulasan|All reviews|Sumber ulasan|Review sources)/i.test((el.textContent ?? "").trim()),
    );
    if (trigger && document.querySelectorAll(`${sel} [role="option"]`).length === 0) {
      (trigger as HTMLElement).click();
    }
  }, listboxSel);

  const options = await page.$$eval(`${listboxSel} [role="option"]`, (els) =>
    els
      .map((e) => {
        const aria = e.getAttribute("aria-label")?.trim();
        if (aria) return aria;
        const innerSpan = e.querySelector("span span")?.textContent?.trim();
        return innerSpan || ((e as HTMLElement).innerText ?? "").split("\n")[0]?.trim() || "";
      })
      .filter(Boolean),
  );
  return [...new Set(options)];
}

function addDaysYmd(base: Date, days: number): { checkin: string; checkout: string } {
  const inDate = new Date(base.getTime() + days * 86_400_000);
  const outDate = new Date(inDate.getTime() + 86_400_000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  return { checkin: fmt(inDate), checkout: fmt(outDate) };
}

function futureStayWindowDates(now: Date): Array<{ checkin: string; checkout: string }> {
  const near = nextStayDates(now);
  const plus14 = new Date(now.getTime() + 14 * 86_400_000);
  const plus45 = new Date(now.getTime() + 45 * 86_400_000);
  return [near.weekday, near.weekend, nextStayDates(plus14).weekend, nextStayDates(plus45).weekday, addDaysYmd(now, 82)];
}

const HOST_LOOKALIKE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function discoverDynamicOtasForHotels(
  browser: Browser,
  targets: readonly OtaHotelTarget[],
  now = new Date(),
): Promise<{
  observations: HotelOtaObservation[];
  otaProviders: DiscoveredOtaProvider[];
  reviewSourcesByHotel: Record<string, string[]>;
}> {
  const stayDates = futureStayWindowDates(now);
  const observations: HotelOtaObservation[] = [];
  const mergedRecords: DiscoveredOtaProvider[] = [];
  const reviewSourcesByHotel: Record<string, string[]> = {};

  const recordMap = new Map<string, DiscoveredOtaProvider>();
  const recordOta = (providerRaw: string, host: string | null, hotelId: string, channel: "prices" | "reviews") => {
    const provider = providerRaw.trim();
    if (!provider || NOISE_PROVIDER_LINE.test(provider)) return;
    const key = provider.toLowerCase();
    const rec = recordMap.get(key) ?? { provider, hosts: [], hotelIds: [], channels: [] };
    if (host) {
      const nh = normalizeHost(host);
      if (nh && !rec.hosts.includes(nh)) rec.hosts.push(nh);
    }
    if (!rec.hotelIds.includes(hotelId)) rec.hotelIds.push(hotelId);
    if (!rec.channels.includes(channel)) rec.channels.push(channel);
    recordMap.set(key, rec);
  };

  for (const target of targets) {
    const officialHosts = new Set((target.officialHosts ?? []).map(normalizeHost));
    const seenProviders = new Map<string, string | null>();
    let reviewSources: string[] = [];

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 960 });
    try {
      for (let i = 0; i < stayDates.length; i++) {
        const d = stayDates[i];
        const url = buildTravelPriceUrl(target.ratesUrl, d.checkin, d.checkout);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForSelector('a[href*="/travel/lodging/clk"]', { timeout: 10_000 }).catch(() => {
          // ZERO-FALLBACK: tanggal tertentu dapat habis terjual di semua OTA; lanjutkan ke tanggal berikutnya.
          return undefined;
        });
        await clickExpandPriceOptions(page);

        const extracted = await extractPriceOtasFromPage(page);
        for (const item of extracted) {
          if (isExcludedOfficial(item.provider, item.host, item.isOfficial, target.hotelId, officialHosts)) continue;
          const cleanName = item.provider.trim();
          if (!cleanName || NOISE_PROVIDER_LINE.test(cleanName)) continue;
          if (!seenProviders.has(cleanName) || (!seenProviders.get(cleanName) && item.host)) {
            seenProviders.set(cleanName, item.host);
          }
          recordOta(cleanName, item.host, target.hotelId, "prices");
        }

        if (i === 0) {
          const revOpts = await extractReviewSourcesFromPage(page);
          reviewSources = revOpts.filter((src) => {
            if (GENERIC_REVIEW_SOURCE.test(src)) return false;
            const hostCandidate = HOST_LOOKALIKE.test(src) ? src : null;
            return !isExcludedOfficial(src, hostCandidate, false, target.hotelId, officialHosts);
          });
          for (const src of reviewSources) {
            recordOta(src, HOST_LOOKALIKE.test(src) ? src : null, target.hotelId, "reviews");
          }
        }
      }
    } catch (err) {
      // ZERO-FALLBACK: catat kegagalan hotel ini di stderr tanpa menghentikan pemindaian hotel lain.
      console.error(`[ota-crawler] gagal memuat ${target.hotelId}: ${(err as Error).message}`);
    } finally {
      // ZERO-FALLBACK: konteks selalu ditutup pada cleanup agar memori browser bebas.
      await ctx.close().catch(() => undefined);
    }

    if (reviewSources.length) reviewSourcesByHotel[target.hotelId] = reviewSources;
    observations.push({
      hotelId: target.hotelId,
      providers: [...seenProviders.entries()].map(([provider, host]) => ({ provider, host })),
      reviewSources,
    });
  }

  for (const rec of recordMap.values()) mergedRecords.push(rec);
  mergedRecords.sort((a, b) => a.provider.localeCompare(b.provider));
  return {
    observations,
    otaProviders: mergedRecords,
    reviewSourcesByHotel,
  };
}
