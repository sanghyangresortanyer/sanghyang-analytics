/**
 * Opsi peluncuran Chrome Puppeteer di luar Vercel (komputer staf dan mesin pengembang).
 *
 * Distro Linux yang membatasi user namespace lewat AppArmor (misalnya Ubuntu 23.10 ke atas) membuat sandbox Chrome
 * gagal dengan "No usable sandbox!", sehingga ekspor PDF jatuh ke HTTP 500. Sandbox hanya dimatikan bila mesin itu
 * menyetel PUPPETEER_NO_SANDBOX=1 secara eksplisit; komputer staf Windows tetap memakai sandbox bawaan.
 */
export function localLaunchOptions(env: Record<string, string | undefined> = process.env) {
  return {
    headless: true as const,
    args: env.PUPPETEER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  };
}
