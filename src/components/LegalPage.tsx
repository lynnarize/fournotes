// Shared layout for the Privacy Policy and Terms of Service. Server-rendered and
// static, so Google's verification crawler can read them without running JavaScript.
import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "./Logo";

/** Who to contact about privacy or the terms. Shown on both pages. */
export const CONTACT_EMAIL = "lynnarize@gmail.com";
export const LAST_UPDATED = "September 25, 2026";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--bg)] px-4 pb-16 pt-[calc(env(safe-area-inset-top)+16px)] text-[var(--text)]">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 rounded-lg p-1 hover:bg-[var(--hover)]">
            <Logo size={32} />
            <span className="text-lg font-bold tracking-tight">Four Notes</span>
          </Link>
          <Link href="/" className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--hover)]">Open the app</Link>
        </header>

        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Last updated {LAST_UPDATED}</p>

        <div className="legal mt-8">{children}</div>

        <footer className="mt-12 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
          <Link href="/privacy" className="hover:text-[var(--text)]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[var(--text)]">Terms of Service</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--text)]">{CONTACT_EMAIL}</a>
        </footer>
      </div>
    </div>
  );
}
