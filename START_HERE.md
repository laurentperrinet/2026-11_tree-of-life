# 🌊 Tree of Life - START HERE

Welcome! You've just created a **collaborative, interactive terrain simulation** with GitHub-backed persistence.

## ⚡ Quick Start (5 minutes)

### Step 1: Create a GitHub Repository
```bash
cd ~/2026-11_tree-of-life
git remote add origin https://github.com/laurentperrinet/2026-11_tree-of-life.git
git push -u origin main
```

### Step 2: Enable GitHub Pages
1. Go to your repo on GitHub
2. **Settings** → **Pages**
3. Select branch: `main`
4. Save
5. Wait ~2 min → Your site is live at:
   ```
   https://laurentperrinet.github.io/2026-11_tree-of-life/
   ```

### Step 3: Setup OAuth (for reset feature)
1. GitHub Settings → Developer settings → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: "Tree of Life"
   - **Homepage**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Auth callback URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
3. Copy the **Client ID**
4. Edit `js/main.js` line ~15:
   ```js
   clientId: 'YOUR_GITHUB_OAUTH_CLIENT_ID'  // ← Paste here
   ```
5. Commit:
   ```bash
   git add js/main.js
   git commit -m "Configure OAuth Client ID"
   git push
   ```

### Done! 🎉
Your site is now live and interactive!

## 📖 Full Documentation

- **[README.md](README.md)** - Features, controls, physics explanation
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Detailed deployment guide
- **[PERFORMANCE.md](PERFORMANCE.md)** - Optimization & scaling notes
- **[PROJECT_CHECKLIST.md](PROJECT_CHECKLIST.md)** - What was implemented

## 🎮 First Time Playing?

Visit your live site and:

1. **Press ?** to see controls
2. **Press + and -** to adjust water flow
3. **Press D** to cycle visualization modes
4. **Watch it happen** - terrain branches should form naturally
5. **Drag mouse** to rotate 3D view
6. **Scroll** to zoom

## 🤝 How Collaboration Works

Each visitor:
1. **Runs the simulation** in their browser
2. **Contributes erosion patterns** to the terrain
3. **Changes sync** to GitHub automatically (every 60 sec)
4. **See others' work** when they visit

Watch the magic happen: `git log data/terrain.json` shows the complete evolution!

## 🔐 Reset Permission

Only you (@laurentperrinet) can reset the terrain:
- Press **R** twice to reset (requires GitHub login)
- Useful when simulation gets "stuck" (energy converged)

## 📊 What's Under the Hood?

### Physics
- Shallow water equations (realistic fluid dynamics)
- Sediment transport (water carries sand)
- Erosion feedback (more flow → deeper channels → more flow)
- = **Natural branching patterns** emerge!

### Technology
- **Three.js** for 3D visualization
- **GitHub API** for persistence
- **localStorage** for offline resilience
- **HTML/CSS/JavaScript** - no build step needed

### Collaboration
- **terrain.json** in GitHub = shared state
- **Fetch every 15s** = see others' work
- **Commit every 60s** = share your erosion
- **Max strategy** = erosion accumulates naturally

## 🚀 Next Steps

1. **Share the link** with friends/colleagues
2. **Monitor evolution**: `git log --oneline -- data/terrain.json`
3. **Create timelapse**: Show progression with git history
4. **Extend features**: Add custom terrain shapes, statistics, etc.

## ❓ Questions?

Check the documentation files - they cover:
- Controls in detail (README.md)
- Deployment issues (DEPLOYMENT.md)
- Performance & scaling (PERFORMANCE.md)
- Everything implemented (PROJECT_CHECKLIST.md)

## 🎨 Key Insight

This project demonstrates how:
- **Physics** creates emergent complexity (no explicit branching code!)
- **Collaboration** builds something together through Git
- **Nature** and **code** can be beautiful when combined

Enjoy! 🌊

---

**Start**: November 16, 2026  
**Status**: Production-ready  
**Next**: Push to GitHub + share link!
