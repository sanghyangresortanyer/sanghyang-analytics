import type { Page } from "puppeteer";

export type GoogleHotelRate = {
  hotelName: string;
  price: number;
  currency: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  source: "Google Hotels lowest displayed rate";
  sourceUrl: string;
  observedAt: Date;
};

export function encodeVarint(val: number): number[] {
  const bytes: number[] = [];
  let v = val;
  while (v > 127) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

export function generateGoogleHotelToken(checkIn: Date, checkOut: Date, currency = "IDR"): string {
  const y1 = checkIn.getUTCFullYear();
  const m1 = checkIn.getUTCMonth() + 1;
  const d1 = checkIn.getUTCDate();

  const y2 = checkOut.getUTCFullYear();
  const m2 = checkOut.getUTCMonth() + 1;
  const d2 = checkOut.getUTCDate();

  const d1Bytes = [0x08, ...encodeVarint(y1), 0x10, m1, 0x18, d1];
  const d2Bytes = [0x08, ...encodeVarint(y2), 0x10, m2, 0x18, d2];

  const tag2Sub = [0x0a, d1Bytes.length, ...d1Bytes, 0x12, d2Bytes.length, ...d2Bytes, 0x18, 0x01];
  const tag2Inner = [0x12, tag2Sub.length, ...tag2Sub, 0x32, 0x02, 0x08, 0x01];
  const tag2 = [0x12, tag2Inner.length, ...tag2Inner];
  const tag3Inner = [0x0a, 0x02, 0x1a, 0x00, ...tag2];
  const tag3 = [0x1a, tag3Inner.length, ...tag3Inner];

  const currBytes = Buffer.from(currency, "ascii");
  const tag5Inner = [0x3a, currBytes.length, ...currBytes];
  const tag5 = [0x2a, tag5Inner.length + 4, 0x0a, tag5Inner.length, ...tag5Inner, 0x1a, 0x00];

  const full = Buffer.from([0x08, 0x01, ...tag3, ...tag5]);
  return full.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Tab Prices satu hotel dengan wilayah Indonesia dan rupiah, sama dengan perayap tarif per kamar (room-offers.ts). Label
 * halaman berbahasa Indonesia (hl=id) dipakai pengurai di bawah.
 */
export function googleHotelPricesUrl(entityUrl: string, checkIn: Date, checkOut: Date, guests: number): string {
  const url = new URL(entityUrl.includes("/prices") ? entityUrl : entityUrl.replace(/(\/entity\/[^/?#]+)/, "$1/prices"));
  const params = {
    hl: "id",
    gl: "id",
    curr: "IDR",
    checkin: checkIn.toISOString().slice(0, 10),
    checkout: checkOut.toISOString().slice(0, 10),
    adults: String(guests),
    ts: generateGoogleHotelToken(checkIn, checkOut, "IDR"),
    ap: "MAE",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Pilihan dialog "Harga yang ditampilkan" untuk harga per malam termasuk pajak dan biaya (atribut data-value, tidak
 * bergantung bahasa). Google memilih tampilan bawaan dari lokasi alamat internet, bukan dari parameter gl: dari komputer
 * di Indonesia bawaannya pilihan ini, dari runner GitHub di AS harga sebelum pajak dan biaya (lihat rate-basis.ts).
 * Label tombol tetap "Total per malam" walaupun pilihan sudah diganti (teruji 23 Nov 2026), jadi mode dibaca dari pilihan
 * yang tercentang di dialog.
 */
export const TOTAL_PER_NIGHT_MODE = "displayNightlyFullPrice";
const PRICE_MODE_BUTTON = 'button[aria-label^="Harga yang ditampilkan"]';
const PRICE_MODE_OPTION = '[role="radio"][data-value^="display"]';
/**
 * Ukuran layar desktop, sama dengan perayap tarif per kamar. Pada 800×600 bawaan Puppeteer, pilihan di dialog tampil tetapi
 * tidak menerima klik (teruji 23 Nov 2026), sehingga tampilan harga tidak bisa diganti.
 */
const DESKTOP_VIEWPORT = { width: 1280, height: 3200 };

export type PriceModeOption = { value: string; checked: boolean };
export type PriceModeAction = { action: "keep" } | { action: "switch"; from: string | null };

/** Langkah agar harga yang tampil adalah total per malam; galat bila pilihan itu tidak ditawarkan halaman. */
export function priceModeAction(options: PriceModeOption[]): PriceModeAction {
  const total = options.find((o) => o.value === TOTAL_PER_NIGHT_MODE);
  if (!total) {
    throw new Error(`pilihan harga Total per malam (${TOTAL_PER_NIGHT_MODE}) tidak ditawarkan; pilihan yang ada: ${options.map((o) => o.value).join(", ") || "tidak ada"}`);
  }
  if (total.checked) return { action: "keep" };
  return { action: "switch", from: options.find((o) => o.checked)?.value ?? null };
}

/**
 * Membuka dialog "Harga yang ditampilkan", memilih Total per malam bila belum terpilih, lalu membuka ulang dialog untuk
 * memastikan pilihan itu yang berlaku. Galat bila dasar harga tidak bisa dipastikan; tarif tidak disimpan. Halaman harus
 * dibuka dengan DESKTOP_VIEWPORT.
 */
export async function ensureTotalPerNightPrices(page: Page): Promise<PriceModeAction> {
  const visibleOptions = () =>
    page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter((r) => (r as HTMLElement).checkVisibility())
          .map((r) => ({ value: r.getAttribute("data-value") ?? "", checked: r.getAttribute("aria-checked") === "true" })),
      PRICE_MODE_OPTION,
    );
  const openDialog = async () => {
    const opened = await page.evaluate((sel) => {
      const button = [...document.querySelectorAll(sel)].find((b) => (b as HTMLElement).checkVisibility()) as HTMLElement | undefined;
      button?.click();
      return Boolean(button);
    }, PRICE_MODE_BUTTON);
    if (!opened) throw new Error("tombol 'Harga yang ditampilkan' tidak tampil, dasar harga tidak bisa dipastikan");
    await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((r) => (r as HTMLElement).checkVisibility()), { timeout: 10_000 }, PRICE_MODE_OPTION);
  };
  const closeDialog = async (buttonText: "Batal" | "Selesai") => {
    const clicked = await page.evaluate((text) => {
      const button = [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => (b as HTMLElement).checkVisibility() && b.textContent?.trim() === text,
      ) as HTMLElement | undefined;
      button?.click();
      return Boolean(button);
    }, buttonText);
    if (!clicked) throw new Error(`tombol '${buttonText}' di dialog 'Harga yang ditampilkan' tidak tampil`);
    await page.waitForFunction((sel) => ![...document.querySelectorAll(sel)].some((r) => (r as HTMLElement).checkVisibility()), { timeout: 10_000 }, PRICE_MODE_OPTION);
  };

  await openDialog();
  const action = priceModeAction(await visibleOptions());
  if (action.action === "keep") {
    await closeDialog("Batal");
    return action;
  }
  const option = `[role="radio"][data-value="${TOTAL_PER_NIGHT_MODE}"]`;
  await page.evaluate((sel) => ([...document.querySelectorAll(sel)].find((r) => (r as HTMLElement).checkVisibility()) as HTMLElement).click(), option);
  await page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].some((r) => (r as HTMLElement).checkVisibility() && r.getAttribute("aria-checked") === "true"),
    { timeout: 10_000 },
    option,
  );
  await closeDialog("Selesai");
  // Harga dimuat ulang lewat jaringan sesudah pilihan diterapkan (teruji: harga 2 malam berganti dalam satu putaran ini).
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 });
  await openDialog();
  const applied = priceModeAction(await visibleOptions());
  await closeDialog("Batal");
  if (applied.action !== "keep") throw new Error(`tampilan harga tetap ${applied.from ?? "tidak diketahui"} sesudah memilih Total per malam`);
  return action;
}

/** Judul daftar penawaran hotel di tab Prices (hl=id). */
const OFFERS_HEADING = "Semua opsi";
/** Blok hotel lain di bawah daftar penawaran; harga di sana milik hotel lain. */
const OTHER_HOTEL_MARKERS = [
  "Bersponsor·Hotel serupa",
  "Hotel serupa",
  "Orang juga melihat",
  "Akomodasi serupa",
  "Hotel lain di sekitar",
  "Akomodasi lain di sekitar",
  "Tempat-tempat terdekat",
];
/** Tombol penutup tiap penawaran hotel ini; blok hotel serupa memakai "Kunjungi <situs>". */
const OFFER_BUTTON = "Buka situs";
const PRICE_RE = /(?:Rp|IDR)[\s ]*([\d.]+)/g;
const MORE_OPTIONS_RE = /Lihat opsi lainnya mulai dari[\s ]*(?:Rp|IDR)[\s ]*([\d.]+)/;

const rupiahOf = (digits: string) => Number(digits.replace(/\./g, ""));

/**
 * Tarif termurah yang tampil untuk hotel itu: harga terakhir sebelum tiap tombol "Buka situs" (harga coret ada di
 * depannya), termasuk situs resmi, ditambah "Lihat opsi lainnya mulai dari" untuk penawaran yang disembunyikan. Teks
 * sesudah judul daftar penawaran yang masuk blok hotel lain dibuang. Tanpa penawaran hotel itu hasilnya null.
 */
export function parseDisplayedRate(text: string, context: Omit<GoogleHotelRate, "price" | "currency" | "source" | "observedAt">): GoogleHotelRate | null {
  const listStart = text.indexOf(OFFERS_HEADING);
  const ends = OTHER_HOTEL_MARKERS.map((marker) => text.indexOf(marker, Math.max(listStart, 0))).filter((i) => i >= 0);
  const region = text.slice(0, ends.length ? Math.min(...ends) : text.length);

  const prices = region
    .split(OFFER_BUTTON)
    .slice(0, -1)
    .flatMap((offer) => {
      const last = [...offer.matchAll(PRICE_RE)].at(-1);
      return last ? [rupiahOf(last[1])] : [];
    });
  const more = region.match(MORE_OPTIONS_RE);
  if (more) prices.push(rupiahOf(more[1]));
  const shown = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (!shown.length) return null;

  return {
    ...context,
    price: Math.min(...shown),
    currency: "IDR",
    source: "Google Hotels lowest displayed rate",
    observedAt: new Date(),
  };
}

/**
 * Tarif termurah satu hotel untuk satu malam, dibaca dengan Chrome karena dasar harganya harus dipastikan di halaman
 * (pilihan "Harga yang ditampilkan"); pembaca teks seperti Crawl4AI ikut membaca teks pilihan yang tersembunyi sehingga
 * tidak bisa membuktikan pilihan yang tercentang.
 */
export async function fetchGoogleHotelRate(url: string, context: Omit<GoogleHotelRate, "price" | "currency" | "source" | "sourceUrl" | "observedAt">) {
  const target = googleHotelPricesUrl(url, context.checkIn, context.checkOut, context.guests);
  // Dimuat saat dipakai: konstanta collect-rates juga dibaca Knowledge Graph dan panel admin yang tidak membuka Chrome.
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(DESKTOP_VIEWPORT);
    await page.goto(target, { waitUntil: "networkidle2", timeout: 30_000 });
    const mode = await ensureTotalPerNightPrices(page);
    if (mode.action === "switch") {
      console.log(`[google-hotel-rate] ${context.hotelName} ${context.checkIn.toISOString().slice(0, 10)}: tampilan harga diganti dari ${mode.from ?? "pilihan tidak diketahui"} ke Total per malam`);
    }
    const text = await page.evaluate(() => document.body.innerText);
    return parseDisplayedRate(text, { ...context, sourceUrl: target });
  } finally {
    await browser.close();
  }
}
