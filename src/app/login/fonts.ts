import { Archivo, Noto_Serif_Display } from "next/font/google";

// The two faces of sanghyang.com (sanghyang_web src/ui/fonts.ts). Loaded here, not in the root layout, so only
// /login downloads them; the wdth axis carries the condensed titles (62.5%) and the wide body text (125%).
const display = Noto_Serif_Display({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-login-display",
});

const sans = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-login-sans",
});

export const loginFontVariables = `${display.variable} ${sans.variable}`;
