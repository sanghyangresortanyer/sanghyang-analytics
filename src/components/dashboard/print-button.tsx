"use client";

import { FileDown } from "lucide-react";

/**
 * Export PDF through the browser's print dialog ("Save as PDF") until the PDF layout the user
 * will specify is built.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="skeuo-pill-light inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold hover:brightness-[1.02] print:hidden"
    >
      <FileDown className="h-4 w-4" />
      Export PDF
    </button>
  );
}
