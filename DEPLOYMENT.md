# 🚀 Deployment Guide - Tree of Life

## Quick Start

Le projet est prêt pour GitHub Pages ! Suivez ces étapes :

### 1. Créer le repo sur GitHub

```bash
cd ~/2026-11_tree-of-life
git remote add origin https://github.com/laurentperrinet/2026-11_tree-of-life.git
git branch -M main
git push -u origin main
```

### 2. Activer GitHub Pages

1. Allez sur GitHub : **Settings → Pages**
2. **Source** : Select `main` branch
3. **Folder** : `/root` (default)
4. **Save**
5. Attendez ~1-2 min → Votre site est live à :
   ```
   https://laurentperrinet.github.io/2026-11_tree-of-life/
   ```

### 3. OAuth Configuration (pour reset auth)

Le système d'authentification a besoin d'une OAuth App GitHub pour fonctionner :

**Créer une OAuth App** :
1. GitHub Settings → Developer settings → OAuth Apps → New OAuth App
2. Remplissez :
   - **Application name** : "Tree of Life"
   - **Homepage URL** : `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Authorization callback URL** : `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Description** : "Collaborative terrain simulation"
3. Cliquez "Register application"
4. Copiez le **Client ID** (ex: `12a3b4c5d6e7f8g9h0i1j2k3l4m5`)

**Configurer dans le code** :
- Ouvrez `js/main.js` ligne ~15
- Remplacez `YOUR_GITHUB_OAUTH_CLIENT_ID` par votre Client ID réel :
  ```js
  clientId: '12a3b4c5d6e7f8g9h0i1j2k3l4m5'
  ```
- Commit et push :
  ```bash
  git add js/main.js
  git commit -m "Configure GitHub OAuth Client ID"
  git push
  ```

### 4. Tester localement

```bash
cd ~/2026-11_tree-of-life
python3 -m http.server 8000
# Accédez à http://localhost:8000
```

**Note** : OAuth redirect ne fonctionne qu'avec `https://` ou `localhost`, donc :
- ✅ localhost:8000 works
- ✅ production site (https) works
- ❌ IP address won't work (not https)

## Architecture Deployed

```
GitHub Pages (Static)
    ↓
index.html + css/js/data
    ↓
Browser (Your Computer)
    ├── Local simulation (physics.js)
    ├── Local storage cache (localStorage)
    └── GitHub API calls ← → data/terrain.json
```

## How Collaboration Works

1. **You visit** → https://laurentperrinet.github.io/2026-11_tree-of-life/
2. **Browser fetches** `data/terrain.json` from GitHub
3. **Simulation runs locally**, modifying terrain
4. **Every 15s** → Fetch latest from GitHub
5. **Every 60s** → Commit your changes back
6. **Result** → Shared, persistent terrain evolves collaboratively

## GitHub API Limits

Free tier allows ~60 requests/hour (unauthenticated).

With OAuth token, you get 5000/hour. The app uses:
- 1 fetch per 15s = 4/minute = 240/hour
- 1 commit per 60s = 1/minute = 60/hour
- **Total**: ~300/hour → Safely within limit ✓

## File Structure on GitHub Pages

```
https://laurentperrinet.github.io/2026-11_tree-of-life/
├── index.html              [Main page]
├── css/style.css          [Styling]
├── js/                    [All JavaScript modules]
├── data/terrain.json      [🔑 Shared persistent terrain]
├── package.json           [Metadata]
└── PERFORMANCE.md         [Docs]
```

## Monitoring & Debugging

### Check deployment status
```bash
# Locally
git log --oneline
git status

# On GitHub
# Settings → Pages → "Your site is live at..."
```

### Monitor terrain.json
```bash
# See history of terrain changes
git log --oneline data/terrain.json

# View current state
git show HEAD:data/terrain.json | head -20

# See timelapse (will be awesome!)
git log --format='%h %aI' -- data/terrain.json
```

### Check Pages build errors
1. Settings → Pages → "View details"
2. Check for any deployment errors (usually shows HTML issues)

## Common Issues

### Issue: OAuth redirect fails
**Solution** : Make sure:
- Client ID is set correctly in js/main.js
- OAuth app callback URL matches exactly (including https)
- Test on production URL, not localhost

### Issue: terrain.json not syncing
**Solution**:
- Check browser console (F12) for error messages
- Verify GitHub API rate limits not exceeded
- Try manual sync with `S` key
- Check network tab in DevTools

### Issue: Simulation runs but no branching
**Solution**:
- Increase flow rate (`+` key)
- Wait longer (simulation is slow by design)
- Check stability indicator (should be <95% for active flow)

## Customization

### Change grid size
In `js/main.js` line ~10:
```js
this.grid = new TerrainGrid(128, 128, 1.0);  // Increase from 64 to 128
```

### Adjust physics parameters
In `js/physics.js`:
```js
this.Q_inlet = 0.5;        // Flow rate
this.friction = 0.02;      // Water friction
this.k_transport = 0.1;    // Sediment transport
```

### Change sync intervals
In `js/github-sync.js` SyncLoop:
```js
this.fetchInterval = 15 * 1000;   // Fetch every 15s
this.commitInterval = 60 * 1000;  // Commit every 60s
```

## Reset Behaviors

### Soft Reset (`?reset=1`)
- Clears localStorage cache
- Re-fetches latest `data/terrain.json` from GitHub
- Restarts simulation with global state
- **Use when**: Local cache corrupted or want fresh start

### Hard Reset (`?reset=1&hard=1`)
- Clears all local data
- Reinitializes cirque (vierge)
- **Use when**: Simulation diverged badly and needs complete restart

### Manual Reset
- Press `R` twice (confirmation required)
- Requires GitHub authentication

## Next Steps

After deployment, you might want to:

1. **Share the link** → https://laurentperrinet.github.io/2026-11_tree-of-life/
2. **Monitor timelapse** → `git log data/terrain.json` shows evolution
3. **Invite contributors** → Share link with friends/colleagues
4. **Scale up** → When grid > 128×128, use WebGL compute shaders
5. **Add features** → Real-time multiplayer, custom terrains, etc.

## Troubleshooting Commands

```bash
# Check latest commit
git log --oneline -1

# Verify files are on GitHub
git ls-files | grep -E '\.(js|html|css|json)$'

# See current Pages build
git show --stat HEAD

# Force Pages rebuild
# (Settings → Pages → uncheck/check Source)

# Monitor file sizes
du -sh .
find . -name '*.js' -exec wc -l {} +
```

---

**All set!** 🎉 Your collaborative terrain simulation is now live.

Next visitors will:
1. See your initial cirque
2. Run simulation and contribute their own erosion patterns
3. Create a collective, evolving artwork visible in git history

Enjoy! 🌊
