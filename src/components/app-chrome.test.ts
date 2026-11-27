import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
// The rail only needs an anchor per item here; Next's router context does not exist outside the app.
vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode; className?: string; "aria-label"?: string; "aria-current"?: "page" }) =>
    createElement(
      "a",
      { href: props.href, className: props.className, "aria-label": props["aria-label"], "aria-current": props["aria-current"] },
      props.children,
    ),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/lib/actions/auth", () => ({ signOut: async () => {} }));

import { IconRail } from "./app-chrome";

function railLinks(props: { isAdmin: boolean; showKnowledgeGraph: boolean }) {
  const html = renderToStaticMarkup(createElement(IconRail, props));
  return [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => ({
    href: tag.match(/href="([^"]*)"/)?.[1],
    label: tag.match(/aria-label="([^"]*)"/)?.[1],
    current: /aria-current="page"/.test(tag),
  }));
}

describe("IconRail Knowledge Graph item", () => {
  beforeEach(() => {
    route.pathname = "/";
  });

  it("shows Knowledge Graph right under Pengaturan, with the same tooltip text, when the switch is on", () => {
    const links = railLinks({ isAdmin: true, showKnowledgeGraph: true });
    expect(links.map((l) => l.label)).toEqual([
      "Dashboard",
      "Upload Data",
      "Data Google Sheets",
      "Laporan Resort",
      "Marketing",
      "Pengaturan",
      "Knowledge Graph",
    ]);
    expect(links.at(-1)?.href).toBe("/knowledge-graph");
    const html = renderToStaticMarkup(createElement(IconRail, { isAdmin: true, showKnowledgeGraph: true }));
    expect(html).toMatch(/<span[^>]*md:group-hover:block[^>]*>Knowledge Graph<\/span>/);
  });

  it("leaves the item out when the switch is off", () => {
    const links = railLinks({ isAdmin: true, showKnowledgeGraph: false });
    expect(links.map((l) => l.href)).not.toContain("/knowledge-graph");
    expect(links.at(-1)?.label).toBe("Pengaturan");
  });

  it("marks Knowledge Graph as the open page on /knowledge-graph, like the other items", () => {
    route.pathname = "/knowledge-graph";
    const links = railLinks({ isAdmin: true, showKnowledgeGraph: true });
    expect(links.filter((l) => l.current).map((l) => l.label)).toEqual(["Knowledge Graph"]);
  });
});
