#!/usr/bin/env node
/**
 * Generate the Poisson-disk point set of the whole square domain (`js/mesh-points.js`).
 *
 * The browser (`js/terrain.js`) and the Worker (`worker/mesh.mjs`) both load the
 * generated file, so they share bit-identical vertices without recomputing them.
 *
 * The domain is the square [-HALF_SIZE, HALF_SIZE]^2, sampled in Cartesian
 * coordinates only: no circle, ring or radial line enters the construction.
 * Its four sides carry evenly spaced points (BORDER_SPACING, corners included),
 * which seed Bridson's algorithm; the interior is then filled with points at
 * least MIN_DISTANCE apart, drawn around active points by rejection in the
 * x-z square. The sample is close to maximal: a blue-noise point set with no
 * preferred direction and no long-range order. The erodible disk is not meshed
 * separately: its vertices are simply the points closer than RADIUS to the
 * centre. Coordinates are stored as integer micrometres, so that every
 * JavaScript engine decodes the same doubles.
 *
 * Vertex order: disk points (erodible), other interior points, then the border
 * (the points of each side in sequence, then the four corners). The browser
 * inserts the border first in this order, so that no point ever falls on an
 * existing edge of the collinear border (see `delaunayTriangles()`).
 *
 * Usage: node tools/generate-mesh-points.mjs
 */
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Half-side of the square domain (m); must equal `halfSize` / MESH_HALF_SIZE.
const HALF_SIZE = 30;
// Radius of the erodible disk (m); must equal `radius` / MESH_RADIUS. It only
// sorts the points: disk points come first and are the erodible vertices.
const RADIUS = 25;
// Spacing of the points along the square sides (m). With MIN_DISTANCE, every
// side segment is a Gabriel edge (no point within 0.1 m of its midpoint), hence
// an edge of the Delaunay triangulation, so the mesh covers the square exactly.
const BORDER_SPACING = 0.2;
// Minimum distance between two points (m); about one point per 0.04 m².
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
 * Evenly spaced points on the sides of the square, then its corners.
 *
 * Args:
 *   halfSize: half-side of the square (m).
 *   spacing: target spacing along a side (m).
 *
 * Returns:
 *   `{ xs, zs }` (m): each side's inner points in sequence, then the corners.
 */
function borderPoints(halfSize, spacing) {
    const segments = Math.round(2 * halfSize / spacing);
    const step = 2 * halfSize / segments;
    const xs = [], zs = [];
    // Each side runs from one corner towards the next, anticlockwise in (x, z).
    const sides = [
        k => [-halfSize + k * step, -halfSize],
        k => [halfSize, -halfSize + k * step],
        k => [halfSize - k * step, halfSize],
        k => [-halfSize, halfSize - k * step]
    ];
    for (const side of sides) {
        for (let k = 1; k < segments; k++) {
            const [x, z] = side(k);
            xs.push(x);
            zs.push(z);
        }
    }
    for (const [x, z] of [[-halfSize, -halfSize], [halfSize, -halfSize], [halfSize, halfSize], [-halfSize, halfSize]]) {
        xs.push(x);
        zs.push(z);
    }
    return { xs, zs };
}

/**
 * Bridson's Poisson-disk sampling of the open square, seeded by fixed points.
 *
 * Args:
 *   halfSize: half-side of the square (m).
 *   seeds: `{ xs, zs }`, fixed points (m), also used as the first active points.
 *   minDistance: minimum distance between two points (m).
 *   candidates: candidates tried around an active point before retiring it.
 *   seed: integer seed of the random sequence.
 *
 * Returns:
 *   `{ xs, zs }`, the new points (m), in generation order.
 */
function poissonDisk(halfSize, seeds, minDistance, candidates, seed) {
    let state = hashUint32(seed);
    const random = () => {
        state = hashUint32((state + 0x9e3779b9) | 0);
        return state / 4294967296;
    };
    // A cell of side minDistance / sqrt(2) holds at most one point.
    const cell = minDistance / Math.SQRT2;
    const size = Math.ceil(2 * halfSize / cell) + 1;
    const grid = new Int32Array(size * size).fill(-1);
    const xs = [], zs = [];
    const cellOf = value => Math.min(size - 1, Math.floor((value + halfSize) / cell));
    const add = (x, z) => {
        grid[cellOf(z) * size + cellOf(x)] = xs.length;
        xs.push(x);
        zs.push(z);
        return xs.length - 1;
    };
    const fits = (x, z) => {
        if (Math.abs(x) >= halfSize || Math.abs(z) >= halfSize) return false;
        const cx = cellOf(x), cz = cellOf(z);
        for (let j = Math.max(0, cz - 2); j <= Math.min(size - 1, cz + 2); j++) {
            for (let i = Math.max(0, cx - 2); i <= Math.min(size - 1, cx + 2); i++) {
                const q = grid[j * size + i];
                if (q >= 0 && (xs[q] - x) ** 2 + (zs[q] - z) ** 2 < minDistance * minDistance) return false;
            }
        }
        return true;
    };
    const active = seeds.xs.map((x, i) => add(x, seeds.zs[i]));
    while (active.length > 0) {
        const slot = Math.floor(random() * active.length);
        const p = active[slot];
        let placed = false;
        for (let attempt = 0; attempt < candidates; attempt++) {
            // Uniform in the annulus [d, 2d] by rejection from the x-z square.
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
    return { xs: xs.slice(seeds.xs.length), zs: zs.slice(seeds.zs.length) };
}

/**
 * Write the data module that defines `globalThis.MESH_POINTS`.
 *
 * Args:
 *   path: output file path.
 *   params: generation parameters and group boundaries, copied into the module.
 *   points: `[x, z]` integer coordinates (µm), in vertex order.
 */
function writeModule(path, params, points) {
    const bytes = Buffer.alloc(8 * points.length);
    points.forEach(([x, z], i) => {
        bytes.writeInt32LE(x, 8 * i);
        bytes.writeInt32LE(z, 8 * i + 4);
    });
    const date = new Date().toISOString().slice(0, 10);
    const source = `// Generated on ${date} by \`node tools/generate-mesh-points.mjs\`; do not edit.
// Poisson-disk sample of the square [-${params.halfSize}, ${params.halfSize}]² m in Cartesian coordinates
// (${points.length} points): sides sampled every ${params.borderSpacing} m, minimum distance
// ${params.minDistance} m, ${params.candidates} candidates, seed ${params.seed}. Order: ${params.erodibleCount} points
// inside the ${params.radius} m disk (erodible), other interior points, then the border from index
// ${params.borderStart} (sides, then corners). Coordinates are little-endian Int32 pairs (x, z) in
// micrometres, base64-encoded. A plain script (no export), so that it runs as a browser
// <script>, a side-effect import in the Worker, and in vm contexts.
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

const border = borderPoints(HALF_SIZE, BORDER_SPACING);
const interior = poissonDisk(HALF_SIZE, border, MIN_DISTANCE, CANDIDATES, SEED);
// Quantise before sorting, so that the disk test uses the coordinates that the
// browser and the Worker will decode.
const quantise = value => Math.round(value * UNITS_PER_METRE);
const inner = interior.xs.map((x, i) => [quantise(x), quantise(interior.zs[i])]);
const inDisk = ([x, z]) => {
    const xm = x / UNITS_PER_METRE, zm = z / UNITS_PER_METRE;
    return xm * xm + zm * zm < RADIUS * RADIUS;
};
const disk = inner.filter(inDisk);
const surround = inner.filter(point => !inDisk(point));
const edge = border.xs.map((x, i) => [quantise(x), quantise(border.zs[i])]);
const params = {
    halfSize: HALF_SIZE, radius: RADIUS, borderSpacing: BORDER_SPACING,
    minDistance: MIN_DISTANCE, candidates: CANDIDATES, seed: SEED,
    unitsPerMetre: UNITS_PER_METRE,
    erodibleCount: disk.length, borderStart: disk.length + surround.length
};
const output = fileURLToPath(new URL('../js/mesh-points.js', import.meta.url));
writeModule(output, params, [...disk, ...surround, ...edge]);
console.log(`${disk.length} disk, ${surround.length} surround and ${edge.length} border points written to ${output}`);
