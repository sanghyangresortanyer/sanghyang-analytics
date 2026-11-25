import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sanghyang Analytics — Revenue, Pembelian, Inventory & Pemasaran",
  description: "Sanghyang Analytics — Revenue, Pembelian, Inventory & Pemasaran",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
