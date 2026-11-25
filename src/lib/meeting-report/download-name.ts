/**
 * Nama berkas unduhan laporan PDF. Pemilik meminta nama berkas sama dengan judul laporan
 * ("Laporan Insight Pasar: {nama outlet}"), jadi titik dua, spasi, dan apostrof tetap dipertahankan lewat
 * parameter `filename*` (RFC 6266/5987). Parameter `filename` biasa hanya cadangan ASCII untuk klien lama.
 */
import type { MeetingReport } from "./types";

export const reportPdfFileName = (report: Pick<MeetingReport, "title">): string => `${report.title}.pdf`;

/** encodeURIComponent membiarkan ' ( ) * dan !, padahal RFC 5987 hanya mengizinkan attr-char tanpa ' ( ) *. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Cadangan ASCII: diakritik dilepas, karakter di luar ASCII cetak serta tanda kutip dan garis miring terbalik menjadi "_". */
const asciiFallback = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\x20-\x7E]|["\\]/g, "_");

export const pdfContentDisposition = (fileName: string): string =>
  `attachment; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
