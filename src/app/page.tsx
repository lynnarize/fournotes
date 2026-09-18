"use client";
import { useCallback, useEffect, useState } from "react";
import { AssistantProvider } from "@/components/assistant";
import BackgroundJobs from "@/components/BackgroundJobs";
import ChatDock from "@/components/ChatDock";
import { CloudProvider } from "@/components/cloud";
import { GoogleSyncProvider } from "@/components/googleSync";
import CommandPalette from "@/components/CommandPalette";
import FinanceView from "@/components/FinanceView";
import Logo from "@/components/Logo";
import NotesView from "@/components/NotesView";
import Onboarding from "@/components/Onboarding";
import PwaSetup from "@/components/PwaSetup";
import SettingsModal from "@/components/SettingsModal";
import { revealSettingsSection } from "@/components/SettingsSection";
import Sidebar from "@/components/Sidebar";
import SampleBanner from "@/components/SampleData";
import StickyBar from "@/components/StickyBar";
import TipStrip from "@/components/TipStrip";
import TodayView from "@/components/TodayView";
import TodoView from "@/components/TodoView";
import { Icon, ToastProvider } from "@/components/ui";
import { useBackDismiss, useTabHistory } from "@/lib/backstack";
import { usePulsingTabs } from "@/lib/highlight";
import { usePresence } from "@/lib/hooks";
import { scrollToId, useOpenItem, useOpenSettings } from "@/lib/nav";
import { StoreProvider, useStore } from "@/lib/store";
import type { Tab } from "@/lib/types";

const TITLES: Record<Tab, { title: string; emoji: string }> = {
  today: { title: "Today", emoji: "☀️" },
  notes: { title: "Notes", emoji: "📝" },
  todo: { title: "To-Do", emoji: "✅" },
  finance: { title: "Finance", emoji: "💸" },
};

export default function Page() {
  return (
    <StoreProvider>
      <ToastProvider>
        <CloudProvider>
          <GoogleSyncProvider>
            <Shell />
          </GoogleSyncProvider>
        </CloudProvider>
      </ToastProvider>
    </StoreProvider>
  );
}

function Shell() {
  const { ready, spaces, currentSpaceId } = useStore();
  const [tab, setTab] = useState<Tab>("today");
  const [menu, setMenu] = useState(false);
  const drawer = usePresence(menu, 220);
  useBackDismiss(menu, () => setMenu(false));
  // Back returns to the previous tab before it leaves the app.
  useTabHistory(tab, (t) => setTab(t as Tab));
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name;
  const pulsing = usePulsingTabs().filter((t) => t !== tab);
  // Phones: the header stays on top; it gets a border once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false);

  // Deep links from the manifest shortcuts: /?tab=finance
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in TITLES) setTab(t as Tab);
  }, []);

  // Stickies live on every tab, so jumping to one doesn't switch tabs.
  useOpenItem("any", (f) => {
    if (f.kind !== "sticky") setTab(f.kind === "note" ? "notes" : f.kind === "todo" ? "todo" : "finance");
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSettings = useCallback(() => setSettings(true), []);
  useOpenSettings(({ section, field }) => {
    if (section) revealSettingsSection(section);
    setMenu(false);
    setSettings(true);
    if (field) {
      scrollToId(`settings-field-${field}`, "center", (el) => {
        (el.querySelector<HTMLElement>("input") ?? el.querySelector<HTMLElement>("select"))?.focus({ preventScroll: true });
        return true;
      });
    } else if (section) {
      scrollToId(`settings-${section}`, "start", (el) => el.querySelector("[aria-expanded=true]") !== null);
    }
  });
  const closePalette = useCallback(() => setPalette(false), []);
  const sidebar = (onClose?: () => void) => (
    <Sidebar tab={tab} setTab={setTab} onClose={onClose} onSearch={() => setPalette(true)} onSettings={openSettings} />
  );

  return (
    <AssistantProvider onFiled={setTab}>
      <BackgroundJobs />
      <div className="app-root flex h-dvh flex-col overflow-hidden">
        <PwaSetup />
        <SampleBanner />
        <div className="flex min-h-0 flex-1">
          {/* Sidebar: fixed on desktop, drawer on mobile */}
          <div className="hidden border-r border-[var(--line)] md:block">{sidebar()}</div>
          {drawer.mounted && (
            <div className={`fixed inset-0 z-40 md:hidden ${menu ? "" : "pointer-events-none"}`}>
              <button className="fn-backdrop absolute inset-0 bg-black/30" data-state={drawer.state} onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={-1} />
              <div className="fn-drawer relative h-full w-fit shadow-[var(--shadow)]" data-state={drawer.state}>{sidebar(() => setMenu(false))}</div>
            </div>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
            <header
              className={`sticky top-0 z-30 flex items-center gap-1 bg-[var(--bg)] px-2 pb-1.5 pt-[calc(env(safe-area-inset-top)+6px)] transition-[border-color,box-shadow] md:hidden ${
                scrolled ? "border-b border-[var(--line)] shadow-[0_1px_8px_rgba(0,0,0,0.06)]" : "border-b border-transparent"
              }`}
            >
              <button className="tap-target fn-press relative" onClick={() => setMenu(true)} aria-label={pulsing.length ? "Open menu (new items)" : "Open menu"} aria-expanded={menu}>
                <svg className="fn-burger" data-open={menu} width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
                {pulsing.length > 0 && <span className="fn-ping absolute right-2 top-2" aria-hidden />}
              </button>
              <button className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-[var(--hover)]" onClick={() => setTab("today")} aria-label="Four Notes, go to Today">
                <Logo size={34} />
                <span className="text-lg font-bold tracking-tight">Four Notes</span>
              </button>
              <button className="tap-target fn-press ml-auto" onClick={() => setPalette(true)} aria-label="Search"><Icon name="search" size={22} /></button>
              <button className="tap-target fn-press" onClick={openSettings} aria-label="Settings"><Icon name="settings" size={22} /></button>
            </header>

            <div className="mx-auto w-full max-w-4xl"><TipStrip /></div>
            <div className="mx-auto w-full max-w-4xl pt-3"><StickyBar /></div>

            <div key={tab} className="fn-rise mx-auto w-full max-w-4xl flex-1 px-4 pb-8 md:px-10">
              <h1 className="mb-6 mt-4 flex items-center gap-3 text-4xl font-bold">
                <span>{TITLES[tab].emoji}</span>{TITLES[tab].title}
                {spaceName && <span className="chip self-center text-sm font-normal"><Icon name="users" size={12} />{spaceName}</span>}
              </h1>
              {!ready ? (
                <div className="text-sm text-[var(--muted)]">Loading…</div>
              ) : tab === "today" ? (
                <TodayView setTab={setTab} />
              ) : tab === "notes" ? (
                <NotesView />
              ) : tab === "todo" ? (
                <TodoView />
              ) : (
                <FinanceView />
              )}
            </div>

            <ChatDock />
          </main>
        </div>
      </div>
      <Onboarding />
      <CommandPalette open={palette} onClose={closePalette} setTab={setTab} onSettings={openSettings} />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </AssistantProvider>
  );
}
