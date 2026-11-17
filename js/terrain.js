/**
 * Circular erodible bed with staggered polar rings and a fixed square surround.
 */
class TerrainGrid {
    constructor() {
        this.radius = 25;
        this.halfSize = 30;
        this.rings = 100;
        this.spacing = 0.25;
        this.sinkRadius = 0.8;
        this.slope = 0.09;
        this.surroundSlope = 0.3;
        this.initialSandDepth = 0.3;
        this.channelFlare = 0.12;
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
        this.energyHistory = [];
        this.totalEnergy = 0;
        this.particles = [];
        this.initialize();
    }

    bedrockHeight(x, z, surroundSlope = this.surroundSlope) {
        const radius = Math.hypot(x, z);
        const cone = this.slope * Math.min(this.radius, radius) +
            surroundSlope * Math.max(0, radius - this.radius);
        if (z <= 0) return cone;
        const width = this.sinkRadius + this.channelFlare * z;
        const t = Math.max(0, Math.min(1, Math.abs(x) / width));
        const blend = t * t * (3 - 2 * t);
        return -this.slope * z * (1 - blend) + cone * blend;
    }

    initialize() {
        this.vertices.forEach((point, i) => { this.elevation[i] = this.bedrock[i] + this.initialSandDepth; });
        this.waterDepth.fill(0);
        this.sediment.fill(0);
        this.velocityX.fill(0);
        this.velocityY.fill(0);
        this.flowHistory.fill(0);
        this.vegetation.fill(0);
        this.seedMicrobes();
        this.energyHistory = [];
        this.totalEnergy = 0;
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

    microbeSuitability(i) {
        if (i >= this.erodibleCount || this.elevation[i] <= this.bedrock[i] + 1e-8) return 0;
        return Math.max(0, 1 - this.flowHistory[i] / 0.04) *
            Math.max(0, 1 - this.vegetation[i] / 0.6);
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

    calculateEnergy() {
        let energy = 0;
        for (let i = 0; i < this.elevation.length; i++) {
            energy += (this.velocityX[i] ** 2 + this.velocityY[i] ** 2) * this.waterDepth[i];
        }
        this.totalEnergy = energy;
        this.energyHistory.push(energy);
        if (this.energyHistory.length > 30) this.energyHistory.shift();
        return energy;
    }

    checkConvergence() {
        if (this.energyHistory.length < 30) return { converged: false, stability: 0 };
        const old = this.energyHistory.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
        const recent = this.energyHistory.slice(15).reduce((a, b) => a + b, 0) / 15;
        const delta = Math.abs(recent - old) / Math.max(old, 1e-6);
        const stability = Math.max(0, 100 * (1 - Math.min(1, delta / 0.05)));
        return { converged: stability > 95, stability };
    }

    toJSON() {
        return {
            version: '11.0',
            topology: 'disk-square-polar-v1',
            timestamp: new Date().toISOString(),
            elevation: Array.from(this.elevation),
            waterDepth: Array.from(this.waterDepth),
            sediment: Array.from(this.sediment),
            particles: this.particles.map(p => ({ ...p })),
            metadata: { totalEnergy: this.totalEnergy, convergenceChecked: this.checkConvergence() }
        };
    }

    fromJSON(json) {
        const arrays = [json.elevation, json.waterDepth, json.sediment];
        const validParticles = Array.isArray(json.particles) &&
            (json.particles.length === this.particles.length ||
                ([500, 1000].includes(json.particles.length) && this.particles.length === 1500)) &&
            json.particles.every(p => p && [p.x, p.z, p.vx, p.vz, p.sediment].every(Number.isFinite) &&
                p.sediment >= 0 && (p.burstProgress === undefined ||
                    (Number.isFinite(p.burstProgress) && p.burstProgress >= 0 && p.burstProgress < 1)) &&
                this.locate(p.x, p.z));
        if (!['10.0', '11.0'].includes(json.version) || json.topology !== 'disk-square-polar-v1' || !validParticles ||
            arrays.some(a => !Array.isArray(a) || a.length !== this.elevation.length || !a.every(Number.isFinite))) {
            console.warn('Saved terrain is incompatible with the circular mesh');
            return false;
        }
        const oldSurround = json.version === '10.0';
        const savedBedrock = (i) => oldSurround
            ? this.bedrockHeight(this.vertices[i].x, this.vertices[i].z, 0)
            : this.bedrock[i];
        if (json.elevation.some((height, i) => height < savedBedrock(i))) {
            console.warn('Saved terrain extends below the bedrock');
            return false;
        }
        if (json.elevation.some((height, i) =>
            i >= this.erodibleCount && height < savedBedrock(i) + this.initialSandDepth)) {
            console.warn('Saved terrain erodes the fixed surround');
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
        this.elevation.set(json.elevation);
        if (oldSurround) {
            for (let i = this.erodibleCount; i < this.elevation.length; i++) {
                const deposited = json.elevation[i] - (savedBedrock(i) + this.initialSandDepth);
                this.elevation[i] = this.bedrock[i] + this.initialSandDepth + deposited;
            }
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
            x: p.x, z: p.z, vx: 0, vz: 0, sediment: 0
        }));
        this.particles.splice(0, this.particles.length,
            ...json.particles.map(p => ({ ...p })), ...addedParticles);
        return true;
    }
}
