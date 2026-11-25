import { localLaunchOptions } from "@/lib/browser-launch";
import { parseDayRange } from "@/lib/market/date-range";
import { isOutletKey } from "@/lib/market/outlet-filters";
import { buildMeetingReport } from "@/lib/meeting-report/build";
import { pdfContentDisposition, reportPdfFileName } from "@/lib/meeting-report/download-name";
import { requireMarketingApiAccess } from "@/lib/marketing/api-auth";
import { footerTemplate, renderMeetingReport } from "@/templates/meeting-report";

export const maxDuration = 60; // Batas Vercel Hobby

async function bukaBrowser() {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { launch, defaultArgs } = await import("puppeteer-core");
    return launch({
      args: await defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch(localLaunchOptions());
}

async function handlePdfExport(req: Request) {
  const refused = await requireMarketingApiAccess();
  if (refused) return refused;

  let outlet: unknown = "all";
  let period: string | undefined;
  let from: string | undefined;
  let to: string | undefined;

  const url = new URL(req.url);
  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as {
      outlet?: unknown;
      period?: unknown;
      from?: unknown;
      to?: unknown;
    };
    outlet = body.outlet ?? url.searchParams.get("outlet") ?? "all";
    period = typeof body.period === "string" ? body.period : url.searchParams.get("period") ?? undefined;
    from = typeof body.from === "string" ? body.from : url.searchParams.get("from") ?? undefined;
    to = typeof body.to === "string" ? body.to : url.searchParams.get("to") ?? undefined;
  } else {
    outlet = url.searchParams.get("outlet") ?? "all";
    period = url.searchParams.get("period") ?? undefined;
    from = url.searchParams.get("from") ?? undefined;
    to = url.searchParams.get("to") ?? undefined;
  }

  if (outlet !== "all" && !isOutletKey(outlet)) {
    return Response.json({ error: "Outlet tidak dikenal." }, { status: 400 });
  }
  // Sama dengan ringkasan web: rentang kustom yang tidak lengkap, terbalik, atau terlalu panjang ditolak, bukan diganti preset.
  if (parseDayRange(from ?? null, to ?? null) === "invalid") {
    return Response.json({ error: "Rentang tanggal tidak sah." }, { status: 400 });
  }

  const report = await buildMeetingReport(outlet, new Date(), { period, from, to });
  const html = renderMeetingReport(report);
  // Nama berkas = judul PDF ("Laporan Insight Pasar: {outlet}"), permintaan pemilik 20 Nov 2026.
  const fileName = reportPdfFileName(report);

  let browser;
  try {
    browser = await bukaBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Font web dimuat lewat CSS; tunggu sampai siap supaya PDF tidak tercetak dengan font cadangan.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerTemplate(report),
    });
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": pdfContentDisposition(fileName),
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await browser?.close();
  }
}

export async function GET(req: Request) {
  try {
    return await handlePdfExport(req);
  } catch (error) {
    console.error("[Export PDF] Gagal membuat PDF:", error);
    return Response.json({ error: `Gagal membuat PDF: ${(error as Error).message}` }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return await handlePdfExport(req);
  } catch (error) {
    console.error("[Export PDF] Gagal membuat PDF:", error);
    return Response.json({ error: `Gagal membuat PDF: ${(error as Error).message}` }, { status: 500 });
  }
}
