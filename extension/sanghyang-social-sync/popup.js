/* global chrome */
"use strict";

const STATUS_LABELS = {
  idle: { text: "Siap", cls: "badge" },
  running: { text: "Berjalan", cls: "badge running" },
  needs_human_action: { text: "Butuh Aksi Anda", cls: "badge paused" },
  completed: { text: "Selesai", cls: "badge done" },
  cancelled: { text: "Dibatalkan", cls: "badge" },
};

function sendCmd(type) {
  return chrome.runtime.sendMessage({ type });
}

function render(state) {
  const badge = document.getElementById("status-badge");
  const meta = document.getElementById("status-meta");
  const pauseBox = document.getElementById("pause-box");
  const btnFocus = document.getElementById("btn-focus");
  const btnResume = document.getElementById("btn-resume");
  const btnCancel = document.getElementById("btn-cancel");

  const label = STATUS_LABELS[state?.status] || STATUS_LABELS.idle;
  badge.textContent = label.text;
  badge.className = label.cls;

  if (!state || state.status === "idle") {
    meta.textContent = "Buka dashboard Sanghyang Analytics lalu tekan Perbarui Semua Data atau Sinkron Sosmed.";
    pauseBox.classList.add("hidden");
    btnFocus.classList.add("hidden");
    btnResume.classList.add("hidden");
    btnCancel.classList.add("hidden");
    return;
  }

  meta.textContent = `Progres: ${state.completedTargets}/${state.totalTargets} akun · ${state.syncedPostsCount} postingan · ${state.syncedCommentsCount} komentar${state.currentTargetName ? ` (${state.currentTargetName})` : ""}`;

  if (state.status === "needs_human_action") {
    pauseBox.textContent = state.pausedReason || "Selesaikan login atau CAPTCHA pada tab Chrome yang terbuka.";
    pauseBox.classList.remove("hidden");
    btnFocus.classList.remove("hidden");
    btnResume.classList.remove("hidden");
    btnCancel.classList.remove("hidden");
  } else if (state.status === "running") {
    pauseBox.classList.add("hidden");
    btnFocus.classList.add("hidden");
    btnResume.classList.add("hidden");
    btnCancel.classList.remove("hidden");
  } else {
    pauseBox.classList.add("hidden");
    btnFocus.classList.add("hidden");
    btnResume.classList.add("hidden");
    btnCancel.classList.add("hidden");
  }
}

async function refresh() {
  const res = await sendCmd("GET_STATE");
  if (res?.ok) render(res.state);
}

document.getElementById("btn-focus").addEventListener("click", async () => {
  await sendCmd("FOCUS_PAUSED_TAB");
});

document.getElementById("btn-resume").addEventListener("click", async () => {
  const res = await sendCmd("RESUME_SYNC");
  if (res?.ok) render(res.state);
});

document.getElementById("btn-cancel").addEventListener("click", async () => {
  const res = await sendCmd("CANCEL_SYNC");
  if (res?.ok) render(res.state);
});

document.getElementById("btn-dashboard").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({
    url: ["http://localhost/*", "http://127.0.0.1/*", "https://analytics.sanghyang.com/*", "https://sanghyang-analytics.vercel.app/*"],
  });
  const existing = tabs.find(
    (t) =>
      typeof t.url === "string" &&
      (t.url.startsWith("http://localhost:3001") ||
        t.url.startsWith("http://127.0.0.1:3001") ||
        t.url.startsWith("https://analytics.sanghyang.com") ||
        t.url.startsWith("https://sanghyang-analytics.vercel.app"))
  );
  if (existing && typeof existing.id === "number") {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  const res = await sendCmd("GET_STATE");
  const origin = res?.state?.lastDashboardOrigin || "https://analytics.sanghyang.com";
  await chrome.tabs.create({ url: `${origin}/marketing?bagian=insight-pasar` });
});

refresh();
setInterval(refresh, 1500);
