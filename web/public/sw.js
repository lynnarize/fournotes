// Four Notes service worker: offline app shell + share target.
// Data lives in localStorage (and Supabase when configured), so caching the app
// shell is enough for the app to open and work without internet.
const VERSION = "four-notes-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "share-target").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Share sheet -> app: stash the shared file/text, then open the app to process it.
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const cache = await caches.open("share-target");
      const file = form.get("file");
      if (file && typeof file !== "string") {
        await cache.put("/shared-file", new Response(file, { headers: { "Content-Type": file.type } }));
      }
      const text = ["title", "text", "url"].map((k) => form.get(k)).filter((v) => typeof v === "string" && v).join("\n");
      if (text) await cache.put("/shared-text", new Response(text));
      return Response.redirect("/?share=1", 303);
    })());
    return;
  }

  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Pages: network first so updates show up, cached shell when offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Build assets and icons: cache first, refresh in the background.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => "focus" in w);
      return win ? win.focus() : self.clients.openWindow("/?tab=todo");
    }),
  );
});
