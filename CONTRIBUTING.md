# 🌊 Contributing to Tree of Life

Welcome! This document explains how to contribute to the Tree of Life simulation.

## 🎯 How Contributions Work

Tree of Life is **automatically collaborative**:

1. **Visit the website** at https://laurentperrinet.github.io/2026-11_tree-of-life/
2. **Run the simulation** in your browser
3. **Your erosion patterns** are saved to GitHub automatically
4. **Everyone's patterns merge** into one shared terrain

**That's it!** No pull requests, forks, or merges needed—just play with it. 🎮

---

## 💡 Understanding Collaboration

### How Your Changes Are Saved

```
Your Browser
    ↓ runs simulation locally
    ↓ contributes erosion
    ↓
GitHub API (every 60 seconds)
    ↓
data/terrain.json
    ↓
Everyone's browser fetches updates
    ↓
You see others' erosion patterns
```

### Merge Strategy (Max Elevation Wins)

When two people erode different areas:
- **Heights**: Take the maximum `h = max(h_yours, h_theirs)`
- **Sediment**: Average them `c = (c_yours + c_theirs) / 2`
- **Water**: Zero at save time (only height persists)

**Why?** Erosion accumulates naturally. A channel dug by person A stays dug for person B—that's realistic!

---

## 🛠️ For Code Contributors

### Setup

```bash
# Clone the repository
git clone https://github.com/laurentperrinet/2026-11_tree-of-life.git
cd 2026-11_tree-of-life

# No build step needed - just open index.html in a browser!
# For local development, use a simple server:
python3 -m http.server 8000
# Then visit http://localhost:8000
```

### Making Changes

#### Physics Changes
**File**: `js/physics.js`  
**Process**:
1. Make your changes to shallow water or sediment equations
2. Test locally in browser (open DevTools to see console)
3. Check performance (should still run at 60 FPS)
4. Commit with clear message explaining the physics change
5. Push to GitHub

**Example**:
```bash
git add js/physics.js
git commit -m "Increase sediment transport coefficient for faster erosion"
git push
```

#### UI Changes
**File**: `css/style.css` or `js/ui.js`  
**Process**:
1. Edit styling or interface
2. Test responsiveness (browser DevTools: Ctrl+Shift+M on mobile view)
3. Ensure accessibility (keyboard controls still work)
4. Commit and push

#### Feature Additions
**Example**: Add statistics dashboard, custom terrain shapes, etc.

**Process**:
1. **Discuss first** - Open an issue describing the feature
2. **Design** - Plan the implementation with community
3. **Implement** - Create in separate branch
4. **Test** - Verify at 60 FPS on 64×64 grid
5. **Document** - Update README.md if needed
6. **Submit PR** - Community reviews and merges

### Code Style

- **JavaScript**: Use ES6+, clear variable names, comment complex sections
- **CSS**: Dark theme by default, mobile-responsive, use variables
- **HTML**: Semantic HTML5, accessibility features
- **Comments**: Explain *why*, not *what* - code should be self-documenting

### Performance Guidelines

- ✅ **Keep 60 FPS on 64×64 grid** (baseline)
- ✅ **Memory**: Float32Array for all numbers (~4 MB for 64×64)
- ✅ **Sync**: 15s fetch, 60s commit (don't change without reason)
- ✅ **API calls**: Respect GitHub rate limits (60/hr public, 5000/hr with token)

### Testing

No formal test suite yet, but verify:

```bash
# Open in browser and test:
# 1. Keyboard controls (Q, E, V, H, D, S, R, ?)
# 2. Mouse rotation/zoom
# 3. 3D rendering (no console errors)
# 4. Status badge updates
# 5. Branching patterns form naturally
# 6. Sync to GitHub happens (~60 sec)
```

---

## 🐛 Found a Bug?

1. **Open an issue** on GitHub with:
   - Description of the problem
   - Steps to reproduce
   - Screenshot/video if possible
   - Browser/OS you're using

2. **Check if it's known**:
   - Convergence detection (energy < threshold) blocks reset
   - Mobile might be laggy on older phones
   - Safari has minor CSS rendering differences

3. **Contribute a fix**:
   - Fork the repo
   - Create branch: `git checkout -b fix/bug-name`
   - Fix and test locally
   - Submit PR with clear description

---

## 💬 Feature Ideas

Good ideas for contributions:

### Physics Enhancements
- [ ] Wind erosion in addition to water
- [ ] Multiple water sources (rain field)
- [ ] Channel deepening feedback loop visualization
- [ ] Temperature-dependent viscosity
- [ ] Stochastic noise for more natural patterns

### Visualization
- [ ] Flow vectors overlaid on terrain
- [ ] Gradient coloring by slope steepness
- [ ] Animation of erosion over time
- [ ] Cross-section profile view
- [ ] Height map export to image

### Interface
- [ ] Parameter presets (desert, glacier, river delta modes)
- [ ] Statistics panel (total volume eroded, channel count)
- [ ] Save/load terrain snapshots locally
- [ ] Undo/redo stack
- [ ] Keyboard shortcuts cheatsheet overlay

### Collaboration
- [ ] Real-time multiplayer via WebSocket
- [ ] Terrain timelapse generator
- [ ] Contribution statistics per user
- [ ] Branching pattern analysis
- [ ] Compare side-by-side with previous state

### Deployment
- [ ] Docker container for local deployment
- [ ] Server-side OAuth token exchange (better security)
- [ ] Database backend for scaling beyond 64×64
- [ ] Statistics/analytics dashboard
- [ ] CDN caching strategy

### Documentation
- [ ] Interactive physics tutorial
- [ ] Video demonstration of branching formation
- [ ] Mathematical deep-dive on shallow water equations
- [ ] Performance profiling guide
- [ ] Developer Discord/community chat

---

## 📋 The Two Types of Contributions

### Type 1: Playing = Contributing ✨

**Who**: Everyone  
**How**: Just visit the site and run the simulation  
**Impact**: Your erosion patterns persist forever in git history  
**Effort**: 5 minutes  
**Reward**: Your name appears in `git log` contributors!

### Type 2: Code = Improving

**Who**: Developers who want to enhance the project  
**How**: Fork → branch → edit → test → PR  
**Impact**: New features, bug fixes, documentation  
**Effort**: 30 minutes - hours  
**Reward**: Your code runs in everyone's browser worldwide!

---

## 🎓 Learning from This Project

Contributing here teaches:

- **Physics**: Shallow water equations, sediment transport, fluid dynamics
- **Git**: Collaboration, merging, version control as a database
- **Web**: Three.js 3D rendering, GitHub API, OAuth2
- **Performance**: Real-time optimization, UI responsiveness
- **Design**: Clean architecture, documentation, user experience

---

## 🤝 Community Guidelines

- **Be respectful** - This is collaborative art, not competition
- **Share ideas** - Open issues for features/improvements
- **Test locally** - Don't break the main site
- **Document changes** - Help future contributors understand
- **Give credit** - Mention contributors in comments
- **Have fun** - The whole point is beautiful emergent patterns!

---

## 📚 Useful References

### For Physics Contributors
- [Shallow Water Equations](https://en.wikipedia.org/wiki/Shallow_water_equations) - Wikipedia
- [Sediment Transport](https://en.wikipedia.org/wiki/Sediment_transport) - Wikipedia
- [Exner Equation](https://en.wikipedia.org/wiki/Exner_equation) - Bed elevation changes

### For Code Contributors
- [Three.js Documentation](https://threejs.org/docs/) - 3D rendering
- [GitHub API](https://docs.github.com/en/rest) - Fetching/pushing data
- [MDN Web Docs](https://developer.mozilla.org/) - Web standards

### In This Project
- [CODE_MAP.md](CODE_MAP.md) - Navigate the codebase
- [PERFORMANCE.md](PERFORMANCE.md) - Optimization strategies
- [README.md](README.md) - Project overview

---

## 🚀 Getting Your Contribution Merged

### Small Changes (bug fixes, tweaks)
1. Fork repo
2. Edit + test locally
3. Submit PR with description
4. Wait for review (~24-48 hours)
5. Merged! ✅

### Medium Changes (new features)
1. Open issue first (discuss idea)
2. Get approval from maintainer
3. Create branch + implement
4. Write tests/documentation
5. Submit PR
6. Community review + merge

### Large Changes (architecture, major features)
1. **Discuss extensively** in GitHub Discussions or Issues
2. **Get design approval** before coding
3. **Break into PRs** if possible (easier review)
4. **Be patient** - large changes take longer to review

---

## 📞 Questions?

- **How do I...?** → Check [CODE_MAP.md](CODE_MAP.md)
- **Why does it...?** → Read [README.md](README.md) or code comments
- **Can I add...?** → Open an issue to discuss!
- **It's broken!** → Submit issue with reproduction steps

---

## 🎉 First Contribution?

Don't worry! Here's the easiest way to start:

1. **Play with the simulation** (everyone contributes this way!)
2. **Find a small issue** (typo in docs, styling fix)
3. **Fork + fix + PR** (we'll help review)
4. **Celebrate** - you're now a contributor! 🎊

---

## 📜 License

By contributing, you agree your work will be published under the same license as this project (MIT). All contributions are welcome and appreciated!

---

**Thank you for making Tree of Life beautiful!** 🌊✨

---

**Last Updated**: November 16, 2026  
**Status**: Open for contributions!
