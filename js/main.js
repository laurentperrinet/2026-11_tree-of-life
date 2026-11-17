/**
 * Main application - orchestrates simulation, rendering, sync
 */
class Application {
    constructor() {
        this.canvas = document.getElementById('canvas');
        
        // Create core systems
        this.grid = new TerrainGrid();
        this.physics = new PhysicsEngine(this.grid);
        this.renderer = new TerrainRenderer(this.canvas);
        
        // Storage and sync
        this.localStore = new LocalStorageManager();
        this.github = new GitHubSync({
            owner: 'laurentperrinet',
            repo: '2026-11_tree-of-life',
            filePath: 'data/terrain.json'
        });
        this.syncLoop = new SyncLoop(this.grid, this.physics, this.github, this.localStore);
        
        // Auth and reset
        this.auth = new AuthManager({
            clientId: 'YOUR_GITHUB_OAUTH_CLIENT_ID', // Set in deployment
            redirectUri: window.location.origin
        });
        this.reset = new ResetManager(this.auth, this.grid, this.physics, this.localStore, this.github);
        
        // UI
        this.ui = initializeUI(this.auth, this.reset);
        
        // Input
        this.controls = new InputControls(this.renderer);
        
        // Timing
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.fps = 60;
        
        // Check URL params
        this.handleUrlParams();
    }
    
    /**
     * Handle URL parameters
     * ?reset=1 : Trigger soft reset
     * ?reset=1&hard=1 : Trigger hard reset
     */
    handleUrlParams() {
        const params = new URLSearchParams(window.location.search);
        
        if (params.has('reset')) {
            const isHard = params.has('hard');
            
            // Trigger after UI is ready
            setTimeout(async () => {
                if (!this.reset.canReset()) {
                    this.ui.showToast('Reset requires authentication', 'error');
                    this.auth.login(); // Redirect to login
                    return;
                }
                
                if (isHard) {
                    const result = await this.reset.hardReset(true);
                    if (result === true) {
                        this.ui.showToast('Hard reset executed', 'success');
                    }
                } else {
                    const success = await this.reset.softReset();
                    if (success) {
                        this.ui.showToast('Soft reset executed', 'success');
                    }
                }
                
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }, 1000);
        }
    }
    
    /**
     * Initialize application
     */
    async initialize() {
        this.ui.showLoading(true);
        
        try {
            // Initialize auth
            await this.auth.initialize();
            this.ui.updateAuthStatus();
            
            // Try to load from localStorage
            const loaded = this.localStore.load(this.grid);
            
            if (!loaded) {
                // Try to fetch from GitHub
                const remote = await this.github.fetchTerrain();
                if (remote) {
                    if (!this.grid.fromJSON(remote)) {
                        this.ui.showToast('Saved terrain is incompatible; starting a new bed', 'warning');
                    }
                } else {
                    this.ui.showToast('No saved terrain found, using a fresh bed', 'info');
                }
            }
            
            // Create renderer mesh
            this.renderer.createTerrainMesh(this.grid);
            
            // Setup GitHub sync integration
            if (this.auth.token) {
                this.github.setToken(this.auth.token);
            }
            
            // Start sync loop
            this.syncLoop.start();
            
            this.ui.showLoading(false);
            this.ui.showToast('✓ Simulation ready', 'success');
            
            // Start main loop
            this.animate();
        } catch (error) {
            console.error('Initialization error:', error);
            this.ui.showLoading(false);
            this.ui.showToast('✗ Initialization failed', 'error');
        }
    }
    
    /**
     * Main animation loop
     */
    animate() {
        const now = performance.now();
        const deltaTime = (now - this.lastRenderTime) / 1000;
        this.lastRenderTime = now;
        
        // Physics step
        this.physics.step();
        
        // Track changes for sync
        this.syncLoop.recordChange(Math.round(Math.random() * 5)); // Simplified
        
        // Update renderer
        this.renderer.updateTerrainMesh(this.grid);
        this.renderer.updateParticles(this.physics);
        
        // Update UI
        this.ui.updateStatus(this.grid, this.github, this.syncLoop);
        
        // Render
        this.renderer.render();
        
        // FPS counter
        this.frameCount++;
        
        // Continue loop
        requestAnimationFrame(() => this.animate());
    }
    
    /**
     * Cleanup on unload
     */
    dispose() {
        this.syncLoop.stop();
        this.renderer.dispose();
    }
}

/**
 * Application entry point
 */
let app;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        app = new Application();
        window.app = app; // Global reference for debugging
        await app.initialize();
    } catch (error) {
        console.error('Fatal error:', error);
        document.body.innerHTML += `
            <div style="color: red; padding: 20px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); border-radius: 8px;">
                <h2>Error initializing application</h2>
                <p>${error.message}</p>
                <p>Check browser console for details</p>
            </div>
        `;
    }
});

window.addEventListener('beforeunload', () => {
    if (app) {
        app.dispose();
    }
});
