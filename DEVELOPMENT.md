# Troubleshooting

Symptoms, their cause in the code, and what to do. Open the browser console first
(F12, or ⌥⌘I on a Mac): every failure below also logs a message there.

## Start-up

### "✗ Initialization failed" and nothing moves

`Application.initialize()` stops if a biology save exists but cannot be read,
for example after a format change or a corrupt value. The console shows *Could
not load local biology*. Delete the key `tree-of-life-local-biology-v2` in
DevTools → Application → Local Storage, then reload.

### "Error initializing application" on a red panel

The constructor itself failed. The most common cause is Three.js not loading
from cdnjs (offline, or blocked by an extension). Check the Network tab for
`three.min.js`.

### My terrain or particles were not restored

The local terrain save is ignored, with a console warning, when:

- it is older than 24 hours;
- its mesh signature differs (*Saved terrain is incompatible with the circular
  mesh*);
- it lies below the bedrock, erodes the surround, or puts sand in the channel.

In every case the next sync replaces the bed with the shared terrain anyway. The
terrain is saved only when a new shared version arrives or after a reset, not
continuously.

### "Could not save local biology" or "Could not save simulation time"

`localStorage` is full or disabled (private browsing, blocked site data). The
terrain save is about 1.5 million characters and the biology about 0.7 million,
close to the usual 5-million-character quota per origin. Clear the site data and
reload.

## Collaboration

### "Collaboration unavailable: …" on a local server

This is expected. The Worker allows only the
`https://laurentperrinet.github.io` origin, so sync fails on `localhost`. The
simulation keeps running locally.

### "Incompatible terrain mesh; reload the application" (HTTP 409)

The page and the Worker use different mesh signatures. Usually one was deployed
without the other. Deploy both (see [DEPLOYMENT.md](DEPLOYMENT.md)), then reload
the open tabs. *Collaboration Worker returned an incompatible terrain mesh* is the
same problem, detected in the browser.

### "This browser does not support compressed collaboration updates"

`CompressionStream` is missing (very old browsers). The first sync carries no
delta and still downloads the shared terrain. Every later sync must compress a
delta and fails, so the browser neither contributes nor receives updates. Use a
current browser.

### The next sync is hours away

After failures, `CollaborativeSync.schedule()` doubles the interval each time, up
to 6 hours. A successful sync resets it. With many active browsers, the normal
interval also grows above 5 minutes (see the README, section 1.3). Browsers may
also delay timers in background tabs.

### **S** says "Sync is already rate-limited"

A manual sync never bypasses the interval returned by the Worker.

## Sign-in and reset

### "GitHub sign-in unavailable" or "requires a configured OAuth Worker and HTTPS callback"

`AuthManager.isConfigured()` requires the page to be exactly
`https://laurentperrinet.github.io/2026-11_tree-of-life/`. Sign-in cannot work from
`localhost` or `file://`.

### "GitHub sign-in failed: invalid OAuth state"

The `state` saved before the redirect is missing or different. This happens when
the callback opens in another tab, or after session storage was cleared. Sign in
again from the same tab.

### "GitHub token exchange failed (503)"

The Worker lacks `GITHUB_CLIENT_ID` or the secret `GITHUB_CLIENT_SECRET`. Set it
with `npx wrangler secret put GITHUB_CLIENT_SECRET`.

### "✗ Reset failed"

The console shows the Worker's answer:

- **401**: invalid or expired token; sign out and in again.
- **403**: the account is not `OWNER_GITHUB_ID`.
- **503**: `OWNER_GITHUB_ID` is not configured.

Local state is left unchanged when the Worker refuses.

## Performance

### Low frame rate, or simulation time advancing slowly

One physics step runs per frame and costs tens of milliseconds (see
[PERFORMANCE.md](PERFORMANCE.md)). Simulated time per wall-clock second is
therefore proportional to the frame rate. Every display mode other than
`elevation` skips the biology overlay, which saves its colour update.

## Editor

### VS Code tries to start a Python interpreter or linter

This is a JavaScript-only project. Disable the Python extensions for this
workspace, for example with `"python.linting.enabled": false` in a local
`.vscode/settings.json`. The `.vscode/` folder is not tracked.

### `npm run lint` fails with "No ESLint configuration found"

No ESLint configuration is committed yet. Add one (for example
`eslint.config.js`) before using the script.
