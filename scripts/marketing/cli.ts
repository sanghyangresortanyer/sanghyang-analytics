// Sanghyang Analytics: Google Ads 793-128-8995 + GA4 216046044 untuk Sanghyang Indah Spa Resort.
// Perubahan akun Google Ads hanya dengan --apply, setelah owner menyetujui sebelum→sesudah di chat.
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadEnv, REPORTS_DIR } from "../../src/lib/marketing/config.ts";
import {
  campaignReport,
  conversionsByAction,
  formatGoogleAdsReport,
  GoogleAdsClient,
  googleAdsSettingsFromEnv,
  setCampaignBudget,
  setCampaignStatus,
  setConversionPrimary,
  setConversionValue,
  setKeywordStatus,
} from "../../src/lib/marketing/google-ads.ts";
import { googleAdsDailySection, reminderLines } from "../../src/lib/marketing/google-ads-daily.ts";
import { addDays, todayIn } from "../../src/lib/marketing/metrics.ts";
import { htmlToPdf } from "../../src/lib/marketing/pdf.ts";
import { formatMonthlyReport, loadPeriod, monthlyPeriods } from "../../src/lib/marketing/sanghyang-monthly.ts";
import { chosenPeriods, googleWeeklyReport, loadGoogleWeek, type ReportRange, renderReports, weekPeriods } from "../../src/lib/marketing/weekly-report.ts";

const TZ = "Asia/Jakarta";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    month: { type: "string" },
    write: { type: "boolean" },
    port: { type: "string" },
    campaign: { type: "string" },
    amount: { type: "string" },
    status: { type: "string" },
    keyword: { type: "string" },
    id: { type: "string" },
    primary: { type: "string" },
    value: { type: "string" },
    apply: { type: "boolean" },
  },
});
const [cmd] = positionals;
loadEnv();

const ads = () => new GoogleAdsClient(googleAdsSettingsFromEnv());

/** Google Ads weekly report: chosen range (since–until, or 7 days from since), otherwise the last full Mon–Sun week. */
async function buildReport(range: ReportRange) {
  const chosen = chosenPeriods(range);
  const periods = chosen ?? weekPeriods();
  const client = ads();
  const [curr, prev] = await Promise.all([loadGoogleWeek(client, process.env, periods.current), loadGoogleWeek(client, process.env, periods.previous)]);
  const report = googleWeeklyReport(curr, prev);
  if (chosen?.note) report.periodNote = chosen.note;
  if (chosen?.partial) report.partial = true;
  return report;
}

function lastDaysRange(): { since: string; until: string } {
  if (values.since || values.until) {
    if (!values.since || !values.until) throw new Error("--since and --until must be used together (YYYY-MM-DD)");
    return { since: values.since, until: values.until };
  }
  const days = Number(values.days ?? 7);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer");
  const until = addDays(todayIn(TZ), -1);
  return { since: addDays(until, -(days - 1)), until };
}

async function main() {
  switch (cmd) {
    case "dashboard": {
      // Dasbor lokal kini terpadu di aplikasi Sanghyang Analytics: halaman Marketing (/marketing) setelah login.
      console.log("Dashboard Google Ads kini ada di aplikasi Sanghyang Analytics: halaman Marketing (/marketing).");
      return;
    }
    case "ads": {
      const r = lastDaysRange();
      const client = ads();
      const [campaigns, conversions] = await Promise.all([campaignReport(client, r.since, r.until), conversionsByAction(client, r.since, r.until)]);
      console.log(formatGoogleAdsReport(r.since, r.until, campaigns, conversions));
      return;
    }
    case "monthly": {
      const client = ads();
      const periods = monthlyPeriods(values.month);
      const [current, previous] = await Promise.all([loadPeriod(client, process.env, periods.current), loadPeriod(client, process.env, periods.previous)]);
      const text = formatMonthlyReport(current, previous, periods.complete);
      console.log(text);
      if (values.write) {
        mkdirSync(REPORTS_DIR, { recursive: true });
        const file = resolve(REPORTS_DIR, `sanghyang-kontak-${periods.current.since.slice(0, 7)}.md`);
        writeFileSync(file, `${text}\n`);
        console.log(`\nSaved ${file}`);
      }
      return;
    }
    case "report": {
      const range = { since: values.since, until: values.until };
      const report = await buildReport(range);
      mkdirSync(REPORTS_DIR, { recursive: true });
      const base = resolve(REPORTS_DIR, `laporan-google-sanghyang-${report.period.since}_${report.period.until}`);
      writeFileSync(`${base}.html`, renderReports([report], new Date()));
      try {
        htmlToPdf(`${base}.html`, `${base}.pdf`);
        console.log(`PDF  ${base}.pdf`);
        unlinkSync(`${base}.html`);
      } catch (error) {
        console.warn(`PDF gagal dibuat: ${(error as Error).message} (HTML tetap tersimpan: ${base}.html)`);
      }
      for (const line of report.highlights) console.log(`- ${line}`);
      return;
    }
    case "daily": {
      // Pengingat + pantauan kemarin (sama dengan kartu di /sanghyang).
      const date = values.since ?? todayIn(TZ);
      const lines = [...reminderLines(date), ...(await googleAdsDailySection(process.env, new Date(`${date}T03:00:00Z`)))];
      console.log(lines.length ? lines.join("\n") : "(kosong)");
      return;
    }
    case "ads-budget":
    case "ads-status":
    case "ads-keyword":
    case "ads-conversion":
    case "ads-conversion-value": {
      const client = ads();
      const apply = values.apply === true;
      const status = String(values.status).toUpperCase() as "ENABLED" | "PAUSED";
      const need = (v: string | undefined, flag: string) => {
        if (!v) throw new Error(`${flag} required`);
        return v;
      };
      const r =
        cmd === "ads-budget"
          ? await setCampaignBudget(client, need(values.campaign, "--campaign ID"), Number(values.amount), { apply })
          : cmd === "ads-status"
            ? await setCampaignStatus(client, need(values.campaign, "--campaign ID"), status, { apply })
            : cmd === "ads-keyword"
              ? await setKeywordStatus(client, need(values.keyword, "--keyword TEXT"), status, { apply })
              : cmd === "ads-conversion-value"
                ? await setConversionValue(client, need(values.id, "--id CONVERSION_ACTION_ID"), Number(need(values.value, "--value ANGKA")), { apply })
                : await setConversionPrimary(client, need(values.id, "--id CONVERSION_ACTION_ID"), need(values.primary, "--primary true|false") === "true", { apply });
      console.log(`${apply ? "APPLIED" : "PREVIEW OK (belum diubah; tambah --apply setelah owner setuju)"} ${r.campaign}: ${r.before} → ${r.after}`);
      return;
    }
    default:
      console.log(`Sanghyang Analytics (Marketing CLI)
  dashboard [--port 3001]                         dashboard lokal: /sanghyang (Google Ads + GA4, pengingat, pantauan), /laporan
  ads [--days N | --since --until]                biaya, klik, konversi per campaign
  monthly [--month YYYY-MM] [--write]             kontak dari iklan vs bulan lalu
  report [--since YYYY-MM-DD [--until YYYY-MM-DD]] laporan mingguan Google Ads + GA4 (PDF di REPORTS/)
  daily [--since YYYY-MM-DD]                      pengingat + pantauan kemarin
  ads-budget --campaign ID --amount RUPIAH [--apply]
  ads-status --campaign ID --status PAUSED|ENABLED [--apply]
  ads-keyword --keyword TEXT --status PAUSED|ENABLED [--apply]
  ads-conversion --id ID --primary true|false [--apply]
  ads-conversion-value --id ID --value ANGKA [--apply]
Tanpa --apply hanya pratinjau Google (akun tidak berubah).`);
      if (cmd) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  process.exitCode = 1;
});
