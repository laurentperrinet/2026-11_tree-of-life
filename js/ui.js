/**
 * UI Manager - status badge, toasts, reset button
 */
class UIManager {
    constructor(auth, reset) {
        this.auth = auth;
        this.reset = reset;
        this.lastToastTime = 0;
        this.resetConfirmPending = false;
        this.lastStatusUpdate = -Infinity;
    }

    updateAdminPanel() {
        const adminRequested = new URLSearchParams(window.location.search).has('admin');
        const panel = document.getElementById('help-panel');
        if (panel) panel.hidden = !adminRequested;

        const authenticated = adminRequested && this.auth.isAuthenticated;
        const controls = document.getElementById('admin-controls');
        const accessMessage = document.getElementById('admin-access-message');
        if (controls) controls.hidden = !authenticated;
        if (accessMessage) accessMessage.hidden = authenticated;
    }
    
    /**
     * Update status badge
     */
    updateStatus(collaboration, physics, now) {
        if (now - this.lastStatusUpdate < 1000) return;
        this.lastStatusUpdate = now;

        const contribCount = collaboration.activeCollaborators || 0;
        const lastSync = collaboration.getSecondsSinceSync();
        const syncText = lastSync !== null ? `${lastSync}` : '--';
        
        document.getElementById('contrib-count').textContent = contribCount;
        document.getElementById('last-sync').textContent = syncText;

        const transitTime = physics.getMeanTransitTime();
        document.getElementById('mean-transit-time').textContent =
            transitTime === null ? '--' : transitTime.toFixed(1);
        document.getElementById('sand-throughput').textContent =
            physics.getSandThroughput().toFixed(3);

        // Auth status
        this.updateAuthStatus();
    }
    
    /**
     * Update authentication status display
     */
    updateAuthStatus() {
        const statusEl = document.getElementById('auth-status');
        const authButton = document.getElementById('auth-button');
        const resetContainer = document.getElementById('reset-container');
        
        if (this.auth.isAuthenticated) {
            const login = this.auth.getUserLogin();
            statusEl.hidden = false;
            statusEl.textContent = `🔒 ${login}`;
            statusEl.className = 'authenticated';
            statusEl.classList.remove('pending', 'denied');
            
            authButton.textContent = '🔒 Logout';
            
            // Show reset button if user is author
            if (this.reset.canReset()) {
                resetContainer.style.display = 'block';
            } else {
                resetContainer.style.display = 'none';
            }
        } else {
            statusEl.hidden = true;
            statusEl.textContent = '';
            statusEl.className = 'unauthenticated';
            
            authButton.textContent = this.auth.isConfigured()
                ? '🔓 Sign in with GitHub' : '🔓 GitHub sign-in unavailable';
            
            resetContainer.style.display = 'none';
        }
    }
    
    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('toast');
        
        toast.textContent = message;
        toast.className = `toast visible ${type}`;
        
        // Prevent spam
        const now = Date.now();
        if (now - this.lastToastTime < 500) return;
        this.lastToastTime = now;
        
        setTimeout(() => {
            toast.classList.remove('visible');
        }, duration);
    }
    
    /**
     * Confirm reset before executing
     */
    confirmReset() {
        if (this.resetConfirmPending) {
            // Second press = execute
            this.executeReset();
        } else {
            // First press = confirm
            this.showToast('Press R again to confirm reset', 'warning', 2000);
            this.resetConfirmPending = true;
            setTimeout(() => {
                this.resetConfirmPending = false;
            }, 3000);
        }
    }
    
    /**
     * Execute reset
     */
    async executeReset() {
        this.resetConfirmPending = false;
        this.showToast('Resetting terrain...', 'warning');
        
        const success = await this.reset.softReset();
        
        if (success) {
            this.showToast('✓ Terrain reset successfully', 'success');
        } else {
            this.showToast('✗ Reset failed', 'error');
        }
    }
    
    /**
     * Handle login
     */
    login() {
        try {
            this.auth.login();
        } catch (error) {
            console.error('GitHub sign-in unavailable:', error);
            this.showToast(error.message, 'error', 8000);
        }
    }
    
    /**
     * Handle logout
     */
    logout() {
        this.auth.logout();
        this.updateAuthStatus();
        this.updateAdminPanel();
        this.showToast('Logged out', 'info');
    }
    
    /**
     * Show loading spinner
     */
    showLoading(show = true) {
        const spinner = document.getElementById('loading-spinner');
        spinner.style.display = show ? 'block' : 'none';
    }
    
    /**
     * Setup event listeners for UI elements
     */
    setupEventListeners(auth, reset) {
        // Auth button
        const authButton = document.getElementById('auth-button');
        if (authButton) {
            authButton.addEventListener('click', () => {
                if (auth.isAuthenticated) {
                    this.logout();
                } else {
                    this.login();
                }
            });
        }
        
        // Reset button
        const resetButton = document.getElementById('reset-button');
        if (resetButton) {
            resetButton.addEventListener('click', () => this.confirmReset());
        }
        
        // Keyboard shortcut info
        const helpToggle = document.getElementById('help-panel');
        if (helpToggle) {
            helpToggle.addEventListener('click', (e) => {
                if (e.target === helpToggle) {
                    helpToggle.hidden = true;
                }
            });
        }
    }
}

/**
 * Initialize UI when page loads
 */
function initializeUI(auth, reset) {
    const ui = new UIManager(auth, reset);
    ui.setupEventListeners(auth, reset);
    ui.updateAdminPanel();
    ui.updateAuthStatus();
    return ui;
}
