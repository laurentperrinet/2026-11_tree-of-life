/**
 * Input controls - keyboard and mouse
 */
class InputControls {
    constructor(renderer) {
        this.renderer = renderer;
        this.camera = renderer.camera;
        
        // Mouse controls
        this.mouse = { x: 0, y: 0, down: false };
        this.cameraRotation = { x: 1.0, y: 0 };
        this.cameraDistance = 50;
        
        // Setup listeners
        this.setupKeyboardListener();
        this.setupMouseListener();
    }
    
    /**
     * Setup keyboard event listener
     */
    setupKeyboardListener() {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    }
    
    /**
     * Handle keyboard input
     */
    onKeyDown(event) {
        const app = window.app;
        if (!app || !new URLSearchParams(window.location.search).has('admin')) return;
        
        // Prevent defaults for control keys
        if (['ArrowUp', 'ArrowDown', '+', '-', 'd', 's', 'r', 'D', 'S', 'R', '?'].includes(event.key)) {
            event.preventDefault();
        }
        
        switch (event.key.toUpperCase()) {
            // Flow rate control
            case '+':
            case '=':
                app.physics.Q_inlet = Math.min(2.0, app.physics.Q_inlet + 0.1);
                app.ui.showToast(`Flow rate: ${app.physics.Q_inlet.toFixed(2)}`, 'info');
                break;
            case '-':
            case '_':
                app.physics.Q_inlet = Math.max(0, app.physics.Q_inlet - 0.1);
                app.ui.showToast(`Flow rate: ${app.physics.Q_inlet.toFixed(2)}`, 'info');
                break;
            
            // Speed control
            case 'ARROWUP':
                app.physics.timeScale = Math.min(5.0, app.physics.timeScale * 1.5);
                app.ui.showToast(`Speed: ${app.physics.timeScale.toFixed(1)}x`, 'info');
                break;
            case 'ARROWDOWN':
                app.physics.timeScale = Math.max(0.1, app.physics.timeScale / 1.5);
                app.ui.showToast(`Speed: ${app.physics.timeScale.toFixed(1)}x`, 'info');
                break;
            
            // Display mode
            case 'D':
                this.renderer.cycleDisplayMode();
                app.ui.showToast(`Mode: ${this.renderer.displayMode}`, 'info');
                break;
            
            // Force sync
            case 'S':
                app.ui.showToast('Forcing GitHub sync...', 'warning');
                app.syncLoop.fetchAndMerge();
                break;
            
            // Reset (if authorized)
            case 'R':
                if (app.reset.canReset()) {
                    app.ui.confirmReset();
                } else {
                    app.ui.showToast('Reset requires authentication', 'error');
                }
                break;
            
            // Toggle help
            case '?':
                this.toggleHelp();
                break;
        }
    }
    
    /**
     * Setup mouse event listener
     */
    setupMouseListener() {
        document.addEventListener('mousedown', (e) => this.onMouseDown(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));
        document.addEventListener('wheel', (e) => this.onMouseWheel(e), { passive: false });
    }
    
    /**
     * Handle mouse down
     */
    onMouseDown(event) {
        // Only track drags on canvas
        if (event.target !== this.renderer.canvas) return;
        
        this.mouse.down = true;
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
    }
    
    /**
     * Handle mouse move
     */
    onMouseMove(event) {
        if (!this.mouse.down) return;
        
        const dx = event.clientX - this.mouse.x;
        const dy = event.clientY - this.mouse.y;
        
        this.cameraRotation.y += dx * 0.005;
        this.cameraRotation.x += dy * 0.005;
        
        // Clamp x rotation
        this.cameraRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraRotation.x));
        
        this.updateCameraPosition();
        
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
    }
    
    /**
     * Handle mouse up
     */
    onMouseUp(event) {
        this.mouse.down = false;
    }
    
    /**
     * Handle mouse wheel (zoom)
     */
    onMouseWheel(event) {
        event.preventDefault();
        
        const zoomSpeed = 0.5;
        const direction = event.deltaY > 0 ? 1 : -1;
        
        this.cameraDistance = Math.max(10, Math.min(100, this.cameraDistance + direction * zoomSpeed));
        this.updateCameraPosition();
    }
    
    /**
     * Update camera position based on rotation and distance
     */
    updateCameraPosition() {
        const distance = this.cameraDistance;
        const phi = this.cameraRotation.x;
        const theta = this.cameraRotation.y;
        
        this.camera.position.x = distance * Math.sin(theta) * Math.cos(phi);
        this.camera.position.y = distance * Math.sin(phi);
        this.camera.position.z = -10 + distance * Math.cos(theta) * Math.cos(phi);
        
        this.camera.lookAt(0, 0, -10);
    }
    
    /**
     * Toggle help panel visibility
     */
    toggleHelp() {
        const helpPanel = document.getElementById('help-panel');
        if (helpPanel) {
            helpPanel.hidden = !helpPanel.hidden;
        }
    }
}
