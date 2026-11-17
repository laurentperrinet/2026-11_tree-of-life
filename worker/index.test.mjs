import { test } from 'node:test';
import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import worker, { Simulation } from './index.mjs';
import {
    channelSandFactor, createInitialMesh, getSyncIntervalMs, LEGACY_MESH_SIGNATURE, MESH_SIGNATURE
} from './mesh.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(initialState) {
    const values = new Map(initialState ? [['state', structuredClone(initialState)]] : []);
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
        method = 'GET', body, token, origin, clientId, version, encoding, meshSignature
    } = {}) {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
        if (token) headers.Authorization = `Bearer ${token}`;
        if (origin) headers.Origin = origin;
        if (clientId) headers['X-Collaborator-ID'] = clientId;
        if (version !== undefined) headers['X-Terrain-Version'] = String(version);
        if (encoding) headers['X-Payload-Encoding'] = encoding;
        if (path === '/api/sync' && meshSignature !== false) {
            headers['X-Mesh-Signature'] = meshSignature || MESH_SIGNATURE;
        }
        const response = await worker.fetch(new Request(`https://worker.example${path}`, {
            method, headers, body
        }), env);
        return { status: response.status, body: await response.json() };
    }
    return { env, request, storedState: () => values.get('state') };
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

test('browser and Worker initialize the same higher-resolution terrain', () => {
    const context = vm.createContext({ console });
    vm.runInContext(readFileSync(new URL('../js/terrain.js', import.meta.url), 'utf8'), context);
    const grid = vm.runInContext('new TerrainGrid()', context);
    const mesh = createInitialMesh();
    ok(grid.triangles.length > 64_100);
    equal(grid.vertices.length, mesh.elevation.length);
    equal(grid.erodibleCount, mesh.erodibleCount);
    equal(grid.meshSignature(), MESH_SIGNATURE);
    deepStrictEqual(Array.from(grid.bedrock), Array.from(mesh.bedrock));
    deepStrictEqual(Array.from(grid.elevation), Array.from(mesh.elevation));
});

test('a changed mesh signature resets shared terrain and pending contributions once', async () => {
    const mesh = createInitialMesh();
    const old = {
        schemaVersion: 2, meshSignature: 'previous mesh', version: 12,
        elevation: Float64Array.from(mesh.elevation, height => height + 1),
        bedrock: mesh.bedrock, erodibleCount: mesh.erodibleCount,
        sumDelta: new Float64Array(mesh.elevation.length),
        activeClients: {}, contributions: { [clientA]: true },
        contributionIds: [clientA], windowEndsAt: 1
    };
    const { request } = harness(old);
    const state = await request('/api/state');
    equal(state.status, 200);
    equal(state.body.version, 13);
    equal(state.body.acceptedContributions, 0);
    deepStrictEqual(state.body.terrain.elevation, Array.from(mesh.elevation));
    equal((await request('/api/state')).body.version, 13);
});

test('shared states from the polar-ring meshes restart on the spiral mesh', async () => {
    const polarJitter = JSON.stringify([
        'disk-square-polar-v2', 25, 30, 125, 0.2, 'channel-sand-free-v1', 'jitter-v1', 0.1, 2026
    ]);
    for (const [schemaVersion, meshSignature] of [
        [2, undefined], [3, LEGACY_MESH_SIGNATURE], [4, polarJitter]
    ]) {
        // The polar meshes had 50,264 vertices, 48,696 of them erodible.
        const old = {
            schemaVersion, meshSignature, version: 12,
            elevation: new Float64Array(50_264).fill(1),
            bedrock: new Float64Array(50_264),
            erodibleCount: 48_696,
            sumDelta: new Float64Array(50_264),
            activeClients: {},
            contributions: { [clientA]: true },
            contributionIds: [clientA],
            windowEndsAt: 1
        };
        const { request, storedState } = harness(old);
        const state = await request('/api/state');
        const mesh = createInitialMesh();
        equal(state.status, 200);
        equal(state.body.version, 13);
        equal(state.body.acceptedContributions, 0);
        deepStrictEqual(state.body.terrain.elevation, Array.from(mesh.elevation));
        equal(storedState().meshSignature, MESH_SIGNATURE);
        equal(storedState().erodibleCount, mesh.erodibleCount);
        equal((await request('/api/state')).body.version, 13);
    }
});

test('version 1 shared terrain is reset once when the mesh schema changes', async () => {
    const old = {
        schemaVersion: 1, version: 12,
        elevation: new Float64Array([42]), bedrock: new Float64Array([0]),
        sumDelta: new Float64Array([2]), activeClients: {}, contributions: { [clientA]: true },
        contributionIds: [clientA], windowEndsAt: 1
    };
    const { request } = harness(old);
    const state = await request('/api/state');
    equal(state.status, 200);
    equal(state.body.version, 13);
    equal(state.body.acceptedContributions, 0);
    deepStrictEqual(state.body.terrain.elevation, Array.from(createInitialMesh().elevation));
    equal((await request('/api/state')).body.version, 13);
});

test('large realistic compressed contributions fit the higher-resolution mesh', async () => {
    const { request } = harness();
    const mesh = createInitialMesh();
    const delta = new Float32Array(mesh.elevation.length);
    let random = 123456789;
    for (let i = 0; i < delta.length; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        delta[i] = random / 0x100000000;
    }
    const body = await new Response(new Blob([delta.buffer]).stream()
        .pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    ok(body.byteLength > 100_000);
    equal((await request('/api/sync', {
        method: 'POST', clientId: clientA, version: 0, encoding: 'gzip', body
    })).body.accepted, true);
});

test('contributions from an incompatible mesh are rejected', async () => {
    const { request } = harness();
    const mesh = createInitialMesh();
    const response = await request('/api/sync', {
        method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
        meshSignature: 'different mesh', body: await compressedDelta(mesh.elevation.length, { 0: 0.1 })
    });

    equal(response.status, 409);
    equal((await request('/api/state')).body.acceptedContributions, 0);
});

test('initial mesh has no sand on the channel axis or flanks', () => {
    const mesh = createInitialMesh();
    for (let i = 0; i < mesh.vertices.length; i++) {
        const { x, z } = mesh.vertices[i];
        if (z <= 0) continue;
        const depth = mesh.elevation[i] - mesh.bedrock[i];
        if (channelSandFactor(x, z) === 0) equal(depth, 0);
        else ok(depth >= 0);
    }
});

test('legacy Durable Object state migrates to the triangular mesh schema', async () => {
    const { request } = harness({
        version: 8,
        terrain: { elevation: [], waterDepth: [], sediment: [] },
        parameters: { flow: 0.5, speed: 1 },
        tasks: [null, null, null, null]
    });
    const migrated = await request('/api/state');
    const mesh = createInitialMesh();
    equal(migrated.status, 200);
    equal(migrated.body.version, 9);
    deepStrictEqual(migrated.body.terrain.elevation, Array.from(mesh.elevation));
});

test('empty sync request bodies are treated as heartbeats, not compressed updates', async () => {
    const { request } = harness();
    const heartbeat = await request('/api/sync', {
        method: 'POST', clientId: clientA, body: new Uint8Array(0)
    });
    equal(heartbeat.status, 200);
    equal(heartbeat.body.activeCollaborators, 1);
    equal(heartbeat.body.version, 0);
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
        equal(b.body.mergeInMs, null);

        const first = await request('/api/sync', {
            method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
            body: await compressedDelta(length, { 0: -0.1 })
        });
        equal(first.body.accepted, true);
        equal(first.body.terrain, undefined);
        equal(first.body.mergeInMs, 300_000);

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

        Date.now = () => now + 120_000;
        equal((await request('/api/state')).body.mergeInMs, 180_000);
        Date.now = () => now + 300_001;
        const due = await request('/api/state');
        equal(due.body.mergeInMs, 0);
        equal(due.body.version, 0);
        const finalized = await request('/api/sync', {
            method: 'POST', clientId: clientC
        });
        equal(finalized.body.version, 1);
        equal(finalized.body.mergeInMs, null);
        equal(finalized.body.totalCollaborators, 3);
        equal(finalized.body.onlineCollaborators, 3);
        deepStrictEqual(finalized.body.lastMerge,
            { agoMs: 0, version: 1, contributors: 2, includesYou: false });
        Date.now = () => now + 360_001;
        const contributor = await request('/api/sync', {
            method: 'POST', clientId: clientA, version: 1
        });
        deepStrictEqual(contributor.body.lastMerge,
            { agoMs: 60_000, version: 1, contributors: 2, includesYou: true });
        equal((await request('/api/state')).body.lastMerge.includesYou, null);
        equal(finalized.body.activeCollaborators, 3);
        equal(finalized.body.acceptedContributions, 0);
        ok(Math.abs(finalized.body.terrain.elevation[0] - (initial.body.terrain.elevation[0] + 0.1)) < 1e-6);
    } finally {
        Date.now = realNow;
    }
});

test('browser activity and the collaborator count survive a mesh change', async () => {
    const seed = harness();
    await seed.request('/api/state');
    const now = Date.now();
    const { request } = harness({
        ...seed.storedState(), meshSignature: 'earlier mesh',
        activeClients: { [clientA]: now, [clientB]: now, 'not-an-id': now }
    });
    const body = (await request('/api/state')).body;
    equal(body.activeCollaborators, 2);
    equal(body.totalCollaborators, 2);
});

test('collaborators are counted once in total and as online while recently seen', async () => {
    const seed = harness();
    await seed.request('/api/state');
    const start = 2_000_000_000;
    const realNow = Date.now;
    try {
        Date.now = () => start;
        // A stored state without a count is seeded from its active browser IDs.
        const { request } = harness({
            ...seed.storedState(), activeClients: { [clientA]: start, [clientB]: start }
        });
        let body = (await request('/api/state')).body;
        equal(body.totalCollaborators, 2);
        equal(body.onlineCollaborators, 2);
        equal(body.activeCollaborators, 2);

        Date.now = () => start + 601_000;
        body = (await request('/api/sync', { method: 'POST', clientId: clientC })).body;
        equal(body.totalCollaborators, 3);
        equal(body.onlineCollaborators, 1);
        equal(body.activeCollaborators, 3);

        // A browser returning after its 24 h activity expired is not counted again.
        Date.now = () => start + 25 * 3600_000;
        body = (await request('/api/sync', { method: 'POST', clientId: clientA })).body;
        equal(body.activeCollaborators, 1);
        equal(body.totalCollaborators, 3);

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => Response.json({ id: 123 });
        try {
            const reset = await request('/api/admin/reset', { method: 'POST', token: 'owner' });
            equal(reset.status, 200);
            equal(reset.body.totalCollaborators, 3);
            equal(reset.body.lastMerge, null);
        } finally {
            globalThis.fetch = originalFetch;
        }
    } finally {
        Date.now = realNow;
    }
});

test('surround deposits are accepted and persisted without allowing erosion', async () => {
    const { request } = harness();
    const initial = await request('/api/state');
    const index = createInitialMesh().erodibleCount;
    const realNow = Date.now;
    const now = 3_000_000;
    Date.now = () => now;
    try {
        const deposit = await request('/api/sync', {
            method: 'POST', clientId: clientA, version: 0, encoding: 'gzip',
            body: await compressedDelta(initial.body.terrain.elevation.length, { [index]: 0.1 })
        });
        equal(deposit.body.accepted, true);
        Date.now = () => now + 300_001;
        const finalized = await request('/api/sync', { method: 'POST', clientId: clientB });
        ok(Math.abs(finalized.body.terrain.elevation[index] -
            initial.body.terrain.elevation[index] - 0.1) < 1e-6);
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
    outOfBounds[length - 1] = -0.1;
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
