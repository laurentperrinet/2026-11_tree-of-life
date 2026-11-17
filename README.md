# 🌊 Tree of Life - Collaborative Hydromorphodynamic Simulation

> **Current collaboration protocol:** The browser keeps the triangular-mesh
> physics local and sends only per-vertex elevation deltas to the Cloudflare
> Worker. The Worker averages one contribution per browser ID for each shared
> terrain version. Water, sediment, particles, vegetation and microbes remain
> local to each browser. A browser ID is counted as active for 24 hours.
> Synchronization is scheduled toward an 80,000-request daily target, with a
> five-minute minimum interval. This is an application-level target, not a hard
> Cloudflare quota or protection against arbitrary direct requests.

## Current browser simulation

The browser models an erodible circular bed within a fixed square surround.
Its solid base forms an inverted cone of radial slope 0.09, except for a
channel that widens towards the bottom of the square and slopes down from the
centre to the sink. Initially the bed is covered by a uniform layer of sand
0.3 simulation units deep. The outer ring and square surround cannot be eroded,
but can receive sediment left by evaporating water. The circular edge is a polygon whose
vertices lie on the disk boundary. The black, non-erodible surround rises
outwards so water on it flows back towards the disk; the outlet channel remains
open and slopes down to the sink.

Blue spheres represent 1,500 water parcels, each carrying the same volume as
before. Older 500- or 1,000-parcel saves retain their water and sediment and
receive additional sediment-free parcels. Gravity follows the
local slope of each triangle, with friction. The square boundary reflects water
except at the sink in the middle of its bottom edge. On reaching the sink, each
parcel is reintroduced three mesh rings inside the disk at a uniformly random angle,
retaining its sediment. Independently of the sink, each parcel has a constant
random hazard of bursting (mean waiting time 90 simulation time units). It
turns white and fades for 0.8 simulation time units, then is reinjected with
no sediment. The sand is deposited on the mesh where the parcel evaporated,
including on the fixed surround. Pausing the
simulation also pauses this process.
Parcels can also move over the fixed surround, but
cannot exchange sand with it. The initial
parcels are distributed across the bed so the flow is immediately visible.
Transport capacity increases with speed: moving parcels pick up sand when
below capacity, and slowing or stationary parcels deposit their load. Parcels
erode progressively less across the outermost two simulation units of the
disk, reaching zero at the fixed boundary; deposition remains unrestricted.
Parcels
push one another when they overlap; this approximate water pressure helps
spread accumulations and keep water moving towards the sink. Collision impulses
can deflect particles. The evolving
bed affects subsequent paths, so flow can concentrate in eroded channels.
Sand also avalanches between neighboring mesh vertices when the slope along an
edge exceeds an angle of repose of 34 degrees. These local transfers conserve
sand volume and never remove the underlying bedrock. This is a simplified
granular relaxation, not a full model of wet sand or fluid mechanics.
A fixed, sloping non-erodible layer limits erosion at each vertex; sediment
can still accumulate on it inside the disk. Bed
volume plus carried sediment is conserved by these exchanges and by recycling.

`+`/`-` adjust the circulation rate and the arrow keys adjust simulation speed;
`D` switches between elevation, sand depth, flow and sediment views. This is a simplified
particle model: it does not solve the shallow-water equations or model
realistic fluid dynamics, and branching is not guaranteed. Remote terrain merges,
if configured, are external modifications and do not conserve this local
sediment balance.

The terrain uses a polar mesh with staggered, variable-density rings and
approximately hexagonal spacing inspired by sunflower seed patterns. It has
over 4,096 vertices and the `disk-square-polar-v1` save topology; saves
from older meshes are not loaded. Version 10 saves are migrated by raising
only the fixed surround, preserving the sand and particle state.
Test the browser model with `node --test tests/terrain-physics.test.js`.

## Cloudflare collaboration Worker

The Worker stores the shared elevation array for the browser's
`disk-square-polar-v1` mesh in a SQLite-backed Durable Object. Its
`worker/mesh.mjs` initialization mirrors the mesh vertex order and initial
bedrock/sand profile used by `js/terrain.js`.

Each browser has a random local ID. A single `POST /api/sync` request both
submits a compressed elevation delta and returns the latest shared state.
Submissions include a terrain version; the Worker accepts at most one per
browser and version. After an adaptive collection interval, it applies the
arithmetic mean of the accepted elevation deltas per vertex. A stale
contribution is discarded and the browser receives the newer terrain instead.
Collaborator IDs expire after 24 hours without a sync.

The interval is `max(5 minutes, active browsers × 2 × 86,400,000 ms / 80,000)`,
rounded up to a whole millisecond. The factor of two conservatively budgets a
possible CORS preflight plus the sync request. This targets no more than 80,000
sync-related Worker requests/day for a stable, accurately observed
active-browser count. OAuth, reset and other requests are outside that
calculation, and public Worker traffic cannot be capped by this client schedule
alone. Configure Cloudflare-side abuse and quota controls before relying on a
strict ceiling.

Endpoints:

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | Read the current shared elevation and version |
| `POST /api/sync` | Submit one compressed elevation delta and receive shared state |
| `POST /api/auth/exchange` | Exchange a GitHub OAuth authorization code |
| `POST /api/admin/reset` | Reset the terrain as the GitHub owner |

Administration uses a bearer token verified against GitHub's `/user` endpoint
and the configured numeric `OWNER_GITHUB_ID`. The OAuth exchange requires
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Worker bindings; the secret
must never be committed or placed in browser code. The frontend must generate
and verify a cryptographically random OAuth `state` before exchanging the code,
use the exact GitHub Pages callback URL, and handle expired tokens. The
frontend verifies OAuth `state` and uses the exact GitHub Pages callback. To
enable sign-in, the Worker at
`https://2026-11-tree-of-life.laurent-perrinet.workers.dev` must have
`GITHUB_CLIENT_SECRET` configured as a Cloudflare secret (never in source
code). The frontend points to its `/api/auth/exchange` endpoint.
Sign-in requires the GitHub Pages origin; `file://` and localhost cannot use
the configured callback. A contribution is anonymous and is not independently
verified; averaging reduces the influence of a single submission but does not
make public input trustworthy. The Worker shares elevation only; it does not
claim to average the complete physical state.
The deployment needs a Cloudflare account, the Durable Object binding in
`wrangler.toml`, and the three configuration values above. No secret
should be shared in chat. Do not deploy this prototype as a production service.

Run the local tests from the project root:

```bash
npm test
```

These tests use local mocks, not the Cloudflare runtime or a deployed OAuth
application. Browser-to-Worker behavior still needs end-to-end validation after
the Worker code is deployed. The older `tests/terrain-physics.test.js` suite
covers a different browser-model snapshot and is not included in this targeted
protocol test command.

An interactive web-based simulation of water-driven terrain erosion creating natural branching patterns, inspired by the "Tree of Life" photograph from Iceland. Browsers contribute elevation changes to shared terrain through a Cloudflare Worker.

The current simulation is an exploratory particle model, not a validated hydrodynamic solver.
In the elevation view, vegetation grows rapidly on sandy ground near sustained
water flow but away from its strongest paths. Its reaction–diffusion model
suppresses crowded centers while colony edges continue to grow.
Ochre-to-purple microorganisms form a separate Gray–Scott reaction–diffusion
pattern on sandy, low-flow ground between plants and spread farther than the
vegetation. New colonies start as diffuse,
faint patches that concentrate as the reaction develops. Both use a 256×256
biological grid finer than the terrain mesh. Each visitor's biology is saved
locally between visits and is never synchronized with shared terrain; resetting
the terrain also resets that visitor's biology.

## 🎯 Quick Start (5 Minutes)

### For Users
Just visit: **https://laurentperrinet.github.io/2026-11_tree-of-life/**
- Observe water parcels eroding and depositing sediment
- The initial view looks straight down at the center of the disk; drag or scroll to adjust it
- Open [the admin view](https://laurentperrinet.github.io/2026-11_tree-of-life/?admin)
  and sign in with GitHub to access the control panel and keyboard shortcuts.
  The URL itself grants no permissions; resetting still requires the authorized
  GitHub owner.

### For Developers
```bash
# Setup locally
cd ~/2026-11_tree-of-life
python3 -m http.server 8000
# Visit http://localhost:8000
```

### For GitHub Maintainers
The project is **ready to deploy**. See [Deployment Guide](#-deployment-complete-guide) below.

---

## 🎨 Concept

This project visualizes how flowing water carrying sediment creates self-similar branching patterns across different scales:
- **Beach scale**: Rivulets forming in wet sand during outflow
- **Mountain scale**: Glacial meltwater valleys and avalanche chutes  
- **Desert scale**: Ephemeral gully networks

The simulation runs in your browser and contributes elevation changes to shared
terrain stored by the Cloudflare Worker.

**Key Innovation**: Natural branching emerges from physics—no explicit branching algorithm!

## 🌊 Physics Engine

### Model and parameters

The browser uses Lagrangian water parcels on a triangular terrain mesh. Gravity
accelerates each parcel down the local slope; friction damps its velocity.
Moving parcels erode sand when below transport capacity and deposit sediment
when slowing down. Neighboring vertices relax when their slope exceeds the
angle of repose. This exploratory particle model is not a shallow-water or
Exner-equation solver, and branching is not guaranteed.

| Parameter | Keyboard | Default | Effect |
|-----------|----------|---------|--------|
| **Q_inlet** (flow rate) | **+** / **-** | 0.5 | Water-parcel circulation rate |
| **timeScale** | **↑** / **↓** | 1 | Simulation speed multiplier |
| Gravity | fixed | 9.81 | Acceleration along the terrain slope |
| Friction | fixed | 1.8 | Velocity damping |
| Transport capacity | fixed | 6 | Sediment load capacity |

### Why Branching Forms Naturally

```
Feedback Loop:
  More water → Deeper channel
     ↓
  Deeper channel → Redirected particle paths
     ↓
  More parcels follow the channel
     ↓
  More erosion along those paths
     ↓
  More erosion → Even deeper channel
     ↓
  [LOOP] = Self-organizing branching network!
```

No explicit branching code is used.

## 🎮 Complete Controls Reference

### Keyboard Shortcuts

The control panel appears with `?admin`; sign in with GitHub before its
simulation controls and keyboard shortcuts become available. Reset remains
restricted to the authorized GitHub owner.

| Key | Action | Notes |
|-----|--------|-------|
| **+** / **-** | Increase/decrease flow (Q) | Larger Q = more water input per step |
| **↑** / **↓** | Increase/decrease simulation speed | |
| **D** | Cycle display mode | Elevation → sand depth → flux → sediment |
| **S** | Force sync to GitHub now | Useful for testing collaboration |
| **R** | Reset terrain (authentication required) | Press twice to confirm. Shows "Converged?" first |
| **?** | Show/hide help panel | Available in the admin view |

### Mouse Controls

| Gesture | Action |
|---------|--------|
| **Drag** | Rotate 3D terrain view |
| **Scroll** | Zoom in/out |
| **Double-click** | Reset camera view |

### Display Modes (Press **D**)

1. **Elevation** (default)
   - Color: Blue (water) → Green (erosion) → Red (high)
   - Shows: Terrain height

2. **Velocity Magnitude**
   - Color: Dark (slow) → Bright (fast)
   - Shows: Water flow speed

3. **Sediment Concentration**
   - Color: Light (clear) → Dark (loaded)
   - Shows: How much sediment water is carrying

### Status Badge (Top-Right Corner)

Shows real-time statistics:
- **Collaborators (24 h)**: Browser IDs seen by the Worker in the past day
- **Last Sync**: Seconds since this browser last contacted the Worker
- **Energy**: Relative motion indicator, Σ(u²+v²)h; the displayed percentage is
  rounded and capped at 100%, not a physical energy percentage.
- **Stability**: Comparison of the last 15 energy samples with the previous 15.
  The display is 0% until 30 samples are available; a relative change of 5%
  or more gives 0%, and a value above 95% is marked stable.

Open the **?** in the status badge for details on these indicators.

When **Converged**, you can press **R** to reset terrain.

## 🔗 Collaboration Guide

### How Your Changes Are Saved

```
Browser A ── elevation delta ─┐
Browser B ── elevation delta ─┼─→ Cloudflare Worker
Browser C ── elevation delta ─┘         │
                                        ├─ averages deltas per vertex
Each browser ←─ shared elevation/version┘
```

### Averaging and request budget

- Each browser submits at most one elevation delta per shared terrain version.
- The Worker averages accepted deltas at each mesh vertex; it does not merge
  complete terrain states with a max-height rule.
- Water depth, sediment, particles, vegetation and microorganisms remain
  browser-local and are not averaged.
- A random browser ID is kept in localStorage. The Worker considers it active
  for 24 hours after its last sync.
- Each sync request both submits a contribution and returns the latest state.
  The interval starts at five minutes and grows with the active-browser count
  toward an 80,000-request daily target.
- The schedule is not an absolute quota: direct public Worker calls and
  administration/OAuth requests are not constrained by the browser cadence.

### Authentication & Reset Permissions

**Who can reset?**
- Only @laurentperrinet (you!) can reset terrain
- Requires GitHub OAuth login
- Token stored in **sessionStorage** (cleared when tab closes, never persisted)

**How to reset:**
1. Press **R** twice to confirm (first press shows current status)
2. See toast notification: "Reset initiated"
3. Choose **Soft** (clear cache) or **Hard** (reinitialize cirque)
4. Terrain reloads from GitHub

**Reset URL parameters** (for direct testing):
- `?reset=1` - Soft reset
- `?reset=1&hard=1` - Hard reset
- Requires authenticated session (OAuth login)

### Convergence Detection

The simulation detects when patterns stabilize:

```
Energy:  E(t) = Σ (u² + v²) * h  [total kinetic energy]
Status:  "Converged" when ΔE < 5% for 30 seconds
Effect:  Reset button becomes available
Purpose: Prevents stuck patterns, allows fresh start
```

Read the energy value in status badge—lower = more converged.

## 📁 Project Structure & File Guide

### Core Application

```
index.html                      # Main entry point - Canvas + UI structure
css/style.css                   # Styling - Dark theme, responsive, animations
js/main.js                      # App orchestrator - Initializes all modules
```

### Simulation Modules

```
js/terrain.js                   # TerrainGrid class - 2D state management
                                # Contains: elevation(h), velocity(u,v), sediment(c)
                                
js/physics.js                   # Water parcels, sediment transport, slope
                                # relaxation and local energy calculation
                                
js/renderer.js                  # Renderer class - Three.js visualization
                                # Updates mesh, applies colors, handles display modes
```

### Collaboration & Auth

```
js/collaboration.js             # Cloudflare sync, compressed elevation deltas,
                                # browser identity and adaptive request cadence
worker/index.mjs                # Shared state, per-version contribution averaging
worker/mesh.mjs                 # Shared mesh initialization and request-budget formula

js/auth.js                      # AuthManager - GitHub OAuth2 flow
                                # ResetManager - Reset logic & permissions
                                # Only @laurentperrinet can reset
```

### User Interface & Input

```
js/controls.js                  # ControlHandler - Keyboard + mouse input
                                # Maps keys to physics parameters
                                
js/ui.js                        # UIManager - Status badge, toasts, help
                                # Real-time statistics display
                                
js/local-storage.js             # LocalStorage class - Browser persistence
                                # Caches local simulation state
```

### Persistent Data

```
data/terrain.json               # Legacy GitHub persistence prototype; not used
                                # by the current collaboration protocol
worker/                         # Shared elevation state and Durable Object
```

### Configuration & Deployment

```
package.json                    # Project metadata (no npm dependencies!)
.github/workflows/deploy.yml    # GitHub Actions - Auto-deploy to Pages
.nojekyll                       # GitHub Pages config (skip Jekyll)
.gitignore                      # Standard build/node_modules patterns
LICENSE                         # MIT License
```

### Documentation

```
README.md                       # This file - Complete user & dev guide
START_HERE.md                   # 5-minute quick start guide
DEPLOYMENT.md                   # Detailed GitHub Pages setup
CODE_MAP.md                     # Navigate the codebase
CONTRIBUTING.md                 # How to contribute
PERFORMANCE.md                  # Optimization strategies
FILES_MANIFEST.md               # What each file does
PROJECT_CHECKLIST.md            # Completion status
SUMMARY.md                      # Technical overview
```

### File Sizes

```
JavaScript:       ~77 KB  (core logic)
CSS:             ~13 KB  (styling)
HTML:             ~2 KB  (structure)
terrain.json:   ~500 KB  (shared data - largest)
Documentation:  ~25 KB  (guides)
Total:          ~617 KB  (with terrain.json)
```

## 🚀 Deployment: Complete Guide

### Prerequisites

- GitHub account (@laurentperrinet)
- Git installed locally
- GitHub CLI (`gh`) installed (optional, but recommended)
- Modern web browser

### Option A: Using GitHub CLI (Fastest)

```bash
cd ~/2026-11_tree-of-life

# Create GitHub repository
gh repo create 2026-11_tree-of-life \
  --public \
  --source=. \
  --remote=origin \
  --push

# That's it! Repo is created, pushed, and ready.
# Now enable GitHub Pages...
```

### Option B: Manual Setup

```bash
cd ~/2026-11_tree-of-life

# Create repo on GitHub.com first, then:
git remote add origin https://github.com/laurentperrinet/2026-11_tree-of-life.git
git branch -M main
git push -u origin main
```

### Step 1: Enable GitHub Pages

1. Go to: `https://github.com/laurentperrinet/2026-11_tree-of-life/settings/pages`
2. **Source**: Select `main` branch
3. **Folder**: Select `/ (root)`
4. Click **Save**
5. Wait 2-3 minutes for deployment
6. Your site will be live at:
   ```
   https://laurentperrinet.github.io/2026-11_tree-of-life/
   ```

### Step 2: Create OAuth Application

1. Go to: `https://github.com/settings/developers`
2. Click **Developer settings** → **OAuth Apps** → **New OAuth App**
3. Fill in the form:
   - **Application name**: `Tree of Life`
   - **Homepage URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Authorization callback URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
4. Click **Register application**
5. Copy the **Client ID** (you'll need this next)

### Step 3: Configure OAuth Client ID

1. Edit `js/main.js` in your repo
2. Find line ~15 where it says: `clientId: 'YOUR_GITHUB_OAUTH_CLIENT_ID'`
3. Replace with your Client ID from Step 2:
   ```js
   clientId: 'YOUR_ACTUAL_CLIENT_ID_HERE'
   ```
4. Save and commit:
   ```bash
   git add js/main.js
   git commit -m "Configure OAuth Client ID"
   git push
   ```
5. GitHub Actions auto-deploys (takes ~1 min)
6. Wait another minute, then refresh your site
7. Login should now work!

### Verification Checklist

- [ ] GitHub repo created at `github.com/laurentperrinet/2026-11_tree-of-life`
- [ ] GitHub Pages enabled (check Settings → Pages)
- [ ] Site accessible at `https://laurentperrinet.github.io/2026-11_tree-of-life/`
- [ ] OAuth app created in GitHub Developer settings
- [ ] Client ID configured in `js/main.js`
- [ ] Can login via GitHub (top-right "Login" button)
- [ ] Simulation runs and displays 3D terrain
- [ ] Can adjust flow rate with **Q**/**E** keys
- [ ] Reset button appears when converged + logged in
- [ ] Shared elevation syncs through the Cloudflare Worker

### Troubleshooting Deployment

**Site not loading?**
- Check: GitHub Pages enabled in Settings → Pages
- Check: `.nojekyll` file exists (prevents Jekyll from interfering)
- Check: Browser console (F12) for errors

**OAuth not working?**
- Check: Client ID in `js/main.js` matches GitHub OAuth app
- Check: Callback URL in OAuth app matches deployed site URL
- Check: Browser console for "CORS" errors (usually means wrong Client ID)

**Terrain not syncing?**
- Check the browser console for Cloudflare Worker/CORS errors
- Confirm the Worker has a SQLite-backed Durable Object binding
- Use **S** in the admin view; it respects the adaptive sync interval

**Performance issues?**
- Grid too large? Check `js/terrain.js` line ~20 for `gridSize`
- Too many updates? Check the active-browser cadence in `worker/mesh.mjs`
- See PERFORMANCE.md for detailed optimization guide

## 📊 Technical Specifications

### Performance Targets

```
Terrain:            Staggered polar triangular mesh
FPS Target:         60 frames/second
Timestep:           0.04 s, scaled by the local speed control
Stability Check:    Particle travel is substepped below particle radius
Sync Overhead:      Adaptive; minimum 5 minutes per browser
Request Target:     80,000 collaboration requests/day
```

### Browser Compatibility

✅ **Supported:**
- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

⚠️ **Not Supported:**
- Internet Explorer (WebGL required)
- Older mobile browsers (memory constraints)

### Scaling Path

| Mesh | FPS Target | Status |
|------|------------|--------|
| Polar triangular mesh | Device-dependent | Current |

See PERFORMANCE.md for scaling details.

## 🔬 Scientific Background

### Shallow Water Equations

These equations model fluid flow with vertical averaging:

```
∂u/∂t + u·∇u = -g∇(h+z) - c|u|u
∂v/∂t + v·∇v = -g∇(h+z) - c|v|v
∂h/∂t + ∇·(hu,hv) = 0
```

Where:
- **u, v**: Horizontal flow velocity (m/s)
- **h**: Water depth (m)
- **z**: Bed elevation (m)
- **g**: Gravity (9.81 m/s²)
- **c**: Friction coefficient (Manning's n)

**Assumptions:**
- Vertical velocity negligible (sh doesn't change rapidly)
- Hydrostatic pressure
- Uniform depth (no surface gradients within a cell)

**Valid for:**
- Shallow water depths (h << wavelength)
- Moderate slopes (∇z small)
- Not applicable for deep oceans or steep mountain streams

### Sediment Transport (Exner Equation)

The Exner equation governs bed elevation change:

```
∂z/∂t = -∇·q_s
q_s = c_s * u  [sediment flux]
c_s = α * (τ_b - τ_c)^β  [suspended sediment concentration]
```

Where:
- **z**: Bed elevation (m)
- **q_s**: Sediment flux vector (m³/s per unit width)
- **c_s**: Suspended sediment concentration (fraction)
- **τ_b**: Bed shear stress
- **τ_c**: Critical shear stress for motion
- **α, β**: Empirical parameters

**Implementation simplification**: 
```
c_s ≈ k * |u|  [linear approximation]
∂z/∂t = -∇·(c_s * u)  [erosion rate]
```

### Numerical Scheme

**Explicit Finite Difference:**
- Grid: Arakawa C-grid (staggered)
- Time: Forward Euler (explicit)
- Space: Central differences (2nd order)

**CFL Stability Condition:**
```
dt ≤ dx / (max|u| + √(gh))  [Courant condition]
```

We enforce this dynamically—if violated, we reduce dt automatically.

### References

- Exner, F. M. (1925). "Über die Wechselwirkung zwischen Wasser und Geschiebe"
- de Saint-Venant, B. (1871). "Théorie du mouvement non-permanent des eaux"
- Shallow water equations: https://en.wikipedia.org/wiki/Shallow_water_equations
- Sediment transport: https://en.wikipedia.org/wiki/Sediment_transport

## 🔮 Future Enhancements

### Short Term (Months)

- [ ] **Multiple water sources** - Rain field instead of single inlet
- [ ] **Wind erosion** - Aeolian processes on dry terrain
- [ ] **Flow visualization** - Overlay velocity vectors on terrain
- [ ] **Offline mode** - Run without GitHub (local-only)
- [ ] **Replay system** - Play back terrain evolution from git history

### Medium Term (Quarters)

- [ ] **Multiplayer WebSockets** - Real-time sync instead of GitHub polling
- [ ] **Statistics dashboard** - Channel count, branching metrics, volume eroded
- [ ] **Terrain presets** - Glacial, desert, tropical terrain shapes
- [ ] **Custom parameters UI** - Adjust physics without editing code
- [ ] **Cross-section view** - 2D profile through 3D terrain

### Long Term (Years)

- [ ] **WebGL compute shaders** - Support 256×256+ grids
- [ ] **Particle rendering** - Visualize water particles
- [ ] **Global collaboration** - Public terrain that anyone can edit
- [ ] **Physics learning game** - Educational mode with quizzes
- [ ] **Academic paper** - Publish methodology & results

## 🤝 Contributing

This project welcomes contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- How to contribute code
- Community guidelines
- Feature ideas
- Code style standards

**Types of contributions:**
1. **Playing = Contributing** - Just run the simulation, your erosion persists!
2. **Code contributions** - Fork, branch, submit PR
3. **Documentation** - Improve guides, fix typos
4. **Bug reports** - Found an issue? Open an issue on GitHub

## 🔓 License

MIT License - Free to use, modify, distribute.

```
Copyright (c) 2026 Laurent Perrinet

Permission is hereby granted, free of charge...
[See LICENSE file for full text]
```

## 📞 Support & Questions

- **How do I deploy this?** → See [Deployment Guide](#-deployment-complete-guide) above
- **How does the physics work?** → See [Scientific Background](#-scientific-background)
- **Where is code for X?** → See [CODE_MAP.md](CODE_MAP.md)
- **Can I modify/extend it?** → See [CONTRIBUTING.md](CONTRIBUTING.md)
- **Found a bug?** → Open an issue on GitHub

## 🌍 Related Projects

- [retipuj](https://laurentperrinet.github.io/retipuj/) - Similar interactive simulation (author's previous work)
- [Shallow Water Simulator](https://github.com/topics/shallow-water-simulation) - Other implementations
- [Landscape Evolution Models](https://github.com/topics/geomorphology) - Academic simulations

## 🎓 Learning Resources

If you want to understand the physics better:

- **Shallow water equations**: https://en.wikipedia.org/wiki/Shallow_water_equations
- **Sediment transport**: https://en.wikipedia.org/wiki/Sediment_transport
- **Geomorphology**: https://en.wikipedia.org/wiki/Geomorphology
- **Three.js tutorial**: https://threejs.org/docs/
- **GitHub API docs**: https://docs.github.com/en/rest

---

**Version**: 1.0.0  
**Created**: November 16, 2026  
**Last Updated**: November 16, 2026  
**Live Demo**: https://laurentperrinet.github.io/2026-11_tree-of-life/  
**GitHub Repo**: https://github.com/laurentperrinet/2026-11_tree-of-life  
**Author**: Laurent Perrinet (@laurentperrinet)
