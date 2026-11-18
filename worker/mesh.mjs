// Defines globalThis.MESH_POINTS, the Poisson-disk points shared with the browser.
import '../js/mesh-points.js';

const MESH_POINTS = globalThis.MESH_POINTS;

export const MESH_RADIUS = 25;
export const MESH_HALF_SIZE = 30;
// Spacing of the boundary polygon (m); the Poisson points have about the same
// mean spacing.
export const MESH_SPACING = 0.2;
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
export const LEGACY_MESH_SIGNATURE = JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
export const CHANNEL_SAND_FREE_PROFILE = 'channel-sand-free-v1';
export const MAX_REQUESTS_PER_SYNC = 2;
export const MESH_SIGNATURE = JSON.stringify([
    'disk-square-poisson-v1', MESH_RADIUS, MESH_HALF_SIZE, MESH_SPACING,
    MESH_POINTS.params.minDistance, MESH_POINTS.params.edgeMargin,
    MESH_POINTS.params.seed, MESH_POINTS.count, MESH_POINTS.checksum,
    CHANNEL_SAND_FREE_PROFILE,
    'slopes-v1', MESH_SLOPE, MESH_CHANNEL_SLOPE
]);

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
 * Vertices are, in order: the Poisson-disk points of `js/mesh-points.js`
 * filling the disk (erodible), the boundary polygon on the circle of radius MESH_RADIUS, and its
 * radial projection on the square of half-side MESH_HALF_SIZE. The browser
 * (`js/terrain.js`) builds the same vertices in the same order and adds the
 * triangulation, which the Worker does not need.
 *
 * Returns:
 *   Vertices (m), elevation and bedrock (m), the erodible vertex count and
 *   the initial sand-depth factor of each vertex.
 */
export function createInitialMesh() {
    if (MESH_POINTS.params.radius !== MESH_RADIUS) {
        throw new Error('js/mesh-points.js was generated for another radius');
    }
    const vertices = [];
    const erodibleCount = MESH_POINTS.count;
    for (let i = 0; i < erodibleCount; i++) {
        vertices.push({ x: MESH_POINTS.x[i], z: MESH_POINTS.z[i] });
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
