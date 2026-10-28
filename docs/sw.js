/* Golan Casino · the phone's "storeroom": pictures, sounds and code are kept on the device after the first visit.
   - files with ?v= in the address never change → served from the device straight away
   - other pictures/sounds → served from the device, refreshed quietly in the background
   - pages, version.json and the server (Supabase) always go to the network */
const CACHE = "gc-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const same = url.origin === location.origin, fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname), cdn = url.hostname === "cdn.jsdelivr.net";
  if (!same && !fonts && !cdn) return;                                   // Supabase and everything else: untouched
  if (same && (req.mode === "navigate" || /version\.json|whatsnew\.json/.test(url.pathname))) return;   // pages and update checks: always fresh
  const asset = !same || /\.(webp|png|jpg|jpeg|svg|mp3|woff2?|js|css|json)$/.test(url.pathname);
  if (!asset) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
    if (hit && (url.search.includes("v=") || !same || cdn)) return hit;   // versioned / CDN: never changes
    if (hit) { e.waitUntil(net); return hit; }                           // unversioned: show now, refresh in the background
    return net;
  }));
});
