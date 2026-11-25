import { DailyBulkUpload } from "./daily-bulk";

export default function UploadMingguanPage() {
  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upload Data VHP</h1>
        <p className="mt-1 text-base text-slate-600">
          <strong>Seminggu sekali</strong> (misalnya Senin pagi): tarik dari tanggal 1 sampai kemarin, keempat laporan. Angkanya sementara.
          <br />
          <strong>Awal bulan (tanggal 1–5)</strong>: tarik bulan lalu lengkap (tanggal 1 sampai akhir bulan). Ini angka resmi dan otomatis
          menggantikan yang sementara, tanpa data dobel.
          <br />
          Pastikan tanggal terakhir sudah tutup hari di VHP: room revenue (Lodging) tidak boleh 0.
        </p>
      </div>
      <DailyBulkUpload />
    </div>
  );
}
