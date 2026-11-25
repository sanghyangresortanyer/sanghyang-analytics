import { describe, expect, it } from "vitest";
import { googleCredentials } from "./config.ts";

describe("googleCredentials", () => {
  it("reads the OAuth client from GOOGLE_OAUTH_CLIENT_JSON", () => {
    expect(googleCredentials({ GOOGLE_OAUTH_CLIENT_JSON: '{"client_id":"a","client_secret":"b"}' })).toEqual({ client_id: "a", client_secret: "b" });
  });

  it("does not echo a broken secret in its error", () => {
    const secret = "GOCSPX-this-must-never-be-shown";
    let message = "";
    try {
      googleCredentials({ GOOGLE_OAUTH_CLIENT_JSON: `{"client_secret": ${secret}` });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("GOOGLE_OAUTH_CLIENT_JSON is not valid JSON");
    expect(message).not.toContain("GOCSPX");
  });

  it("names a missing key file without reading anything", () => {
    expect(() => googleCredentials({ GA4_CREDENTIALS_FILE: "D:/nope/missing.json" })).toThrow("GA4_CREDENTIALS_FILE not found on this computer");
  });
});
