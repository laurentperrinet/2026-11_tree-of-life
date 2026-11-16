import { calculateRows, createTerrain, DEFAULT_PARAMETERS, HEIGHT, WIDTH } from './physics.mjs';

const LEASE_MS = 60_000;
const PARTITIONS = 4;
const MAX_BODY_BYTES = 100_000;
const ORIGIN = 'https://laurentperrinet.github.io';
const FRONTEND_URL = `${ORIGIN}/2026-11_tree-of-life/`;
const FIELDS = ['elevation', 'waterDepth', 'sediment'];

function json(data, status = 200) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte =>
        byte.toString(16).padStart(2, '0')
    ).join('');
}

async function readJson(request) {
    if (!request.body) throw new HttpError(400, 'A JSON body is required');
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) {
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
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new HttpError(400, 'Invalid JSON');
    }
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function errorResponse(error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Worker request failed', error);
    return json({ error: 'Internal server error' }, 500);
}

function validateParameters(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['flow', 'speed'].includes(key)) ||
        !Number.isFinite(value.flow) || value.flow < 0 || value.flow > 2 ||
        !Number.isFinite(value.speed) || value.speed < 0.1 || value.speed > 5) {
        throw new HttpError(400, 'Invalid simulation parameters');
    }
    return { flow: value.flow, speed: value.speed };
}

function validateResult(result, rows) {
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        Object.keys(result).length !== FIELDS.length) {
        throw new HttpError(400, 'Invalid result');
    }
    for (const field of FIELDS) {
        const values = result[field];
        if (!Array.isArray(values) || values.length !== rows * WIDTH ||
            values.some(value => !Number.isFinite(value) ||
                (field === 'elevation' && (value < -5 || value > 1000)) ||
                (field === 'waterDepth' && (value < 0 || value > 1000)) ||
                (field === 'sediment' && (value < 0 || value > 1)))) {
            throw new HttpError(400, `Invalid ${field} values`);
        }
    }
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
    const body = await readJson(request);
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
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Vary': 'Origin'
        };
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
        let response;
        try {
            const path = new URL(request.url).pathname;
            if (path === '/api/auth/exchange' && request.method === 'POST') {
                response = await exchangeCode(request, env);
            } else if (['/api/state', '/api/tasks/claim', '/api/tasks/submit',
                '/api/admin/parameters', '/api/admin/reset'].includes(path)) {
                if (path.startsWith('/api/admin/')) await authenticateOwner(request, env);
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
            const needsBody = request.method === 'POST' &&
                (path === '/api/tasks/submit' || path === '/api/admin/parameters');
            const body = needsBody ? await readJson(request) : undefined;
            return await this.ctx.blockConcurrencyWhile(() => this.handle(request, body));
        } catch (error) {
            return errorResponse(error);
        }
    }

    async handle(request, body) {
        let state = await this.ctx.storage.get('state');
        if (!state) {
            state = {
                version: 0,
                terrain: createTerrain(),
                parameters: { ...DEFAULT_PARAMETERS },
                tasks: Array(PARTITIONS).fill(null)
            };
            await this.ctx.storage.put('state', state);
        }
        const path = new URL(request.url).pathname;

        if (path === '/api/state' && request.method === 'GET') {
            return json({ version: state.version, terrain: state.terrain, parameters: state.parameters });
        }
        if (path === '/api/tasks/claim' && request.method === 'POST') {
            const now = Date.now();
            const index = state.tasks.findIndex(task => !task || (!task.result && task.expires <= now));
            if (index < 0) return json({ error: 'No task available' }, 409);
            const start = Math.floor(index * HEIGHT / PARTITIONS);
            const end = Math.floor((index + 1) * HEIGHT / PARTITIONS);
            const lease = randomToken();
            state.tasks[index] = { lease, expires: now + LEASE_MS, result: null };
            await this.ctx.storage.put('state', state);
            return json({
                version: state.version, lease, start, end,
                terrain: state.terrain, parameters: state.parameters
            });
        }
        if (path === '/api/tasks/submit' && request.method === 'POST') {
            if (!body || !Number.isSafeInteger(body.version) || typeof body.lease !== 'string' ||
                body.version !== state.version) {
                throw new HttpError(409, 'Task version is no longer current');
            }
            const index = state.tasks.findIndex(task => task && task.lease === body.lease);
            const task = state.tasks[index];
            if (!task || task.result || task.expires <= Date.now()) {
                throw new HttpError(409, 'Task lease is invalid or expired');
            }
            const start = Math.floor(index * HEIGHT / PARTITIONS);
            const end = Math.floor((index + 1) * HEIGHT / PARTITIONS);
            validateResult(body.result, end - start);

            const row = start + (crypto.getRandomValues(new Uint32Array(1))[0] % (end - start));
            const expected = calculateRows(state.terrain, state.parameters, row, row + 1);
            for (const field of FIELDS) {
                for (let x = 0; x < WIDTH; x++) {
                    if (Math.abs(body.result[field][(row - start) * WIDTH + x] - expected[field][x]) > 1e-5) {
                        throw new HttpError(422, 'Result failed the sample calculation check');
                    }
                }
            }
            task.result = body.result;
            if (state.tasks.every(item => item && item.result)) {
                for (const field of FIELDS) {
                    state.terrain[field] = state.tasks.flatMap(item => item.result[field]);
                }
                state.version++;
                state.tasks = Array(PARTITIONS).fill(null);
            }
            await this.ctx.storage.put('state', state);
            return json({ version: state.version, completed: state.tasks.every(item => item === null) });
        }
        if (path === '/api/admin/parameters' && request.method === 'POST') {
            state.parameters = validateParameters(body);
            state.version++;
            state.tasks = Array(PARTITIONS).fill(null);
            await this.ctx.storage.put('state', state);
            return json({ version: state.version, parameters: state.parameters });
        }
        if (path === '/api/admin/reset' && request.method === 'POST') {
            state.terrain = createTerrain();
            state.version++;
            state.tasks = Array(PARTITIONS).fill(null);
            await this.ctx.storage.put('state', state);
            return json({ version: state.version });
        }
        return json({ error: 'Method not allowed' }, 405);
    }
}
