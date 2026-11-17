export const MESH_RADIUS = 25;
export const MESH_HALF_SIZE = 30;
export const MESH_SPACING = 0.2;
// Gap between the last spiral point and the disk edge, as a fraction of
// MESH_SPACING. It keeps every edge of the boundary polygon a Gabriel edge
// (hence present in the Delaunay triangulation) and gives the best minimum
// triangle angle (29 degrees) among the margins tested.
export const MESH_SPIRAL_MARGIN = 0.75;
export const MESH_SINK_RADIUS = 0.8;
// Radial slope of the funnel cone that drains the bed towards the channel.
export const MESH_SLOPE = 0.11;
// Descent of the outlet channel axis towards the sink, independent of the cone.
export const MESH_CHANNEL_SLOPE = 0.09;
export const MESH_SURROUND_SLOPE = 0.3;
export const MESH_PERIPHERAL_SLOPE = 0.06;
export const MESH_PERIPHERAL_WIDTH = 4;
export const MESH_INITIAL_SAND_DEPTH = 0.3;
export const MESH_CHANNEL_FLARE = 0.12;
// Vertex jitter radius as a fraction of MESH_SPACING; it blurs the spiral
// parastichies so that no direction is singled out locally.
export const MESH_JITTER = 0.1;
export const MESH_JITTER_SEED = 2026;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const LEGACY_MESH_SIGNATURE = JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
export const CHANNEL_SAND_FREE_PROFILE = 'channel-sand-free-v1';
export const MAX_REQUESTS_PER_SYNC = 2;
export const MESH_SIGNATURE = JSON.stringify([
    'disk-square-vogel-v1', MESH_RADIUS, MESH_HALF_SIZE, MESH_SPACING, MESH_SPIRAL_MARGIN,
    CHANNEL_SAND_FREE_PROFILE, 'jitter-v1', MESH_JITTER, MESH_JITTER_SEED,
    'slopes-v1', MESH_SLOPE, MESH_CHANNEL_SLOPE
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
 * Deterministic isotropic displacement of one spiral vertex.
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
 * Unjittered position of point n of the Vogel (sunflower) spiral.
 *
 * Point n lies at radius c sqrt(n) and angle n times the golden angle, with
 * c = MESH_SPACING / sqrt(pi) so that each point owns an area MESH_SPACING^2.
 * The golden angle is the most irrational rotation, so no two points share a
 * direction and the packing has no preferred axis.
 *
 * Args:
 *   n: spiral index (vertex index of the disk interior).
 *
 * Returns:
 *   The position `{ x, z }` (m).
 */
export function spiralPoint(n) {
    const radius = MESH_SPACING / Math.sqrt(Math.PI) * Math.sqrt(n);
    const angle = (n * GOLDEN_ANGLE) % (2 * Math.PI);
    return { x: radius * Math.cos(angle), z: -radius * Math.sin(angle) };
}

/**
 * Number of spiral points inside the disk, up to MESH_SPIRAL_MARGIN from its edge.
 *
 * Returns:
 *   The count of interior (erodible) vertices.
 */
export function spiralPointCount() {
    const maxRadius = MESH_RADIUS - MESH_SPIRAL_MARGIN * MESH_SPACING;
    return Math.floor(Math.PI * (maxRadius / MESH_SPACING) ** 2) + 1;
}

/**
 * Build the vertex positions and the initial bed of the shared terrain.
 *
 * Vertices are, in order: the jittered Vogel spiral filling the disk
 * (erodible), the boundary polygon on the circle of radius MESH_RADIUS, and its
 * radial projection on the square of half-side MESH_HALF_SIZE. The browser
 * (`js/terrain.js`) builds the same vertices in the same order and adds the
 * triangulation, which the Worker does not need.
 *
 * Returns:
 *   Vertices (m), elevation and bedrock (m), the erodible vertex count and
 *   the initial sand-depth factor of each vertex.
 */
export function createInitialMesh() {
    const vertices = [];
    const erodibleCount = spiralPointCount();
    for (let n = 0; n < erodibleCount; n++) {
        const { x, z } = spiralPoint(n);
        const { dx, dz } = meshJitter(n);
        vertices.push({ x: x + dx, z: z + dz });
    }
    // A multiple of 8 puts polygon vertices on the axes and diagonals, so the
    // square corners are projections of polygon vertices.
    const sectors = 8 * Math.round(2 * Math.PI * MESH_RADIUS / MESH_SPACING / 8);
    const outer = [];
    for (let s = 0; s < sectors; s++) {
        const angle = 2 * Math.PI * s / sectors;
        outer.push(vertices.length);
        vertices.push({ x: MESH_RADIUS * Math.cos(angle), z: -MESH_RADIUS * Math.sin(angle) });
    }
    for (const index of outer) {
        const point = vertices[index];
        const factor = MESH_HALF_SIZE / Math.max(Math.abs(point.x), Math.abs(point.z));
        vertices.push({ x: point.x * factor, z: point.z * factor });
    }

    const bedrock = new Float64Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) {
        const { x, z } = vertices[i];
        const radius = Math.hypot(x, z);
        const cone = MESH_SLOPE * Math.min(MESH_RADIUS, radius) +
            MESH_SURROUND_SLOPE * Math.max(0, radius - MESH_RADIUS) +
            MESH_PERIPHERAL_SLOPE * Math.max(0, Math.min(MESH_PERIPHERAL_WIDTH,
                radius - MESH_RADIUS + MESH_PERIPHERAL_WIDTH));
        if (z <= 0) {
            bedrock[i] = cone;
            continue;
        }
        const width = MESH_SINK_RADIUS + MESH_CHANNEL_FLARE * z;
        const t = Math.max(0, Math.min(1, Math.abs(x) / width));
        const blend = t * t * (3 - 2 * t);
        bedrock[i] = -MESH_CHANNEL_SLOPE * z * (1 - blend) + cone * blend;
    }

    const sandDepthFactor = Float64Array.from(bedrock, (_, i) => {
        const { x, z } = vertices[i];
        return channelSandFactor(x, z);
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
