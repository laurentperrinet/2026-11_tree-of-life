/**
 * Main application - orchestrates simulation, rendering, sync
 */
class Application {
    constructor() {
        this.canvas = document.getElementById('canvas');
        
        // Create core systems
        this.grid = new TerrainGrid();
        this.physics = new PhysicsEngine(this.grid);
        this.biology = new BiologyGrid(this.grid);
        this.renderer = new TerrainRenderer(this.canvas);
        
        // Storage and sync
        this.localStore = new LocalStorageManager();
        this.biologyStore = new LocalStorageManager('tree-of-life-local-biology-v3', null);
        this.simulationTime = new SimulationTimeTracker();
        // Served by tools/timelapse_server.py (timelapse in Safari): the Worker only
        // accepts the GitHub Pages origin, so sync goes through the server's
        // same-origin relay instead.
        this.collaboration = new CollaborativeSync(this.grid, this.localStore,
            TimelapseRecorder.isLocal(window.location)
                ? { endpoint: `${window.location.origin}/api/sync` } : {});
        
        // Auth and reset
        this.auth = new AuthManager({
            clientId: 'Ov23liPHpc4sc5qUGMVx',
            redirectUri: 'https://laurentperrinet.github.io/2026-11_tree-of-life/',
            exchangeUrl: 'https://tree-of-life.laurent-perrinet.workers.dev/api/auth/exchange'
        });
        this.reset = new ResetManager(
            this.auth, this.grid, this.physics, this.localStore, this.collaboration,
            this.biology, this.biologyStore
        );
        
        // UI
        this.ui = initializeUI(this.auth, this.reset);
        
        // Input
        this.controls = new InputControls(this.renderer);

        // Admin timelapse: local PNG frames of the default view
        this.timelapse = new TimelapseRecorder(this.renderer);
        this.ui.setupTimelapse(this.timelapse);
        
        // Timing
        this.lastRenderTime = 0;
        this.lastBiologySaveTime = 0;
        this.biologySaveFailed = false;
        this.simulationTimeSaveFailed = false;
        this.biologyLoaded = false;
        this.frameCount = 0;
        this.fps = 60;
        this.lastFrameErrorTime = 0;
        
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
            
            // Allow the ready notification to be displayed before resetting.
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
                    } else {
                        this.ui.showToast('Hard reset failed', 'error');
                    }
                } else {
                    const success = await this.reset.softReset();
                    if (success) {
                        this.ui.showToast('Soft reset executed', 'success');
                    } else {
                        this.ui.showToast('Soft reset failed', 'error');
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
            
            const loaded = this.localStore.load(this.grid);
            let biologyDiscarded = false;
            if (!this.biologyStore.load(this.biology)) {
                // An unreadable save (older format, corrupt value) must not stop the
                // simulation: the biology is purely local, so restarting it is harmless.
                // BiologyGrid.fromJSON() validates before writing, so the fields are intact.
                if (this.biologyStore.getSize() > 0) {
                    console.warn('Discarding unreadable local biology save');
                    biologyDiscarded = true;
                } else if (loaded && this.grid.hasLegacyBiology) {
                    this.biology.importLegacy();
                }
                // Storage may be full or disabled (private browsing): keep running, and
                // let the periodic save in animate() report the failure.
                if (!this.biologyStore.save(this.biology)) {
                    console.error('Could not save local biology');
                }
            }
            this.biologyLoaded = true;

            try {
                await this.collaboration.start();
            } catch (error) {
                console.error('Initial collaboration sync failed:', error);
                this.ui.showToast(`Collaboration unavailable: ${error.message}`, 'warning', 8000);
            }

            this.biology.updateSand();
            this.renderer.createTerrainMesh(this.grid, this.biology);
            
            this.ui.showLoading(false);
            // One final toast: a later call would replace an earlier one immediately.
            if (authError) {
                this.ui.showToast(authError.message, 'error', 8000);
            } else if (biologyDiscarded) {
                this.ui.showToast('✓ Simulation ready; local vegetation could not be restored and restarts',
                    'warning', 8000);
            } else {
                this.ui.showToast('✓ Simulation ready', 'success', 3000);
            }
            
            this.handleUrlParams();
            // Start the clock now, so that the start-up time is not credited to the
            // first physics step.
            this.lastRenderTime = performance.now();
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

        try {
        // The physics step follows wall-clock time, so the simulated time per second
        // does not depend on the device's frame rate (within maxFrameSeconds).
        const dt = this.physics.step(deltaTime);
        this.simulationTime.add(dt);
        this.biology.step(dt);
        if (now - this.lastBiologySaveTime >= 5000) {
            this.lastBiologySaveTime = now;
            const saved = this.biologyStore.save(this.biology);
            if (!saved && !this.biologySaveFailed) {
                this.ui.showToast('Could not save local biology', 'error', 8000);
            }
            this.biologySaveFailed = !saved;
            try {
                this.simulationTime.save();
                this.simulationTimeSaveFailed = false;
            } catch (error) {
                console.error('Could not save simulation time:', error);
                if (!this.simulationTimeSaveFailed) {
                    this.ui.showToast('Could not save simulation time', 'error', 8000);
                }
                this.simulationTimeSaveFailed = true;
            }
        }
        
        // Update renderer
        this.renderer.updateTerrainMesh(this.grid, this.biology);
        this.renderer.updateParticles(this.physics);
        
        // Update UI
        this.ui.updateStatus(this.collaboration, this.physics, now, this.simulationTime);
        
        // Render
        this.renderer.render();
        // After the frame's state is final, so a frame matches what was just shown.
        this.timelapse?.update(now, this.grid, this.biology);

        // FPS counter
        this.frameCount++;
        } catch (error) {
            // A broken frame must not kill the loop: report once per 10 s and let
            // the next frame try again.
            console.error('Animation frame failed:', error);
            if (now - this.lastFrameErrorTime >= 10000) {
                this.lastFrameErrorTime = now;
                this.ui.showToast(`Animation error: ${error.message}`, 'error', 8000);
            }
        } finally {
            // Continue loop
            requestAnimationFrame(() => this.animate());
        }
    }
    
    /**
     * Cleanup on unload
     */
    dispose() {
        this.controls.dispose();
        this.collaboration.stop();
        this.timelapse?.stop();
        try {
            this.simulationTime.save();
        } catch (error) {
            console.error('Could not save simulation time on exit:', error);
        }
        if (this.biologyLoaded && !this.biologyStore.save(this.biology)) {
            console.error('Could not save local biology on exit');
        }
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
        // Build the overlay with DOM nodes: the message is interpolated as text,
        // never as HTML, and the existing page content is left intact.
        const overlay = document.createElement('div');
        overlay.style.cssText = 'color: red; padding: 20px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); border-radius: 8px; z-index: 1000;';
        const title = document.createElement('h2');
        title.textContent = 'Error initializing application';
        const message = document.createElement('p');
        message.textContent = error.message;
        const hint = document.createElement('p');
        hint.textContent = 'Check browser console for details';
        overlay.append(title, message, hint);
        document.body.appendChild(overlay);
    }
});

window.addEventListener('beforeunload', () => {
    if (app) {
        app.dispose();
    }
});
