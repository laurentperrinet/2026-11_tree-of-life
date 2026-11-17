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
    let responseSignature = 'test mesh';
    let mergeInMs;
    let extra = {};
    const clock = { now: 1_000_000 };
    const context = vm.createContext({
        console,
        Date: { now: () => clock.now },
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
        LEGACY_TERRAIN_MESH_SIGNATURE: JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]),
        fetch: async (url, options) => {
            requests.push({ url, options });
            const data = {
                version: responseVersion,
                meshSignature: responseSignature,
                activeCollaborators: 2,
                syncIntervalMs: 120_000,
                accepted,
                dailyRequestBudget: 80_000,
                mergeInMs,
                ...extra
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
    const terrain = { elevation: Float64Array.from([1, 2]), meshSignature: () => 'test mesh' };
    const sync = new CollaborativeSync(terrain, { save: () => true }, {
        endpoint: 'https://worker.example/api/sync'
    });
    return {
        sync, terrain, requests, clock,
        setMergeInMs(value) { mergeInMs = value; },
        setExtra(value) { extra = value; },
        setAccepted(value) { accepted = value; },
        setVersion(value) { responseVersion = value; },
        setSignature(value) { responseSignature = value; }
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
    assert.equal(h.requests[1].options.headers['X-Mesh-Signature'], 'test mesh');
    const compressed = new Response(h.requests[1].options.body);
    const bytes = await new Response(
        compressed.body.pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    assert.deepEqual(Array.from(new Float32Array(bytes)), [0.25, -0.5]);

    await h.sync.sync();
    assert.equal(h.requests[2].options.body, undefined);
});

test('sync rejects a different mesh before changing local terrain', async () => {
    const h = harness();
    h.setSignature('another mesh');
    await assert.rejects(h.sync.sync(), /incompatible terrain mesh/);
    assert.equal(h.sync.version, null);
    assert.deepEqual(Array.from(h.terrain.elevation), [1, 2]);
});

test('the current mesh can still synchronize with the older Worker', async () => {
    const h = harness();
    h.terrain.meshSignature = () => JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
    h.setSignature(undefined);
    await h.sync.sync();
    await h.sync.sync();
    assert.equal(h.requests[1].options.headers['X-Mesh-Signature'], undefined);
});

test('manual sync does not bypass the adaptive minimum interval', async () => {
    const h = harness();
    await h.sync.sync();
    assert.equal(await h.sync.syncNow(), false);
    assert.equal(h.requests.length, 1);
});

test('next sync countdown follows the scheduled retry and clears on stop', () => {
    let now = 1000;
    let delay;
    const context = vm.createContext({
        console, crypto: webcrypto,
        localStorage: { getItem: () => null, setItem() {} },
        Date: { now: () => now },
        setTimeout: (callback, ms) => { delay = ms; return 1; },
        clearTimeout() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'collaboration.js'), 'utf8'), context
    );
    const CollaborativeSync = vm.runInContext('CollaborativeSync', context);
    const sync = new CollaborativeSync({}, null);
    assert.equal(sync.getSecondsUntilSync(), null);
    sync.running = true;
    sync.schedule();
    assert.equal(delay, 300_000);
    assert.equal(sync.getSecondsUntilSync(), 300);
    now += 10_500;
    assert.equal(sync.getSecondsUntilSync(), 290);
    sync.failureCount = 1;
    sync.schedule();
    assert.equal(delay, 600_000);
    assert.equal(sync.getSecondsUntilSync(), 600);
    sync.inFlight = Promise.resolve();
    assert.equal(sync.getSecondsUntilSync(), null);
    sync.inFlight = null;
    sync.stop();
    assert.equal(sync.getSecondsUntilSync(), null);
});

test('a failed first or manual sync backs off the next retry', async () => {
    let now = 1000;
    let delay;
    const context = vm.createContext({
        console, crypto: webcrypto,
        localStorage: { getItem: () => null, setItem() {} },
        Date: { now: () => now },
        fetch: async () => { throw new Error('offline'); },
        setTimeout: (callback, ms) => { delay = ms; return 1; },
        clearTimeout() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'collaboration.js'), 'utf8'), context
    );
    const CollaborativeSync = vm.runInContext('CollaborativeSync', context);
    const sync = new CollaborativeSync({ meshSignature: () => 'test mesh' }, null);
    await assert.rejects(sync.start(), /offline/);
    assert.equal(sync.failureCount, 1);
    assert.equal(delay, 600_000);
    assert.equal(sync.getSecondsUntilSync(), 600);
    now += 300_000;
    await assert.rejects(sync.syncNow(), /offline/);
    assert.equal(sync.failureCount, 2);
    assert.equal(delay, 1_200_000);
});

test('next merge countdown follows the Worker collection window', async () => {
    const h = harness();
    await h.sync.sync();
    assert.equal(h.sync.getSecondsUntilMerge(), null);
    h.setMergeInMs(120_000);
    h.clock.now += 1;
    await h.sync.sync();
    assert.equal(h.sync.getSecondsUntilMerge(), 120);
    h.clock.now += 30_500;
    assert.equal(h.sync.getSecondsUntilMerge(), 90);
    h.clock.now += 200_000;
    assert.equal(h.sync.getSecondsUntilMerge(), 0);
    h.setMergeInMs(-1);
    await assert.rejects(h.sync.sync(), /invalid merge delay/);
    h.setMergeInMs(null);
    await h.sync.sync();
    assert.equal(h.sync.getSecondsUntilMerge(), null);
});

test('collaborator totals and the last merge are read from the Worker', async () => {
    const h = harness();
    await h.sync.sync();
    assert.equal(h.sync.totalCollaborators, null);
    assert.equal(h.sync.getLastMerge(), null);
    h.setExtra({
        totalCollaborators: 37, onlineCollaborators: 3, acceptedContributions: 1,
        lastMerge: { agoMs: 60_000, version: 4, contributors: 3, includesYou: true }
    });
    await h.sync.sync();
    assert.equal(h.sync.totalCollaborators, 37);
    assert.equal(h.sync.onlineCollaborators, 3);
    assert.equal(h.sync.pendingContributions, 1);
    assert.deepEqual({ ...h.sync.getLastMerge() },
        { contributors: 3, includesYou: true, secondsAgo: 60 });
    h.clock.now += 30_000;
    assert.equal(h.sync.getLastMerge().secondsAgo, 90);
    h.setExtra({ lastMerge: { agoMs: 0, version: 4, contributors: 0, includesYou: false } });
    await assert.rejects(h.sync.sync(), /invalid last merge/);
    h.setExtra({ totalCollaborators: -1 });
    await assert.rejects(h.sync.sync(), /invalid totalCollaborators/);
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
