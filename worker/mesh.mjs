export const MESH_RADIUS = 25;
export const MESH_HALF_SIZE = 30;
export const MESH_RINGS = 125;
export const MESH_SPACING = 0.2;
export const MESH_SINK_RADIUS = 0.8;
export const MESH_SLOPE = 0.09;
export const MESH_SURROUND_SLOPE = 0.3;
export const MESH_PERIPHERAL_SLOPE = 0.06;
export const MESH_PERIPHERAL_WIDTH = 4;
export const MESH_INITIAL_SAND_DEPTH = 0.3;
export const MESH_CHANNEL_FLARE = 0.12;
// Vertex jitter radius as a fraction of MESH_SPACING; it breaks the alignments
// of the polar rings along the cardinal axes without changing the topology.
export const MESH_JITTER = 0.1;
export const MESH_JITTER_SEED = 2026;
export const LEGACY_MESH_SIGNATURE = JSON.stringify([
    'disk-square-polar-v2', MESH_RADIUS, MESH_HALF_SIZE, MESH_RINGS, MESH_SPACING
]);
export const CHANNEL_SAND_FREE_PROFILE = 'channel-sand-free-v1';
export const MAX_REQUESTS_PER_SYNC = 2;
export const MESH_SIGNATURE = JSON.stringify([
    'disk-square-polar-v2', MESH_RADIUS, MESH_HALF_SIZE, MESH_RINGS, MESH_SPACING,
    CHANNEL_SAND_FREE_PROFILE, 'jitter-v1', MESH_JITTER, MESH_JITTER_SEED
]);

/**
 * Integer avalanche hash (lowbias32) used as a counter-based random source.
 *
 * Only 32-bit integer operations are used, so the browser and the Worker
 * obtain bit-identical values on every JavaScript engine.
 *
 * Args:
 *   x: integer key (any 32-bit value).
 *
 * Returns:
 *   An unsigned 32-bit integer.
 */
export function hashUint32(x) {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

/**
 * Deterministic isotropic displacement of one mesh vertex.
 *
 * The offset is uniform in a disk, drawn by rejection from a square: unlike a
 * square jitter it has no preferred cardinal direction, and unlike polar
 * sampling it needs no trigonometry, whose last bit may differ between engines.
 *
 * Args:
 *   index: vertex index; the same index always yields the same offset.
 *   amplitude: disk radius (m).
 *   seed: integer seed of the jitter field.
 *
 * Returns:
 *   The offset `{ dx, dz }` (m).
 */
export function meshJitter(index, amplitude = MESH_JITTER * MESH_SPACING, seed = MESH_JITTER_SEED) {
    let state = hashUint32(Math.imul(index, 0x9e3779b9) ^ seed);
    for (let attempt = 0; amplitude > 0 && attempt < 64; attempt++) {
        state = hashUint32(state);
        const u = 2 * state / 4294967296 - 1;
        state = hashUint32(state);
        const v = 2 * state / 4294967296 - 1;
        if (u * u + v * v <= 1) return { dx: amplitude * u, dz: amplitude * v };
    }
    return { dx: 0, dz: 0 };
}

export function channelSandFactor(x, z) {
    if (z <= 0) return 1;
    const channelWidth = MESH_SINK_RADIUS + MESH_CHANNEL_FLARE * z;
    const t = Math.abs(x) / channelWidth;
    if (t <= 1) return 0;
    if (t >= 1.25) return 1;
    const blend = (t - 1) / 0.25;
    return blend * blend * (3 - 2 * blend);
}

/**
 * Build the vertex positions and the initial bed of the shared terrain.
 *
 * Args:
 *   peripheralSlope: extra bed slope near the disk edge (m/m).
 *   channelSandFree: leave the output channel without initial sand.
 *   jitter: vertex displacement radius as a fraction of MESH_SPACING
 *     (dimensionless); 0 rebuilds the regular mesh of older saves.
 *
 * Returns:
 *   Vertices (m), elevation and bedrock (m), the erodible vertex count and
 *   the initial sand-depth factor of each vertex.
 */
export function createInitialMesh(
    peripheralSlope = MESH_PERIPHERAL_SLOPE,
    channelSandFree = true,
    jitter = MESH_JITTER
) {
    const vertices = [{ x: 0, z: 0 }];
    let outer = [];

    for (let r = 1; r <= MESH_RINGS; r++) {
        const radius = MESH_RADIUS * r / MESH_RINGS;
        const sectors = r === MESH_RINGS
            ? 8 * Math.round(2 * Math.PI * radius / MESH_SPACING / 8)
            : Math.max(6, Math.round(2 * Math.PI * radius / MESH_SPACING));
        const offset = r === MESH_RINGS ? 0 : (r % 2 ? 0.5 : -0.5) * 2 * Math.PI / sectors;
        outer = [];
        for (let s = 0; s < sectors; s++) {
            const angle = 2 * Math.PI * s / sectors + offset;
            outer.push(vertices.length);
            vertices.push({ x: radius * Math.cos(angle), z: -radius * Math.sin(angle) });
        }
    }

    const erodibleCount = outer[0];
    // The outer ring stays on the circle so that the disk edge and the square
    // surround (projected from it) keep their exact shape.
    for (let i = 0; i < erodibleCount; i++) {
        const { dx, dz } = meshJitter(i, jitter * MESH_SPACING);
        vertices[i].x += dx;
        vertices[i].z += dz;
    }
    const square = [];
    for (const index of outer) {
        const point = vertices[index];
        const factor = MESH_HALF_SIZE / Math.max(Math.abs(point.x), Math.abs(point.z));
        square.push(vertices.length);
        vertices.push({ x: point.x * factor, z: point.z * factor });
    }

    const bedrock = new Float64Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) {
        const { x, z } = vertices[i];
        const radius = Math.hypot(x, z);
        const cone = MESH_SLOPE * Math.min(MESH_RADIUS, radius) +
            MESH_SURROUND_SLOPE * Math.max(0, radius - MESH_RADIUS) +
            peripheralSlope * Math.max(0, Math.min(MESH_PERIPHERAL_WIDTH,
                radius - MESH_RADIUS + MESH_PERIPHERAL_WIDTH));
        if (z <= 0) {
            bedrock[i] = cone;
            continue;
        }
        const width = MESH_SINK_RADIUS + MESH_CHANNEL_FLARE * z;
        const t = Math.max(0, Math.min(1, Math.abs(x) / width));
        const blend = t * t * (3 - 2 * t);
        bedrock[i] = -MESH_SLOPE * z * (1 - blend) + cone * blend;
    }

    const sandDepthFactor = Float64Array.from(bedrock, (_, i) => {
        const { x, z } = vertices[i];
        return channelSandFree ? channelSandFactor(x, z) : 1;
    });
    const elevation = Float64Array.from(
        bedrock, (height, i) => height + MESH_INITIAL_SAND_DEPTH * sandDepthFactor[i]
    );
    return { vertices, elevation, bedrock, erodibleCount, sandDepthFactor };
}

export function getSyncIntervalMs(activeCollaborators, budgetPerDay = 80_000) {
    const active = Math.max(1, Math.floor(activeCollaborators));
    return Math.max(
        300_000,
        Math.ceil(active * MAX_REQUESTS_PER_SYNC * 86_400_000 / budgetPerDay)
    );
}
