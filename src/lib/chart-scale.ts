/**
 * Round axis ticks from 0 up to just above `max`, on a 1/2/2.5/5 × 10ⁿ step
 * (e.g. 310 jt → 0, 100 jt … 400 jt), so gridlines land on readable values.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const steps = Math.ceil(max / step - 1e-9);
  return Array.from({ length: steps + 1 }, (_, i) => i * step);
}

