"use client";
// Settings → Appearance: System / Light / Dark
import { isMac } from "@/lib/hooks";
import { useTheme, type ThemePref } from "@/lib/theme";
import { Icon } from "./ui";

const OPTIONS: { id: ThemePref; label: string; icon: string }[] = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "today" },
  { id: "dark", label: "Dark", icon: "moon" },
];

// Fixed colors on purpose: each card previews its theme regardless of the current one.
const PALETTE = {
  light: { bg: "#ffffff", panel: "#f7f7f5", line: "#e9e9e7", text: "#37352f", sticky: "#fbf3db", accent: "#2383e2" },
  dark: { bg: "#191919", panel: "#202020", line: "#2f2f2f", text: "#e6e6e4", sticky: "#3a3326", accent: "#529cca" },
};

function Mini({ p }: { p: (typeof PALETTE)["light"] }) {
  return (
    <div className="flex h-full min-w-0 flex-1" style={{ background: p.bg }}>
      <div className="w-1/4 space-y-1 p-1" style={{ background: p.panel, borderRight: `1px solid ${p.line}` }}>
        <div className="h-1 rounded-sm" style={{ background: p.text, opacity: 0.5 }} />
        <div className="h-1 rounded-sm" style={{ background: p.accent }} />
      </div>
      <div className="flex-1 space-y-1 p-1.5">
        <div className="h-2.5 w-3/5 rounded-sm" style={{ background: p.sticky }} />
        <div className="h-1 w-4/5 rounded-sm" style={{ background: p.text, opacity: 0.7 }} />
        <div className="h-1 w-1/2 rounded-sm" style={{ background: p.text, opacity: 0.4 }} />
      </div>
    </div>
  );
}

export default function AppearanceSection() {
  const { pref, resolved, setPref } = useTheme();

  return (
    <section>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const active = pref === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPref(o.id)}
              className={`flex flex-col gap-2 rounded-lg border p-2 text-sm transition-colors ${
                active ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--hover)]"
              }`}
            >
              <div className="flex h-14 overflow-hidden rounded-md border border-[var(--line)]" aria-hidden>
                {o.id === "dark" ? <Mini p={PALETTE.dark} /> : o.id === "light" ? <Mini p={PALETTE.light} /> : (<><Mini p={PALETTE.light} /><Mini p={PALETTE.dark} /></>)}
              </div>
              <span className={`flex items-center justify-center gap-1.5 ${active ? "font-medium text-[var(--text)]" : "text-[var(--muted)]"}`}>
                <Icon name={o.icon} size={14} />
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {pref === "system" ? `Follows your device setting (currently ${resolved}).` : `Always ${pref}, whatever your device uses.`}{" "}
        Switch quickly with {isMac() ? "⌘" : "Ctrl+"}K → “dark mode”.
      </p>
    </section>
  );
}
