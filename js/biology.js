/**
 * Visitor-local vegetation and Gray-Scott colonies on a finer grid than the bed.
 */
class BiologyGrid {
    constructor(terrain) {
        this.terrain = terrain;
        this.size = 256;
        this.spacing = 2 * terrain.radius / (this.size - 1);
        const count = this.size * this.size;
        this.faces = new Int32Array(count * 3);
        this.faces.fill(-1);
        this.weights = new Float32Array(count * 3);
        this.active = new Uint8Array(count);
        this.sand = new Uint8Array(count);
        this.flow = new Float32Array(count);
        this.plants = new Float32Array(count);
        this.inhibitor = new Float32Array(count);
        this.microbeU = new Float32Array(count);
        this.microbeV = new Float32Array(count);
        this.microbeSeeds = new Float32Array(count);
        this.nearby = new Float32Array(count);
        this.scratch = new Float32Array(count);
        this.nearbyPlants = new Float32Array(count);
        this.plantScratch = new Float32Array(count);
        this.nextPlants = new Float32Array(count);
        this.nextInhibitor = new Float32Array(count);
        this.nextU = new Float32Array(count);
        this.nextV = new Float32Array(count);
        this.habitat = new Float32Array(count);
        this.vertexFlux = new Float32Array(terrain.vertices.length);
        this.elapsed = 0;

        for (let z = 0; z < this.size; z++) {
            for (let x = 0; x < this.size; x++) {
                const i = z * this.size + x;
                const px = x * this.spacing - terrain.radius;
                const pz = z * this.spacing - terrain.radius;
                if (Math.hypot(px, pz) >= terrain.radius) continue;
                const hit = terrain.locate(px, pz);
                if (!hit) throw new Error(`Missing terrain under biology cell ${x},${z}`);
                if (hit.face.some(index => index >= terrain.erodibleCount)) continue;
                this.active[i] = 1;
                for (let k = 0; k < 3; k++) {
                    this.faces[3 * i + k] = hit.face[k];
                    this.weights[3 * i + k] = hit.weights[k];
                }
            }
        }
        this.reset();
    }

    reset() {
        this.flow.fill(0);
        this.plants.fill(0);
        this.inhibitor.fill(0);
        this.microbeU.fill(1);
        this.microbeV.fill(0);
        this.nextPlants.fill(0);
        this.nextInhibitor.fill(0);
        this.nextU.fill(1);
        this.nextV.fill(0);
        this.elapsed = 0;
        const radius = this.terrain.radius;
        for (let z = 0; z < this.size; z++) {
            for (let x = 0; x < this.size; x++) {
                const i = z * this.size + x;
                if (!this.active[i]) continue;
                const px = x * this.spacing - radius;
                const pz = z * this.spacing - radius;
                const cellX = Math.floor(px / 3), cellZ = Math.floor(pz / 3);
                let concentration = 0;
                for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
                    for (let cz = cellZ - 1; cz <= cellZ + 1; cz++) {
                        const hash = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
                        if (hash % 2 !== 0) continue;
                        const dx = px - 3 * (cx + 0.3 + ((hash >>> 4) % 40) / 100);
                        const dz = pz - 3 * (cz + 0.3 + ((hash >>> 12) % 40) / 100);
                        const distance = dx * dx + dz * dz;
                        if (distance < 9) concentration = Math.max(concentration, 0.25 * Math.exp(-distance / 4));
                    }
                }
                this.microbeV[i] = concentration;
                this.microbeSeeds[i] = concentration / 0.25;
            }
        }
        this.updateSand();
    }

    terrainValue(i, values) {
        const j = 3 * i;
        return this.weights[j] * values[this.faces[j]] +
            this.weights[j + 1] * values[this.faces[j + 1]] +
            this.weights[j + 2] * values[this.faces[j + 2]];
    }

    importLegacy() {
        const terrain = this.terrain;
        for (let i = 0; i < this.active.length; i++) {
            if (!this.active[i]) continue;
            this.flow[i] = Math.max(0, this.terrainValue(i, terrain.flowHistory));
            this.plants[i] = Math.max(0, Math.min(1, this.terrainValue(i, terrain.vegetation)));
            this.microbeU[i] = Math.max(0, Math.min(1, this.terrainValue(i, terrain.microbeU)));
            this.microbeV[i] = Math.max(0, Math.min(1, this.terrainValue(i, terrain.microbeV)));
        }
    }

    updateSand() {
        const terrain = this.terrain;
        for (let i = 0; i < this.active.length; i++) {
            if (!this.active[i]) continue;
            this.sand[i] = this.terrainValue(i, terrain.elevation) >
                this.terrainValue(i, terrain.bedrock) + 1e-8 ? 1 : 0;
        }
    }

    step(dt) {
        if (dt <= 0) return;
        const terrain = this.terrain;
        for (let i = 0; i < terrain.erodibleCount; i++) {
            this.vertexFlux[i] = terrain.waterDepth[i] > 0
                ? terrain.waterDepth[i] * Math.hypot(terrain.velocityX[i], terrain.velocityY[i]) : 0;
        }
        const alpha = 1 - Math.exp(-dt / 8);
        for (let i = 0; i < this.active.length; i++) {
            if (this.active[i]) this.flow[i] += alpha * (this.terrainValue(i, this.vertexFlux) - this.flow[i]);
        }
        this.elapsed += dt;
        if (this.elapsed < 0.16) return;
        const elapsed = this.elapsed;
        this.elapsed = 0;
        this.updateSand();
        this.updateColonies(elapsed);
    }

    updateColonies(dt) {
        const size = this.size, count = this.active.length;
        this.nearby.set(this.flow);
        let nearby = this.nearby, scratch = this.scratch;
        for (let pass = 0; pass < 4; pass++) {
            scratch.set(nearby);
            for (let z = 1; z < size - 1; z++) {
                for (let x = 1; x < size - 1; x++) {
                    const i = z * size + x;
                    if (!this.active[i]) continue;
                    scratch[i] = Math.max(nearby[i], 0.72 * nearby[i - 1], 0.72 * nearby[i + 1],
                        0.72 * nearby[i - size], 0.72 * nearby[i + size]);
                }
            }
            [nearby, scratch] = [scratch, nearby];
        }
        this.nearbyPlants.set(this.plants);
        let nearbyPlants = this.nearbyPlants, plantScratch = this.plantScratch;
        for (let pass = 0; pass < 12; pass++) {
            plantScratch.set(nearbyPlants);
            for (let z = 1; z < size - 1; z++) {
                for (let x = 1; x < size - 1; x++) {
                    const i = z * size + x;
                    if (!this.active[i] || !this.sand[i]) continue;
                    plantScratch[i] = Math.max(nearbyPlants[i], 0.84 * nearbyPlants[i - 1],
                        0.84 * nearbyPlants[i + 1], 0.84 * nearbyPlants[i - size],
                        0.84 * nearbyPlants[i + size]);
                }
            }
            [nearbyPlants, plantScratch] = [plantScratch, nearbyPlants];
        }
        const steps = Math.ceil(5 * dt);
        if (!steps) return;
        const step = 5 * dt / steps;
        const offsets = [-1, 1, -size, size];
        for (let n = 0; n < steps; n++) {
            for (let i = 0; i < count; i++) {
                this.habitat[i] = this.active[i] && this.sand[i]
                    ? Math.max(0, 1 - this.flow[i] / 0.04) * Math.max(0, 1 - this.plants[i] / 0.6) *
                    Math.min(1, Math.max(0, (nearbyPlants[i] - 0.035) / 0.12)) : 0;
            }
            for (let z = 1; z < size - 1; z++) {
                for (let x = 1; x < size - 1; x++) {
                    const i = z * size + x;
                    if (!this.active[i]) continue;
                    const p = this.plants[i], inhibitor = this.inhibitor[i];
                    const u = this.microbeU[i], v = this.microbeV[i], habitat = this.habitat[i];
                    let lapP = 0, lapI = 0, lapU = 0, lapV = 0;
                    for (const offset of offsets) {
                        const j = i + offset;
                        if (!this.active[j] || !this.sand[j] || !this.sand[i]) continue;
                        lapP += (this.plants[j] - p) / 4;
                        lapI += (this.inhibitor[j] - inhibitor) / 4;
                        const weight = Math.min(habitat, this.habitat[j]);
                        lapU += weight * (this.microbeU[j] - u) / 4;
                        lapV += weight * (this.microbeV[j] - v) / 4;
                    }
                    const wetness = Math.min(1, Math.max(0, (nearby[i] - 0.0008) / 0.008));
                    const bank = this.sand[i] * wetness *
                        Math.min(1, Math.max(0, (0.8 - this.flow[i] / Math.max(nearby[i], 1e-12)) / 0.6));
                    const reaction = (habitat > 0 ? 1 : 0) * u * v * v;
                    this.nextPlants[i] = Math.max(0, Math.min(1, p + step *
                        (0.15 * lapP + bank * (0.06 + 0.8 * p) * (1 - p) -
                            (0.9 * inhibitor + (this.sand[i] ? 0 : 0.2)) * p)));
                    this.nextInhibitor[i] = Math.max(0, Math.min(1, inhibitor + step *
                        (0.02 * lapI + 0.1 * p - 0.05 * inhibitor)));
                    this.nextU[i] = Math.max(0, Math.min(1, u + step *
                        (0.9 * lapU - reaction + 0.046 * (1 - u))));
                    // A localized inoculum revives colonies lost from saved states.
                    this.nextV[i] = Math.max(0, Math.min(1, v + step *
                        (0.45 * lapV + reaction - (0.109 + 0.15 * (1 - habitat)) * v +
                            0.06 * this.microbeSeeds[i] * habitat * Math.max(0, 1 - v / 0.15))));
                }
            }
            [this.plants, this.nextPlants] = [this.nextPlants, this.plants];
            [this.inhibitor, this.nextInhibitor] = [this.nextInhibitor, this.inhibitor];
            [this.microbeU, this.nextU] = [this.nextU, this.microbeU];
            [this.microbeV, this.nextV] = [this.nextV, this.microbeV];
        }
    }

    toJSON() {
        const fields = [this.plants, this.inhibitor, this.microbeU, this.microbeV];
        let bytes = '';
        for (const field of fields) {
            for (const value of field) {
                const encoded = Math.round(value * 65535);
                bytes += String.fromCharCode(encoded >>> 8, encoded & 255);
            }
        }
        return { version: 1, size: this.size, data: btoa(bytes) };
    }

    fromJSON(json) {
        if (json.version !== 1 || json.size !== this.size || typeof json.data !== 'string') {
            console.warn('Saved biology is incompatible with the local grid');
            return false;
        }
        const bytes = atob(json.data);
        if (bytes.length !== this.active.length * 8) {
            console.warn('Saved biology has an invalid length');
            return false;
        }
        let offset = 0;
        for (const field of [this.plants, this.inhibitor, this.microbeU, this.microbeV]) {
            for (let i = 0; i < field.length; i++) {
                field[i] = ((bytes.charCodeAt(offset) << 8) | bytes.charCodeAt(offset + 1)) / 65535;
                offset += 2;
            }
        }
        return true;
    }
}
