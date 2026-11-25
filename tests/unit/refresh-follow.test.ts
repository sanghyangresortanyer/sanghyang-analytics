import { after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { followEvent, followRefresh, parseSse, reconnectDelay, type FollowEvent } from "../../src/lib/market/refresh-follow";
import { progressStreamResponse } from "../../src/lib/market/refresh-stream";
import { beginRefresh, endRefresh, REFRESH_STEPS, updateStep, type RefreshState } from "../../src/lib/market/refresh-progress";

const servers: http.Server[] = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

async function serve(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/scraping/progress` };
}

/** Menjembatani node:http ke rute progres yang sebenarnya, sama dengan yang dilakukan server Next. */
const progressRoute = (pingMs: number): http.RequestListener => async (_req, res) => {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const response = progressStreamResponse(abort.signal, pingMs);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const reader = response.body!.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
};

/** Mengumpulkan peristiwa pengikut dan menunggu yang cocok; gagal dengan jelas bila tidak datang. */
function recorder() {
  const events: FollowEvent[] = [];
  const waiters: { match: (e: FollowEvent) => boolean; resolve: (e: FollowEvent) => void }[] = [];
  return {
    events,
    push(event: FollowEvent) {
      events.push(event);
      for (const w of waiters.splice(0)) {
        if (w.match(event)) w.resolve(event);
        else waiters.push(w);
      }
    },
    next(match: (e: FollowEvent) => boolean, label: string, timeoutMs = 3000): Promise<FollowEvent> {
      const seen = events.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`peristiwa "${label}" tidak datang; yang diterima: ${events.map((e) => e.type).join(", ")}`)), timeoutMs);
        waiters.push({ match, resolve: (e) => (clearTimeout(timer), resolve(e)) });
      });
    },
  };
}

test("SSE: komentar ping diabaikan, data multi-baris disatukan, sisa yang belum lengkap disimpan", () => {
  assert.deepEqual(parseSse('data: {"a":1}\n\n: ping 2026-11-15T21:00:00.000Z\n\ndata: nu'), { events: ['{"a":1}'], rest: "data: nu" });
  assert.deepEqual(parseSse("data: a\ndata: b\n\n"), { events: ["a\nb"], rest: "" });
  assert.deepEqual(parseSse("data: x\r\n\r\n"), { events: ["x"], rest: "" });
});

test("jeda menyambung ulang berlipat dua dan dibatasi", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => reconnectDelay(n)), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("peristiwa pengikut: kosong, hilang, lama, selesai, keadaan", () => {
  const running = { origin: "lokal", startedAt: "2026-11-15T14:00:00.000Z", finishedAt: null, failed: null, steps: [] } satisfies RefreshState;
  const finished = { ...running, finishedAt: "2026-11-15T14:40:00.000Z", failed: false };
  assert.equal(followEvent(null, null).type, "kosong");
  assert.equal(followEvent(running, null).type, "hilang", "server tidak lagi menyimpan pembaruan yang sedang diikuti");
  assert.equal(followEvent(null, finished).type, "lama", "pembaruan yang sudah selesai sebelum diikuti tidak memicu muat ulang");
  assert.equal(followEvent(running, finished).type, "selesai");
  assert.equal(followEvent(null, running).type, "keadaan");
});

test("rute progres tanpa pembaruan berjalan mengirim null lalu menutup aliran", async () => {
  const text = await new Response(progressStreamResponse(new AbortController().signal, 1000).body).text();
  assert.equal(text, "data: null\n\n");
});

test("rute progres mengirim keadaan, ping berkala, perubahan, lalu menutup setelah selesai", async () => {
  beginRefresh("lokal");
  const res = progressStreamResponse(new AbortController().signal, 30);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!/: ping/.test(text)) text += (await reader.read()).value ?? "";
  updateStep("berita", "berhasil", "Berita terbaru tersimpan.");
  endRefresh(false);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
  }
  const states = parseSse(text).events.map((data) => JSON.parse(data) as RefreshState);
  assert.equal(states[0].finishedAt, null);
  assert.equal(states.at(-1)?.steps.find((s) => s.key === "berita")?.status, "berhasil");
  assert.ok(states.at(-1)?.finishedAt, "aliran ditutup setelah keadaan akhir terkirim");
  assert.equal(states.at(-1)?.failed, true, "langkah yang belum selesai saat pembaruan ditutup dihitung gagal");
});

test("pengikut menyambung ulang setelah sambungan putus dan memuat keadaan terakhir", async () => {
  beginRefresh("lokal");
  const { server, url } = await serve(progressRoute(40));
  const rec = recorder();
  const stop = followRefresh(url, rec.push, { silenceMs: 400, baseDelayMs: 20, maxDelayMs: 100 });
  try {
    await rec.next((e) => e.type === "keadaan", "keadaan awal");
    server.closeAllConnections();
    updateStep("tarif", "sebagian", "14 tarif kamar tersimpan, 2 belum terbaca.");
    await rec.next((e) => e.type === "menyambung", "menyambung ulang");
    const after = await rec.next(
      (e) => e.type === "keadaan" && e.state.steps.find((s) => s.key === "tarif")?.status === "sebagian",
      "keadaan terbaru setelah tersambung lagi",
    );
    assert.equal(after.type, "keadaan");
    for (const step of REFRESH_STEPS) updateStep(step.key, "berhasil", "Selesai.");
    endRefresh(false);
    const done = await rec.next((e) => e.type === "selesai", "selesai");
    assert.equal(done.type === "selesai" && done.state.failed, false);
  } finally {
    stop();
  }
});

test("pengikut memutus sambungan yang diam tanpa ping lalu menyambung ulang", async () => {
  const { url } = await serve((_req, res) => res.writeHead(200, { "Content-Type": "text/event-stream" }));
  const rec = recorder();
  const stop = followRefresh(url, rec.push, { silenceMs: 150, baseDelayMs: 1000, maxDelayMs: 1000 });
  try {
    const event = await rec.next((e) => e.type === "menyambung", "menyambung setelah sunyi");
    assert.match(event.type === "menyambung" ? event.reason : "", /tidak ada kabar/);
  } finally {
    stop();
  }
});

test("pengikut berhenti tanpa mencoba lagi bila server menolak (belum masuk)", async () => {
  let hits = 0;
  const { url } = await serve((_req, res) => {
    hits++;
    res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"Belum masuk."}');
  });
  const rec = recorder();
  const stop = followRefresh(url, rec.push, { silenceMs: 400, baseDelayMs: 20, maxDelayMs: 20 });
  try {
    const event = await rec.next((e) => e.type === "berhenti", "berhenti");
    assert.match(event.type === "berhenti" ? event.reason : "", /401/);
    assert.equal(hits, 1, "status 401 tidak diulang");
    assert.ok(!rec.events.some((e) => e.type === "menyambung"), "tidak ada jadwal menyambung ulang");
  } finally {
    stop();
  }
});
