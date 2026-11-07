"use client";
// Encryption at rest for the API keys in byok.ts.
//
// An AES-GCM key is generated in this browser as non-extractable: page code can
// ask the browser to encrypt or decrypt with it, but can never read the key
// itself. It is kept in IndexedDB; the encrypted keys stay in local/session
// storage. So the stored value is unreadable to anyone who copies it out of
// DevTools, a backup of the browser profile, or disk. It does not stop a script
// running in the page (that could ask for a decrypt too); the Content Security
// Policy in src/middleware.ts covers that.

const DB = "four-notes-secrets";
const TABLE = "keys";
const ID = "byok";

export type Sealed = { v: 1; iv: string; data: string };

export const isSealed = (x: unknown): x is Sealed =>
  Boolean(x && typeof x === "object" && (x as Sealed).v === 1 && typeof (x as Sealed).iv === "string" && typeof (x as Sealed).data === "string");

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function stored(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(TABLE).objectStore(TABLE).get(ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Keeps `fresh` unless another tab stored a key first; either way returns the one in the store. */
function storeOnce(db: IDBDatabase, fresh: CryptoKey): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, "readwrite");
    const table = tx.objectStore(TABLE);
    let key = fresh;
    const get = table.get(ID);
    get.onsuccess = () => {
      if (get.result) key = get.result as CryptoKey;
      else table.put(fresh, ID);
    };
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
  });
}

let keyPromise: Promise<CryptoKey | null> | null = null;

/** The browser's lock key; created on first use. null when not needed yet and absent. */
function lockKey(create: boolean): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  const p = (async () => {
    const db = await openDb();
    try {
      const existing = await stored(db);
      if (existing || !create) return existing ?? null;
      const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      return await storeOnce(db, fresh);
    } finally {
      db.close();
    }
  })();
  // Cache only a found key: a failed or "absent" lookup is retried next time.
  keyPromise = p.then((k) => { if (!k) keyPromise = null; return k; }, (e) => { keyPromise = null; throw e; });
  return keyPromise;
}

/** Encrypts `plain`. Throws where the browser can't (no IndexedDB, not a secure context). */
export async function seal(plain: string): Promise<Sealed> {
  const key = await lockKey(true);
  if (!key) throw new Error("No lock key");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { v: 1, iv: b64(iv), data: b64(new Uint8Array(data)) };
}

/** Decrypts, or null if this browser's lock key is gone (site data partly cleared) or the data was altered. */
export async function unseal(sealed: Sealed): Promise<string | null> {
  try {
    const key = await lockKey(false);
    if (!key) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
