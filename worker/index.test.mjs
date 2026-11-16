import { test } from 'node:test';
import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import worker, { Simulation } from './index.mjs';
import { calculateRows, HEIGHT } from './physics.mjs';

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
    async function request(path, { method = 'GET', body, token, origin } = {}) {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        if (origin) headers.Origin = origin;
        const response = await worker.fetch(new Request(`https://worker.example${path}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body)
        }), env);
        return { status: response.status, body: await response.json() };
    }
    return { env, request };
}

test('four leased tiles form one coherent time step; stale submissions are rejected', async () => {
    const { request } = harness();
    const initial = (await request('/api/state')).body;
    const claims = await Promise.all(Array.from({ length: 4 }, () =>
        request('/api/tasks/claim', { method: 'POST' })
    ));
    ok(claims.every(claim => claim.status === 200));
    equal(new Set(claims.map(claim => claim.body.start)).size, 4);
    equal((await request('/api/tasks/claim', { method: 'POST' })).status, 409);

    const expected = calculateRows(initial.terrain, initial.parameters, 0, HEIGHT);
    const submissions = claims.map(({ body: job }) => ({
        version: job.version,
        lease: job.lease,
        result: calculateRows(job.terrain, job.parameters, job.start, job.end)
    }));
    const results = await Promise.all(submissions.map(body =>
        request('/api/tasks/submit', { method: 'POST', body })
    ));
    ok(results.every(result => result.status === 200));
    equal(results.filter(result => result.body.completed).length, 1);
    const state = (await request('/api/state')).body;
    equal(state.version, 1);
    deepStrictEqual(state.terrain, expected);
    equal((await request('/api/tasks/submit', { method: 'POST', body: submissions[0] })).status, 409);
});

test('invalid results are rejected without consuming a lease', async () => {
    const { request } = harness();
    const job = (await request('/api/tasks/claim', { method: 'POST' })).body;
    const result = calculateRows(job.terrain, job.parameters, job.start, job.end);
    const invalid = structuredClone(result);
    invalid.sediment.fill(1);
    const rejected = await request('/api/tasks/submit', {
        method: 'POST', body: { version: job.version, lease: job.lease, result: invalid }
    });
    equal(rejected.status, 422);
    const accepted = await request('/api/tasks/submit', {
        method: 'POST', body: { version: job.version, lease: job.lease, result }
    });
    equal(accepted.status, 200);
});

test('only the configured GitHub owner can modify parameters or reset', async () => {
    const { request } = harness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        equal(url, 'https://api.github.com/user');
        const id = options.headers.Authorization === 'Bearer owner' ? 123 : 456;
        return Response.json({ id });
    };
    try {
        const parameters = { flow: 0.8, speed: 2 };
        const job = (await request('/api/tasks/claim', { method: 'POST' })).body;
        equal((await request('/api/admin/parameters', { method: 'POST', body: parameters })).status, 401);
        equal((await request('/api/admin/parameters', {
            method: 'POST', body: parameters, token: 'other'
        })).status, 403);
        equal((await request('/api/admin/parameters', {
            method: 'POST', body: { flow: -1, speed: 2 }, token: 'owner'
        })).status, 400);
        equal((await request('/api/admin/parameters', {
            method: 'POST', body: parameters, token: 'owner'
        })).status, 200);
        const state = (await request('/api/state')).body;
        deepStrictEqual(state.parameters, parameters);
        equal(state.version, 1);
        equal((await request('/api/tasks/submit', {
            method: 'POST',
            body: {
                version: job.version, lease: job.lease,
                result: calculateRows(job.terrain, job.parameters, job.start, job.end)
            }
        })).status, 409);
        equal((await request('/api/admin/reset', { method: 'POST', token: 'other' })).status, 403);
        equal((await request('/api/admin/reset', { method: 'POST', token: 'owner' })).status, 200);
        equal((await request('/api/state')).body.version, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('other browser origins and malformed payloads are rejected', async () => {
    const { request } = harness();
    equal((await request('/api/state', { origin: 'https://other.example' })).status, 403);
    equal((await request('/api/tasks/submit', {
        method: 'POST', body: { version: 0, lease: 'missing', result: {} }
    })).status, 409);
});

test('expired leases can be reassigned and cannot be submitted', async () => {
    const { request } = harness();
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
        const job = (await request('/api/tasks/claim', { method: 'POST' })).body;
        const result = calculateRows(job.terrain, job.parameters, job.start, job.end);
        now += 60_001;
        equal((await request('/api/tasks/submit', {
            method: 'POST', body: { version: job.version, lease: job.lease, result }
        })).status, 409);
        const replacement = (await request('/api/tasks/claim', { method: 'POST' })).body;
        equal(replacement.start, job.start);
        ok(replacement.lease !== job.lease);
    } finally {
        Date.now = realNow;
    }
});

test('OAuth exchange requires configuration and forwards only the token', async () => {
    const { env, request } = harness();
    equal((await request('/api/auth/exchange', {
        method: 'POST', body: { code: 'code' }
    })).status, 503);

    env.GITHUB_CLIENT_ID = 'client';
    env.GITHUB_CLIENT_SECRET = 'secret';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        equal(url, 'https://github.com/login/oauth/access_token');
        const payload = JSON.parse(options.body);
        equal(payload.code, 'code');
        equal(payload.redirect_uri, 'https://laurentperrinet.github.io/2026-11_tree-of-life/');
        return Response.json({ access_token: 'token', token_type: 'bearer' });
    };
    try {
        const result = await request('/api/auth/exchange', {
            method: 'POST', body: { code: 'code' }
        });
        equal(result.status, 200);
        deepStrictEqual(result.body, { access_token: 'token' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
