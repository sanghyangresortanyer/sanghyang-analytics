import test from "node:test";
import assert from "node:assert/strict";
import { localLaunchOptions } from "../../src/lib/browser-launch";

test("Chrome lokal: sandbox tetap aktif kecuali PUPPETEER_NO_SANDBOX=1", () => {
  assert.deepEqual(localLaunchOptions({}).args, [], "bawaan: sandbox Chrome dipakai");
  assert.deepEqual(localLaunchOptions({ PUPPETEER_NO_SANDBOX: "0" }).args, []);
  assert.deepEqual(localLaunchOptions({ PUPPETEER_NO_SANDBOX: "1" }).args, ["--no-sandbox", "--disable-setuid-sandbox"]);
  assert.equal(localLaunchOptions({}).headless, true);
});
