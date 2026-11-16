/**
 * GitHub OAuth2 authentication manager
 * Handles login and token management for reset permissions
 */
class AuthManager {
    constructor(config = {}) {
        this.clientId = config.clientId || 'YOUR_GITHUB_CLIENT_ID'; // Will be set in deployment
        this.redirectUri = config.redirectUri || window.location.origin;
        this.scopes = config.scopes || ['user:email'];
        
        this.user = null;
        this.token = null;
        this.isAuthenticated = false;
    }
    
    /**
     * Initialize auth from URL params or session storage
     */
    async initialize() {
        // Check if we're returning from OAuth callback
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        
        if (code) {
            await this.exchangeCode(code);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }
        
        // Check session storage for token
        const sessionMgr = new SessionStorageManager();
        const token = sessionMgr.getToken();
        
        if (token) {
            this.token = token;
            this.isAuthenticated = true;
            await this.fetchUser();
        }
    }
    
    /**
     * Get OAuth login URL
     */
    getLoginUrl() {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scopes.join(' '),
            allow_signup: 'false',
            state: this.generateRandomState()
        });
        
        return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
    
    /**
     * Start OAuth flow
     */
    login() {
        if (!this.clientId || this.clientId === 'YOUR_GITHUB_CLIENT_ID') {
            console.error('GitHub Client ID not configured');
            return;
        }
        
        window.location.href = this.getLoginUrl();
    }
    
    /**
     * Exchange authorization code for access token
     * NOTE: In production, this should be done server-side to avoid exposing tokens
     */
    async exchangeCode(code) {
        try {
            // For demo/testing, we'll use a backend endpoint
            // In real implementation, use Netlify functions or similar
            const response = await fetch('/api/auth/github/callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            
            if (!response.ok) {
                console.error('Token exchange failed');
                return false;
            }
            
            const data = await response.json();
            this.token = data.access_token;
            
            // Store in session storage (not localStorage!)
            const sessionMgr = new SessionStorageManager();
            sessionMgr.saveToken(this.token);
            
            // Fetch user info to verify
            this.isAuthenticated = await this.fetchUser();
            return this.isAuthenticated;
        } catch (error) {
            console.error('Error exchanging code:', error);
            return false;
        }
    }
    
    /**
     * Fetch authenticated user info from GitHub
     */
    async fetchUser() {
        if (!this.token) {
            return false;
        }
        
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (!response.ok) {
                console.error('Failed to fetch user info');
                return false;
            }
            
            this.user = await response.json();
            this.isAuthenticated = true;
            
            console.log(`Authenticated as ${this.user.login}`);
            return true;
        } catch (error) {
            console.error('Error fetching user info:', error);
            return false;
        }
    }
    
    /**
     * Check if current user is the author (can reset)
     */
    canReset() {
        return this.isAuthenticated && this.user?.login === 'laurentperrinet';
    }
    
    /**
     * Get current user login
     */
    getUserLogin() {
        return this.user?.login || null;
    }
    
    /**
     * Logout
     */
    logout() {
        this.user = null;
        this.token = null;
        this.isAuthenticated = false;
        
        const sessionMgr = new SessionStorageManager();
        sessionMgr.clearToken();
    }
    
    /**
     * Generate random state for OAuth security
     */
    generateRandomState() {
        return Math.random().toString(36).substring(2, 15);
    }
}

/**
 * Reset manager - handles terrain reset with auth check
 */
class ResetManager {
    constructor(auth, terrain, physics, localStore, github) {
        this.auth = auth;
        this.terrain = terrain;
        this.physics = physics;
        this.localStore = localStore;
        this.github = github;
    }
    
    /**
     * Check if reset is allowed
     */
    canReset() {
        return this.auth.canReset();
    }
    
    /**
     * Perform soft reset (clear cache + reload from GitHub)
     */
    async softReset() {
        if (!this.canReset()) {
            console.error('Reset not authorized');
            return false;
        }
        
        try {
            // Clear local cache
            this.localStore.clear();
            
            // Fetch latest from GitHub
            const remote = await this.github.fetchTerrain();
            
            if (remote) {
                // Load remote terrain
                this.terrain.fromJSON(remote);
            } else {
                // Re-initialize if no remote
                this.terrain.initialize();
            }
            
            // Reset physics
            this.physics.reset();
            
            console.log('Soft reset complete');
            return true;
        } catch (error) {
            console.error('Soft reset failed:', error);
            return false;
        }
    }
    
    /**
     * Perform hard reset (delete terrain.json + cirque vierge)
     * Requires double confirmation
     */
    async hardReset(confirmed = false) {
        if (!this.canReset()) {
            console.error('Reset not authorized');
            return false;
        }
        
        if (!confirmed) {
            // Request confirmation
            return 'confirm'; // Signal to UI to ask for confirmation
        }
        
        try {
            // Delete local cache
            this.localStore.clear();
            
            // Would need admin privileges to delete from GitHub
            // For now, just reinitialize locally
            this.terrain.initialize();
            this.physics.reset();
            
            console.log('Hard reset complete (local only)');
            return true;
        } catch (error) {
            console.error('Hard reset failed:', error);
            return false;
        }
    }
    
    /**
     * Get reset status
     */
    getStatus() {
        return {
            canReset: this.canReset(),
            user: this.auth.getUserLogin()
        };
    }
}
