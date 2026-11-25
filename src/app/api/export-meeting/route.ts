import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/role";
import { getWeeklyMeetingData } from "@/lib/actions/weekly-meeting";
import { buildWorkbook } from "@/lib/export/spreadsheet";

export async function GET(request: NextRequest) {
  const me = await currentUser();
  if (!me?.propertyId) {
    return NextResponse.json(
      { ok: false, error: "Sesi login telah berakhir. Silakan login ulang." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const meetingId = request.nextUrl.searchParams.get("meetingId") ?? undefined;
  const data = await getWeeklyMeetingData(meetingId);

  if (!data) {
    return NextResponse.json(
      { error: "Data meeting tidak ditemukan." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { meeting, outlets, suppliers, purchaseItems, inventoryItems } = data;

  const buffer = await buildWorkbook([
    {
      name: "Ringkasan Global",
      headers: ["Metrik", "Nilai"],
      rows: [
        ["Judul Meeting", meeting.title],
        ["Tanggal Meeting", meeting.meeting_date],
        ["Periode Mulai", meeting.period_start],
        ["Periode Selesai", meeting.period_end],
        ["Total Revenue (Rp)", meeting.total_revenue],
        ["Total Pembelian (Rp)", meeting.total_purchase],
        ["Total Inventory (Rp)", meeting.total_inventory],
        ["Rasio Pembelian / Revenue (%)", Number(meeting.purchase_to_revenue_pct.toFixed(2))],
        ["Rasio Inventory / Revenue (x)", Number(meeting.inventory_to_revenue_ratio.toFixed(2))],
      ],
    },
    {
      name: "Per Outlet",
      headers: ["Outlet", "Revenue (Rp)", "Qty Terjual", "Kontribusi (%)", "Inventory (Rp)"],
      rows: outlets.map((o) => [
        o.outlet_name,
        o.revenue_amount,
        o.revenue_qty,
        Number(o.revenue_share_pct.toFixed(2)),
        o.inventory_amount,
      ]),
    },
    {
      name: "Supplier Pembelian",
      headers: ["Supplier", "Total Pembelian (Rp)", "Jumlah Baris"],
      rows: suppliers.map((s) => [s.supplier_name, s.purchase_amount, s.line_count]),
    },
    {
      name: "Top Item Pembelian",
      headers: ["Kode", "Deskripsi", "Unit", "Total Qty", "Total Nilai (Rp)"],
      rows: purchaseItems.map((i) => [
        i.ingredient_code,
        i.description,
        i.unit,
        i.total_qty,
        i.total_amount,
      ]),
    },
    {
      name: "Detail Inventory",
      headers: ["Outlet", "Kode", "Nama Item", "Unit", "Qty", "Harga Satuan", "Total Nilai (Rp)"],
      rows: inventoryItems.map((inv) => [
        inv.outlet_name ?? "-",
        inv.item_code ?? "-",
        inv.item_name,
        inv.unit ?? "-",
        inv.qty,
        inv.unit_price,
        inv.total_value,
      ]),
    },
  ]);

  const filename = `meeting-${meeting.period_start}-sd-${meeting.period_end}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
