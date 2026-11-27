import { OUTLET_KEYS, type OutletKey } from "@/lib/marketing/market-intelligence-types";

export type AppRoute = { href: string; label: string };

const isOutlet = (value: string | null): value is OutletKey => value !== null && (OUTLET_KEYS as readonly string[]).includes(value);

function insightPasar(view: "harga" | "kompetitor" | null, outlet: string | null): AppRoute {
  const params = new URLSearchParams({ bagian: "insight-pasar" });
  if (view) params.set("lihat", view);
  if (isOutlet(outlet)) params.set("outlet", outlet);
  const label = view === "harga" ? "Insight Pasar · Harga" : view === "kompetitor" ? "Insight Pasar · Kompetitor" : "Insight Pasar";
  return { href: `/marketing?${params.toString()}`, label };
}

const CURRENT_LABEL: Record<string, string> = {
  "insight-pasar": "Insight Pasar",
  "media-sosial": "Media Sosial",
  strategy: "Strategy",
  google: "Google Ads",
  meta: "Meta Ads",
};

/**
 * Page in this app for a link in the graph data. The graph API still names the pages of the app before ADR-014
 * (/dashboard, /direksi, /market-intelligence, /marketing-sosmed, /galeri-kompetitor), which no longer exist: their
 * content now sits in Marketing, and "halaman Untuk Direksi" became Insight Pasar · Harga (see sanitizeStrategyText).
 */
export function appRoute(href: string): AppRoute {
  const url = new URL(href, "http://app.invalid");
  const outlet = url.searchParams.get("outlet");
  switch (url.pathname) {
    case "/market-intelligence":
    case "/dashboard":
      return insightPasar(null, outlet);
    case "/direksi":
      return insightPasar("harga", outlet);
    case "/galeri-kompetitor":
      return insightPasar("kompetitor", outlet);
    case "/marketing-sosmed":
      return { href: isOutlet(outlet) ? `/marketing?bagian=media-sosial&lihat=${outlet}` : "/marketing?bagian=media-sosial", label: "Media Sosial" };
    case "/":
      return { href, label: "Dashboard" };
    case "/pengaturan":
      return { href, label: "Pengaturan" };
    case "/marketing": {
      const section = url.searchParams.get("bagian");
      return { href, label: (section && CURRENT_LABEL[section]) || "Marketing" };
    }
    default:
      return { href, label: "Halaman terkait" };
  }
}
