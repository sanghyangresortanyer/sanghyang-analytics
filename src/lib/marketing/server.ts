// Dashboard Sanghyang (lokal): /sanghyang, /sosmed, /laporan, dan gambar promosi di /sosmed/<folder>/<file>. Baca-saja.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { type PageSources, renderSanghyangPage, renderSosmedPage, sosmedImagePath } from "./overview.ts";

export type ServerActions = {
  pages: PageSources;
  /** Laporan mingguan Google Ads siap cetak (?since=YYYY-MM-DD&until=YYYY-MM-DD). */
  report: (range: { since?: string; until?: string }) => Promise<string>;
  /** Pengingat hari ini dari docs/reminders.json. */
  reminders: () => string[];
  sosmedRoot: string;
};

const PAGE_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'; form-action 'self'", "x-frame-options": "DENY" };

export function serveDashboard(port: number, actions: ServerActions, host = "127.0.0.1") {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const text = (status: number, body: string) => {
      if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(body);
    };
    if (req.method !== "GET") return text(405, "method not allowed");
    if (url.pathname === "/" || url.pathname === "/overview") {
      res.writeHead(302, { location: "/sanghyang" }).end();
      return;
    }
    if (url.pathname === "/sanghyang" || url.pathname === "/sosmed") {
      const refresh = url.searchParams.get("refresh") === "1";
      try {
        const html = url.pathname === "/sanghyang" ? renderSanghyangPage(await actions.pages.sanghyang(refresh), actions.reminders()) : renderSosmedPage(await actions.pages.sosmed(refresh));
        res.writeHead(200, PAGE_HEADERS).end(html);
      } catch (error) {
        text(500, `dashboard error: ${(error as Error).message}`);
      }
      return;
    }
    if (url.pathname === "/laporan") {
      const range = { since: url.searchParams.get("since") || undefined, until: url.searchParams.get("until") || undefined };
      try {
        // Build first: writing the 200 header before the await would make a failed build unanswerable (headers already sent).
        const html = await actions.report(range);
        res.writeHead(200, PAGE_HEADERS).end(html);
      } catch (error) {
        text(400, `Laporan tidak bisa dibuat: ${(error as Error).message}`);
      }
      return;
    }
    if (url.pathname.startsWith("/sosmed/")) {
      try {
        // decodeURIComponent throws on malformed escapes (e.g. %E0); an uncaught throw here would crash the server.
        const file = sosmedImagePath(actions.sosmedRoot, decodeURIComponent(url.pathname.slice("/sosmed/".length)));
        if (!file) return text(404, "not found");
        const type = /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";
        res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" }).end(readFileSync(file));
      } catch {
        text(404, "not found");
      }
      return;
    }
    text(404, "not found");
  });
  server.listen(port, host);
  return server;
}
