# Tree of Life: technical summary

One page for readers who want the essentials without the equations.
The full model is in [README.md](README.md).

## What it is

A static web application (GitHub Pages) and a Cloudflare Worker.

- **In each browser**, a Lagrangian particle model erodes a sandy bed on a
  50,264-vertex polar triangular mesh. A reaction–diffusion model of vegetation
  and microbes grows on a 256 × 256 grid. Everything is rendered with Three.js
  r128.
- **On Cloudflare**, a Worker with one SQLite-backed Durable Object keeps the
  shared bed elevation. It averages the elevation changes that browsers submit,
  at most one per browser and terrain version. It also exchanges GitHub OAuth
  codes and lets the owner reset the terrain.

## Key numbers

| Quantity | Value |
| --- | --- |
| Erodible disk / square surround | radius 25 u / half-side 30 u |
| Mesh | 50,264 vertices (48,696 erodible), 99,742 triangles, 125 rings, spacing 0.2 u, jitter 0.02 u |
| Water parcels | 1,500, radius 0.105 u, volume 0.02 u³ each |
| Time step | 0.04 sim s per animation frame, in 2 substeps |
| Initial sand | 0.3 u, none on the outlet channel bed |
| Biology grid | 256 × 256, spacing ≈ 0.196 u, runs 5× faster than the water |
| Sync interval | max(5 min, active browsers × 2 × 1 day / 80,000) |
| Shared data | one elevation per vertex: float64 in the Durable Object (≈ 0.4 MB), JSON numbers in responses; uploads are gzip-compressed float32 deltas |

## Data flow

```text
   frame loop (js/main.js)
   ├─ PhysicsEngine.step()        parcels move, exchange sand, avalanches, recycling
   ├─ BiologyGrid.step(dt)        flow memory every frame, colonies every ≥ 0.16 sim s
   ├─ TerrainRenderer.update…()   positions, normals, colours, parcels
   └─ UIManager.updateStatus()    at most once per second

   CollaborativeSync (timer, ≥ 5 min)
   └─ POST /api/sync  ── delta = elevation − base ──► Worker
                       ◄── version, interval, terrain if newer ──
```

## Design choices

- **Particles rather than a grid solver.** Parcels on a triangulated bed are
  robust, conserve sand exactly, and show the flow directly. The price is
  realism: there is no water depth equation, and pressure is a soft repulsion.
- **Polar mesh.** Rings with about constant spacing and a half-sector shift give
  near-equilateral triangles without the grid directions of a square lattice. A
  small deterministic jitter removes the remaining cardinal alignments.
- **Share elevation only.** Elevation is the slow, meaningful variable. Averaging
  it is simple and bounded. Water and biology are fast, local and decorative.
- **Request budget.** The interval grows with the number of active browsers, to
  target 80,000 sync-related requests per day for the whole population.

## Limitations

- Not a validated morphodynamic model; the parameters are tuned by eye.
- Remote merges replace the local bed and break the local sand balance.
- Contributions are anonymous; averaging limits but does not prevent abuse.
- One physics step per frame: simulated time per wall-clock second depends on the
  device's frame rate. The physics and biology alone cost about 75 ms per frame
  on a recent CPU (see [PERFORMANCE.md](PERFORMANCE.md)).
- Particles use `Math.random()` without a seed, so runs are not reproducible.

## History

| Date | Milestone |
| --- | --- |
| 2026-11-16 | First version: 64 × 64 shallow-water grid, terrain committed to `data/terrain.json` through the GitHub API; first Cloudflare Worker |
| 2026-11-17 | Lagrangian particle model and sand avalanches replace the grid solver |
| 2026-11-17 | Funnel bed with flared outlet channel; polar triangular mesh; circular drainage basin and vegetation |
| 2026-11-17 | Microbial colonies; collaboration through the Worker with per-version averaging |
| 2026-11-17 | Evaporating parcels recycle water and deposit their sediment |
| 2026-11-17 | Energy convergence replaced by transit time and particle flow; bottom status bar; public display modes |
| 2026-11-17 | Sand-free outlet channel, jittered mesh; the legacy grid and GitHub-sync code is removed |
