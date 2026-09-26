import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Newsreader, Open_Sans } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { themeInitScript, THEME_COLORS } from "@/lib/theme-script";
import "./globals.css";

// Downloaded at build time and served from this site: visitors never contact Google Fonts.
const openSans = Open_Sans({ subsets: ["latin"], display: "swap", variable: "--font-open-sans" });
// Titles are set in a serif, as the macOS app does. Browsers with the system serif
// (New York on Apple devices) use that first; see --font-serif in globals.css.
const newsreader = Newsreader({ subsets: ["latin"], display: "swap", variable: "--font-newsreader" });
// Google's branding rules require Google Sans Medium on the "Continue with Google" button.
// Self-hosted (SIL Open Font License, see src/fonts/GoogleSans-OFL.txt).
const googleSans = localFont({
  src: "../fonts/GoogleSans-Medium-latin.woff2",
  weight: "500",
  display: "swap",
  variable: "--font-google-sans",
});

export const metadata: Metadata = {
  title: "Four Notes",
  description: "Notes, To-Do and Finance in one place, with an AI assistant.",
  manifest: "/manifest.webmanifest",
  applicationName: "Four Notes",
  appleWebApp: { capable: true, title: "Four Notes", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request nonce from src/middleware.ts: the Content Security Policy only runs scripts carrying it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // data-theme is set by the inline script before hydration, so React must not warn about it.
    <html lang="en" className={`${openSans.variable} ${newsreader.variable} ${googleSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Browsers blank the nonce attribute after load, so React would report a mismatch. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} suppressHydrationWarning />
      </head>
      <body>
        {children}
        {/* Anonymous page views and Core Web Vitals, cookie-free (see the Privacy Policy, section 4). */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
