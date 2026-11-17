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
export const MAX_REQUESTS_PER_SYNC = 2;
export const MESH_SIGNATURE = JSON.stringify([
    'disk-square-polar-v2', MESH_RADIUS, MESH_HALF_SIZE, MESH_RINGS, MESH_SPACING
]);

export function createInitialMesh(peripheralSlope = MESH_PERIPHERAL_SLOPE) {
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

    const elevation = Float64Array.from(
        bedrock, height => height + MESH_INITIAL_SAND_DEPTH
    );
    return { elevation, bedrock, erodibleCount };
}

export function getSyncIntervalMs(activeCollaborators, budgetPerDay = 80_000) {
    const active = Math.max(1, Math.floor(activeCollaborators));
    return Math.max(
        300_000,
        Math.ceil(active * MAX_REQUESTS_PER_SYNC * 86_400_000 / budgetPerDay)
    );
}
