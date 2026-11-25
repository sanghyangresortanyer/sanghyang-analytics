import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
   * Sertakan aset biner Chromium, paket ekstensi Chrome, konfigurasi akun sosmed,
   * serta pengingat & gambar promosi marketing agar selalu ikut di bundle Vercel.
   */
  outputFileTracingIncludes: {
    "/api/market-intelligence/export-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/admin/social-extension/download": ["./extension/sanghyang-social-sync/**"],
    "/api/marketing-sosmed/browser-sync": ["./extension/sanghyang-social-sync/manifest.json"],
    "/marketing": ["./config/marketing/social-accounts.json", "./docs/marketing/**"],
    "/marketing/**": ["./config/marketing/social-accounts.json", "./docs/marketing/**"],
  },
};

export default nextConfig;
