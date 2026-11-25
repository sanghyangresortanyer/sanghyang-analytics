import { describe, expect, it } from "vitest";
import { parseChatCount } from "./chat-counts";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const range = { chat_from: "2026-11-16", chat_to: "2026-11-22" };

describe("parseChatCount (owner 24 Nov: CS picks the dates, closing required, closing only)", () => {
  const today = "2026-11-24";
  it("accepts any finished range; only closing is kept", () => {
    expect(parseChatCount(form({ ...range, closing: "4", total: "30" }), today)).toEqual({ ok: { from: "2026-11-16", to: "2026-11-22", closing: 4, total: null } });
    expect(parseChatCount(form({ chat_from: "2026-11-01", chat_to: "2026-11-23", closing: "0", total: "" }), today)).toEqual({ ok: { from: "2026-11-01", to: "2026-11-23", closing: 0, total: null } });
  });
  it("refuses unclear input with a plain message", () => {
    expect(parseChatCount(form({ chat_from: "2026-11-21", chat_to: "2026-11-15", closing: "3" }), today)).toEqual({ error: "Tanggal 'Dari' harus sebelum atau sama dengan 'Sampai'." });
    expect(parseChatCount(form({ chat_from: "2026-11-21", chat_to: "2026-11-24", closing: "3" }), today)).toEqual({ error: "Hari ini belum selesai: isi paling lambat sampai kemarin." });
    expect(parseChatCount(form({ ...range, closing: "" }), today)).toEqual({ error: "Jumlah chat closing harus angka 0 atau lebih." });
    expect(parseChatCount(form({ ...range, closing: "-1" }), today)).toEqual({ error: "Jumlah chat closing harus angka 0 atau lebih." });
    expect(parseChatCount(form({ chat_from: "", chat_to: "2026-11-21", closing: "3" }), today)).toEqual({ error: "Isi tanggal Dari dan Sampai." });
  });
});
