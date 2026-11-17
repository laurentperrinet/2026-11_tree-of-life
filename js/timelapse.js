/**
 * Admin timelapse: one PNG of the default view per wall-clock second, numbered
 * 000001.png, 000002.png, ... in a local `timelapse` folder.
 *
 * The page is static (GitHub Pages) and the Worker's quotas cannot absorb a PNG per
 * second, so frames stay on the recording computer. They are written through the
 * File System Access API (Chrome, Edge): the folder is chosen once, then every
 * frame is written without a dialogue. Each PNG carries tEXt chunks with its
 * creation time (ISO 8601, UTC) and the deployed commit (from `version.json`,
 * written by the deployment workflow).
 */

const TIMELAPSE_FOLDER = 'timelapse';
const TIMELAPSE_NAME_PATTERN = /^(\d{6})\.png$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// CRC-32 of ISO 3309, which PNG uses for each chunk (over its type and data).
const PNG_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/**
 * CRC-32 of a byte sequence, as stored at the end of a PNG chunk.
 *
 * Args:
 *   bytes: Uint8Array to checksum.
 */
function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = PNG_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a PNG tEXt chunk (length, type, keyword NUL text, CRC).
 *
 * tEXt holds Latin-1; restricting both fields to printable ASCII keeps the bytes
 * identical in every reader (exiftool, Pillow, macOS Preview).
 *
 * Args:
 *   keyword: Chunk keyword, 1 to 79 printable ASCII characters.
 *   text: Value, printable ASCII.
 */
function pngTextChunk(keyword, text) {
    if (!/^[\x20-\x7e]{1,79}$/.test(keyword) || /^ | $|  /.test(keyword)) {
        throw new Error(`Invalid PNG text keyword: ${keyword}`);
    }
    if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`PNG text for ${keyword} is not printable ASCII`);
    const length = keyword.length + 1 + text.length;
    const chunk = new Uint8Array(12 + length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, length);
    const body = `tEXt${keyword}\0${text}`;
    for (let i = 0; i < body.length; i++) chunk[4 + i] = body.charCodeAt(i);
    view.setUint32(8 + length, crc32(chunk.subarray(4, 8 + length)));
    return chunk;
}

/**
 * Return a copy of a PNG with tEXt chunks inserted right after IHDR, so that
 * readers which stop before the image data still find them.
 *
 * Args:
 *   png: Uint8Array of a complete PNG file.
 *   entries: Array of [keyword, text] pairs.
 */
function addPngText(png, entries) {
    if (PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) throw new Error('Not a PNG file');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') throw new Error('PNG does not start with IHDR');
    const ihdrEnd = 8 + 12 + view.getUint32(8);
    const chunks = entries.map(([keyword, text]) => pngTextChunk(keyword, text));
    const out = new Uint8Array(png.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    out.set(png.subarray(0, ihdrEnd), 0);
    let offset = ihdrEnd;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    out.set(png.subarray(ihdrEnd), offset);
    return out;
}

/**
 * Six-digit frame file name: 342 gives `000342.png`.
 *
 * Args:
 *   index: Frame number, from 1.
 */
function timelapseFileName(index) {
    if (!Number.isInteger(index) || index < 1 || index > 999999) {
        throw new Error(`Timelapse frame number out of range: ${index}`);
    }
    return `${String(index).padStart(6, '0')}.png`;
}

/**
 * Frame number following the highest one already in the folder, so that a new
 * recording appends to the sequence instead of overwriting it.
 *
 * Args:
 *   names: File names present in the folder.
 */
function nextTimelapseIndex(names) {
    let max = 0;
    for (const name of names) {
        const match = TIMELAPSE_NAME_PATTERN.exec(name);
        if (match) max = Math.max(max, Number(match[1]));
    }
    return max + 1;
}

/**
 * Records the default view once per interval while the animation loop runs.
 */
class TimelapseRecorder {
    /**
     * Args:
     *   renderer: TerrainRenderer providing captureDefaultView().
     *   options.width: Frame width (px).
     *   options.height: Frame height (px).
     *   options.intervalMs: Wall-clock interval between frames (ms).
     *   options.versionUrl: JSON file `{"commit": "<sha>"}` written at deployment.
     */
    constructor(renderer, { width = 1920, height = 1080, intervalMs = 1000, versionUrl = 'version.json' } = {}) {
        this.renderer = renderer;
        this.width = width;
        this.height = height;
        this.intervalMs = intervalMs;
        this.versionUrl = versionUrl;
        this.active = false;
        this.busy = false;
        this.directory = null;
        this.nextIndex = 1;
        this.nextCaptureTime = -Infinity;
        this.framesWritten = 0;
        this.lastFile = null;
        this.commit = 'unknown';
        this.canvas = null;
        this.onChange = null;
        this.onError = null;
    }

    static isSupported(scope = globalThis) {
        return typeof scope.showDirectoryPicker === 'function';
    }

    /**
     * Ask for the folder, then record from the next animation frame on. Must be
     * called from a user gesture (the directory picker requires one).
     */
    async start() {
        if (this.active) return;
        if (!TimelapseRecorder.isSupported()) {
            throw new Error('Timelapse needs Chrome or Edge (File System Access API)');
        }
        const parent = await window.showDirectoryPicker({
            id: 'tree-of-life-timelapse', mode: 'readwrite', startIn: 'pictures'
        });
        // Choosing the timelapse folder itself must not nest timelapse/timelapse.
        this.directory = parent.name === TIMELAPSE_FOLDER
            ? parent : await parent.getDirectoryHandle(TIMELAPSE_FOLDER, { create: true });
        const names = [];
        for await (const name of this.directory.keys()) names.push(name);
        this.nextIndex = nextTimelapseIndex(names);
        this.commit = await this.fetchCommit();
        this.framesWritten = 0;
        this.lastFile = null;
        this.nextCaptureTime = -Infinity;
        this.active = true;
        this.onChange?.();
    }

    stop() {
        this.active = false;
        this.onChange?.();
    }

    async fetchCommit() {
        try {
            const response = await fetch(this.versionUrl, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const { commit } = await response.json();
            if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(commit)) {
                throw new Error('no commit hash');
            }
            return commit;
        } catch (error) {
            // Served locally there is no version.json: frames are still useful.
            console.warn(`Timelapse: deployed commit unknown (${this.versionUrl}: ${error.message})`);
            return 'unknown';
        }
    }

    /**
     * Called once per animation frame; captures when the interval has elapsed.
     *
     * Frames are not queued: while the previous one is still being written, the
     * capture waits, so a slow disk delays a frame (the 1 s grid is kept) instead of
     * accumulating images in memory.
     *
     * Args:
     *   now: performance.now() of the frame (ms).
     *   grid: TerrainGrid, used to recolour the meshes for the default view.
     *   biology: BiologyGrid, idem.
     */
    update(now, grid, biology) {
        if (!this.active || this.busy || now < this.nextCaptureTime) return;
        // Keep a regular 1 s grid, but restart it after a stall (hidden tab) rather
        // than firing a burst of catch-up frames.
        this.nextCaptureTime = now - this.nextCaptureTime > this.intervalMs
            ? now + this.intervalMs : this.nextCaptureTime + this.intervalMs;
        const index = this.nextIndex;
        const createdAt = new Date();
        let pixels;
        try {
            pixels = this.renderer.captureDefaultView(grid, biology, this.width, this.height);
        } catch (error) {
            this.fail(error);
            return;
        }
        this.nextIndex++;
        this.busy = true;
        this.writeFrame(index, pixels, createdAt).then(name => {
            this.framesWritten++;
            this.lastFile = name;
            this.onChange?.();
        }, error => this.fail(error)).finally(() => {
            this.busy = false;
        });
    }

    async writeFrame(index, pixels, createdAt) {
        const name = timelapseFileName(index);
        const blob = await this.encodePng(pixels, [
            ['Creation Time', createdAt.toISOString()],
            ['Commit', this.commit],
            ['Software', 'Tree of Life, https://github.com/laurentperrinet/2026-11_tree-of-life']
        ]);
        const file = await this.directory.getFileHandle(name, { create: true });
        // createWritable() writes to a swap file and renames it on close(): a frame
        // interrupted by a crash never appears half-written under its final name.
        const writable = await file.createWritable();
        try {
            await writable.write(blob);
            await writable.close();
        } catch (error) {
            await writable.abort().catch(() => {});
            throw error;
        }
        return name;
    }

    async encodePng(pixels, metadata) {
        if (!this.canvas) this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.getContext('2d').putImageData(new ImageData(pixels, this.width, this.height), 0, 0);
        const blob = await new Promise((resolve, reject) => this.canvas.toBlob(
            result => (result ? resolve(result) : reject(new Error('PNG encoding failed'))), 'image/png'));
        const png = addPngText(new Uint8Array(await blob.arrayBuffer()), metadata);
        return new Blob([png], { type: 'image/png' });
    }

    fail(error) {
        console.error('Timelapse stopped:', error);
        this.active = false;
        this.onError?.(error);
        this.onChange?.();
    }
}
