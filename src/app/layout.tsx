import type { Metadata, Viewport } from "next";
import { Open_Sans } from "next/font/google";
import localFont from "next/font/local";
import { themeInitScript, THEME_COLORS } from "@/lib/theme-script";
import "./globals.css";

// Downloaded at build time and served from this site: visitors never contact Google Fonts.
const openSans = Open_Sans({ subsets: ["latin"], display: "swap", variable: "--font-open-sans" });
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the inline script before hydration, so React must not warn about it.
    <html lang="en" className={`${openSans.variable} ${googleSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
