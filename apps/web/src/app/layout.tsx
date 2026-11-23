import type { Metadata, Viewport } from "next";
import { allo, hand, mono } from "./fonts";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Opal", template: "%s · Opal" },
  description: "Opal: chat, agents, study and handwriting in one place.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#131313" },
  ],
};

// Applies the saved theme and accent before first paint so neither flashes.
const themeScript = `(function(){try{var r=document.documentElement;var t=localStorage.getItem('opal-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);r.classList.toggle('dark',d);var a=localStorage.getItem('opal-accent');if(a&&/^[a-z]+$/.test(a))r.setAttribute('data-accent',a);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${allo.variable} ${mono.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
