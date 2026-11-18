/**
 * Admin timelapse: one PNG of the default view per wall-clock second, saved as
 * 000001.png, 000002.png, ... in a `timelapse` folder on the recording computer.
 *
 * The Worker's quotas cannot absorb a PNG per second, and Safari blocks requests
 * from the HTTPS page to http://localhost (mixed content). The page is therefore
 * served by tools/timelapse_server.py at http://localhost:8765/?admin, and posts
 * each frame to that same origin; the server numbers and writes the files. Each
 * PNG carries tEXt chunks with its creation time (ISO 8601, UTC) and the commit
 * of the served code (from the server's `version.json`).
 */

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
 * Records the default view once per interval while the animation loop runs, and
 * posts each frame to the local timelapse server.
 */
class TimelapseRecorder {
    /**
     * Args:
     *   renderer: TerrainRenderer providing captureDefaultView().
     *   options.width: Frame width (px).
     *   options.height: Frame height (px).
     *   options.intervalMs: Wall-clock interval between frames (ms).
     *   options.serverUrl: Timelapse endpoints of tools/timelapse_server.py.
     *   options.versionUrl: JSON `{"commit": "<sha>[-dirty]"}` from the same server.
     */
    constructor(renderer, {
        width = 1920, height = 1080, intervalMs = 1000,
        serverUrl = 'api/timelapse/', versionUrl = 'version.json'
    } = {}) {
        this.renderer = renderer;
        this.width = width;
        this.height = height;
        this.intervalMs = intervalMs;
        this.serverUrl = serverUrl;
        this.versionUrl = versionUrl;
        this.active = false;
        this.busy = false;
        this.folder = null;
        this.nextCaptureTime = -Infinity;
        this.framesWritten = 0;
        this.lastFile = null;
        this.commit = 'unknown';
        this.canvas = null;
        this.onChange = null;
        this.onError = null;
    }

    /**
     * Whether the page is served from this computer, as by the timelapse server.
     *
     * Args:
     *   location: window.location or a URL.
     */
    static isLocal(location) {
        return ['localhost', '127.0.0.1'].includes(location.hostname);
    }

    /**
     * Check that the timelapse server answers, then record from the next animation
     * frame on.
     */
    async start() {
        if (this.active) return;
        let status;
        try {
            const response = await fetch(`${this.serverUrl}status`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            status = await response.json();
        } catch (error) {
            throw new Error('No timelapse server: run python3 tools/timelapse_server.py, ' +
                'then open http://localhost:8765/?admin');
        }
        this.folder = status.folder;
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
            if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}(-dirty)?$/.test(commit)) {
                throw new Error('no commit hash');
            }
            return commit;
        } catch (error) {
            // Outside a git checkout the frames are still useful, just unstamped.
            console.warn(`Timelapse: commit unknown (${this.versionUrl}: ${error.message})`);
            return 'unknown';
        }
    }

    /**
     * Called once per animation frame; captures when the interval has elapsed.
     *
     * Frames are not queued: while the previous one is still being sent, the
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
        const createdAt = new Date();
        let pixels;
        try {
            pixels = this.renderer.captureDefaultView(grid, biology, this.width, this.height);
        } catch (error) {
            this.fail(error);
            return;
        }
        this.busy = true;
        this.writeFrame(pixels, createdAt).then(name => {
            this.framesWritten++;
            this.lastFile = name;
            this.onChange?.();
        }, error => this.fail(error)).finally(() => {
            this.busy = false;
        });
    }

    /**
     * Encode a frame and post it; the server picks the next number, so that
     * several tabs or restarts never overwrite each other.
     *
     * Returns:
     *   The saved file name, e.g. `000342.png`.
     */
    async writeFrame(pixels, createdAt) {
        const blob = await this.encodePng(pixels, [
            ['Creation Time', createdAt.toISOString()],
            ['Commit', this.commit],
            ['Software', 'Tree of Life, https://github.com/laurentperrinet/2026-11_tree-of-life']
        ]);
        const response = await fetch(`${this.serverUrl}frame`, {
            method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `frame upload failed (HTTP ${response.status})`);
        return result.name;
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
