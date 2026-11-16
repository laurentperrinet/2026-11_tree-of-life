# 🗺️ Code Navigation Map

## Quick Reference by Task

### 🎮 "How do I change controls?"
**File**: [`js/controls.js`](/js/controls.js)  
**Lines**: 1-160  
**What**: Keyboard (Q, E, V, H, D, S, R) and mouse input handling  
**Key functions**: 
- `handleKeyDown()` - Maps keys to physics parameters
- `handleMouseMove()` - Rotate/zoom the 3D view
- `displayHelp()` - Show available controls

---

### 🌊 "How does the physics work?"
**Files**: [`js/physics.js`](/js/physics.js) + [`js/terrain.js`](/js/terrain.js)  
**Physics** (lines 1-290):
- `calculateFlow()` - Shallow water momentum equations
- `transportSediment()` - Exner equation for erosion
- `erodeTerrain()` - Apply sediment transport
- `checkCFLCondition()` - Ensure stability

**State** (terrain.js lines 1-230):
- `TerrainGrid` class - 2D arrays for h, u, v, c, z
- `calculateEnergy()` - Convergence detection
- `toJSON()` / `fromJSON()` - Serialization

**Key equations at**:
- Line 60-90 (shallow water momentum)
- Line 130-160 (sediment transport)
- Line 145-150 (energy calculation)

---

### 🤝 "How does collaboration work?"
**File**: [`js/github-sync.js`](/js/github-sync.js)  
**Lines**: 1-300  
**What**: Fetch terrain.json, merge changes, commit back  
**Key functions**:
- `syncLoop()` (line 270) - Main sync orchestrator
- `fetchTerrainFromGitHub()` (line 70) - Get current state
- `commitTerrainToGitHub()` (line 130) - Save new state
- `mergeTerrains()` (line 150) - Max-elevation merge strategy

**Timing**:
- Line 240-250: Rate limiting (15s fetch, 60s commit)
- Line 280: Async sync loop

---

### 🔐 "How does authentication work?"
**File**: [`js/auth.js`](/js/auth.js)  
**Lines**: 1-230  
**What**: GitHub OAuth and reset management  
**Key functions**:
- `startOAuthFlow()` (line 50) - Initialize OAuth redirect
- `handleOAuthCallback()` (line 100) - Handle auth response
- `canReset()` (line 120) - Check if user is @laurentperrinet
- `softReset()` / `hardReset()` (line 150-180) - Reset terrain

**Reset triggers**:
- URL: `?reset=1` (soft) or `?reset=1&hard=1` (hard)
- Requires verified login
- Soft: Clear cache, hard: Reinitialize cirque

---

### 🎨 "How is it rendered?"
**File**: [`js/renderer.js`](/js/renderer.js)  
**Lines**: 1-340  
**What**: Three.js 3D visualization  
**Key functions**:
- `initThreeJS()` (line 30) - Setup scene, camera, renderer
- `updateMesh()` (line 100) - Update terrain geometry
- `render()` (line 180) - Render loop
- `setDisplayMode()` (line 200) - Switch visualization (elevation/flux/sediment)

**Display modes**:
- Line 210: Height-based coloring
- Line 220: Velocity magnitude
- Line 230: Sediment concentration

---

### 📊 "How are stats displayed?"
**File**: [`js/ui.js`](/js/ui.js)  
**Lines**: 1-210  
**What**: Status badge, toasts, notifications  
**Key functions**:
- `updateStatusBadge()` (line 30) - Show live statistics
- `showToast()` (line 80) - Popup notifications
- `updateAuthStatus()` (line 120) - Show login state

**Status badge shows**:
- Contributor count
- Last sync time
- Current energy (E_t)
- Stability status (< threshold = converged)

---

### 💾 "How is data persisted?"
**Files**: [`js/local-storage.js`](/js/local-storage.js) + `data/terrain.json`  
**localStorage** (js/local-storage.js, lines 1-145):
- `cacheTerrainLocally()` - Save to browser storage
- `getCachedTerrain()` - Load from cache
- Size limit: 5-10 MB on most browsers
- Fallback: Continue simulation if quota exceeded

**GitHub Persistence** (data/terrain.json):
- JSON format: arrays for h, u, v, c, z
- Max 1 MB to avoid GitHub limits
- Updated every 60 seconds (configurable)
- Full history in git log

---

### 🚀 "How do I deploy this?"
**Files**: 
- [`index.html`](/index.html) - Entry point
- [`js/main.js`](/js/main.js) (line ~15) - Configure OAuth Client ID
- [`.github/workflows/deploy.yml`](/.github/workflows/deploy.yml) - Auto-deploy

**Steps**:
1. Edit `js/main.js`: Add GitHub OAuth Client ID
2. Push to GitHub
3. Enable Pages (Settings → Pages → main branch)
4. Auto-deployed by GitHub Actions

See [DEPLOYMENT.md](DEPLOYMENT.md) for full setup.

---

## File Dependencies

```
index.html
    ↓ (loads in order)
├─→ js/main.js              (orchestrates all modules)
│   ├─→ js/terrain.js       (state management)
│   ├─→ js/physics.js       (simulation engine)
│   ├─→ js/renderer.js      (3D visualization)
│   ├─→ js/controls.js      (keyboard/mouse input)
│   ├─→ js/github-sync.js   (collaboration)
│   ├─→ js/auth.js          (authentication)
│   ├─→ js/local-storage.js (offline persistence)
│   └─→ js/ui.js            (user interface)
├─→ css/style.css           (styling)
└─→ Three.js (CDN)          (3D library)
```

**No build step required** - all JS runs directly in browser!

---

## Code Statistics by File

| File | Lines | Purpose | Key Exports |
|------|-------|---------|--------------|
| `js/main.js` | ~200 | Orchestration | App class |
| `js/terrain.js` | ~230 | State | TerrainGrid class |
| `js/physics.js` | ~290 | Simulation | PhysicsEngine class |
| `js/renderer.js` | ~340 | Visualization | Renderer class |
| `js/github-sync.js` | ~300 | Collaboration | GitHubSync, SyncLoop |
| `js/auth.js` | ~230 | Authentication | AuthManager, ResetManager |
| `js/controls.js` | ~160 | Input | ControlHandler class |
| `js/local-storage.js` | ~145 | Persistence | LocalStorage class |
| `js/ui.js` | ~210 | UI | UIManager class |
| `css/style.css` | ~370 | Styling | - |
| `index.html` | ~60 | DOM | - |
| **Total** | **~2,200** | | |

---

## Finding Specific Physics

### Shallow Water Equations
**File**: `js/physics.js`, lines 60-90  
Implements: `∂u/∂t + u·∇u = -g∇h - c|u|u`

### Sediment Transport (Exner)
**File**: `js/physics.js`, lines 130-160  
Implements: `∂z/∂t = -∇·q_s`

### Convergence Detection
**File**: `js/terrain.js`, lines 145-155  
Uses energy: `E(t) = Σ(u² + v²)·h`

### CFL Stability Check
**File**: `js/physics.js`, lines 95-110  
Ensures: `dt ≤ dx / max(|u|, |v|)`

### Merge Strategy
**File**: `js/github-sync.js`, lines 150-165  
Rule: `h_new = max(h_old, h_contributed)`

---

## Common Modifications

### Change simulation resolution?
- `js/terrain.js`, line ~20: Change `gridSize` (64 default)
- Warning: Larger grids need more performance

### Adjust physics parameters?
- `js/main.js`, line ~30-50: Initial Q (flow rate), viscosity
- `js/physics.js`, line ~20: Gravity constant, sediment coefficient

### Change sync timing?
- `js/github-sync.js`, line ~240-250: Adjust fetch/commit intervals
- Warning: GitHub API limits (5000 calls/hour with token)

### Modify UI colors/fonts?
- `css/style.css`: All styling here
- Dark theme by default (modify `--bg-dark`, `--text-light`)

### Add new display mode?
- `js/renderer.js`, line ~200-230: Add new mode in `setDisplayMode()`
- Implement coloring function

---

## Debugging Tips

### Physics not working?
→ Check `js/physics.js` `step()` function (line 30-50)  
→ Verify CFL condition (line 95-110) isn't blocking  
→ Check energy calculation (js/terrain.js line 145)

### Sync not happening?
→ Open browser console (F12) for error messages  
→ Check network tab for GitHub API calls  
→ Verify GitHub token in `js/auth.js` (line ~50)  
→ See `js/github-sync.js` `syncLoop()` (line 270)

### 3D rendering issues?
→ Check WebGL support: `THREE.WebGLRenderer` in browser  
→ Verify mesh update: `js/renderer.js` `updateMesh()` (line 100)  
→ Check Three.js CDN loaded in `index.html`

### Laggy performance?
→ Reduce grid size (js/terrain.js line 20)  
→ Check FPS in status badge (js/ui.js)  
→ See PERFORMANCE.md for optimization guide

---

## Reference: Physics Parameters

**Default values** (adjustable via keyboard):

| Parameter | Key | Default | Effect |
|-----------|-----|---------|--------|
| Flow Rate (Q) | Q + / Q - | 0.5 | Water input per step |
| Viscosity (ν) | V + / V - | 0.01 | Friction coefficient |
| Gravity | (fixed) | 9.81 | Determines pressure gradient |
| Sediment Coeff (K) | (fixed) | 0.1 | Erosion rate |
| Manning Coeff (c) | (fixed) | 0.03 | Friction |
| dt (timestep) | (adaptive) | CFL-limited | Stability control |

**Advanced**: Edit defaults in `js/main.js` lines 30-50

---

## Contact the Code

Have questions about a specific section? Here's where to look:

- **"Why does the water flow that way?"** → `js/physics.js` lines 60-90
- **"How does branching form?"** → `js/physics.js` + `js/renderer.js` (emergent from physics!)
- **"What happens when two people edit?"** → `js/github-sync.js` lines 150-165
- **"Can I add a new feature?"** → See PERFORMANCE.md for future extensions

---

**Last updated**: November 16, 2026  
**Status**: Complete & Production-Ready ✅
