/**
 * GitHub OAuth2 authentication manager
 * Handles login and token management for reset permissions
 */
class AuthManager {
    constructor(config = {}) {
        this.clientId = config.clientId || '';
        this.redirectUri = config.redirectUri || '';
        this.exchangeUrl = config.exchangeUrl || '';
        this.scopes = config.scopes || ['user:email'];
        this.stateKey = 'tree-of-life-oauth-state';
        this.adminViewKey = 'tree-of-life-oauth-admin-view';
        
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
        
        const oauthError = params.get('error');
        if (code || oauthError) {
            const state = params.get('state');
            const expected = sessionStorage.getItem(this.stateKey);
            const adminView = sessionStorage.getItem(this.adminViewKey) === '1';
            sessionStorage.removeItem(this.stateKey);
            sessionStorage.removeItem(this.adminViewKey);
            params.delete('code');
            params.delete('state');
            params.delete('error');
            params.delete('error_description');
            params.delete('error_uri');
            if (adminView && state && expected && state === expected) params.set('admin', '');
            const query = params.toString();
            window.history.replaceState({}, document.title,
                window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
            if (!state || !expected || state !== expected) {
                throw new Error('GitHub sign-in failed: invalid OAuth state');
            }
            if (oauthError) throw new Error('GitHub sign-in was declined or failed');
            if (!this.isConfigured()) throw new Error('GitHub sign-in is not configured for this page');
            await this.exchangeCode(code);
            return;
        }
        
        // Check session storage for token
        const sessionMgr = new SessionStorageManager();
        const token = sessionMgr.getToken();
        
        if (token) {
            this.token = token;
            if (!await this.fetchUser()) {
                this.logout();
                throw new Error('Stored GitHub session could not be verified');
            }
        }
    }

    isConfigured() {
        if (!this.clientId || !this.redirectUri || !this.exchangeUrl) return false;
        try {
            const callback = new URL(this.redirectUri);
            const endpoint = new URL(this.exchangeUrl);
            return callback.protocol === 'https:' && endpoint.protocol === 'https:' &&
                callback.origin === window.location.origin && callback.pathname === window.location.pathname;
        } catch (error) {
            console.error('Invalid GitHub OAuth configuration:', error);
            return false;
        }
    }
    
    /**
     * Get OAuth login URL
     */
    getLoginUrl(state) {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scopes.join(' '),
            allow_signup: 'false',
            state
        });
        
        return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
    
    /**
     * Start OAuth flow
     */
    login() {
        if (!this.isConfigured()) throw new Error('GitHub sign-in requires a configured OAuth Worker and HTTPS callback');
        const state = this.generateRandomState();
        sessionStorage.setItem(this.stateKey, state);
        sessionStorage.setItem(this.adminViewKey,
            new URLSearchParams(window.location.search).has('admin') ? '1' : '0');
        window.location.href = this.getLoginUrl(state);
    }
    
    /**
     * Exchange the code using the configured server-side Worker.
     */
    async exchangeCode(code) {
        const response = await fetch(this.exchangeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        if (!response.ok) {
            throw new Error(`GitHub token exchange failed (${response.status})`);
        }

        const data = await response.json();
        if (typeof data.access_token !== 'string' || !data.access_token) {
            throw new Error('GitHub token exchange returned no token');
        }
        this.token = data.access_token;
        if (!await this.fetchUser()) {
            this.logout();
            throw new Error('GitHub identity verification failed');
        }
        const sessionMgr = new SessionStorageManager();
        if (!sessionMgr.saveToken(this.token)) {
            this.logout();
            throw new Error('Could not save GitHub session');
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
            
            const user = await response.json();
            if (!user || typeof user.login !== 'string' || !user.login) {
                console.error('GitHub returned an invalid user identity');
                return false;
            }
            this.user = user;
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
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
}

/**
 * Reset manager - handles terrain reset with auth check
 */
class ResetManager {
    constructor(auth, terrain, physics, localStore, collaboration, biology = null, biologyStore = null) {
        this.auth = auth;
        this.terrain = terrain;
        this.physics = physics;
        this.localStore = localStore;
        this.collaboration = collaboration;
        this.biology = biology;
        this.biologyStore = biologyStore;
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
            this.physics.reset();
            await this.collaboration.reset(this.auth.token);
            if (this.biology) {
                this.biology.reset();
                if (!this.biologyStore.save(this.biology)) throw new Error('Could not save reset biology');
            }
            this.localStore.clear();
            
            console.log('Shared terrain reset complete');
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
            return await this.softReset();
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
