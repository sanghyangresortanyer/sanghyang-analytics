/**
 * Tanda baca khas tulisan mesin di teks yang tampil ke staf (aturan .agents/rules/human_output_style.md): em dash (—)
 * diganti koma, sedangkan en dash untuk rentang (24–115 m², Anyer–Carita, 09.00–22.00) tetap. Dipakai untuk keluaran AI
 * dan teks rekomendasi bertemplat sebelum tampil.
 */
export function humanizeDashes(text: string): string {
  // Teks tanpa em dash dikembalikan utuh: perapian koma di bawah hanya untuk sisa penggantian em dash.
  if (!text || !text.includes("—")) return text;
  return text
    .replace(/^[ \t]*—[ \t]*/gm, "")
    .replace(/[ \t]*—[ \t]*/g, ", ")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*([.;:!?)])/g, "$1")
    .replace(/,\s*$/gm, "");
}

/** humanizeDashes untuk setiap string di objek atau larik bersarang, misalnya draf konten dan analisis outlet tersimpan. */
export function humanizeDeep<T>(value: T): T {
  if (typeof value === "string") return humanizeDashes(value) as T;
  if (Array.isArray(value)) return value.map((v) => humanizeDeep(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, humanizeDeep(v)])) as T;
  return value;
}
