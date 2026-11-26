import type { NextConfig } from "next";

// Hanya aplikasi ini yang boleh membingkai halamannya (Marketing dan Laporan Resort memakai iframe), peramban tidak
// menebak jenis konten, dan situs lain tidak tahu dari halaman mana tautan dibuka. Diporting dari VRP (commit 4063646)
// saat audit 26 Nov 2026.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  headers: async () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },

  /**
   * Chromium & Puppeteer harus di-require langsung oleh Node, jangan dibundel.
   * `puppeteer` sengaja ikut disebut walau cuma devDependency agar bundler tidak
   * mencoba menariknya ke fungsi serverless Vercel.
   */
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "puppeteer"],

  /**
   * Sertakan aset biner Chromium, paket ekstensi Chrome, serta pengingat dan laporan
   * marketing di docs/marketing agar selalu ikut di bundle Vercel.
   */
  outputFileTracingIncludes: {
    "/api/market-intelligence/export-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/admin/social-extension/download": ["./extension/sanghyang-social-sync/**"],
    "/api/marketing-sosmed/browser-sync": ["./extension/sanghyang-social-sync/manifest.json"],
    "/marketing": ["./docs/marketing/**"],
    "/marketing/**": ["./docs/marketing/**"],
  },
};

export default nextConfig;
