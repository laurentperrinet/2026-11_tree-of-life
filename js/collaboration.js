/**
 * Synchronizes averaged terrain-elevation changes through the Cloudflare Worker.
 */
class CollaborativeSync {
    constructor(terrain, localStore, config = {}) {
        this.terrain = terrain;
        this.localStore = localStore;
        this.endpoint = config.endpoint ||
            'https://tree-of-life.laurent-perrinet.workers.dev/api/sync';
        this.resetEndpoint = this.endpoint.replace(/\/api\/sync$/, '/api/admin/reset');
        this.clientId = this.getClientId();
        this.version = null;
        this.baseElevation = null;
        this.submittedVersion = null;
        this.activeCollaborators = 0;
        this.syncIntervalMs = 300_000;
        this.lastSyncTime = 0;
        this.running = false;
        this.timer = null;
        this.nextSyncAt = null;
        this.nextMergeAt = null;
        this.inFlight = null;
        this.failureCount = 0;
        this.resetting = false;
        this.meshSignatureSupported = false;
    }

    getClientId() {
        const key = 'tree-of-life-collaborator-id';
        try {
            const existing = localStorage.getItem(key);
            if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(key, id);
            return id;
        } catch (error) {
            console.error('Could not persist collaborator ID; using a session-only ID:', error);
            return Array.from(crypto.getRandomValues(new Uint8Array(16)),
                byte => byte.toString(16).padStart(2, '0')).join('');
        }
    }

    async start() {
        if (this.running) return;
        this.running = true;
        try {
            await this.sync();
        } catch (error) {
            // Count the failure so the retry backs off as for scheduled attempts.
            this.failureCount++;
            throw error;
        } finally {
            this.schedule();
        }
    }

    async syncNow() {
        if (this.inFlight) return this.inFlight;
        if (Date.now() - this.lastSyncTime < this.syncIntervalMs) return false;
        try {
            await this.sync();
            this.schedule();
            return true;
        } catch (error) {
            this.failureCount++;
            this.schedule();
            throw error;
        }
    }

    async sync() {
        if (this.resetting) throw new Error('Terrain reset is in progress');
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.performSync();
        try {
            return await this.inFlight;
        } finally {
            this.inFlight = null;
        }
    }

    async performSync() {
        const headers = { 'X-Collaborator-ID': this.clientId };
        if (this.meshSignatureSupported) headers['X-Mesh-Signature'] = this.terrain.meshSignature();
        let body;
        let submittedVersion = null;
        if (this.version !== null) headers['X-Terrain-Version'] = String(this.version);
        if (this.version !== null && this.submittedVersion !== this.version) {
            const delta = Float32Array.from(
                this.terrain.elevation,
                (height, index) => height - this.baseElevation[index]
            );
            const compressed = await this.compress(delta);
            headers['Content-Type'] = 'application/octet-stream';
            headers['X-Payload-Encoding'] = 'gzip';
            body = compressed;
            submittedVersion = this.version;
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body
        });
        if (!response.ok) {
            const details = await response.json().catch(() => ({}));
            throw new Error(details.error || `Collaboration sync failed (${response.status})`);
        }
        const data = await response.json();
        this.applyState(data);
        if (data.version === submittedVersion && data.accepted) {
            this.submittedVersion = submittedVersion;
        }
        this.lastSyncTime = Date.now();
        this.failureCount = 0;
        return data;
    }

    async compress(delta) {
        if (typeof CompressionStream !== 'function') {
            throw new Error('This browser does not support compressed collaboration updates');
        }
        const stream = new Blob([delta.buffer]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(stream).arrayBuffer();
    }

    applyState(data) {
        if (!data || !Number.isSafeInteger(data.version)) {
            throw new Error('Collaboration Worker returned an incompatible terrain');
        }
        if (!Number.isSafeInteger(data.activeCollaborators) ||
            !Number.isFinite(data.syncIntervalMs) || data.syncIntervalMs < 1) {
            throw new Error('Collaboration Worker returned invalid synchronization metadata');
        }
        // Older Workers omit mergeInMs; null means no contribution is waiting to be merged.
        const mergeInMs = data.mergeInMs ?? null;
        if (mergeInMs !== null && !(Number.isFinite(mergeInMs) && mergeInMs >= 0)) {
            throw new Error('Collaboration Worker returned an invalid merge delay');
        }
        const signature = this.terrain.meshSignature();
        if (data.meshSignature === undefined
            ? signature !== LEGACY_TERRAIN_MESH_SIGNATURE
            : data.meshSignature !== signature) {
            throw new Error('Collaboration Worker returned an incompatible terrain mesh');
        }

        if (this.version !== data.version || this.baseElevation === null) {
            if (!Array.isArray(data.terrain?.elevation) ||
                data.terrain.elevation.length !== this.terrain.elevation.length ||
                data.terrain.elevation.some(value => !Number.isFinite(value))) {
                throw new Error('Collaboration Worker omitted or corrupted the shared terrain');
            }
            this.terrain.elevation.set(data.terrain.elevation);
            this.baseElevation = Float64Array.from(data.terrain.elevation);
            this.version = data.version;
            this.submittedVersion = null;
            if (this.localStore) this.localStore.save(this.terrain);
        }
        this.activeCollaborators = data.activeCollaborators;
        this.nextMergeAt = mergeInMs === null ? null : Date.now() + mergeInMs;
        this.syncIntervalMs = Math.max(300_000, data.syncIntervalMs);
        this.meshSignatureSupported = data.meshSignature !== undefined;
    }

    async reset(token) {
        if (this.resetting) throw new Error('Terrain reset is already in progress');
        this.resetting = true;
        try {
            if (this.inFlight) await this.inFlight;
            const response = await fetch(this.resetEndpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(details.error || `Terrain reset failed (${response.status})`);
            }
            const data = await response.json();
            this.applyState(data);
            this.lastSyncTime = Date.now();
            return true;
        } finally {
            this.resetting = false;
        }
    }

    getSecondsSinceSync() {
        return this.lastSyncTime ? Math.floor((Date.now() - this.lastSyncTime) / 1000) : null;
    }

    getSecondsUntilSync() {
        return this.nextSyncAt === null || this.inFlight
            ? null : Math.max(0, Math.ceil((this.nextSyncAt - Date.now()) / 1000));
    }

    /**
     * Seconds until the Worker's collection window closes, as last reported by it.
     *
     * The merge itself is applied by the first request after the window closes, and
     * this browser receives the merged terrain at its own next sync. The value is
     * refreshed only by syncs, so a window opened meanwhile by another browser
     * appears at the next sync.
     */
    getSecondsUntilMerge() {
        return this.nextMergeAt === null
            ? null : Math.max(0, Math.ceil((this.nextMergeAt - Date.now()) / 1000));
    }

    fetchAndMerge() {
        return this.syncNow();
    }

    schedule() {
        if (!this.running) return;
        clearTimeout(this.timer);
        const backoff = this.failureCount
            ? Math.min(this.syncIntervalMs * (2 ** this.failureCount), 6 * 60 * 60 * 1000)
            : this.syncIntervalMs;
        this.nextSyncAt = Date.now() + backoff;
        this.timer = setTimeout(async () => {
            this.timer = null;
            this.nextSyncAt = null;
            try {
                await this.sync();
            } catch (error) {
                this.failureCount++;
                console.error('Collaboration sync failed:', error);
            } finally {
                this.schedule();
            }
        }, backoff);
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
        this.timer = null;
        this.nextSyncAt = null;
    }
}
