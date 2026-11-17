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
        this.particleCount = 500;
        this.waterPerParticle = 0.02;
        this.transportCapacity = 6;
        this.particleRadius = 0.105;
        this.maxSpeed = 3;
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
        const angle = Math.PI * fraction;
        const radius = this.arcBoundary(angle).radius * 0.999;
        particle.x = radius * Math.cos(angle);
        particle.z = -radius * Math.sin(angle);
        particle.vx = 0;
        particle.vz = 0;
    }

    arcBoundary(angle) {
        const width = Math.PI / this.grid.sectors;
        const sector = Math.min(this.grid.sectors - 1, Math.max(0, Math.floor(angle / width)));
        const normalAngle = (sector + 0.5) * width;
        return {
            radius: this.grid.radius * Math.cos(width / 2) / Math.cos(angle - normalAngle),
            nx: Math.cos(normalAngle),
            nz: -Math.sin(normalAngle)
        };
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
            for (const particle of this.particles) this.moveParticle(particle, subDt);
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
    }

    relaxSand(dt) {
        const grid = this.grid;
        const fraction = 1 - Math.exp(-20 * dt);
        for (let pass = 0; pass < 4; pass++) {
            for (let j = 0; j < grid.edges.length; j++) {
                const edge = grid.edges[pass % 2 === 0 ? j : grid.edges.length - 1 - j];
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
            const amount = exchange * Math.max(0, sample.weights[i]);
            const previousHeight = grid.elevation[index];
            const height = Math.max(grid.bedrock[index], previousHeight - amount / grid.vertexArea[index]);
            grid.elevation[index] = height;
            actualExchange += (previousHeight - height) * grid.vertexArea[index];
        });
        // Floating-point rounding can leave an exhausted load just below zero.
        particle.sediment = Math.max(0, particle.sediment + actualExchange);

        let x = particle.x + particle.vx * dt;
        let z = particle.z + particle.vz * dt;
        // Check the whole path up to the straight edge, not just its endpoint.
        const edgeFraction = z >= 0 ? -particle.z / (z - particle.z) : 1;
        const dx = (x - particle.x) * edgeFraction;
        const dz = (z - particle.z) * edgeFraction;
        const lengthSquared = dx * dx + dz * dz;
        const closest = lengthSquared > 0
            ? Math.max(0, Math.min(1, -(particle.x * dx + particle.z * dz) / lengthSquared))
            : 0;
        if (Math.hypot(particle.x + closest * dx, particle.z + closest * dz) < grid.sinkRadius) {
            this.reinject(particle);
            return;
        }
        if (z >= 0) {
            z = -0.000001;
            particle.vz = -Math.abs(particle.vz);
        }
        const radius = Math.hypot(x, z);
        const boundary = this.arcBoundary(Math.atan2(-z, x));
        if (radius > boundary.radius * 0.999999) {
            x *= boundary.radius * 0.999999 / radius;
            z *= boundary.radius * 0.999999 / radius;
            const outward = particle.vx * boundary.nx + particle.vz * boundary.nz;
            if (outward > 0) {
                particle.vx -= 2 * outward * boundary.nx;
                particle.vz -= 2 * outward * boundary.nz;
            }
        }
        particle.x = x;
        particle.z = z;
    }

    reset() {
        this.grid.initialize();
        this.createParticles();
    }
}
