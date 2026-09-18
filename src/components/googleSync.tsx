"use client";
// "Sync with Google Drive": connection state, automatic sync, and the settings panel.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  deleteCloudFile, disconnectGoogle, fetchAccessToken, googleEnabled, NotConnectedError, runDriveSync,
  startGoogleConnect, type SyncCursor,
} from "@/lib/gdrive";
import { useStore } from "@/lib/store";
import { Icon, useToast } from "./ui";

export type GoogleStatus = "off" | "disconnected" | "syncing" | "synced" | "offline" | "error";

interface Saved extends SyncCursor {
  email: string;
}

interface Ctx {
  enabled: boolean;
  email: string | null;
  status: GoogleStatus;
  lastSyncedAt: string | null;
  error: string | null;
  connect(): void;
  disconnect(deleteCopy?: boolean): Promise<void>;
  syncNow(): void;
}

const KEY = "four-notes:google-sync";
const readSaved = (): Saved | null => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
};
const writeSaved = (s: Saved | null) => {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
};

const RETURN_ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  drive: "Four Notes needs permission to save its data in your Google Drive. Connect again and allow Drive access.",
  state: "The sign-in link expired. Please try again.",
  offline: "Google didn't allow ongoing access. Please try connecting again.",
  config: "Google sync isn't set up on this server yet.",
  google: "Google sign-in failed. Please try again.",
};

export const GOOGLE_STATUS_LABEL: Record<GoogleStatus, string> = {
  off: "", disconnected: "Not connected", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error",
};

const GoogleCtx = createContext<Ctx | null>(null);
export const useGoogleSync = () => useContext(GoogleCtx)!;

export function GoogleSyncProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const toast = useToast();

  const [saved, setSavedState] = useState<Saved | null>(null);
  const savedRef = useRef<Saved | null>(null);
  const setSaved = useCallback((s: Saved | null) => {
    savedRef.current = s;
    writeSaved(s);
    setSavedState(s);
  }, []);
  const [status, setStatus] = useState<GoogleStatus>(googleEnabled ? "disconnected" : "off");
  const [lastSyncedAt, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null);

  const getToken = useCallback(async (force = false) => {
    const cached = tokenRef.current;
    if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const fresh = await fetchAccessToken();
    tokenRef.current = { token: fresh.accessToken, expiresAt: Date.now() + fresh.expiresIn * 1000 };
    return fresh.accessToken;
  }, []);

  // Restore the connection, or finish connecting after Google's consent screen.
  useEffect(() => {
    if (!googleEnabled) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    const reason = params.get("reason") ?? "google";
    if (result) {
      params.delete("google");
      params.delete("reason");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }

    if (result === "connected") {
      fetchAccessToken()
        .then((t) => {
          tokenRef.current = { token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 };
          const email = t.email ?? "Google account";
          const previous = readSaved();
          setSaved(previous?.email === email ? previous : { email });
          toast(`Connected to Google Drive as ${email}. Syncing now…`);
        })
        .catch((e) => toast(e instanceof Error ? e.message : "Couldn't connect to Google", "error"));
      return;
    }
    if (result === "error") {
      const message = RETURN_ERRORS[reason] ?? RETURN_ERRORS.google;
      setError(message);
      toast(message, "error");
    }
    const previous = readSaved();
    if (previous) setSaved(previous);
  }, [setSaved, toast]);

  const running = useRef(false);
  const again = useRef(false);

  const sync = useCallback(async (): Promise<void> => {
    const current = savedRef.current;
    if (!current || !storeRef.current.ready) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    if (running.current) { again.current = true; return; }
    running.current = true;
    setStatus("syncing");
    try {
      // One sync at a time across this browser's tabs, so two tabs can't both create the file.
      const locked = async <T,>(fn: () => Promise<T>): Promise<T> =>
        navigator.locks ? await navigator.locks.request("four-notes-drive-sync", fn) : fn();
      const cursor = await locked(() => runDriveSync({
        getToken,
        local: storeRef.current.all,
        cursor: current,
        apply: (remote) => {
          const s = storeRef.current;
          s.mergeRemote("notes", remote.notes);
          s.mergeRemote("todos", remote.todos);
          s.mergeRemote("transactions", remote.transactions);
          s.mergeRemote("stickies", remote.stickies);
          s.mergeSettings(remote.settings);
        },
      }));
      if (savedRef.current?.email === current.email) setSaved({ ...current, ...cursor });
      setLast(new Date().toISOString());
      setError(null);
      setStatus("synced");
    } catch (e) {
      if (e instanceof NotConnectedError) {
        tokenRef.current = null;
        setSaved(null);
        setStatus("disconnected");
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        setTimeout(() => void sync(), 500);
      }
    }
  }, [getToken, setSaved]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sync(), ms);
  }, [sync]);

  const email = saved?.email ?? null;

  // Sync on connect/start, when the app comes back into view, when back online, and every 2 minutes.
  useEffect(() => {
    if (!email || !store.ready) return;
    void sync();
    const onVisible = () => { if (document.visibilityState === "visible") schedule(300); };
    const onOnline = () => schedule(300);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => schedule(0), 120_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [email, store.ready, sync, schedule]);

  // Local edits -> sync a few seconds later (batches quick edits together).
  useEffect(() => {
    if (email && store.ready) schedule(4000);
  }, [store.all, email, store.ready, schedule]);

  const disconnect = useCallback(async (deleteCopy = false) => {
    if (deleteCopy) {
      try {
        await deleteCloudFile(getToken);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Couldn't delete the Drive copy", "error");
        return;
      }
    }
    await disconnectGoogle();
    tokenRef.current = null;
    setSaved(null);
    setStatus("disconnected");
    setError(null);
    setLast(null);
    toast(deleteCopy ? "Disconnected, and the copy in Google Drive was deleted." : "Disconnected from Google. Your data stays on this device.");
  }, [getToken, setSaved, toast]);

  return (
    <GoogleCtx.Provider
      value={{
        enabled: googleEnabled,
        email,
        status: email ? status : googleEnabled ? "disconnected" : "off",
        lastSyncedAt,
        error,
        connect: startGoogleConnect,
        disconnect,
        syncNow: () => schedule(0),
      }}
    >
      {children}
    </GoogleCtx.Provider>
  );
}

/** Google "G" mark, per Google's sign-in branding guidelines. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ onClick, label = "Continue with Google", disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className="google-btn" onClick={onClick} disabled={disabled}>
      <GoogleG />
      <span>{label}</span>
    </button>
  );
}

export function GoogleSyncPanel() {
  const g = useGoogleSync();

  if (!g.email) {
    return (
      <div className="space-y-3">
        <div>
          <p className="font-medium">Sync with your Google account</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Keep notes, tasks and spending in sync on all your devices. Everything is saved in a private app folder in your own Google Drive
            that only Four Notes can open. What&apos;s already on this device is uploaded when you connect.
          </p>
        </div>
        <GoogleButton onClick={g.connect} />
        <p className="text-[11px] leading-relaxed text-[var(--faint)]">
          By connecting you agree to the <a href="/terms" className="underline hover:text-[var(--text)]">Terms</a> and{" "}
          <a href="/privacy" className="underline hover:text-[var(--text)]">Privacy Policy</a>.
        </p>
        {g.error && <p className="text-xs text-[var(--danger)]">{g.error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GoogleG />
        <span className="min-w-0 truncate font-medium">{g.email}</span>
        <span className="chip">
          {GOOGLE_STATUS_LABEL[g.status]}
          {g.lastSyncedAt ? ` · ${new Date(g.lastSyncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Syncing to a private app folder in your Google Drive. Changes sync automatically a few seconds after you edit, every couple of minutes,
        and whenever you come back to the app.
      </p>
      {g.error && <p className="text-xs text-[var(--danger)]">{g.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--hover)]" onClick={g.syncNow}>
          <Icon name="repeat" size={14} /> Sync now
        </button>
        <button className="rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-[var(--hover)]" onClick={() => g.disconnect(false)}>
          Disconnect
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-[var(--danger)] hover:bg-[var(--hover)]"
          onClick={() => window.confirm("Delete the copy of your data stored in Google Drive and disconnect? Data on this device is kept.") && g.disconnect(true)}
        >
          Delete Drive copy
        </button>
      </div>
    </div>
  );
}
