"use client";
// Cloud sync + shared spaces state. Renders nothing extra; when Supabase env vars
// are missing, `enabled` is false and the app stays local-only.
import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { auth, cloudEnabled, getCursors, KINDS, pull, push, setCursors, spaces, subscribe } from "@/lib/sync";

type Status = "off" | "signed-out" | "syncing" | "synced" | "offline" | "error";

interface CloudCtx {
  enabled: boolean;
  email: string | null;
  status: Status;
  lastSyncedAt: string | null;
  error: string | null;
  sendMagicLink(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): void;
  createSpace(name: string): Promise<void>;
  joinSpace(code: string): Promise<void>;
  leaveSpace(id: string): Promise<void>;
}

const Ctx = createContext<CloudCtx | null>(null);
export const useCloud = () => useContext(Ctx)!;

export function CloudProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>(cloudEnabled ? "signed-out" : "off");
  const [lastSyncedAt, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!cloudEnabled) return;
    auth.getSession().then(setSession);
    return auth.onChange(setSession);
  }, []);

  const running = useRef(false);
  const again = useRef(false);

  const sync = useCallback(async () => {
    if (!userId || !storeRef.current.ready) return;
    if (!navigator.onLine) return setStatus("offline");
    if (running.current) { again.current = true; return; }
    running.current = true;
    setStatus("syncing");
    try {
      const cursors = getCursors(userId);
      const startedAt = new Date().toISOString();
      const all = storeRef.current.all;
      const memberOf = new Set(all.spaces.map((s) => s.id));
      // 1) Push local edits (including everything made while offline, or before the first sign-in).
      for (const kind of KINDS) {
        const rows = (all[kind] as { updatedAt: string; spaceId?: string | null; sample?: boolean }[]).filter(
          (x) => x.updatedAt > cursors.pushedAt && !x.sample && (!x.spaceId || memberOf.has(x.spaceId)),
        );
        await push(kind, rows as never);
      }
      setCursors(userId, { pushedAt: startedAt });
      // 2) Pull what changed on other devices / from space members.
      const { rows, maxSyncedAt } = await pull(cursors.pulledAt);
      for (const kind of KINDS) storeRef.current.mergeRemote(kind, rows[kind]);
      setCursors(userId, { pulledAt: maxSyncedAt });
      storeRef.current.setSpaces(await spaces.list());
      setLast(new Date().toISOString());
      setError(null);
      setStatus("synced");
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      setStatus("error");
    } finally {
      running.current = false;
      if (again.current) { again.current = false; setTimeout(sync, 300); }
    }
  }, [userId]);

  // Debounced trigger shared by local edits, realtime events and reconnects.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback((ms = 1500) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(sync, ms);
  }, [sync]);

  useEffect(() => {
    if (!cloudEnabled) return;
    if (!userId) { setStatus("signed-out"); return; }
    if (!store.ready) return;
    sync();
    const unsubscribe = subscribe(() => schedule(800));
    const onOnline = () => schedule(200);
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => schedule(0), 60_000);
    return () => { unsubscribe(); window.removeEventListener("online", onOnline); clearInterval(interval); };
  }, [userId, store.ready, sync, schedule]);

  // Local edits -> push soon after.
  useEffect(() => {
    if (userId && store.ready) schedule();
  }, [store.all, userId, store.ready, schedule]);

  const value: CloudCtx = {
    enabled: cloudEnabled,
    email: session?.user.email ?? null,
    status,
    lastSyncedAt,
    error,
    sendMagicLink: auth.sendMagicLink,
    signInWithGoogle: auth.signInWithGoogle,
    signOut: async () => {
      await auth.signOut();
      storeRef.current.setSpaces([]);
    },
    syncNow: () => schedule(0),
    createSpace: async (name) => {
      const id = await spaces.create(name);
      storeRef.current.setSpaces(await spaces.list());
      storeRef.current.switchSpace(id);
    },
    joinSpace: async (code) => {
      const id = await spaces.join(code);
      storeRef.current.setSpaces(await spaces.list());
      storeRef.current.switchSpace(id);
      // Pull the space's existing rows, which are older than our pull cursor.
      if (userId) setCursors(userId, { pulledAt: "1970-01-01T00:00:00Z" });
      schedule(0);
    },
    leaveSpace: async (id) => {
      await spaces.leave(id);
      storeRef.current.setSpaces(await spaces.list());
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
