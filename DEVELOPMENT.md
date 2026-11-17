# Development Troubleshooting

## Issue: "Error: spawn /opt/homebrew/bin/ EACCES"

**Problem**: VS Code tries to execute a directory as Python interpreter.

**Solution**:
1. Close VS Code
2. Run: `rm -rf .vscode/settings.json`
3. Reopen VS Code
4. Accept recommended extensions
5. Extensions are automatically configured

**Why**: This project is pure JavaScript (web), not Python. The error came from misconfigured Python extension searching for interpreters in the wrong context.

---

## Issue: Ruff/Pylance Extensions Activate Unnecessarily

**Problem**: VS Code suggests Python-related extensions even though project is JavaScript-only.

**Solution**:
```bash
# Disable Python extension globally for this workspace
# In VS Code: Cmd+Shift+P → "Preferences: Open Workspace Settings (JSON)"
# Add to settings.json:
{
    "python.linting.enabled": false,
    "python.formatting.enabled": false,
    "python.analysis.disabled": ["*"],
    "[python]": {
        "editor.defaultFormatter": null
    }
}
```

Already configured in `.vscode/settings.json`.

---

## Issue: npm install Fails

**Problem**: `npm install` fails with permission or network errors.

**Solution**:
```bash
# Clear npm cache
npm cache clean --force

# Update npm
npm install -g npm@latest

# Install dependencies again
npm install
```

---

## Issue: Live Server Won't Start

**Problem**: Port 5500 or 8000 already in use, or server doesn't launch.

**Solution**:
```bash
# Option 1: Use different port
npx http-server -p 9000 -c-1 -o

# Option 2: Kill process using port
lsof -i :5500  # See what's using port 5500
kill -9 <PID>

# Option 3: Use built-in serve
npm run dev  # Uses port 3000
```

---

## Issue: GitHub OAuth Fails

**Problem**: Authentication fails with "Invalid Client ID" or "Callback URL mismatch".

**Solution**:
1. Verify Client ID in `js/main.js` is correct
2. Check GitHub OAuth App settings:
   - Go to Settings → Developer settings → OAuth Apps
   - Click on "Tree of Life" app
   - Verify **Authorization callback URL** matches exactly:
     - Local: `http://localhost:8000/` (with trailing slash)
     - Production: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
3. Clear browser storage and retry:
   - DevTools → Application → Session Storage → Delete all → Refresh

---

## Issue: Shared Terrain Doesn't Sync

The browser sends compressed elevation deltas to the Cloudflare Worker; it no
longer reads or writes `data/terrain.json`.

**Check**:
1. Open DevTools (F12) → Console and look for Worker or CORS errors.
2. Confirm `https://2026-11-tree-of-life.laurent-perrinet.workers.dev/api/state`
   returns the shared terrain.
3. Confirm the Worker has the `SIMULATION` Durable Object binding and the
   configured owner ID.
4. In the admin view, press **S** to request a sync. Manual sync still respects
   the adaptive interval.

The active-browser count is approximate and expires after 24 hours. The
80,000-request daily target is based on normal browser sync cadence; it is not
a hard limit against direct public Worker requests.

---

## Issue: Physics Simulation Runs Slowly

**Problem**: Simulation stutters, FPS drops below 60.

**Check**:
1. Open DevTools → Performance tab
2. Start recording, run simulation for 5 seconds, stop
3. Look for long bars (> 16ms = frame drop)

**Common Causes**:
- Mesh resolution too large (review `js/terrain.js`)
- Heavy 3D rendering (reduce mesh complexity)
- Worker sync errors (check the browser console and network calls)

**Solution**:
```js
// In js/terrain.js, reduce grid size temporarily:
const WIDTH = 48;  // was 64
const HEIGHT = 48; // was 64
```

---

## Issue: 3D View Not Rendering

**Problem**: Black screen or no 3D visualization.

**Check**:
1. Open DevTools → Console
2. Look for WebGL errors
3. Check browser WebGL support: https://get.webgl.org/

**Solution**:
- Update graphics drivers
- Try different browser (Chrome, Firefox, Safari)
- Check if Three.js CDN is reachable:
  ```bash
  curl -I https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
  ```

---

## Issue: "Cannot find module" Errors in Console

**Problem**: JavaScript shows "Module not found" or "is not defined".

**Causes**:
- Missing `<script>` tag in `index.html`
- Script loaded in wrong order
- Syntax errors in JS files

**Solution**:
1. Check `index.html` has all script tags:
   ```html
   <script src="js/terrain.js"></script>
   <script src="js/physics.js"></script>
   <script src="js/renderer.js"></script>
   <script src="js/collaboration.js"></script>
   <script src="js/auth.js"></script>
   <script src="js/controls.js"></script>
   <script src="js/local-storage.js"></script>
   <script src="js/ui.js"></script>
   <script src="js/main.js"></script>
   ```
2. Verify order: main.js should be last
3. Run linter: `npm run lint` to find syntax errors

---

## Issue: VS Code Formatting Not Working

**Problem**: `npm run format` doesn't format files, or formatting is inconsistent.

**Solution**:
1. Reinstall Prettier:
   ```bash
   npm install --save-dev prettier@latest
   ```
2. Verify `.prettierrc` exists with correct settings
3. Format manually:
   ```bash
   npm run format
   ```
4. If still broken, try:
   ```bash
   npx prettier --write '**/*.{js,css,html,json,md}'
   ```

---

## Issue: Git Commits Fail

**Problem**: `git commit` fails with permissions or message errors.

**Solution**:
1. Check git config:
   ```bash
   git config --list | grep user
   ```
2. Set user if missing:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your.email@example.com"
   ```
3. Retry commit:
   ```bash
   git add .
   git commit -m "Description"
   git push origin main
   ```

---

## Issue: "CORS error" in Console

**Problem**: Browser blocks requests to GitHub API with CORS error.

**Why**: Browser's Same-Origin Policy restricts cross-domain API calls.

**Solution** (Current Limitation):
- This project currently does client-side OAuth, which has CORS limitations
- **Recommended Fix**: Implement server-side token exchange
  - Use Netlify Functions or CloudFlare Workers
  - Exchange client token for secure token server-side
  - Proxy GitHub API calls through server

**Temporary Workaround** (not recommended):
```bash
# Test with browser CORS disabled (not secure!)
# Chrome: chromium-browser --disable-web-security
```

---

## Issue: Can't Clear Browser Cache

**Problem**: Old code still running even after changes.

**Solution**:
```bash
# Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

# Or clear in DevTools:
# F12 → Application → Cache Storage → Clear All

# Or disable cache in DevTools:
# F12 → Settings → Network → "Disable cache (while DevTools is open)"
```

---

## Quick Diagnostics

Run this to check environment setup:

```bash
#!/bin/bash
echo "=== Node.js ===" && node --version
echo "=== npm ===" && npm --version
echo "=== Git ===" && git --version
echo "=== Dependencies ===" && npm list --depth=0
echo "=== Project Files ===" && ls -la index.html js/ data/
echo "=== Config Files ===" && ls -la .vscode/ .prettierrc .eslintrc.json
```

---

## Getting Help

1. **Check logs**: DevTools Console (F12)
2. **Read error messages carefully**: They usually tell you what's wrong
3. **Check network**: DevTools Network tab (F12 → Network)
4. **Search GitHub issues**: Similar problems might be documented
5. **Check documentation**: See `README.md` and `CODE_MAP.md`

---

**Last updated**: 2026-11-16  
**Maintainer**: Laurent Perrinet
