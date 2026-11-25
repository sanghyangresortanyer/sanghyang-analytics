// HTML → PDF lewat Chrome/Edge headless yang sudah terpasang (tanpa paket tambahan).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findBrowser(env: Record<string, string | undefined> = process.env, exists: (p: string) => boolean = existsSync): string | null {
  const own = env.CHROME_PATH?.trim();
  if (own) return exists(own) ? own : null;
  return CANDIDATES.find((p) => exists(p)) ?? null;
}

/** Prints htmlFile to pdfFile. A throwaway profile keeps the owner's open Chrome (and its logins) untouched. */
export function htmlToPdf(htmlFile: string, pdfFile: string, browser = findBrowser()): void {
  if (!browser) throw new Error("Chrome/Edge tidak ditemukan; isi CHROME_PATH di .env.local");
  const profile = mkdtempSync(join(tmpdir(), "report-pdf-"));
  try {
    const run = spawnSync(
      browser,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href],
      { timeout: 90_000, windowsHide: true },
    );
    if (run.error) throw run.error;
    if (!existsSync(pdfFile) || statSync(pdfFile).size === 0) throw new Error(`PDF tidak terbentuk (exit ${run.status}): ${String(run.stderr ?? "").slice(-200)}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
