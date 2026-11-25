/**
 * Status jujur tiap langkah "Perbarui Semua Data" dan job malam (full-refresh.ts) beserta ringkasannya.
 * Fungsi murni tanpa basis data atau jaringan, jadi aturannya diuji langsung dan ikut dipakai di peramban.
 * Aturannya: tanpa masukan sama sekali = dilewati (dengan alasan), semua masukan gagal = gagal, campuran = sebagian.
 */
import type { RefreshStepKey, RefreshStepStatus } from "./refresh-progress";

export type StepVerdict = Exclude<RefreshStepStatus, "menunggu" | "berjalan">;

export interface StepOutcome {
  status: StepVerdict;
  /** Satu kalimat untuk tim pemasaran (panel tombol, heartbeat, ringkasan job), tanpa galat teknis mentah. */
  detail: string;
  /** Kendala teknis untuk log dan bukti heartbeat; null bila langkah berhasil penuh. */
  issue: string | null;
}

export interface StepRecord {
  key: RefreshStepKey;
  label: string;
  status: RefreshStepStatus;
  detail: string | null;
}

const STATUS_TAG: Record<RefreshStepStatus, string> = {
  menunggu: "Belum berjalan",
  berjalan: "Belum selesai",
  berhasil: "Berhasil",
  sebagian: "Sebagian",
  gagal: "Gagal",
  dilewati: "Dilewati",
};
const VERDICTS: readonly StepVerdict[] = ["berhasil", "sebagian", "gagal", "dilewati"];

/** Awalan pesan ScrapeError untuk run tanpa masukan; enum ScrapeRunStatus tidak punya status dilewati. */
export const SKIP_PREFIX = "Dilewati:";
/** MarketInsight berisi hasil pembaruan penuh terakhir (header Insight Pasar, Knowledge Graph, briefing pagi). */
export const HEARTBEAT_FINGERPRINT = "nightly-sync-heartbeat";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Daftar kendala yang tetap terbaca: empat butir pertama (sama dengan log lama), sisanya disebut jumlahnya. */
function shortList(items: readonly string[], max = 4): string {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; dan ${items.length - max} lainnya` : shown;
}

export function verdictFromCounts(succeeded: number, failed: number): StepVerdict {
  if (failed > 0) return succeeded > 0 ? "sebagian" : "gagal";
  return succeeded > 0 ? "berhasil" : "dilewati";
}

export const skippedOutcome = (detail: string, issue = `dilewati: ${detail}`): StepOutcome => ({ status: "dilewati", detail, issue });

/** Galat yang menghentikan langkah: kalimatnya untuk tim, pesan aslinya untuk log. */
export const crashedOutcome = (detail: string, error: unknown): StepOutcome => ({
  status: "gagal",
  detail,
  issue: `${detail.replace(/\.$/, "")} (${messageOf(error)})`,
});

/** Kegagalan di ujung langkah (misalnya potret bulanan) menurunkan status tanpa menghapus hasil sebelumnya. */
export function withExtraFailure(outcome: StepOutcome, detail: string, issue: string): StepOutcome {
  const status: StepVerdict = outcome.status === "berhasil" ? "sebagian" : outcome.status === "dilewati" ? "gagal" : outcome.status;
  return { status, detail: `${outcome.detail} ${detail}`, issue: outcome.issue ? `${outcome.issue}; ${issue}` : issue };
}

/** Hasil pembacaan isi berita (lib/market/news-relevance.ts readCandidateNews), tanpa mengimpor modul pembacanya. */
export interface NewsReadingSummary {
  candidates: number;
  read: number;
  counts: { relevan: number; tidak_relevan: number; di_luar_radius: number; lokasi_tidak_jelas: number; tidak_terbaca: number };
  failures: readonly string[];
}

function newsFetchOutcome(status: "running" | "success" | "partial" | "failed"): StepOutcome {
  switch (status) {
    case "success":
      return { status: "berhasil", detail: "Berita terbaru tersimpan.", issue: null };
    case "partial":
      return { status: "sebagian", detail: "Sebagian sumber berita tidak terbaca; berita dari sumber lain tersimpan.", issue: "sebagian sumber berita tidak terbaca" };
    case "failed":
      return { status: "gagal", detail: "Semua sumber berita gagal dibaca, jadi tidak ada berita baru.", issue: "berita gagal: semua sumber berita tidak terbaca" };
    case "running":
      return { status: "gagal", detail: "Pengambilan berita tidak selesai.", issue: "berita gagal: run berita masih tercatat berjalan" };
  }
}

/**
 * Langkah berita: pengambilan dari Google News, lalu pembacaan isi berita kandidat. Berita yang isinya belum terbaca
 * tidak tampil sebagai berita relevan, jadi kegagalan pembacaan menurunkan langkah ini menjadi sebagian.
 */
export function newsOutcome(status: "running" | "success" | "partial" | "failed", reading?: NewsReadingSummary | { error: string }): StepOutcome {
  const fetched = newsFetchOutcome(status);
  if (!reading) return fetched;
  const degraded: StepOutcome["status"] = fetched.status === "berhasil" ? "sebagian" : fetched.status;
  if ("error" in reading) {
    return { status: degraded, detail: `${fetched.detail} Isi berita belum bisa dibaca: ${reading.error}`, issue: fetched.issue ?? `pembacaan isi berita gagal: ${reading.error}` };
  }
  const c = reading.counts;
  const tally = reading.candidates
    ? `${reading.candidates} berita kandidat dibaca isinya: ${c.relevan} relevan, ${c.tidak_relevan} tidak terkait outlet, ${c.di_luar_radius} di luar radius 25 km, ${c.lokasi_tidak_jelas} lokasinya tidak jelas, ${c.tidak_terbaca} tidak terbaca di situs penerbit.`
    : "Tidak ada berita kandidat baru untuk dibaca.";
  if (!reading.failures.length) return { ...fetched, detail: `${fetched.detail} ${tally}` };
  return {
    status: degraded,
    detail: `${fetched.detail} ${tally} ${reading.failures.length} berita belum selesai dinilai dan dicoba lagi pada pembaruan berikutnya.`,
    issue: fetched.issue ?? `pembacaan isi berita: ${reading.failures.slice(0, 2).join("; ")}`,
  };
}

export function ratesOutcome({ saved, failures }: { saved: number; failures: readonly string[] }): StepOutcome {
  const status = verdictFromCounts(saved, failures.length);
  if (status === "dilewati") return skippedOutcome("Belum ada hotel dengan halaman Google Hotels yang terdaftar, jadi tidak ada tarif yang dibaca.");
  return {
    status,
    detail: status === "gagal"
      ? `Tidak ada tarif kamar yang terbaca (${failures.length} percobaan gagal).`
      : `${saved} tarif kamar tersimpan${failures.length ? `, ${failures.length} belum terbaca` : ""}.`,
    issue: failures.length ? `tarif gagal untuk ${shortList(failures)}` : null,
  };
}

export function reviewsOutcome({ attempted, totalInserted, failures }: { attempted: number; totalInserted: number; failures: readonly string[] }): StepOutcome {
  const read = Math.max(0, attempted - failures.length);
  const status = verdictFromCounts(read, failures.length);
  if (status === "dilewati") return skippedOutcome("Belum ada kompetitor terdaftar untuk diambil ulasannya.");
  return {
    status,
    detail: status === "gagal"
      ? `Ulasan dari ${attempted} properti tidak ada yang terbaca.`
      : `+${totalInserted} ulasan baru; ${read} dari ${attempted} properti terbaca.`,
    issue: failures.length ? `ulasan gagal untuk ${shortList(failures)}` : null,
  };
}

export function socialOutcome(r: {
  attempted: number;
  newPosts: number;
  blocked: readonly string[];
  failures: readonly string[];
  skippedReason?: string;
  /** Postingan yang isinya belum terbaca (caption dan poster). */
  readFailures?: readonly string[];
}): StepOutcome {
  if (r.skippedReason) {
    const detail = /belum tersambung/i.test(r.skippedReason)
      ? "Instagram belum tersambung lewat akses resmi, jadi langkah ini dilewati."
      : "Akses resmi Instagram sudah tersambung, tetapi pengambilan postingan kompetitor lewat akses itu belum diaktifkan, jadi langkah ini dilewati.";
    return skippedOutcome(detail, `sosmed dilewati: ${r.skippedReason}`);
  }
  const unreachable = r.failures.length + r.blocked.length;
  const reached = Math.max(0, r.attempted - unreachable);
  const readFailures = r.readFailures ?? [];
  const counted = verdictFromCounts(reached, unreachable);
  if (counted === "dilewati") return skippedOutcome("Belum ada kompetitor dengan akun Instagram yang terdaftar.");
  const issues = [
    r.blocked.length ? `Instagram meminta login untuk ${r.blocked.length}/${r.attempted} akun (perlu akses resmi Instagram)` : null,
    r.failures.length ? `sosmed gagal untuk ${shortList(r.failures)}` : null,
    readFailures.length ? `isi ${readFailures.length} postingan belum terbaca (${shortList(readFailures, 3)})` : null,
  ].filter((x): x is string => x !== null);
  return {
    status: counted === "berhasil" && readFailures.length ? "sebagian" : counted,
    detail: `${r.newPosts} postingan baru; ${reached} dari ${r.attempted} akun terbaca${readFailures.length ? `, isi ${readFailures.length} postingan belum terbaca` : ""}.`,
    issue: issues.length ? issues.join("; ") : null,
  };
}

/** Langkah status promo: impor promo yang dikirim pengumpul (received) dan penandaan promo yang lewat masa berlaku. */
export function promoStatusOutcome(r: { received: number; totalSynced: number; activeCount: number; expiredCount: number }): StepOutcome {
  if (r.received === 0) {
    if (r.expiredCount === 0) return skippedOutcome("Tidak ada promo baru untuk diimpor dan tidak ada promo yang lewat masa berlakunya.");
    return { status: "berhasil", detail: `${r.expiredCount} promo yang lewat masa berlakunya ditandai kedaluwarsa; tidak ada promo baru untuk diimpor.`, issue: null };
  }
  const unmatched = Math.max(0, r.received - r.totalSynced);
  return {
    status: verdictFromCounts(r.totalSynced, unmatched),
    detail: `${r.totalSynced} dari ${r.received} promo tersimpan (${r.activeCount} aktif), ${r.expiredCount} kedaluwarsa${unmatched ? `; ${unmatched} tidak cocok dengan kompetitor terdaftar` : ""}.`,
    issue: unmatched ? `${unmatched} promo tidak cocok dengan kompetitor terdaftar` : null,
  };
}

/** Situs kompetitor menentukan status; penawaran situs Sanghyang yang gagal hanya menurunkannya. */
export function websiteOutcome(r: {
  sites: number;
  saved: number;
  /** Penawaran yang sudah tersimpan lalu diperbarui dari bacaan terbaru. */
  updated?: number;
  /** Event yang baru ditandai pada penyegaran ini. */
  events?: number;
  /** Baris yang jenisnya (promo atau event) belum terbaca. */
  kindFailures?: number;
  siteFailures: readonly string[];
  ownFailure: string | null;
}): StepOutcome {
  const read = Math.max(0, r.sites - r.siteFailures.length);
  const base = verdictFromCounts(read, r.siteFailures.length);
  const degraded = Boolean(r.ownFailure) || Boolean(r.kindFailures);
  const status: StepVerdict = !degraded ? base : base === "berhasil" ? "sebagian" : base === "dilewati" && r.ownFailure ? "gagal" : base;
  if (status === "dilewati") return skippedOutcome("Belum ada kompetitor aktif dengan situs resmi yang terdaftar; penawaran situs Sanghyang tetap diperbarui.");
  const failures = r.ownFailure ? [...r.siteFailures, `Sanghyang: ${r.ownFailure}`] : r.siteFailures;
  const extra = [
    r.updated ? `${r.updated} diperbarui dari situs` : null,
    r.events ? `${r.events} event baru ditandai` : null,
    r.kindFailures ? `${r.kindFailures} jenis promo/event belum terbaca` : null,
  ].filter(Boolean);
  return {
    status,
    detail: `${read} dari ${r.sites} situs kompetitor terbaca, ${r.saved} promo baru${extra.length ? `, ${extra.join(", ")}` : ""}${r.ownFailure ? "; penawaran situs Sanghyang belum terbaca" : ""}.`,
    issue: failures.length ? `situs gagal untuk ${shortList(failures)}` : null,
  };
}

export function ratingsOutcome(r: { updated: readonly string[]; failures: readonly string[]; reviewsInserted: number }): StepOutcome {
  const status = verdictFromCounts(r.updated.length, r.failures.length);
  if (status === "dilewati") return skippedOutcome("Belum ada outlet atau kompetitor dengan tautan Google Maps yang terdaftar.");
  return {
    status,
    detail: status === "gagal"
      ? `Rating Google Maps tidak ada yang terbaca (${r.failures.length} tempat).`
      : `${r.updated.length} rating diperbarui, +${r.reviewsInserted} ulasan outlet baru${r.failures.length ? `, ${r.failures.length} tempat belum terbaca lengkap` : ""}.`,
    issue: r.failures.length ? `rating outlet gagal untuk ${shortList(r.failures)}` : null,
  };
}

/** attempted = ulasan yang menunggu ditandai; yang tidak dijawab dicoba lagi pada pembaruan berikutnya. */
export function taggingOutcome(r: { attempted: number; checked: number; tagged: number; failures: readonly string[] }): StepOutcome {
  if (r.attempted === 0) return skippedOutcome("Tidak ada ulasan resort baru yang perlu ditandai.");
  const status = verdictFromCounts(r.checked, r.attempted - r.checked);
  return {
    status,
    detail: status === "gagal"
      ? `${r.attempted} ulasan resort belum bisa ditandai; dicoba lagi pada pembaruan berikutnya.`
      : `${r.checked} dari ${r.attempted} ulasan dibaca, ${r.tagged} menyebut outlet tertentu.`,
    issue: r.failures.length || r.checked < r.attempted
      ? `penandaan ulasan belum lengkap: ${r.attempted - r.checked} dari ${r.attempted} belum terbaca${r.failures.length ? ` (${shortList(r.failures, 3)})` : ""}`
      : null,
  };
}

/** listed = rilis yang dikembalikan BPS WebAPI; saved = yang judulnya terurai dan tersimpan. */
export function macroOutcome(r: { saved: number; listed: number; skippedReason?: string }): StepOutcome {
  if (r.skippedReason) {
    const detail = /BPS_WEBAPI_KEY/.test(r.skippedReason)
      ? "Kunci BPS WebAPI belum diisi; TPK terakhir yang tersimpan tetap dipakai beserta bulannya."
      : "Rilis TPK baru tidak dicari; TPK terakhir yang tersimpan tetap dipakai beserta bulannya.";
    return skippedOutcome(detail, `TPK BPS dilewati: ${r.skippedReason}`);
  }
  if (r.listed === 0) return skippedOutcome("BPS belum memuat rilis TPK hotel bintang Banten; TPK terakhir yang tersimpan tetap dipakai.");
  if (r.saved === 0) {
    return { status: "gagal", detail: "Judul rilis BPS tidak dikenali, jadi TPK baru tidak tersimpan.", issue: `TPK BPS gagal: ${r.listed} rilis ditemukan, tidak ada judul yang terurai` };
  }
  return { status: "berhasil", detail: `${r.saved} rilis TPK tersimpan dari BPS.`, issue: null };
}

/** Status ScrapeRun untuk satu langkah. Dilewati dicatat partial beserta pesan SKIP_PREFIX (lihat isSkippedRun). */
export function runStatusFor(verdict: StepVerdict): "success" | "partial" | "failed" {
  return verdict === "berhasil" ? "success" : verdict === "gagal" ? "failed" : "partial";
}

export const skipErrorMessage = (reason: string) => `${SKIP_PREFIX} ${reason}`;
export const isSkippedRun = (messages: readonly string[]) => messages.length > 0 && messages.every((m) => m.startsWith(SKIP_PREFIX));

export function countVerdicts(steps: readonly { status: RefreshStepStatus }[]): Record<StepVerdict, number> {
  const counts: Record<StepVerdict, number> = { berhasil: 0, sebagian: 0, gagal: 0, dilewati: 0 };
  for (const step of steps) if (step.status !== "menunggu" && step.status !== "berjalan") counts[step.status] += 1;
  return counts;
}

export const describeCounts = (counts: Record<StepVerdict, number>) => VERDICTS.map((v) => `${counts[v]} ${v}`).join(", ");

export const refreshFailed = (steps: readonly { status: RefreshStepStatus }[]) => steps.some((s) => s.status === "gagal");

export function refreshHeadline(state: { finishedAt: string | null; steps: readonly { status: RefreshStepStatus }[] }): string {
  if (!state.finishedAt) return "Pembaruan sedang berjalan";
  const counts = countVerdicts(state.steps);
  if (counts.gagal) return `Pembaruan selesai, ${counts.gagal} langkah gagal`;
  if (counts.sebagian) return "Pembaruan selesai, sebagian data belum terbaca";
  return "Pembaruan selesai";
}

export interface HeartbeatStats {
  ratesCount: number;
  reviewsInserted: number;
  reviewsSkipped: number;
  socialPostsFound: number;
  socialNewPosts: number;
}

/** Kalimat heartbeat: hitungan per status, angka utama, lalu setiap langkah yang tidak berhasil beserta alasannya. */
export function heartbeatSummary({ origin, finishedAt, steps, stats }: { origin: "github" | "lokal"; finishedAt: Date; steps: readonly StepRecord[]; stats: HeartbeatStats }): string {
  const who = origin === "lokal" ? "Pembaruan dari komputer lokal" : "Pembaruan otomatis";
  const when = finishedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const facts = `${stats.ratesCount} tarif kamar terpantau, ulasan baru +${stats.reviewsInserted} (${stats.reviewsSkipped} sudah ada), postingan sosmed ${stats.socialPostsFound} terbaca (${stats.socialNewPosts} baru).`;
  const notes = steps.filter((s) => s.status !== "berhasil").map((s) => `[${STATUS_TAG[s.status]}] ${s.label}: ${s.detail ?? "tanpa keterangan."}`);
  return `${who} selesai pada ${when} WIB: ${describeCounts(countVerdicts(steps))}. ${facts} ${notes.length ? notes.join(" ") : "Semua langkah berhasil."}`;
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Ringkasan Markdown untuk $GITHUB_STEP_SUMMARY: hitungan lalu tabel per langkah. */
export function refreshMarkdownSummary(steps: readonly StepRecord[]): string {
  return [
    "### Pembaruan data malam",
    "",
    describeCounts(countVerdicts(steps)),
    "",
    "| Langkah | Status | Keterangan |",
    "| --- | --- | --- |",
    ...steps.map((s) => `| ${cell(s.label)} | ${STATUS_TAG[s.status]} | ${cell(s.detail ?? "")} |`),
    "",
  ].join("\n");
}
