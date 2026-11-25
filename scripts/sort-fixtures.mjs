// Files VHP exports by report date, so fixtures/ holds one folder per day:
//   fixtures/2026-11-02/revenue 02-11-2026.txt
//   fixtures/2026-11-02/penjualan per artikel 02-11-2026.txt
// A report covering several days goes to fixtures/arsip/<start>_to_<end>/.
// The date and the kind come from inside the file ("Period :" line and report title).
// Sources: files dropped in fixtures/ or fixtures/incoming/ (moved), and VHP's own export
// C:/e1-vhp/Output File.txt (copied, because VHP overwrites it on every export).
// Usage: node scripts/sort-fixtures.mjs [--dry-run | --watch]
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "fixtures");
const DRY = process.argv.includes("--dry-run");
const VHP_EXPORT = "C:/e1-vhp/Output File.txt";

const KINDS = [
  { re: /F\/O\s+Turnover/i, kind: "revenue" },
  {
    re: /Rest\.\s+Transaction\s+Journal\s+by\s+BillNo/i,
    kind: "penjualan per bill",
  },
  { re: /Restaurant\s+Transaction\s+Journal/i, kind: "penjualan per artikel" },
  { re: /Receiving\s+List/i, kind: "pembelian" },
  { re: /F\/O\s+Journal\s+Transaction/i, kind: "jurnal fo" },
];
const PERIOD_RE =
  /Period\s*:\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/i;

const year = (y) => (y.length === 2 ? `20${y}` : y);

/** Where a report goes and what it is called, from its first page. */
function placeFor(head) {
  const kind = KINDS.find((k) => k.re.test(head))?.kind;
  const p = head.match(PERIOD_RE);
  if (!kind || !p) return null;
  const start = `${year(p[3])}-${p[2]}-${p[1]}`;
  const end = `${year(p[6])}-${p[5]}-${p[4]}`;
  // The Receiving List prints "Main Group: FOOD" on every page whatever groups it holds, so the
  // group is not part of the name.
  const label = kind;
  if (start === end)
    return {
      folder: start,
      name: `${label} ${p[1]}-${p[2]}-${year(p[3])}.txt`,
    };
  // A whole calendar month (history pulled per month) gets its own folder: fixtures/2026-01/.
  const lastDay = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0)).getUTCDate();
  if (start.endsWith("-01") && end === `${start.slice(0, 8)}${String(lastDay).padStart(2, "0")}`) {
    return { folder: start.slice(0, 7), name: `${label} ${start.slice(0, 7)}.txt` };
  }
  return { folder: join("arsip", `${start}_to_${end}`), name: `${label}.txt` };
}

/** Target path, or null when the same file is already there. A different file is never overwritten. */
function freeName(dir, name, source) {
  const target = join(dir, name);
  if (!existsSync(target)) return target;
  if (readFileSync(target).equals(readFileSync(source))) return null;
  const base = name.replace(/\.txt$/i, "");
  for (let i = 2; ; i++) {
    const next = join(dir, `${base} (${i}).txt`);
    if (!existsSync(next)) return next;
  }
}

/** Waits until VHP has finished writing: the size stays the same for 2 seconds. */
function waitUntilStable(file) {
  const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  let size = statSync(file).size;
  for (;;) {
    pause();
    const now = statSync(file).size;
    if (now === size) return;
    size = now;
  }
}

function runOnce({ quiet = false } = {}) {
  // A copy taken while VHP is still writing is cut short (2026-11-18: 0.8 of 2.6 MB).
  if (existsSync(VHP_EXPORT)) waitUntilStable(VHP_EXPORT);
  const sources = [];
  for (const dir of [ROOT, join(ROOT, "incoming")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir))
      sources.push({ source: join(dir, name), label: name, copy: false });
  }
  if (existsSync(VHP_EXPORT))
    sources.push({ source: VHP_EXPORT, label: VHP_EXPORT, copy: true });

  const moved = [];
  const skipped = [];
  for (const { source, label, copy } of sources) {
    if (!statSync(source).isFile() || !source.toLowerCase().endsWith(".txt"))
      continue;
    const place = placeFor(readFileSync(source, "latin1").slice(0, 4000));
    if (!place) {
      skipped.push(`${label}: jenis laporan atau tanggal tidak dikenali`);
      continue;
    }
    const dir = join(ROOT, place.folder);
    const target = freeName(dir, place.name, source);
    if (!target) {
      // A dropped copy that is byte-identical to the filed one is only clutter.
      if (!copy && !DRY) unlinkSync(source);
      if (!copy)
        skipped.push(
          `${label}: sudah ada di ${place.folder}/${place.name} (salinan dibuang)`,
        );
      continue;
    }
    if (!DRY) {
      mkdirSync(dir, { recursive: true });
      if (copy) copyFileSync(source, target);
      else renameSync(source, target);
    }
    moved.push(`${label} -> ${place.folder}/${target.slice(dir.length + 1)}`);
  }

  const stamp = new Date().toLocaleTimeString("id-ID");
  if (quiet && !moved.length && !skipped.length) return;
  console.log(DRY ? "Rencana (belum dipindah):" : `[${stamp}] Dipindah:`);
  for (const m of moved) console.log(`  ${m}`);
  if (!moved.length) console.log("  (tidak ada)");
  if (skipped.length) {
    console.log("Dilewati:");
    for (const s of skipped) console.log(`  ${s}`);
  }
}

runOnce();

// --watch: keep filing every new VHP export, so exporting day after day needs no copying.
// A file is filed once its size has stopped changing between two checks (VHP finished writing).
if (process.argv.includes("--watch") && !DRY) {
  console.log(
    `Memantau ${VHP_EXPORT} dan fixtures/ ... (Ctrl+C untuk berhenti)`,
  );
  let last = "";
  let pending = "";
  setInterval(() => {
    const sig = [
      VHP_EXPORT,
      ...readdirSync(ROOT)
        .filter((n) => n.toLowerCase().endsWith(".txt"))
        .map((n) => join(ROOT, n)),
    ]
      .filter((f) => existsSync(f))
      .map((f) => `${f}:${statSync(f).size}:${statSync(f).mtimeMs}`)
      .join("|");
    if (sig === last) return;
    if (sig !== pending) {
      pending = sig; // changed since the previous check: wait one more round
      return;
    }
    last = sig;
    runOnce({ quiet: true });
  }, 2000);
}
