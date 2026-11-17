# Performance

## How time advances

`Application.animate()` takes **one** physics step per `requestAnimationFrame`.
With the defaults, the step is $\Delta t = 0.04$ sim s, split into 2 substeps. The
simulation therefore advances $0.04 \times$ (frames per second) sim s per
wall-clock second. A slow device does not lose accuracy, but its simulation runs
more slowly. The **+**/**-** and **↑**/**↓** controls lengthen the step, and the
number of substeps grows with it, so they do not make a frame cheaper.

## Measured cost

Measured on 2026-11-17 by running the browser modules under Node.js 26 (V8) on one
core of an Apple M3 Ultra. The code is single-threaded, the mesh jittered, and
the averages are over 40 calls. Browsers use the same V8 or a comparable
engine; rendering comes on top.

| Operation | Time | Per frame |
| --- | --- | --- |
| `PhysicsEngine.step()` (2 substeps) | 48 ms | 48 ms |
| of which `relaxSand()` (4 sweeps × 150,005 edges) | 18 ms per substep | ≈ 36 ms |
| of which `collideParticles()` | 1.3 ms per substep | ≈ 3 ms |
| `BiologyGrid.step()`, averaged | 26 ms | 26 ms |
| of which `updateColonies(0.16)` | 97 ms, every 4th frame | ≈ 24 ms |
| `new TerrainGrid()` | 270 ms | once |
| `new BiologyGrid()` | 90 ms | once |

Physics and biology alone take about **75 ms per frame**, so the frame rate is
at most about 13 frames per second before rendering. Rendering adds, every
frame:

- the upload and `computeVertexNormals()` of the 50,264-vertex terrain;
- in `elevation` mode, the same for the 65,536-vertex biology overlay;
- 1,500 calls to `sample()`, which places the parcels on the bed.

To reproduce, load `js/terrain.js`, `js/physics.js` and `js/biology.js` into a
`node:vm` context, as `tests/terrain-physics.test.js` does, and time the calls
with `performance.now()`. In the browser, use DevTools → Performance and look
for `step`, `relaxSand`, `updateColonies` and `updateTerrainMesh`.

## Where the time goes

1. **Sand relaxation.** Four full sweeps over all edges in every substep, even
   where no slope exceeds the angle of repose. It is the largest single cost.
2. **Colony update.** About 18 passes over 65,536 cells every 0.16 sim s: 4 flow
   dilations, 12 plant dilations, then one habitat pass and one Euler pass.
3. **Geometry upload.** Normals and colours are recomputed for every vertex every
   frame.
4. **Point location.** `locate()` scans the triangles of a 1 u bin and builds a
   string key for each lookup, several times per parcel per substep.

## Options, from cheapest to most involved

| Option | Expected gain | Caveat |
| --- | --- | --- |
| Run `relaxSand()` once per frame, or on edges near recent changes only | Up to ~30 ms per frame | Steeper transient slopes; check the avalanche tests |
| Cache each parcel's triangle and walk to neighbours instead of `locate()` | Several ms | More state per parcel |
| Integer bin keys instead of template strings | A few ms | — |
| Update normals and colours every second or third frame | Several ms of rendering | Slightly delayed visuals |
| Move physics and biology to a Web Worker | Frees the main thread | Needs transferable buffers for elevation and parcels |
| Several physics steps per frame on fast devices | Faster simulated time | Costs proportionally more CPU |
| WebGL/WebGPU compute for biology | Large | Major rewrite |

None of these is implemented. Any change to the order of operations can alter
sediment conservation; `npm test` checks it.

## Network and storage

- A sync uploads a gzip-compressed float32 delta: 201,056 bytes before
  compression, much less when most vertices did not change. The upload limit is
  300,000 bytes.
- A response that includes the terrain carries about 0.9 MB of JSON. Heartbeats
  at the current version omit it.
- Local saves are about 1.5 million characters (terrain) and 0.7 million
  (biology).
