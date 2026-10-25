// Minimal service worker: makes the site installable as an app (no offline caching, always fresh from the network).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
