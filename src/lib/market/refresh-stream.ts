/**
 * Respons SSE progres "Perbarui Semua Data" dari komputer lokal (rute /api/admin/scraping/progress). Mengirim keadaan saat
 * tersambung lalu setiap perubahan langkah, ditambah komentar ping berkala supaya proxy tidak memutus sambungan yang diam
 * dan klien (refresh-follow.ts) bisa mengenali sambungan yang putus. Aliran ditutup setelah pembaruan selesai, bila tidak
 * ada pembaruan yang berjalan, atau saat peramban memutus sambungan.
 */
import { currentRefresh, subscribeRefresh, type RefreshState } from "./refresh-progress";
import { PROGRESS_PING_MS } from "./refresh-follow";

export function progressStreamResponse(signal: AbortSignal, pingMs = PROGRESS_PING_MS): Response {
  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        stop();
        controller.close();
      };
      const send = (state: RefreshState | null) => {
        write(`data: ${JSON.stringify(state)}\n\n`);
        if (!state || state.finishedAt) close();
      };
      const ping = setInterval(() => write(`: ping ${new Date().toISOString()}\n\n`), pingMs);
      const unsubscribe = subscribeRefresh(send);
      stop = () => {
        closed = true;
        clearInterval(ping);
        unsubscribe();
        signal.removeEventListener("abort", close);
      };
      if (signal.aborted) return close();
      signal.addEventListener("abort", close);
      send(currentRefresh());
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Proxy seperti nginx tidak menahan aliran di buffer.
      "X-Accel-Buffering": "no",
    },
  });
}
