# Code map

Where each mechanism lives. The symbols are those of [README.md](README.md),
section 1. Line numbers are omitted on purpose because they drift; search for the
method name instead.

## Start-up and frame loop: `js/main.js`

`Application`

- `constructor()` builds, in order: `TerrainGrid` → `PhysicsEngine` →
  `BiologyGrid` → `TerrainRenderer`. Then the stores (terrain, biology,
  simulation time) and `CollaborativeSync`. Then `AuthManager` (client ID,
  callback URL and Worker exchange URL are hard-coded here), `ResetManager`,
  `UIManager` and `InputControls`.
- `initialize()` runs the OAuth callback or restores the session, loads the local
  terrain, then the local biology. Without a biology save, it imports the legacy
  biology or starts fresh. It then runs a first sync (failures only show a toast),
  builds the meshes and starts `animate()`.
- `animate()` makes one `physics.step()` per `requestAnimationFrame`, then
  `biology.step(dt)`. Every 5 s it saves the biology and the simulation time. It
  then updates the renderer and the status bar.
- `handleUrlParams()` handles `?reset=1[&hard=1]` one second after start-up, owner only.

## Terrain: `js/terrain.js`

`TerrainGrid`

| Task | Method or field |
| --- | --- |
| Build rings, triangles, square surround | `constructor()` (ring loop, seam-closing merge of two sorted rings) |
| Jitter the disk vertices ($j$, seed) | `jitterOffset(index)` with the module function `hashUint32` |
| Bedrock $\beta$: cone, peripheral band, channel | `bedrockHeight(x, z, …)` |
| Sand factor $\phi$ | `sandDepthFactor(x, z)`, `sandDepthFactorAt(i)` |
| Initial sand, reset of per-vertex fields | `initialize()` |
| Lumped areas $A_i$, unique edges, spatial bins | `vertexArea`, `edges`, `bins` (built in the constructor) |
| Point location and barycentric weights | `locate(x, z)` |
| Interpolated height and slope $\nabla\eta$ | `sample(x, z)` |
| Mesh signature, save, load and migration | `meshSignature()`, `toJSON()`, `fromJSON(json)` |
| Legacy per-vertex microbes | `seedMicrobes()`; `microbeSuitability()` is not called |

`erodibleCount` is the index of the first edge-ring vertex. Vertices below it are
erodible. `regularVertices` keeps the positions before the jitter, so that old
saves can be read.

## Water and sediment: `js/physics.js`

`PhysicsEngine`

| Task | Method |
| --- | --- |
| Step size, substeps, projection to $h_i$, $c_i$, $\mathbf{u}_i$ | `step()` |
| Gravity, friction, speed cap, sediment exchange, walls, sink | `moveParticle(particle, dt)` |
| Burst hazard and fade | `updateParticle(particle, dt)` |
| Deposit of an evaporated load | `depositEvaporatedSediment(particle)` |
| Soft pressure between parcels (spatial hash of size $2a$) | `collideParticles(dt)` |
| Angle-of-repose avalanches (4 sweeps) | `relaxSand(dt)` |
| Erosion fade near the edge $e_j$ | `erosionFactor(index)` |
| Reinjection inside the polygon edge | `reinject(particle)`, `arcBoundary(angle)` |
| Initial parcels spread over the disk | `createParticles()` |
| Transit time and particle flow | `recordSinkExit()`, `getMeanTransitTime()`, `getParticleThroughput()`; `getSandThroughput()` is tested but not displayed |
| Reset parcels, statistics and terrain | `reset()` |

## Biology: `js/biology.js`

`BiologyGrid`

| Task | Method |
| --- | --- |
| Map grid cells to mesh triangles (`faces`, `weights`, `active`) | `constructor(terrain)` |
| Seed patches $\Sigma$ and initial $U$, $V$ | `reset()` |
| Interpolate a vertex field at a cell | `terrainValue(i, values)` |
| Sand mask $m$ | `updateSand()` |
| Flow memory $F$, colony timer | `step(dt)` |
| Dilations $N$, $N_P$, habitat $H$, bank $B$, Euler steps of $P$, $I$, $U$, $V$ | `updateColonies(dt)` |
| Import the former per-vertex biology | `importLegacy()` |
| 16-bit base64 save | `toJSON()`, `fromJSON(json)` |

## Rendering: `js/renderer.js`

`TerrainRenderer`

| Task | Method |
| --- | --- |
| Scene, top-down camera, lights | `constructor(canvas)`, `onWindowResize()` (keeps the disk in view on portrait screens) |
| Terrain geometry and colours per display mode | `createTerrainMesh()`, `updateTerrainMesh()`, `updateTerrainColors()` |
| Biology overlay (`elevation` mode only) | `createBiologyMesh()`, `updateBiologyMesh()`, `volcanicColor()` |
| Sand-depth colour map | `deepColor(t)`, `TerrainRenderer.DEEP`, `SAND_DEPTH_DISPLAY_MAX` |
| Instanced parcels with a burst shader patch | `updateParticles(physics)` |
| Mode order | `cycleDisplayMode()` |

## Collaboration: `js/collaboration.js`

`CollaborativeSync`

| Task | Method |
| --- | --- |
| Random browser ID in `localStorage` | `getClientId()` |
| One request: delta, headers, response | `performSync()` (wrapped by `sync()`, which de-duplicates calls in flight) |
| gzip with `CompressionStream` | `compress(delta)` |
| Validate the response, adopt a new version, save locally | `applyState(data)` |
| Timer, interval, exponential backoff | `start()`, `schedule()`, `stop()` |
| Manual sync (**S**), never under the interval | `syncNow()` (alias `fetchAndMerge()`) |
| Owner reset | `reset(token)` |
| Status bar values | `getSecondsSinceSync()`, `getSecondsUntilSync()` |

`recordChange()` is an empty hook left from the GitHub version.

## Authentication and reset: `js/auth.js`

- `AuthManager`: `login()` stores a random `state` and redirects to GitHub.
  `initialize()` checks `state` on return, then `exchangeCode()` posts the code
  to the Worker. `fetchUser()` verifies the token with `api.github.com/user`.
  `canReset()` compares the login with `laurentperrinet`. `isConfigured()`
  requires HTTPS and an exact callback URL match.
- `ResetManager`: `softReset()` calls the Worker reset, then resets the physics
  and biology and saves both. `hardReset()` is the same operation behind a
  confirmation flag. `getStatus()` is not called.

## Interface: `js/ui.js`, `js/controls.js`, `index.html`, `css/style.css`

- `UIManager.updateStatus()` updates the six indicators at most once per second.
  `updateAdminPanel()` shows the panel with `?admin`, and the controls once signed
  in. `confirmReset()` needs a second **R** within 3 s.
- `InputControls.onKeyDown()`: **D** for everyone. The other keys need sign-in
  and `?admin`. Mouse drag orbits, the wheel zooms (10–100 u), and the camera
  always looks at the origin.
- `index.html` holds the status bar, the help dialogue (its text duplicates the
  README status table) and the script order.

## Persistence: `js/local-storage.js`

- `LocalStorageManager(key, maxAgeHours)`: JSON wrapper with a format version and
  an age limit. Terrain: 24 h. Biology: no limit.
- `SimulationTimeTracker`: one key per tab (`…-v1:<uuid>`). `getTotal()` sums all
  tabs.
- `SessionStorageManager`: the GitHub token.

## Worker: `worker/index.mjs`, `worker/mesh.mjs`

| Task | Function |
| --- | --- |
| Routing, CORS (GitHub Pages origin only) | default export `fetch(request, env)` |
| OAuth code exchange (uses `GITHUB_CLIENT_SECRET`) | `exchangeCode()` |
| Owner check by numeric GitHub ID | `authenticateOwner()` |
| Size-limited body and gzip decoding | `readStreamLimited()`, `readDelta()` |
| Load, migrate or recreate the state | `Simulation.loadState()` |
| Heartbeat, activity, validation, accumulation | `Simulation.sync()` |
| Mean of the deltas, new version | `Simulation.finalizeContributions()` |
| Response body | `Simulation.stateResponse()` |
| Mesh, bedrock and sand mirrored from the browser | `createInitialMesh()`, `meshJitter()`, `hashUint32()`, `channelSandFactor()` |
| Sync interval | `getSyncIntervalMs()` |

## Tests

| File | Covers |
| --- | --- |
| `tests/terrain-physics.test.js` | Mesh geometry and jitter, bedrock and channel, sand conservation, avalanches, recycling, save migrations, biology, colours |
| `tests/collaboration.test.js` | Deltas once per version, mesh mismatch, intervals, countdown, reset during sync |
| `tests/auth.test.js` | OAuth `state`, callback, admin view, reset failure handling |
| `tests/ui.test.js` | Camera, display modes, status bar, simulation time, URL resets |
| `worker/index.test.mjs` | Browser and Worker build the same mesh, migrations, averaging, validation, owner reset, CORS |
