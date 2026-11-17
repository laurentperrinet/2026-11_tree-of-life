import { createInitialMesh, getSyncIntervalMs, MESH_SIGNATURE } from './mesh.mjs';

const ACTIVE_CLIENT_MS = 24 * 60 * 60 * 1000;
const DAILY_REQUEST_BUDGET = 80_000;
const MAX_COMPRESSED_BYTES = 300_000;
const MAX_DELTA = 10;
const STATE_SCHEMA_VERSION = 2;
const LEGACY_MESH_SIGNATURE = JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
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
        windowEndsAt: null
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
            stored.elevation instanceof Float64Array &&
            stored.bedrock instanceof Float64Array &&
            stored.sumDelta instanceof Float64Array &&
            stored.elevation.length === stored.bedrock.length &&
            stored.elevation.length === stored.sumDelta.length &&
            stored.activeClients && typeof stored.activeClients === 'object' &&
            stored.contributions && typeof stored.contributions === 'object' &&
            Array.isArray(stored.contributionIds)) {
            if (stored.meshSignature === MESH_SIGNATURE) return stored;
            if (stored.meshSignature === undefined && MESH_SIGNATURE === LEGACY_MESH_SIGNATURE) {
                const mesh = createInitialMesh();
                if (stored.erodibleCount === mesh.erodibleCount &&
                    stored.bedrock.length === mesh.bedrock.length &&
                    stored.bedrock.every((height, i) => height === mesh.bedrock[i])) {
                    stored.meshSignature = MESH_SIGNATURE;
                    await this.ctx.storage.put('state', stored);
                    return stored;
                }
            }
        }
        const version = Number.isSafeInteger(stored?.version) ? stored.version + 1 : 0;
        const state = createState(version);
        await this.ctx.storage.put('state', state);
        return state;
    }

    async handle(request, delta) {
        const path = new URL(request.url).pathname;
        const state = await this.loadState();

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
        state.activeClients[clientId] = now;

        let finalized = false;
        if (state.windowEndsAt !== null && now >= state.windowEndsAt) {
            this.finalizeContributions(state);
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
            clientVersion === null || clientVersion !== state.version
        );
    }

    finalizeContributions(state) {
        const count = state.contributionIds.length;
        if (count > 0) {
            for (let i = 0; i < state.elevation.length; i++) {
                state.elevation[i] = Math.max(
                    state.bedrock[i],
                    state.elevation[i] + state.sumDelta[i] / count
                );
            }
            state.version++;
        }
        state.contributions = {};
        state.contributionIds = [];
        state.sumDelta = new Float64Array(state.elevation.length);
        state.windowEndsAt = null;
    }

    stateResponse(state, extra = {}, includeTerrain = true) {
        const activeCollaborators = Object.keys(state.activeClients).length;
        const result = {
            version: state.version,
            meshSignature: MESH_SIGNATURE,
            activeCollaborators,
            acceptedContributions: state.contributionIds.length,
            syncIntervalMs: getSyncIntervalMs(activeCollaborators, DAILY_REQUEST_BUDGET),
            dailyRequestBudget: DAILY_REQUEST_BUDGET,
            ...extra
        };
        if (includeTerrain) result.terrain = { elevation: Array.from(state.elevation) };
        return json(result);
    }
}
