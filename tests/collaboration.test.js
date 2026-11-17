const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function harness() {
    const stored = new Map();
    const requests = [];
    let responseVersion = 4;
    let accepted = false;
    const context = vm.createContext({
        console,
        crypto: webcrypto,
        localStorage: {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, value)
        },
        CompressionStream,
        DecompressionStream,
        Blob,
        Response,
        Float32Array,
        Float64Array,
        fetch: async (url, options) => {
            requests.push({ url, options });
            const data = {
                version: responseVersion,
                activeCollaborators: 2,
                syncIntervalMs: 120_000,
                accepted,
                dailyRequestBudget: 80_000
            };
            if (options.headers['X-Terrain-Version'] !== String(responseVersion)) {
                data.terrain = { elevation: [1, 2] };
            }
            return new Response(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'collaboration.js'), 'utf8'),
        context
    );
    const CollaborativeSync = vm.runInContext('CollaborativeSync', context);
    const terrain = { elevation: Float64Array.from([1, 2]) };
    const sync = new CollaborativeSync(terrain, { save: () => true }, {
        endpoint: 'https://worker.example/api/sync'
    });
    return {
        sync, terrain, requests,
        setAccepted(value) { accepted = value; },
        setVersion(value) { responseVersion = value; }
    };
}

test('sync sends one compressed delta per shared version and follows the budget interval', async () => {
    const h = harness();
    await h.sync.sync();
    assert.equal(h.sync.activeCollaborators, 2);
    assert.equal(h.sync.syncIntervalMs, 300_000);
    assert.equal(h.requests[0].options.body, undefined);
    assert.match(h.sync.clientId, /^[a-f0-9]{32}$/);

    h.terrain.elevation[0] += 0.25;
    h.terrain.elevation[1] -= 0.5;
    h.setAccepted(true);
    await h.sync.sync();
    assert.equal(h.requests[1].options.headers['X-Terrain-Version'], '4');
    assert.equal(h.requests[1].options.headers['X-Payload-Encoding'], 'gzip');
    const compressed = new Response(h.requests[1].options.body);
    const bytes = await new Response(
        compressed.body.pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    assert.deepEqual(Array.from(new Float32Array(bytes)), [0.25, -0.5]);

    await h.sync.sync();
    assert.equal(h.requests[2].options.body, undefined);
});

test('manual sync does not bypass the adaptive minimum interval', async () => {
    const h = harness();
    await h.sync.sync();
    assert.equal(await h.sync.syncNow(), false);
    assert.equal(h.requests.length, 1);
});

test('reset waits for an in-flight sync and blocks new synchronization', async () => {
    const h = harness();
    let finish;
    h.sync.inFlight = new Promise(resolve => { finish = resolve; });
    const reset = h.sync.reset('token');
    await assert.rejects(h.sync.sync(), /reset is in progress/);
    assert.equal(h.requests.length, 0);
    finish();
    await reset;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, 'https://worker.example/api/admin/reset');
    assert.equal(h.sync.resetting, false);
});
