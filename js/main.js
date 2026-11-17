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
        this.collaboration = new CollaborativeSync(this.grid, this.localStore);
        
        // Auth and reset
        this.auth = new AuthManager({
            clientId: 'Ov23liPHpc4sc5qUGMVx',
            redirectUri: 'https://laurentperrinet.github.io/2026-11_tree-of-life/',
            exchangeUrl: 'https://2026-11-tree-of-life.laurent-perrinet.workers.dev/api/auth/exchange'
        });
        this.reset = new ResetManager(
            this.auth, this.grid, this.physics, this.localStore, this.collaboration
        );
        
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
                    this.ui.login();
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
                params.delete('reset');
                params.delete('hard');
                const query = params.toString();
                window.history.replaceState({}, document.title,
                    window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
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
            let authError = null;
            try {
                await this.auth.initialize();
            } catch (error) {
                console.error('GitHub authentication failed:', error);
                authError = error;
            }
            this.ui.updateAdminPanel();
            this.ui.updateAuthStatus();
            
            this.localStore.load(this.grid);

            try {
                await this.collaboration.start();
            } catch (error) {
                console.error('Initial collaboration sync failed:', error);
                this.ui.showToast(`Collaboration unavailable: ${error.message}`, 'warning', 8000);
            }

            this.renderer.createTerrainMesh(this.grid);
            
            this.ui.showLoading(false);
            this.ui.showToast(authError ? authError.message : '✓ Simulation ready',
                authError ? 'error' : 'success', authError ? 8000 : 3000);
            
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
        
        // Update renderer
        this.renderer.updateTerrainMesh(this.grid);
        this.renderer.updateParticles(this.physics);
        
        // Update UI
        this.ui.updateStatus(this.grid, this.collaboration);
        
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
        this.collaboration.stop();
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
