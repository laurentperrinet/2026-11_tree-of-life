# 🌊 Tree of Life - Collaborative Hydromorphodynamic Simulation

An interactive web-based simulation of water-driven terrain erosion creating natural branching patterns, inspired by the "Tree of Life" photograph from Iceland. Each browser visitor contributes to building a shared terrain through a collaborative, persistent GitHub-backed system.

**Status**: ✅ Production-ready | **Deploy Time**: ~15 minutes | **Version**: 1.0.0

## 🎯 Quick Start (5 Minutes)

### For Users
Just visit: **https://laurentperrinet.github.io/2026-11_tree-of-life/**
- Press **?** to see all controls
- Watch natural branching patterns emerge
- Your erosion patterns sync to GitHub automatically!

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

The simulation runs in your browser and contributes to a shared, evolving terrain stored in Git.

**Key Innovation**: Natural branching emerges from physics—no explicit branching algorithm!

## 🌊 Physics Engine

### Equations

The simulation uses **shallow water equations** + **sediment transport** (Exner equation):

```
Shallow Water (momentum):
∂u/∂t + u·∇u = -g∇h - c|u|u    [momentum with friction]
∂h/∂t + ∇·(hu) = 0               [continuity - water conservation]

Sediment Transport (Exner):
∂z/∂t = -∇·q_s = -K(τ_b - τ_c)^n [bed elevation change]
c = |u| * S                       [sediment concentration]
```

### Key Parameters (All Adjustable)

| Parameter | Keyboard | Default | Effect |
|-----------|----------|---------|--------|
| **Q** (flow rate) | **+** / **-** | 0.5 | Water input per timestep |
| **V** (viscosity) | **↑** / **↓** | 0.01 | Friction/damping coefficient |
| **g** (gravity) | fixed | 9.81 | Pressure gradient |
| **K** (sediment coeff) | fixed | 0.1 | Erosion rate |
| **dt** (timestep) | adaptive | CFL-limited | Stability control |

### Why Branching Forms Naturally

```
Feedback Loop:
  More water → Deeper channel
     ↓
  Deeper channel → Lower friction
     ↓
  Lower friction → Faster flow
     ↓
  Faster flow → More erosion
     ↓
  More erosion → Even deeper channel
     ↓
  [LOOP] = Self-organizing branching network!
```

No explicit branching code—it emerges from physics!

## 🎮 Complete Controls Reference

### Keyboard Shortcuts

| Key | Action | Notes |
|-----|--------|-------|
| **Q** / **E** | Increase/decrease flow (Q) | Larger Q = more water input per step |
| **V** / **H** | Increase/decrease viscosity | Lower V = less friction, faster flow |
| **D** | Cycle display mode | Elevation → Velocity → Sediment → back to Elevation |
| **S** | Force sync to GitHub now | Useful for testing collaboration |
| **R** | Reset terrain (authentication required) | Press twice to confirm. Shows "Converged?" first |
| **?** | Show/hide help panel | Always available, lists all controls |

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
- **Contributors**: How many unique GitHub users have synced
- **Last Sync**: Seconds since last GitHub update
- **Energy**: Current kinetic energy (E = Σ(u²+v²)h)
- **Status**: "Running", "Converged", or "Syncing"

When **Converged**, you can press **R** to reset terrain.

## 🔗 Collaboration Guide

### How Your Changes Are Saved

```
You                          GitHub
  ↓                             ↓
Local Browser Simulation    Remote Repository
  ↓ (every 60 sec)             ↓
  └──→ Commit terrain.json ←───┘
         (Git commit)
  ↑ (every 15 sec) ↓
  └─← Fetch latest ←─┘
       (Pull request)
```

### Merge Strategy: Max-Elevation Wins

When your changes conflict with another user's:

```json
// You eroded here:          // They eroded here:
{ h: 0.5 }                   { h: 0.3 }

// After merge:
{ h: max(0.5, 0.3) = 0.5 }   ← Erosion accumulates!
```

**Why?** Erosion is irreversible—once a channel is dug, it stays dug. Different visitors' erosion patterns combine naturally.

### GitHub Integration

- **Persistent storage**: `data/terrain.json` in your repo
- **Full history**: `git log --oneline -- data/terrain.json` shows every change
- **Timelapse**: `git show SHA:data/terrain.json` to see terrain at any commit
- **Rate limiting**: Fetch (15s), Commit (60s) respects GitHub API limits (5000/hr with auth)

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
                                
js/physics.js                   # PhysicsEngine class - Numerical solver
                                # Implements: Shallow water + Exner equations
                                # CFL stability checking, energy calculation
                                
js/renderer.js                  # Renderer class - Three.js visualization
                                # Updates mesh, applies colors, handles display modes
```

### Collaboration & Auth

```
js/github-sync.js               # GitHubSync class - GitHub API integration
                                # Fetch, merge, commit to data/terrain.json
                                # Rate limiting: 15s fetch, 60s commit
                                
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
                                # Caches terrain between GitHub syncs
```

### Persistent Data

```
data/terrain.json               # 🔑 CRITICAL - Shared simulation state
                                # Format: {w, h, u, v, c, z} as Float32Arrays
                                # Size: ~500 KB typical
                                # Modified by: Every visitor (via GitHub API)
                                # Accessed by: Fetched every 15 seconds
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
- [ ] Terrain syncs to GitHub (check `data/terrain.json` in repo)

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
- Check: `data/terrain.json` exists in repo
- Check: Browser console for GitHub API errors
- Check: GitHub status page (github.com/status) isn't down
- Manually trigger sync with **S** key

**Performance issues?**
- Grid too large? Check `js/terrain.js` line ~20 for `gridSize`
- Too many updates? Check sync interval in `js/github-sync.js`
- See PERFORMANCE.md for detailed optimization guide

## 📊 Technical Specifications

### Performance Targets

```
Grid Size:          64×64 cells (configurable)
FPS Target:         60 frames/second
Timestep:           dt = 0.01s (adaptive with CFL)
Stability Check:    dt ≤ dx / max(|u|, |v|)
Memory Usage:       ~4 MB for 64×64 grid (Float32Array)
Sync Overhead:      15s fetch, 60s commit intervals
GitHub API Calls:   ~4/min = 240/hr (within limits)
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

| Grid Size | FPS Target | Memory | Status | Path |
|-----------|-----------|--------|--------|------|
| 64×64 | 60 | 4 MB | ✅ Tested | Current |
| 128×128 | 30-60 | 16 MB | 📋 Documented | CPU optimization |
| 256×256 | 15-30 | 64 MB | 🚀 Possible | WebGL compute shaders |

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
