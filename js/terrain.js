const LEGACY_TERRAIN_MESH_SIGNATURE = JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
const CHANNEL_SAND_FREE_PROFILE = 'channel-sand-free-v1';

/**
 * Integer avalanche hash (lowbias32), mirrored from `worker/mesh.mjs`.
 *
 * Only 32-bit integer operations are used, so the browser and the Worker
 * obtain bit-identical vertex positions on every JavaScript engine.
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
 * Circular erodible bed with staggered, slightly jittered polar rings and a
 * fixed square surround.
 */
class TerrainGrid {
    constructor() {
        this.radius = 25;
        this.halfSize = 30;
        this.rings = 125;
        this.spacing = 0.2;
        this.sinkRadius = 0.8;
        this.slope = 0.09;
        this.surroundSlope = 0.3;
        this.peripheralSlope = 0.06;
        this.peripheralWidth = 4;
        this.initialSandDepth = 0.3;
        this.channelFlare = 0.12;
        // Vertex jitter radius as a fraction of the spacing: it breaks the
        // alignments of the rings along the cardinal axes (and hence the
        // channel axis) that would otherwise favour some flow directions.
        this.jitter = 0.1;
        this.jitterSeed = 2026;
        this.vertices = [{ x: 0, z: 0 }];
        this.triangles = [];
        this.ringVertices = [];
        this.ringAngles = [];

        for (let r = 1; r <= this.rings; r++) {
            const radius = this.radius * r / this.rings;
            const sectors = r === this.rings
                ? 8 * Math.round(2 * Math.PI * radius / this.spacing / 8)
                : Math.max(6, Math.round(2 * Math.PI * radius / this.spacing));
            const offset = r === this.rings ? 0 : (r % 2 ? 0.5 : -0.5) * 2 * Math.PI / sectors;
            const ring = [];
            const angles = [];
            for (let s = 0; s < sectors; s++) {
                const angle = 2 * Math.PI * s / sectors + offset;
                ring.push(this.vertices.length);
                angles.push(angle);
                this.vertices.push({ x: radius * Math.cos(angle), z: -radius * Math.sin(angle) });
            }
            this.ringVertices.push(ring);
            this.ringAngles.push(angles);
        }

        // The triangulation below only uses ring angles, so jittering the
        // positions keeps it valid as long as the jitter is small. The outer
        // ring stays on the circle, which keeps the disk edge and the square
        // surround projected from it exact.
        const regularDisk = this.vertices.map(point => ({ ...point }));
        for (let i = 0; i < this.ringVertices[this.rings - 1][0]; i++) {
            const { dx, dz } = this.jitterOffset(i);
            this.vertices[i].x += dx;
            this.vertices[i].z += dz;
        }

        this.sectors = this.ringVertices[this.rings - 1].length;
        const firstRing = this.ringVertices[0];
        for (let s = 0; s < firstRing.length; s++) {
            this.triangles.push([0, firstRing[s], firstRing[(s + 1) % firstRing.length]]);
        }
        for (let r = 0; r < this.rings - 1; r++) {
            const inner = this.ringVertices[r];
            const outer = this.ringVertices[r + 1];
            const innerAngles = this.ringAngles[r];
            const outerAngles = this.ringAngles[r + 1];
            // Shift each ring to its first non-negative angle and close the seam.
            const ordered = (indices, angles) => indices.map((index, k) => ({
                index, angle: (angles[k] + 2 * Math.PI) % (2 * Math.PI)
            })).sort((a, b) => a.angle - b.angle);
            const a = ordered(inner, innerAngles);
            const b = ordered(outer, outerAngles);
            let i = 0, j = 0;
            // Start at the last vertices before angle zero.
            while (i < a.length || j < b.length) {
                const nextInner = i < a.length ? a[i].angle : Infinity;
                const nextOuter = j < b.length ? b[j].angle : Infinity;
                const currentInner = a[(i + a.length - 1) % a.length].index;
                const currentOuter = b[(j + b.length - 1) % b.length].index;
                if (nextInner <= nextOuter) {
                    this.triangles.push([currentInner, currentOuter, a[i].index]);
                    i++;
                } else {
                    this.triangles.push([currentInner, currentOuter, b[j].index]);
                    j++;
                }
            }
        }

        const outer = this.ringVertices[this.rings - 1];
        this.erodibleCount = outer[0];
        const square = [];
        for (const index of outer) {
            const point = this.vertices[index];
            const factor = this.halfSize / Math.max(Math.abs(point.x), Math.abs(point.z));
            square.push(this.vertices.length);
            this.vertices.push({ x: point.x * factor, z: point.z * factor });
        }
        // Regular positions are kept to read saves made before the jitter.
        this.regularVertices = regularDisk.concat(this.vertices.slice(regularDisk.length));
        for (let s = 0; s < this.sectors; s++) {
            const next = (s + 1) % this.sectors;
            this.triangles.push([outer[s], square[s], outer[next]]);
            this.triangles.push([outer[next], square[s], square[next]]);
        }

        const count = this.vertices.length;
        this.bedrock = new Float64Array(count);
        this.vertices.forEach((point, i) => {
            this.bedrock[i] = this.bedrockHeight(point.x, point.z);
        });
        this.elevation = new Float64Array(count);
        this.waterDepth = new Float64Array(count);
        this.sediment = new Float64Array(count);
        this.velocityX = new Float64Array(count);
        this.velocityY = new Float64Array(count);
        this.flowHistory = new Float32Array(count);
        this.vegetation = new Float32Array(count);
        this.microbeU = new Float32Array(count);
        this.microbeV = new Float32Array(count);
        this.vertexArea = new Float64Array(count);
        this.bins = new Map();
        this.binSize = 1;
        this.edges = [];
        const edgeKeys = new Set();
        this.triangles.forEach((face, index) => {
            const points = face.map(i => this.vertices[i]);
            const area = Math.abs((points[1].x - points[0].x) * (points[2].z - points[0].z) -
                (points[2].x - points[0].x) * (points[1].z - points[0].z)) / 2;
            face.forEach(i => { this.vertexArea[i] += area / 3; });
            for (let k = 0; k < 3; k++) {
                const a = Math.min(face[k], face[(k + 1) % 3]);
                const b = Math.max(face[k], face[(k + 1) % 3]);
                const key = `${a},${b}`;
                if (!edgeKeys.has(key)) {
                    edgeKeys.add(key);
                    this.edges.push({
                        a, b,
                        length: Math.hypot(this.vertices[a].x - this.vertices[b].x,
                            this.vertices[a].z - this.vertices[b].z)
                    });
                }
            }
            const minX = Math.floor(Math.min(...points.map(p => p.x)) / this.binSize);
            const maxX = Math.floor(Math.max(...points.map(p => p.x)) / this.binSize);
            const minZ = Math.floor(Math.min(...points.map(p => p.z)) / this.binSize);
            const maxZ = Math.floor(Math.max(...points.map(p => p.z)) / this.binSize);
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = `${x},${z}`;
                    if (!this.bins.has(key)) this.bins.set(key, []);
                    this.bins.get(key).push(index);
                }
            }
        });
        this.particles = [];
        this.initialize();
    }

    /**
     * Deterministic isotropic displacement of one disk vertex.
     *
     * Uniform in a disk, drawn by rejection from a square: unlike a square
     * jitter it has no preferred cardinal direction, and it avoids
     * trigonometry, whose last bit may differ between engines.
     *
     * Args:
     *   index: vertex index; the same index always yields the same offset.
     *
     * Returns:
     *   The offset `{ dx, dz }` (m), of length at most jitter * spacing.
     */
    jitterOffset(index) {
        const amplitude = this.jitter * this.spacing;
        let state = hashUint32(Math.imul(index, 0x9e3779b9) ^ this.jitterSeed);
        for (let attempt = 0; amplitude > 0 && attempt < 64; attempt++) {
            state = hashUint32(state);
            const u = 2 * state / 4294967296 - 1;
            state = hashUint32(state);
            const v = 2 * state / 4294967296 - 1;
            if (u * u + v * v <= 1) return { dx: amplitude * u, dz: amplitude * v };
        }
        return { dx: 0, dz: 0 };
    }

    bedrockHeight(x, z, surroundSlope = this.surroundSlope, peripheralSlope = this.peripheralSlope) {
        const radius = Math.hypot(x, z);
        const cone = this.slope * Math.min(this.radius, radius) +
            surroundSlope * Math.max(0, radius - this.radius) +
            peripheralSlope * Math.max(0, Math.min(this.peripheralWidth,
                radius - this.radius + this.peripheralWidth));
        if (z <= 0) return cone;
        const width = this.sinkRadius + this.channelFlare * z;
        const t = Math.max(0, Math.min(1, Math.abs(x) / width));
        const blend = t * t * (3 - 2 * t);
        return -this.slope * z * (1 - blend) + cone * blend;
    }

    sandDepthFactor(x, z) {
        if (z <= 0) return 1;
        const channelWidth = this.sinkRadius + this.channelFlare * z;
        const t = Math.abs(x) / channelWidth;
        if (t <= 1) return 0;
        if (t >= 1.25) return 1;
        const blend = (t - 1) / 0.25;
        return blend * blend * (3 - 2 * blend);
    }

    sandDepthFactorAt(index) {
        const point = this.vertices[index];
        return this.sandDepthFactor(point.x, point.z);
    }

    initialize() {
        this.vertices.forEach((point, i) => {
            this.elevation[i] = this.bedrock[i] + this.initialSandDepth * this.sandDepthFactor(point.x, point.z);
        });
        this.waterDepth.fill(0);
        this.sediment.fill(0);
        this.velocityX.fill(0);
        this.velocityY.fill(0);
        this.flowHistory.fill(0);
        this.vegetation.fill(0);
        this.seedMicrobes();
    }

    seedMicrobes() {
        this.microbeU.fill(1);
        this.microbeV.fill(0);
        for (let i = 0; i < this.erodibleCount; i++) {
            const point = this.vertices[i];
            const cellX = Math.floor(point.x / 3);
            const cellZ = Math.floor(point.z / 3);
            let concentration = 0;
            for (let x = cellX - 1; x <= cellX + 1; x++) {
                for (let z = cellZ - 1; z <= cellZ + 1; z++) {
                    const hash = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
                    if (hash % 3 !== 0) continue;
                    const cx = 3 * (x + 0.3 + ((hash >>> 4) % 40) / 100);
                    const cz = 3 * (z + 0.3 + ((hash >>> 12) % 40) / 100);
                    const distanceSquared = (point.x - cx) ** 2 + (point.z - cz) ** 2;
                    if (distanceSquared < 9) {
                        concentration = Math.max(concentration, 0.15 * Math.exp(-distanceSquared / (2 * 1.1 ** 2)));
                    }
                }
            }
            this.microbeV[i] = concentration;
        }
    }

    locate(x, z) {
        const key = `${Math.floor(x / this.binSize)},${Math.floor(z / this.binSize)}`;
        for (const index of this.bins.get(key) || []) {
            const face = this.triangles[index];
            const a = this.vertices[face[0]], b = this.vertices[face[1]], c = this.vertices[face[2]];
            const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
            const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
            const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
            const wc = 1 - wa - wb;
            if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) {
                return { face, weights: [wa, wb, wc], det };
            }
        }
        return null;
    }

    sample(x, z) {
        const hit = this.locate(x, z);
        if (!hit) return null;
        const [ia, ib, ic] = hit.face;
        const a = this.vertices[ia], b = this.vertices[ib], c = this.vertices[ic];
        const ha = this.elevation[ia], hb = this.elevation[ib], hc = this.elevation[ic];
        return {
            ...hit,
            height: hit.weights[0] * ha + hit.weights[1] * hb + hit.weights[2] * hc,
            dx: (ha * (b.z - c.z) + hb * (c.z - a.z) + hc * (a.z - b.z)) / hit.det,
            dz: (ha * (c.x - b.x) + hb * (a.x - c.x) + hc * (b.x - a.x)) / hit.det
        };
    }

    meshSignature() {
        return JSON.stringify([
            'disk-square-polar-v2', this.radius, this.halfSize, this.rings, this.spacing,
            CHANNEL_SAND_FREE_PROFILE, 'jitter-v1', this.jitter, this.jitterSeed
        ]);
    }

    toJSON() {
        return {
            version: '13.0',
            topology: 'disk-square-polar-v2',
            meshSignature: this.meshSignature(),
            timestamp: new Date().toISOString(),
            elevation: Array.from(this.elevation),
            waterDepth: Array.from(this.waterDepth),
            sediment: Array.from(this.sediment),
            particles: this.particles.map(p => ({ ...p }))
        };
    }

    fromJSON(json) {
        const arrays = [json.elevation, json.waterDepth, json.sediment];
        const validParticles = Array.isArray(json.particles) &&
            (json.particles.length === this.particles.length ||
                ([500, 1000].includes(json.particles.length) && this.particles.length === 1500)) &&
            json.particles.every(p => p && [p.x, p.z, p.vx, p.vz, p.sediment].every(Number.isFinite) &&
                p.sediment >= 0 &&
                (p.travelTime === undefined || (Number.isFinite(p.travelTime) && p.travelTime >= 0)) &&
                (p.burstProgress === undefined ||
                    (Number.isFinite(p.burstProgress) && p.burstProgress >= 0 && p.burstProgress < 1)) &&
                this.locate(p.x, p.z));
        const savedMeshSignature = json.meshSignature ?? LEGACY_TERRAIN_MESH_SIGNATURE;
        const legacyMeshDimensions = this.radius === 25 && this.halfSize === 30 &&
            this.rings === 125 && this.spacing === 0.2;
        if (!['10.0', '11.0', '12.0', '13.0'].includes(json.version) ||
            json.topology !== 'disk-square-polar-v2' ||
            (savedMeshSignature !== this.meshSignature() &&
                !(json.version !== '13.0' && legacyMeshDimensions &&
                    savedMeshSignature === LEGACY_TERRAIN_MESH_SIGNATURE)) ||
            !validParticles ||
            arrays.some(a => !Array.isArray(a) || a.length !== this.elevation.length || !a.every(Number.isFinite))) {
            console.warn('Saved terrain is incompatible with the circular mesh');
            return false;
        }
        // Saves before version 13.0 were made on the regular (unjittered) mesh.
        const savedBedrock = (i) => {
            const point = this.regularVertices[i];
            if (json.version === '10.0') return this.bedrockHeight(point.x, point.z, 0, 0);
            if (json.version === '11.0') return this.bedrockHeight(point.x, point.z, this.surroundSlope, 0);
            if (json.version === '12.0') return this.bedrockHeight(point.x, point.z);
            return this.bedrock[i];
        };
        if (json.elevation.some((height, i) => height < savedBedrock(i))) {
            console.warn('Saved terrain extends below the bedrock');
            return false;
        }
        if (json.elevation.some((height, i) =>
            i >= this.erodibleCount &&
            height < savedBedrock(i) + this.initialSandDepth * this.sandDepthFactorAt(i))) {
            console.warn('Saved terrain erodes the fixed surround');
            return false;
        }
        if (json.version === '13.0' && json.elevation.some((height, i) =>
            this.sandDepthFactorAt(i) === 0 && height > this.bedrock[i] + 1e-12)) {
            console.warn('Saved terrain adds sand to the output channel');
            return false;
        }
        for (const [name, max] of [['flowHistory', Infinity], ['vegetation', 1]]) {
            const values = json[name];
            if (values !== undefined && (!Array.isArray(values) || values.length !== this.elevation.length ||
                values.some((value, i) => !Number.isFinite(value) || value < 0 || value > max ||
                    (i >= this.erodibleCount && value !== 0)))) {
                console.warn(`Saved terrain has invalid ${name}`);
                return false;
            }
        }
        if ((json.microbeU === undefined) !== (json.microbeV === undefined)) {
            console.warn('Saved terrain has incomplete microorganism state');
            return false;
        }
        for (const [name, outside] of [['microbeU', 1], ['microbeV', 0]]) {
            const values = json[name];
            if (values !== undefined && (!Array.isArray(values) || values.length !== this.elevation.length ||
                values.some((value, i) => !Number.isFinite(value) || value < 0 || value > 1 ||
                    (i >= this.erodibleCount && value !== outside)))) {
                console.warn(`Saved terrain has invalid ${name}`);
                return false;
            }
        }
        for (let i = 0; i < this.elevation.length; i++) {
            const sand = Math.max(0, json.elevation[i] - savedBedrock(i));
            const profileFactor = json.version === '13.0' ? 1 : this.sandDepthFactorAt(i);
            this.elevation[i] = this.bedrock[i] + sand * profileFactor;
        }
        this.waterDepth.set(json.waterDepth);
        this.sediment.set(json.sediment);
        this.flowHistory.fill(0);
        this.vegetation.fill(0);
        if (json.flowHistory !== undefined) this.flowHistory.set(json.flowHistory);
        if (json.vegetation !== undefined) this.vegetation.set(json.vegetation);
        if (json.microbeU === undefined) this.seedMicrobes();
        else {
            this.microbeU.set(json.microbeU);
            this.microbeV.set(json.microbeV);
        }
        this.hasLegacyBiology = json.vegetation !== undefined && json.microbeU !== undefined;
        const addedParticles = this.particles.slice(json.particles.length).map(p => ({
            x: p.x, z: p.z, vx: 0, vz: 0, sediment: 0, travelTime: 0
        }));
        this.particles.splice(0, this.particles.length,
            ...json.particles.map(p => ({ ...p, travelTime: p.travelTime ?? 0 })), ...addedParticles);
        return true;
    }
}
