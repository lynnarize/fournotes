import type { Metadata, Viewport } from "next";
import { themeInitScript, THEME_COLORS } from "@/lib/theme-script";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
