import { test } from 'node:test';
import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import worker, { Simulation } from './index.mjs';
import { createInitialMesh, getSyncIntervalMs } from './mesh.mjs';

function harness() {
    const values = new Map();
    let tail = Promise.resolve();
    const ctx = {
        storage: {
            async get(key) { return structuredClone(values.get(key)); },
            async put(key, value) { values.set(key, structuredClone(value)); }
        },
        blockConcurrencyWhile(fn) {
            const result = tail.then(fn);
            tail = result.catch(() => {});
            return result;
        }
    };
    const simulation = new Simulation(ctx);
    const env = {
        OWNER_GITHUB_ID: '123',
        SIMULATION: {
            idFromName: name => name,
            get: () => simulation
        }
    };
    async function request(path, {
        method = 'GET', body, token, origin, clientId, version, encoding
    } = {}) {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
        if (token) headers.Authorization = `Bearer ${token}`;
        if (origin) headers.Origin = origin;
        if (clientId) headers['X-Collaborator-ID'] = clientId;
        if (version !== undefined) headers['X-Terrain-Version'] = String(version);
        if (encoding) headers['X-Payload-Encoding'] = encoding;
        const response = await worker.fetch(new Request(`https://worker.example${path}`, {
            method, headers, body
        }), env);
        return { status: response.status, body: await response.json() };
    }
    return { env, request };
}

async function compressedDelta(length, changes = {}) {
    const delta = new Float32Array(length);
    for (const [index, value] of Object.entries(changes)) delta[Number(index)] = value;
    const stream = new Blob([delta.buffer]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

const clientA = 'a'.repeat(32);
const clientB = 'b'.repeat(32);
const clientC = 'c'.repeat(32);

test('mesh initialization follows the circular site topology and request budget', async () => {
    const { request } = harness();
    const mesh = createInitialMesh();
    const state = await request('/api/state');
    equal(state.status, 200);
    equal(state.body.terrain.elevation.length, mesh.elevation.length);
    deepStrictEqual(state.body.terrain.elevation, Array.from(mesh.elevation));
    equal(getSyncIntervalMs(1), 300_000);
    equal(getSyncIntervalMs(1000), 2_160_000);
    ok(state.body.dailyRequestBudget < 100_000);
});

test('contributions from the same version are averaged once per browser', async () => {
    const { request } = harness();
    const initial = await request('/api/state');
    const length = initial.body.terrain.elevation.length;
    const now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
        const a = await request('/api/sync', {
            method: 'POST', clientId: clientA
        });
        const b = await request('/api/sync', {
            method: 'POST', clientId: clientB
        });
        equal(a.body.version, 0);
        equal(b.body.version, 0);

        const first = await request('/api/sync', {
            method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: -0.1 })
        });
        equal(first.body.accepted, true);
        equal(first.body.terrain, undefined);

        const duplicate = await request('/api/sync', {
            method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: 0.9 })
        });
        equal(duplicate.body.duplicate, true);
        equal(duplicate.body.acceptedContributions, 1);

        const second = await request('/api/sync', {
            method: 'POST', clientId: clientB, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: 0.3 })
        });
        equal(second.body.accepted, true);
        equal(second.body.acceptedContributions, 2);

        Date.now = () => now + 300_001;
        const finalized = await request('/api/sync', {
            method: 'POST', clientId: clientC
        });
        equal(finalized.body.version, 1);
        equal(finalized.body.activeCollaborators, 3);
        equal(finalized.body.acceptedContributions, 0);
        ok(Math.abs(finalized.body.terrain.elevation[0] - (initial.body.terrain.elevation[0] + 0.1)) < 1e-6);
    } finally {
        Date.now = realNow;
    }
});

test('stale versions and malformed collaborator data do not alter the terrain', async () => {
    const { request } = harness();
    equal((await request('/api/sync', { method: 'POST' })).status, 400);
    const initial = await request('/api/sync', { method: 'POST', clientId: clientA });
    const length = initial.body.terrain.elevation.length;
    const invalid = await request('/api/sync', {
        method: 'POST', clientId: clientA, version: 0,
        body: new Uint8Array(4)
    });
    equal(invalid.status, 400);

    const accepted = await request('/api/sync', {
        method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
        body: await compressedDelta(length, { 0: 0.2 })
    });
    equal(accepted.body.accepted, true);

    const outOfBounds = new Float32Array(length);
    outOfBounds[length - 1] = 0.1;
    const invalidBoundary = await request('/api/sync', {
        method: 'POST', clientId: clientB, version: 0, encoding: 'gzip',
        body: new Response(new Blob([outOfBounds.buffer]).stream()
            .pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    });
    equal(invalidBoundary.status, 400);

    const staleHarness = harness();
    const realNow = Date.now;
    const now = 2_000_000;
    Date.now = () => now;
    try {
        await staleHarness.request('/api/sync', {
            method: 'POST', clientId: clientA
        });
        const accepted = await staleHarness.request('/api/sync', {
            method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: 0.1 })
        });
        equal(accepted.body.accepted, true);
        Date.now = () => now + 300_001;
        const stale = await staleHarness.request('/api/sync', {
            method: 'POST', clientId: clientB, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: 0.1 })
        });
        equal(stale.body.version, 1);
        equal(stale.body.accepted, false);
        ok(Array.isArray(stale.body.terrain.elevation));
    } finally {
        Date.now = realNow;
    }
});

test('only the configured GitHub owner can reset shared terrain', async () => {
    const { request } = harness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        equal(url, 'https://api.github.com/user');
        const id = options.headers.Authorization === 'Bearer owner' ? 123 : 456;
        return Response.json({ id });
    };
    try {
        const initial = await request('/api/state');
        const mesh = createInitialMesh();
        equal((await request('/api/admin/reset', { method: 'POST' })).status, 401);
        equal((await request('/api/admin/reset', { method: 'POST', token: 'other' })).status, 403);
        const reset = await request('/api/admin/reset', { method: 'POST', token: 'owner' });
        equal(reset.status, 200);
        equal(reset.body.version, 1);
        deepStrictEqual(reset.body.terrain.elevation, Array.from(mesh.elevation));
        equal(reset.body.version, initial.body.version + 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('foreign origins and non-JSON OAuth requests are rejected', async () => {
    const { request } = harness();
    equal((await request('/api/state', { origin: 'https://other.example' })).status, 403);
});
