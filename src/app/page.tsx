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
import Sidebar from "@/components/Sidebar";
import SampleBanner from "@/components/SampleData";
import StickyBar from "@/components/StickyBar";
import TipStrip from "@/components/TipStrip";
import TodayView from "@/components/TodayView";
import TodoView from "@/components/TodoView";
import { Icon, ToastProvider } from "@/components/ui";
import { useOpenItem } from "@/lib/nav";
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
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name;

  // Deep links from the manifest shortcuts: /?tab=finance
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in TITLES) setTab(t as Tab);
  }, []);

  useOpenItem("any", (f) => setTab(f.kind === "note" ? "notes" : f.kind === "todo" ? "todo" : "finance"));

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
          {menu && (
            <div className="fixed inset-0 z-40 flex md:hidden">
              <div className="shadow-[var(--shadow)]">{sidebar(() => setMenu(false))}</div>
              <button className="flex-1 bg-black/30" onClick={() => setMenu(false)} aria-label="Close menu" />
            </div>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
            <header className="flex items-center gap-2 px-4 pt-3 md:hidden">
              <button className="btn-ghost" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" size={18} /></button>
              <button className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-[var(--hover)]" onClick={() => setTab("today")} aria-label="Four Notes, go to Today">
                <Logo size={34} />
                <span className="text-lg font-bold tracking-tight">Four Notes</span>
              </button>
              <button className="btn-ghost ml-auto" onClick={() => setPalette(true)} aria-label="Search"><Icon name="search" size={18} /></button>
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
