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
import Sidebar, { TABS } from "@/components/Sidebar";
import SampleBanner from "@/components/SampleData";
import TodayView from "@/components/TodayView";
import TodoView from "@/components/TodoView";
import TranscribeView from "@/components/TranscribeView";
import Toolbar from "@/components/Toolbar";
import { Icon, ToastProvider, useToast } from "@/components/ui";
import { useBackDismiss, useTabHistory } from "@/lib/backstack";
import { useCalendarReturn } from "@/lib/calendar";
import { usePulsingTabs } from "@/lib/highlight";
import { usePresence } from "@/lib/hooks";
import { openAssistant, scrollToId, useOpenItem, useOpenSettings, useOpenTab } from "@/lib/nav";
import { StoreProvider, useStore } from "@/lib/store";
import type { Tab } from "@/lib/types";

const TITLES: Record<Tab, string> = { today: "Today", todo: "Planner", transcribe: "Meetings", notes: "Notes", finance: "Money" };

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const drawer = usePresence(menu, 220);
  useBackDismiss(menu, () => setMenu(false));
  // Back returns to the previous tab before it leaves the app.
  useTabHistory(tab, (t) => setTab(t as Tab));
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name;
  const pulsing = usePulsingTabs().filter((t) => t !== tab);

  // Deep links from the manifest shortcuts: /?tab=finance
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in TITLES) setTab(t as Tab);
  }, []);

  // "Open on Today" from the assistant's panel, and anything else that names a place.
  useOpenTab(setTab);
  // Back from Google after "Connect calendar".
  useCalendarReturn(useToast());

  // Stickies only show on Today.
  useOpenItem("any", (f) => {
    setTab(f.kind === "sticky" ? "today" : f.kind === "note" || f.kind === "person" ? "notes" : f.kind === "todo" ? "todo" : f.kind === "talk" ? "transcribe" : "finance");
  });

  // ⌘K / Ctrl+K: search and quick add. ⌘, / Ctrl+,: Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === ",") {
        e.preventDefault();
        setPalette(false);
        setSettings(true);
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
    // Every section is always laid out in Settings, so it only has to be found and scrolled to.
    if (field) {
      scrollToId(`settings-field-${field}`, "center", (el) => {
        (el.querySelector<HTMLElement>("input") ?? el.querySelector<HTMLElement>("select"))?.focus({ preventScroll: true });
        return true;
      });
    } else if (section) {
      scrollToId(`settings-${section}`, "start");
    }
  });
  const closePalette = useCallback(() => setPalette(false), []);
  const sidebar = (onClose?: () => void) => (
    <Sidebar tab={tab} setTab={setTab} onClose={onClose} onSearch={() => setPalette(true)} onSettings={openSettings} />
  );

  return (
    <AssistantProvider onFiled={setTab}>
      <BackgroundJobs />
      {/* --tabbar-space: how much of the bottom edge the phone tab bar covers (0 on larger screens).
          The bar floats over the page, so anything that scrolls to the bottom, or is fixed there,
          keeps this much clear. */}
      <div className="app-root flex h-dvh flex-col overflow-hidden bg-[var(--frame)] pt-[env(safe-area-inset-top)] [--tabbar-space:calc(env(safe-area-inset-bottom)+92px)] md:pt-0 md:[--tabbar-space:0px]">
        <PwaSetup />
        <SampleBanner />
        <Toolbar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onOmni={() => setPalette(true)} onNew={() => setPalette(true)} />

        {/* Phones: the mark opens the menu (spaces, sync, settings); the omnibar is the one way in. */}
        <header className="on-frame flex h-[68px] shrink-0 items-center gap-2 px-3 md:hidden">
          <button type="button" className="fn-press grid h-11 w-11 shrink-0 place-items-center rounded-full" onClick={() => setMenu(true)} aria-label={`Open menu, space ${spaceName ?? "Personal"}`} aria-expanded={menu}>
            <Logo size={30} />
          </button>
          <button type="button" className="omni h-11 min-w-0 flex-1" onClick={() => setPalette(true)} aria-label="Search, ask or capture">
            <Icon name="search" size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-[15px]">Search, ask or capture…</span>
          </button>
          <button type="button" className="rnd !h-11 !w-11" onClick={openSettings} aria-label="Settings">
            <Icon name="settings" size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 md:gap-3 md:px-3 md:pb-3">
          {/* Sidebar: on the frame on larger screens, a drawer behind the header's mark on phones */}
          {sidebarOpen && <div className="hidden md:block">{sidebar()}</div>}
          {drawer.mounted && (
            <div className={`fixed inset-0 z-40 md:hidden ${menu ? "" : "pointer-events-none"}`}>
              <button className="fn-backdrop absolute inset-0 bg-black/30" data-state={drawer.state} onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={-1} />
              <div className="fn-drawer relative h-full w-fit shadow-[var(--shadow-floating)]" data-state={drawer.state}>{sidebar(() => setMenu(false))}</div>
            </div>
          )}

          {/* Every tab lays out its own sheets, each scrolling on its own. Phones stack them on one. */}
          <main className="sheet relative flex min-w-0 flex-1 flex-col overflow-y-auto max-md:rounded-b-none md:overflow-hidden md:rounded-none md:bg-transparent">
            {/* Every tab: same width, same side padding, same title position. */}
            <div key={tab} className="fn-rise mx-auto flex min-h-0 w-full flex-1 flex-col max-md:px-[18px] max-md:pt-[22px]">
              {/* Each page draws its own header; this one is for screen readers. */}
              <h1 className="sr-only">{TITLES[tab]}{spaceName ? `, ${spaceName}` : ""}</h1>
              {!ready ? (
                <div className="text-sm text-[var(--text-muted)]">Loading…</div>
              ) : tab === "today" ? (
                <TodayView setTab={setTab} />
              ) : tab === "notes" ? (
                <NotesView />
              ) : tab === "todo" ? (
                <TodoView />
              ) : tab === "transcribe" ? (
                <TranscribeView />
              ) : (
                <FinanceView setTab={setTab} />
              )}
            </div>

            {/* Today has the assistant in the middle of its page; everywhere else it's a pill in the corner. */}
            {tab !== "today" && <ChatDock minimized />}
          </main>
        </div>

        {/* Phones: the places on a glass layer floating over the page, and the assistant on one of its own. */}
        <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-[35] flex items-center gap-2.5 px-3.5 pb-[calc(env(safe-area-inset-bottom)+16px)] md:hidden">
          <div className="tabbar pointer-events-auto flex h-[62px] min-w-0 flex-1 items-center rounded-full p-1">
            {TABS.map((t) => {
              const on = tab === t.id;
              const pulse = pulsing.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={on ? "page" : undefined}
                  className={`fn-press relative flex h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-full text-[10.5px] font-semibold transition-colors ${
                    on ? "bg-[var(--accent-subtle)] text-[var(--foreground)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <span className="relative">
                    <Icon name={t.icon} size={22} className={on ? "text-[var(--spark)]" : ""} />
                    {pulse && <span className="fn-ping absolute -right-1 -top-0.5" aria-hidden />}
                  </span>
                  {t.label}
                  {pulse && <span className="sr-only">, new from the assistant</span>}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => openAssistant()} aria-label="Ask Four Notes" className="tabbar fn-press pointer-events-auto grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full text-[var(--ai)]">
            <Icon name="sparkle" size={26} />
          </button>
        </nav>
      </div>
      <Onboarding />
      <CommandPalette open={palette} onClose={closePalette} setTab={setTab} onSettings={openSettings} />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </AssistantProvider>
  );
}
