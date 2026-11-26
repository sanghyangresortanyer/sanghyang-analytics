import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const users = vi.hoisted(() => ({ list: [] as string[], fail: false }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, replace: () => {} }) }));
vi.mock("@/lib/actions/auth", () => ({ signIn: async () => undefined }));
vi.mock("@/lib/auth/login-users", () => ({
  getLoginUsernames: async () => {
    if (users.fail) throw new Error("offline");
    return users.list;
  },
}));
// next/font is compiled by Next at build time; outside Next the loader module is empty.
vi.mock("./fonts", () => ({ loginFontVariables: "" }));

import LoginPage, { metadata } from "./page";

const TAGLINE = "A comprehensive analytics workspace for resort operations, marketing and market intelligence.";

async function renderLogin() {
  return renderToStaticMarkup(await LoginPage());
}

describe("halaman login Sanghyang Analytics", () => {
  beforeEach(() => {
    users.list = ["andi", "budi"];
    users.fail = false;
  });

  it("menampilkan nama aplikasi dan tagline baru, tanpa teks tampilan lama", async () => {
    const html = await renderLogin();

    expect(html).toContain(TAGLINE);
    expect(html).toContain("Sanghyang</span> <span");
    expect(html).toContain("Masuk");
    expect(html).not.toContain("Berita, kompetitor, harga");
    expect(html).not.toContain("Revenue, Pembelian, Inventory");
    expect(html).not.toContain("—");
  });

  it("memakai nama aplikasi dan tagline di metadata halaman", () => {
    expect(metadata.title).toBe("Sanghyang Analytics");
    expect(metadata.description).toBe(TAGLINE);
  });

  it("menawarkan dropdown nama pengguna saat daftar terbaca", async () => {
    const html = await renderLogin();

    expect(html).toMatch(/<select[^>]*id="username"/);
    expect(html).toContain('<option value="andi">andi</option>');
    expect(html).toContain('<option value="budi">budi</option>');
  });

  it("kembali ke kolom ketik username bila daftar gagal dimuat", async () => {
    users.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = await renderLogin();

    expect(html).not.toContain("<select");
    expect(html).toMatch(/<input[^>]*id="username"[^>]*type="text"/);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
