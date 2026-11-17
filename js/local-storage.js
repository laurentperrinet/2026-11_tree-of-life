/**
 * Local storage management for terrain persistence
 * Implements save/load with version checking
 */
class LocalStorageManager {
    constructor(storageKey = 'tree-of-life-terrain-arc-v5') {
        this.storageKey = storageKey;
        this.version = '1.0';
    }
    
    /**
     * Save terrain to localStorage
     */
    save(terrain) {
        try {
            const data = terrain.toJSON();
            const wrapped = {
                version: this.version,
                savedAt: new Date().toISOString(),
                data: data
            };
            
            localStorage.setItem(this.storageKey, JSON.stringify(wrapped));
            console.log('Terrain saved to localStorage');
            return true;
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            return false;
        }
    }
    
    /**
     * Load terrain from localStorage
     */
    load(terrain) {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) {
                console.log('No saved terrain in localStorage');
                return false;
            }
            
            const wrapped = JSON.parse(stored);
            
            // Version check
            if (wrapped.version !== this.version) {
                console.warn('Version mismatch, ignoring saved terrain');
                return false;
            }
            
            // Age check (don't load if > 24 hours old)
            const savedTime = new Date(wrapped.savedAt);
            const ageHours = (Date.now() - savedTime.getTime()) / (1000 * 60 * 60);
            if (ageHours > 24) {
                console.warn('Saved terrain too old (>24h), ignoring');
                return false;
            }
            
            // Load data
            const success = terrain.fromJSON(wrapped.data);
            if (success) {
                console.log('Terrain loaded from localStorage');
            }
            return success;
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
            return false;
        }
    }
    
    /**
     * Clear localStorage
     */
    clear() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('Cleared localStorage');
            return true;
        } catch (e) {
            console.error('Failed to clear localStorage:', e);
            return false;
        }
    }
    
    /**
     * Get size of stored data (approximate)
     */
    getSize() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? stored.length : 0;
        } catch (e) {
            return 0;
        }
    }
    
    /**
     * Check if storage is available
     */
    static isAvailable() {
        try {
            const test = '__localStorage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Session storage for OAuth token
 */
class SessionStorageManager {
    constructor(tokenKey = 'github-oauth-token') {
        this.tokenKey = tokenKey;
    }
    
    /**
     * Store OAuth token (session only, cleared on tab close)
     */
    saveToken(token) {
        try {
            sessionStorage.setItem(this.tokenKey, token);
            return true;
        } catch (e) {
            console.error('Failed to save token:', e);
            return false;
        }
    }
    
    /**
     * Get stored OAuth token
     */
    getToken() {
        try {
            return sessionStorage.getItem(this.tokenKey);
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Clear token
     */
    clearToken() {
        try {
            sessionStorage.removeItem(this.tokenKey);
            return true;
        } catch (e) {
            return false;
        }
    }
    
    /**
     * Check if token exists
     */
    hasToken() {
        return this.getToken() !== null;
    }
}
