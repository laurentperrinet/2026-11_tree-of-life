#!/usr/bin/env node
/**
 * Generate the Poisson-disk point set of the erodible disk (`js/mesh-points.js`).
 *
 * The browser (`js/terrain.js`) and the Worker (`worker/mesh.mjs`) both load the
 * generated file, so they share bit-identical vertices without recomputing them.
 * The sample is drawn by Bridson's algorithm: every point lies at least
 * MIN_DISTANCE from every other one and the sample is close to maximal, which
 * gives a blue-noise point set with no preferred direction and no long-range
 * order (unlike polar rings or a Vogel spiral, whose lattice defects line up on
 * circles). Coordinates are stored as integer micrometres, so that every
 * JavaScript engine decodes the same doubles.
 *
 * Usage: node tools/generate-mesh-points.mjs
 */
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Radius of the erodible disk (m); must equal `radius` / MESH_RADIUS.
const RADIUS = 25;
// Distance kept free inside the disk edge (m). The 784-vertex boundary polygon
// has 0.2 m chords: keeping points beyond their diametral circles (0.1 m) makes
// every chord a Gabriel edge, hence an edge of the Delaunay triangulation.
const EDGE_MARGIN = 0.15;
// Minimum distance between two points (m); it gives about one point per 0.04 m²,
// the area per vertex of the previous meshes.
const MIN_DISTANCE = 0.16;
// Candidates tried around an active point before it is retired.
const CANDIDATES = 30;
// Seed of the random sequence.
const SEED = 2026;
// Stored coordinates are integers in units of 1 / UNITS_PER_METRE m (1 µm).
const UNITS_PER_METRE = 1_000_000;

/**
 * Integer avalanche hash (lowbias32) used as a counter-based random source.
 *
 * Args:
 *   x: integer key (any 32-bit value).
 *
 * Returns:
 *   An unsigned 32-bit integer.
 */
function hashUint32(x) {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

/**
 * Bridson's Poisson-disk sampling of a disk centred on the origin.
 *
 * Args:
 *   maxRadius: largest distance of a point from the centre (m).
 *   minDistance: minimum distance between two points (m).
 *   candidates: candidates tried around an active point before retiring it.
 *   seed: integer seed of the random sequence.
 *
 * Returns:
 *   `{ xs, zs }`, the point coordinates (m), the centre first.
 */
function poissonDisk(maxRadius, minDistance, candidates, seed) {
    let state = hashUint32(seed);
    const random = () => {
        state = hashUint32((state + 0x9e3779b9) | 0);
        return state / 4294967296;
    };
    // A cell of side minDistance / sqrt(2) holds at most one point.
    const cell = minDistance / Math.SQRT2;
    const size = Math.ceil(2 * maxRadius / cell) + 1;
    const grid = new Int32Array(size * size).fill(-1);
    const xs = [];
    const zs = [];
    const cellOf = value => Math.floor((value + maxRadius) / cell);
    const add = (x, z) => {
        grid[cellOf(z) * size + cellOf(x)] = xs.length;
        xs.push(x);
        zs.push(z);
        return xs.length - 1;
    };
    const fits = (x, z) => {
        if (x * x + z * z > maxRadius * maxRadius) return false;
        const cx = cellOf(x), cz = cellOf(z);
        for (let j = Math.max(0, cz - 2); j <= Math.min(size - 1, cz + 2); j++) {
            for (let i = Math.max(0, cx - 2); i <= Math.min(size - 1, cx + 2); i++) {
                const q = grid[j * size + i];
                if (q >= 0 && (xs[q] - x) ** 2 + (zs[q] - z) ** 2 < minDistance * minDistance) return false;
            }
        }
        return true;
    };
    const active = [add(0, 0)];
    while (active.length > 0) {
        const slot = Math.floor(random() * active.length);
        const p = active[slot];
        let placed = false;
        for (let attempt = 0; attempt < candidates; attempt++) {
            // Uniform in the annulus [d, 2d] by rejection from a square: no
            // trigonometry, so the sequence does not depend on the engine.
            let u, v;
            do {
                u = 2 * random() - 1;
                v = 2 * random() - 1;
            } while (u * u + v * v > 1 || u * u + v * v < 0.25);
            const x = xs[p] + 2 * minDistance * u;
            const z = zs[p] + 2 * minDistance * v;
            if (fits(x, z)) {
                active.push(add(x, z));
                placed = true;
                break;
            }
        }
        if (!placed) {
            active[slot] = active[active.length - 1];
            active.pop();
        }
    }
    return { xs, zs };
}

/**
 * Write the data module that defines `globalThis.MESH_POINTS`.
 *
 * Args:
 *   path: output file path.
 *   params: generation parameters, copied into the module.
 *   xs: x coordinates (m).
 *   zs: z coordinates (m).
 */
function writeModule(path, params, xs, zs) {
    const bytes = Buffer.alloc(8 * xs.length);
    for (let i = 0; i < xs.length; i++) {
        bytes.writeInt32LE(Math.round(xs[i] * params.unitsPerMetre), 8 * i);
        bytes.writeInt32LE(Math.round(zs[i] * params.unitsPerMetre), 8 * i + 4);
    }
    const date = new Date().toISOString().slice(0, 10);
    const source = `// Generated on ${date} by \`node tools/generate-mesh-points.mjs\`; do not edit.
// Poisson-disk sample of the erodible disk (${xs.length} points): radius ${params.radius} m,
// edge margin ${params.edgeMargin} m, minimum distance ${params.minDistance} m,
// ${params.candidates} candidates, seed ${params.seed}. Coordinates are little-endian Int32
// pairs (x, z) in micrometres, base64-encoded. A plain script (no export), so that it
// runs as a browser <script>, a side-effect import in the Worker, and in vm contexts.
(function (root) {
    const params = ${JSON.stringify(params)};
    const data = '${bytes.toString('base64')}';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(128);
    for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    const bytes = new Uint8Array(data.length / 4 * 3 - padding);
    for (let i = 0, j = 0; i < data.length; i += 4) {
        const word = (lookup[data.charCodeAt(i)] << 18) | (lookup[data.charCodeAt(i + 1)] << 12) |
            (lookup[data.charCodeAt(i + 2)] << 6) | lookup[data.charCodeAt(i + 3)];
        if (j < bytes.length) bytes[j++] = (word >>> 16) & 255;
        if (j < bytes.length) bytes[j++] = (word >>> 8) & 255;
        if (j < bytes.length) bytes[j++] = word & 255;
    }
    // FNV-1a of the stored bytes: part of the mesh signature, so that a
    // regenerated point set never matches saves made on another one.
    let checksum = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) checksum = Math.imul(checksum ^ bytes[i], 0x01000193) >>> 0;
    const view = new DataView(bytes.buffer);
    const count = bytes.length / 8;
    const x = new Float64Array(count);
    const z = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        // Integer / integer is correctly rounded: identical on every engine.
        x[i] = view.getInt32(8 * i, true) / params.unitsPerMetre;
        z[i] = view.getInt32(8 * i + 4, true) / params.unitsPerMetre;
    }
    root.MESH_POINTS = Object.freeze({
        params: Object.freeze(params), count, x, z,
        checksum: checksum.toString(16).padStart(8, '0')
    });
})(globalThis);
`;
    // Atomic write: a reader never sees a partial file.
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, source);
    renameSync(temporary, path);
}

const params = {
    radius: RADIUS, edgeMargin: EDGE_MARGIN, minDistance: MIN_DISTANCE,
    candidates: CANDIDATES, seed: SEED, unitsPerMetre: UNITS_PER_METRE
};
const { xs, zs } = poissonDisk(RADIUS - EDGE_MARGIN, MIN_DISTANCE, CANDIDATES, SEED);
const output = fileURLToPath(new URL('../js/mesh-points.js', import.meta.url));
writeModule(output, params, xs, zs);
console.log(`${xs.length} points written to ${output}`);
