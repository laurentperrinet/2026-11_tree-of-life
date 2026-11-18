/**
 * Format an elapsed wall-clock duration compactly (s, min, h, d).
 *
 * Args:
 *   seconds: Elapsed time (s), non-negative.
 */
function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
    return `${Math.floor(seconds / 86400)} d`;
}

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
        this.displayModeTimer = null;
        this.simulationTimeReadFailed = false;
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
    updateStatus(collaboration, physics, now, simulationTime) {
        if (now - this.lastStatusUpdate < 1000) return;
        this.lastStatusUpdate = now;

        // Older Workers report only the 24 h count, which then stands alone.
        const total = collaboration.totalCollaborators;
        const online = collaboration.onlineCollaborators;
        const contribCount = total === null || total === undefined
            ? `${collaboration.activeCollaborators || 0}`
            : `${total}${online === null || online === undefined ? '' : ` (${online})`}`;
        const lastSync = collaboration.getSecondsSinceSync();
        const syncText = lastSync !== null ? `${lastSync}` : '--';
        
        document.getElementById('contrib-count').textContent = contribCount;
        document.getElementById('last-sync').textContent = syncText;
        const nextSync = collaboration.getSecondsUntilSync();
        document.getElementById('next-sync').textContent = nextSync === null ? '--' : `${nextSync}`;
        const nextMerge = collaboration.getSecondsUntilMerge();
        document.getElementById('next-merge').textContent = nextMerge === null ? '--' : `${nextMerge}`;
        const pending = collaboration.pendingContributions;
        document.getElementById('pending-contributions').textContent =
            pending > 0 ? ` (${pending})` : '';
        const lastMerge = collaboration.getLastMerge();
        document.getElementById('last-merge').textContent = lastMerge === null ? '--'
            : `v${lastMerge.version} · ${lastMerge.contributors}${lastMerge.includesYou ? ' ✓' : ''} · ` +
              formatElapsed(lastMerge.secondsAgo);
        try {
            document.getElementById('simulation-time').textContent = Math.floor(simulationTime.getTotal());
            this.simulationTimeReadFailed = false;
        } catch (error) {
            document.getElementById('simulation-time').textContent = '--';
            if (!this.simulationTimeReadFailed) {
                console.error('Could not read simulation time:', error);
                this.showToast('Could not read simulation time', 'error', 8000);
            }
            this.simulationTimeReadFailed = true;
        }

        const transitTime = physics.getMeanTransitTime();
        document.getElementById('mean-transit-time').textContent =
            transitTime === null ? '--' : transitTime.toFixed(1);
        document.getElementById('particle-throughput').textContent =
            physics.getParticleThroughput().toFixed(2);

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

    showDisplayMode(mode) {
        const notice = document.getElementById('display-mode-notice');
        notice.textContent = mode;
        notice.hidden = false;
        clearTimeout(this.displayModeTimer);
        this.displayModeTimer = setTimeout(() => {
            notice.hidden = true;
        }, 2000);
    }
    
    /**
     * Wire the admin panel's timelapse button to a TimelapseRecorder.
     *
     * Recording is local to this computer and touches no shared state, so it is
     * available with `?admin` without signing in (e.g. on an exhibition machine).
     * It needs the page to be served by tools/timelapse_server.py.
     *
     * Args:
     *   timelapse: TimelapseRecorder; its onChange and onError are set here.
     */
    setupTimelapse(timelapse) {
        const button = document.getElementById('timelapse-button');
        const status = document.getElementById('timelapse-status');
        if (!button || !status) return;
        const local = TimelapseRecorder.isLocal(window.location);
        const refresh = () => {
            button.textContent = timelapse.active ? '⏹ Stop timelapse' : '📷 Start timelapse';
            button.disabled = !local;
            let text = '';
            if (!local) {
                text = 'Timelapse: run python3 tools/timelapse_server.py, then open ' +
                    'http://localhost:8765/?admin';
            } else if (timelapse.folder && (timelapse.active || timelapse.lastFile)) {
                const last = timelapse.lastFile ? `, last ${timelapse.lastFile}` : '';
                text = `${timelapse.active ? 'Recording' : 'Stopped'}: ${timelapse.framesWritten} ` +
                    `frames${last} in ${timelapse.folder} · commit ${timelapse.commit.slice(0, 7)}` +
                    (timelapse.commit.endsWith('-dirty') ? ' (modified)' : '');
                const video = timelapse.video;
                if (!timelapse.active && video?.state === 'encoding') text += ' · encoding video…';
                if (!timelapse.active && video?.state === 'done') {
                    text += ` · video ${video.path} (${video.frames} frames, ${video.seconds.toFixed(1)} s)`;
                }
            }
            status.textContent = text;
            status.hidden = text === '';
        };
        timelapse.onChange = refresh;
        timelapse.onError = error => this.showToast(`Timelapse stopped: ${error.message}`, 'error', 8000);
        button.addEventListener('click', async () => {
            if (timelapse.active) {
                // A new recording may start while the video encodes: the server
                // encodes again afterwards, so the video covers every frame.
                this.showToast('Timelapse stopped, encoding video…', 'info');
                try {
                    const video = await timelapse.finish();
                    this.showToast(`✓ Video saved: ${video.path}`, 'success', 8000);
                } catch (error) {
                    this.showToast(`Video not made: ${error.message}`, 'error', 8000);
                }
                refresh();
                return;
            }
            try {
                await timelapse.start();
                this.showToast('Timelapse recording', 'success');
            } catch (error) {
                this.showToast(error.message, 'error', 8000);
            }
            refresh();
        });
        refresh();
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
        const statusHelp = document.getElementById('status-help-dialog');
        const statusHelpButton = document.getElementById('status-help-button');
        const statusHelpClose = document.getElementById('status-help-close');
        if (statusHelp && statusHelpButton && statusHelpClose) {
            statusHelpButton.addEventListener('click', () => statusHelp.showModal());
            statusHelpClose.addEventListener('click', () => statusHelp.close());
        }

        const displayModeButton = document.getElementById('display-mode-button');
        if (displayModeButton) {
            displayModeButton.addEventListener('click', () => window.app?.controls?.cycleDisplayMode());
        }

        // Clicking the bar itself toggles full screen; its buttons and links keep their own action
        const statusBadge = document.getElementById('status-badge');
        if (statusBadge) {
            statusBadge.addEventListener('click', (event) => {
                if (event.target.closest('button, a')) return;
                window.app?.controls?.toggleFullscreen();
            });
        }

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
