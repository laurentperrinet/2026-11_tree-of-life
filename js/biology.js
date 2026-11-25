/**
 * Visitor-local vegetation and Gray–Scott colonies, one cell per erodible vertex.
 */
class BiologyGrid {
    constructor(terrain) {
        this.terrain = terrain;
        this.count = terrain.erodibleCount;
        const count = this.count;
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

        // Neighbour graph from the bed triangles: the erodible mesh is unstructured,
        // so grid offsets (i±1, i±size) do not apply. Every pair of vertices sharing a
        // triangle are neighbours, regardless of which side of the disk they lie on.
        const neighbourSets = Array.from({ length: count }, () => new Set());
        for (const [a, b, c] of terrain.triangles) {
            const face = [a, b, c];
            for (let p = 0; p < 3; p++) {
                for (let q = p + 1; q < 3; q++) {
                    const i = face[p], j = face[q];
                    if (i >= count || j >= count) continue;
                    neighbourSets[i].add(j);
                    neighbourSets[j].add(i);
                }
            }
        }
        this.neighbours = neighbourSets.map(set => Array.from(set));
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
        const vertices = this.terrain.vertices;
        for (let i = 0; i < this.count; i++) {
            const px = vertices[i].x, pz = vertices[i].z;
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
        this.updateSand();
    }

    importLegacy() {
        const terrain = this.terrain;
        for (let i = 0; i < this.count; i++) {
            this.flow[i] = Math.max(0, terrain.flowHistory[i]);
            this.plants[i] = Math.max(0, Math.min(1, terrain.vegetation[i]));
            this.microbeU[i] = Math.max(0, Math.min(1, terrain.microbeU[i]));
            this.microbeV[i] = Math.max(0, Math.min(1, terrain.microbeV[i]));
        }
    }

    updateSand() {
        const terrain = this.terrain;
        for (let i = 0; i < this.count; i++) {
            this.sand[i] = terrain.elevation[i] > terrain.bedrock[i] + 1e-8 ? 1 : 0;
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
        for (let i = 0; i < this.count; i++) {
            this.flow[i] += alpha * (this.vertexFlux[i] - this.flow[i]);
        }
        this.elapsed += dt;
        if (this.elapsed < 0.16) return;
        const elapsed = this.elapsed;
        this.elapsed = 0;
        this.updateSand();
        this.updateColonies(elapsed);
    }

    updateColonies(dt) {
        this.nearby.set(this.flow);
        let nearby = this.nearby, scratch = this.scratch;
        for (let pass = 0; pass < 4; pass++) {
            scratch.set(nearby);
            for (let i = 0; i < this.count; i++) {
                let best = nearby[i];
                for (const j of this.neighbours[i]) {
                    const value = 0.72 * nearby[j];
                    if (value > best) best = value;
                }
                scratch[i] = best;
            }
            [nearby, scratch] = [scratch, nearby];
        }
        this.nearbyPlants.set(this.plants);
        let nearbyPlants = this.nearbyPlants, plantScratch = this.plantScratch;
        for (let pass = 0; pass < 12; pass++) {
            plantScratch.set(nearbyPlants);
            for (let i = 0; i < this.count; i++) {
                if (!this.sand[i]) continue;
                let best = nearbyPlants[i];
                for (const j of this.neighbours[i]) {
                    const value = 0.84 * nearbyPlants[j];
                    if (value > best) best = value;
                }
                plantScratch[i] = best;
            }
            [nearbyPlants, plantScratch] = [plantScratch, nearbyPlants];
        }
        const steps = Math.ceil(5 * dt);
        if (!steps) return;
        const step = 5 * dt / steps;
        for (let n = 0; n < steps; n++) {
            // The habitat is recomputed per sub-step on purpose: it depends on
            // this.plants, which is updated every sub-step, so it cannot be hoisted
            // out of this loop. In practice steps === 1 (see updateColonies), so
            // hoisting the flow- and nearbyPlants-dependent factors would save
            // nothing and would change the Float32 rounding (bit-identical
            // evolution is kept). Do not "optimise" this away without measuring.
            for (let i = 0; i < this.count; i++) {
                this.habitat[i] = this.sand[i]
                    ? Math.max(0, 1 - this.flow[i] / 0.02) * Math.max(0, 1 - this.plants[i] / 0.6) *
                    Math.min(1, Math.max(0, (nearbyPlants[i] - 0.06) / 0.09)) : 0;
            }
            for (let i = 0; i < this.count; i++) {
                const p = this.plants[i], inhibitor = this.inhibitor[i];
                const u = this.microbeU[i], v = this.microbeV[i], habitat = this.habitat[i];
                let lapP = 0, lapI = 0, lapU = 0, lapV = 0, lapCount = 0;
                if (this.sand[i]) {
                    for (const j of this.neighbours[i]) {
                        if (!this.sand[j]) continue;
                        lapP += this.plants[j] - p;
                        lapI += this.inhibitor[j] - inhibitor;
                        const weight = Math.min(habitat, this.habitat[j]);
                        lapU += weight * (this.microbeU[j] - u);
                        lapV += weight * (this.microbeV[j] - v);
                        lapCount++;
                    }
                    if (lapCount > 0) {
                        lapP /= lapCount;
                        lapI /= lapCount;
                        lapU /= lapCount;
                        lapV /= lapCount;
                    }
                }
                const wetness = Math.min(1, Math.max(0, (nearby[i] - 0.009) / 0.005));
                const bank = this.sand[i] * wetness *
                    Math.min(1, Math.max(0, (0.8 - this.flow[i] / Math.max(nearby[i], 1e-12)) / 0.6));
                // Cells inside a fast-moving current are fully inhibited:
                // no plants or microbes grow, spread or inoculate there.
                const waterKill = Math.min(1, Math.max(0, (this.flow[i] - 0.010) / 0.008));
                const growth = 1 - waterKill;
                const reaction = (habitat > 0 ? 1 : 0) * growth * u * v * v;
                this.nextPlants[i] = Math.max(0, Math.min(1, p + step *
                    (growth * (0.06 * lapP + bank * (0.06 + 0.8 * p) * (1 - p)) -
                        (0.9 * inhibitor + (this.sand[i] ? 0 : 0.2) + 1.5 * waterKill) * p)));
                this.nextInhibitor[i] = Math.max(0, Math.min(1, inhibitor + step *
                    (0.02 * lapI + 0.1 * p - 0.05 * inhibitor)));
                this.nextU[i] = Math.max(0, Math.min(1, u + step *
                    (0.9 * lapU - reaction + 0.046 * (1 - u))));
                // A localized inoculum revives colonies lost from saved states.
                this.nextV[i] = Math.max(0, Math.min(1, v + step *
                    (0.45 * lapV + reaction - (0.109 + 0.15 * (1 - habitat) + 1.0 * waterKill) * v +
                        0.06 * this.microbeSeeds[i] * habitat * growth * Math.max(0, 1 - v / 0.15))));
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
        return { version: 2, count: this.count, data: btoa(bytes) };
    }

    fromJSON(json) {
        if (!json || typeof json !== 'object' || json.version !== 2 ||
            json.count !== this.count || typeof json.data !== 'string') {
            console.warn('Saved biology is incompatible with the local grid');
            return false;
        }
        // 4 fields x 2 bytes per cell; base64 is 4/3 longer. Reject an implausible
        // length before decoding so a corrupted or hostile string cannot make
        // atob allocate a huge binary string.
        const expectedBytes = this.count * 8;
        const expectedDataLength = Math.ceil(expectedBytes / 3) * 4;
        if (json.data.length < expectedDataLength - 4 || json.data.length > expectedDataLength + 4) {
            console.warn('Saved biology has an invalid length');
            return false;
        }
        let bytes;
        try {
            bytes = atob(json.data);
        } catch (error) {
            console.warn('Saved biology has an invalid encoding');
            return false;
        }
        if (bytes.length !== expectedBytes) {
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
