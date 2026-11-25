"use client";

import { useActionState } from "react";
import { saveRoomTypes } from "@/lib/actions/settings";
import { ROOM_TYPES, type RoomSetting } from "@/lib/dashboard/room-types";

/** Rooms grouped by their hundred (floor or block): 1xx, 2xx, 3xx, 5xx. */
const blockOf = (room: string) => (/^\d{3}$/.test(room) ? `${room[0]}xx` : "lainnya");

/** Pengaturan → Jenis kamar: the type of every room, used for revenue per room type on the dashboard. */
export function RoomTypeSettings({ rooms }: { rooms: RoomSetting[] }) {
  const [state, action, saving] = useActionState(saveRoomTypes, undefined);
  const formKey = rooms.map((r) => `${r.room}:${r.version}`).join("|");
  const blocks = [...new Set(rooms.map((r) => blockOf(r.room)))];
  const missing = rooms.filter((r) => !r.type).length;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">Jenis Kamar</h2>
      <p className="mt-1 text-base text-slate-600">
        Dipakai untuk revenue per jenis kamar di dasbor. Daftar kamar diambil dari F/O Journal VHP: {rooms.length} kamar
        {missing > 0 ? `, ${missing} belum diatur (kotak kuning).` : ", semua sudah diatur."} Lihat jenisnya di VHP: F/O Cashier → Accounting → Room Revenue Breakdown, kolom RmType.
      </p>
      {rooms.length === 0 ? (
        <p className="mt-3 text-base text-slate-500">Belum ada data kamar. Unggah F/O Journal dulu.</p>
      ) : (
        <form key={formKey} action={action} className="mt-4 space-y-4">
          {blocks.map((b) => (
            <fieldset key={b}>
              <legend className="text-base font-semibold text-slate-800">Kamar {b}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {rooms
                  .filter((r) => blockOf(r.room) === b)
                  .map((r) => (
                    <label key={r.room} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${r.type ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}>
                      <span className="w-10 text-base font-semibold tabular-nums text-slate-900">{r.room}</span>
                      <input type="hidden" name="room" value={r.room} />
                      <input type="hidden" name="version" value={r.version} />
                      <select name="type" defaultValue={r.type ?? ""} aria-label={`Jenis kamar ${r.room}`} className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1 text-sm">
                        <option value="">Belum diatur</option>
                        {ROOM_TYPES.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving} className="h-10 rounded-lg bg-navy-800 px-5 text-base font-semibold text-white hover:bg-navy-900 disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan Jenis Kamar"}
            </button>
            {state?.error && <p className="text-base font-medium text-red-700">{state.error}</p>}
            {state?.ok && <p className="text-base font-medium text-emerald-700">{state.ok}</p>}
          </div>
        </form>
      )}
    </section>
  );
}
