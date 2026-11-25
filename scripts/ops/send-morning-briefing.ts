import { db } from "@/lib/db";
import {
  compileMorningBriefingStats,
  formatMorningBriefingMessage,
  sendMorningAlert,
} from "@/lib/market/morning-briefing";

async function main() {
  console.log("===============================================================");
  console.log("  SANGHYANG INTELLIGENCE: MORNING BRIEFING & ALERTING ENGINE");
  console.log("===============================================================");

  const stats = await compileMorningBriefingStats();
  const message = formatMorningBriefingMessage(stats);

  console.log("\n--- PRATINJAU NASKAH BRIEFING PAGI ---\n");
  console.log(message);
  console.log("\n---------------------------------------\n");

  const result = await sendMorningAlert(message);
  console.log("Status Pengiriman:", result.delivered ? "Terkirim ✅" : "Mode Simulasi / Siap Broadcast ℹ️");
  if (result.channels.length > 0) {
    console.log("Kanal Aktif:", result.channels.join(", "));
  } else {
    console.log("Catatan: Untuk mengaktifkan bot Telegram otomatis, isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di environment.");
  }

  // Di GitHub Actions briefing wajib terkirim; pratinjau tanpa kanal hanya untuk lokal.
  const channelConfigured = Boolean((process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.ALERT_WEBHOOK_URL);
  if (!result.delivered && (process.env.GITHUB_ACTIONS === "true" || channelConfigured)) {
    throw new Error(
      channelConfigured
        ? "Kanal briefing terkonfigurasi tetapi pengiriman gagal (lihat log di atas)."
        : "Briefing tidak terkirim: secret TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID atau ALERT_WEBHOOK_URL belum diisi di GitHub.",
    );
  }
}

main()
  .catch((err) => {
    console.error("Gagal menjalankan briefing pagi:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

