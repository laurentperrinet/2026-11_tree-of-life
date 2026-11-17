/**
 * GitHub API integration for collaborative terrain persistence
 * Fetches and commits terrain.json to repository
 */
class GitHubSync {
    constructor(config = {}) {
        this.owner = config.owner || 'laurentperrinet';
        this.repo = config.repo || '2026-11_tree-of-life';
        this.branch = config.branch || 'main';
        this.filePath = config.filePath || 'data/terrain.json';
        this.token = config.token || null;
        
        this.lastSyncTime = 0;
        this.lastCommitSha = null;
        this.contributorCount = 0;
    }
    
    /**
     * Set OAuth token
     */
    setToken(token) {
        this.token = token;
    }
    
    /**
     * Fetch terrain.json from GitHub
     */
    async fetchTerrain() {
        try {
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
            const headers = {
                'Accept': 'application/vnd.github.v3.raw',
                'X-GitHub-Api-Version': '2022-11-28'
            };
            
            if (this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
            }
            
            const response = await fetch(url, { headers });
            
            if (response.status === 404) {
                console.log('Terrain file not found on GitHub (first time)');
                return null;
            }
            
            if (!response.ok) {
                console.error(`GitHub fetch failed: ${response.statusText}`);
                return null;
            }
            
            const data = await response.json();
            this.lastSyncTime = Date.now();
            
            // Extract contributor info
            if (data.metadata?.contributors) {
                this.contributorCount = data.metadata.contributors.length;
            }
            
            return data;
        } catch (error) {
            console.error('Failed to fetch from GitHub:', error);
            return null;
        }
    }
    
    /**
     * Commit terrain.json to GitHub
     * Requires authenticated token with repo write access
     */
    async commitTerrain(terrainJSON, message = 'Update terrain from browser') {
        if (!this.token) {
            console.warn('No GitHub token available, skipping commit');
            return false;
        }
        
        try {
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
            const headers = {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28'
            };
            
            // Prepare commit data
            const content = btoa(JSON.stringify(terrainJSON, null, 2));
            
            // Get current SHA for update
            const getResponse = await fetch(url, { headers });
            let sha = null;
            
            if (getResponse.ok) {
                const current = await getResponse.json();
                sha = current.sha;
            }
            
            // Prepare commit message with metadata
            const cellsModified = terrainJSON.metadata?.cellsModified || '?';
            const commitMessage = `${message}\n\nCells modified: ${cellsModified}\nTimestamp: ${new Date().toISOString()}`;
            
            // Commit
            const commitBody = {
                message: commitMessage,
                content: content,
                branch: this.branch
            };
            
            if (sha) {
                commitBody.sha = sha;
            }
            
            const commitResponse = await fetch(url, {
                method: 'PUT',
                headers,
                body: JSON.stringify(commitBody)
            });
            
            if (!commitResponse.ok) {
                const error = await commitResponse.json();
                console.error('Commit failed:', error);
                return false;
            }
            
            const result = await commitResponse.json();
            this.lastCommitSha = result.commit.sha;
            this.lastSyncTime = Date.now();
            
            console.log(`Committed to GitHub: ${result.commit.sha.substring(0, 7)}`);
            return true;
        } catch (error) {
            console.error('Failed to commit to GitHub:', error);
            return false;
        }
    }
    
    /**
     * Merge terrain contributions
     * Strategy: Take maximum elevation (erosion accumulates)
     */
    mergeTerrain(local, remote) {
        if (!remote) return local;
        if (!local) return remote;
        
        // Ensure same dimensions
        if (remote.version !== local.version || remote.topology !== local.topology || !Array.isArray(remote.elevation) ||
            local.elevation.length !== remote.elevation.length || !remote.elevation.every(Number.isFinite)) {
            console.warn('Incompatible terrain in merge, using local');
            return local;
        }
        if (remote.vegetation !== undefined && (!Array.isArray(remote.vegetation) ||
            remote.vegetation.length !== local.elevation.length ||
            remote.vegetation.some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
            console.warn('Invalid vegetation in remote terrain, using local');
            return local;
        }
        if (remote.mushrooms !== undefined && (!Array.isArray(remote.mushrooms) ||
            !Array.isArray(local.mushrooms) || remote.mushrooms.length !== local.mushrooms.length ||
            remote.mushrooms.some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
            console.warn('Invalid mushrooms in remote terrain, using local');
            return local;
        }
        
        const merged = JSON.parse(JSON.stringify(local));
        
        // Merge elevation (max height)
        for (let i = 0; i < local.elevation.length; i++) {
            merged.elevation[i] = Math.max(
                local.elevation[i],
                remote.elevation[i]
            );
            if (merged.vegetation && remote.vegetation) {
                merged.vegetation[i] = Math.max(merged.vegetation[i], remote.vegetation[i]);
            }
            if (merged.mushrooms && remote.mushrooms) {
                for (let i = 0; i < merged.mushrooms.length; i++) {
                    merged.mushrooms[i] = Math.max(merged.mushrooms[i], remote.mushrooms[i]);
                }
            }
        }
        
        // Update metadata
        const contributors = new Set(local.metadata?.contributors || []);
        if (remote.metadata?.contributors) {
            remote.metadata.contributors.forEach(c => contributors.add(c));
        }
        
        merged.metadata = {
            contributors: Array.from(contributors),
            lastUpdate: new Date().toISOString(),
            iterations: (local.metadata?.iterations || 0) + 1,
            cellsModified: Object.keys(merged).length // Simplified count
        };
        
        return merged;
    }
    
    /**
     * Get seconds since last sync
     */
    getSecondsSinceSync() {
        if (this.lastSyncTime === 0) return null;
        return Math.floor((Date.now() - this.lastSyncTime) / 1000);
    }
    
    /**
     * Rate limit check (respect GitHub API limits)
     * Max ~60 requests/hour for unauthenticated, 5000/hour authenticated
     */
    checkRateLimit() {
        const secondsSinceSync = this.getSecondsSinceSync();
        
        if (secondsSinceSync === null) return true; // First sync
        
        // For demo: enforce 15s minimum between fetches, 30s between commits
        return secondsSinceSync >= 15;
    }
}

/**
 * Synchronization loop manager
 * Handles periodic fetch and batched writes
 */
class SyncLoop {
    constructor(terrain, physics, github, localStore) {
        this.terrain = terrain;
        this.physics = physics;
        this.github = github;
        this.localStore = localStore;
        
        this.fetchInterval = 15 * 1000;      // Fetch every 15s
        this.commitInterval = 60 * 1000;     // Commit every 60s (or when significant change)
        this.commitChangeThreshold = 10;     // Commit if >10 cells changed
        
        this.lastFetchTime = 0;
        this.lastCommitTime = 0;
        this.lastSaveTime = 0;
        this.pendingChanges = 0;
        
        this.running = false;
    }
    
    /**
     * Start sync loop
     */
    start() {
        this.running = true;
        this.syncLoop();
    }
    
    /**
     * Main sync loop
     */
    async syncLoop() {
        if (!this.running) return;
        
        const now = Date.now();
        
        // Fetch from GitHub periodically
        if (now - this.lastFetchTime > this.fetchInterval) {
            this.lastFetchTime = now;
            await this.fetchAndMerge();
        }
        
        // Commit local changes periodically or when threshold reached
        if ((now - this.lastCommitTime > this.commitInterval) && 
            this.pendingChanges >= this.commitChangeThreshold) {
            this.lastCommitTime = now;
            await this.commitChanges();
        }
        
        // Save to localStorage periodically
        if (now - this.lastSaveTime > 5000) {
            this.lastSaveTime = now;
            this.localStore.save(this.terrain);
        }
        
        // Continue loop
        requestAnimationFrame(() => this.syncLoop());
    }
    
    /**
     * Fetch terrain from GitHub and merge
     */
    async fetchAndMerge() {
        const remote = await this.github.fetchTerrain();
        
        if (remote) {
            const local = this.terrain.toJSON();
            const merged = this.github.mergeTerrain(local, remote);
            if (merged === local) return;
            
            // Apply merged terrain
            if (!this.terrain.fromJSON(merged)) {
                console.error('Merged terrain could not be applied');
                return;
            }
            
            // Track pending changes
            this.pendingChanges = 0;
        }
    }
    
    /**
     * Commit local changes to GitHub
     */
    async commitChanges() {
        if (this.pendingChanges < this.commitChangeThreshold) {
            return;
        }
        
        const terrainData = this.terrain.toJSON();
        const success = await this.github.commitTerrain(
            terrainData,
            `Terrain update: ${this.pendingChanges} cells modified`
        );
        
        if (success) {
            this.pendingChanges = 0;
        }
    }
    
    /**
     * Increment pending changes counter
     */
    recordChange(cellsChanged = 1) {
        this.pendingChanges += cellsChanged;
    }
    
    /**
     * Stop sync loop
     */
    stop() {
        this.running = false;
    }
}
