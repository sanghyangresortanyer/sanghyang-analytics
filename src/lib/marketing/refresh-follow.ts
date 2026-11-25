/**
 * Pengikut progres SSE "Perbarui Semua Data" (`/api/admin/scraping/progress`) + ringkasan status
 * Tipe dan helper streaming progres pembaruan data Sanghyang Analytics.
 */

export type RefreshStepStatus = "menunggu" | "berjalan" | "berhasil" | "sebagian" | "gagal" | "dilewati";
export type StepVerdict = Exclude<RefreshStepStatus, "menunggu" | "berjalan">;

export interface RefreshStep {
  key: string;
  label: string;
  status: RefreshStepStatus;
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RefreshState {
  origin: "lokal" | "github";
  startedAt: string;
  finishedAt: string | null;
  failed: boolean | null;
  steps: RefreshStep[];
}

export const PROGRESS_PING_MS = 15_000;
export const PROGRESS_SILENCE_MS = PROGRESS_PING_MS * 3;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const REFRESH_CHANNEL = "sanghyang-refresh";

export interface RefreshEnded {
  type: "pembaruan-berakhir";
  startedAt: string;
  finishedAt: string | null;
  failed: boolean | null;
  lost: boolean;
}

export const isRefreshEnded = (value: unknown): value is RefreshEnded =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "pembaruan-berakhir" &&
  typeof (value as { startedAt?: unknown }).startedAt === "string";

export function reconnectDelay(attempt: number, base = RECONNECT_BASE_MS, max = RECONNECT_MAX_MS): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

export function parseSse(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: string[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (data.length) events.push(data.join("\n"));
  }
  return { events, rest };
}

export type StateEvent =
  | { type: "keadaan"; state: RefreshState }
  | { type: "lama"; state: RefreshState }
  | { type: "selesai"; state: RefreshState }
  | { type: "kosong" }
  | { type: "hilang"; last: RefreshState };

export type FollowEvent =
  | StateEvent
  | { type: "menyambung"; attempt: number; delayMs: number; reason: string }
  | { type: "berhenti"; reason: string };

export function followEvent(previous: RefreshState | null, incoming: RefreshState | null): StateEvent {
  if (!incoming) return previous && !previous.finishedAt ? { type: "hilang", last: previous } : { type: "kosong" };
  if (!incoming.finishedAt) return { type: "keadaan", state: incoming };
  return previous ? { type: "selesai", state: incoming } : { type: "lama", state: incoming };
}

const FATAL_STATUS = new Set([401, 403, 404, 501]);

export function followRefresh(
  url: string,
  onEvent: (event: FollowEvent) => void,
  options: { silenceMs?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): () => void {
  const silenceMs = options.silenceMs ?? PROGRESS_SILENCE_MS;
  let stopped = false;
  let last: RefreshState | null = null;
  let attempt = 0;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    controller?.abort();
  };

  const retry = (reason: string) => {
    if (stopped) return;
    attempt += 1;
    const delayMs = reconnectDelay(attempt, options.baseDelayMs, options.maxDelayMs);
    onEvent({ type: "menyambung", attempt, delayMs, reason });
    retryTimer = setTimeout(() => void connect(), delayMs);
  };

  async function connect() {
    retryTimer = null;
    if (stopped) return;
    const current = new AbortController();
    controller = current;
    let silent = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        silent = true;
        current.abort();
      }, silenceMs);
    };
    try {
      arm();
      const res = await fetch(url, { cache: "no-store", headers: { Accept: "text/event-stream" }, signal: current.signal });
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        if (FATAL_STATUS.has(res.status)) {
          stopped = true;
          onEvent({ type: "berhenti", reason: `server menjawab ${res.status}` });
          return;
        }
        throw new Error(`server menjawab ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        attempt = 0;
        const parsed = parseSse(buffer + value);
        buffer = parsed.rest;
        for (const data of parsed.events) {
          const event = followEvent(last, JSON.parse(data) as RefreshState | null);
          if (event.type === "keadaan") last = event.state;
          else stopped = true;
          onEvent(event);
          if (stopped) {
            current.abort();
            return;
          }
        }
      }
      retry("server menutup sambungan sebelum pembaruan selesai");
    } catch (error) {
      if (stopped) return;
      retry(silent ? "tidak ada kabar dari server" : error instanceof Error ? error.message : String(error));
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }

  void connect();
  return stop;
}

const VERDICTS: readonly StepVerdict[] = ["berhasil", "sebagian", "gagal", "dilewati"];

export function countVerdicts(steps: readonly { status: RefreshStepStatus }[]): Record<StepVerdict, number> {
  const counts: Record<StepVerdict, number> = { berhasil: 0, sebagian: 0, gagal: 0, dilewati: 0 };
  for (const step of steps) {
    if (step.status !== "menunggu" && step.status !== "berjalan") counts[step.status] += 1;
  }
  return counts;
}

export const describeCounts = (counts: Record<StepVerdict, number>) =>
  VERDICTS.map((v) => `${counts[v]} ${v}`).join(", ");

export function refreshHeadline(state: { finishedAt: string | null; steps: readonly { status: RefreshStepStatus }[] }): string {
  if (!state.finishedAt) return "Pembaruan sedang berjalan";
  const counts = countVerdicts(state.steps);
  if (counts.gagal) return `Pembaruan selesai, ${counts.gagal} langkah gagal`;
  if (counts.sebagian) return "Pembaruan selesai, sebagian data belum terbaca";
  return "Pembaruan selesai";
}

export const JOB_LABEL: Record<string, string> = {
  news: "Berita kawasan Anyer",
  rates: "Tarif kamar kompetitor",
  reviews: "Ulasan kompetitor",
  social: "Media sosial kompetitor",
  promos: "Status promo kompetitor",
  website: "Promo situs resmi kompetitor",
  ratings: "Rating 6 outlet Sanghyang",
  photos: "Foto & menu kompetitor",
  room_rates: "Tarif 14 malam & tipe kamar",
};

const SUBJECT = /^(?:Ulasan gagal untuk|Rating gagal untuk|Sosmed gagal untuk|Gemini gagal membaca postingan:|Perlu akses resmi Instagram: login wall untuk)\s*([\s\S]+?)(?::\s+([\s\S]+))?$/;

const SERVER_ENV_OR_CHROME_LOGIN_LEAK =
  /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|perlu login ulang di chrome|Instagram Graph API belum tersambung|belum dikonfigurasi,\s*isi\s+INSTAGRAM_|Sinkronisasi lokal memakai Ekstensi Chrome/i;

const CHROME_EXT_SOCIAL_NOTE = "sinkronisasi media sosial dijalankan lewat Ekstensi Chrome di peramban ini";

export interface ExtensionStepContext {
  extensionInstalled: boolean;
  savingBatch?: boolean;
  savedPostsTotal?: number;
  savedCommentsTotal?: number;
  state: {
    status: "idle" | "running" | "needs_human_action" | "completed" | "cancelled";
    runStartedAt: string | null;
    totalTargets: number;
    completedTargets: number;
    currentTargetName: string | null;
    currentTargetPlatform?: string | null;
    pausedReason?: string | null;
    pausedTargetName?: string | null;
    pendingCount: number;
    syncedPostsCount: number;
    syncedCommentsCount: number;
    finalizedOnServer?: boolean;
    errors: string[];
  } | null;
}

const fmtIdInt = (n: number) => Math.max(0, Math.round(n)).toLocaleString("id-ID");

function isExtRunCurrentOrNewer(extRunStartedAt: string | null | undefined, refreshStartedAt: string | null | undefined): boolean {
  if (!refreshStartedAt || !extRunStartedAt) return true;
  const extMs = Date.parse(extRunStartedAt);
  const refreshMs = Date.parse(refreshStartedAt);
  if (!Number.isFinite(extMs) || !Number.isFinite(refreshMs)) return true;
  // Toleransi 5 detik untuk selisih jam/urutan panggilan saat tombol Mulai memicu server & ekstensi bersamaan.
  return extMs >= refreshMs - 5_000;
}

/**
 * Membersihkan teks detail langkah server dari kebocoran nama variabel lingkungan server
 * atau pesan usang "Perlu login ulang di Chrome..." sebelum tampil di UI.
 */
export function sanitizeRefreshStepDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  if (!SERVER_ENV_OR_CHROME_LOGIN_LEAK.test(detail)) return detail;

  const tiktokMatch = detail.match(/TikTok:\s*[^.]+\.?/i)?.[0]?.trim() ?? null;
  const safeTiktok = tiktokMatch && !SERVER_ENV_OR_CHROME_LOGIN_LEAK.test(tiktokMatch) ? tiktokMatch : null;
  const mentionsInstagram = /instagram/i.test(detail);
  const baseNote = mentionsInstagram
    ? `Instagram: ${CHROME_EXT_SOCIAL_NOTE}.`
    : "Sinkronisasi media sosial dijalankan lewat Ekstensi Chrome di peramban ini.";

  return safeTiktok ? `${baseNote} ${safeTiktok}` : baseNote;
}

/**
 * Menyelaraskan daftar langkah progres pembaruan server dengan status nyata Ekstensi Chrome
 * untuk langkah `sosmed` sekaligus membersihkan kebocoran detail teknis server di semua langkah.
 */
export function resolveDisplayRefreshSteps(
  steps: readonly RefreshStep[],
  extSync?: ExtensionStepContext | null,
  refreshStartedAt?: string | null,
): RefreshStep[] {
  const extState = extSync?.state ?? null;

  return steps.map((step) => {
    if (step.key !== "sosmed") {
      return { ...step, detail: sanitizeRefreshStepDetail(step.detail) };
    }

    const serverSkippedOrLeaky =
      step.status === "dilewati" ||
      step.status === "menunggu" ||
      Boolean(step.detail && SERVER_ENV_OR_CHROME_LOGIN_LEAK.test(step.detail));

    if (extState?.status === "running" || extSync?.savingBatch) {
      const total = extState?.totalTargets ?? 0;
      const done = extState?.completedTargets ?? 0;
      const posts = Math.max(extSync?.savedPostsTotal ?? 0, extState?.syncedPostsCount ?? 0);
      const activeName = extState?.currentTargetName ? ` · aktif: ${extState.currentTargetName}` : "";
      const detail =
        total > 0
          ? `Sinkronisasi Ekstensi Chrome sedang berjalan (${fmtIdInt(done)}/${fmtIdInt(total)} akun · ${fmtIdInt(posts)} postingan diproses${activeName}).`
          : "Sinkronisasi Ekstensi Chrome sedang berjalan.";
      return { ...step, status: "berjalan", detail };
    }

    if (extState?.status === "needs_human_action") {
      const targetNote = extState.pausedTargetName ? ` di ${extState.pausedTargetName}` : "";
      return {
        ...step,
        status: "sebagian",
        detail: `Sinkronisasi Ekstensi Chrome terjeda${targetNote}. Selesaikan verifikasi pada panel Ekstensi Chrome di bawah lalu lanjutkan.`,
      };
    }

    if (extState?.status === "completed" && (serverSkippedOrLeaky || isExtRunCurrentOrNewer(extState.runStartedAt, refreshStartedAt))) {
      const total = extState.totalTargets;
      const done = extState.completedTargets;
      const posts = (extSync?.savedPostsTotal ?? 0) > 0 ? extSync!.savedPostsTotal! : extState.syncedPostsCount;
      const comments = (extSync?.savedCommentsTotal ?? 0) > 0 ? extSync!.savedCommentsTotal! : extState.syncedCommentsCount;
      const errCount = extState.errors.length;
      const countsText = `${fmtIdInt(posts)} postingan${comments > 0 ? `, ${fmtIdInt(comments)} komentar` : ""}`;

      if (extState.pendingCount > 0) {
        return {
          ...step,
          status: "sebagian",
          detail: `Ekstensi Chrome memproses ${fmtIdInt(done)}/${fmtIdInt(total)} akun (${countsText}); ${fmtIdInt(extState.pendingCount)} postingan masih di antrean pengiriman.`,
        };
      }
      if (total > 0 && done >= total) {
        return {
          ...step,
          status: "berhasil",
          detail: `Ekstensi Chrome menyinkronkan ${fmtIdInt(done)}/${fmtIdInt(total)} akun (${countsText})${errCount > 0 ? ` · ${fmtIdInt(errCount)} catatan parsial di panel bawah` : ""}.`,
        };
      }
      if (done > 0) {
        return {
          ...step,
          status: "sebagian",
          detail: `Ekstensi Chrome menyinkronkan ${fmtIdInt(done)} dari ${fmtIdInt(total)} akun (${countsText}).`,
        };
      }
      return {
        ...step,
        status: errCount > 0 ? "sebagian" : "berhasil",
        detail: `Ekstensi Chrome menyelesaikan pemeriksaan (${countsText}).`,
      };
    }

    if (extState?.status === "cancelled" && serverSkippedOrLeaky) {
      return {
        ...step,
        status: "dilewati",
        detail: "Sinkronisasi Ekstensi Chrome dihentikan sebelum selesai. Jalankan ulang lewat panel Ekstensi Chrome di bawah.",
      };
    }

    if (extSync?.extensionInstalled && serverSkippedOrLeaky) {
      return {
        ...step,
        status: "dilewati",
        detail: "Ekstensi Chrome terpasang. Jalankan sinkronisasi media sosial lewat panel Ekstensi Chrome di bawah.",
      };
    }

    return { ...step, detail: sanitizeRefreshStepDetail(step.detail) };
  });
}

const ISSUE_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/Timed out after waiting \d+ms|timeout/i, () => "halaman terlalu lama dimuat"],
  [/halaman hotel Google Travel tidak ditemukan/i, () => "halamannya belum ditemukan di Google Travel"],
  [/\b503\b|UNAVAILABLE|high demand|overloaded/i, () => "layanan pembaca otomatis sedang sibuk"],
  [/\b429\b|Terlalu Banyak Permintaan|rate limit/i, () => "sumber membatasi jumlah permintaan"],
  [/unexpected end of hex escape|surrogate/i, () => "teks berisi emoji terpotong saat disimpan"],
  [SERVER_ENV_OR_CHROME_LOGIN_LEAK, () => CHROME_EXT_SOCIAL_NOTE],
  [/^Dilewati:\s*([\s\S]+?)\.?$/, (m) => m[1].trim()],
  [/login wall|meminta login/i, () => "Instagram meminta login"],
  [/tidak ada postingan/i, () => "akun tidak menampilkan postingan yang bisa dibaca"],
  [/kontrol urutan "Terbaru" tidak ditemukan|0 kartu ulasan terbaca|tidak ada yang bisa diurai/i, () => "tata letak halaman ulasan berubah"],
  [/rating tidak terbaca/i, () => "rating tidak tampil di Google Maps"],
  [/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|net::ERR/i, () => "sumber tidak dapat dihubungi"],
  [/OCC conflict/i, () => "data sedang diubah proses lain"],
];

export function friendlyScrapeIssue(message: string): string {
  const subject = message.match(SUBJECT);
  const place = subject?.[1]?.trim() ?? null;
  const detail = subject?.[2] ?? message;
  const rule = ISSUE_RULES.find(([re]) => re.test(detail));
  const rawExplanation = rule
    ? rule[1](detail.match(rule[0])!)
    : `kendala teknis (${detail.replace(/\s+/g, " ").trim().slice(0, 120)})`;
  const explanation = SERVER_ENV_OR_CHROME_LOGIN_LEAK.test(rawExplanation)
    ? CHROME_EXT_SOCIAL_NOTE
    : rawExplanation;
  return place ? `${place}: ${explanation}` : explanation.charAt(0).toUpperCase() + explanation.slice(1);
}
