import localFont from "next/font/local";
import { JetBrains_Mono, Playpen_Sans } from "next/font/google";

// Allo GR (github.com/l12-krts/Allo-GR): Allo with full monotonic Greek.
// The "friendly" variable file fixes roundness at 50 and is about half the size of the full one.
export const allo = localFont({
  src: [
    { path: "../../node_modules/allo-gr/fonts/webfonts/AlloVariableFriendly.woff2", weight: "100 900", style: "normal" },
    { path: "../../node_modules/allo-gr/fonts/webfonts/Allo-Oblique.woff2", weight: "400", style: "italic" },
    { path: "../../node_modules/allo-gr/fonts/webfonts/Allo-MediumOblique.woff2", weight: "500", style: "italic" },
    { path: "../../node_modules/allo-gr/fonts/webfonts/Allo-SemiBoldOblique.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-allo",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
});

export const mono = JetBrains_Mono({
  subsets: ["latin", "greek"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Stand-in hand for Opal Handwriting before a user uploads their own (has Greek).
export const hand = Playpen_Sans({
  subsets: ["latin", "greek"],
  weight: "variable",
  variable: "--font-hand",
  display: "swap",
  preload: false,
});
