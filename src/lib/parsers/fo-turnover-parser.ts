import { parseVhpDate } from "@/lib/parsers/vhp-date";

interface FoTurnoverArticleRow {
  artNo: string;
  description: string;
  mtdGros: number;
}

interface FoTurnoverDepartmentRow {
  departmentCode: string;
  departmentName: string;
  mtdNett: number;
  mtdService: number;
  mtdTax: number;
  mtdGros: number;
  articles?: FoTurnoverArticleRow[];
}

export interface FoTurnoverParseResult {
  periodStart: string | null;
  periodEnd: string | null;
  departments: FoTurnoverDepartmentRow[];
  grandTotalMtdNett: number;
  grandTotalMtdGros: number;
  /**
   * Front Office room revenue (100 Lodging, Day-Gros) on the period's last day; null when the
   * report has no such line. 0 means VHP has not closed that day yet (owner, 2026-11-22).
   */
  lastDayLodging?: number | null;
  /** Reconciliation problems the user must see; totals are never patched over. */
  warnings: string[];
  fatal: boolean;
  error?: string;
}

const PERIOD_RE = /Period\s*:\s*(\d{2}\/\d{2}\/\d{2}(?:\d{2})?)\s*-\s*(\d{2}\/\d{2}\/\d{2}(?:\d{2})?)/i;
const DEPT_HEADER_RE = /^\s*(\d+)\s+-\s+(.+?)\s*$/;
const DEPT_TOTAL_RE = /^\s*T\s+O\s+T\s+A\s+L\s+(.+)$/;
const GRAND_TOTAL_RE = /^\s*GRAND\s+TOTAL\s+(.+)$/;
const ARTICLE_RE = /^\s*(\d+)\s+(.+?)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+/;

function parseTurnoverNumber(token: string): number {
  let cleaned = token.replace(/,/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1).trim();
  } else if (cleaned.endsWith("-")) {
    cleaned = "-" + cleaned.slice(0, -1).trim();
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function isFoTurnoverReport(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  return /F\/O\s+Turnover\s+Report\s+by\s+Department/i.test(text);
}

/**
 * Parses VHP "F/O Turnover Report by Department".
 * Extracts per-department MTD-Nett, Service, Tax, and MTD-Gros from each
 * department's `T O T A L` row, plus `GRAND TOTAL` for audit reconciliation.
 */
export function parseFoTurnoverReport(text: string | null | undefined): FoTurnoverParseResult {
  if (!text || typeof text !== "string" || !isFoTurnoverReport(text)) {
    return {
      periodStart: null,
      periodEnd: null,
      departments: [],
      grandTotalMtdNett: 0,
      grandTotalMtdGros: 0,
      warnings: [],
      fatal: true,
      error: "Bukan format F/O Turnover Report by Department.",
    };
  }

  const lines = text.split(/\r?\n/);
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let currentDept: { code: string; name: string } | null = null;
  let currentArticles: FoTurnoverArticleRow[] = [];

  const departments: FoTurnoverDepartmentRow[] = [];
  let grandTotalMtdNett = 0;
  let grandTotalMtdGros = 0;
  let grandTotalFound = false;
  let lastDayLodging: number | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const periodMatch = PERIOD_RE.exec(rawLine);
    if (periodMatch && !periodStart) {
      periodStart = parseVhpDate(periodMatch[1]);
      periodEnd = parseVhpDate(periodMatch[2]);
      continue;
    }

    const grandMatch = GRAND_TOTAL_RE.exec(rawLine);
    if (grandMatch) {
      const nums = grandMatch[1].trim().split(/\s+/).map(parseTurnoverNumber);
      if (nums.length >= 9) {
        grandTotalMtdNett = nums[5];
        grandTotalMtdGros = nums[8];
        grandTotalFound = true;
      }
      continue;
    }

    const totalMatch = DEPT_TOTAL_RE.exec(rawLine);
    if (totalMatch) {
      if (currentDept) {
        const nums = totalMatch[1].trim().split(/\s+/).map(parseTurnoverNumber);
        if (nums.length >= 9) {
          departments.push({
            departmentCode: currentDept.code,
            departmentName: currentDept.name,
            mtdNett: nums[5],
            mtdService: nums[6],
            mtdTax: nums[7],
            mtdGros: nums[8],
            articles: currentArticles.length > 0 ? [...currentArticles] : undefined,
          });
        }
      }
      currentDept = null;
      currentArticles = [];
      continue;
    }

    const deptMatch = DEPT_HEADER_RE.exec(rawLine);
    if (deptMatch && !rawLine.includes("Page") && !rawLine.includes("Period")) {
      const candidateName = deptMatch[2].trim();
      // An article line with dash (e.g. "10 - Food ...") has multiple numeric columns at the end;
      // real department headers do not have data columns.
      if (!/\s+[\d,.-]+\s+[\d,.-]+\s+[\d,.-]+/.test(candidateName)) {
        currentDept = {
          code: deptMatch[1].trim(),
          name: candidateName,
        };
        currentArticles = [];
        continue;
      }
    }

    if (currentDept) {
      const artMatch = ARTICLE_RE.exec(rawLine);
      if (artMatch) {
        const artNo = artMatch[1];
        const description = artMatch[2].trim();
        const mtdGros = parseTurnoverNumber(artMatch[11]);
        if (currentDept.code === "0" && artNo === "100") lastDayLodging = parseTurnoverNumber(artMatch[6]);
        if (mtdGros !== 0) {
          currentArticles.push({ artNo, description, mtdGros });
        }
      }
    }
  }

  const warnings: string[] = [];
  if (departments.length > 0) {
    const sumGros = departments.reduce((s, d) => s + d.mtdGros, 0);
    if (!grandTotalFound) {
      warnings.push(
        "Baris GRAND TOTAL tidak ditemukan di file F/O Turnover; file kemungkinan terpotong. Cocokkan total revenue dengan laporan VHP."
      );
    } else if (Math.abs(sumGros - grandTotalMtdGros) >= 1) {
      warnings.push(
        `Jumlah MTD-Gros per departemen (${sumGros.toLocaleString("id-ID")}) tidak sama dengan GRAND TOTAL (${grandTotalMtdGros.toLocaleString("id-ID")}).`
      );
    }
  }

  if (departments.length === 0) {
    return {
      periodStart,
      periodEnd,
      departments: [],
      grandTotalMtdNett: 0,
      grandTotalMtdGros: 0,
      warnings,
      fatal: true,
      error: "Tidak ada departemen dengan baris T O T A L yang valid pada file F/O Turnover.",
    };
  }

  return {
    periodStart,
    periodEnd,
    departments,
    grandTotalMtdNett,
    grandTotalMtdGros,
    lastDayLodging,
    warnings,
    fatal: false,
  };
}
