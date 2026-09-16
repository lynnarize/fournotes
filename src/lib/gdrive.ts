"use client";
// Sync with Google Drive. Data is stored as one JSON file in Drive's hidden
// app-data folder: private to this app, invisible in the user's Drive, and it
// doesn't count as a file they manage. Each sync:
//   1. checks whether the file changed since this device last saw it,
//   2. if so, downloads it and merges (newer updatedAt wins, deletions are tombstones),
//   3. uploads the merged result when it differs from what's in Drive.
import type { AppData, ListKind } from "./store";
import type { Note, Settings, Sticky, Todo, Transaction } from "./types";

export const googleEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

const FILE_NAME = "four-notes-sync.json";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const KINDS: ListKind[] = ["notes", "todos", "transactions", "stickies"];

type Row = Note | Todo | Transaction | Sticky;
type SyncedSettings = Pick<Settings, "currency" | "budgets" | "name" | "voiceReplies" | "updatedAt">;

export interface SyncPayload {
  app: "four-notes";
  version: 1;
  savedAt: string;
  notes: Note[];
  todos: Todo[];
  transactions: Transaction[];
  stickies: Sticky[];
  settings: SyncedSettings;
}

/** What this device remembers about the Drive file. */
export interface SyncCursor {
  fileId?: string;
  lastModified?: string;
  lastSig?: string;
}

export class NotConnectedError extends Error {}
class DriveUnauthorizedError extends Error {}

// ---- Auth (tokens come from this app's server; see src/app/api/google) ---------
export const startGoogleConnect = () => window.location.assign("/api/google/start");

export async function fetchAccessToken(): Promise<{ accessToken: string; expiresIn: number; email: string | null }> {
  const res = await fetch("/api/google/token", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; email?: string | null; error?: string };
  if (res.status === 401) throw new NotConnectedError(data.error ?? "Not connected to Google.");
  if (!res.ok || !data.accessToken) throw new Error(data.error ?? `Google sign-in failed (${res.status})`);
  return { accessToken: data.accessToken, expiresIn: data.expiresIn ?? 3600, email: data.email ?? null };
}

export async function disconnectGoogle() {
  await fetch("/api/google/disconnect", { method: "POST" }).catch(() => {});
}

// ---- Drive REST ------------------------------------------------------------------
async function drive(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (res.status === 401) throw new DriveUnauthorizedError("Google token expired");
  if (res.status === 403) throw new Error("Google Drive access wasn't allowed. Disconnect, then connect again and allow Drive access.");
  if (!res.ok) throw new Error(`Google Drive error (${res.status})`);
  return res;
}

async function findFile(token: string): Promise<{ id: string; modifiedTime: string } | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await drive(token, `${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=1`);
  const { files } = (await res.json()) as { files?: { id: string; modifiedTime: string }[] };
  return files?.[0] ?? null;
}

async function download(token: string, id: string): Promise<SyncPayload> {
  const res = await drive(token, `${DRIVE}/${id}?alt=media`);
  return normalize(await res.json());
}

async function upload(token: string, id: string | null, payload: SyncPayload): Promise<{ id: string; modifiedTime: string }> {
  const body = JSON.stringify(payload);
  if (id) {
    const res = await drive(token, `${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return res.json();
  }
  const boundary = `fournotes-${Math.random().toString(36).slice(2)}`;
  const multipart = [
    `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "",
    JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }),
    `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", body, `--${boundary}--`,
  ].join("\r\n");
  const res = await drive(token, `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return res.json();
}

export async function deleteCloudFile(getToken: (force?: boolean) => Promise<string>) {
  const token = await getToken();
  const file = await findFile(token);
  if (file) await drive(token, `${DRIVE}/${file.id}`, { method: "DELETE" });
}

// ---- Payload & merge -------------------------------------------------------------
/** Sample data is local scaffolding, never uploaded. */
const own = <T extends { sample?: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.sample);

/** Scan thumbnails stay on the device to keep the sync file small. */
function withoutImages<T extends object>(rows: T[]): T[] {
  return rows.map((r) => {
    const { imageDataUrl: _thumb, ...rest } = r as T & { imageDataUrl?: string };
    return rest as T;
  });
}

export function toPayload(d: AppData): SyncPayload {
  return {
    app: "four-notes",
    version: 1,
    savedAt: new Date().toISOString(),
    notes: withoutImages(own(d.notes)),
    todos: own(d.todos),
    transactions: withoutImages(own(d.transactions)),
    stickies: own(d.stickies),
    settings: {
      currency: d.settings.currency,
      budgets: d.settings.budgets,
      name: d.settings.name,
      voiceReplies: d.settings.voiceReplies,
      updatedAt: d.settings.updatedAt,
    },
  };
}

function normalize(raw: Partial<SyncPayload>): SyncPayload {
  return {
    app: "four-notes",
    version: 1,
    savedAt: raw.savedAt ?? "",
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    stickies: Array.isArray(raw.stickies) ? raw.stickies : [],
    settings: { currency: "IDR", budgets: {}, voiceReplies: true, ...raw.settings },
  };
}

function mergeRows<T extends Row>(local: T[], remote: T[]): T[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  for (const r of remote) {
    const mine = byId.get(r.id);
    if (!mine || r.updatedAt > mine.updatedAt) byId.set(r.id, r);
  }
  return [...byId.values()];
}

function merge(local: SyncPayload, remote: SyncPayload): SyncPayload {
  return {
    ...local,
    notes: mergeRows(local.notes, remote.notes),
    todos: mergeRows(local.todos, remote.todos),
    transactions: mergeRows(local.transactions, remote.transactions),
    stickies: mergeRows(local.stickies, remote.stickies),
    settings: (remote.settings.updatedAt ?? "") > (local.settings.updatedAt ?? "") ? remote.settings : local.settings,
  };
}

/** Short fingerprint of item versions, to skip uploads when nothing changed. */
function signature(p: SyncPayload) {
  const text = [
    ...KINDS.map((k) => (p[k] as Row[]).map((r) => `${r.id}@${r.updatedAt}`).sort().join(",")),
    p.settings.updatedAt ?? "",
  ].join("|");
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}-${(h >>> 0).toString(16)}`;
}

export async function runDriveSync(opts: {
  getToken(force?: boolean): Promise<string>;
  local: AppData;
  cursor: SyncCursor;
  apply(remote: SyncPayload): void;
}): Promise<SyncCursor> {
  // Retry once with a fresh token if Drive says the cached one expired.
  const call = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(await opts.getToken());
    } catch (e) {
      if (e instanceof DriveUnauthorizedError) return fn(await opts.getToken(true));
      throw e;
    }
  };

  const file = await call(findFile);
  let merged = toPayload(opts.local);
  let remoteSig = file ? opts.cursor.lastSig : undefined;

  if (file && file.modifiedTime !== opts.cursor.lastModified) {
    const remote = await call((t) => download(t, file.id));
    opts.apply(remote);
    merged = merge(merged, remote);
    remoteSig = signature(remote);
  }

  const mergedSig = signature(merged);
  if (file && mergedSig === remoteSig) {
    return { fileId: file.id, lastModified: file.modifiedTime, lastSig: mergedSig };
  }
  const saved = await call((t) => upload(t, file?.id ?? null, merged));
  return { fileId: saved.id, lastModified: saved.modifiedTime, lastSig: mergedSig };
}
