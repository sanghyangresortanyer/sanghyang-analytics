import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sanghyang Analytics",
  description: "A comprehensive analytics workspace for resort operations, marketing and market intelligence.",
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
