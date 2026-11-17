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
        '({ crc32, addPngText, timelapseFileName, nextTimelapseIndex, TimelapseRecorder })', context);
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

test('frames are numbered with six digits and continue an existing sequence', () => {
    const { timelapseFileName, nextTimelapseIndex } = loadTimelapse();
    assert.equal(timelapseFileName(342), '000342.png');
    assert.equal(timelapseFileName(1), '000001.png');
    assert.throws(() => timelapseFileName(0), /out of range/);
    assert.equal(nextTimelapseIndex([]), 1);
    assert.equal(nextTimelapseIndex(['000001.png', '000342.png', '12.png', 'x.png', '000400.png.crswap']), 343);
});

test('recorder captures once per second, waits while writing and restarts after a stall', async () => {
    const { TimelapseRecorder } = loadTimelapse();
    const captures = [];
    const renderer = { captureDefaultView: (grid, biology, w, h) => { captures.push([w, h]); return 'pixels'; } };
    const recorder = new TimelapseRecorder(renderer, { width: 64, height: 40 });
    const written = [];
    let finishWrite;
    recorder.writeFrame = (index, pixels, createdAt) => {
        written.push(index);
        assert.equal(pixels, 'pixels');
        assert.match(createdAt.toISOString(), /^\d{4}-\d{2}-\d{2}T/);
        return new Promise(resolve => { finishWrite = () => resolve(`${index}`); });
    };
    recorder.update(0);
    assert.equal(captures.length, 0, 'inactive recorder captures nothing');

    recorder.active = true;
    recorder.nextIndex = 342;
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

test('start appends to the timelapse folder and reads the deployed commit', async () => {
    const files = ['000001.png', '000007.png', 'notes.txt'];
    const timelapseDir = {
        name: 'timelapse',
        async *keys() { yield* files; }
    };
    let created;
    const parent = {
        name: 'Pictures',
        getDirectoryHandle: async (name, options) => { created = [name, options.create]; return timelapseDir; }
    };
    const window = { showDirectoryPicker: async () => parent };
    const fetch = async url => ({
        ok: true, json: async () => ({ commit: url === 'version.json' ? 'abcdef1234567' : '' })
    });
    const { TimelapseRecorder } = loadTimelapse({ window, fetch, showDirectoryPicker: window.showDirectoryPicker });
    const recorder = new TimelapseRecorder({});
    await recorder.start();
    assert.deepEqual(created, ['timelapse', true]);
    assert.equal(recorder.nextIndex, 8);
    assert.equal(recorder.commit, 'abcdef1234567');
    assert.equal(recorder.active, true);

    // Picking the timelapse folder itself does not nest a second one.
    window.showDirectoryPicker = async () => timelapseDir;
    recorder.active = false;
    await recorder.start();
    assert.equal(recorder.directory, timelapseDir);

    const offline = loadTimelapse({
        window, showDirectoryPicker: window.showDirectoryPicker,
        fetch: async () => ({ ok: false, status: 404 }), console: { warn() {} }
    });
    const local = new offline.TimelapseRecorder({});
    await local.start();
    assert.equal(local.commit, 'unknown');
});

test('default view is rendered off screen in elevation mode, then the mode is restored', () => {
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
            assert.equal(renderer.displayMode, 'elevation');
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
    assert.deepEqual(modes, ['elevation', 'flux']);
    assert.equal(renderer.displayMode, 'flux');
    assert.deepEqual([renderer.camera.position.x, renderer.camera.position.y], [3, 4], 'visitor camera untouched');
    assert.deepEqual(Array.from(pixels), [0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255]);

    modes.length = 0;
    renderer.displayMode = 'elevation';
    renderer.captureDefaultView({}, {}, 2, 2);
    assert.deepEqual(modes, [], 'no recolouring when the default mode is already shown');
});
