/**
 * Mengikuti progres "Perbarui Semua Data" dari aliran SSE /api/admin/scraping/progress (dipakai di peramban, teruji di
 * Node). Dibaca dengan fetch, bukan EventSource, supaya status HTTP terlihat (401 berarti berhenti, bukan mencoba
 * terus) dan sambungan yang diam-diam putus dikenali dari hilangnya ping. Setelah tersambung lagi server langsung
 * mengirim keadaan terakhir, jadi langkah yang berubah selama terputus tidak terlewat.
 */
import type { RefreshState } from "./refresh-progress";

/** Selang komentar ping dari server, di bawah batas sambungan diam yang umum di proxy (30-60 detik). */
export const PROGRESS_PING_MS = 15_000;
/** Tanpa satu bait pun selama tiga selang ping (dua ping boleh terlambat), sambungan dianggap putus. */
export const PROGRESS_SILENCE_MS = PROGRESS_PING_MS * 3;
/** Jeda menyambung ulang mulai 1 detik, berlipat dua, paling lama 30 detik selama halaman terbuka. */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/** Kanal BroadcastChannel tempat halaman memberi tahu komponen dan tab lain bahwa pembaruan data berakhir. */
export const REFRESH_CHANNEL = "sanghyang-refresh";

/** Pesan di REFRESH_CHANNEL; startedAt menjadi kunci supaya satu pembaruan hanya memicu satu muat ulang. */
export interface RefreshEnded {
  type: "pembaruan-berakhir";
  startedAt: string;
  finishedAt: string | null;
  failed: boolean | null;
  /** true bila server tidak lagi menyimpan statusnya (misalnya dimulai ulang) sebelum pembaruan selesai. */
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

/** Memecah teks SSE menjadi isi `data` per peristiwa; komentar (ping) diabaikan dan potongan yang belum lengkap dikembalikan. */
export function parseSse(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: string[] = [];
  for (const block of blocks) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, ""));
    if (data.length) events.push(data.join("\n"));
  }
  return { events, rest };
}

export type StateEvent =
  | { type: "keadaan"; state: RefreshState }
  /** Pembaruan sudah selesai sebelum diikuti: ditampilkan, tetapi tidak memicu muat ulang data. */
  | { type: "lama"; state: RefreshState }
  | { type: "selesai"; state: RefreshState }
  | { type: "kosong" }
  | { type: "hilang"; last: RefreshState };

export type FollowEvent =
  | StateEvent
  | { type: "menyambung"; attempt: number; delayMs: number; reason: string }
  | { type: "berhenti"; reason: string };

/** Peristiwa untuk keadaan baru dari server, dibandingkan dengan pembaruan yang sedang diikuti. */
export function followEvent(previous: RefreshState | null, incoming: RefreshState | null): StateEvent {
  if (!incoming) return previous && !previous.finishedAt ? { type: "hilang", last: previous } : { type: "kosong" };
  if (!incoming.finishedAt) return { type: "keadaan", state: incoming };
  return previous ? { type: "selesai", state: incoming } : { type: "lama", state: incoming };
}

/** Status yang tidak pulih dengan menyambung ulang: belum masuk, ditolak, rute tidak ada, tidak tersedia di server ini. */
const FATAL_STATUS = new Set([401, 403, 404, 501]);

/**
 * Ikuti progres sampai pembaruan berakhir, server tidak punya pembaruan berjalan, atau server menolak. Kembalikan fungsi
 * berhenti. Sambungan yang putus atau diam disambung ulang dengan jeda berlipat; setiap upaya dilaporkan lewat onEvent.
 */
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
