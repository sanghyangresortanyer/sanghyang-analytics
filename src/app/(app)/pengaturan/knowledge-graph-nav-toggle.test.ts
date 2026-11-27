import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {} }) }));
vi.mock("@/lib/auth/role", () => ({ currentUser: async () => null }));

import { KnowledgeGraphNavToggle } from "./knowledge-graph-nav-toggle";

const render = (shown: boolean) => renderToStaticMarkup(createElement(KnowledgeGraphNavToggle, { shown }));
const switchTag = (html: string) => html.match(/<button\b[^>]*role="switch"[^>]*>/)?.[0] ?? "";

describe("KnowledgeGraphNavToggle", () => {
  it("is a keyboard button with the switch role, named by the visible label", () => {
    const html = render(false);
    const tag = switchTag(html);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('id="kg-nav-switch"');
    expect(html).toMatch(/<label for="kg-nav-switch">Tampilkan Knowledge Graph<\/label>/);
  });

  it("reports on and off to assistive tech and in words, not only by colour", () => {
    expect(switchTag(render(true))).toContain('aria-checked="true"');
    expect(render(true)).toContain("Nyala");
    expect(switchTag(render(false))).toContain('aria-checked="false"');
    expect(render(false)).toContain("Mati");
  });
});
