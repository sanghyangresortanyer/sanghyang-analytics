import { describe, expect, it } from "vitest";
import { vhpPrintedAt } from "./vhp-date";

describe("vhpPrintedAt", () => {
  it("reads the print time from the report header as WIB", () => {
    const head = "Jl. Raya Sirih Km. 128 Anyer      Period :      01/11/26 - 17/11/26\nTel  +62254600888   Date   : 18/11/26   15:21:01\n";
    expect(vhpPrintedAt(head)).toBe("2026-11-18T15:21:01+07:00");
  });

  it("does not take the column header 'Date' of the data table", () => {
    expect(vhpPrintedAt("Date     St ArtNo   Description\n04/11/26 01 2200001 Air")).toBeNull();
  });
});
