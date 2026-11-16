/**
 * UI Manager - status badge, toasts, reset button
 */
class UIManager {
    constructor(auth, reset) {
        this.auth = auth;
        this.reset = reset;
        this.lastToastTime = 0;
        this.resetConfirmPending = false;
    }
    
    /**
     * Update status badge
     */
    updateStatus(grid, github, syncLoop) {
        const contribCount = github.contributorCount || 1;
        const lastSync = github.getSecondsSinceSync();
        const syncText = lastSync !== null ? `${lastSync}` : '--';
        
        document.getElementById('contrib-count').textContent = contribCount;
        document.getElementById('last-sync').textContent = syncText;
        
        // Energy level
        const energy = grid.totalEnergy;
        const energyPercent = Math.min(100, Math.round(energy * 100));
        document.getElementById('energy-level').textContent = energyPercent;
        
        // Auth status
        this.updateAuthStatus();
        
        // Convergence indicator
        this.updateConvergenceIndicator(grid);
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
            statusEl.textContent = `🔒 ${login}`;
            statusEl.className = 'authenticated';
            statusEl.classList.remove('pending', 'denied');
            
            authButton.textContent = '🔒 Logout';
            authButton.onclick = () => this.logout();
            
            // Show reset button if user is author
            if (this.reset.canReset()) {
                resetContainer.style.display = 'block';
            } else {
                resetContainer.style.display = 'none';
            }
        } else {
            statusEl.textContent = '🔓 Not authenticated';
            statusEl.className = 'unauthenticated';
            
            authButton.textContent = '🔓 Sign in with GitHub';
            authButton.onclick = () => this.login();
            
            resetContainer.style.display = 'none';
        }
    }
    
    /**
     * Update convergence indicator
     */
    updateConvergenceIndicator(grid) {
        const indicator = document.getElementById('convergence-indicator');
        const convergence = grid.checkConvergence();
        const stability = convergence.stability;
        
        indicator.textContent = `⊙ Stability: ${stability.toFixed(0)}%`;
        
        indicator.classList.remove('convergence-unknown', 'convergence-stable', 'convergence-unstable');
        
        if (stability > 95) {
            indicator.classList.add('convergence-stable');
            
            // Show reset button if converged and authenticated
            if (this.auth.canReset()) {
                const resetBtn = document.getElementById('reset-button');
                if (resetBtn) {
                    resetBtn.disabled = false;
                }
            }
        } else if (stability > 50) {
            indicator.classList.add('convergence-unknown');
        } else {
            indicator.classList.add('convergence-unstable');
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
        this.auth.login();
    }
    
    /**
     * Handle logout
     */
    logout() {
        this.auth.logout();
        this.updateAuthStatus();
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
                    helpToggle.style.display = helpToggle.style.display === 'none' ? 'block' : 'none';
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
    ui.updateAuthStatus();
    return ui;
}
