/**
 * Semi-circular triangular bed. Coordinates are in the horizontal x/z plane;
 * the diameter is z = 0 and the outlet is at the origin.
 */
class TerrainGrid {
    constructor() {
        this.radius = 25;
        this.sectors = 64;
        this.rings = 64;
        this.sinkRadius = 0.8;
        this.slope = 0.09;
        this.initialSandDepth = 0.3;
        this.channelLength = 9;
        this.channelLift = 0.5;
        this.vertices = [{ x: 0, z: 0 }];
        this.triangles = [];

        for (let r = 1; r <= this.rings; r++) {
            for (let s = 0; s <= this.sectors; s++) {
                const angle = Math.PI * s / this.sectors;
                const radius = this.radius * r / this.rings;
                this.vertices.push({ x: radius * Math.cos(angle), z: -radius * Math.sin(angle) });
            }
        }
        const vertex = (r, s) => 1 + (r - 1) * (this.sectors + 1) + s;
        for (let s = 0; s < this.sectors; s++) {
            this.triangles.push([0, vertex(1, s), vertex(1, s + 1)]);
        }
        for (let r = 1; r < this.rings; r++) {
            for (let s = 0; s < this.sectors; s++) {
                this.triangles.push([vertex(r, s), vertex(r + 1, s), vertex(r, s + 1)]);
                this.triangles.push([vertex(r, s + 1), vertex(r + 1, s), vertex(r + 1, s + 1)]);
            }
        }

        // Splitting 34 faces into three adds 68 faces to the 8,128-face mesh.
        for (let i = 0; i < 34; i++) {
            const ring = 2 + 3 * Math.floor(i / 2);
            const sector = (17 * i) % this.sectors;
            const faceIndex = this.sectors + 2 * ((ring - 1) * this.sectors + sector);
            const face = this.triangles[faceIndex];
            const a = this.vertices[face[0]];
            const b = this.vertices[face[1]];
            const c = this.vertices[face[2]];
            const center = this.vertices.length;
            this.vertices.push({ x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 });
            this.triangles[faceIndex] = [face[0], face[1], center];
            this.triangles.push([face[1], face[2], center], [face[2], face[0], center]);
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

    // Funnel sloping towards the outlet; the flanks near the centre are raised
    // so that a flared escape channel (floor on the funnel slope) leads to the sink.
    bedrockHeight(x, z) {
        const r = Math.hypot(x, z);
        let lift = 0;
        if (r < this.channelLength) {
            const width = this.sinkRadius + 0.22 * r;
            const t = Math.min(1, Math.abs(x) / width);
            lift = this.channelLift * (1 - r / this.channelLength) * t * t * (3 - 2 * t);
        }
        return this.slope * r + lift;
    }

    initialize() {
        this.vertices.forEach((point, i) => { this.elevation[i] = this.bedrock[i] + this.initialSandDepth; });
        this.waterDepth.fill(0);
        this.sediment.fill(0);
        this.velocityX.fill(0);
        this.velocityY.fill(0);
        this.energyHistory = [];
        this.totalEnergy = 0;
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
            version: '8.0',
            topology: 'semicircle-8196',
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
        const validParticles = Array.isArray(json.particles) && json.particles.length === this.particles.length &&
            json.particles.every(p => p && [p.x, p.z, p.vx, p.vz, p.sediment].every(Number.isFinite) &&
                p.sediment >= 0 && this.locate(p.x, p.z));
        if (json.version !== '8.0' || json.topology !== 'semicircle-8196' || !validParticles ||
            arrays.some(a => !Array.isArray(a) || a.length !== this.elevation.length || !a.every(Number.isFinite))) {
            console.warn('Saved terrain is incompatible with the semi-circular mesh');
            return false;
        }
        if (json.elevation.some((height, i) => height < this.bedrock[i])) {
            console.warn('Saved terrain extends below the bedrock');
            return false;
        }
        this.elevation.set(json.elevation);
        this.waterDepth.set(json.waterDepth);
        this.sediment.set(json.sediment);
        this.particles.splice(0, this.particles.length, ...json.particles.map(p => ({ ...p })));
        return true;
    }
}
