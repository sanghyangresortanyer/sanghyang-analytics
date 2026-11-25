import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const idx = hookRuntime.cursor++;
      if (!(idx in hookRuntime.slots)) {
        hookRuntime.slots[idx] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = hookRuntime.slots[idx] as T;
        hookRuntime.slots[idx] = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      };
      return [hookRuntime.slots[idx] as T, setState] as const;
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useRef: <T,>(initial: T) => {
      const idx = hookRuntime.cursor++;
      if (!(idx in hookRuntime.slots)) {
        hookRuntime.slots[idx] = { current: initial };
      }
      return hookRuntime.slots[idx] as { current: T };
    },
    useEffect: (effect: () => void | (() => void)) => {
      hookRuntime.effects.push(effect);
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { InstagramFeedView } from "./instagram-feed-view";
import { InsightPasarView } from "./insight-pasar-view";
import { StrategyView } from "./strategy-view";
import { MediaSosialView } from "./media-sosial-view";
import { SnLastUpdateDetails, SnUpdateAllButton } from "./sn-update-all";
import { SnWeeklyActions } from "./sn-market-steps";
import { sanitizeStrategyText, type SnOutletFinding } from "@/lib/marketing/market-intelligence-types";
import type { InstagramAccount, InstagramMediaItem } from "@/lib/marketing/meta-instagram";

function resetHooks() {
  hookRuntime.slots = [];
  hookRuntime.cursor = 0;
  hookRuntime.effects = [];
}

function renderWithHooks<P>(Component: (props: P) => ReactNode, props: P): ReactNode {
  hookRuntime.cursor = 0;
  hookRuntime.effects = [];
  return Component(props);
}

async function flushEffects() {
  const queued = hookRuntime.effects.splice(0);
  for (const fn of queued) fn();
  for (let i = 0; i < 4; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function findElements(
  node: ReactNode,
  predicate: (el: ReactElement<Record<string, unknown>>) => boolean,
  out: Array<ReactElement<Record<string, unknown>>> = [],
): Array<ReactElement<Record<string, unknown>>> {
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  if (predicate(el)) out.push(el);
  const children = el.props.children as ReactNode;
  if (Array.isArray(children)) {
    for (const child of children) findElements(child, predicate, out);
  } else if (children) {
    findElements(children, predicate, out);
  }
  return out;
}

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (!isValidElement(node)) return "";
  return collectText((node.props as { children?: ReactNode }).children);
}

describe("InstagramFeedView caption expand/collapse overrides", () => {
  const accounts: InstagramAccount[] = [{ id: "acc-1", username: "sanghyangresort", name: "Sanghyang Resort" }];
  const posts: InstagramMediaItem[] = [
    {
      id: "ig-1",
      outlet_username: "sanghyangresort",
      media_type: "IMAGE",
      permalink: "https://www.instagram.com/p/1/",
      media_url: "https://cdn.example.invalid/1.jpg",
      timestamp: "2026-11-20T10:00:00Z",
      caption:
        "Caption panjang pertama untuk menguji perilaku ringkas teks per kartu ketika tombol buka semua teks sedang aktif di halaman Instagram feed.",
      like_count: 10,
      comments_count: 1,
    },
    {
      id: "ig-2",
      outlet_username: "sanghyangresort",
      media_type: "IMAGE",
      permalink: "https://www.instagram.com/p/2/",
      media_url: "https://cdn.example.invalid/2.jpg",
      timestamp: "2026-11-19T10:00:00Z",
      caption:
        "Caption panjang kedua yang tetap harus terbuka penuh saat kartu pertama diringkas satu per satu oleh pengguna.",
      like_count: 20,
      comments_count: 2,
    },
  ];

  beforeEach(() => resetHooks());

  it("collapses an individual card caption when clicked while 'Buka semua teks' is active, and resets overrides on global toggle", () => {
    const props = { accounts, posts };
    let tree = renderWithHooks(InstagramFeedView, props);

    const findGlobalBtn = (root: ReactNode) =>
      findElements(root, (el) => el.type === "button" && /semua teks/i.test(collectText(el)))[0];
    const findCaptionP = (root: ReactNode, snippet: string) =>
      findElements(root, (el) => el.type === "p" && collectText(el).includes(snippet))[0];

    // Activate global "Buka semua teks"
    (findGlobalBtn(tree).props.onClick as () => void)();
    tree = renderWithHooks(InstagramFeedView, props);

    const p1Open = findCaptionP(tree, "Caption panjang pertama");
    const p2Open = findCaptionP(tree, "Caption panjang kedua");
    expect(String(p1Open.props.className)).not.toContain("line-clamp-3");
    expect(String(p2Open.props.className)).not.toContain("line-clamp-3");

    // Click card 1 caption to collapse ONLY card 1 while global mode stays active
    (p1Open.props.onClick as () => void)();
    tree = renderWithHooks(InstagramFeedView, props);

    const p1Collapsed = findCaptionP(tree, "Caption panjang pertama");
    const p2StillOpen = findCaptionP(tree, "Caption panjang kedua");
    expect(String(p1Collapsed.props.className)).toContain("line-clamp-3");
    expect(String(p2StillOpen.props.className)).not.toContain("line-clamp-3");

    // Clicking global "Ringkas semua teks" resets per-card overrides so every card collapses
    (findGlobalBtn(tree).props.onClick as () => void)();
    tree = renderWithHooks(InstagramFeedView, props);
    expect(String(findCaptionP(tree, "Caption panjang pertama").props.className)).toContain("line-clamp-3");
    expect(String(findCaptionP(tree, "Caption panjang kedua").props.className)).toContain("line-clamp-3");
  });
});

describe("Marketing clients HTTP 401 session-expired handling", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => resetHooks());

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  const mock401Json = () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "Sesi login telah berakhir. Silakan login ulang." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  };

  it("InsightPasarView shows session-expired message on 401 without blaming port 3002", async () => {
    mock401Json();
    const props = {
      startDate: "2026-11-01",
      endDate: "2026-11-25",
      isCustomRange: false,
      activeSubTab: "ringkasan" as const,
      initialOutlet: "resort",
    };
    renderWithHooks(InsightPasarView, props);
    await flushEffects();
    const tree = renderWithHooks(InsightPasarView, props);
    const text = collectText(tree);
    expect(text).toContain("Sesi login telah berakhir. Silakan login ulang.");
    expect(text).not.toContain("port 3002");
  });

  it("StrategyView shows session-expired message on 401 without blaming port 3002", async () => {
    mock401Json();
    const props = {
      startDate: "2026-11-01",
      endDate: "2026-11-25",
      isCustomRange: false,
      activeSubTab: "semua" as const,
      initialOutlet: "resort",
    };
    renderWithHooks(StrategyView, props);
    await flushEffects();
    const tree = renderWithHooks(StrategyView, props);
    const text = collectText(tree);
    expect(text).toContain("Sesi login telah berakhir. Silakan login ulang.");
    expect(text).not.toContain("port 3002");
  });

  it("MediaSosialView shows session-expired message on 401 without blaming port 3002", async () => {
    mock401Json();
    const props = {
      startDate: "2026-11-01",
      endDate: "2026-11-25",
      isCustomRange: false,
      activeOutlet: "resort" as const,
    };
    renderWithHooks(MediaSosialView, props);
    await flushEffects();
    const tree = renderWithHooks(MediaSosialView, props);
    const text = collectText(tree);
    expect(text).toContain("Sesi login telah berakhir. Silakan login ulang.");
    expect(text).not.toContain("port 3002");
  });

  it("SnUpdateAllButton and SnLastUpdateDetails show session-expired message on 401", async () => {
    mock401Json();
    const btnProps = { onFinished: vi.fn() };
    renderWithHooks(SnUpdateAllButton, btnProps);
    await flushEffects();
    const btnTree = renderWithHooks(SnUpdateAllButton, btnProps);
    const btnText = collectText(btnTree);
    expect(btnText).toContain("Sesi login telah berakhir. Silakan login ulang.");
    expect(btnText).not.toContain("status 401");

    resetHooks();
    let detailsTree = renderWithHooks(SnLastUpdateDetails, {});
    const toggleBtn = findElements(detailsTree, (el) => el.type === "button")[0];
    (toggleBtn.props.onClick as () => void)();
    renderWithHooks(SnLastUpdateDetails, {});
    await flushEffects();
    detailsTree = renderWithHooks(SnLastUpdateDetails, {});
    const detailsText = collectText(detailsTree);
    expect(detailsText).toContain("Sesi login telah berakhir. Silakan login ulang.");
    expect(detailsText).not.toContain("status 401");
  });

  it("InsightPasarView shows unified single-server error message on 503 failure without mentioning port 3002", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Layanan sementara tidak tersedia" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const props = {
      startDate: "2026-11-01",
      endDate: "2026-11-25",
      isCustomRange: false,
      activeSubTab: "ringkasan" as const,
      initialOutlet: "resort",
    };
    renderWithHooks(InsightPasarView, props);
    await flushEffects();
    const tree = renderWithHooks(InsightPasarView, props);
    const text = collectText(tree);
    expect(text).toContain("Data Insight Pasar tidak dapat dimuat");
    expect(text).not.toContain("port 3002");
    expect(text).not.toContain("SANGHYANG-NEWS");
  });
});

describe("Temuan audit pemasaran: sanitizeStrategyText dan SnWeeklyActions WhatsApp label", () => {
  const origNavigator = globalThis.navigator;
  const origWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    resetHooks();
    Object.defineProperty(globalThis, "window", {
      value: { setTimeout: vi.fn(() => 0) },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", { value: origNavigator, configurable: true });
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", { value: origWindow, configurable: true });
    }
  });

  it("removes obsolete 'halaman Untuk Direksi' references in sanitizeStrategyText", () => {
    const analysis = sanitizeStrategyText(
      "Harga item menu resmi Sunset Grill dibandingkan per item dengan item sebanding di menu kompetitor inti (bahan utama dan satuan harga sama) di Langkah 3 Insight Pasar dan halaman Untuk Direksi. Harga Sanghyang di tabel dari situs resmi.",
    );
    expect(analysis).not.toMatch(/Untuk Direksi/i);
    expect(analysis).toContain("di Langkah 3 Insight Pasar.");

    const rec = sanitizeStrategyText(
      "Tinjau item dengan selisih terbesar di halaman Untuk Direksi sebelum mengubah harga; harga bersih tetap tidak di bawah P25 kompetitor.",
    );
    expect(rec).not.toMatch(/Untuk Direksi/i);
    expect(rec).toContain("Insight Pasar");
  });

  it("uses official OUTLET_LABELS instead of outletKey.toUpperCase() in SnWeeklyActions copyToWhatsApp", () => {
    const written: string[] = [];
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          writeText: vi.fn(async (text: string) => {
            written.push(text);
          }),
        },
      },
      configurable: true,
    });

    const findings: SnOutletFinding[] = [
      {
        id: "f1",
        type: "price",
        title: "Tinjau harga paket makan malam",
        summary: "Selisih harga cukup jauh.",
        action: "improve",
        priority: "high",
        steps: ["Bandingkan porsi dengan menu kompetitor inti"],
        evidenceIds: [],
      },
    ];

    const cases: Array<[string, string, string]> = [
      ["sunset-grill", "*Outlet:* Sunset Grill", "SUNSET-GRILL"],
      ["dbistro", "*Outlet:* D'Bistro", "DBISTRO"],
      ["resort", "*Outlet:* Kamar & Resort", "RESORT"],
      ["all", "*Outlet:* Semua Outlet", "ALL"],
    ];

    for (const [outletKey, expectedLabel, forbiddenUpper] of cases) {
      resetHooks();
      written.length = 0;
      const tree = renderWithHooks(SnWeeklyActions, { findings, outletKey });
      const copyBtn = findElements(
        tree,
        (el) => el.type === "button" && collectText(el).includes("Salin ringkasan aksi (WhatsApp)"),
      )[0];
      expect(copyBtn, outletKey).toBeDefined();
      (copyBtn.props.onClick as () => void)();
      expect(written[0], outletKey).toContain(expectedLabel);
      expect(written[0], outletKey).not.toContain(`*Outlet:* ${forbiddenUpper}`);
    }
  });
});
