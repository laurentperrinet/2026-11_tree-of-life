/**
 * Lagrangian water parcels on a piecewise-linear triangular bed.
 * Sediment exchanged with the bed is conserved as a volume.
 */
class PhysicsEngine {
    constructor(grid) {
        this.grid = grid;
        this.dt = 0.04;
        this.g = 9.81;
        this.friction = 1.8;
        this.Q_inlet = 0.5;
        this.timeScale = 1;
        this.particleCount = 1500;
        this.waterPerParticle = 0.02;
        this.transportCapacity = 6;
        this.erosionBorderWidth = 2;
        this.particleRadius = 0.105;
        this.maxSpeed = 3;
        this.particleHazardRate = 1 / 90;
        this.burstDuration = 0.8;
        this.sandReposeSlope = Math.tan(34 * Math.PI / 180);
        this.particles = [];
        this.createParticles();
    }

    createParticles() {
        this.particles = Array.from({ length: this.particleCount }, (_, i) => {
            const particle = { x: 0, z: 0, vx: 0, vz: 0, sediment: 0 };
            this.reinject(particle, (i + Math.random()) / this.particleCount);
            const radiusFraction = 0.1 + 0.9 * Math.random();
            particle.x *= radiusFraction;
            particle.z *= radiusFraction;
            return particle;
        });
        this.grid.particles = this.particles;
    }

    reinject(particle, fraction = Math.random()) {
        const angle = 2 * Math.PI * fraction;
        const radius = this.arcBoundary(angle).radius - 3 * this.grid.radius / this.grid.rings;
        particle.x = radius * Math.cos(angle);
        particle.z = -radius * Math.sin(angle);
        particle.vx = 0;
        particle.vz = 0;
        delete particle.burstProgress;
    }

    arcBoundary(angle) {
        const width = 2 * Math.PI / this.grid.sectors;
        const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const sector = Math.min(this.grid.sectors - 1, Math.floor(normalized / width));
        const normalAngle = (sector + 0.5) * width;
        return {
            radius: this.grid.radius * Math.cos(width / 2) / Math.cos(normalized - normalAngle),
            nx: Math.cos(normalAngle),
            nz: -Math.sin(normalAngle)
        };
    }

    erosionFactor(index) {
        const point = this.grid.vertices[index];
        const distance = this.grid.radius - Math.hypot(point.x, point.z);
        const t = Math.max(0, Math.min(1, distance / this.erosionBorderWidth));
        return t * t * (3 - 2 * t);
    }

    step() {
        const grid = this.grid;
        grid.waterDepth.fill(0);
        grid.sediment.fill(0);
        grid.velocityX.fill(0);
        grid.velocityY.fill(0);
        const dt = this.dt * this.timeScale * this.Q_inlet / 0.5;
        // Keep travel per substep smaller than a particle radius.
        const steps = Math.max(1, Math.ceil(dt / (this.particleRadius / this.maxSpeed)));
        const subDt = dt / steps;
        for (let sub = 0; sub < steps; sub++) {
            if (subDt > 0) this.collideParticles(subDt);
            for (const particle of this.particles) this.updateParticle(particle, subDt);
            if (subDt > 0) this.relaxSand(subDt);
        }
        for (const particle of this.particles) {
            const sample = grid.sample(particle.x, particle.z);
            if (!sample) throw new Error('Water particle outside the terrain mesh');
            sample.face.forEach((index, i) => {
                const weight = Math.max(0, sample.weights[i]);
                grid.waterDepth[index] += this.waterPerParticle * weight / grid.vertexArea[index];
                grid.sediment[index] += particle.sediment * weight / grid.vertexArea[index];
                grid.velocityX[index] += particle.vx * weight;
                grid.velocityY[index] += particle.vz * weight;
            });
        }
        grid.calculateEnergy();
        return dt;
    }

    relaxSand(dt) {
        const grid = this.grid;
        const fraction = 1 - Math.exp(-20 * dt);
        for (let pass = 0; pass < 4; pass++) {
            for (let j = 0; j < grid.edges.length; j++) {
                const edge = grid.edges[pass % 2 === 0 ? j : grid.edges.length - 1 - j];
                if (edge.a >= grid.erodibleCount || edge.b >= grid.erodibleCount) continue;
                let high = edge.a;
                let low = edge.b;
                if (grid.elevation[high] < grid.elevation[low]) [high, low] = [low, high];
                const excess = grid.elevation[high] - grid.elevation[low] -
                    this.sandReposeSlope * edge.length;
                if (excess <= 0) continue;
                const available = (grid.elevation[high] - grid.bedrock[high]) * grid.vertexArea[high];
                if (available <= 0) continue;
                const amount = Math.min(available, fraction * excess /
                    (1 / grid.vertexArea[high] + 1 / grid.vertexArea[low]));
                const oldHeight = grid.elevation[high];
                grid.elevation[high] = Math.max(grid.bedrock[high], oldHeight - amount / grid.vertexArea[high]);
                grid.elevation[low] += (oldHeight - grid.elevation[high]) *
                    grid.vertexArea[high] / grid.vertexArea[low];
            }
        }
    }

    collideParticles(dt) {
        const diameter = 2 * this.particleRadius;
        const bins = new Map();
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            if (particle.burstProgress !== undefined) continue;
            const bx = Math.floor(particle.x / diameter);
            const bz = Math.floor(particle.z / diameter);
            for (let x = bx - 1; x <= bx + 1; x++) {
                for (let z = bz - 1; z <= bz + 1; z++) {
                    for (const j of bins.get(`${x},${z}`) || []) {
                        const other = this.particles[j];
                        let dx = particle.x - other.x;
                        let dz = particle.z - other.z;
                        const distance = Math.hypot(dx, dz);
                        if (distance >= diameter) continue;
                        if (distance < 1e-12) {
                            const angle = (i * 2.399963229728653 + j) % (2 * Math.PI);
                            dx = Math.cos(angle);
                            dz = Math.sin(angle);
                        } else {
                            dx /= distance;
                            dz /= distance;
                        }
                        const relativeSpeed = (particle.vx - other.vx) * dx + (particle.vz - other.vz) * dz;
                        // Equal and opposite impulses provide a soft pressure for overlapping parcels.
                        const impulse = Math.min(0.25, 6 * (diameter - distance) * dt) +
                            Math.max(0, -relativeSpeed) * 0.55;
                        particle.vx += impulse * dx;
                        particle.vz += impulse * dz;
                        other.vx -= impulse * dx;
                        other.vz -= impulse * dz;
                    }
                }
            }
            const key = `${bx},${bz}`;
            if (!bins.has(key)) bins.set(key, []);
            bins.get(key).push(i);
        }
    }

    updateParticle(particle, dt) {
        if (dt <= 0) return;
        if (particle.burstProgress !== undefined) {
            const progress = particle.burstProgress + dt / this.burstDuration;
            if (progress >= 1) {
                this.depositEvaporatedSediment(particle);
                this.reinject(particle);
            } else {
                particle.burstProgress = progress;
            }
            return;
        }
        if (Math.random() < -Math.expm1(-this.particleHazardRate * dt)) {
            particle.burstProgress = 0;
            particle.vx = 0;
            particle.vz = 0;
            return;
        }
        this.moveParticle(particle, dt);
    }

    depositEvaporatedSediment(particle) {
        if (particle.sediment === 0) return;
        const grid = this.grid;
        const sample = grid.sample(particle.x, particle.z);
        if (!sample) throw new Error('Evaporating particle outside the terrain mesh');
        const weights = sample.weights.map(weight => Math.max(0, weight));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        if (total < 1e-12) throw new Error('No terrain for sediment deposit');
        for (let i = 0; i < sample.face.length; i++) {
            if (weights[i] > 0) {
                const index = sample.face[i];
                grid.elevation[index] += particle.sediment * weights[i] / total / grid.vertexArea[index];
            }
        }
        particle.sediment = 0;
    }

    moveParticle(particle, dt) {
        if (dt === 0) return;
        const grid = this.grid;
        const sample = grid.sample(particle.x, particle.z);
        if (!sample) throw new Error('Water particle outside the terrain mesh');
        const previousSpeed = Math.hypot(particle.vx, particle.vz);
        const damping = Math.exp(-this.friction * dt);
        particle.vx = (particle.vx - this.g * sample.dx * dt) * damping;
        particle.vz = (particle.vz - this.g * sample.dz * dt) * damping;
        let speed = Math.hypot(particle.vx, particle.vz);
        if (speed > this.maxSpeed) {
            particle.vx *= this.maxSpeed / speed;
            particle.vz *= this.maxSpeed / speed;
            speed = this.maxSpeed;
        }
        const capacity = this.waterPerParticle * this.transportCapacity * Math.max(0, speed - 0.1);
        const exchangeRate = speed < 0.1 ? 2 : 0.3;
        let exchange = (capacity - particle.sediment) * (1 - Math.exp(-exchangeRate * dt));
        if (speed < previousSpeed && particle.sediment > 0) {
            const slowingDeposit = particle.sediment * (1 - speed / previousSpeed);
            exchange = Math.min(exchange, -slowingDeposit);
        }
        if (exchange < 0) exchange = -Math.min(particle.sediment, -exchange);
        let actualExchange = 0;
        sample.face.forEach((index, i) => {
            if (index >= grid.erodibleCount) return;
            const amount = exchange * Math.max(0, sample.weights[i]) *
                (exchange > 0 ? this.erosionFactor(index) : 1);
            const previousHeight = grid.elevation[index];
            const height = Math.max(grid.bedrock[index], previousHeight - amount / grid.vertexArea[index]);
            grid.elevation[index] = height;
            actualExchange += (previousHeight - height) * grid.vertexArea[index];
        });
        // Floating-point rounding can leave an exhausted load just below zero.
        particle.sediment = Math.max(0, particle.sediment + actualExchange);

        let x = particle.x + particle.vx * dt;
        let z = particle.z + particle.vz * dt;
        if (z >= grid.halfSize) {
            const fraction = (grid.halfSize - particle.z) / (z - particle.z);
            const exitX = particle.x + fraction * (x - particle.x);
            if (Math.abs(exitX) < grid.sinkRadius) {
                this.reinject(particle);
                return;
            }
            z = grid.halfSize - 0.000001;
            particle.vz = -Math.abs(particle.vz);
        } else if (z <= -grid.halfSize) {
            z = -grid.halfSize + 0.000001;
            particle.vz = Math.abs(particle.vz);
        }
        if (x >= grid.halfSize) {
            x = grid.halfSize - 0.000001;
            particle.vx = -Math.abs(particle.vx);
        } else if (x <= -grid.halfSize) {
            x = -grid.halfSize + 0.000001;
            particle.vx = Math.abs(particle.vx);
        }
        particle.x = x;
        particle.z = z;
    }

    reset() {
        this.grid.initialize();
        this.createParticles();
    }
}
