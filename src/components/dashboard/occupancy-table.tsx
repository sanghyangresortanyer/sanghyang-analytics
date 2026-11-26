import { forecast, forecastMiss, type Night, occPct, occupancy, pairNights } from "@/lib/dashboard/occupancy";
import { formatRp } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

type Range = { start: string; end: string };
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const night = (iso: string) => `${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const pct = (v: number | null) => (v === null ? "–" : `${v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const tone = (d: number | null) => (!d ? "text-netral" : d > 0 ? "text-naik" : "text-turun");
const signed = (d: number | null, unit = "") => {
  if (d === null) return "–";
  const v = Math.round(d * 10) / 10;
  return v === 0 ? `0${unit}` : `${v > 0 ? "▲ +" : "▼ -"}${Math.abs(v).toLocaleString("id-ID")}${unit}`;
};

/** OCC per night next to the same dates of the month before (owner, 24 Nov 2026: 1 Okt beside 1 Nov). */
export function OccupancyTable({ nights, previous, range, previousRange }: { nights: Night[]; previous: Night[]; range: Range; previousRange: Range }) {
  const now = occupancy(nights);
  const then = occupancy(previous);
  if (!now) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  // Totals are compared only over the same number of nights.
  const base = then && then.nights === now.nights ? then : null;
  const arrDiff = base?.arr && now.arr !== null ? (now.arr / base.arr - 1) * 100 : null;
  const tiles = [
    { name: "OCC", value: pct(now.occ), diff: base ? now.occ - base.occ : null, unit: " poin" },
    { name: "Kamar terjual", value: now.rooms.toLocaleString("id-ID"), diff: base ? now.rooms - base.rooms : null, unit: " kamar" },
    { name: "ARR (harga rata-rata per kamar)", value: now.arr === null ? "–" : formatRp(now.arr), diff: arrDiff, unit: "%" },
  ];
  return (
    <div className="mt-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.name} className="skeuo-inset rounded-xl px-3 py-2">
            <p className="text-xl font-bold tabular-nums text-navy-900">{t.value}</p>
            <p className="text-sm text-navy-600">{t.name}</p>
            {t.diff !== null && <p className={cn("text-sm font-semibold tabular-nums", tone(t.diff))}>{signed(t.diff, t.unit)} dari pembanding</p>}
          </div>
        ))}
      </div>
      {then && !base && (
        <p className="mt-2 text-sm text-navy-600">
          Total tidak dibandingkan karena jumlah malamnya beda: {now.nights} malam, pembanding {then.nights} malam.
        </p>
      )}
      <div className="mt-4 max-h-[34rem] overflow-auto" tabIndex={0} role="region" aria-label="OCC per malam">
        <table className="w-full text-left sm:min-w-[42rem]">
          <thead className="text-sm text-navy-600">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">Pembanding</th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">Kamar</th>
              <th scope="col" className="py-2 pr-8 text-right font-semibold">OCC</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Periode ini</th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">Kamar</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">OCC</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Selisih kamar</th>
            </tr>
          </thead>
          <tbody className="text-sm tabular-nums sm:text-base text-navy-900">
            {pairNights(nights, previous, range, previousRange).map((r) => (
              <tr key={r.curr?.date ?? r.prev?.date} className="border-t border-cream-200">
                <td className="py-2 pr-3 text-navy-600">{r.prev ? night(r.prev.date) : "–"}</td>
                <td className="hidden py-2 pr-3 text-right text-navy-600 sm:table-cell">{r.prev?.rooms ?? "–"}</td>
                <td className="py-2 pr-8 text-right text-navy-600">{pct(r.prev && r.prev.rooms !== null ? occPct(r.prev.rooms, 1) : null)}</td>
                <td className="py-2 pr-3 font-semibold">{r.curr ? night(r.curr.date) : "–"}</td>
                <td className="hidden py-2 pr-3 text-right sm:table-cell">{r.curr ? (r.curr.rooms ?? "Belum ada data") : "–"}</td>
                <td className="py-2 pr-3 text-right font-semibold">{pct(r.curr && r.curr.rooms !== null ? occPct(r.curr.rooms, 1) : null)}</td>
                <td className={cn("py-2 pr-3 text-right font-semibold", tone(r.diff))}>{signed(r.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Estimated rooms for the coming nights, with how far off the same method was on the last 28 nights. */
export function OccupancyForecast({ recent }: { recent: Night[] }) {
  const nights = forecast(recent, 7);
  const miss = forecastMiss(recent);
  if (nights.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  return (
    <div className="mt-3">
      {miss && (
        <p className="text-sm text-navy-600">
          Cara ini dicoba pada {miss.nights} malam terakhir: rata-rata meleset {miss.rooms.toLocaleString("id-ID")} kamar per malam.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {nights.map((f) => (
          <div key={f.date} className="skeuo-inset rounded-xl px-3 py-2">
            <p className="text-sm font-semibold text-navy-700">{night(f.date)}</p>
            <p className="text-xl font-bold tabular-nums text-navy-900">{pct(f.occ)}</p>
            <p className="text-sm tabular-nums text-navy-600">sekitar {f.rooms} kamar</p>
          </div>
        ))}
      </div>
    </div>
  );
}
