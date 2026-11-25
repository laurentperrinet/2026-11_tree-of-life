/**
 * Local storage management for terrain persistence
 * Implements save/load with version checking
 */
class LocalStorageManager {
    constructor(storageKey = 'tree-of-life-terrain-disk-v12', maxAgeHours = 24) {
        this.storageKey = storageKey;
        this.maxAgeHours = maxAgeHours;
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
            if (this.maxAgeHours !== null && ageHours > this.maxAgeHours) {
                console.warn(`Saved data too old (>${this.maxAgeHours}h), ignoring`);
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
}

class SimulationTimeTracker {
    constructor() {
        this.prefix = 'tree-of-life-simulation-time-v1:';
        this.key = 'tree-of-life-simulation-time-v1';
        this.sessionTime = 0;
        this.savedTime = 0;
        this.migrateLegacyKeys();
    }

    /**
     * Fold the legacy per-session UUID keys into the single key, then delete
     * them so storage does not grow without bound. Invalid values are ignored.
     */
    migrateLegacyKeys() {
        let legacyTotal = 0;
        const legacyKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(this.prefix)) continue;
            legacyKeys.push(key);
            const value = Number(localStorage.getItem(key));
            if (Number.isFinite(value) && value >= 0) legacyTotal += value;
        }
        if (legacyKeys.length === 0) return;
        const stored = this.readStoredTotal();
        localStorage.setItem(this.key, String(stored + legacyTotal));
        for (const key of legacyKeys) localStorage.removeItem(key);
    }

    readStoredTotal() {
        const raw = localStorage.getItem(this.key);
        if (raw === null || raw.trim() === '') return 0;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
            console.warn('Ignoring invalid saved simulation time');
            return 0;
        }
        return value;
    }

    add(dt) {
        this.sessionTime += dt;
    }

    save() {
        // Persist only this session's increment on top of the stored total, so
        // concurrent tabs each contribute their own delta instead of
        // overwriting each other's session time.
        const stored = this.readStoredTotal();
        const newTotal = stored + (this.sessionTime - this.savedTime);
        localStorage.setItem(this.key, String(newTotal));
        this.savedTime = this.sessionTime;
    }

    getTotal() {
        return this.readStoredTotal() + (this.sessionTime - this.savedTime);
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
}
