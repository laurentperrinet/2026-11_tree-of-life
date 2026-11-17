# Development guide

How to work on the code without breaking the shared terrain. For the model
itself, see [README.md](README.md). For problems, see
[DEVELOPMENT.md](DEVELOPMENT.md).

## Set-up

- Node.js 20 or later, needed only for the tests and the local servers.
- Git.
- For the Worker, a Cloudflare account and `npx wrangler` (see
  [DEPLOYMENT.md](DEPLOYMENT.md)).

```bash
git clone https://github.com/laurentperrinet/2026-11_tree-of-life.git
cd 2026-11_tree-of-life
npm install            # optional: dev tools only (eslint, prettier, serve, http-server)
```

## Running locally

Serve the folder over HTTP; `file://` breaks relative assets and browser APIs.

| Command | URL |
| --- | --- |
| `npx http-server -p 8000 -c-1` | <http://localhost:8000> (no cache) |
| `npm run dev:http` | <http://localhost:8080> (opens the browser, no cache) |
| `npm run dev` | <http://localhost:3000> (`serve`) |
| `python3 -m http.server 8000` | <http://localhost:8000> |

A local page simulates stand-alone. The Worker accepts only the GitHub Pages
origin, and the OAuth callback is the production URL, so sync and sign-in fail
with a warning toast. The physics, biology and display all work. For debugging,
`window.app` exposes the running `Application`. For example,
`app.physics.timeScale = 3` or `app.renderer.displayMode = 'flux'` in the
console.

## Tests

```bash
npm test                                   # everything, about five minutes
node --test tests/collaboration.test.js    # one file
node --test --test-name-pattern="avalanche" tests/terrain-physics.test.js
```

The browser scripts are evaluated in `node:vm` contexts with minimal DOM, storage
and `fetch` mocks. The Worker is imported directly and driven with a mocked
Durable Object storage. No test runs Cloudflare or GitHub for real.

## Conventions

- Plain ES2020 browser scripts, no bundler and no runtime dependency. Each file
  defines globals used by the files after it in `index.html`.
- Comments, docs and identifiers in new prose use international English with
  British spelling (colour, centre, behaviour). Existing code identifiers keep
  their spelling, such as `initialize()`.
- Docstrings follow the `Args:` / `Returns:` style with units in brackets, as in
  `jitterOffset()`.
- Use `Float64Array` for the bed (conservation is checked to 1e-9 in the tests)
  and `Float32Array` for biology.
- `npm run lint` and `npm run format` exist, but no ESLint or Prettier
  configuration is committed: add one before relying on them.

## Changing a parameter

Model parameters are fields set in the constructors (`TerrainGrid`,
`PhysicsEngine`) or literals in `BiologyGrid.updateColonies()`. When you change
one:

1. Update the equations and variable tables in [README.md](README.md), section 1,
   in the same commit.
2. If it is a **terrain** parameter (anything that changes vertex positions,
   bedrock or initial sand), apply the rules below.
3. Run `npm test`. Several tests check physical invariants: conservation,
   channel without sand, no erosion of the surround.

## Changing the mesh or the initial terrain

The browser (`js/terrain.js`) and the Worker (`worker/mesh.mjs`) build the same
mesh independently. They must agree bit for bit; the test *browser and Worker
initialize the same higher-resolution terrain* checks it.

1. Change the constant in **both** files (`this.radius` ↔ `MESH_RADIUS`, etc.).
2. Change the **mesh signature** in both files (`meshSignature()` and
   `MESH_SIGNATURE`). Add a tag (such as `'jitter-v1'`) when the geometry or
   profile changes without a dimension change.
3. Decide whether existing terrains are **migrated** or **reset**:
   - Browser: `TerrainGrid.fromJSON()` accepts formats `10.0`–`13.0`. Bump
     `toJSON().version` and add a branch to `savedBedrock()` if the old bedrock
     must be reconstructed.
   - Worker: `Simulation.loadState()` migrates schemas 2 and 3 and resets on any
     other mismatch. Bump `STATE_SCHEMA_VERSION` and add a migration if sand must
     survive.
4. Keep randomness deterministic and integer-based (`hashUint32`). Trigonometry
   or `Math.random()` would make the browser and the Worker disagree.
5. Deploy the Worker and the site together. Older open tabs receive a 409 and must
   reload.

## Save formats

| Data | Writer | Format | Compatibility |
| --- | --- | --- | --- |
| Local terrain | `TerrainGrid.toJSON()` | `version: '13.0'`, `topology`, `meshSignature`, arrays, particles | Reads `10.0`–`13.0`. Accepts 500 or 1,000 saved parcels and adds parcels up to 1,500 |
| Local biology | `BiologyGrid.toJSON()` | `version: 1`, `size: 256`, base64 of four 16-bit fields | Exact match only |
| Store wrapper | `LocalStorageManager.save()` | `{ version: '1.0', savedAt, data }` | Version must match; terrain expires after 24 h |
| Shared state | `createState()` in the Worker | `schemaVersion: 4`, `meshSignature`, float64 arrays, contributions | Migrates 2 and 3 |

`fromJSON()` rejects, with a console warning, any save whose elevation lies below
the bedrock or erodes the surround. It also rejects saves that add sand to the
channel, or that hold non-finite values or invalid particles.

## Randomness

Parcel creation, reinjection angles and burst times use `Math.random()` without a
seed, so two runs never match. The mesh jitter and the microbe seed patches are
deterministic hashes. Tests therefore check invariants and statistics, not exact
trajectories. Making the particles reproducible would need a seeded generator
in `PhysicsEngine`.
