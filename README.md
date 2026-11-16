# Tree of Life - Collaborative Hydromorphodynamic Simulation

An interactive web-based simulation of water-driven terrain erosion creating natural branching patterns, inspired by the "Tree of Life" photograph from Iceland. Each browser visitor contributes to building a shared terrain through a collaborative, persistent GitHub-backed system.

## 🎨 Concept

This project visualizes how flowing water carrying sediment creates self-similar branching patterns across different scales:
- **Beach scale**: Rivulets forming in wet sand during outflow
- **Mountain scale**: Glacial meltwater valleys and avalanche chutes
- **Desert scale**: Ephemeral gully networks

The simulation runs in your browser and contributes to a shared, evolving terrain stored in Git.

## 🌊 Physics

The simulation uses simplified shallow-water hydrodynamics:

```
∂h/∂t = -∇·(h*u)           [continuity - water depth]
u = -g*∇(h+b)              [momentum - gravity-driven flow]
Q_s = k*u*c                [sediment transport]
∂b/∂t = -∇·Q_s             [Exner - terrain evolution]
```

**Key parameters** (minimal physics):
- `Q`: Water inlet discharge (keyboard ±)
- `V`: Simulation speed (keyboard ↑↓)
- `g`: Gravity (9.81 m/s² - constant)
- `k`: Sediment transport coefficient

Ramification emerges **naturally** from the positive feedback: water → erosion → deeper channel → attracts more water.

## 🎮 Controls

| Input | Action |
|-------|--------|
| **+** / **-** | Increase/decrease flow rate Q |
| **↑** / **↓** | Speed up/slow down simulation |
| **D** | Cycle display mode (elevation → flux → sediment) |
| **S** | Force GitHub sync now |
| **R** | Reset terrain (auth required) |
| **?** | Toggle help panel |
| **Mouse drag** | Rotate 3D view |
| **Scroll** | Zoom in/out |

## 🔗 Collaboration System

### How it works

1. **Local simulation** runs in your browser, modifying terrain
2. **Every 15 seconds** : terrain fetched from GitHub, merged with global state
3. **Every 60 seconds** : your changes committed back to GitHub
4. **Merge strategy** : elevation = max(local, global) - erosion accumulates
5. **Persistence** : `git log data/terrain.json` = timelapse of collective creation

### URL parameters

- `?reset=1` - Soft reset (clear cache, reload from GitHub)
- `?reset=1&hard=1` - Hard reset (reinitialize cirque)

### Authentication

- Sign in via **GitHub OAuth2**
- Only @laurentperrinet can reset terrain
- Token stored in **session storage** (cleared on tab close, not persisted)

## 🏔️ Convergence & Reset

The simulation detects when terrain reaches a stable state (energy plateau):

```
E(t) = Σ (u² + v²) * h  [total kinetic energy]
Converged if: ΔE < 5% for 30 seconds
```

When converged, authenticated users can reset to prevent stuck patterns.

## 📁 Project Structure

```
2026-11_tree-of-life/
├── index.html               # Main UI
├── css/style.css           # Styling
├── js/
│   ├── main.js             # Orchestration
│   ├── terrain.js          # 2D grid state
│   ├── physics.js          # Simulation engine
│   ├── renderer.js         # Three.js 3D
│   ├── github-sync.js      # GitHub API + merge
│   ├── auth.js             # OAuth + reset
│   ├── controls.js         # Keyboard/mouse input
│   ├── local-storage.js    # Browser storage
│   └── ui.js               # Status badge + buttons
├── data/
│   └── terrain.json        # Shared persistent state 🔑
└── .github/workflows/      # CI/CD (future)
```

## 🚀 Deployment

### GitHub Pages Setup

1. Create repo `2026-11_tree-of-life` in GitHub
2. Push all files
3. Settings → Pages → Source: `main` branch → Save
4. Access at `https://laurentperrinet.github.io/2026-11_tree-of-life/`

### OAuth Configuration

For authentication to work:

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create new OAuth App:
   - **Authorization callback URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Homepage URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
3. Copy `Client ID` and set in `js/main.js`:
   ```js
   clientId: 'YOUR_GITHUB_CLIENT_ID'
   ```

**Note**: For security, token exchange should be done server-side (Netlify functions, CloudFlare Workers, etc.)

## 📊 Stability & Performance

- **Grid size**: 64×64 cells (CPU sufficient, 60 FPS on modern hardware)
- **Time step**: dt = 0.01s (adaptive with CFL condition)
- **Fetch/commit overhead**: Minimal (15s fetch cache, 60s batch writes)
- **localStorage backup**: Automatic save between syncs

## 🔬 Interesting Observations

- **Self-similarity**: Patterns look the same at different zoom levels (fractal-like)
- **Emergent branching**: No explicit branching algorithm, grows naturally from fluid mechanics
- **Collaborative signatures**: Different visitor patterns create unique terrain features
- **Git timelapse**: `git log --all terrain.json` shows evolution over time

## 🌍 Inspiration

- Photo: "Tree of Life" by Radoslav Sviretsov (Iceland) - Glacial meltwater erosion
- Concept: Collaborative art through distributed Git
- Physics: Shallow water equations + sediment transport (geomorphology)

## 📝 Future Enhancements

- [ ] WebGL compute shaders for 256×256+ grids
- [ ] Real-time multiplayer (WebSocket sync instead of GitHub polling)
- [ ] 3D water flow visualization
- [ ] Sandbox mode (offline, no GitHub sync)
- [ ] Custom initial terrain shapes
- [ ] Statistics dashboard (energy, bifurcation count, etc.)

## 🔓 License

MIT - Feel free to fork and create your own simulation!

---

**Author**: Laurent Perrinet  
**Started**: November 16, 2026  
**Visit**: https://laurentperrinet.github.io/2026-11_tree-of-life/
