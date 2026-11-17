# Files manifest

Every file tracked in the repository, what it is for and what uses it.

## Application (served by GitHub Pages)

| File | Purpose | Used by |
| --- | --- | --- |
| `index.html` | Canvas, status bar, status help dialogue, admin panel, script order | The browser |
| `css/style.css` | Full-screen dark layout, status bar, dialogues, toasts, spinner | `index.html` |
| `js/local-storage.js` | Local stores for the terrain, biology, simulation time and token | `main.js`, `auth.js` |
| `js/terrain.js` | `TerrainGrid`: mesh, bedrock, sand, save format | All simulation modules, tests |
| `js/physics.js` | `PhysicsEngine`: water parcels and sediment | `main.js`, renderer, tests |
| `js/biology.js` | `BiologyGrid`: vegetation and microbes | `main.js`, renderer, tests |
| `js/renderer.js` | `TerrainRenderer`: Three.js scene | `main.js`, `controls.js` |
| `js/collaboration.js` | `CollaborativeSync`: Worker client | `main.js`, `auth.js` |
| `js/auth.js` | `AuthManager`, `ResetManager` | `main.js`, `ui.js` |
| `js/controls.js` | `InputControls`: keyboard and mouse | `main.js` |
| `js/ui.js` | `UIManager`, `initializeUI()` | `main.js` |
| `js/main.js` | `Application`: wiring and animation loop | `index.html` (last script) |

The scripts are not modules: they define globals and must load in the order of
`index.html`. Three.js r128 comes from `cdnjs.cloudflare.com`.

## Collaboration service (deployed to Cloudflare)

| File | Purpose |
| --- | --- |
| `worker/index.mjs` | Worker entry point (routing, CORS, OAuth, owner check) and the `Simulation` Durable Object |
| `worker/mesh.mjs` | Mesh constants and initial terrain, identical to `js/terrain.js`; sync interval formula |
| `wrangler.toml` | Worker name, entry point, public variables `GITHUB_CLIENT_ID` and `OWNER_GITHUB_ID`, Durable Object binding `SIMULATION`, migration `v1` |

The secret `GITHUB_CLIENT_SECRET` is **not** in the repository. It is set with
`npx wrangler secret put GITHUB_CLIENT_SECRET`.

## Tests

| File | Purpose |
| --- | --- |
| `tests/terrain-physics.test.js` | Terrain, physics, biology and colour tests (slow: about five minutes) |
| `tests/collaboration.test.js` | Sync client against a mocked `fetch` |
| `tests/auth.test.js` | OAuth flow and reset manager |
| `tests/ui.test.js` | Camera, controls, status bar, URL handling with DOM mocks |
| `worker/index.test.mjs` | Worker and Durable Object with an in-memory storage mock |

Run all of them with `npm test`. Browser scripts are loaded into `node:vm`
contexts, so no browser is needed.

## Configuration and deployment

| File | Purpose |
| --- | --- |
| `package.json` | Scripts (`test`, `dev`, `dev:http`, `lint`, `format`), dev dependencies, metadata |
| `.github/workflows/deploy.yml` | Publishes the repository root to GitHub Pages on every push to `main` |
| `.nojekyll` | Stops GitHub Pages from running Jekyll |
| `.gitignore` | Ignores `node_modules/`, `.vscode/`, `.wrangler/`, `secrets`, logs and build folders |
| `LICENSE` | MIT licence |

## Documentation

| File | Purpose |
| --- | --- |
| `README.md` | Reference: model equations, variables, usage, protocol, storage |
| `START_HERE.md` | Five-minute orientation |
| `SUMMARY.md` | One-page technical summary and history |
| `CODE_MAP.md` | Function-level map of the code |
| `FILES_MANIFEST.md` | This file |
| `README_DEV.md` | Development set-up and the rules for changing the mesh or save formats |
| `DEVELOPMENT.md` | Troubleshooting |
| `DEPLOYMENT.md` | Deployment of the site and the Worker |
| `PERFORMANCE.md` | Measured costs and optimisation options |
| `CONTRIBUTING.md` | Contribution guide |
| `PROJECT_CHECKLIST.md` | Status, limitations and open work |
| `.DEPLOYMENT_STATUS.txt` | Deployment configuration recorded in the repository and checks to run |

## Removed files

The first version stored the shared terrain in `data/terrain.json`, through
`js/github-sync.js`, and had a 64 × 64 grid solver in `worker/physics.mjs`. None
of these files was loaded any more, so they were removed on 2026-11-17. The git
history keeps them.
