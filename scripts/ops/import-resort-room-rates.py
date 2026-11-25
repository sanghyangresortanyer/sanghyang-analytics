"""Convert the room-rate analysis workbook into src/lib/market/resort-room-rates.data.json.

Usage (workbook disimpan di luar repo, lihat .gitignore):
    python scripts/ops/import-resort-room-rates.py path/to/Perbandingan_Berdampingan_Sanghyang_vs_Kompetitor_Terbaru.xlsx

Workbook layout (versi 05 Nov 2026):
  - "Tarif Pasar Publik (Live)": satu baris per (hotel kompetitor, jenis kamar). Kolom T = hotel_id,
    U = kind (lowest | standard | suite | villa). Harga = penawaran OTA di Google Travel.
  - "Tarif Harga Bottom": harga OTA terendah per hotel (termasuk Sanghyang), hari biasa & akhir pekan.
"Tidak tampil di bukti" disimpan sebagai null (tidak diisi tebakan). Script gagal bila format berubah.
Re-run whenever the analysis workbook is updated, then commit the regenerated JSON.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "lib" / "market" / "resort-room-rates.data.json"
RATES_SHEET = "Tarif Pasar Publik (Live)"
LOWEST_SHEET = "Tarif Harga Bottom"
EVIDENCE_SHEET = "Bukti Detail Tipe Kamar"
NOT_SHOWN = "Tidak tampil di bukti"
KINDS = {"lowest", "standard", "suite", "villa"}
CLASS_TO_KIND = {
    "Kamar Standar": "standard",
    "Suite": "suite",
    "Villa / Unit Multi-Kamar (Condo, Cottage, Bedroom)": "villa",
}
SANGHYANG_ID = "sanghyang"


def price(value, where: str):
    """Rupiah integer, or None when the workbook says the price did not appear in the evidence."""
    if value is None or value == NOT_SHOWN:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    raise ValueError(f"{where}: nilai harga tidak dikenal {value!r}")


def header_index(ws, row: int) -> dict:
    return {str(c.value).strip(): c.column for c in ws[row] if c.value is not None}


def period_dates(text: str) -> tuple[str, str]:
    weekday = re.search(r"Hari Biasa[^(]*\([^)]*\)\s*\((\d{4}-\d{2}-\d{2})", text)
    weekend = re.search(r"Akhir Pekan[^(]*\([^)]*\)\s*\((\d{4}-\d{2}-\d{2})", text)
    if not weekday or not weekend:
        raise ValueError(f"Tanggal hari biasa/akhir pekan tidak ditemukan: {text!r}")
    return weekday.group(1), weekend.group(1)


def hotel_name_and_star(cell: str) -> tuple[str, int]:
    m = re.match(r"^(.*?)\s*\(Bintang (\d)\)$", cell.strip())
    if not m:
        raise ValueError(f"Nama hotel tanpa '(Bintang N)': {cell!r}")
    return m.group(1).strip(), int(m.group(2))


def parse_rates(ws):
    cols = header_index(ws, 6)
    meta = header_index(ws, 5)
    col_t, col_u = meta["hotel_id"], meta["kind"]
    rates = []
    for r in range(7, ws.max_row + 1):
        kind = ws.cell(r, col_u).value
        if kind is None:
            continue  # baris judul klaster / kosong
        if kind not in KINDS:
            raise ValueError(f"Baris {r}: kind tidak dikenal {kind!r}")
        name, star = hotel_name_and_star(str(ws.cell(r, cols["Nama Hotel & Kelas Bintang"]).value))
        at = lambda c: f"{RATES_SHEET}!{ws.cell(r, c).coordinate}"
        # Kolom harga: F/G hari biasa, I/J akhir pekan (header "Harga Sanghyang"/"Harga Kompetitor" muncul 2x).
        f, g, i, j = 6, 7, 9, 10
        rates.append({
            "hotelId": ws.cell(r, col_t).value,
            "competitorName": name,
            "starRating": star,
            "cluster": "KLASTER_II_BINTANG_5" if star == 5 else "KLASTER_I_BINTANG_4",
            "kind": kind,
            "offer": str(ws.cell(r, 5).value).strip(),
            "sanghyangRoom": str(ws.cell(r, cols["Tipe Kamar Sanghyang (Bintang 4)"]).value).strip(),
            "competitorRoom": str(ws.cell(r, cols["Tipe Kamar Kompetitor"]).value).strip(),
            "weekday": {"sanghyang": price(ws.cell(r, f).value, at(f)), "competitor": price(ws.cell(r, g).value, at(g))},
            "weekend": {"sanghyang": price(ws.cell(r, i).value, at(i)), "competitor": price(ws.cell(r, j).value, at(j))},
            "note": str(ws.cell(r, cols.get("Keterangan Posisi Pasar", 12)).value or "").strip(),
        })
    if not rates:
        raise ValueError(f"Sheet {RATES_SHEET} tidak berisi baris tarif")
    # Harga Sanghyang untuk satu jenis kamar harus sama di semua baris (pembanding berbeda, kamar kita sama).
    for kind in KINDS:
        for day in ("weekday", "weekend"):
            values = {row[day]["sanghyang"] for row in rates if row["kind"] == kind}
            if len(values) > 1:
                raise ValueError(f"Harga Sanghyang {kind}/{day} tidak konsisten antar baris: {sorted(map(str, values))}")
    return rates


def parse_lowest(ws):
    cols = header_index(ws, 5)
    weekday_col = next(c for h, c in cols.items() if h.startswith("Terendah Hari Biasa"))
    weekend_col = next(c for h, c in cols.items() if h.startswith("Terendah Akhir Pekan"))
    rows = []
    for r in range(6, ws.max_row + 1):
        hotel_id = ws.cell(r, cols["hotel_id"]).value
        if hotel_id is None:
            continue
        at = lambda c: f"{LOWEST_SHEET}!{ws.cell(r, c).coordinate}"
        rows.append({
            "hotelId": hotel_id,
            "hotel": str(ws.cell(r, cols["Hotel"]).value).strip(),
            "starRating": int(ws.cell(r, cols["Bintang"]).value),
            "weekday": {"price": price(ws.cell(r, weekday_col).value, at(weekday_col)), "source": ws.cell(r, weekday_col + 1).value},
            "weekend": {"price": price(ws.cell(r, weekend_col).value, at(weekend_col)), "source": ws.cell(r, weekend_col + 1).value},
        })
    if not any(row["hotelId"] == SANGHYANG_ID for row in rows):
        raise ValueError(f"Sheet {LOWEST_SHEET} tidak memuat baris Sanghyang")
    return rows


def parse_evidence(ws):
    """Satu baris per (hotel, periode, provider, tipe kamar, harga) yang tampil di tangkapan layar."""
    cols = header_index(ws, 4)
    rows = []
    for r in range(5, ws.max_row + 1):
        hotel_id = ws.cell(r, cols["hotel_id"]).value
        if hotel_id is None:
            continue
        room_class = str(ws.cell(r, cols["Kelas"]).value).strip()
        if room_class not in CLASS_TO_KIND:
            raise ValueError(f"{EVIDENCE_SHEET}!{ws.cell(r, cols['Kelas']).coordinate}: kelas kamar tidak dikenal {room_class!r}")
        stay = ws.cell(r, cols["stay"]).value
        if stay not in ("weekday", "weekend"):
            raise ValueError(f"{EVIDENCE_SHEET} baris {r}: stay tidak dikenal {stay!r}")
        value = price(ws.cell(r, cols["Harga / Malam"]).value, f"{EVIDENCE_SHEET} baris {r}")
        if value is None:
            raise ValueError(f"{EVIDENCE_SHEET} baris {r}: baris bukti tanpa harga")
        rows.append({
            "hotelId": hotel_id,
            "stay": stay,
            "provider": str(ws.cell(r, cols["Provider"]).value).strip(),
            "roomType": str(ws.cell(r, cols["Tipe Kamar"]).value).strip(),
            "kind": CLASS_TO_KIND[room_class],
            "price": value,
        })
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit("Pemakaian: python scripts/ops/import-resort-room-rates.py <path workbook .xlsx> (workbook disimpan di luar repo)")
    xlsx = Path(sys.argv[1])
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    rates_ws = wb[RATES_SHEET]
    weekday, weekend = period_dates(str(rates_ws["A2"].value))
    note = str(rates_ws["A3"].value or "")
    captured = re.search(r"ditangkap (.+? WIB)", note)
    rates = parse_rates(rates_ws)
    lowest = parse_lowest(wb[LOWEST_SHEET])
    evidence = parse_evidence(wb[EVIDENCE_SHEET])

    sanghyang_lowest = next(r for r in lowest if r["hotelId"] == SANGHYANG_ID)
    lowest_rows = [r for r in rates if r["kind"] == "lowest"]
    for day in ("weekday", "weekend"):
        if lowest_rows and lowest_rows[0][day]["sanghyang"] != sanghyang_lowest[day]["price"]:
            raise ValueError(f"Harga terendah Sanghyang ({day}) berbeda antara sheet {RATES_SHEET} dan {LOWEST_SHEET}")

    payload = {
        "source": xlsx.name,
        "sourceMethod": "Penawaran OTA di Google Travel (tab Prices), harga per malam termasuk pajak & biaya",
        "capturedAt": captured.group(1) if captured else None,
        "checkInWeekday": weekday,
        "checkInWeekend": weekend,
        "rates": rates,
        "lowestByHotel": lowest,
        "evidence": evidence,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(rates)} baris tarif + {len(lowest)} harga terendah + {len(evidence)} bukti -> {OUT.relative_to(ROOT)} (weekday {weekday}, weekend {weekend})")


if __name__ == "__main__":
    main()
