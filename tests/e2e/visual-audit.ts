import puppeteer, { type Page } from "puppeteer";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3001";
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/design/layar");

interface RouteConfig {
  path: string;
  name: string;
  needsAuth: boolean;
}

const ROUTES: RouteConfig[] = [
  { path: "/login", name: "login", needsAuth: false },
  { path: "/", name: "dashboard", needsAuth: true },
  { path: "/upload-mingguan", name: "upload-mingguan", needsAuth: true },
  { path: "/data-sheets", name: "data-sheets", needsAuth: true },
  { path: "/marketing?bagian=google", name: "marketing-google", needsAuth: true },
  { path: "/marketing?bagian=insight-pasar", name: "marketing-insight-pasar", needsAuth: true },
  { path: "/marketing?bagian=media-sosial", name: "marketing-media-sosial", needsAuth: true },
  { path: "/marketing?bagian=strategy", name: "marketing-strategy", needsAuth: true },
  { path: "/riwayat", name: "riwayat", needsAuth: true },
  { path: "/pengaturan", name: "pengaturan", needsAuth: true },
];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900, isMobile: false },
  { label: "mobile", width: 390, height: 844, isMobile: true },
];

interface AuditResult {
  route: string;
  viewport: string;
  status: number;
  consoleErrors: string[];
  failedRequests: { url: string; status: number }[];
  clientWidth: number;
  scrollWidth: number;
  hasHorizontalScroll: boolean;
  screenshotPath: string;
}

async function signInWithSupabaseForm(page: Page) {
  const username = process.env.LOCAL_DEV_AUTH_USER?.trim();
  const password = process.env.LOCAL_DEV_AUTH_PASSWORD?.trim();
  if (!username || !password) return false;

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2" });
  const selectEl = await page.$("select#username");
  if (selectEl) {
    await page.select("select#username", username);
  } else {
    await page.type("input#username", username);
  }
  await page.type("input#password", password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  return !page.url().includes("/login");
}

async function runAudit() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: process.env.PUPPETEER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });

  const results: AuditResult[] = [];
  try {
    const page = await browser.newPage();
    const signedIn = await signInWithSupabaseForm(page);

    for (const route of ROUTES) {
      if (route.needsAuth && !signedIn) continue;
      for (const vp of VIEWPORTS) {
        await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile });
        const consoleErrors: string[] = [];
        const failedRequests: { url: string; status: number }[] = [];

        const onConsole = (msg: { type: () => string; text: () => string }) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        };
        const onResponse = (res: { status: () => number; url: () => string }) => {
          if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
        };

        page.on("console", onConsole);
        page.on("response", onResponse);

        const response = await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "networkidle2", timeout: 30000 });
        const metrics = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        const screenshotPath = path.join(SCREENSHOT_DIR, `${route.name}-${vp.label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        page.off("console", onConsole);
        page.off("response", onResponse);

        results.push({
          route: route.path,
          viewport: vp.label,
          status: response?.status() ?? 0,
          consoleErrors,
          failedRequests,
          clientWidth: metrics.clientWidth,
          scrollWidth: metrics.scrollWidth,
          hasHorizontalScroll: metrics.scrollWidth > metrics.clientWidth,
          screenshotPath,
        });
      }
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
  const failures = results.filter((r) => r.status >= 400 || r.hasHorizontalScroll || r.consoleErrors.length > 0);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

runAudit().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
