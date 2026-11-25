/**
 * Input controls - keyboard and mouse
 */
class InputControls {
    constructor(renderer) {
        this.renderer = renderer;
        this.camera = renderer.camera;
        
        // Mouse controls
        this.mouse = { x: 0, y: 0, down: false };
        const { x, y, z } = this.camera.position;
        this.cameraRotation = { x: Math.atan2(y, Math.hypot(x, z)), y: Math.atan2(x, z) };
        this.cameraDistance = Math.hypot(x, y, z);
        
        // Setup listeners
        this.setupKeyboardListener();
        this.setupMouseListener();
    }
    
    /**
     * Setup keyboard event listener
     */
    setupKeyboardListener() {
        // Kept as named handlers so dispose() can remove them again.
        this.onKeyDownListener = (e) => this.onKeyDown(e);
        document.addEventListener('keydown', this.onKeyDownListener);
    }
    
    /**
     * Handle keyboard input
     */
    onKeyDown(event) {
        const app = window.app;
        if (!app) return;
        if (event.target?.closest?.('#status-help-dialog[open]')) return;

        if (this.isPlainKey(event, 'D')) {
            event.preventDefault();
            this.cycleDisplayMode();
            return;
        }

        // Ignored on key repeat, so that holding F does not flicker full screen on and off
        if (this.isPlainKey(event, 'F') && !event.repeat) {
            event.preventDefault();
            this.toggleFullscreen();
            return;
        }

        if (!app.auth?.isAuthenticated ||
            !new URLSearchParams(window.location.search).has('admin')) return;
        
        // Prevent defaults for control keys
        if (['ArrowUp', 'ArrowDown', 's', 'r', 'S', 'R', '?'].includes(event.key)) {
            event.preventDefault();
        }

        switch (event.key.toUpperCase()) {
            // Speed control: the only rate control, since the former "flow rate"
            // merely scaled the time step too.
            case 'ARROWUP':
                app.physics.timeScale = Math.min(5.0, app.physics.timeScale * 1.5);
                app.ui.showToast(`Speed: ${app.physics.timeScale.toFixed(1)}x`, 'info');
                break;
            case 'ARROWDOWN':
                app.physics.timeScale = Math.max(0.1, app.physics.timeScale / 1.5);
                app.ui.showToast(`Speed: ${app.physics.timeScale.toFixed(1)}x`, 'info');
                break;
            
            // Force sync
            case 'S':
                app.collaboration.fetchAndMerge().then(
                    synced => app.ui.showToast(
                        synced ? 'Collaboration synchronized' : 'Sync is already rate-limited',
                        synced ? 'success' : 'info'
                    ),
                    error => app.ui.showToast(error.message, 'error', 8000)
                );
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
     * True when a single letter key was pressed on its own, outside any text field.
     *
     * Args:
     *   event: KeyboardEvent.
     *   letter: Upper-case letter to match, for example 'D'.
     */
    isPlainKey(event, letter) {
        return event.key.toUpperCase() === letter && !event.ctrlKey && !event.metaKey &&
            !event.altKey && !event.target?.isContentEditable &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
    }

    cycleDisplayMode() {
        this.renderer.cycleDisplayMode();
        window.app.ui.showDisplayMode(this.renderer.displayMode);
    }

    /**
     * Enter or leave full-screen mode for the whole page.
     *
     * Browsers only accept the request inside a user gesture, which both the F key
     * and a click on the status bar provide. Safari still needs the webkit-prefixed
     * methods. Pressing Escape leaves full screen natively, without this code.
     */
    toggleFullscreen() {
        const ui = window.app?.ui;
        const leaving = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        const method = leaving
            ? (document.exitFullscreen || document.webkitExitFullscreen)
            : (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
        if (!method) {
            ui?.showToast('Full screen is not supported by this browser', 'error');
            return;
        }
        const target = leaving ? document : document.documentElement;
        // The Promise wrapper also turns a synchronous throw into a rejection
        new Promise(resolve => resolve(method.call(target))).catch(() =>
            ui?.showToast('Full screen was refused by the browser', 'error'));
    }
    
    /**
     * Setup mouse event listener
     */
    setupMouseListener() {
        this.onMouseDownListener = (e) => this.onMouseDown(e);
        this.onMouseMoveListener = (e) => this.onMouseMove(e);
        this.onMouseUpListener = (e) => this.onMouseUp(e);
        this.onMouseWheelListener = (e) => this.onMouseWheel(e);
        document.addEventListener('mousedown', this.onMouseDownListener);
        document.addEventListener('mousemove', this.onMouseMoveListener);
        document.addEventListener('mouseup', this.onMouseUpListener);
        document.addEventListener('wheel', this.onMouseWheelListener, { passive: false });
    }

    /**
     * Remove every document listener registered by this object.
     */
    dispose() {
        document.removeEventListener('keydown', this.onKeyDownListener);
        document.removeEventListener('mousedown', this.onMouseDownListener);
        document.removeEventListener('mousemove', this.onMouseMoveListener);
        document.removeEventListener('mouseup', this.onMouseUpListener);
        document.removeEventListener('wheel', this.onMouseWheelListener);
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
        // Let the help dialog scroll natively, and only zoom for the canvas:
        // anywhere else (panels, dialogs) the wheel must be left alone.
        if (event.target?.closest?.('#status-help-dialog')) return;
        if (event.target !== this.renderer.canvas) return;
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
        this.camera.position.z = distance * Math.cos(theta) * Math.cos(phi);
        this.camera.up.set(-Math.sin(theta) * Math.sin(phi), Math.cos(phi),
            -Math.cos(theta) * Math.sin(phi));

        this.camera.lookAt(0, 0, 0);
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
