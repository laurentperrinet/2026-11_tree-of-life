# Development Setup Guide

## Prerequisites

- **Node.js** 16+ ([install](https://nodejs.org/))
- **Git** 2.30+ ([install](https://git-scm.com/))
- **VS Code** (recommended, but any editor works)

## Installation

```bash
# Clone the repository
git clone https://github.com/laurentperrinet/2026-11_tree-of-life.git
cd 2026-11_tree-of-life

# Install development dependencies
npm install
```

## Running Locally

### Option 1: Simple HTTP Server (Recommended)
```bash
npm run dev:http
```
Opens the app at `http://localhost:8080` with auto-reload.

### Option 2: Serve (Node.js)
```bash
npm run dev
```
Opens the app at `http://localhost:3000`.

### Option 3: VS Code Live Server Extension
1. Install [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
2. Right-click `index.html` → "Open with Live Server"
3. Opens at `http://localhost:5500`

## Code Quality

### Linting (ESLint)
```bash
npm run lint          # Check for errors
npm run lint -- --fix # Auto-fix issues
```

### Formatting (Prettier)
```bash
npm run format       # Format all code
```

### Before Committing
```bash
npm run lint --fix && npm run format
```

## Project Structure

```
├── index.html           # Main HTML file
├── css/
│   └── style.css       # All styling
├── js/
│   ├── main.js         # App orchestration
│   ├── terrain.js      # 2D grid state management
│   ├── physics.js      # Hydrodynamics simulation
│   ├── renderer.js     # Three.js 3D visualization
│   ├── github-sync.js  # GitHub API + terrain merging
│   ├── auth.js         # OAuth + permissions
│   ├── controls.js     # Keyboard & mouse input
│   ├── local-storage.js # Browser storage
│   └── ui.js           # UI components & status
├── data/
│   └── terrain.json    # Shared persistent terrain
├── package.json        # Dependencies & scripts
└── .vscode/
    ├── settings.json   # VS Code settings
    ├── extensions.json # Recommended extensions
    └── launch.json     # Debug configuration
```

## VS Code Extensions (Recommended)

Install these for best development experience:
- **ESLint** - JavaScript linting
- **Prettier** - Code formatter
- **Live Server** - Local HTTP server with reload
- **GitLens** - Git integration & history
- **Copilot** - AI code completion

Auto-install: Run "Show Recommended Extensions" in VS Code.

## GitHub OAuth Setup (Production)

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create new OAuth App:
   - **Application name**: Tree of Life
   - **Homepage URL**: `https://laurentperrinet.github.io/2026-11_tree-of-life/`
   - **Authorization callback URL**: Same as above
3. Copy `Client ID` and update in `js/main.js`:
   ```js
   const clientId = 'YOUR_CLIENT_ID';
   ```

**Security Note**: For production, implement server-side token exchange (Netlify Functions, CloudFlare Workers, etc.)

## Deployment

### GitHub Pages
1. Ensure `main` branch has all changes
2. Go to repo Settings → Pages
3. Select `main` branch as source
4. Site publishes at: `https://laurentperrinet.github.io/2026-11_tree-of-life/`

### Local Testing Before Deploy
```bash
npm run build  # Verify (static files only)
npm run dev    # Test locally
```

## Debugging

### Browser DevTools
1. Press `F12` (or Cmd+Option+I on Mac)
2. Check Console for errors
3. Inspect Network tab for GitHub API calls
4. Profile Performance for simulation FPS

### VS Code Debugger
- Press F5 to attach debugger when Live Server is running
- Set breakpoints in `js/*.js` files
- Step through code and inspect variables

## Common Issues

### OAuth not working
- Check `Client ID` is correct in `js/main.js`
- Ensure redirect URL matches GitHub OAuth App settings
- Clear session storage: Press F12 → Application → Session Storage → Clear

### Terrain not syncing
- Check GitHub Personal Access Token permissions
- Verify `data/terrain.json` exists in repo
- Check browser Console for API errors

### Performance issues
- Profile with DevTools (Performance tab)
- Check if physics step is bottleneck
- Consider reducing grid size (see `js/terrain.js`)

## Testing Changes

```bash
# Format code
npm run format

# Lint code
npm run lint --fix

# Start local server
npm run dev

# Test in browser
# Navigate to http://localhost
# Check Console (F12) for errors
# Test controls (+ - ↑ ↓ D S R ?)
# Verify 3D view with mouse drag & scroll
```

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and test locally
3. Format and lint: `npm run format && npm run lint --fix`
4. Commit with descriptive message
5. Push and create Pull Request

## Performance Targets

- **FPS**: 60 on modern hardware (64×64 grid)
- **Physics step**: < 16ms
- **Render time**: < 16ms
- **GitHub sync**: 15s fetch, 60s commit

## Further Reading

- [Three.js Documentation](https://threejs.org/docs/)
- [Git Workflows](https://git-scm.com/book/en/v2)
- [ESLint Guide](https://eslint.org/docs/rules/)
- [Prettier Docs](https://prettier.io/docs/en/index.html)

---

**Questions?** Check `CODE_MAP.md` for detailed architecture documentation.
