const LEGACY_TERRAIN_MESH_SIGNATURE = JSON.stringify(['disk-square-polar-v2', 25, 30, 125, 0.2]);
const CHANNEL_SAND_FREE_PROFILE = 'channel-sand-free-v1';
/**
 * Delaunay triangulation of a planar point set (incremental, Lawson flips).
 *
 * Points are inserted in a serpentine row order, so that each point is found by
 * a short walk from the triangle created for the previous one. After each
 * insertion, the edges opposite the new point are flipped while the opposite
 * vertex lies inside their circumcircle. A flip is only made when the
 * quadrilateral is strictly convex: rounding errors on nearly cocircular points
 * may then leave a non-Delaunay edge, but never an invalid triangulation.
 * Three far vertices enclose the points and are removed at the end, so the
 * result covers the convex hull as long as every hull edge is a Gabriel edge
 * (its diametral circle holds no other point).
 *
 * Args:
 *   xs: x coordinates (m).
 *   zs: z coordinates (m).
 *
 * Returns:
 *   Triangles as vertex-index triples, oriented like the rest of the mesh
 *   (positive signed area in the (x, z) convention of the tests).
 */
function delaunayTriangles(xs, zs) {
    const n = xs.length;
    const X = new Float64Array(n + 3);
    const Y = new Float64Array(n + 3);
    X.set(xs);
    Y.set(zs);
    let centreX = 0, centreY = 0, extent = 0;
    for (let i = 0; i < n; i++) {
        centreX += xs[i] / n;
        centreY += zs[i] / n;
    }
    for (let i = 0; i < n; i++) extent = Math.max(extent, Math.hypot(xs[i] - centreX, zs[i] - centreY));
    for (let k = 0; k < 3; k++) {
        const angle = Math.PI / 2 + 2 * Math.PI * k / 3;
        X[n + k] = centreX + 20 * extent * Math.cos(angle);
        Y[n + k] = centreY + 20 * extent * Math.sin(angle);
    }
    // Half-edge e of triangle t = floor(e / 3) runs from V[e] to V[next(e)];
    // O[e] is its twin in the neighbouring triangle, or -1.
    const capacity = 3 * (2 * n + 1);
    const V = new Int32Array(capacity);
    const O = new Int32Array(capacity).fill(-1);
    const next = e => e - e % 3 + (e + 1) % 3;
    const prev = e => e - e % 3 + (e + 2) % 3;
    const orient = (a, b, p) => (X[b] - X[a]) * (Y[p] - Y[a]) - (Y[b] - Y[a]) * (X[p] - X[a]);
    const inCircle = (a, b, c, d) => {
        const adx = X[a] - X[d], ady = Y[a] - Y[d];
        const bdx = X[b] - X[d], bdy = Y[b] - Y[d];
        const cdx = X[c] - X[d], cdy = Y[c] - Y[d];
        return (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
            (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
            (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady) > 0;
    };
    const setTriangle = (t, a, b, c, oa, ob, oc) => {
        V[3 * t] = a; V[3 * t + 1] = b; V[3 * t + 2] = c;
        O[3 * t] = oa; O[3 * t + 1] = ob; O[3 * t + 2] = oc;
        if (oa >= 0) O[oa] = 3 * t;
        if (ob >= 0) O[ob] = 3 * t + 1;
        if (oc >= 0) O[oc] = 3 * t + 2;
    };
    const link = (e, f) => { O[e] = f; O[f] = e; };
    const stack = [];
    // Each flip adds an edge to the new point and edges to it are never tested
    // again, so the loop terminates even with inexact predicates.
    const legalize = (start) => {
        stack.push(start);
        while (stack.length) {
            const e = stack.pop();
            const f = O[e];
            if (f < 0) continue;
            const a = V[e], b = V[next(e)], c = V[prev(e)], d = V[prev(f)];
            if (!inCircle(a, b, c, d) || orient(a, d, c) <= 0 || orient(d, b, c) <= 0) continue;
            const t1 = (e / 3) | 0, t2 = (f / 3) | 0;
            const ca = O[prev(e)], bc = O[next(e)], ad = O[next(f)], db = O[prev(f)];
            setTriangle(t1, a, d, c, ad, -1, ca);
            setTriangle(t2, d, b, c, db, bc, -1);
            link(3 * t1 + 1, 3 * t2 + 2);
            stack.push(3 * t1, 3 * t2);
        }
    };
    setTriangle(0, n, n + 1, n + 2, -1, -1, -1);
    let count = 1;
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => {
        const rowI = Math.floor(zs[i]), rowJ = Math.floor(zs[j]);
        if (rowI !== rowJ) return rowI - rowJ;
        return rowI % 2 ? xs[j] - xs[i] : xs[i] - xs[j];
    });
    let t = 0;
    for (const p of order) {
        // Visibility walk; rotating the first edge tested avoids cycles.
        for (let step = 0; ; step++) {
            let moved = false;
            for (let k = 0; k < 3; k++) {
                const e = 3 * t + (k + step) % 3;
                if (orient(V[e], V[next(e)], p) < 0 && O[e] >= 0) {
                    t = (O[e] / 3) | 0;
                    moved = true;
                    break;
                }
            }
            if (!moved) break;
        }
        const a = V[3 * t], b = V[3 * t + 1], c = V[3 * t + 2];
        const ab = O[3 * t], bc = O[3 * t + 1], ca = O[3 * t + 2];
        const t1 = count++, t2 = count++;
        setTriangle(t, a, b, p, ab, -1, -1);
        setTriangle(t1, b, c, p, bc, -1, -1);
        setTriangle(t2, c, a, p, ca, -1, -1);
        link(3 * t + 1, 3 * t1 + 2);
        link(3 * t + 2, 3 * t2 + 1);
        link(3 * t1 + 1, 3 * t2 + 2);
        legalize(3 * t);
        legalize(3 * t1);
        legalize(3 * t2);
    }
    const triangles = [];
    for (let k = 0; k < count; k++) {
        const a = V[3 * k], b = V[3 * k + 1], c = V[3 * k + 2];
        // Counter-clockwise in (x, z) is negative in the mesh convention.
        if (a < n && b < n && c < n) triangles.push([a, c, b]);
    }
    return triangles;
}

/**
 * Circular erodible bed meshed by a Delaunay triangulation of a Poisson-disk
 * (blue-noise) point set, with a fixed square surround.
 *
 * The points come from `js/mesh-points.js` (`globalThis.MESH_POINTS`), generated
 * once by `tools/generate-mesh-points.mjs` and also read by the Worker.
 */
class TerrainGrid {
    constructor() {
        this.radius = 25;
        this.halfSize = 30;
        // Spacing of the boundary polygon (m); the Poisson points have about
        // the same mean spacing (one point per spacing^2).
        this.spacing = 0.2;
        this.sinkRadius = 0.8;
        // Radial slope of the funnel cone that drains the bed towards the channel.
        this.slope = 0.11;
        // Descent of the outlet channel axis towards the sink, kept separate so
        // that steepening the cone does not also deepen the channel.
        this.channelSlope = 0.09;
        this.surroundSlope = 0.3;
        this.peripheralSlope = 0.06;
        this.peripheralWidth = 4;
        this.initialSandDepth = 0.3;
        this.channelFlare = 0.12;
        this.vertices = [];

        // Interior: the Poisson-disk points, in the order shared with the Worker.
        this.meshPoints = globalThis.MESH_POINTS;
        if (!this.meshPoints || this.meshPoints.params.radius !== this.radius) {
            throw new Error('js/mesh-points.js is missing or was generated for another radius');
        }
        this.erodibleCount = this.meshPoints.count;
        for (let i = 0; i < this.erodibleCount; i++) {
            this.vertices.push({ x: this.meshPoints.x[i], z: this.meshPoints.z[i] });
        }
        // Boundary polygon on the circle; a multiple of 8 puts vertices on the
        // axes and diagonals, so the square corners are projections of them.
        this.sectors = 8 * Math.round(2 * Math.PI * this.radius / this.spacing / 8);
        this.outerRing = [];
        for (let s = 0; s < this.sectors; s++) {
            const angle = 2 * Math.PI * s / this.sectors;
            this.outerRing.push(this.vertices.length);
            this.vertices.push({ x: this.radius * Math.cos(angle), z: -this.radius * Math.sin(angle) });
        }
        this.triangles = delaunayTriangles(
            this.vertices.map(point => point.x), this.vertices.map(point => point.z)
        );

        const outer = this.outerRing;
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
        this.particles = [];
        this.initialize();
    }

    bedrockHeight(x, z) {
        const radius = Math.hypot(x, z);
        const cone = this.slope * Math.min(this.radius, radius) +
            this.surroundSlope * Math.max(0, radius - this.radius) +
            this.peripheralSlope * Math.max(0, Math.min(this.peripheralWidth,
                radius - this.radius + this.peripheralWidth));
        if (z <= 0) return cone;
        const width = this.sinkRadius + this.channelFlare * z;
        const t = Math.max(0, Math.min(1, Math.abs(x) / width));
        const blend = t * t * (3 - 2 * t);
        return -this.channelSlope * z * (1 - blend) + cone * blend;
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
            'disk-square-poisson-v1', this.radius, this.halfSize, this.spacing,
            this.meshPoints.params.minDistance, this.meshPoints.params.edgeMargin,
            this.meshPoints.params.seed, this.meshPoints.count, this.meshPoints.checksum,
            CHANNEL_SAND_FREE_PROFILE,
            'slopes-v1', this.slope, this.channelSlope
        ]);
    }

    toJSON() {
        return {
            version: '15.0',
            topology: 'disk-square-poisson-v1',
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
        // Saves made on earlier meshes (polar rings, versions 10.0 to 13.0; Vogel
        // spiral, 14.0) are not migrated: their vertices differ from the
        // Poisson-disk points.
        if (json.version !== '15.0' ||
            json.topology !== 'disk-square-poisson-v1' ||
            json.meshSignature !== this.meshSignature() ||
            !validParticles ||
            arrays.some(a => !Array.isArray(a) || a.length !== this.elevation.length || !a.every(Number.isFinite))) {
            console.warn('Saved terrain is incompatible with the circular mesh');
            return false;
        }
        if (json.elevation.some((height, i) => height < this.bedrock[i])) {
            console.warn('Saved terrain extends below the bedrock');
            return false;
        }
        if (json.elevation.some((height, i) =>
            i >= this.erodibleCount &&
            height < this.bedrock[i] + this.initialSandDepth * this.sandDepthFactorAt(i))) {
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
