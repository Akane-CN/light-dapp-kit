`coi-serviceworker.js` makes the page cross-origin isolated on static hosts that cannot set
headers (GitHub Pages), which `ckb-light-client-js` needs for `SharedArrayBuffer`.

It is the kit's own worker (MIT, based on gzuidhof/coi-serviceworker). On Chromium 137+ it
injects `Document-Isolation-Policy`, so popup wallets such as JoyID keep `window.opener`; on
other browsers it falls back to `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy`,
which isolates but breaks cross-origin popups. A host that can set headers itself does not
need it (the worker no-ops when the page is already isolated).
