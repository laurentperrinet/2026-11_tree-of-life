import {
    createInitialMesh, getSyncIntervalMs, LEGACY_MESH_SIGNATURE, MESH_SIGNATURE
} from './mesh.mjs';

const ACTIVE_CLIENT_MS = 24 * 60 * 60 * 1000;
const DAILY_REQUEST_BUDGET = 80_000;
const MAX_COMPRESSED_BYTES = 300_000;
const MAX_DELTA = 10;
const STATE_SCHEMA_VERSION = 4;
// A browser counts as online when seen within this many synchronization intervals.
const ONLINE_SYNC_INTERVALS = 2;
// Kept outside the terrain state so that resets and mesh changes do not lose it.
const COLLABORATOR_TOTAL_KEY = 'collaboratorTotal';
const COLLABORATOR_KEY_PREFIX = 'collaborator:';
const ORIGIN = 'https://laurentperrinet.github.io';
const FRONTEND_URL = `${ORIGIN}/2026-11_tree-of-life/`;

function json(data, status = 200) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function createState(version = 0) {
    const mesh = createInitialMesh();
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        meshSignature: MESH_SIGNATURE,
        version,
        elevation: mesh.elevation,
        bedrock: mesh.bedrock,
        erodibleCount: mesh.erodibleCount,
        activeClients: {},
        contributions: {},
        contributionIds: [],
        sumDelta: new Float64Array(mesh.elevation.length),
        windowEndsAt: null,
        lastMerge: null
    };
}

function errorResponse(error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Worker request failed', error);
    return json({ error: 'Internal server error' }, 500);
}

async function readStreamLimited(stream, maxBytes) {
    if (!stream) throw new HttpError(400, 'A request body is required');
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
            await reader.cancel();
            throw new HttpError(413, 'Request body is too large');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function readDelta(request, expectedLength) {
    const encoding = request.headers.get('X-Payload-Encoding');
    if (encoding !== 'gzip') {
        throw new HttpError(400, 'Compressed contribution payload is required');
    }
    if (typeof DecompressionStream !== 'function') {
        throw new HttpError(503, 'Gzip decompression is unavailable');
    }
    const maxCompressedBytes = Math.max(
        MAX_COMPRESSED_BYTES, expectedLength + Math.ceil(expectedLength / 100) + 128
    );
    const compressed = await readStreamLimited(request.body, maxCompressedBytes);
    let decompressed;
    try {
        decompressed = await readStreamLimited(
            new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
            expectedLength
        );
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'Invalid compressed contribution');
    }
    if (decompressed.byteLength !== expectedLength) {
        throw new HttpError(400, 'Contribution has the wrong mesh size');
    }
    if (decompressed.byteOffset % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new HttpError(400, 'Contribution has invalid alignment');
    }
    return new Float32Array(
        decompressed.buffer, decompressed.byteOffset,
        decompressed.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
}

function validateContributorId(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) {
        throw new HttpError(400, 'Invalid collaborator ID');
    }
    return value;
}

async function authenticateOwner(request, env) {
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [^\s]+$/.test(authorization)) {
        throw new HttpError(401, 'GitHub authentication required');
    }
    if (!env.OWNER_GITHUB_ID || !/^\d+$/.test(env.OWNER_GITHUB_ID)) {
        throw new HttpError(503, 'Owner GitHub ID is not configured');
    }
    const response = await fetch('https://api.github.com/user', {
        headers: {
            Authorization: authorization,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'tree-of-life-worker',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
    if (response.status === 401) throw new HttpError(401, 'Invalid GitHub token');
    if (!response.ok) throw new HttpError(502, 'GitHub identity verification failed');
    const user = await response.json();
    if (String(user.id) !== env.OWNER_GITHUB_ID) {
        throw new HttpError(403, 'Only the owner can administer the simulation');
    }
}

async function exchangeCode(request, env) {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        throw new HttpError(503, 'GitHub OAuth is not configured');
    }
    let body;
    try {
        body = await request.json();
    } catch {
        throw new HttpError(400, 'Invalid JSON');
    }
    if (!body || typeof body.code !== 'string' || body.code.length < 1 || body.code.length > 512) {
        throw new HttpError(400, 'Invalid authorization code');
    }
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: body.code,
            redirect_uri: FRONTEND_URL
        })
    });
    if (!response.ok) throw new HttpError(502, 'GitHub token exchange failed');
    const result = await response.json();
    if (typeof result.access_token !== 'string') {
        throw new HttpError(400, 'GitHub rejected the authorization code');
    }
    return json({ access_token: result.access_token });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== ORIGIN) return json({ error: 'Origin not allowed' }, 403);
        const corsHeaders = {
            'Access-Control-Allow-Origin': ORIGIN,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': [
                'Content-Type', 'Authorization', 'X-Collaborator-ID',
                'X-Terrain-Version', 'X-Payload-Encoding', 'X-Mesh-Signature'
            ].join(', '),
            'Vary': 'Origin'
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        let response;
        try {
            const path = new URL(request.url).pathname;
            if (path === '/api/auth/exchange' && request.method === 'POST') {
                response = await exchangeCode(request, env);
            } else if (['/api/state', '/api/sync', '/api/admin/reset'].includes(path)) {
                if (path === '/api/admin/reset') await authenticateOwner(request, env);
                const id = env.SIMULATION.idFromName('global');
                response = await env.SIMULATION.get(id).fetch(request);
            } else {
                response = json({ error: 'Not found' }, 404);
            }
        } catch (error) {
            response = errorResponse(error);
        }
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
        return new Response(response.body, { status: response.status, headers });
    }
};

export class Simulation {
    constructor(ctx) {
        this.ctx = ctx;
    }

    async fetch(request) {
        try {
            const path = new URL(request.url).pathname;
            let delta;
            if (path === '/api/sync' && request.method === 'POST') {
                if (request.headers.has('X-Payload-Encoding')) {
                    const initial = createInitialMesh();
                    delta = await readDelta(
                        request, initial.elevation.length * Float32Array.BYTES_PER_ELEMENT
                    );
                } else if (request.body) {
                    const unexpectedBody = await readStreamLimited(request.body, MAX_COMPRESSED_BYTES);
                    if (unexpectedBody.byteLength > 0) {
                        throw new HttpError(400, 'Contribution encoding is required');
                    }
                }
            }
            return await this.ctx.blockConcurrencyWhile(() => this.handle(request, delta));
        } catch (error) {
            return errorResponse(error);
        }
    }

    async loadState() {
        const stored = await this.ctx.storage.get('state');
        if (stored?.schemaVersion === STATE_SCHEMA_VERSION &&
            stored.meshSignature === MESH_SIGNATURE &&
            stored.elevation instanceof Float64Array &&
            stored.bedrock instanceof Float64Array &&
            stored.sumDelta instanceof Float64Array &&
            stored.elevation.length === stored.bedrock.length &&
            stored.elevation.length === stored.sumDelta.length &&
            stored.activeClients && typeof stored.activeClients === 'object' &&
            stored.contributions && typeof stored.contributions === 'object' &&
            Array.isArray(stored.contributionIds)) return stored;
        // States from earlier meshes (polar rings) are not migrated: their
        // vertices do not correspond to those of the spiral, so the terrain
        // restarts from the initial bed with a higher version number.
        const version = Number.isSafeInteger(stored?.version) ? stored.version + 1 : 0;
        const state = createState(version);
        // Browser activity does not depend on the mesh, so it survives a terrain
        // restart and still seeds the cumulative collaborator count.
        if (stored?.activeClients && typeof stored.activeClients === 'object') {
            state.activeClients = Object.fromEntries(Object.entries(stored.activeClients)
                .filter(([id, lastSeen]) => /^[a-f0-9]{32}$/.test(id) && Number.isFinite(lastSeen)));
        }
        await this.ctx.storage.put('state', state);
        return state;
    }

    /**
     * Load the cumulative count of distinct browser IDs, seeding it on first use.
     *
     * Args:
     *   state: Shared state whose active browser IDs seed a missing count.
     *   now: Current time (ms since the Unix epoch).
     */
    async loadCollaboratorTotal(state, now) {
        if (this.totalCollaborators !== undefined) return;
        const stored = await this.ctx.storage.get(COLLABORATOR_TOTAL_KEY);
        if (Number.isSafeInteger(stored) && stored >= 0) {
            this.totalCollaborators = stored;
            return;
        }
        // Earlier IDs were forgotten after 24 h, so counting starts from the active ones.
        this.totalCollaborators = 0;
        for (const id of Object.keys(state.activeClients)) {
            await this.registerCollaborator(id, now, false);
        }
        await this.ctx.storage.put(COLLABORATOR_TOTAL_KEY, this.totalCollaborators);
    }

    /**
     * Count a browser ID once, however long it stays away.
     *
     * Args:
     *   id: Validated browser ID.
     *   now: Time it was first seen (ms since the Unix epoch).
     *   persistTotal: Whether to store the updated count immediately.
     */
    async registerCollaborator(id, now, persistTotal = true) {
        const key = COLLABORATOR_KEY_PREFIX + id;
        if (await this.ctx.storage.get(key) !== undefined) return;
        await this.ctx.storage.put(key, now);
        this.totalCollaborators++;
        if (persistTotal) {
            await this.ctx.storage.put(COLLABORATOR_TOTAL_KEY, this.totalCollaborators);
        }
    }

    async handle(request, delta) {
        const path = new URL(request.url).pathname;
        const state = await this.loadState();
        await this.loadCollaboratorTotal(state, Date.now());

        if (path === '/api/state' && request.method === 'GET') {
            return this.stateResponse(state);
        }
        if (path === '/api/sync' && request.method === 'POST') {
            return this.sync(request, state, delta);
        }
        if (path === '/api/admin/reset' && request.method === 'POST') {
            const mesh = createInitialMesh();
            state.schemaVersion = STATE_SCHEMA_VERSION;
            state.meshSignature = MESH_SIGNATURE;
            state.version++;
            state.elevation = mesh.elevation;
            state.bedrock = mesh.bedrock;
            state.erodibleCount = mesh.erodibleCount;
            state.contributions = {};
            state.contributionIds = [];
            state.sumDelta = new Float64Array(mesh.elevation.length);
            state.windowEndsAt = null;
            state.lastMerge = null;
            await this.ctx.storage.put('state', state);
            return this.stateResponse(state);
        }
        return json({ error: 'Method not allowed' }, 405);
    }

    async sync(request, state, delta) {
        const meshSignature = request.headers.get('X-Mesh-Signature');
        if ((meshSignature !== null && meshSignature !== MESH_SIGNATURE) ||
            (delta && meshSignature === null && MESH_SIGNATURE !== LEGACY_MESH_SIGNATURE)) {
            throw new HttpError(409, 'Incompatible terrain mesh; reload the application');
        }
        const clientId = validateContributorId(request.headers.get('X-Collaborator-ID'));
        const now = Date.now();
        const versionHeader = request.headers.get('X-Terrain-Version');
        let clientVersion = null;
        if (versionHeader !== null) {
            if (!/^\d+$/.test(versionHeader)) {
                throw new HttpError(400, 'Invalid terrain version');
            }
            clientVersion = Number(versionHeader);
            if (!Number.isSafeInteger(clientVersion)) {
                throw new HttpError(400, 'Invalid terrain version');
            }
        }
        for (const [id, lastSeen] of Object.entries(state.activeClients)) {
            if (now - lastSeen > ACTIVE_CLIENT_MS) delete state.activeClients[id];
        }
        // Active IDs are already counted; only the others need a storage lookup.
        if (!Object.hasOwn(state.activeClients, clientId)) {
            await this.registerCollaborator(clientId, now);
        }
        state.activeClients[clientId] = now;

        let finalized = false;
        if (state.windowEndsAt !== null && now >= state.windowEndsAt) {
            this.finalizeContributions(state, now);
            finalized = true;
        }

        let accepted = false;
        let duplicate = false;
        if (delta) {
            if (clientVersion === null) {
                throw new HttpError(400, 'A valid terrain version is required');
            }
            if (clientVersion === state.version && !finalized) {
                if (Object.hasOwn(state.contributions, clientId)) {
                    duplicate = true;
                } else {
                    for (let i = 0; i < delta.length; i++) {
                        const value = delta[i];
                        if (!Number.isFinite(value) || Math.abs(value) > MAX_DELTA ||
                            (i >= state.erodibleCount && value < 0)) {
                            throw new HttpError(400, 'Contribution contains invalid terrain changes');
                        }
                    }
                    for (let i = 0; i < delta.length; i++) state.sumDelta[i] += delta[i];
                    state.contributions[clientId] = true;
                    state.contributionIds.push(clientId);
                    if (state.windowEndsAt === null) {
                        const interval = getSyncIntervalMs(
                            Object.keys(state.activeClients).length, DAILY_REQUEST_BUDGET
                        );
                        state.windowEndsAt = now + interval;
                    }
                    accepted = true;
                }
            }
        }

        await this.ctx.storage.put('state', state);
        return this.stateResponse(
            state,
            { accepted, duplicate },
            clientVersion === null || clientVersion !== state.version,
            clientId
        );
    }

    finalizeContributions(state, now) {
        const count = state.contributionIds.length;
        if (count > 0) {
            for (let i = 0; i < state.elevation.length; i++) {
                state.elevation[i] = Math.max(
                    state.bedrock[i],
                    state.elevation[i] + state.sumDelta[i] / count
                );
            }
            state.version++;
            // IDs stay in the Worker; responses only reveal their number and
            // whether the requesting browser was among them.
            state.lastMerge = {
                at: now, version: state.version, contributorIds: [...state.contributionIds]
            };
        }
        state.contributions = {};
        state.contributionIds = [];
        state.sumDelta = new Float64Array(state.elevation.length);
        state.windowEndsAt = null;
    }

    stateResponse(state, extra = {}, includeTerrain = true, clientId = null) {
        const now = Date.now();
        const activeCollaborators = Object.keys(state.activeClients).length;
        const syncIntervalMs = getSyncIntervalMs(activeCollaborators, DAILY_REQUEST_BUDGET);
        const onlineCollaborators = Object.values(state.activeClients)
            .filter(lastSeen => now - lastSeen <= ONLINE_SYNC_INTERVALS * syncIntervalMs).length;
        const lastMerge = state.lastMerge ? {
            agoMs: Math.max(0, now - state.lastMerge.at),
            version: state.lastMerge.version,
            contributors: state.lastMerge.contributorIds.length,
            includesYou: clientId === null ? null : state.lastMerge.contributorIds.includes(clientId)
        } : null;
        const result = {
            version: state.version,
            meshSignature: MESH_SIGNATURE,
            activeCollaborators,
            onlineCollaborators,
            totalCollaborators: this.totalCollaborators ?? null,
            acceptedContributions: state.contributionIds.length,
            lastMerge,
            syncIntervalMs,
            dailyRequestBudget: DAILY_REQUEST_BUDGET,
            // Relative delay, so browsers with a skewed clock still count down correctly.
            // Zero means the window has closed and the next request will apply the merge.
            mergeInMs: state.windowEndsAt === null
                ? null : Math.max(0, state.windowEndsAt - now),
            ...extra
        };
        if (includeTerrain) result.terrain = { elevation: Array.from(state.elevation) };
        return json(result);
    }
}
