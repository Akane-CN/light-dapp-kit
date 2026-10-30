/*!
 * Cross-origin isolation service worker for light-dapp-kit.
 *
 * `ckb-light-client-js` needs SharedArrayBuffer, which needs a cross-origin-isolated page.
 * Static hosts (GitHub Pages) cannot set response headers, so this worker injects them.
 *
 * On Chromium 137+ it uses `Document-Isolation-Policy: isolate-and-require-corp`, which
 * isolates the document WITHOUT `Cross-Origin-Opener-Policy`, so a popup wallet (JoyID)
 * keeps `window.opener` and can report back. On other browsers it falls back to
 * COOP `same-origin` + COEP `require-corp`, which isolates but severs cross-origin popups.
 *
 * Based on coi-serviceworker (MIT, Guido Zuidhof); extended with the DIP branch.
 */
const chromeMajor = (ua) => {
  const m = /(?:Chrome|Chromium|Edg)\/(\d+)/.exec(ua || "");
  return m ? Number(m[1]) : 0;
};

if (typeof window === "undefined") {
  // ---- service worker role ----
  const useDip = chromeMajor(self.navigator && self.navigator.userAgent) >= 137;

  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (e) => {
    if (e.data && e.data.type === "deregister") {
      self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)));
    }
  });
  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          if (useDip) {
            // Document-only isolation: no COOP, so cross-origin popups keep their opener.
            headers.set("Document-Isolation-Policy", "isolate-and-require-corp");
          } else {
            headers.set("Cross-Origin-Opener-Policy", "same-origin");
          }
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        })
        .catch((e) => console.error(e)),
    );
  });
} else {
  // ---- page bootstrap role ----
  (() => {
    if (window.crossOriginIsolated !== false) return; // already isolated by real headers
    if (!window.isSecureContext || !navigator.serviceWorker) return;
    const script = document.currentScript;
    navigator.serviceWorker.register(script.src).then(
      (registration) => {
        registration.addEventListener("updatefound", () => window.location.reload());
        if (registration.active && !navigator.serviceWorker.controller) window.location.reload();
      },
      (err) => console.error("COI service worker failed to register:", err),
    );
  })();
}
