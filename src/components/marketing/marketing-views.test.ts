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

// Tab Media Sosial memuat Audit Promo Outlet; aksi servernya tidak dijalankan di uji tampilan.
vi.mock("@/lib/actions/social-promo", () => ({
  pullPromos: vi.fn(async () => ({ ok: "ok" })),
  ignorePromoEvent: vi.fn(async () => ({ ok: "Diabaikan." })),
}));

import crawled from "@/lib/market/marketing-sosmed.data.json";
import { evaluateSocialPromoPost } from "@/lib/market/marketing-sosmed";
import { InsightPasarView } from "./insight-pasar-view";
import { StrategyView } from "./strategy-view";
import { MediaSosialView, PostThumbnail, SocialPostGridCard } from "./media-sosial-view";
import { SnLastUpdateDetails, SnUpdateAllButton } from "./sn-update-all";
import { SnWeeklyActions } from "./sn-market-steps";
import { sanitizeStrategyText, type SnOutletFinding, type SnSocialPost } from "@/lib/marketing/market-intelligence-types";

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

describe("Kartu grid Media Sosial: foto yang gagal dimuat dan caption 3 baris", () => {
  beforeEach(() => resetHooks());

  it("mengganti foto yang gagal dimuat dengan tempat foto yang rapi", () => {
    const props = { src: "https://scontent.cdninstagram.com/kedaluwarsa.jpg", alt: "Pratinjau Reels @sanghyangresort, tayang 8 Nov 2026" };
    let tree = renderWithHooks(PostThumbnail, props);
    const img = findElements(tree, (el) => el.type === "img")[0];
    expect(img.props.referrerPolicy).toBe("no-referrer");
    expect(img.props.alt).toBe(props.alt);
    (img.props.onError as () => void)();
    tree = renderWithHooks(PostThumbnail, props);
    expect(findElements(tree, (el) => el.type === "img")).toHaveLength(0);
    expect(collectText(tree)).toContain("Foto tidak bisa dimuat");
  });

  it("membuka dan meringkas caption panjang satu kartu lewat tombol yang bisa difokus", () => {
    // Caption asli @sanghyangresort 8 Nov 2026 (pembacaan 10 Nov), cukup panjang untuk dipotong 3 baris.
    const real = crawled.posts.find((p) => p.url.includes("/DfeUWFsv-pk/"))!;
    const input = {
      outletKey: "resort" as const,
      platform: "instagram" as const,
      postType: "reels" as const,
      postedAt: real.postedAt,
      postUrl: real.url,
      caption: real.caption,
      metrics: null,
    };
    const post: SnSocialPost = { ...input, id: real.url, account: "sanghyangresort", sources: ["archive"], audit: evaluateSocialPromoPost(input) };
    const props = { post, followers: null, archiveDate: "2026-11-10" };
    const captionP = (root: ReactNode) => findElements(root, (el) => el.type === "p" && collectText(el).includes("keseruan hari ini"))[0];
    const toggle = (root: ReactNode) => findElements(root, (el) => el.type === "button" && /selengkapnya|ringkas/i.test(collectText(el)))[0];

    let tree = renderWithHooks(SocialPostGridCard, props);
    expect(String(captionP(tree).props.className)).toContain("line-clamp-3");
    expect(toggle(tree).props["aria-expanded"]).toBe(false);
    (toggle(tree).props.onClick as () => void)();
    tree = renderWithHooks(SocialPostGridCard, props);
    expect(String(captionP(tree).props.className)).not.toContain("line-clamp-3");
    expect(collectText(toggle(tree))).toContain("Ringkas teks");
    expect(toggle(tree).props["aria-expanded"]).toBe(true);
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
      activeOutlet: "resort" as const,
      promoAudit: { audits: [], problem: null, dataUntil: null },
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
