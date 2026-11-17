# Project checklist

Status on 2026-11-17. Each item marked done is covered by the code and, where
noted, by a test.

## Done

### Terrain

- [x] Polar triangular mesh with staggered rings, square surround, deterministic
  jitter (tests: geometry, positive areas, jitter bound, browser = Worker)
- [x] Inverted-cone bedrock with peripheral drainage band and flared outlet channel
- [x] Sand-free channel bed and flanks (tests: initial terrain, no deposit there)
- [x] Save format `13.0` with migration from `10.0`–`12.0`, and mesh-signature
  checks

### Physics

- [x] 1,500 Lagrangian water parcels with gravity, friction, speed cap and wall
  reflection
- [x] Soft parcel–parcel pressure
- [x] Speed-dependent transport capacity, erosion fading near the edge
- [x] Angle-of-repose avalanches
- [x] Sink recycling with load; evaporation that deposits its load
- [x] Exact conservation of sand plus load (test: closed cycle and reload)
- [x] Transit time and particle flow indicators

### Biology

- [x] Vegetation with inhibitor on wet banks (tests: growth, crowded centres)
- [x] Gray–Scott microbes restricted to calm sandy habitat, with recovery
  after extinction
- [x] Visitor-local 16-bit save, independent of the shared terrain

### Collaboration and administration

- [x] Cloudflare Worker with SQLite-backed Durable Object
- [x] Per-version averaging of gzip-compressed deltas, one per browser
- [x] Adaptive interval toward 80,000 requests per day; exponential backoff
- [x] Validation of contributions (size, finiteness, bounds, surround)
- [x] Migration of Worker schemas 2 and 3; reset on other mesh changes
- [x] GitHub OAuth through the Worker; owner-only reset checked server-side
- [x] Public display modes; admin controls behind `?admin` and sign-in

### Documentation

- [x] README with equations and variable tables matching the code
- [x] Guides for start-up, development, troubleshooting, deployment, performance
- [x] Legacy GitHub persistence and grid solver removed

## Known limitations

- The model is exploratory and uncalibrated; branching is not guaranteed.
- Adopting a new shared version replaces the local bed. Local erosion since the
  last accepted submission is lost, and the local sand balance breaks.
- Contributions are anonymous. The request budget is a client-side target,
  not a quota.
- Particle randomness is unseeded, so runs are not reproducible.
- Physics and biology cost about 75 ms per frame. Simulated time depends on the
  device's frame rate.
- No touch controls; desktop mouse and keyboard only.
- `npm run lint` and `npm run format` have no committed configuration.
- Sync and sign-in cannot be tested from `localhost`.
- The status-help text in `index.html` duplicates the README and must be kept in
  step by hand.
- Small unused methods remain: `TerrainGrid.microbeSuitability()`,
  `ResetManager.getStatus()`, `CollaborativeSync.recordChange()`,
  `SessionStorageManager.hasToken()`, `LocalStorageManager.isAvailable()` and
  `LocalStorageManager.clear()`.

## Open work

- [ ] Seed the particle generator, for reproducible runs and parameter scans
- [ ] Make sand relaxation cheaper (see [PERFORMANCE.md](PERFORMANCE.md))
- [ ] Move the simulation to a Web Worker
- [ ] Touch gestures (orbit, pinch zoom)
- [ ] Quantitative branching measures: channel count, drainage density, bifurcation
  ratios
- [ ] Rebase local changes on a new shared version instead of replacing them
- [ ] Cloudflare-side rate limiting for the public endpoints
- [ ] End-to-end test against a deployed Worker (for example `wrangler dev`)
- [ ] ESLint and Prettier configuration
- [ ] Remove or use the unused methods listed above
