# navigator.freedom test site

A standalone demo page served over a real `http://` origin for manually
exercising the `navigator.freedom` API end to end in Freedom Browser.

Unlike the internal `freedom://playground` page (`src/renderer/pages/playground.html`),
this runs on an ordinary web origin, so it validates the providers the way a
real dapp sees them — Tier-2 secure-context handling, real Content-Security-Policy
context, and the page-realm globals the webview preload injects into every page
(`navigator.freedom`, `window.ethereum`, `window.swarm`).

## Run

```bash
npm run serve:freedom-api-demo
# → http://127.0.0.1:8080/
```

Then open `http://127.0.0.1:8080/` in Freedom Browser.

Options:

```bash
node test/freedom-api-demo/server.js        # same as the npm script
PORT=3000 node test/freedom-api-demo/server.js
HOST=0.0.0.0 PORT=8080 node test/freedom-api-demo/server.js
```

Stop the server with `Ctrl+C`.

## What it covers

Each card drives one part of the surface (see `docs/FREEDOM_SPEC.md`):

1. **Detection & capabilities** — `navigator.freedom.version`, presence of
   `window.ethereum` / `window.swarm`, and `capabilities()`.
2. **Wallet** — `wallet.request('eth_requestAccounts')` then `personal_sign`.
3. **Storage** — `storage.upload({ network: 'swarm' })`. Only the Swarm path is
   exercised; IPFS write is not implemented yet (`capabilities()` reports it
   unavailable, and `network: 'ipfs'` rejects with `NotSupportedError`).
4. **dweb** — `dweb.resolve(name)` against a live ENS name.
5. **Permissions** — `permissions.query` / `permissions.request` for any name
   (e.g. `wallet.accounts`, `dweb.name-resolution`, `storage.ipfs.write`, or a
   bogus name to see the `TypeError`).

## Notes

- `wallet` and `storage.swarm` require **Identity & Wallet** enabled
  (Settings → Experimental; defaults on). With the gate off, calls surface as
  `NotAllowedError` and `capabilities()` reports `available: false`.
- This page intentionally ships **no restrictive CSP** so the browser-injected
  inline provider scripts run. A real-world site must allow those scripts in its
  own CSP for the providers to inject.
- `server.js` is a zero-dependency static file server (GET/HEAD only, with a
  path-traversal guard). It is a manual testing aid and is not part of the
  automated unit or e2e suites.
- The page logic is **shared verbatim** with the internal `freedom://playground`
  page: it lives in `src/renderer/pages/scripts/freedom-surface.js`, and
  `server.js` serves that single canonical copy at `/freedom-surface.js`. The
  script feature-detects which cards a page renders and picks the clipboard
  transport from the document protocol, so the same file drives both contexts.

## Files

- `index.html` — the demo page (markup + styles).
- `server.js` — the static HTTP server (also serves the shared `freedom-surface.js`).
