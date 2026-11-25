import { describe, expect, it } from "vitest";
import { emailToUsername, isAppAccount, usernameToEmail } from "./username";

describe("usernameToEmail", () => {
  it("maps an account that predates the convention to its real address", () => {
    expect(usernameToEmail("demon")).toBe("demon@gmail.com");
  });

  it("falls back to the internal domain for everyone else", () => {
    expect(usernameToEmail("budi")).toBe("budi@sanghyang-analytics.local");
    expect(usernameToEmail("admin")).toBe("admin@sanghyang-analytics.local");
  });

  it("normalises what the user typed before looking it up", () => {
    // a phone keyboard capitalising the first letter must not break login
    expect(usernameToEmail("  Demon ")).toBe("demon@gmail.com");
    expect(usernameToEmail("BUDI")).toBe("budi@sanghyang-analytics.local");
  });

  it("does not let a typed email masquerade as a username", () => {
    expect(usernameToEmail("demon@gmail.com")).toBe("demon@gmail.com@sanghyang-analytics.local");
  });
});

describe("emailToUsername", () => {
  it("undoes the convention", () => {
    expect(emailToUsername("budi@sanghyang-analytics.local")).toBe("budi");
  });

  it("recovers a username that maps to a real address", () => {
    expect(emailToUsername("demon@gmail.com")).toBe("demon");
  });

  it("shows an unmapped outside address as-is rather than mangling it", () => {
    expect(emailToUsername("someone@example.com")).toBe("someone@example.com");
  });
});

describe("isAppAccount", () => {
  it("accepts convention-domain and mapped accounts, rejects other apps' users", () => {
    expect(isAppAccount("awi@sanghyang-analytics.local")).toBe(true);
    expect(isAppAccount("Demon@Gmail.com")).toBe(true);
    expect(isAppAccount("awi@vola.local")).toBe(false);
    expect(isAppAccount("someone@gmail.com")).toBe(false);
  });
});
