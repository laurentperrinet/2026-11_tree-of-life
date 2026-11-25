const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

function loadTimelapse(globals = {}) {
    const context = vm.createContext({ TextEncoder, console, ...globals });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'timelapse.js'), 'utf8'), context);
    return vm.runInContext(
        '({ crc32, addPngText, TimelapseRecorder })', context);
}

// Minimal valid 2 × 1 RGBA PNG, built independently of the code under test.
function tinyPng() {
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'latin1');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);
    return new Uint8Array(Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
    ]));
}

function readChunks(png) {
    const buffer = Buffer.from(png);
    const chunks = [];
    for (let offset = 8; offset < buffer.length;) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('latin1', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        const crc = buffer.readUInt32BE(offset + 8 + length);
        chunks.push({ type, data, crcOk: crc === zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length)) });
        offset += 12 + length;
    }
    return chunks;
}

test('PNG CRC matches the standard IEND checksum', () => {
    const { crc32 } = loadTimelapse();
    assert.equal(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44])), 0xae426082);
});

test('PNG metadata is inserted after IHDR with valid checksums', () => {
    const { addPngText } = loadTimelapse();
    const original = tinyPng();
    const png = addPngText(original, [
        ['Creation Time', '2026-11-17T18:42:03.123Z'],
        ['Commit', 'db4e9ff0123456789abcdef0123456789abcdef0']
    ]);
    const chunks = readChunks(png);
    assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
    assert.ok(chunks.every(c => c.crcOk));
    assert.equal(chunks[1].data.toString('latin1'), 'Creation Time\0' + '2026-11-17T18:42:03.123Z');
    assert.equal(chunks[2].data.toString('latin1'), 'Commit\0db4e9ff0123456789abcdef0123456789abcdef0');
    // Image chunks are copied unchanged.
    assert.deepEqual(chunks[3].data, readChunks(original)[1].data);
    assert.throws(() => addPngText(original, [['Badé', 'x']]), /keyword/);
    assert.throws(() => addPngText(new Uint8Array(40), []), /Not a PNG/);
});

test('recorder captures once per second, waits while writing and restarts after a stall', async () => {
    const { TimelapseRecorder } = loadTimelapse();
    const captures = [];
    const renderer = { captureDefaultView: (grid, biology, w, h) => { captures.push([w, h]); return 'pixels'; } };
    const recorder = new TimelapseRecorder(renderer, { width: 64, height: 40 });
    const written = [];
    let finishWrite;
    let index = 341;
    recorder.writeFrame = (pixels, createdAt) => {
        written.push(++index);
        assert.equal(pixels, 'pixels');
        assert.match(createdAt.toISOString(), /^\d{4}-\d{2}-\d{2}T/);
        return new Promise(resolve => { finishWrite = () => resolve(`${index}`); });
    };
    recorder.update(0);
    assert.equal(captures.length, 0, 'inactive recorder captures nothing');

    recorder.active = true;
    recorder.update(0);
    assert.deepEqual(written, [342]);
    assert.deepEqual(captures[0], [64, 40]);
    recorder.update(1000);
    assert.deepEqual(written, [342], 'busy: nothing is captured or queued');
    finishWrite();
    await new Promise(setImmediate);
    assert.equal(recorder.framesWritten, 1);
    assert.equal(recorder.lastFile, '342');
    recorder.update(1500);
    assert.deepEqual(written, [342, 343], 'the delayed frame is taken once the disk is free');
    finishWrite();
    await new Promise(setImmediate);
    recorder.update(1999);
    assert.deepEqual(written, [342, 343], 'the 1 s grid is kept: next slot at 2000 ms');
    recorder.update(2004);
    assert.deepEqual(written, [342, 343, 344]);
    finishWrite();
    await new Promise(setImmediate);
    recorder.update(9000);
    assert.deepEqual(written, [342, 343, 344, 345]);
    finishWrite();
    await new Promise(setImmediate);
    recorder.update(9500);
    recorder.update(9999);
    assert.deepEqual(written, [342, 343, 344, 345], 'after a stall the grid restarts, no burst');
    recorder.update(10000);
    assert.deepEqual(written, [342, 343, 344, 345, 346]);
});

test('a failed write stops recording and reports the error', async () => {
    const { TimelapseRecorder } = loadTimelapse();
    const recorder = new TimelapseRecorder({ captureDefaultView: () => 'pixels' });
    let reported;
    recorder.onError = error => { reported = error.message; };
    recorder.writeFrame = async () => { throw new Error('disk full'); };
    recorder.active = true;
    recorder.update(0);
    await new Promise(setImmediate);
    assert.equal(recorder.active, false);
    assert.equal(recorder.busy, false);
    assert.equal(reported, 'disk full');
});

test('start checks the local server, and frames are posted with their metadata', async () => {
    const requests = [];
    let serverUp = true;
    let png;
    const fetch = async (url, options = {}) => {
        requests.push([url, options.method || 'GET']);
        if (!serverUp) throw new TypeError('Load failed');
        if (url === 'api/timelapse/status') {
            return { ok: true, json: async () => ({ next: '000008.png', folder: '/Users/me/timelapse' }) };
        }
        if (url === 'version.json') return { ok: true, json: async () => ({ commit: 'abcdef1234567-dirty' }) };
        if (url === 'api/timelapse/frame') {
            png = new Uint8Array(await options.body.arrayBuffer());
            assert.equal(options.headers['Content-Type'], 'image/png');
            return { ok: true, json: async () => ({ name: '000008.png' }) };
        }
        throw new Error(`unexpected ${url}`);
    };
    const { TimelapseRecorder } = loadTimelapse({ fetch, Blob });
    const recorder = new TimelapseRecorder({});
    await recorder.start();
    assert.equal(recorder.active, true);
    assert.equal(recorder.folder, '/Users/me/timelapse');
    assert.equal(recorder.commit, 'abcdef1234567-dirty');

    recorder.encodePng = async (pixels, metadata) => {
        assert.deepEqual(Array.from(metadata, ([key]) => key), ['Creation Time', 'Commit', 'Software']);
        assert.equal(metadata[0][1], '2026-11-17T18:42:03.123Z');
        assert.equal(metadata[1][1], 'abcdef1234567-dirty');
        return new Blob([tinyPng()], { type: 'image/png' });
    };
    const name = await recorder.writeFrame('pixels', new Date('2026-11-17T18:42:03.123Z'));
    assert.equal(name, '000008.png');
    assert.deepEqual(png, tinyPng());
    assert.deepEqual(requests.at(-1), ['api/timelapse/frame', 'POST']);

    serverUp = false;
    const offline = new TimelapseRecorder({});
    await assert.rejects(offline.start(), /timelapse_server\.py/);
    assert.equal(offline.active, false);
    assert.equal(TimelapseRecorder.isLocal({ hostname: 'localhost' }), true);
    assert.equal(TimelapseRecorder.isLocal({ hostname: 'laurentperrinet.github.io' }), false);
});

test('a server error stops recording with its message', async () => {
    const fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'cannot write frame: No space left on device' }) });
    const { TimelapseRecorder } = loadTimelapse({ fetch, Blob });
    const recorder = new TimelapseRecorder({});
    recorder.encodePng = async () => new Blob([tinyPng()]);
    await assert.rejects(recorder.writeFrame('pixels', new Date()), /No space left/);
});

test('default view is rendered off screen in habitat mode, then the mode is restored', () => {
    class Vector { set(x, y, z) { Object.assign(this, { x, y, z }); } }
    class Camera {
        constructor(fov, aspect) { this.fov = fov; this.aspect = aspect; this.position = new Vector(); this.up = new Vector(); }
        lookAt(x, y, z) { this.target = [x, y, z]; }
        updateProjectionMatrix() {}
    }
    class Target { constructor(width, height) { Object.assign(this, { width, height }); } dispose() {} }
    const context = vm.createContext({ THREE: { PerspectiveCamera: Camera, WebGLRenderTarget: Target } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8'), context);
    const TerrainRenderer = vm.runInContext('TerrainRenderer', context);
    const renderer = Object.create(TerrainRenderer.prototype);
    const modes = [];
    renderer.updateTerrainMesh = () => modes.push(renderer.displayMode);
    renderer.displayMode = 'flux';
    renderer.camera = new Camera(55, 1);
    renderer.camera.position.set(3, 4, 5);
    const calls = [];
    renderer.renderer = {
        capabilities: { isWebGL2: false },
        setRenderTarget: target => calls.push(target ? 'target' : 'screen'),
        render: (scene, camera) => {
            calls.push('render');
            assert.equal(renderer.displayMode, 'habitat');
            assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [0, 65, 0]);
            assert.deepEqual(camera.target, [0, 0, 0]);
            assert.equal(camera.aspect, 1);
        },
        // Bottom row red, top row blue, alpha 0 (as transparent parcels can leave it).
        readRenderTargetPixels: (target, x, y, w, h, buffer) => {
            buffer.set([255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0]);
        }
    };
    const pixels = renderer.captureDefaultView({}, {}, 2, 2);
    assert.deepEqual(calls, ['target', 'render', 'screen']);
    assert.deepEqual(modes, ['habitat', 'flux']);
    assert.equal(renderer.displayMode, 'flux');
    assert.deepEqual([renderer.camera.position.x, renderer.camera.position.y], [3, 4], 'visitor camera untouched');
    assert.deepEqual(Array.from(pixels), [0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255]);

    modes.length = 0;
    renderer.displayMode = 'habitat';
    renderer.captureDefaultView({}, {}, 2, 2);
    assert.deepEqual(modes, [], 'no recolouring when the default mode is already shown');
});

test('stopping waits for the last frame, then follows the video encoding', async () => {
    const calls = [];
    let polls = 0;
    const fetch = async (url, options = {}) => {
        calls.push(`${options.method || 'GET'} ${url}`);
        if (url === 'api/timelapse/stop') {
            return { ok: true, json: async () => ({ video: { state: 'encoding', path: '/r/timelapse.mp4' } }) };
        }
        if (url === 'api/timelapse/status') {
            polls++;
            const video = polls < 2 ? { state: 'encoding', path: '/r/timelapse.mp4' }
                : { state: 'done', path: '/r/timelapse.mp4', frames: 342, seconds: 11.4 };
            return { ok: true, json: async () => ({ video }) };
        }
        throw new Error(`unexpected ${url}`);
    };
    const { TimelapseRecorder } = loadTimelapse({ fetch, setTimeout: fn => setImmediate(fn) });
    const recorder = new TimelapseRecorder({});
    recorder.active = true;
    let release;
    recorder.pending = new Promise(resolve => { release = () => { calls.push('frame written'); resolve(); }; });
    const states = [];
    recorder.onChange = () => states.push(recorder.video?.state ?? 'stopped');
    const finishing = recorder.finish();
    await new Promise(setImmediate);
    assert.equal(recorder.active, false);
    assert.deepEqual(calls, [], 'no video request before the last frame is written');
    release();
    const video = await finishing;
    assert.deepEqual(calls, ['frame written', 'POST api/timelapse/stop',
        'GET api/timelapse/status', 'GET api/timelapse/status']);
    assert.equal(video.frames, 342);
    assert.deepEqual(states, ['stopped', 'encoding', 'encoding', 'done']);
});

test('a failed encoding is reported with the server message', async () => {
    const fetch = async () => ({
        ok: true, json: async () => ({ video: { state: 'error', message: 'ffmpeg not found (brew install ffmpeg)' } })
    });
    const { TimelapseRecorder } = loadTimelapse({ fetch });
    const recorder = new TimelapseRecorder({});
    await assert.rejects(recorder.finish(), /brew install ffmpeg/);
});

test('encoding poll is bounded and reports the server state on timeout', async () => {
    let polls = 0;
    const fetch = async (url) => {
        if (url === 'api/timelapse/stop') {
            return { ok: true, json: async () => ({ video: { state: 'encoding', path: '/r/timelapse.mp4' } }) };
        }
        polls++;
        return { ok: true, json: async () => ({ video: { state: 'encoding', path: '/r/timelapse.mp4' } }) };
    };
    const { TimelapseRecorder } = loadTimelapse({ fetch, setTimeout: fn => setImmediate(fn) });
    const recorder = new TimelapseRecorder({});
    recorder.maxPollAttempts = 3;
    recorder.pollMs = 1000;
    await assert.rejects(recorder.finish(), /timed out after 3 s \(server state: encoding\)/);
    assert.equal(polls, 3);
});
