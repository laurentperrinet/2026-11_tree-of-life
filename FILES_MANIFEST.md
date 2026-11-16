# 📋 Files Manifest - What Does Each File Do?

## 🔑 Critical Files (Don't Delete!)

### `data/terrain.json`
**Purpose**: Shared simulation state stored on GitHub  
**Format**: JSON with terrain grid data  
**Size**: ~500 KB typical  
**Modified by**: Every browser that runs simulation (via GitHub API)  
**Accessed by**: All visitors (fetched every 15 seconds)  
**Git**: Full history tracks terrain evolution over time  
**⚠️ CRITICAL**: This is the collaborative database - deleting means everyone loses their work!

### `index.html`
**Purpose**: Main web page - entry point for all visitors  
**Size**: ~60 lines  
**Contains**: Canvas for 3D rendering, UI structure, script tags  
**Loaded by**: User's browser when visiting the site  
**Modified by**: Rarely (unless changing page structure)  
**🔧 Config**: Line ~20 - OAuth client ID needs to be set here

---

## 🚀 Deployment Files

### `.github/workflows/deploy.yml`
**Purpose**: GitHub Actions workflow - auto-deploys to GitHub Pages  
**Size**: ~30 lines  
**Triggers**: On every push to `main` branch  
**Does**: Build and deploy site to `https://laurentperrinet.github.io/2026-11_tree-of-life/`  
**Modified by**: Rarely (only if changing deploy process)  
**⚠️ Important**: GitHub Actions must be enabled in repo settings

### `.nojekyll`
**Purpose**: Tells GitHub Pages to skip Jekyll processing  
**Size**: 0 bytes (empty file)  
**Required for**: Serving JavaScript/CSS properly (no Jekyll interference)  
**Modified by**: Never  
**⚠️ Critical**: Deleting this breaks CSS/JS loading!

### `.gitignore`
**Purpose**: Tells git which files to ignore  
**Size**: ~10 lines  
**Ignores**: Build artifacts, node_modules, temp files  
**Modified by**: Rarely  
**🎯 Contains**: Standard patterns (node_modules, .DS_Store, etc.)

---

## 📚 Documentation Files

| File | Purpose | Audience | Size |
|------|---------|----------|------|
| `README.md` | Feature overview, controls, physics | Everyone | 180 lines |
| `START_HERE.md` | 5-minute quick start guide | First-time users | 128 lines |
| `DEPLOYMENT.md` | GitHub Pages setup, OAuth config | Deployers | 200 lines |
| `PERFORMANCE.md` | Optimization, scaling, WebGL path | Developers | 130 lines |
| `CODE_MAP.md` | Code navigation, find functions | Developers | 280 lines |
| `CONTRIBUTING.md` | How to contribute code/features | Contributors | 300 lines |
| `SUMMARY.md` | Project overview, technical details | Project managers | 250 lines |
| `PROJECT_CHECKLIST.md` | Completion status, what was built | Status tracking | 164 lines |
| `FILES_MANIFEST.md` | This file - file purposes | Developers | TBD |
| `LICENSE` | MIT License | Legal | 21 lines |

**💡 Tip**: Most users only need README.md, START_HERE.md, and DEPLOYMENT.md

---

## 🎨 Static Assets

### `css/style.css`
**Purpose**: All styling for the website  
**Size**: ~370 lines  
**Loaded**: Once when page loads  
**Contains**: 
- Dark theme (--bg-dark, --text-light variables)
- Responsive design (mobile-first breakpoints)
- Status badge styling
- Toast notifications styling
- Canvas sizing

**Modify for**: Change colors, fonts, layout  
**Note**: Uses CSS variables for easy dark/light mode switching

---

## 🧠 Core JavaScript Modules

### `js/main.js`
**Purpose**: Application orchestrator - brings everything together  
**Size**: ~200 lines  
**Does**: 
- Initialize all modules
- Set up configuration
- Start sync loop
- Handle window events
- Coordinate rendering and physics

**Start here if**: Understanding overall app flow  
**Modify for**: Changing app-level configuration

### `js/terrain.js`
**Purpose**: Terrain state management  
**Size**: ~230 lines  
**Contains**: 
- TerrainGrid class
- 2D arrays (elevation h, velocities u/v, sediment c)
- Energy calculation
- JSON serialization/deserialization

**Start here if**: Understanding data structures  
**Modify for**: Changing grid resolution or fields

### `js/physics.js`
**Purpose**: Physics simulation engine  
**Size**: ~290 lines  
**Implements**: 
- Shallow water equations
- Sediment transport (Exner equation)
- Erosion and deposition
- CFL stability checking

**Start here if**: Understanding the science  
**Modify for**: Changing physics (gravity, friction, erosion rate)

### `js/renderer.js`
**Purpose**: 3D visualization with Three.js  
**Size**: ~340 lines  
**Does**: 
- Set up Three.js scene/camera/renderer
- Create and update terrain mesh
- Apply coloring based on display mode
- Handle camera controls

**Start here if**: Understanding 3D rendering  
**Modify for**: Changing appearance, colors, lighting

### `js/github-sync.js`
**Purpose**: Collaborative persistence - syncs with GitHub  
**Size**: ~300 lines  
**Does**: 
- Fetch terrain.json from GitHub
- Merge changes (max-elevation strategy)
- Commit merged terrain back
- Rate limiting and error handling

**Start here if**: Understanding collaboration  
**Modify for**: Changing merge strategy or sync timing

### `js/auth.js`
**Purpose**: Authentication and reset management  
**Size**: ~230 lines  
**Does**: 
- GitHub OAuth2 flow
- User identity verification
- Reset triggers (soft/hard)
- Session token management

**Start here if**: Understanding authentication  
**Modify for**: Changing who can reset or adding new permissions

### `js/controls.js`
**Purpose**: Keyboard and mouse input handling  
**Size**: ~160 lines  
**Handles**: 
- Keyboard: Q (flow), V (viscosity), D (display), S (save), R (reset), ? (help)
- Mouse: Rotation (drag), zoom (scroll)
- Display mode cycling

**Start here if**: Understanding user input  
**Modify for**: Adding new controls or changing key bindings

### `js/local-storage.js`
**Purpose**: Browser storage for offline resilience  
**Size**: ~145 lines  
**Does**: 
- Cache terrain locally between syncs
- Restore from cache on load
- Handle quota exceeded gracefully
- Manage localStorage size limits

**Start here if**: Understanding offline persistence  
**Modify for**: Changing cache strategy or storage size

### `js/ui.js`
**Purpose**: User interface elements  
**Size**: ~210 lines  
**Contains**: 
- Status badge (real-time statistics)
- Toast notifications
- Help panel
- Authentication status display
- Reset button

**Start here if**: Understanding UI feedback  
**Modify for**: Adding new UI elements or notifications

---

## 📦 Configuration Files

### `package.json`
**Purpose**: Project metadata and scripts  
**Size**: ~30 lines  
**Contains**: 
- Project name, version, description
- Author and license
- npm scripts (none for this project - no build step!)
- Keywords for GitHub discovery

**Modified by**: Rarely (only version bumps)  
**🎯 Note**: No dependencies! Pure vanilla JS + CDN

---

## 🔄 Dependencies (Not Installed - All CDN)

These are loaded from CDN in `index.html`, not from npm:

1. **Three.js** (3D library)
   - Loaded from: jsDelivr CDN
   - Version: Latest (r128+)
   - Used by: `js/renderer.js` for 3D rendering

2. **GitHub API** (REST endpoints)
   - Endpoint: `api.github.com`
   - Used by: `js/github-sync.js` for fetch/push
   - No authentication required (rate limited but works)

3. **OAuth2** (GitHub authentication)
   - Endpoint: `github.com/login/oauth/authorize` and `access_token`
   - Used by: `js/auth.js` for user login
   - Client ID: Set in `js/main.js` line ~15

---

## 📊 File Size Breakdown

```
Total Project: ~410 KB

JavaScript:
  js/physics.js        ~10 KB (most complex)
  js/github-sync.js    ~10 KB
  js/renderer.js       ~12 KB
  js/auth.js           ~9 KB
  js/ui.js             ~8 KB
  js/terrain.js        ~8 KB
  js/controls.js       ~7 KB
  js/local-storage.js  ~6 KB
  js/main.js           ~7 KB
  Subtotal:            ~77 KB

Data:
  data/terrain.json    ~500 KB (grows over time)

Static:
  css/style.css        ~13 KB
  index.html           ~2 KB
  Documentation:       ~25 KB (all .md files)

Config:
  .github/workflows/   ~1 KB
  .gitignore           ~1 KB
  LICENSE              ~1 KB
  package.json         ~1 KB
```

**Note**: `data/terrain.json` is the only file that grows significantly (terrain accumulates over time)

---

## 🚨 What Happens If You Delete...

| File | If Deleted | Recovery |
|------|-----------|----------|
| `data/terrain.json` | Everyone loses terrain! ❌ | Restore from git history |
| `index.html` | Site won't load ❌ | Restore from git |
| `.nojekyll` | CSS/JS fail to load ❌ | Restore from git |
| `js/physics.js` | Simulation doesn't run ❌ | Restore from git |
| Documentation | Help unavailable ⚠️ | Restore from git (non-critical) |
| `LICENSE` | Legal ambiguity ⚠️ | Re-add (easy) |

**Golden Rule**: Always commit before deleting! Git is your safety net.

---

## ✅ Safe to Modify

These files are safe to modify without breaking functionality:

- ✅ Any `*.md` documentation files
- ✅ `css/style.css` (just styling)
- ✅ `package.json` (metadata only)
- ✅ Comments in any `.js` file
- ✅ Variable names in `.js` files (refactoring)

## ⚠️ Careful When Modifying

- ⚠️ `js/physics.js` - Changes affect simulation behavior
- ⚠️ `js/github-sync.js` - Changes affect collaboration
- ⚠️ `data/terrain.json` - This is shared state!
- ⚠️ `index.html` - Structure matters for JS selectors

## 🚫 Never Modify

- 🚫 `.github/workflows/deploy.yml` - Unless changing deploy process
- 🚫 `.nojekyll` - Critical for GitHub Pages
- 🚫 `LICENSE` - Legal document

---

## 📈 How Files Change Over Time

```
Initial State:
  data/terrain.json    ~5 KB (empty arrays)
  
After 1 day:
  data/terrain.json    ~100 KB (many visitors)
  git history          +24 commits

After 1 week:
  data/terrain.json    ~500 KB (saturated at terrain limit)
  git history          +168 commits (24/hr average)
  
After 1 month:
  data/terrain.json    ~1 MB (max size, maybe pruned)
  git history          ~720 commits (rich temporal record)
```

**Git log** becomes the "time machine" - you can see terrain evolution hour by hour!

---

## 🔍 Useful File Commands

```bash
# See what's actually committed
git ls-files

# Check file sizes in repo
git ls-files -l | sort -k4 -rn

# See changes to a specific file over time
git log --oneline -- data/terrain.json

# See who edited each line
git blame js/physics.js

# Recover a deleted file
git checkout HEAD^ -- filename

# See size of git objects
du -sh .git/

# Compare versions of terrain
git diff HEAD~1 HEAD -- data/terrain.json
```

---

## 📞 Questions About Files?

- **"What does this file do?"** → Look in this manifest
- **"Can I delete this?"** → Check "Safe to Modify" section
- **"How do I change X?"** → See CODE_MAP.md or README.md
- **"My change broke it!"** → `git checkout -- file` to restore

---

**Last Updated**: November 16, 2026  
**Status**: Complete - Ready for GitHub! ✅
